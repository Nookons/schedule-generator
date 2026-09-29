import { describe, expect, it } from "vitest"

import {
  SCORING_CONFIG,
  calculateDayNightTransitionPenalty,
  calculateFatigue,
  calculateStreak,
  HISTORY_DAYS,
} from "@/lib/scheduleScoring"

/**
 * Тесты истории за границей месяца.
 *
 * Поводом стала жалоба менеджера: работник 31-го в ночь, а 1-го — день. Правила
 * считают дни вычитанием, и на первом числе им нужен хвост предыдущего месяца.
 * Карта занятости приходит с сервера со смещениями: `0` — последний день
 * предыдущего месяца, `-1` — предпоследний.
 */

/** Хвост предыдущего месяца: `days` дней подряд, начиная с последнего. */
function tail(days: number, shiftType: "Day" | "Night"): Map<number, string> {
  return new Map(Array.from({ length: days }, (_, index) => [0 - index, shiftType]))
}

describe("серия", () => {
  it("видит серию, начавшуюся в прошлом месяце", () => {
    const map = new Map([
      [0, "Day"],
      [-1, "Day"],
      [-2, "Day"],
      [1, "Day"],
    ])

    // Перед первым числом стоят три дня подряд — это одна серия, а не начало
    // новой: без хвоста она выглядела бы как чистый лист.
    expect(calculateStreak(map, 1, "day")).toBe(3)
  })

  it("не смотрит глубже известной истории", () => {
    // Хвост длиннее, чем приходит с сервера: счёт всё равно ограничен шестью
    // днями, а не уходит в бесконечность.
    const map = new Map(Array.from({ length: 30 }, (_, index) => [0 - index, "Day"]))

    expect(calculateStreak(map, 1, "day")).toBe(6)
    expect(HISTORY_DAYS).toBeGreaterThanOrEqual(6)
  })

  it("на длинном хвосте возвращает «серия слишком длинная»", () => {
    // Значение за пределами таблицы даёт самый большой штраф: это и есть
    // «стена», мешающая ставить смену седьмой день подряд.
    const map = new Map([
      [0, "Day"],
      [-1, "Day"],
      [-2, "Day"],
      [-3, "Day"],
      [-4, "Day"],
    ])

    expect(calculateStreak(map, 1, "day")).toBe(5)
  })

  it("не считает серию из другого месяца, если там был отдых", () => {
    const map = new Map([
      [0, "Night"],
      [-1, "Night"],
    ])

    expect(calculateStreak(map, 1, "day")).toBe(0)
  })
})

describe("усталость", () => {
  it("учитывает смены в конце предыдущего месяца", () => {
    const rested = new Map<number, string>()
    const tired = tail(3, "Night")

    // Три ночи подряд перед первым числом — это усталость, и она должна
    // влиять на выбор кандидата 1-го числа.
    expect(calculateFatigue(tired, 1)).toBeGreaterThan(calculateFatigue(rested, 1))
  })

  it("не смотрит глубже известной истории", () => {
    // Окно усталости — семь дней; хвоста хватает ровно на него, и это
    // совпадение обязано сохраняться: HISTORY_DAYS не может быть меньше.
    const long = tail(HISTORY_DAYS + 5, "Day")

    expect(calculateFatigue(long, 1)).toBe(calculateFatigue(tail(HISTORY_DAYS, "Day"), 1))
  })

  it("чем длиннее хвост, тем выше усталость", () => {
    expect(calculateFatigue(tail(3, "Day"), 1)).toBeGreaterThan(
      calculateFatigue(tail(1, "Day"), 1)
    )
  })

  it("ночь в хвосте утомляет сильнее дня", () => {
    expect(calculateFatigue(tail(2, "Night"), 1)).toBeGreaterThan(
      calculateFatigue(tail(2, "Day"), 1)
    )
  })
})

describe("переход «день → ночь»", () => {
  it("штрафуется при нулевой настройке отдыха", () => {
    // Настройка по умолчанию — ноль дней отдыха после дневной. Раньше это
    // отключало проверку целиком, и ночь вставала сразу после дня.
    const map = new Map([[3, "Day"]])

    expect(calculateDayNightTransitionPenalty(map, 4, "night", 0)).toBe(
      SCORING_CONFIG.DAY_NIGHT_TRANSITION_PENALTY
    )
  })

  it("не трогает день и не трогает ночь без дня перед ней", () => {
    const map = new Map([[3, "Day"]])

    expect(calculateDayNightTransitionPenalty(map, 4, "day", 0)).toBe(0)
    expect(calculateDayNightTransitionPenalty(new Map([[3, "Night"]]), 4, "night", 0)).toBe(0)
    expect(calculateDayNightTransitionPenalty(new Map(), 4, "night", 0)).toBe(0)
  })

  it("настройка расширяет окно, а не включает правило", () => {
    // День за два дня до ночи: при окне в один день это не переход, при двух —
    // уже он.
    const map = new Map([[1, "Day"]])

    expect(calculateDayNightTransitionPenalty(map, 3, "night", 1)).toBe(0)
    expect(calculateDayNightTransitionPenalty(map, 3, "night", 2)).toBe(
      SCORING_CONFIG.DAY_NIGHT_TRANSITION_PENALTY
    )
  })

  it("видит день в конце предыдущего месяца", () => {
    // Смещение 0 — последний день предыдущего месяца: ночь 1-го после него
    // такой же переход, как и внутри месяца.
    const map = new Map([[0, "Day"]])

    expect(calculateDayNightTransitionPenalty(map, 1, "night", 0)).toBe(
      SCORING_CONFIG.DAY_NIGHT_TRANSITION_PENALTY
    )
  })
})
