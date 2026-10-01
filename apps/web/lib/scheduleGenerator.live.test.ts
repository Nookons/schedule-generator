import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { toUsers } from "@/lib/employeeMapping"
import { seededRandom } from "@/lib/random"
import { generateSchedule } from "@/lib/scheduleGenerator"
import type { ScheduleParticipant } from "@/lib/api/types"

/**
 * Прогон алгоритма на снимке реального склада.
 *
 * Фикстура — выгрузка состава GLP-C за сентябрь вместе со сменами на других
 * складах (имена обезличены). Она нужна, потому что на живых данных
 * встречаются сочетания, до которых синтетика не додумывается: у одного
 * человека дни на одном складе, ночи на другом, и всё это в одном месяце.
 *
 * Проверяется инвариант, который нельзя обеспечить только юнит-тестами:
 * после ночи — на любом складе — день не ставится.
 */

interface Fixture {
  warehouse: string
  month: string
  rows: ScheduleParticipant[]
}

const fixture: Fixture = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/warehouse-participants.json", import.meta.url),
    "utf8"
  )
)

describe(`реальный склад ${fixture.warehouse}`, () => {
  const users = toUsers(fixture.rows)
  const daysInMonth = 30

  it("в фикстуре есть чужие смены", () => {
    const external = users.reduce(
      (sum, user) => sum + Object.keys(user.externalShifts).length,
      0
    )
    expect(external).toBeGreaterThan(0)
  })

  it("не ставит день после ночи — ни своей, ни чужой", () => {
    for (let run = 0; run < 10; run++) {
      // Зерно на прогон: построение детерминировано по входу, и без явного
      // зерна все десять прогонов дали бы один и тот же график — серия
      // перестала бы что-либо проверять.
      const { schedule } = generateSchedule(
        users,
        {
          dayCount: 2,
          nightCount: 2,
          afterNightDayOffs: 1,
          afterDayDayOffs: 0,
          daysInMonth,
          // Снапшот — будущий месяц целиком; заморозка прошедших дней здесь
          // только сузила бы проверку.
          frozenThroughDay: 0,
        },
        { random: seededRandom(run + 1) }
      )

      for (const user of users) {
        const plan = schedule[user.subject]!
        // Полная картина месяца: свои смены плюс чужие.
        const night = new Set<number>()
        for (const [day, shift] of Object.entries(user.externalShifts)) {
          if (shift.shiftType === "night") night.add(Number(day))
        }
        for (const day of plan.nightShifts) night.add(day)

        for (const day of plan.dayShifts) {
          expect(
            night.has(day - 1),
            `${user.fullName}: день ${day} сразу после ночи ${day - 1}`
          ).toBe(false)
        }
      }
    }
  })

  it("не записывает чужие смены в график склада", () => {
    for (let run = 0; run < 5; run++) {
      // Зерно на прогон: построение детерминировано по входу, и без явного
      // зерна все десять прогонов дали бы один и тот же график — серия
      // перестала бы что-либо проверять.
      const { schedule } = generateSchedule(
        users,
        {
          dayCount: 2,
          nightCount: 2,
          afterNightDayOffs: 1,
          afterDayDayOffs: 0,
          daysInMonth,
          // Снапшот — будущий месяц целиком; заморозка прошедших дней здесь
          // только сузила бы проверку.
          frozenThroughDay: 0,
        },
        { random: seededRandom(run + 1) }
      )

      for (const user of users) {
        const plan = schedule[user.subject]!
        for (const day of Object.keys(user.externalShifts).map(Number)) {
          expect(plan.dayShifts).not.toContain(day)
          expect(plan.nightShifts).not.toContain(day)
        }
      }
    }
  })
})
