/**
 * Алгоритм построения графика смен.
 *
 * Чистая функция без React и без обращения к сети: принимает состав склада и
 * требования, возвращает раскладку по дням. Так её можно проверить тестами —
 * раньше она жила внутри компонента, и единственным способом убедиться в
 * правильности было нажать кнопку и посмотреть глазами.
 *
 * ─── Главное про другие склады ───────────────────────────────────────────────
 *
 * Человек может работать на нескольких складах, и смены на них — часть того же
 * месяца. Алгоритм обязан их видеть целиком, а не только как «день занят»:
 *
 *   * серии и блоки считаются по сплошной истории, иначе после ночи на другом
 *     складе спокойно ставился день;
 *   * отдых после ночной смены проверяется по ней же;
 *   * усталость и загрузка человека считаются суммарно, иначе график этого
 *     склада выравнивал бы всех по нулю и добивал того, кто уже загружен.
 *
 * Поэтому чужие смены кладутся в ту же карту занятости, что и свои. Отдельно
 * отслеживается только одно: при сохранении в этот склад они не попадают —
 * они уже записаны другим складом.
 */

import {
  SHIFT,
  SCORING_CONFIG,
  type ShiftType,
  calculateBlockScore,
  calculateChaosPenalty,
  calculateDayNightTransitionPenalty,
  calculateFatigue,
  calculateFatigueScore,
  calculateLookAheadPenalty,
  calculateStreak,
  calculateStreakScore,
  normalizeShift,
} from "@/lib/scheduleScoring"
import {
  evaluateSchedule,
  type EvaluatedSchedule,
  type ScheduleEvaluation,
} from "@/lib/scheduleEvaluation"
import { hashString, seededRandom, type RandomSource } from "@/lib/random"
import type { IUser } from "@/types/User"

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface ShiftSlot {
  /** "Day" | "Night" — как в хранилище, с заглавной буквы. */
  type: string
  day: number
}

interface ScoredUser {
  subject: string
  score: number
}

/**
 * Состояние слота: сколько людей в нём нужно и сколько стоит.
 *
 * Одна форма на оба отклонения — недобор и излишек, — потому что вопрос у них
 * один: сколько людей в слоте против нормы. Разница только в знаке.
 */
export interface SlotCoverage {
  day: number
  /** "Day" | "Night" — как в настройках склада, с заглавной буквы. */
  type: string
  needed: number
  filled: number
}

/** Слот, который не удалось закрыть: людей меньше нормы. */
export type UnfilledSlot = SlotCoverage

/** Слот, в котором людей больше нормы и снять их не вышло. */
export type ExcessSlot = SlotCoverage

/**
 * Одна правка, которую инкрементальный пересбор внёс в график.
 *
 * `from: null` — смена появилась, `to: null` — смена снята. Отчёт нужен
 * менеджеру: без него пересбор выглядит как «алгоритм перетасовал весь месяц»,
 * и невозможно понять, что ручная правка уцелела, а поехало только окружение.
 */
export interface ScheduleChange {
  subject: string
  day: number
  /** Что было: тип смены или `null`, если день был пустым. */
  from: ShiftType | null
  /** Что стало: тип смены или `null`, если смену сняли. */
  to: ShiftType | null
}

export interface GeneratorSettings {
  dayCount: number
  nightCount: number
  afterNightDayOffs: number
  afterDayDayOffs: number
  daysInMonth: number
  /**
   * Дни с 1-го по этот включительно алгоритм не трогает: в текущем месяце это
   * уже прошедшие дни. `0` — месяц не ограничен.
   *
   * В отличие от закрепления, которое менеджер ставит по одному дню, граница
   * приходит от календаря и одинакова для всех участников.
   */
  frozenThroughDay: number
}

/**
 * Раскладка склада: ключ — ссылка на участника.
 *
 * `pinnedDays` — подмножество смен, которые менеджер поставил руками. Они
 * возвращаются вместе со сменами, потому что клиент сохраняет месяц целиком:
 * без признака в черновике сервер не отличил бы правку от раскладки алгоритма
 * и снял бы закрепление.
 */
export interface SubjectPlan {
  dayShifts: number[]
  nightShifts: number[]
  pinnedDays: number[]
}

/**
 * Что даёт один проход построения — до сравнения версий.
 *
 * Оценка и сведения о числе версий сюда не входят: их добавляет общая обёртка,
 * которая эти проходы запускает. Так у построения и пересбора одна и та же
 * форма результата, а сам проход не знает, что его сравнивают с другими.
 */
export interface RawResult {
  schedule: Record<string, SubjectPlan>
  unfilledSlots: UnfilledSlot[]
  /**
   * Слоты, где людей больше нормы и снять излишек не удалось.
   *
   * Норма — «ровно столько, сколько задано», а не «хотя бы»: алгоритм ставит
   * ровно. Но закреплённую смену снять нельзя, и если весь излишек закреплён,
   * день остаётся переполненным. Молча — нельзя: об этом сообщается здесь, а
   * интерфейс показывает предупреждение.
   */
  excessSlots: ExcessSlot[]
  /** Сколько человек подходит на день и на ночь — для предупреждений. */
  eligible: { day: number; night: number }
  /**
   * Правки относительно входного графика.
   *
   * Полная пересборка меняет всё сразу, и перечислять её правки бессмысленно —
   * она возвращает пустой список. Список заполняет только `repairSchedule`.
   */
  changes: ScheduleChange[]
}

/**
 * Результат одного прохода вместе с картой занятости.
 *
 * Карта нужна поиску по целевой функции: он перестраивает окна прямо в ней, а не
 * собирает месяц заново. Наружу она не отдаётся — публичный результат
 * по-прежнему описывает только раскладку склада.
 */
interface Built {
  assignedDays: Map<string, Map<number, string>>
  result: RawResult
}

export interface GenerationResult extends RawResult {
  /**
   * Оценка выбранной версии вторым алгоритмом — `evaluateSchedule`.
   *
   * Сравнивать версии по внутренним счётам построения нельзя: они набирались по
   * шагам и в разных условиях. Оценщик смотрит на готовый месяц целиком.
   */
  evaluation: ScheduleEvaluation
  /** Сколько версий построено и сравнено. */
  variantsConsidered: number
  /**
   * Оценка стартовой раскладки — до поиска по целевой функции.
   *
   * Нужна, чтобы выигрыш поиска был виден числом, а не на словах: `evaluation`
   * относится к тому, что отдано, а это — к тому, что было собрано жадным
   * проходом. Если поиск не запускался, значения совпадают.
   */
  initialCost: number
  /** Сколько перестроек окна поиск принял. Ноль — раскладка уже была хороша. */
  acceptedMoves: number
  /**
   * Оценка каждой рассмотренной версии, в порядке построения.
   *
   * Нужна, чтобы «выбрана лучшая» не было словами на веру: из этих чисел видно
   * и разброс между версиями, и насколько выбранная лучше остальных.
   *
   * В пересборе главный критерий выбора — число правок, и лишь при равенстве
   * решает эта оценка. Поэтому минимальная цена здесь не всегда у победителя.
   */
  variantCosts: number[]
}

export interface GenerationOptions {
  /**
   * Сколько независимых версий построить и сравнить.
   *
   * Один проход — прежнее поведение и самая дешёвая операция; больше проходов
   * даёт более ровный график ценой кратного времени. По умолчанию один:
   * вызывающий код должен решать явно, платить ли за перебор.
   */
  variants?: number
  /**
   * Источник случайности.
   *
   * По умолчанию — генератор по зерну, выведенному из самих данных (`seedOf`).
   * Это значит, что при одном и том же складе, месяце, составе и настройках
   * кнопка даёт один и тот же график: смены не прыгают от нажатия к нажатию.
   *
   * Подставить свой источник стоит, когда нужен **другой** вариант раскладки на
   * тех же данных — например, чтобы показать менеджеру альтернативу, — или в
   * тестах, где свойство проверяется на серии прогонов.
   */
  random?: RandomSource
  /**
   * Сколько окон перестраивает поиск по целевой функции.
   *
   * Параметр нужен для замеров и тестов: бюджет поиска — это компромисс между
   * качеством раскладки и временем ответа, и подбирать его вслепую нельзя.
   * По умолчанию — шесть попыток на человека (`searchBudget`).
   */
  searchIterations?: number
}

/**
 * Предел числа версий.
 *
 * Перебор линеен по времени, и случайная опечатка вида `variants: 1000`
 * заморозила бы вкладку на минуты. Предел не про качество, а про
 * предсказуемость: дальше выигрыш в оценке уже неразличим, а ожидание заметно.
 */
const MAX_VARIANTS = 24

function normalizeVariants(value: number | undefined): number {
  if (!value || value < 1) return 1
  return Math.min(Math.trunc(value), MAX_VARIANTS)
}

// ─── Помощники ────────────────────────────────────────────────────────────────

/**
 * Есть ли смена нужного типа в последние `windowSize` дней перед `day`.
 *
 * Используется и для «отдых после ночи перед днём», и для симметричных
 * правил охлаждения. Карта занятости содержит и чужие смены, поэтому правило
 * работает через границы складов.
 */
function hasRecentShift(
  userMap: Map<number, string>,
  day: number,
  windowSize: number,
  shiftToBlock: ShiftType
): boolean {
  if (windowSize <= 0) return false
  for (let i = 1; i <= windowSize; i++) {
    if (userMap.get(day - i)?.toLowerCase() === shiftToBlock) return true
  }
  return false
}

/**
 * Есть ли смена нужного типа в ближайшие `windowSize` дней ПОСЛЕ `day`.
 *
 * Зеркало `hasRecentShift`: растягивание блока добавляет смену в день, которого
 * у человека ещё не было, и проверять нужно обе стороны — иначе ночь встанет
 * накануне уже стоящего дня.
 */
