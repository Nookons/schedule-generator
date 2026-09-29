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

export interface UnfilledSlot {
  day: number
  type: string
  needed: number
  filled: number
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

export interface GenerationResult {
  /**
   * Раскладка **этого** склада: ключ — ссылка на участника.
   *
   * `pinnedDays` — подмножество смен, которые менеджер поставил руками. Они
   * возвращаются вместе со сменами, потому что клиент сохраняет месяц целиком:
   * без признака в черновике сервер не отличил бы правку от раскладки
   * алгоритма и снял бы закрепление.
   */
  schedule: Record<
    string,
    { dayShifts: number[]; nightShifts: number[]; pinnedDays: number[] }
  >
  unfilledSlots: UnfilledSlot[]
  /** Сколько человек подходит на день и на ночь — для предупреждений. */
  eligible: { day: number; night: number }
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
    const day = 1 + Math.floor(Math.random() * daysInMonth)

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

// ─── Основная функция ─────────────────────────────────────────────────────────

export function generateSchedule(
  users: IUser[],
  settings: GeneratorSettings
): GenerationResult {
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
    return { schedule: {}, unfilledSlots: [], eligible }
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

  const unfilledSlots: UnfilledSlot[] = []
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
      .filter((user) => {
        const userMap = assignedDays.get(user.subject)!

        if (user.daysOffUsers.includes(shift.day)) return false
        if (hasAbsenceMark(user, shift.day)) return false
        // Занятость: и своя смена, и чужая — карта содержит обе.
        if (userMap.has(shift.day)) return false
        if (user.shiftPreference === "only_day" && shiftType === SHIFT.NIGHT) return false
        if (user.shiftPreference === "only_night" && shiftType === SHIFT.DAY) return false

        // Отдых после ночи проверяется по всей истории, включая другие склады:
        // именно из-за этого раньше день вставал сразу после чужой ночи.
        if (
          shiftType === SHIFT.DAY &&
          hasRecentShift(userMap, shift.day, nightRest, SHIFT.NIGHT)
        ) {
          return false
        }

        // И обратная сторона того же правила: ночь не ставим накануне уже
        // стоящего дня — своего, закреплённого или на другом складе. Дни
        // разбираются раньше ночей того же числа, поэтому «день следующего
        // числа» в карте уже есть, если он вообще есть.
        if (
          shiftType === SHIFT.NIGHT &&
          hasUpcomingShift(userMap, shift.day, nightRest, SHIFT.DAY)
        ) {
          return false
        }

        return true
      })
      .map((user) => {
        const userMap = assignedDays.get(user.subject)!
        // Загрузка суммарная по всем складам — ради этого чужие смены и
        // лежат в карте.
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

        score += calculateStreakScore(
          calculateStreak(userMap, shift.day, shiftType)
        )
        score += calculateBlockScore(userMap, shift.day, shiftType)
        score += calculateChaosPenalty(userMap, shift.day, shiftType)
        score += calculateFatigueScore(calculateFatigue(userMap, shift.day))
        score += calculateLookAheadPenalty(
          userMap,
          shift.day,
          shiftType,
          daysInMonth
        )
        score += calculateDayNightTransitionPenalty(
          userMap,
          shift.day,
          shiftType,
          dayRest
        )

        // Небольшой шум разрывает детерминированные ничьи: без него ties
        // всегда решались бы в порядке массива, и одни и те же люди получали
        // бы первый выбор каждый раз.
        score += Math.random() * 0.01

        return { subject: user.subject, score }
      })
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

    if (alreadyFilled + scoredUsers.length < neededCount) {
      unfilledSlots.push({
        day: shift.day,
        type: shift.type,
        needed: neededCount,
        filled: alreadyFilled + scoredUsers.length,
      })
    }
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
    frozenThroughDay
  )

  // ── Раскладка текущего склада ──────────────────────────────────────────────
  //
  // Чужие смены в результат не попадают: они уже сохранены другим складом, и
  // записать их сюда значило бы либо создать дубль, либо «украсть» их.
  //
  // Закрепление возвращается вместе со сменами: клиент сохраняет месяц целиком
  // и обязан сказать серверу, какие дни остаются неприкосновенными. Закреплён,
  // но пропал из раскладки день быть не может — алгоритм такие дни не трогает,
  // — однако признак всё равно берётся из раскладки, а не из входных данных:
  // иначе список закреплённых разошёлся бы с самим графиком.
  const schedule: Record<
    string,
    { dayShifts: number[]; nightShifts: number[]; pinnedDays: number[] }
  > = {}
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

  return { schedule, unfilledSlots, eligible }
}
