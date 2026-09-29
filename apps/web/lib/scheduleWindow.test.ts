import dayjs from "dayjs"
import { describe, expect, it } from "vitest"

import { frozenThroughDay } from "@/lib/scheduleWindow"

/**
 * Тесты границы, до которой алгоритм не трогает месяц.
 *
 * Поводом стала жалоба менеджера: «Построить график» в середине месяца
 * пересобирал и начало — дни, которые люди уже отработали.
 */

const TODAY = dayjs("2026-09-17")

describe("frozenThroughDay", () => {
  it("в текущем месяце закрывает всё по сегодняшний день", () => {
    expect(frozenThroughDay("2026-09", TODAY)).toBe(17)
  })

  it("будущий месяц не ограничен", () => {
    expect(frozenThroughDay("2026-10", TODAY)).toBe(0)
    expect(frozenThroughDay("2027-01", TODAY)).toBe(0)
  })

  it("прошлый месяц не ограничен", () => {
    // Планировщик умеет строить месяц с нуля — например, когда график на
    // прошлый месяц не составляли и его нужно заполнить для отчётности.
    // Заморозка прошлого месяца сделала бы это невозможным.
    expect(frozenThroughDay("2026-08", TODAY)).toBe(0)
    expect(frozenThroughDay("2025-12", TODAY)).toBe(0)
  })

  it("работает на границе года", () => {
    const newYear = dayjs("2027-01-01")
    expect(frozenThroughDay("2027-01", newYear)).toBe(1)
    expect(frozenThroughDay("2026-12", newYear)).toBe(0)
  })

  it("в первый день месяца закрывает только его", () => {
    expect(frozenThroughDay("2026-09", dayjs("2026-09-01"))).toBe(1)
  })
})
