import { describe, expect, it } from "vitest"

import {
  evaluateSchedule,
  type EvaluationSettings,
  type EvaluatedSchedule,
} from "@/lib/scheduleEvaluation"
import type { DayMarkKind } from "@/lib/api/types"
import type { IUser } from "@/types/User"

/**
 * Тесты оценщика готового графика.
 *
 * Оценщик — вторая половина перебора версий: построение даёт несколько
 * раскладок, а выбрать из них одну умеет только он. Поэтому проверяется не
 * «красивое число», а два свойства: каждое отклонение он видит и называет, и
 * порядок весов таков, что незакрытая смена никогда не проигрывает красивым
 * сериям.
 */

const BASE_USER: Omit<IUser, "subject"> = {
  kind: "employee",
  id: 1,
  fullName: "Без имени",
  warehouse: "GLP-C",
  priority: 1,
  shiftPreference: "all",
  daysOffUsers: [],
  marks: {},
  externalShifts: {},
  previousShifts: [],
  dayShifts: [],
  nightShifts: [],
  pinnedDays: [],
  minShiftsPerMonth: 0,
  maxShiftsPerMonth: 31,
  isActive: true,
  hasMonthOverride: false,
  note: null,
}

function makeUser(overrides: Partial<IUser> & { subject: string }): IUser {
  return { ...BASE_USER, ...overrides }
}

function settings(overrides: Partial<EvaluationSettings> = {}): EvaluationSettings {
  return {
    dayCount: 1,
    nightCount: 0,
    afterNightDayOffs: 1,
    afterDayDayOffs: 0,
    daysInMonth: 6,
    frozenThroughDay: 0,
    ...overrides,
  }
}

/** Раскладка одного работника. */
function plan(dayShifts: number[], nightShifts: number[] = []) {
  return { dayShifts, nightShifts }
}

function mark(day: number, kind: DayMarkKind): Record<number, DayMarkKind> {
  return { [day]: kind }
}

describe("чистая раскладка", () => {
  it("не находит ни одного порока", () => {
    // Две аккуратные серии по три дня, норма закрыта, загрузка равная.
    const users = [makeUser({ subject: "e1" }), makeUser({ subject: "e2" })]
    const schedule: EvaluatedSchedule = {
      e1: plan([1, 2, 3]),
      e2: plan([4, 5, 6]),
    }

    const { cost, metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics).toEqual({
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
    })
    expect(cost).toBe(0)
  })

  it("считает одно и то же дважды одинаково", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([1, 3, 5]) }

    expect(evaluateSchedule(schedule, users, settings())).toEqual(
      evaluateSchedule(schedule, users, settings())
    )
  })

  it("не падает на пустом составе", () => {
    const { cost, metrics } = evaluateSchedule({}, [], settings())

    expect(cost).toBe(0)
    expect(metrics.shortfall).toBe(0)
  })
})

describe("покрытие", () => {
  it("видит незакрытый день", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([1, 2, 3, 4, 5]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.shortfall).toBe(1)
    expect(metrics.excess).toBe(0)
  })

  it("видит лишнего человека в дне", () => {
    const users = [makeUser({ subject: "e1" }), makeUser({ subject: "e2" })]
    const schedule: EvaluatedSchedule = {
      e1: plan([1, 2, 3, 4, 5, 6]),
      e2: plan([3]),
    }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.excess).toBe(1)
    expect(metrics.shortfall).toBe(0)
  })

  it("не считает чужие смены покрытием этого склада", () => {
    // Человек в этот день работает на другом складе: здешний слот он не
    // закрывает, и день остаётся недокрытым.
    const users = [
      makeUser({ subject: "e1" }),
      makeUser({
        subject: "e2",
        externalShifts: { 3: { shiftType: "day", warehouse: "PNT-A" } },
      }),
    ]
    const schedule: EvaluatedSchedule = { e1: plan([1, 2, 4, 5, 6]), e2: plan([]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.shortfall).toBe(1)
    expect(metrics.excess).toBe(0)
  })
})