function hasUpcomingShift(
  userMap: Map<number, string>,
  day: number,
  windowSize: number,
  shiftToBlock: ShiftType
): boolean {
  if (windowSize <= 0) return false
  for (let i = 1; i <= windowSize; i++) {
    if (normalizeShift(userMap.get(day + i)) === shiftToBlock) return true
  }
  return false
}

/**
 * Отметка невыхода: выходной, отпуск, больничный.
 *
 * Чужих смен здесь нет намеренно — они уже лежат в карте занятости, и
 * проверка `userMap.has(day)` их ловит. Дублировать это значило бы завести
 * два места, которые могут разойтись.
 */
function hasAbsenceMark(user: IUser, day: number): boolean {
  return Boolean(user.marks[day])
}

/** Считается ли смена в этом дне своей для текущего склада. */
function isOwnShift(user: IUser, day: number): boolean {
  return !user.externalShifts[day]
}

/**
 * Сколько смен у человека в планируемом месяце.
 *
 * Не `map.size`: карта занятости помнит ещё и хвост предыдущего месяца, и если
 * считать его нагрузкой, человек с тремя сменами в конце прошлого месяца
 * выглядел бы перегруженным и недополучил бы смен в этом.
 */
export function currentLoad(userMap: Map<number, string>): number {
  let count = 0
  for (const day of userMap.keys()) {
    if (day >= 1) count++
  }
  return count
}

/**
 * День закреплён менеджером: он поставил смену кликом по клетке.
 *
 * Такой день алгоритм не двигает и не отдаёт другому: это решение человека,
 * а не черновик. Карта, а не массив, потому что вопрос «неприкосновенен ли
 * этот день» задаётся в проходах балансировки сотни раз.
 */
type PinnedDays = Map<string, Set<number>>

function isPinned(pinned: PinnedDays, subject: string, day: number): boolean {
  return pinned.get(subject)?.has(day) ?? false
}

/**
 * Смены работника в этом складе, в виде пар «день — тип».
 *
 * Регистр типа тот же, что в карте занятости: остальной код сравнивает
 * значения без учёта регистра только потому, что они приходят из разных
 * источников, а здесь лишнее преобразование ни к чему.
 */
function localShifts(user: IUser, daysInMonth: number): [number, string][] {
  return [
    ...user.dayShifts.map((day) => [day, "Day"] as [number, string]),
    ...user.nightShifts.map((day) => [day, "Night"] as [number, string]),
  ].filter(([day]) => day >= 1 && day <= daysInMonth)
}

// ─── Пост-обработка: растягивание одиночных смен ──────────────────────────────

/**
 * Растягивает одиночные смены до блока.
 *
 * Чужие смены не трогаются: они принадлежат другому складу, и «доращивать» их
 * отсюда нельзя — это записало бы чужую историю в текущий график. Поэтому
 * островом считается только своя смена.
 */
function runOptimizationPass(
  assignedDays: Map<string, Map<number, string>>,
  users: IUser[],
  daysInMonth: number,
  slotCapacity: (day: number, type: ShiftType) => number,
  nightRest: number,
  dayRest: number,
  frozenThroughDay: number
): void {
  for (const user of users) {
    const userMap = assignedDays.get(user.subject)!

    for (let day = 1; day <= daysInMonth; day++) {
      if (!isOwnShift(user, day)) continue

      const prev = normalizeShift(userMap.get(day - 1))
      const curr = normalizeShift(userMap.get(day))
      const next = normalizeShift(userMap.get(day + 1))

      if (curr === null || prev !== null || next !== null) continue

      const extendInto = (targetDay: number) => {
        if (targetDay < 1 || targetDay > daysInMonth) return false
        // Прошедший день не планируется: растянуть блок в прошлое значило бы
        // задним числом поставить человеку смену, которой не было.
        if (targetDay <= frozenThroughDay) return false
        if (userMap.has(targetDay)) return false
        if (!isOwnShift(user, targetDay)) return false

        // Жёсткие ограничения: выходной, отпуск и максимум смен. Максимум
        // считается по всем складам: карта содержит и чужие смены.
        if (user.daysOffUsers.includes(targetDay)) return false
        if (hasAbsenceMark(user, targetDay)) return false
        if (currentLoad(userMap) >= user.maxShiftsPerMonth) return false

        // Добавляемая смена проверяется с обеих сторон и по обоим правилам:
        // день не встаёт после ночи и ночь не встаёт после дня — и то же самое
        // вперёд. Односторонняя проверка оставляла лазейку: растянутый ВПЕРЁД
        // день оказывался накануне уже стоящей ночи, и переход «день → ночь»
        // возвращался.
        if (curr === SHIFT.DAY) {
          if (hasRecentShift(userMap, targetDay, nightRest, SHIFT.NIGHT)) {
            return false
          }
          if (
            hasUpcomingShift(
              userMap,
              targetDay,
              dayRest,
              SHIFT.NIGHT
            )
          ) {
            return false
          }
        } else {
          if (
            hasRecentShift(userMap, targetDay, dayRest, SHIFT.DAY)
          ) {
            return false
          }
          if (hasUpcomingShift(userMap, targetDay, nightRest, SHIFT.DAY)) {
            return false
          }
        }

        // Встречная проверка — «ночь перед уже стоящим днём» — здесь не нужна
        // и была бы недостижимой. Растянуть смену можно только в
        // недозаполненный слот, а в такой слот основной проход уже поставил бы
        // этого же человека: значит, свободный день у него не от нехватки
        // кандидатов, а от запрета, и запрет ловится выше. Инвариант
        // «после ночи нет дня» проверяется перебором в тестах.

        if (localCoverage(assignedDays, users, targetDay, curr) >= slotCapacity(targetDay, curr)) {
          return false
        }

        userMap.set(targetDay, curr === SHIFT.DAY ? "Day" : "Night")
        return true
      }

      if (!extendInto(day - 1)) extendInto(day + 1)
    }
  }
}

/**
 * Сколько людей выходит на этот день в этом типе смены **на текущем складе**.
 *
 * Чужие смены не считаются: они закрывают день другого склада, и прибавлять
 * их к покрытию здешнего слота значило бы недосчитать своих.
 */
function localCoverage(
  assignedDays: Map<string, Map<number, string>>,
  users: IUser[],
  day: number,
  type: ShiftType
): number {
  return users.filter(
    (user) =>
      isOwnShift(user, day) &&
      normalizeShift(assignedDays.get(user.subject)!.get(day)) === type
  ).length
}

/**
 * Слоты, которым не хватило людей.
 *
 * Считается по готовой карте, а не по ходу раздачи: тот же вопрос задаёт поиск
 * по целевой функции, когда перестраивает окно и хочет знать, не остался ли
 * день пустым. Второй способ считать то же самое однажды разошёлся бы с первым.
 */
function collectUnfilledSlots(
  assignedDays: Map<string, Map<number, string>>,
  users: IUser[],
  dayCount: number,
  nightCount: number,
  daysInMonth: number,
  frozenThroughDay: number
): UnfilledSlot[] {
  const unfilled: UnfilledSlot[] = []

  for (let day = 1; day <= daysInMonth; day++) {
    if (day <= frozenThroughDay) continue

    for (const type of [SHIFT.DAY, SHIFT.NIGHT] as ShiftType[]) {
      const needed = type === SHIFT.DAY ? dayCount : nightCount
      const filled = localCoverage(assignedDays, users, day, type)
      if (filled < needed) {
        unfilled.push({ day, type: mapLabel(type), needed, filled })
      }
    }
  }

  return unfilled
}

/**
 * Слоты, в которых людей больше нормы.
 *
 * Появляются только из закреплённых смен и прошедших дней: всё, что расставил
 * алгоритм, он расставляет ровно по норме. Пересбор излишек снимает сам, но
 * закреплённую смену не трогает — и если снять нечего, честнее сказать об этом
 * менеджеру, чем оставить день переполненным молча.
 *
 * Прошедшие дни пропускаются, как и в предупреждениях о нехватке: их не
 * планируют, и «переполнен» для уже отработанного дня ничего не значит.
 */
function collectExcessSlots(
  assignedDays: Map<string, Map<number, string>>,
  users: IUser[],
  dayCount: number,
  nightCount: number,
  daysInMonth: number,
  frozenThroughDay: number
): ExcessSlot[] {
  const excess: ExcessSlot[] = []

  for (let day = 1; day <= daysInMonth; day++) {
    if (day <= frozenThroughDay) continue

    for (const type of [SHIFT.DAY, SHIFT.NIGHT] as ShiftType[]) {
      const needed = type === SHIFT.DAY ? dayCount : nightCount
      const filled = localCoverage(assignedDays, users, day, type)
      if (filled > needed) {
        excess.push({ day, type: mapLabel(type), needed, filled })
      }
    }
  }

  return excess
}

// ─── Пост-обработка: выравнивание нагрузки ───────────────────────────────────

/**
 * Локальный поиск: переносит смену с перегруженного на свободного и
 * недогруженного, если перенос не нарушает жёстких ограничений — выходной,
 * предпочтение, отдых после ночи и максимум смен в месяц.
 *
 * Нагрузка считается **по всем складам**: карта занятости содержит чужие смены,
 * поэтому «перегружен» здесь означает «много смен вообще», а не «много смен
 * на этом складе». Иначе человек, уже загруженный на другом складе, выглядел бы
 * свободным и получал бы добавку.
 *
 * Двигаются только свои смены: смена на другом складе принадлежит ему, и
 * распоряжаться ею отсюда нельзя.
 */
/**
 * Смена стоит в середине серии: слева и справа тот же человек тоже работает.
 *
 * Забрать такую смену — значит разрезать серию надвое и получить две коротких
 * вместо одной: ровно то, ради чего выравнивание нагрузки и запускается
 * последним. Измерение на живом складе: без этой проверки балансировка
 * удваивала число одиночных смен (7.5 → 14 на месяц).
 */
