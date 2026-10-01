// ─────────────────────────────────────────────────────────────────────────────
// scheduleScoring.ts
// Scoring helpers for the auto-generation algorithm.
// All values are tunable via SCORING_CONFIG — touch here, not in the component.
// ─────────────────────────────────────────────────────────────────────────────

export const SHIFT = {
  DAY: "day",
  NIGHT: "night",
} as const

export type ShiftType = (typeof SHIFT)[keyof typeof SHIFT]

// ─── Tuneable constants ───────────────────────────────────────────────────────

export const SCORING_CONFIG = {
  // ── Priority ──────────────────────────────────────────────────────────────
  PRIORITY_WEIGHT: 3,

  // ── Shift preference ──────────────────────────────────────────────────────
  PREFERENCE_MATCH: 5,
  PREFERENCE_FLEXIBLE: 2,

  // ── Load balancing ────────────────────────────────────────────────────────
  BELOW_MIN_BONUS: 6,
  ABOVE_MAX_PENALTY: -200,
  FILL_RATIO_WEIGHT: 5,
  DEVIATION_WEIGHT: 4,

  // ── Streak (consecutive same-type shifts) ─────────────────────────────────
  // Target block length is 4–5 shifts in a row, then rest.
  // The curve below GROWS as the streak approaches that target (so the
  // algorithm actively wants to keep building the block instead of
  // splitting it up), peaks around 3, stays positive at 4-5 (finishing the
  // block cleanly), then falls off a cliff at 6+ (strongly forces rest).
  //
  // Previous version peaked at streak=2 and was already negative by
  // streak=5 — that's what caused D N D N fragmentation instead of
  // D D D D D blocks. This curve fixes that direction.
  STREAK_SCORES: { 1: 6, 2: 12, 3: 18, 4: 14, 5: 4, 6: -55 } as Record<
    number,
    number
  >,
  STREAK_LONG_PENALTY: -80, // for streaks > 6 — effectively a hard wall

  // ── Block awareness ───────────────────────────────────────────────────────
  BLOCK_CONTINUATION_BONUS: 6, // flat nudge on top of the streak curve above
  BLOCK_START_BONUS: 8, // starting a fresh block (2 off-days before) —
  // raised so beginning a new block after real
  // rest is clearly preferred over patchwork
  BLOCK_BREAK_PENALTY: -8, // switching type in the middle of a block

  // ── Anti-alternation ──────────────────────────────────────────────────────
  ALTERNATION_PENALTY: -18, // Work-Off-Work or Off-Work-Off pattern
  TYPE_FLIP_PENALTY: -12, // Day-Night-Day or Night-Day-Night

  // ── Fatigue ───────────────────────────────────────────────────────────────
  DAY_FATIGUE_COST: 1,
  NIGHT_FATIGUE_COST: 2,
  OFF_FATIGUE_RECOVERY: -2,
  FATIGUE_THRESHOLD: 6, // no penalty below this value
  FATIGUE_PENALTY_WEIGHT: 2, // score -= (fatigue - threshold) * weight

  // ── Look-ahead ────────────────────────────────────────────────────────────
  LOOKAHEAD_WOW_PENALTY: -15, // would create Work-Off-Work 2 days out
  LOOKAHEAD_ORPHAN_PENALTY: -10, // next day already assigned & next+1 is off

  // ── Day → Night transition rest (soft) ─────────────────────────────────────
  // Kept soft rather than a hard filter: with a small employee pool, hard-
  // blocking every Day→Night switch leaves night slots unfilled — замер на
  // живом складе: жёсткий запрет давал 0.3 незакрытых слота в месяц, мягкий
  // штраф — ноль при почти том же числе переходов. A heavy soft penalty
  // respects the rule whenever there's a real alternative, but still lets
  // the slot get filled when there genuinely isn't one.
  DAY_NIGHT_TRANSITION_PENALTY: -150,

  // ── Incremental repair (минимальные правки) ────────────────────────────────
  //
  // Надбавка за то, чтобы закрыть дырку человеком, который и так работает
  // рядом. Полная пересборка её не использует: ей нечего сохранять. Здесь она
  // решает ничьи между кандидатами, равными по загрузке, в пользу того, у кого
  // смена встанет в серию, а не одиночкой в чужом месте месяца.
  //
  // Надбавки «за восстановление снятой смены» здесь нет намеренно. Она была бы
  // недостижима: смену снимает только нарушение правила, а само правило после
  // снятия продолжает действовать — человек с ночью 5-го так и остаётся
  // негодным на день 6-го. Возвращать его туда пересбор не станет, и проверять
  // эту ветку было бы нечем.
  REPAIR_NEAR_BONUS: 15,

  // ── Разброс ничьих ────────────────────────────────────────────────────────
  // Малый шум в обычном проходе: он разрывает ничьи, не меняя предпочтений.
  TIE_NOISE: 0.01,
  // Большой шум при перестройке окна в поиске: пересборка обязана пробовать
  // разные составы, иначе она воспроизводит то же самое решение и поиск
  // топчется на месте. Сопоставим по величине с силой и надбавкой за минимум,
  // но меньше штрафа за переход «день → ночь» и грубых нарушений.
  SEARCH_NOISE: 4,
} as const