describe("правила и договорённости", () => {
  it("видит день после ночи", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([3], [2]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    // Названы обе смены пары: и день не встал бы после ночи, и ночь не встала
    // бы накануне дня. Ровно так же их отсеивает и построение — с двух сторон.
    expect(metrics.restViolations).toBe(2)
  })

  it("видит ночь накануне дня", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([2], [1]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.restViolations).toBe(2)
  })

  it("видит смену в отпуск", () => {
    const users = [makeUser({ subject: "e1", marks: mark(2, "vacation") })]
    const schedule: EvaluatedSchedule = { e1: plan([1, 2, 3, 4, 5, 6]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.markViolations).toBe(1)
  })

  it("видит смену не того типа", () => {
    const users = [makeUser({ subject: "e1", shiftPreference: "only_day" })]
    const schedule: EvaluatedSchedule = { e1: plan([], [1]) }

    const { metrics } = evaluateSchedule(
      schedule,
      users,
      settings({ nightCount: 1, daysInMonth: 1 })
    )

    expect(metrics.preferenceMismatches).toBe(1)
  })

  it("видит выход за месячный максимум и недобор до минимума", () => {
    const users = [
      makeUser({ subject: "e1", maxShiftsPerMonth: 2 }),
      makeUser({ subject: "e2", minShiftsPerMonth: 5 }),
    ]
    const schedule: EvaluatedSchedule = { e1: plan([1, 2, 3, 4]), e2: plan([]) }

    const { metrics } = evaluateSchedule(
      schedule,
      users,
      settings({ daysInMonth: 4 })
    )

    expect(metrics.maxExceeded).toBe(2)
    expect(metrics.minShortfall).toBe(5)
  })

  it("считает загрузку по всем складам", () => {
    // Две свои смены плюс три чужие — это пять, а не два.
    const users = [
      makeUser({
        subject: "e1",
        maxShiftsPerMonth: 4,
        externalShifts: {
          1: { shiftType: "day", warehouse: "PNT-A" },
          2: { shiftType: "day", warehouse: "PNT-A" },
          3: { shiftType: "day", warehouse: "PNT-A" },
        },
      }),
    ]
    const schedule: EvaluatedSchedule = { e1: plan([4, 5]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.maxExceeded).toBe(1)
  })
})

describe("качество раскладки", () => {
  it("видит одиночную смену", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([4]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.isolatedShifts).toBe(1)
  })

  it("не считает одиночкой смену внутри серии", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([3, 4, 5]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.isolatedShifts).toBe(0)
  })

  it("видит чередование день-ночь-день", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([1, 3], [2]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.alternations).toBe(1)
  })

  it("видит переход день → ночь", () => {
    const users = [makeUser({ subject: "e1" })]
    const schedule: EvaluatedSchedule = { e1: plan([1], [2]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.dayNightTransitions).toBe(1)
  })

  it("видит разброс загрузки", () => {
    const users = [makeUser({ subject: "e1" }), makeUser({ subject: "e2" })]
    // Шесть смен на двоих при равной силе: справедливо по три, стоит 1 и 5.
    const schedule: EvaluatedSchedule = { e1: plan([1]), e2: plan([2, 3, 4, 5, 6]) }

    const { metrics } = evaluateSchedule(schedule, users, settings())

    expect(metrics.loadDeviation).toBe(4)
  })
})

describe("порядок весов", () => {
  it("незакрытая смена дороже рваных серий", () => {
    const users = [makeUser({ subject: "e1" }), makeUser({ subject: "e2" })]
    const config = settings({ daysInMonth: 6 })

    // Дырка: шесть дней на двоих, но один закрыт только до пятого числа.
    const withHole = evaluateSchedule(
      { e1: plan([1, 2, 3, 4, 5]), e2: plan([]) },
      users,
      config
    )
    // Рвано, зато закрыто всё: смены через день.
    const ragged = evaluateSchedule(
      { e1: plan([1, 3, 5]), e2: plan([2, 4, 6]) },
      users,
      config
    )

    expect(withHole.metrics.shortfall).toBe(1)
    expect(ragged.metrics.shortfall).toBe(0)
    expect(ragged.metrics.isolatedShifts).toBeGreaterThan(0)
    expect(withHole.cost).toBeGreaterThan(ragged.cost)
  })

  it("нарушение правила дороже всего остального", () => {
    const users = [makeUser({ subject: "e1" }), makeUser({ subject: "e2" })]
    const config = settings({ nightCount: 1, daysInMonth: 4 })

    // Аккуратно и без нарушений: у одного дни, у другого ночи.
    const clean = evaluateSchedule(
      { e1: plan([1, 2, 3, 4]), e2: plan([], [1, 2, 3, 4]) },
      users,
      config
    )
    // Норма закрыта так же, но у первого ночь перед его же днём.
    const broken = evaluateSchedule(
      { e1: plan([2, 3, 4], [1]), e2: plan([1], [2, 3, 4]) },
      users,
      config
    )

    expect(clean.metrics.restViolations).toBe(0)
    expect(clean.metrics.shortfall).toBe(0)
    expect(broken.metrics.shortfall).toBe(0)
    expect(broken.metrics.restViolations).toBeGreaterThan(0)
    expect(broken.cost).toBeGreaterThan(clean.cost)
  })

  it("смена в отпуск дороже незакрытого дня", () => {
    const onVacation = evaluateSchedule(
      { e1: plan([1, 2, 3]) },
      [makeUser({ subject: "e1", marks: mark(2, "vacation") })],
      settings({ daysInMonth: 3 })
    )
    const withHole = evaluateSchedule(
      { e1: plan([1, 3]) },
      [makeUser({ subject: "e1" })],
      settings({ daysInMonth: 3 })
    )

    expect(onVacation.cost).toBeGreaterThan(withHole.cost)
  })
})