export function isMidBlock(userMap: Map<number, string>, day: number): boolean {
  return userMap.has(day - 1) && userMap.has(day + 1)
}

/**
 * Встанет ли смена в серию, а не одиночкой.
 *
 * Продолжение — когда рядом уже есть смена того же типа. Начало новой серии
 * тоже годится, но только после отдыха: иначе это смена в разрыве между двумя
 * чужими сериями, то есть та же одиночка, просто с другой стороны.
 */
export function fitsBlock(
  userMap: Map<number, string>,
  day: number,
  shiftType: ShiftType
): boolean {
  const left = normalizeShift(userMap.get(day - 1))
  const right = normalizeShift(userMap.get(day + 1))
  if (left === shiftType || right === shiftType) return true
  if (left !== null || right !== null) return false
  // Оба соседа свободны: это начало серии, и перед ней должен быть отдых.
  return normalizeShift(userMap.get(day - 2)) === null
}

function runFairnessPass(
  assignedDays: Map<string, Map<number, string>>,
  users: IUser[],
  daysInMonth: number,
  nightRest: number,
  dayRest: number,
  pinned: PinnedDays,
  frozenThroughDay: number,
  random: RandomSource,
  iterations = 400
): void {
  const isValidAssignment = (
    user: IUser,
    userMap: Map<number, string>,
    day: number,
    shiftType: ShiftType
  ): boolean => {
    if (user.daysOffUsers.includes(day)) return false
    if (hasAbsenceMark(user, day)) return false
    if (userMap.has(day)) return false
    if (currentLoad(userMap) >= user.maxShiftsPerMonth) return false
    if (user.shiftPreference === "only_day" && shiftType === SHIFT.NIGHT) return false
    if (user.shiftPreference === "only_night" && shiftType === SHIFT.DAY) return false
    if (
      shiftType === SHIFT.DAY &&
      hasRecentShift(userMap, day, nightRest, SHIFT.NIGHT)
    ) {
      return false
    }
    // Переход «день → ночь» не создаём и здесь: перенос смены — такая же
    // правка графика, как и назначение, и правило для него то же.
    if (
      shiftType === SHIFT.NIGHT &&
      hasRecentShift(userMap, day, dayRest, SHIFT.DAY)
    ) {
      return false
    }
    // Отдых после дневной перед ночной здесь намеренно не проверяется жёстко —
    // см. calculateDayNightTransitionPenalty в основном проходе. Этот проход
    // только переносит одиночные смены между уже корректными раскладками, и
    // жёсткая проверка вернула бы ту же нехватку кандидатов.

    // Встречная проверка: не сломает ли перенос отдых после ночи для смены,
    // которая у этого же человека уже стоит завтра?
    const nextDayShift = userMap.get(day + 1)
    if (
      nextDayShift?.toLowerCase() === SHIFT.DAY &&
      shiftType === SHIFT.NIGHT
    ) {
      return false
    }
    return true
  }

  const totalOf = (subject: string) => currentLoad(assignedDays.get(subject)!)

  for (let it = 0; it < iterations; it++) {
    const day = 1 + Math.floor(random() * daysInMonth)

    // Прошедший день не переставляется: перенос убрал бы смену, которую человек
    // уже отработал.
    if (day <= frozenThroughDay) continue

    const overloaded = users
      .filter(
        (u) =>
          assignedDays.get(u.subject)!.has(day) &&
          isOwnShift(u, day) &&
          // Закреплённую смену не забираем даже у перегруженного: это правка
          // менеджера, а не раскладка алгоритма.
          !isPinned(pinned, u.subject, day)
      )
      .sort((a, b) => totalOf(b.subject) - totalOf(a.subject))[0]
    if (!overloaded) continue

    const shiftType = normalizeShift(assignedDays.get(overloaded.subject)!.get(day))
    if (!shiftType) continue

    const replacement = users
      .filter((u) => u.subject !== overloaded.subject)
      .filter((u) => isValidAssignment(u, assignedDays.get(u.subject)!, day, shiftType))
      .sort((a, b) => totalOf(a.subject) - totalOf(b.subject))[0]
    if (!replacement) continue

    // Переносим, только если разрыв действительно сокращается.
    if (totalOf(replacement.subject) + 1 >= totalOf(overloaded.subject)) continue

    const overloadedMap = assignedDays.get(overloaded.subject)!
    // Смену из середины серии не забираем: у перегруженного останется дыра,
    // и одна длинная серия превратится в две коротких.
    if (isMidBlock(overloadedMap, day)) continue
    // И получателю смена должна встать в серию, а не одиночкой.
    if (!fitsBlock(assignedDays.get(replacement.subject)!, day, shiftType)) continue

    const label = overloadedMap.get(day)!
    overloadedMap.delete(day)
    assignedDays.get(replacement.subject)!.set(day, label)
  }
}

// ─── Общие шаги обоих режимов ─────────────────────────────────────────────────

/** Тип смены в том виде, в каком он лежит в карте занятости. */
function mapLabel(type: ShiftType): string {
  return type === SHIFT.DAY ? "Day" : "Night"
}

/**
 * Проходит ли человек жёсткие ограничения слота.
 *
 * Вынесено из основного прохода, потому что те же правила спрашивает
 * инкрементальный пересбор: если бы списки разошлись, «минимальные правки»
 * начали бы ставить смены, которых полная пересборка не поставила бы.
 *
 * Максимум смен здесь намеренно не проверяется: в основном проходе за него
 * отвечает не отсев, а штраф `ABOVE_MAX_PENALTY` — иначе при нехватке
 * кандидатов слот остался бы пустым. Пересбор добавляет эту проверку у себя.
 */
function isEligibleForShift(
  user: IUser,
  userMap: Map<number, string>,
  shiftType: ShiftType,
  day: number,
  nightRest: number
): boolean {
  if (user.daysOffUsers.includes(day)) return false
  if (hasAbsenceMark(user, day)) return false
  // Занятость: и своя смена, и чужая — карта содержит обе.
  if (userMap.has(day)) return false
  if (user.shiftPreference === "only_day" && shiftType === SHIFT.NIGHT) return false
  if (user.shiftPreference === "only_night" && shiftType === SHIFT.DAY) return false

  // Отдых после ночи проверяется по всей истории, включая другие склады:
  // именно из-за этого раньше день вставал сразу после чужой ночи.
  if (
    shiftType === SHIFT.DAY &&
    hasRecentShift(userMap, day, nightRest, SHIFT.NIGHT)
  ) {
    return false
  }

  // И обратная сторона того же правила: ночь не ставим накануне уже
  // стоящего дня — своего, закреплённого или на другом складе.
  if (
    shiftType === SHIFT.NIGHT &&
    hasUpcomingShift(userMap, day, nightRest, SHIFT.DAY)
  ) {
    return false
  }

  return true
}

/**
 * Счёт кандидата на слот: приоритет, предпочтение, загрузка и качество серии.
 *
 * Функция общая для полной пересборки и пересбора с минимальными правками.
 * Пересбор добавляет к её результату свои надбавки за сохранение клетки, но
 * базовая часть обязана совпадать: иначе два режима выбирали бы разных людей
 * на один и тот же слот, и «перебрать» означало бы «переиграть всё».
 *
 * `totalAssignedSoFar` — сколько смен уже роздано к этому моменту; из него
 * считается справедливая доля человека. Значение одинаково для всех кандидатов
 * слота, поэтому считается вызывающим кодом один раз, а не внутри.
 */
function scoreCandidate(
  user: IUser,
  userMap: Map<number, string>,
  shiftType: ShiftType,
  day: number,
  daysInMonth: number,
  dayRest: number,
  totalAssignedSoFar: number,
  totalPriority: number,
  random: RandomSource,
  noise: number = SCORING_CONFIG.TIE_NOISE
): number {
  // Загрузка суммарная по всем складам — ради этого чужие смены и лежат в карте.
  const assignedCount = currentLoad(userMap)
  let score = 0

  score += user.priority * SCORING_CONFIG.PRIORITY_WEIGHT

  if (shiftType === user.shiftPreference.toLowerCase()) {
    score += SCORING_CONFIG.PREFERENCE_MATCH
  } else if (user.shiftPreference === "all") {
    score += SCORING_CONFIG.PREFERENCE_FLEXIBLE
  }

  const targetShifts = (user.priority / totalPriority) * totalAssignedSoFar
  const deviation = assignedCount - targetShifts

  if (assignedCount < user.minShiftsPerMonth) {
    score += SCORING_CONFIG.BELOW_MIN_BONUS
  } else if (assignedCount >= user.maxShiftsPerMonth) {
    score += SCORING_CONFIG.ABOVE_MAX_PENALTY
  } else {
    const fillRatio = assignedCount / user.maxShiftsPerMonth
    score -= Math.round(fillRatio * SCORING_CONFIG.FILL_RATIO_WEIGHT)
  }
  score -= Math.round(deviation * SCORING_CONFIG.DEVIATION_WEIGHT)

  score += calculateStreakScore(calculateStreak(userMap, day, shiftType))
  score += calculateBlockScore(userMap, day, shiftType)
  score += calculateChaosPenalty(userMap, day, shiftType)
  score += calculateFatigueScore(calculateFatigue(userMap, day))
  score += calculateLookAheadPenalty(userMap, day, shiftType, daysInMonth)
  score += calculateDayNightTransitionPenalty(userMap, day, shiftType, dayRest)

  // Небольшой шум разрывает детерминированные ничьи: без него ties
  // всегда решались бы в порядке массива, и одни и те же люди получали
  // бы первый выбор каждый раз. Величина задаётся вызывающим кодом: обычному
  // проходу нужен минимальный разброс, перестройке окна — заметный, иначе она
  // повторяет прежнее решение и поиск не сдвигается с места.
  score += random() * noise

  return score
}

