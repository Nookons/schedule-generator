import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { toUsers } from "@/lib/employeeMapping"
import type { ScheduleParticipant } from "@/lib/api/types"
import { seededRandom } from "@/lib/random"
import {
  generateSchedule,
  type GenerationResult,
  type GeneratorSettings,
} from "@/lib/scheduleGenerator"
import type { IUser } from "@/types/User"

/**
 * Тесты поиска по целевой функции.
 *
 * Поиск — единственное место, где раскладка меняется после того, как собрана:
 * он сносит окно дней, собирает заново и принимает ход, только если оценка всего
 * месяца не выросла. Поэтому проверяется не «красивое число», а три обещания:
 * поиск не портит, он действительно улучшает, и он не трогает то, что объявлено
 * неприкосновенным.
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

function settings(overrides: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    dayCount: 2,
    nightCount: 1,
    afterNightDayOffs: 1,
    afterDayDayOffs: 0,
    daysInMonth: 14,
    frozenThroughDay: 0,
    ...overrides,
  }
}

const crew = () => [
  makeUser({ subject: "e1", fullName: "Первый" }),
  makeUser({ subject: "e2", fullName: "Второй" }),
  makeUser({ subject: "e3", fullName: "Третий" }),
  makeUser({ subject: "e4", fullName: "Четвёртый" }),
]

type Schedule = GenerationResult["schedule"]

function planOf(schedule: Schedule, subject: string) {
  const plan = schedule[subject]
  if (!plan) throw new Error(`в раскладке нет участника ${subject}`)
  return plan
}

/** Дни работника, отсортированные: и дневные, и ночные. */
function daysOf(schedule: Schedule, subject: string): number[] {
  const plan = planOf(schedule, subject)
  return [...plan.dayShifts, ...plan.nightShifts].sort((a, b) => a - b)
}

/** Сколько человек стоит в слоте — считается по раскладке. */
function coverage(schedule: Schedule, day: number, type: "day" | "night"): number {
  const key = type === "day" ? "dayShifts" : "nightShifts"
  return Object.values(schedule).filter((plan) => plan[key].includes(day)).length
}

describe("поиск не портит раскладку", () => {
  it("итог не хуже старта — на серии зёрен", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const result = generateSchedule(crew(), settings(), {
        variants: 4,
        random: seededRandom(seed),
      })

      expect(result.evaluation.cost).toBeLessThanOrEqual(result.initialCost)
    }
  })

  it("с нулевым бюджетом не запускается вовсе", () => {
    const result = generateSchedule(crew(), settings(), {
      variants: 4,
      searchIterations: 0,
      random: seededRandom(2),
    })

    expect(result.acceptedMoves).toBe(0)
    expect(result.evaluation.cost).toBe(result.initialCost)
  })

  it("держит жёсткие правила", () => {
    const result = generateSchedule(crew(), settings(), {
      variants: 4,
      searchIterations: 200,
      random: seededRandom(9),
    })

    const { metrics } = result.evaluation
    expect(metrics.restViolations).toBe(0)
    expect(metrics.markViolations).toBe(0)
    expect(metrics.maxExceeded).toBe(0)

    // Норма остаётся ровной: поиск может переставлять людей, но не число людей
    // в слоте, иначе он бы «улучшал» график, оставляя смены незакрытыми.
    for (let day = 1; day <= 14; day++) {
      expect(coverage(result.schedule, day, "day")).toBe(2)
      expect(coverage(result.schedule, day, "night")).toBe(1)
    }
  })

  it("воспроизводим по зерну", () => {
    const config = settings()
    const options = { variants: 4, searchIterations: 120 }

    const first = generateSchedule(crew(), config, {
      ...options,
      random: seededRandom(31),
    })
    const second = generateSchedule(crew(), config, {
      ...options,
      random: seededRandom(31),
    })

    expect(first.schedule).toEqual(second.schedule)
    expect(first.acceptedMoves).toBe(second.acceptedMoves)
  })
})

describe("якоря поиска", () => {
  it("не двигает закреплённые и прошедшие дни", () => {
    // Первому закреплены 5 и 6 число, и у него же смены во прошедших 2 и 3.
    const users = crew().map((user, index) =>
      index === 0
        ? { ...user, dayShifts: [2, 3, 5, 6], pinnedDays: [5, 6] }
        : user
    )
    const config = settings({ daysInMonth: 14, frozenThroughDay: 4 })

    // Один и тот же старт, разница только в том, работает ли поиск.
    const dry = generateSchedule(users, config, {
      variants: 4,
      searchIterations: 0,
      random: seededRandom(3),
    })
    const searched = generateSchedule(users, config, {
      variants: 4,
      searchIterations: 300,
      random: seededRandom(3),
    })

    for (const day of [2, 3, 5, 6]) {
      expect(daysOf(dry.schedule, "e1")).toContain(day)
      expect(daysOf(searched.schedule, "e1")).toContain(day)
    }

    // И у всех остальных прошедшая часть месяца совпадает с той, что была до
    // поиска: задним числом график не переписывается.
    const past = (schedule: Schedule, subject: string) =>
      daysOf(schedule, subject).filter((day) => day <= 4)

    for (const user of users) {
      expect(past(searched.schedule, user.subject)).toEqual(
        past(dry.schedule, user.subject)
      )
    }
  })
})

describe("реальный склад", () => {
  const fixture: { rows: ScheduleParticipant[] } = JSON.parse(
    readFileSync(
      new URL("./__fixtures__/warehouse-participants.json", import.meta.url),
      "utf8"
    )
  )
  const config = settings({ dayCount: 2, nightCount: 2, daysInMonth: 30 })

  it("поиск улучшает оценку, а не просто «не портит»", () => {
    let before = 0
    let after = 0

    for (const seed of [1, 2, 3]) {
      const users = toUsers(fixture.rows)
      const result = generateSchedule(users, config, {
        variants: 12,
        random: seededRandom(seed),
      })

      before += result.initialCost
      after += result.evaluation.cost

      // Принятые ходы — доказательство, что поиск действительно работал, а не
      // совпал со стартом.
      expect(result.acceptedMoves).toBeGreaterThan(0)
    }

    expect(after).toBeLessThan(before)
  })

  it("не ломает покрытие и правила на настоящем составе", () => {
    const users = toUsers(fixture.rows)
    const result = generateSchedule(users, config, {
      variants: 12,
      random: seededRandom(5),
    })

    expect(result.evaluation.metrics.restViolations).toBe(0)
    expect(result.evaluation.metrics.markViolations).toBe(0)
    expect(result.evaluation.metrics.shortfall).toBe(0)

    for (let day = 1; day <= config.daysInMonth; day++) {
      expect(coverage(result.schedule, day, "day")).toBe(config.dayCount)
      expect(coverage(result.schedule, day, "night")).toBe(config.nightCount)
    }
  })
})
