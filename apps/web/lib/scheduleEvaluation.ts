import {
  EVALUATION_WEIGHTS,
  SCORING_CONFIG,
  SHIFT,
  calculateFatigue,
  normalizeShift,
  type ShiftType,
} from "@/lib/scheduleScoring"
import type { IUser } from "@/types/User"

/**
 * Оценка готового графика — второй алгоритм, который ничего не строит.
 *
 * Зачем он нужен. Построение идёт жадно: смены раздаются по одной, слот за
 * слотом, и на каждом шаге алгоритм видит только локальную картину. Из-за
 * случайного разрыва ничьих один и тот же состав даёт разные графики, и
 * сравнить их «на глаз» нельзя: у одного ровнее загрузка, у другого меньше
 * переходов «день → ночь», у третьего крепче серии — и кто из них лучше, из
 * внутренних счётов не следует, потому что они считались в разных условиях.
 *
 * Оценщик смотрит на готовый месяц целиком и считает пороки, а не очки за
 * удачные ходы. Это важно: сумма локальных очков не равна качеству графика —
 * жадный проход мог набрать их, оставив при этом незакрытую смену. Здесь же
 * каждое отклонение названо и взвешено, поэтому видно не только «эта версия
 * хуже», но и почему именно.
 *
 * Порядок весов задан в `EVALUATION_WEIGHTS`: нарушения правил перевешивают
 * недобор покрытия, недобор — договорённости с работником, а те — красоту
 * серий. Одна версия с незакрытой сменой не должна выигрывать у другой только
 * потому, что у той на одну одиночную смену больше.
 */

/** Настройки, от которых зависит оценка. */
export interface EvaluationSettings {
  dayCount: number
  nightCount: number
  afterNightDayOffs: number
  afterDayDayOffs: number
  daysInMonth: number
  frozenThroughDay: number
}

/** Раскладка склада в том виде, в каком её оценивают. */
export type EvaluatedSchedule = Record<
  string,
  { dayShifts: number[]; nightShifts: number[] }
>

/** Что именно не так с графиком. Все значения — «сколько раз» или «на сколько». */
export interface ScheduleMetrics {
  /** Смен, которых не хватило до нормы, — суммарно по дням. */
  shortfall: number
  /** Лишних людей сверх нормы — суммарно по дням. */
  excess: number
  /** Нарушений отдыха: день после ночи и ночь накануне дня. */
  restViolations: number
  /** Смен, поставленных в день с отпуском, больничным или выходным. */
  markViolations: number
  /** Смен не того типа, который работник выбрал. */
  preferenceMismatches: number
  /** Смен сверх месячного максимума. */
  maxExceeded: number
  /** Смен, которых не хватило до месячного минимума. */
  minShortfall: number
  /** Переходов «день → ночь» без положенного отдыха. */
  dayNightTransitions: number
  /** Сумма отклонений загрузки от справедливой доли. */
  loadDeviation: number
  /** Смен без соседей того же типа — рваный график. */
  isolatedShifts: number
  /** Чередований «день-ночь-день» и обратных. */
  alternations: number
  /** Пики усталости выше порога, за каждую единицу. */
  fatiguePeaks: number
}

export interface ScheduleEvaluation {
  /** Итоговая оценка: чем меньше, тем лучше. */
  cost: number
  metrics: ScheduleMetrics
}

const ZERO_METRICS: ScheduleMetrics = {
  shortfall: 0,
  excess: 0,
  restViolations: 0,
  markViolations: 0,
  preferenceMismatches: 0,
  maxExceeded: 0,
  minShortfall: 0,
  dayNightTransitions: 0,
  loadDeviation: 0,
  isolatedShifts: 0,
  alternations: 0,
  fatiguePeaks: 0,
}

/** Есть ли смена нужного типа в последние `windowSize` дней перед `day`. */
function hasRecent(
  userMap: Map<number, string>,
  day: number,
  windowSize: number,
  type: ShiftType
): boolean {
  for (let i = 1; i <= windowSize; i++) {
    if (normalizeShift(userMap.get(day - i)) === type) return true
  }
  return false
}

/** Есть ли смена нужного типа в ближайшие `windowSize` дней после `day`. */
function hasUpcoming(
  userMap: Map<number, string>,
  day: number,
  windowSize: number,
  type: ShiftType
): boolean {
  for (let i = 1; i <= windowSize; i++) {
    if (normalizeShift(userMap.get(day + i)) === type) return true
  }
  return false
}