/**
 * Раскладка текущего склада из готовой карты занятости.
 *
 * Чужие смены в результат не попадают: они уже сохранены другим складом, и
 * записать их сюда значило бы либо создать дубль, либо «украсть» их.
 *
 * Закрепление возвращается вместе со сменами: клиент сохраняет месяц целиком
 * и обязан сказать серверу, какие дни остаются неприкосновенными. Закреплён,
 * но пропал из раскладки день быть не может — оба режима такие дни не трогают,
 * — однако признак всё равно берётся из раскладки, а не из входных данных:
 * иначе список закреплённых разошёлся бы с самим графиком.
 */
function buildSchedule(
  assignedDays: Map<string, Map<number, string>>,
  users: IUser[],
  pinned: PinnedDays
): GenerationResult["schedule"] {
  const schedule: GenerationResult["schedule"] = {}

  users.forEach((user) => {
    const userMap = assignedDays.get(user.subject)!
    const dayShifts: number[] = []
    const nightShifts: number[] = []
    const pinnedDays: number[] = []

    userMap.forEach((shiftType, day) => {
      // Хвост предыдущего месяца нужен был только правилам: записать его в
      // график этого месяца значило бы либо создать дубль, либо перенести
      // чужую историю.
      if (day < 1) return
      if (!isOwnShift(user, day)) return
      if (shiftType.toLowerCase() === SHIFT.DAY) dayShifts.push(day)
      else nightShifts.push(day)
      if (isPinned(pinned, user.subject, day)) pinnedDays.push(day)
    })

    schedule[user.subject] = { dayShifts, nightShifts, pinnedDays }
  })

  return schedule
}

/**
 * Собирает публичный результат из готовой карты занятости.
 *
 * Одной функцией на все случаи: и жадный проход, и пересбор, и поиск после
 * перестройки окна отдают карту, а раскладку, недобор и излишек по ней считает
 * этот код. Разные способы собрать одно и то же разошлись бы — например,
 * поиск забыл бы пересчитать недобор после того, как снял смену.
 */
function resultFromAssignment(
  assignedDays: Assignment,
  users: IUser[],
  pinned: PinnedDays,
  settings: GeneratorSettings,
  eligible: { day: number; night: number },
  changes: ScheduleChange[] = []
): RawResult {
  const { dayCount, nightCount, daysInMonth, frozenThroughDay } = settings

  return {
    schedule: buildSchedule(assignedDays, users, pinned),
    unfilledSlots: collectUnfilledSlots(
      assignedDays,
      users,
      dayCount,
      nightCount,
      daysInMonth,
      frozenThroughDay
    ),
    excessSlots: collectExcessSlots(
      assignedDays,
      users,
      dayCount,
      nightCount,
      daysInMonth,
      frozenThroughDay
    ),
    eligible,
    changes,
  }
}

// ─── Основная функция ─────────────────────────────────────────────────────────

function buildOnce(
  rawUsers: IUser[],
  settings: GeneratorSettings,
  random: RandomSource
): Built {
  // Порядок состава приходит из базы и после перезагрузки страницы может быть
  // другим. Алгоритм раздаёт смены, обходя работников по очереди, и случайный
  // шум достаётся им в том же порядке: без сортировки тот же склад дал бы
  // другой график — ровно то, от чего мы уходим.
  const users = [...rawUsers].sort((a, b) => a.subject.localeCompare(b.subject))

  const {
    dayCount,
    nightCount,
    afterNightDayOffs: rawNightRest,
    afterDayDayOffs: rawDayRest,
    daysInMonth,
    frozenThroughDay,
  } = settings

  // Правило «после ночи не день» и обратное «после дня не ночь» действуют
  // всегда. Ноль в настройке означает «без дополнительных дней отдыха», а не
  // «можно поставить день сразу после ночи»: раньше ноль отключал проверку
  // целиком, потому что окно становилось пустым.
  const nightRest = Math.max(1, rawNightRest)
  const dayRest = Math.max(1, rawDayRest)

  const eligible = {
    day: users.filter((u) => u.shiftPreference !== "only_night").length,
    night: users.filter((u) => u.shiftPreference !== "only_day").length,
  }
  if (!users.length) {
    return {
      assignedDays: new Map(),
      result: {
        schedule: {},
        unfilledSlots: [],
        excessSlots: [],
        eligible,
        changes: [],
      },
    }
  }

  // ── Карта занятости ────────────────────────────────────────────────────────
  //
  // Ключ — ссылка на участника (`e61` / `w3`), а не числовой id: номера
  // зарегистрированного и нерeгистрированного могут совпадать.
  //
  // В карту сразу кладутся смены с других складов. Без этого алгоритм считал
  // бы человека свободным, не видел бы серий и ставил бы день сразу после
  // ночи, отработанной на другом складе.
  //
  // Туда же кладутся закреплённые смены этого склада: они уже стоят в базе,
  // и алгоритм обязан видеть в них и занятость человека, и покрытие слота.
  // Без этого он поставил бы в закреплённый день второго человека и сделал бы
  // смену двойной.
  const pinned: PinnedDays = new Map(
    users.map((user) => [user.subject, new Set(user.pinnedDays)])
  )

  const assignedDays = new Map<string, Map<number, string>>()
  users.forEach((user) => {
    const map = new Map<number, string>()
    for (const [rawDay, shift] of Object.entries(user.externalShifts)) {
      const day = Number(rawDay)
      if (day >= 1 && day <= daysInMonth) {
        map.set(day, shift.shiftType === SHIFT.DAY ? "Day" : "Night")
      }
    }
    // Хвост предыдущего месяца кладётся в ту же карту и с теми же значениями,
    // что смены этого месяца: дни 0, -1, … — это 31-е, 30-е и так далее.
    // Отдельного набора правил для стыка месяцев не нужно, потому что все
    // проверки вычитают из числа дня: «после ночи не день» на первом числе
    // смотрит ровно в день 0.
    for (const shift of user.previousShifts) {
      map.set(
        shift.day,
        shift.shiftType === SHIFT.DAY ? "Day" : "Night"
      )
    }

    // Чужой склад приоритетнее: если день занят там, он не наш, даже если в
    // здешнем графике осталась старая закреплённая строка.
    //
    // Прошедшие дни сохраняются так же, как закреплённые: они уже стоят в базе,
    // и пересборка месяца не должна их терять — иначе график начала месяца
    // обнулился бы при первом же нажатии на кнопку.
    for (const [day, type] of localShifts(user, daysInMonth)) {
      const kept = isPinned(pinned, user.subject, day) || day <= frozenThroughDay
      if (!kept) continue
      if (!map.has(day)) map.set(day, type)
    }
    assignedDays.set(user.subject, map)
  })

  // ── Очередь слотов: день, ночь, день, ночь… ────────────────────────────────
  const shifts: ShiftSlot[] = Array.from({ length: daysInMonth * 2 }, (_, i) => ({
    type: i % 2 === 0 ? "Day" : "Night",
    day: Math.floor(i / 2) + 1,
  }))

  const totalPriority = users.reduce((sum, u) => sum + u.priority, 0)

  // ── Основной жадный проход ─────────────────────────────────────────────────
  shifts.forEach((shift) => {
    const shiftType = shift.type.toLowerCase() as ShiftType

    // Прошедшие дни не планируются вовсе: в них либо уже стоят смены (они
    // сохранены выше), либо день прошёл, и ставить туда человека задним числом
    // нельзя. Предупреждать о нехватке в них тоже не о чем.
    if (shift.day <= frozenThroughDay) return

    // Вынесено из цикла по людям: значение одинаково для всех кандидатов слота.
    const totalAssignedSoFar = users.reduce(
      (sum, u) => sum + currentLoad(assignedDays.get(u.subject)!),
      0
    )

    const scoredUsers: ScoredUser[] = users
      .filter((user) =>
        isEligibleForShift(
          user,
          assignedDays.get(user.subject)!,
          shiftType,
          shift.day,
          nightRest
        )
      )
      .map((user) => ({
        subject: user.subject,
        score: scoreCandidate(
          user,
          assignedDays.get(user.subject)!,
          shiftType,
          shift.day,
          daysInMonth,
          dayRest,
          totalAssignedSoFar,
          totalPriority,
          random
        ),
      }))
      .sort((a, b) => b.score - a.score)

    const neededCount = shiftType === SHIFT.DAY ? dayCount : nightCount
    // Закреплённые смены этого дня уже закрывают часть нормы: без вычитания
    // алгоритм поставил бы сюда ещё людей и сделал бы смену двойной, хотя
    // менеджер поставил в ней ровно одного человека.
    const alreadyFilled = localCoverage(assignedDays, users, shift.day, shiftType)
    const remaining = Math.max(0, neededCount - alreadyFilled)

    scoredUsers.slice(0, remaining).forEach(({ subject }) => {
      assignedDays.get(subject)!.set(shift.day, shift.type)
    })
  })

  // ── Пост-обработка ─────────────────────────────────────────────────────────
  const slotCapacity = (day: number, type: ShiftType) =>
    type === SHIFT.DAY ? dayCount : nightCount

  runOptimizationPass(
    assignedDays,
    users,
    daysInMonth,
    slotCapacity,
    nightRest,
    dayRest,
    frozenThroughDay
  )
  runFairnessPass(
    assignedDays,
    users,
    daysInMonth,
    nightRest,
    dayRest,
    pinned,
    frozenThroughDay,
    random
  )

  // ── Раскладка текущего склада ──────────────────────────────────────────────
  //
  // Полная пересборка правок не перечисляет: она меняет месяц целиком, и
  // список из сотни строк ничего не объяснил бы. Отчёт заполняет только
  // `repairSchedule` — там он и нужен.
  return {
    assignedDays,
    result: resultFromAssignment(assignedDays, users, pinned, settings, eligible),
  }
}