/**
 * Веса оценщика готового графика.
 *
 * Здесь, а не в файле оценки, по той же причине, что и остальные числа: все
 * настройки качества обязаны лежать в одном месте, иначе через полгода никто не
 * поймёт, какие из них ещё влияют на результат. Сверху вниз — от «так нельзя» к
 * «так некрасиво»: разрыв между группами намеренно в разы, чтобы версия с
 * незакрытой сменой никогда не выиграла у версии с красивыми сериями.
 */
export const EVALUATION_WEIGHTS = {
  // ── Так нельзя: правило нарушено ──────────────────────────────────────────
  REST_VIOLATION: 10000, // день после ночи или ночь накануне дня
  MARK_VIOLATION: 10000, // смена в день, закрытый отпуском или выходным

  // ── Норма покрытия: ровно столько, сколько задано ─────────────────────────
  // Недобор дороже излишка: незакрытая смена — это некому работать, лишний
  // человек — это переработка, которую видно и можно поправить руками.
  SHORTFALL: 1000,
  EXCESS: 250,

  // ── Договорённости с работником ───────────────────────────────────────────
  MAX_EXCEEDED: 300, // смен больше месячного максимума
  MIN_SHORTFALL: 60, // смен меньше месячного минимума
  PREFERENCE_MISMATCH: 40, // смена не того типа, который человек выбрал

  // ── Качество раскладки ────────────────────────────────────────────────────
  // Переход «день → ночь» без отдыха в генераторе мягкий, но в оценке он
  // событийный: версия, где таких переходов меньше, обязана выигрывать.
  DAY_NIGHT_TRANSITION: 150,
  LOAD_DEVIATION: 12, // сумма отклонений загрузки от справедливой доли
  ISOLATED_SHIFT: 15, // смена без соседей того же типа — рваный график
  ALTERNATION: 10, // день-ночь-день: тип возвращается через день
  FATIGUE_PEAK: 4, // пик усталости выше порога, за каждую единицу
} as const

// ─── Utilities ────────────────────────────────────────────────────────────────

export function normalizeShift(s: string | undefined): ShiftType | null {
  if (!s) return null
  const lower = s.toLowerCase()
  return lower === SHIFT.DAY || lower === SHIFT.NIGHT ? lower : null
}

// ─── История за границей месяца ───────────────────────────────────────────────

/**
 * На сколько дней назад карта занятости помнит смены.
 *
 * Правила вычитают из числа дня, и на первом числе месяца им нужен хвост
 * предыдущего: ночь 31-го запрещает день 1-го. Число обязано быть не меньше
 * самой глубокой проверки — окно усталости считается на семь дней назад, —
 * иначе на стыке месяцев правило снова начнёт пропускать день после ночи.
 *
 * Дни приходят с сервера смещением: `0` — последний день предыдущего месяца,
 * `-1` — предпоследний. Самый старый известный день — `1 - HISTORY_DAYS`.
 */