/**
 * Собирает карту занятости по готовой раскладке.
 *
 * Чужие смены и хвост предыдущего месяца кладутся туда же, где свои: правила
 * отдыха и серии считаются по сплошной истории человека, а не по одному складу.
 * Своя смена не перебивает чужую — приоритет у другого склада, как и в
 * построении.
 */
function occupancyOf(
  schedule: EvaluatedSchedule,
  users: IUser[],
  daysInMonth: number
): Map<string, Map<number, string>> {
  const bySubject = new Map<string, Map<number, string>>()

  for (const user of users) {
    const map = new Map<number, string>()

    for (const [rawDay, shift] of Object.entries(user.externalShifts)) {
      const day = Number(rawDay)
      if (day >= 1 && day <= daysInMonth) {
        map.set(day, shift.shiftType === SHIFT.DAY ? "Day" : "Night")
      }
    }

    for (const shift of user.previousShifts) {
      map.set(shift.day, shift.shiftType === SHIFT.DAY ? "Day" : "Night")
    }

    const plan = schedule[user.subject]
    if (plan) {
      for (const day of plan.dayShifts) {
        if (day >= 1 && day <= daysInMonth && !map.has(day)) map.set(day, "Day")
      }
      for (const day of plan.nightShifts) {
        if (day >= 1 && day <= daysInMonth && !map.has(day)) map.set(day, "Night")
      }
    }

    bySubject.set(user.subject, map)
  }

  return bySubject
}

/**
 * Оценивает готовую раскладку склада.
 *
 * Функция чистая и детерминированная: на одной раскладке всегда одна и та же
 * оценка. Именно поэтому ею можно сравнивать версии — иначе выбор «лучшей» был
 * бы ещё одним броском монеты.
 */