// ─── Пересбор с минимальными правками ────────────────────────────────────────

/**
 * Текущий график склада: ключ участника → «день месяца → тип смены».
 *
 * Нужен дважды: как источник «что было» для отчёта о правках и как карта
 * близости — человеку выгоднее вернуть смену туда, где он уже стоял, чем
 * получить новую клетку в чужом месте месяца.
 */
type Draft = Map<string, Map<number, ShiftType>>

function draftOf(users: IUser[], daysInMonth: number): Draft {
  const draft: Draft = new Map()

  for (const user of users) {
    const own = new Map<number, ShiftType>()
    for (const day of user.dayShifts) {
      if (day >= 1 && day <= daysInMonth) own.set(day, SHIFT.DAY)
    }
    for (const day of user.nightShifts) {
      if (day >= 1 && day <= daysInMonth) own.set(day, SHIFT.NIGHT)
    }
    draft.set(user.subject, own)
  }

  return draft
}

/**
 * Насколько выгодно закрыть дырку именно этим человеком, если считать главной
 * ценностью то, что график остаётся узнаваемым.
 *
 * Надбавка одна: человек уже работает в соседние дни. Тогда новая смена
 * встаёт в его серию, а не одиночкой посреди месяца, — и по качеству графика,
 * и по числу правок это лучше, чем отдать день тому, у кого рядом ничего нет.
 *
 * Надбавки за «вернуть смену на прежнее место» здесь нет: смену снимает только
 * нарушение правила, а правило после снятия продолжает действовать — человек
 * с ночью 5-го не годится на день 6-го, и обратно его не поставят. Ветка была
 * бы мёртвой, а мёртвую ветку нечем проверить.
 */
function repairBonus(draft: Draft, subject: string, day: number): number {
  const own = draft.get(subject)
  if (!own) return 0

  for (const delta of [1, -1, 2, -2]) {
    if (own.has(day + delta)) return SCORING_CONFIG.REPAIR_NEAR_BONUS
  }

  return 0
}

/**
 * Пересобирает месяц, отталкиваясь от текущего графика, а не от пустого листа.
 *
 * Зачем это нужно. Полная пересборка (`generateSchedule`) выбрасывает всё, чего
 * менеджер не закрепил руками, и раздаёт смены заново. Если поправить одного
 * работника — например, убрать ему смену или отправить в отпуск, — поедет весь
 * месяц: у остальных смены перетасуются, хотя причин для этого не было. Здесь
 * наоборот: текущая раскладка считается правильной, и алгоритм трогает только
 * то, что ей мешает.
 *
 * Порядок работы:
 *
 *   1. якоря — закреплённые менеджером дни, прошедшие числа и строки целиком
 *      замороженных работников не двигаются вовсе;
 *   2. снятие нарушений — смены, которые нарушают жёсткие правила (отметка
 *      дня, предпочтение, отдых после ночи, месячный максимум), снимаются;
 *   3. добор покрытия — освободившиеся и недозакрытые слоты закрываются
 *      лучшими кандидатами, при прочих равных — теми, кто работает рядом;
 *   4. отчёт — что именно изменилось, чтобы пересбор не выглядел перетасовкой.
 *
 * Чего здесь нет намеренно: `runOptimizationPass` и `runFairnessPass` из полной
 * пересборки. Оба улучшают график за счёт перестановок, а перестановка — это и
 * есть правка. Смена здесь уходит с насиженного места, только если иначе слот
 * не закрыть или правило не выполнить.
 *
 * На пустом графике режим смысла не имеет: сохранять нечего, и получится добор
 * покрытия без выравнивания и без достройки серий. Интерфейс в этом случае
 * предлагает полную пересборку, а не перебор.
 */