export const HISTORY_DAYS = 7

/** Раньше этого дня карта занятости ничего не знает. */
const OLDEST_KNOWN_DAY = 1 - HISTORY_DAYS

// ─── Fatigue ──────────────────────────────────────────────────────────────────

/**
 * Rolling fatigue up to (but not including) `day`.
 * Day shift costs +1, night shift +2, rest day recovers -2 (min 0).
 */
export function calculateFatigue(
  userMap: Map<number, string>,
  upToDay: number
): number {
  let fatigue = 0
  for (let d = Math.max(OLDEST_KNOWN_DAY, upToDay - 7); d < upToDay; d++) {
    const s = normalizeShift(userMap.get(d))
    if (s === SHIFT.DAY) fatigue += SCORING_CONFIG.DAY_FATIGUE_COST
    else if (s === SHIFT.NIGHT) fatigue += SCORING_CONFIG.NIGHT_FATIGUE_COST
    else fatigue += SCORING_CONFIG.OFF_FATIGUE_RECOVERY
    fatigue = Math.max(0, fatigue)
  }
  return fatigue
}

export function calculateFatigueScore(fatigue: number): number {
  if (fatigue <= SCORING_CONFIG.FATIGUE_THRESHOLD) return 0
  return (
    -(fatigue - SCORING_CONFIG.FATIGUE_THRESHOLD) *
    SCORING_CONFIG.FATIGUE_PENALTY_WEIGHT
  )
}

// ─── Streak ───────────────────────────────────────────────────────────────────

/**
 * How many consecutive days of the same shiftType immediately before `day`.
 * Capped at 6 to keep the lookup bounded.
 */
export function calculateStreak(
  userMap: Map<number, string>,
  day: number,
  shiftType: ShiftType
): number {
  let streak = 0
  for (let d = day - 1; d >= Math.max(OLDEST_KNOWN_DAY, day - 6); d--) {
    if (normalizeShift(userMap.get(d)) === shiftType) streak++
    else break
  }
  return streak
}

export function calculateStreakScore(streak: number): number {
  if (streak === 0) return 0
  return (
    SCORING_CONFIG.STREAK_SCORES[streak] ?? SCORING_CONFIG.STREAK_LONG_PENALTY
  )
}

// ─── Block awareness ─────────────────────────────────────────────────────────

/**
 * Rewards building clean work-blocks (D D D or N N N).
 *
 * NOTE: island detection (off → SHIFT → off) is intentionally NOT scored
 * here. Generation proceeds strictly in chronological slot order (Day1,
 * Night1, Day2, Night2, ...), so at the moment we score `day`, day+1 has
 * never been assigned to anyone yet — `next1` would always read as null,
 * meaning this check would fire on every single block start, not just on
 * genuine islands. That was silently killing all fresh block starts.
 * Real island cleanup happens after generation, in the optimization pass,
 * where the full month is already known.
 */
export function calculateBlockScore(
  userMap: Map<number, string>,
  day: number,
  shiftType: ShiftType
): number {
  let score = 0
  const prev1 = normalizeShift(userMap.get(day - 1))
  const prev2 = normalizeShift(userMap.get(day - 2))

  // Continuing an existing block of the same type
  if (prev1 === shiftType) {
    score += SCORING_CONFIG.BLOCK_CONTINUATION_BONUS
  }

  // Starting a fresh block after at least 2 rest days
  if (prev1 === null && prev2 === null) {
    score += SCORING_CONFIG.BLOCK_START_BONUS
  }

  // Would create a type-break mid-block (prev was a different shift type)
  if (prev1 !== null && prev1 !== shiftType) {
    score += SCORING_CONFIG.BLOCK_BREAK_PENALTY
  }

  return score
}

// ─── Anti-alternation / chaos ─────────────────────────────────────────────────