export function evaluateSchedule(
  schedule: EvaluatedSchedule,
  users: IUser[],
  settings: EvaluationSettings
): ScheduleEvaluation {
  const {
    dayCount,
    nightCount,
    afterNightDayOffs,
    afterDayDayOffs,
    daysInMonth,
    frozenThroughDay,
  } = settings

  const nightRest = Math.max(1, afterNightDayOffs)
  const dayRest = Math.max(1, afterDayDayOffs)

  const metrics: ScheduleMetrics = { ...ZERO_METRICS }
  if (!users.length) return { cost: 0, metrics }

  const bySubject = occupancyOf(schedule, users, daysInMonth)

  // ── Покрытие: ровно столько, сколько задано ───────────────────────────────
  //
  // Прошедшие дни пропускаются: их не планируют, и требовать норму с уже
  // отработанного дня бессмысленно.
  for (let day = 1; day <= daysInMonth; day++) {
    if (day <= frozenThroughDay) continue

    for (const type of [SHIFT.DAY, SHIFT.NIGHT] as ShiftType[]) {
      const needed = type === SHIFT.DAY ? dayCount : nightCount

      let filled = 0
      for (const user of users) {
        // Чужая смена закрывает слот другого склада: в здешнем покрытии она не
        // считается — ровно как и в построении.
        if (user.externalShifts[day]) continue
        if (normalizeShift(bySubject.get(user.subject)!.get(day)) === type) {
          filled++
        }
      }

      if (filled < needed) metrics.shortfall += needed - filled
      else metrics.excess += filled - needed
    }
  }

  // ── По каждому работнику: правила, договорённости и загрузка ──────────────
  const loads: { user: IUser; load: number }[] = []
  let totalLoad = 0

  for (const user of users) {
    const map = bySubject.get(user.subject)!
    const plan = schedule[user.subject]

    const own: [number, ShiftType][] = [
      ...(plan?.dayShifts ?? []).map((day) => [day, SHIFT.DAY] as [number, ShiftType]),
      ...(plan?.nightShifts ?? []).map((day) => [day, SHIFT.NIGHT] as [number, ShiftType]),
    ]

    let load = 0

    for (const [day, type] of own) {
      if (day < 1 || day > daysInMonth) continue
      load++

      if (user.daysOffUsers.includes(day) || user.marks[day]) {
        metrics.markViolations++
      }
      if (user.shiftPreference === "only_day" && type === SHIFT.NIGHT) {
        metrics.preferenceMismatches++
      }
      if (user.shiftPreference === "only_night" && type === SHIFT.DAY) {
        metrics.preferenceMismatches++
      }

      if (type === SHIFT.DAY && hasRecent(map, day, nightRest, SHIFT.NIGHT)) {
        metrics.restViolations++
      }
      if (type === SHIFT.NIGHT && hasUpcoming(map, day, nightRest, SHIFT.DAY)) {
        metrics.restViolations++
      }
      // Переход «день → ночь» — не нарушение, а нежелательное событие: в
      // построении за него отвечает мягкий штраф, здесь он считается отдельно.
      if (type === SHIFT.NIGHT && hasRecent(map, day, dayRest, SHIFT.DAY)) {
        metrics.dayNightTransitions++
      }
    }

    // Чужие смены — тоже нагрузка человека: иначе тот, кто уже загружен на
    // другом складе, выглядел бы свободным, и перегруз не был бы виден.
    for (const rawDay of Object.keys(user.externalShifts)) {
      const day = Number(rawDay)
      if (day >= 1 && day <= daysInMonth) load++
    }

    loads.push({ user, load })
    totalLoad += load

    if (load > user.maxShiftsPerMonth) {
      metrics.maxExceeded += load - user.maxShiftsPerMonth
    }
    if (load < user.minShiftsPerMonth) {
      metrics.minShortfall += user.minShiftsPerMonth - load
    }
  }

  // Справедливая доля — по силе работника, как и в построении: сильный должен
  // получить больше смен, но ровно во столько раз, во сколько сильнее.
  const totalPriority = users.reduce((sum, user) => sum + user.priority, 0)
  if (totalPriority > 0) {
    let deviation = 0
    for (const { user, load } of loads) {
      deviation += Math.abs(load - (user.priority / totalPriority) * totalLoad)
    }
    metrics.loadDeviation = Math.round(deviation)
  }

  // ── Качество раскладки: серии, чередование, усталость ─────────────────────
  for (const user of users) {
    const map = bySubject.get(user.subject)!

    for (let day = 1; day <= daysInMonth; day++) {
      if (day <= frozenThroughDay) continue

      const type = normalizeShift(map.get(day))
      if (!type) continue

      const left = normalizeShift(map.get(day - 1))
      const right = normalizeShift(map.get(day + 1))
      if (left !== type && right !== type) metrics.isolatedShifts++
    }

    for (let day = 1; day + 2 <= daysInMonth; day++) {
      if (day <= frozenThroughDay) continue

      const first = normalizeShift(map.get(day))
      const middle = normalizeShift(map.get(day + 1))
      const last = normalizeShift(map.get(day + 2))

      if (
        first !== null &&
        middle !== null &&
        last !== null &&
        first === last &&
        middle !== first
      ) {
        metrics.alternations++
      }
    }

    let peak = 0
    for (let day = 1; day <= daysInMonth + 1; day++) {
      peak = Math.max(peak, calculateFatigue(map, day))
    }
    metrics.fatiguePeaks += Math.max(0, peak - SCORING_CONFIG.FATIGUE_THRESHOLD)
  }

  const cost =
    metrics.restViolations * EVALUATION_WEIGHTS.REST_VIOLATION +
    metrics.markViolations * EVALUATION_WEIGHTS.MARK_VIOLATION +
    metrics.shortfall * EVALUATION_WEIGHTS.SHORTFALL +
    metrics.excess * EVALUATION_WEIGHTS.EXCESS +
    metrics.maxExceeded * EVALUATION_WEIGHTS.MAX_EXCEEDED +
    metrics.minShortfall * EVALUATION_WEIGHTS.MIN_SHORTFALL +
    metrics.preferenceMismatches * EVALUATION_WEIGHTS.PREFERENCE_MISMATCH +
    metrics.dayNightTransitions * EVALUATION_WEIGHTS.DAY_NIGHT_TRANSITION +
    metrics.loadDeviation * EVALUATION_WEIGHTS.LOAD_DEVIATION +
    metrics.isolatedShifts * EVALUATION_WEIGHTS.ISOLATED_SHIFT +
    metrics.alternations * EVALUATION_WEIGHTS.ALTERNATION +
    metrics.fatiguePeaks * EVALUATION_WEIGHTS.FATIGUE_PEAK

  return { cost, metrics }
}