function repairOnce(
  rawUsers: IUser[],
  settings: GeneratorSettings,
  random: RandomSource,
  frozen: Set<string>
): Built {
  // Сортировка — та же причина, что и в построении: результат не должен
  // зависеть от того, в каком порядке база вернула состав.
  const users = [...rawUsers].sort((a, b) => a.subject.localeCompare(b.subject))

  const {
    dayCount,
    nightCount,
    afterNightDayOffs: rawNightRest,
    afterDayDayOffs: rawDayRest,
    daysInMonth,
    frozenThroughDay,
  } = settings

  const nightRest = Math.max(1, rawNightRest)
  const dayRest = Math.max(1, rawDayRest)

  const eligible = {
    day: users.filter((u) => u.shiftPreference !== "only_night").length,
    night: users.filter((u) => u.shiftPreference !== "only_day").length,
  }

  const draft = draftOf(users, daysInMonth)

  if (!users.length) {
    return {
      assignedDays: new Map(),
      result: {
        schedule: {},
        unfilledSlots: [],
        excessSlots: [],
        eligible,
        changes: [],
      },
    }
  }

  const pinned: PinnedDays = new Map(
    users.map((user) => [user.subject, new Set(user.pinnedDays)])
  )

  // Якорь — клетка, которую пересбор не имеет права ни снять, ни перенести.
  // Прошедшие дни здесь по той же причине, что и в полной пересборке: человек
  // уже отработал, и задним числом график не переписывается.
  const isAnchored = (subject: string, day: number) =>
    frozen.has(subject) || isPinned(pinned, subject, day) || day <= frozenThroughDay

  // ── Карта занятости: текущий график целиком ────────────────────────────────
  //
  // Отличие от полной пересборки ровно в одном: свои смены кладутся в карту
  // все, а не только закреплённые и прошедшие. Это и есть та раскладка, от
  // которой считается минимальность правок.
  const assignedDays = new Map<string, Map<number, string>>()
  users.forEach((user) => {
    const map = new Map<number, string>()
    for (const [rawDay, shift] of Object.entries(user.externalShifts)) {
      const day = Number(rawDay)
      if (day >= 1 && day <= daysInMonth) {
        map.set(day, mapLabel(shift.shiftType))
      }
    }
    // Хвост предыдущего месяца кладётся в ту же карту и с теми же значениями,
    // что смены этого месяца: дни 0, -1, … — это 31-е, 30-е и так далее.
    for (const shift of user.previousShifts) {
      map.set(shift.day, mapLabel(shift.shiftType))
    }
    // Чужой склад приоритетнее: если день занят там, он не наш, даже если в
    // здешнем графике осталась старая строка.
    for (const [day, type] of draft.get(user.subject)!) {
      if (!map.has(day)) map.set(day, mapLabel(type))
    }
    assignedDays.set(user.subject, map)
  })

  /**
   * Можно ли вообще снять эту смену: своя, стоит в карте и не якорь.
   *
   * Якорь — закрепление менеджера, прошедший день или замороженная строка:
   * такие смены пересбор не трогает, даже если они нарушают правило.
   */
  const removableAt = (
    user: IUser,
    userMap: Map<number, string>,
    day: number
  ): boolean =>
    isOwnShift(user, day) && userMap.has(day) && !isAnchored(user.subject, day)

  // ── Шаг 1: снять смены, которые нарушают правила ───────────────────────────
  //
  // Набор правил тот же, что у отсева в полной пересборке (`isEligibleForShift`),
  // только вывернутый наизнанку: там вопрос «можно ли поставить», здесь — «можно
  // ли оставить». Список обязан совпадать, иначе пересбор оставлял бы смены,
  // которых полная пересборка не поставила бы.
  //
  // Переход «день → ночь» сюда намеренно не входит: в полной пересборке он
  // мягкий (`DAY_NIGHT_TRANSITION_PENALTY`), а не запрет — при нехватке людей
  // жёсткий запрет оставлял бы ночные слоты пустыми. Снимать за него уже
  // поставленную смену значило бы чинить то, что алгоритм считает допустимым.
  //
  // Разбор идёт двумя свипами, и это принципиально. Правило звучит как «после
  // ночи не день», и виноват в нём всегда день: именно его не поставили бы.
  // Проверка «ночь накануне дня» в полной пересборке существует только для
  // дней, которые уже стоят, — закреплённых, прошедших и чужих. Если же
  // разбирать конфликт вперемешку по возрастанию дней, ночь 1-го попадётся
  // раньше дня 2-го, и пересбор снимет ночь: отменит уже согласованную смену
  // вместо только что поставленной и оставит дырку в ночном слоте.
  //
  // Проход повторяется до устойчивого состояния: снятие одной смены может
  // снять нарушение у соседней, но может и создать новое — например, разорвав
  // серию так, что оставшаяся смена оказалась в середине. Каждый повтор снимает
  // хотя бы одну смену, а карта конечна, поэтому цикл завершается.
  //
  // Якорь всегда побеждает: если закреплённая ночь 5-го конфликтует с рабочей
  // днём 6-го, уходит день, а не закрепление.
  let removed = true
  while (removed) {
    removed = false

    for (const user of users) {
      const userMap = assignedDays.get(user.subject)!

      for (let day = 1; day <= daysInMonth; day++) {
        if (!removableAt(user, userMap, day)) continue

        const type = normalizeShift(userMap.get(day))
        if (!type) continue

        const forbidden =
          user.daysOffUsers.includes(day) ||
          hasAbsenceMark(user, day) ||
          (user.shiftPreference === "only_day" && type === SHIFT.NIGHT) ||
          (user.shiftPreference === "only_night" && type === SHIFT.DAY) ||
          (type === SHIFT.DAY &&
            hasRecentShift(userMap, day, nightRest, SHIFT.NIGHT))

        if (!forbidden) continue

        userMap.delete(day)
        removed = true
      }
    }

    // Второй свип: ночь накануне дня. Сюда доживают только те дни, которые
    // смену не отдают, — закреплённые, прошедшие и чужие: день, поставленный
    // в этом же пересборе, уже снят выше.
    for (const user of users) {
      const userMap = assignedDays.get(user.subject)!

      for (let day = 1; day <= daysInMonth; day++) {
        if (!removableAt(user, userMap, day)) continue
        if (normalizeShift(userMap.get(day)) !== SHIFT.NIGHT) continue
        if (!hasUpcomingShift(userMap, day, nightRest, SHIFT.DAY)) continue

        userMap.delete(day)
        removed = true
      }
    }
  }

  // ── Шаг 2: снять лишнее сверх месячного максимума ──────────────────────────
  //
  // Полная пересборка такого не создаёт, но ручная правка или прошлый прогон
  // могли оставить: в отсеве основного прохода максимум не проверяется — там за
  // него отвечает штраф, чтобы при нехватке кандидатов слот всё-таки закрылся.
  // В пересборе это жёсткий предел: лучше честно показать недокрытие, чем
  // добить человека сверх договорённости.
  //
  // Первыми уходят смены из середины серии: снятие крайней укорачивает серию, а
  // снятие средней рвёт её на две — то есть создаёт ровно тот дефект, ради
  // которого существует выравнивание.
  for (const user of users) {
    const userMap = assignedDays.get(user.subject)!

    while (currentLoad(userMap) > user.maxShiftsPerMonth) {
      const removable = [...userMap.keys()]
        .filter((day) => day >= 1 && day <= daysInMonth)
        .filter((day) => isOwnShift(user, day))
        .filter((day) => !isAnchored(user.subject, day))
        .sort(
          (a, b) =>
            Number(isMidBlock(userMap, a)) - Number(isMidBlock(userMap, b)) ||
            b - a
        )

      // Снимать нечего: максимум превышен чужими сменами, а ими распоряжается
      // другой склад. Это не наша правка, и починить её отсюда нельзя.
      const [victim] = removable
      if (victim === undefined) break
      userMap.delete(victim)
    }
  }

  // Очередь слотов: день, ночь, день, ночь… — общая для снятия излишка и
  // добора недокрытия.
  const shifts: ShiftSlot[] = Array.from({ length: daysInMonth * 2 }, (_, i) => ({
    type: i % 2 === 0 ? "Day" : "Night",
    day: Math.floor(i / 2) + 1,
  }))

  // ── Шаг 3: снять лишних из переполненных слотов ────────────────────────────
  //
  // Норма — «ровно столько, сколько задано», а не «хотя бы». Полная пересборка
  // этот вопрос не поднимает: она ставит людей ровно по норме. А после ручной
  // правки переполнение появляется легко — менеджер перенёс человека на другой
  // день, и новый день стал с лишним, тогда как старый опустел. Добор покрытия
  // лечит только вторую половину, и день с пятью людьми при норме четыре так и
  // оставался бы переполненным.
  //
  // Снимаются только незаякоренные смены: закреплённая — решение менеджера, и
  // выбросить её молча нельзя. Если весь излишек закреплён, он остаётся, а слот
  // попадает в `excessSlots` — об этом интерфейс предупреждает.
  //
  // Порядок «сначала снять, потом добрать» не случаен: снятый человек сразу
  // становится кандидатом на недокрытый день, и перенос выглядит как перенос, а
  // не как «у этого убрали, тому добавили».
  for (const shift of shifts) {
    const shiftType = shift.type.toLowerCase() as ShiftType
    const neededCount = shiftType === SHIFT.DAY ? dayCount : nightCount

    while (
      localCoverage(assignedDays, users, shift.day, shiftType) > neededCount
    ) {
      const candidates = users
        .filter((user) => {
          const userMap = assignedDays.get(user.subject)!
          if (!removableAt(user, userMap, shift.day)) return false
          return normalizeShift(userMap.get(shift.day)) === shiftType
        })
        .sort((a, b) => {
          const mapA = assignedDays.get(a.subject)!
          const mapB = assignedDays.get(b.subject)!

          // Порядок предпочтений при выборе, кого снять:
          //   1. того, кто и без этой смены остаётся при своём минимуме;
          //   2. того, у кого смена не в середине серии: снятие средней рвёт
          //      серию на две, снятие крайней просто укорачивает её;
          //   3. самого загруженного — он и есть лишний в этом дне;
          //   4. и только затем по ссылке, чтобы результат не зависел от
          //      порядка состава в списке.
          return (
            Number(currentLoad(mapA) - 1 < a.minShiftsPerMonth) -
              Number(currentLoad(mapB) - 1 < b.minShiftsPerMonth) ||
            Number(isMidBlock(mapA, shift.day)) -
              Number(isMidBlock(mapB, shift.day)) ||
            currentLoad(mapB) - currentLoad(mapA) ||
            a.subject.localeCompare(b.subject)
          )
        })

      const [victim] = candidates
      if (!victim) break
      assignedDays.get(victim.subject)!.delete(shift.day)
    }
  }

  // ── Шаг 4: закрыть недобор по слотам ───────────────────────────────────────
  const totalPriority = users.reduce((sum, u) => sum + u.priority, 0)

  shifts.forEach((shift) => {
    const shiftType = shift.type.toLowerCase() as ShiftType

    // Прошедшие дни не планируются — так же, как в полной пересборке.
    if (shift.day <= frozenThroughDay) return

    const neededCount = shiftType === SHIFT.DAY ? dayCount : nightCount
    const alreadyFilled = localCoverage(assignedDays, users, shift.day, shiftType)
    const remaining = Math.max(0, neededCount - alreadyFilled)

    // Слот закрыт — сюда не добавляется никто. Это и есть «минимальные правки»:
    // укомплектованный слот в этом режиме не пересматривается вовсе, даже если
    // другого человека он устроил бы больше.
    if (!remaining) return

    // Значение одинаково для всех кандидатов слота — считается один раз.
    const totalAssignedSoFar = users.reduce(
      (sum, u) => sum + currentLoad(assignedDays.get(u.subject)!),
      0
    )

    const scored = users
      .filter((user) => {
        const userMap = assignedDays.get(user.subject)!
        // Замороженную строку не дополняем: пустой день в ней значит «здесь его
        // быть не должно». Дыру закроет кто-то другой.
        if (frozen.has(user.subject)) return false
        if (!isEligibleForShift(user, userMap, shiftType, shift.day, nightRest)) {
          return false
        }
        // Дополнительно к общим правилам: не добивать сверх максимума.
        return currentLoad(userMap) < user.maxShiftsPerMonth
      })
      .map((user) => ({
        subject: user.subject,
        score:
          scoreCandidate(
            user,
            assignedDays.get(user.subject)!,
            shiftType,
            shift.day,
            daysInMonth,
            dayRest,
            totalAssignedSoFar,
            totalPriority,
            random
          ) + repairBonus(draft, user.subject, shift.day),
      }))
      .sort((a, b) => b.score - a.score)

    scored.slice(0, remaining).forEach(({ subject }) => {
      assignedDays.get(subject)!.set(shift.day, shift.type)
    })
  })

  // ── Шаг 4: отчёт о правках ─────────────────────────────────────────────────
  //
  // Сравнивается вход и выход. Показывать «что стало» бесполезно: менеджер
  // помнит свой график и хочет знать, что алгоритм тронул, а что оставил.
  const changes: ScheduleChange[] = []
  for (const user of users) {
    const userMap = assignedDays.get(user.subject)!
    const own = draft.get(user.subject)!

    for (let day = 1; day <= daysInMonth; day++) {
      if (!isOwnShift(user, day)) continue

      const before = own.get(day) ?? null
      const after = normalizeShift(userMap.get(day))
      if (before === after) continue

      changes.push({ subject: user.subject, day, from: before, to: after })
    }
  }

  return {
    assignedDays,
    result: resultFromAssignment(
      assignedDays,
      users,
      pinned,
      settings,
      eligible,
      changes
    ),
  }
}

// ─── Поиск по целевой функции ─────────────────────────────────────────────────

/**
 * Карта занятости в том виде, с которым работает поиск.
 *
 * Тот же тип, что у основных проходов: поиск не заводит собственного
 * представления раскладки, иначе пришлось бы держать в согласии два.
 */
type Assignment = Map<string, Map<number, string>>

/**
 * Сколько окон перестраивает поиск — в расчёте на одного работника.
 *
 * Бюджет задан числом попыток, а не временем: результат обязан быть
 * воспроизводимым, а «сколько успеем за секунду» зависит от машины и меняло бы
 * график от запуска к запуску.
 *
 * Зависит от размера склада, потому что вместе с ним растёт и пространство
 * вариантов. Замер (реальный склад на 10 человек, норма 2+2, и он же, утроенный
 * до 30 человек, норма 4+4), среднее по зёрнам:
 *
 *   склад 10:  старт 448 → 80 перестроек дают 417, 320 — те же 416;
 *   склад 30:  старт 1870 → 160 дают 1619, 320 — 1581, 640 — 1561.
 *
 * То есть на маленьком складе выигрыш выбирается к сотне попыток, а на большом
 * продолжает набираться и после трёхсот. Шесть попыток на человека дают ровно
 * этот порядок: 60 на десяти и 180 на тридцати.
 */
const SEARCH_ITERATIONS_PER_PERSON = 6

/**
 * Потолок бюджета поиска.
 *
 * Нужен не для качества, а для предсказуемости: склад на двести человек иначе
 * заставил бы ждать ответа секунды, а выигрыш там уже неразличим на глаз.
 */
const MAX_SEARCH_ITERATIONS = 320

function searchBudget(people: number): number {
  return Math.min(MAX_SEARCH_ITERATIONS, SEARCH_ITERATIONS_PER_PERSON * people)
}