/**
 * Penalises the three most common chaotic patterns:
 *   Work-Off-Work  (current=Work, prev1=Off, prev2=Work)
 *   Off-Work-Off   (смена через один день отдыха)
 *   Day-Night-Day / Night-Day-Night
 */
export function calculateChaosPenalty(
  userMap: Map<number, string>,
  day: number,
  shiftType: ShiftType
): number {
  let penalty = 0
  const prev1 = normalizeShift(userMap.get(day - 1))
  const prev2 = normalizeShift(userMap.get(day - 2))
  const prev3 = normalizeShift(userMap.get(day - 3))

  // Work-Off-Work: current=shift, prev1=off, prev2=any shift
  if (prev1 === null && prev2 !== null) {
    penalty += SCORING_CONFIG.ALTERNATION_PENALTY
  }

  // Day-Night-Day or Night-Day-Night (type flip every day)
  if (
    prev2 !== null &&
    prev1 !== null &&
    prev2 === shiftType &&
    prev1 !== shiftType
  ) {
    penalty += SCORING_CONFIG.TYPE_FLIP_PENALTY
  }

  // Triple alternation: O-W-O-W → extra hit
  if (prev3 === null && prev2 !== null && prev1 === null) {
    penalty += SCORING_CONFIG.ALTERNATION_PENALTY
  }

  return penalty
}

// ─── Look-ahead (2 days) ─────────────────────────────────────────────────────

/**
 * Checks 1–2 days ahead for already-assigned patterns that this assignment
 * would worsen.  next1/next2 are only non-null if those days were already
 * processed (e.g. a night shift that came before today's day shift slot).
 */
export function calculateLookAheadPenalty(
  userMap: Map<number, string>,
  day: number,
  shiftType: ShiftType,
  daysInMonth: number
): number {
  if (day >= daysInMonth - 1) return 0

  let penalty = 0
  const next1 = normalizeShift(userMap.get(day + 1))
  const next2 = normalizeShift(userMap.get(day + 2))

  // Assigning today + next is off + day+2 is a shift → W-O-W forward
  if (next1 === null && next2 !== null) {
    penalty += SCORING_CONFIG.LOOKAHEAD_WOW_PENALTY
  }

  // Today is assigned, next is a different type → likely flip coming
  if (next1 !== null && next1 !== shiftType) {
    penalty += SCORING_CONFIG.LOOKAHEAD_ORPHAN_PENALTY
  }

  return penalty
}

// ─── Day → Night transition rest (soft) ───────────────────────────────────────

/**
 * Soft penalty for switching from a Day shift straight into a Night shift
 * without the configured number of rest days (`afterDayDayOffs`) in between.
 *
 * This is intentionally NOT a hard filter (see SCORING_CONFIG comment) —
 * it's applied as a scoring penalty so the algorithm strongly prefers a
 * rested candidate when one exists, but can still fill the slot from a
 * recently-day-shifted candidate rather than leaving it unfilled or
 * distorting someone else's block when the employee pool is tight.
 */
export function calculateDayNightTransitionPenalty(
  userMap: Map<number, string>,
  day: number,
  shiftType: ShiftType,
  afterDayDayOffs: number
): number {
  if (shiftType !== SHIFT.NIGHT) return 0

  // Переход «день → ночь» нежелателен сам по себе, а не только когда менеджер
  // задал дни отдыха после дневной. Раньше при `after_day_off = 0` (значение по
  // умолчанию) проверка не выполнялась вовсе, и ночь вставала сразу после дня:
  // измерение на живом складе давало два таких перехода в месяц.
  // Настройка теперь расширяет окно, но не отключает правило.
  const window = Math.max(1, afterDayDayOffs)
  for (let i = 1; i <= window; i++) {
    if (normalizeShift(userMap.get(day - i)) === SHIFT.DAY) {
      return SCORING_CONFIG.DAY_NIGHT_TRANSITION_PENALTY
    }
  }
  return 0
}