/** Приводит карту занятости к виду, который понимает оценщик. */
function toEvaluatedSchedule(
  assignedDays: Assignment,
  users: IUser[],
  daysInMonth: number
): EvaluatedSchedule {
  const schedule: EvaluatedSchedule = {}

  for (const user of users) {
    const dayShifts: number[] = []
    const nightShifts: number[] = []

    assignedDays.get(user.subject)!.forEach((type, day) => {
      if (day < 1 || day > daysInMonth) return
      if (!isOwnShift(user, day)) return
      if (normalizeShift(type) === SHIFT.DAY) dayShifts.push(day)
      else nightShifts.push(day)
    })

    schedule[user.subject] = {
      dayShifts: dayShifts.sort((a, b) => a - b),
      nightShifts: nightShifts.sort((a, b) => a - b),
    }
  }

  return schedule
}

function cloneAssignment(assignedDays: Assignment): Assignment {
  const copy: Assignment = new Map()
  assignedDays.forEach((map, subject) => copy.set(subject, new Map(map)))
  return copy
}

/**
 * Окно перестройки: сколько дней подряд поиск сносит и собирает заново.
 *
 * Длина 2–5 дней. Короче — поиск топчется: перестановка одной смены почти всегда
 * ухудшает оценку, потому что трогает локальную картину, но не даёт достаточной
 * свободы, чтобы собрать серию. Длиннее — рушит больше, чем успевает собрать, и
 * почти каждая попытка отвергается.
 *
 * Прошедшие дни в окно не попадают никогда: там история, и переставлять её
 * задним числом нельзя.
 */
function pickSearchWindow(
  settings: GeneratorSettings,
  random: RandomSource
): { from: number; to: number } | null {
  const { daysInMonth, frozenThroughDay } = settings
  const first = frozenThroughDay + 1
  if (first > daysInMonth) return null

  const span = 2 + Math.floor(random() * 4)
  const from = first + Math.floor(random() * (daysInMonth - first + 1))

  return { from, to: Math.min(daysInMonth, from + span - 1) }
}

/**
 * Снимает подвижные смены окна и возвращает снимок снятого.
 *
 * Одна функция и на разрушение, и на откат: откат — это снять то, что поставила
 * неудачная попытка, и вернуть снимок. Отдельная «восстановить» рано или поздно
 * разошлась бы с «снести» — например, забыла бы про смены, добавленные не тем
 * человеком.
 */
function takeWindowCells(
  assignedDays: Assignment,
  users: IUser[],
  window: { from: number; to: number },
  isAnchored: (subject: string, day: number) => boolean
): { subject: string; day: number; type: string }[] {
  const cells: { subject: string; day: number; type: string }[] = []

  for (const user of users) {
    const map = assignedDays.get(user.subject)!

    for (let day = window.from; day <= window.to; day++) {
      if (!map.has(day)) continue
      if (!isOwnShift(user, day)) continue
      if (isAnchored(user.subject, day)) continue

      cells.push({ subject: user.subject, day, type: map.get(day)! })
      map.delete(day)
    }
  }

  return cells
}

/**
 * Собирает окно заново — теми же правилами, что и основной проход.
 *
 * Порядок «день за днём, день раньше ночи» тот же: правила отдыха смотрят и
 * вперёд, и назад, поэтому порядок разбора влияет на результат. Считать окно
 * иначе значило бы получить раскладку, которую основной проход никогда бы не
 * построил.
 */
function rebuildWindow(
  assignedDays: Assignment,
  users: IUser[],
  settings: GeneratorSettings,
  window: { from: number; to: number },
  random: RandomSource
): void {
  const {
    dayCount,
    nightCount,
    afterNightDayOffs: rawNightRest,
    afterDayDayOffs: rawDayRest,
    daysInMonth,
    frozenThroughDay,
  } = settings

  const nightRest = Math.max(1, rawNightRest)
  const dayRest = Math.max(1, rawDayRest)
  const totalPriority = users.reduce((sum, u) => sum + u.priority, 0)

  for (let day = window.from; day <= window.to; day++) {
    if (day <= frozenThroughDay) continue

    for (const type of [SHIFT.DAY, SHIFT.NIGHT] as ShiftType[]) {
      const needed = type === SHIFT.DAY ? dayCount : nightCount
      const remaining = needed - localCoverage(assignedDays, users, day, type)
      if (remaining <= 0) continue

      const totalAssignedSoFar = users.reduce(
        (sum, u) => sum + currentLoad(assignedDays.get(u.subject)!),
        0
      )

      const scored = users
        .filter((user) => {
          const userMap = assignedDays.get(user.subject)!
          if (!isEligibleForShift(user, userMap, type, day, nightRest)) {
            return false
          }
          // Максимум — жёсткий предел, как и в пересборе: поиск не добивает
          // человека сверх договорённости ради красивой оценки.
          return currentLoad(userMap) < user.maxShiftsPerMonth
        })
        .map((user) => ({
          subject: user.subject,
          score: scoreCandidate(
            user,
            assignedDays.get(user.subject)!,
            type,
            day,
            daysInMonth,
            dayRest,
            totalAssignedSoFar,
            totalPriority,
            random,
            SCORING_CONFIG.SEARCH_NOISE
          ),
        }))
        .sort((a, b) => b.score - a.score)

      scored.slice(0, remaining).forEach(({ subject }) => {
        assignedDays.get(subject)!.set(day, mapLabel(type))
      })
    }
  }
}

interface SearchOutcome {
  assignedDays: Assignment
  evaluation: ScheduleEvaluation
  /** Сколько перестроек поиск принял — для отчёта. */
  accepted: number
}

/**
 * Улучшает готовую раскладку, перестраивая окна и сверяясь с оценкой.
 *
 * Как это работает. Раскладка уже собрана жадным проходом, то есть допустима по
 * всем жёстким правилам, но не оптимальна: проход решал каждый слот по
 * отдельности и не мог, например, разменять две смены между людьми, чтобы у
 * обоих получилась серия. Поиск берёт окно в несколько дней, сносит в нём всё
 * подвижное, собирает заново и сравнивает **весь месяц** по целевой функции
 * (`evaluateSchedule`). Стало не хуже — оставляем, стало хуже — откатываем
 * снимок.
 *
 * Поэтому поиск не может испортить график: он принимает только те ходы, которые
 * не увеличивают оценку, и отдельно хранит лучшую встреченную раскладку. Ходы с
 * равной оценкой тоже принимаются — иначе поиск застревал бы на первом же плато,
 * где любая одиночная перестановка ничего не меняет.
 *
 * Якоря — закрепления и прошедшие дни — не сносятся и не переставляются: это
 * решения менеджера и история, а не материал для поиска.
 */
function improveSchedule(
  start: Assignment,
  users: IUser[],
  settings: GeneratorSettings,
  random: RandomSource,
  isAnchored: (subject: string, day: number) => boolean,
  iterations: number
): SearchOutcome {
  const work = cloneAssignment(start)
  let current = evaluateSchedule(
    toEvaluatedSchedule(work, users, settings.daysInMonth),
    users,
    settings
  )

  const best = cloneAssignment(work)
  let bestEvaluation = current
  let accepted = 0

  for (let i = 0; i < iterations; i++) {
    const window = pickSearchWindow(settings, random)
    if (!window) break

    const snapshot = takeWindowCells(work, users, window, isAnchored)
    // В окне нечего двигать: там только чужие смены и закрепления.
    if (!snapshot.length) continue

    rebuildWindow(work, users, settings, window, random)

    const candidate = evaluateSchedule(
      toEvaluatedSchedule(work, users, settings.daysInMonth),
      users,
      settings
    )

    if (candidate.cost <= current.cost) {
      current = candidate
      accepted++

      if (candidate.cost < bestEvaluation.cost) {
        bestEvaluation = candidate
        best.clear()
        work.forEach((map, subject) => best.set(subject, new Map(map)))
      }
    } else {
      // Откат: снять то, что поставила неудачная попытка, и вернуть снимок.
      takeWindowCells(work, users, window, isAnchored)
      for (const cell of snapshot) {
        work.get(cell.subject)!.set(cell.day, cell.type)
      }
    }
  }

  return { assignedDays: best, evaluation: bestEvaluation, accepted }
}

// ─── Зерно из данных ──────────────────────────────────────────────────────────

/**
 * Зерно случайности, выведенное из самих данных.
 *
 * Зачем. Кнопка «Построить график» должна быть предсказуемой: если при одних и
 * тех же складе, месяце, составе и настройках смены после каждого нажатия
 * встают по-новому, согласовать график невозможно — менеджер не отличит
 * собственную правку от очередного броска. Поэтому случайность не берётся из
 * воздуха, а выводится из входа: одинаковый вход — одинаковое зерно —
 * одинаковый месяц.
 *
 * ─── Что именно входит в зерно ───────────────────────────────────────────────
 *
 * Ровно то, что читает сам проход, и ничего сверх. Это не придирка, а условие
 * работоспособности: результат построения записывается обратно в состав
 * (`applySchedule` заменяет `dayShifts` и `nightShifts`), и если эти поля входят
 * в зерно, то после первого нажатия вход меняется — значит, меняется зерно, — и
 * следующий прогон строит **другой** месяц. Так график прыгал бы вечно и не
 * сходился ни на одном варианте.
 *
 * Полная пересборка смены этого склада не читает: она их выбрасывает и раздаёт
 * заново. Читает она только закреплённые дни и прошедшие числа — они и попадают
 * в зерно (`includeCurrentShifts: false`). Пересбор с минимальными правками,
 * наоборот, отталкивается от текущей раскладки — для него она вход
 * (`includeCurrentShifts: true`).
 *
 * Остальное в зерне: настройки нормы и отдыха, граница прошедших дней и по
 * каждому работнику — сила, предпочтение, минимум и максимум смен, выходные,
 * отметки, чужие смены, хвост прошлого месяца. Имя, должность и заметка не
 * входят: они на раскладку не влияют, и правка заметки не должна перетасовывать
 * месяц.
 *
 * Порядок имеет значение, поэтому всё сортируется: состав приходит из базы, и
 * после перезагрузки страницы тот же склад может прийти в другом порядке.
 * Без сортировки график прыгал бы от одной загрузки к другой.
 */
function seedOf(
  users: IUser[],
  settings: GeneratorSettings,
  options: {
    frozen?: Iterable<string>
    /** Считать текущие смены склада входом (пересбор) или прошлым прогоном. */
    includeCurrentShifts?: boolean
  } = {}
): number {
  const { frozen = [], includeCurrentShifts = false } = options
  const days = (values: number[]) => [...values].sort((a, b) => a - b).join(",")

  // В полной пересборке смены этого склада — не вход, а след прошлого прогона:
  // алгоритм их выбрасывает. Читает он только закреплённое и прошедшее, поэтому
  // ровно эти дни и влияют на зерно.
  const ownDays = (values: number[], pinned: number[]) =>
    days(
      includeCurrentShifts
        ? values
        : values.filter(
            (day) => day <= settings.frozenThroughDay || pinned.includes(day)
          )
    )

  const parts: string[] = [
    `settings:${settings.dayCount},${settings.nightCount},` +
      `${settings.afterNightDayOffs},${settings.afterDayDayOffs},` +
      `${settings.daysInMonth},${settings.frozenThroughDay}`,
  ]

  const sorted = [...users].sort((a, b) => a.subject.localeCompare(b.subject))

  for (const user of sorted) {
    const marks = Object.entries(user.marks)
      .map(([day, kind]) => [Number(day), kind] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([day, kind]) => `${day}:${kind}`)
      .join(",")

    const external = Object.entries(user.externalShifts)
      .map(([day, shift]) => [Number(day), shift] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([day, shift]) => `${day}:${shift.shiftType}:${shift.warehouse}`)
      .join(",")

    const previous = [...user.previousShifts]
      .sort((a, b) => a.day - b.day)
      .map((shift) => `${shift.day}:${shift.shiftType}:${shift.warehouse}`)
      .join(",")

    parts.push(
      [
        user.subject,
        user.priority,
        user.shiftPreference,
        user.minShiftsPerMonth,
        user.maxShiftsPerMonth,
        days(user.daysOffUsers),
        marks,
        external,
        previous,
        ownDays(user.dayShifts, user.pinnedDays),
        ownDays(user.nightShifts, user.pinnedDays),
        days(user.pinnedDays),
      ].join("|")
    )
  }

  parts.push(`frozen:${[...frozen].sort().join(",")}`)

  return hashString(parts.join("\n"))
}

// ─── Перебор версий ───────────────────────────────────────────────────────────

/** Построенная версия вместе с её оценкой. */
interface Candidate {
  built: Built
  evaluation: ScheduleEvaluation
  /** Число правок относительно входного графика — главный критерий пересбора. */
  churn: number
}

/**
 * Какая из двух версий лучше.
 *
 * В пересборе порядок критериев обратный построению: сначала меньше правок, и
 * только при равенстве — оценка. Обещание «минимальные правки» здесь важнее
 * красоты серий: менеджер уже согласовал график, и версия, тронувшая на одну
 * клетку меньше, лучше даже если у неё на одну одиночную смену больше.
 *
 * При полном равенстве остаётся первая: выбор обязан быть детерминированным,
 * иначе один и тот же вход давал бы разные графики.
 */
function isBetter(
  a: Candidate,
  b: Candidate,
  preferFewerChanges: boolean
): boolean {
  if (preferFewerChanges && a.churn !== b.churn) return a.churn < b.churn
  return a.evaluation.cost < b.evaluation.cost
}

/**
 * Строит несколько версий, оценивает каждую и возвращает лучшую.
 *
 * Это и есть ответ на вопрос «почему одна версия, если их можно построить
 * несколько». Построение жадное и со случайным разрывом ничьих: два прогона на
 * одном составе дают разные графики, и какой из них лучше — из внутренних
 * счётов не следует, потому что они набирались по шагам. Оценщик
 * (`evaluateSchedule`) смотрит на готовый месяц целиком и сравнивает версии
 * одинаковой меркой.
 *
 * Версии строятся одним и тем же кодом, отличается только последовательность
 * случайных чисел. Поэтому перебор не «додумывает» ничего своего: он выбирает
 * лучший из вариантов той же раскладки, а не подгоняет её под оценку.
 */
function considerVariants(
  build: (random: RandomSource) => Built,
  users: IUser[],
  settings: GeneratorSettings,
  variants: number,
  random: RandomSource,
  preferFewerChanges: boolean,
  search: boolean,
  searchIterations: number
): GenerationResult {
  // Порядок состава нормализуется здесь, а не в каждом проходе: от него зависит
  // очерёдность, в которой кандидаты получают случайный шум, — и значит, и выбор
  // версии, и траектория поиска. Один и тот же склад, пришедший из базы в другом
  // порядке, обязан дать один и тот же месяц.
  const crew = [...users].sort((a, b) => a.subject.localeCompare(b.subject))

  const candidates: Candidate[] = []

  for (let i = 0; i < variants; i++) {
    const built = build(random)
    candidates.push({
      built,
      evaluation: evaluateSchedule(built.result.schedule, crew, settings),
      churn: built.result.changes.length,
    })
  }

  let best = candidates.reduce((a, b) =>
    isBetter(a, b, preferFewerChanges) ? a : b
  )
  const initialCost = best.evaluation.cost
  let acceptedMoves = 0

  // Поиск идёт после перебора и только по победителю: перебор даёт лучшую из
  // независимых раскладок, поиск улучшает уже её. Оптимизировать проигравшую
  // версию было бы тратой — её всё равно не отдадут.
  if (search) {
    const pinned: PinnedDays = new Map(
      crew.map((user) => [user.subject, new Set(user.pinnedDays)])
    )
    const isAnchored = (subject: string, day: number) =>
      isPinned(pinned, subject, day) || day <= settings.frozenThroughDay

    const outcome = improveSchedule(
      best.built.assignedDays,
      crew,
      settings,
      random,
      isAnchored,
      searchIterations
    )

    acceptedMoves = outcome.accepted

    if (outcome.evaluation.cost < best.evaluation.cost) {
      best = {
        built: {
          assignedDays: outcome.assignedDays,
          result: resultFromAssignment(
            outcome.assignedDays,
            crew,
            pinned,
            settings,
            best.built.result.eligible
          ),
        },
        evaluation: outcome.evaluation,
        churn: 0,
      }
    }
  }

  return {
    ...best.built.result,
    evaluation: best.evaluation,
    variantsConsidered: variants,
    variantCosts: candidates.map((candidate) => candidate.evaluation.cost),
    initialCost,
    acceptedMoves,
  }
}

/**
 * Строит график месяца заново.
 *
 * `options.variants` задаёт, сколько версий построить и сравнить: одна — прежнее
 * поведение, несколько — перебор с выбором лучшей по оценке. Интерфейс просит
 * несколько, потому что платит за это ожиданием пользователь, а не вызывающий
 * код. Значение по умолчанию — одна версия: удорожать незаметно чужой вызов
 * нельзя.
 */
export function generateSchedule(
  users: IUser[],
  settings: GeneratorSettings,
  options: GenerationOptions = {}
): GenerationResult {
  const variants = normalizeVariants(options.variants)
  // Смены этого склада полная пересборка не читает — см. `seedOf`.
  const random =
    options.random ??
    seededRandom(seedOf(users, settings, { includeCurrentShifts: false }))

  return considerVariants(
    (source) => buildOnce(users, settings, source),
    users,
    settings,
    variants,
    random,
    false,
    // Полная пересборка — то место, где поиск по целевой функции уместен:
    // сохранять нечего, и любое улучшение достаётся бесплатно.
    true,
    options.searchIterations ?? searchBudget(users.length)
  )
}

export interface RepairOptions extends GenerationOptions {
  /**
   * Работники, которых менеджер правил руками.
   *
   * Их строки замораживаются целиком — и смены, и пустые дни. Закрепления
   * (`pinnedDays`) для этого мало: убирая смену, менеджер не оставляет в базе
   * никакого следа, и без заморозки пересбор закрыл бы освободившийся слот тем
   * же человеком — то есть отменил бы ровно ту правку, ради которой его
   * позвали. Пустой день в замороженной строке означает «здесь его быть не
   * должно», а не «здесь он ещё не поставлен».
   */
  frozenSubjects?: Iterable<string>
}

/**
 * Пересобирает месяц с минимальными правками — об алгоритме см. `repairOnce`.
 *
 * Отличие от одного прохода только в переборе: версии сравниваются сначала по
 * числу правок и лишь затем по оценке. Версии с одинаковым числом правок всё
 * равно отличаются качеством — там и решает оценщик.
 */
export function repairSchedule(
  users: IUser[],
  settings: GeneratorSettings,
  options: RepairOptions = {}
): GenerationResult {
  const variants = normalizeVariants(options.variants)
  // Set, а не массив: вопрос «заморожен ли этот человек» задаётся в отсеве
  // кандидатов сотни раз за месяц.
  const frozen = new Set(options.frozenSubjects ?? [])
  // Для пересбора текущая раскладка — вход, а заморозка меняет набор правок,
  // которые он обязан сохранить.
  const random =
    options.random ??
    seededRandom(
      seedOf(users, settings, { frozen, includeCurrentShifts: true })
    )

  return considerVariants(
    (source) => repairOnce(users, settings, source, frozen),
    users,
    settings,
    variants,
    random,
    true,
    // В пересборе поиск не запускается: его мера — число правок, а поиск
    // меняет клетки ради оценки. Красота здесь не стоит ни одной чужой смены.
    false,
    0
  )
}
