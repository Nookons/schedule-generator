import { describe, expect, it } from "vitest"

import { toUser } from "@/lib/employeeMapping"
import type { ScheduleParticipant } from "@/lib/api/types"

/**
 * Тесты преобразования участника в модель генератора.
 *
 * Проверяется то, что легко потерять молча: поля приходят из сети, и опечатка
 * в имени не ломает сборку, а превращается в пустой список — правило просто
 * перестаёт работать, и никто об этом не узнаёт.
 */

/** Минимальный ответ API: остальное `toUser` берёт с запасными значениями. */
function participant(overrides: Partial<ScheduleParticipant> = {}): ScheduleParticipant {
  return {
    subject: "e61",
    kind: "employee",
    id: 61,
    card_id: 5001,
    user_name: "Анна",
    warehouse: "GLP-C",
    role: "worker",
    is_leader: false,
    is_active: true,
    avatar_url: null,
    prefs: {
      shift_preference: "all",
      min_shifts_per_month: 0,
      max_shifts_per_month: 31,
      priority: 1,
      days_off: [],
      note: null,
      has_month_override: false,
    },
    ...overrides,
  } as ScheduleParticipant
}

describe("toUser", () => {
  it("переносит хвост предыдущего месяца", () => {
    const user = toUser(
      participant({
        previous_shifts: [
          { day: 0, shift_type: "night", warehouse: "GLP-C" },
          { day: -2, shift_type: "day", warehouse: "PNT-A" },
        ],
      })
    )

    expect(user.previousShifts).toEqual([
      { day: 0, shiftType: "night", warehouse: "GLP-C" },
      { day: -2, shiftType: "day", warehouse: "PNT-A" },
    ])
  })

  it("отбрасывает дни текущего месяца, попавшие в хвост", () => {
    // Хвост — это дни 0 и отрицательные. Положительный день пришёл бы из
    // текущего месяца, и в карте занятости он перекрыл бы настоящую смену.
    const user = toUser(
      participant({
        previous_shifts: [{ day: 3, shift_type: "day", warehouse: "GLP-C" }],
      })
    )

    expect(user.previousShifts).toEqual([])
  })

  it("не падает без хвоста", () => {
    // Поле необязательное: старый ответ сервера его не содержит.
    expect(toUser(participant()).previousShifts).toEqual([])
  })

  it("раскладывает смены и отметки по дням месяца", () => {
    const user = toUser(
      participant({
        marks: [{ day: 5, kind: "vacation", note: null }],
        external_shifts: [
          { day: 7, shift_type: "night", warehouse: "PNT-A" },
          // День вне месяца рисовать негде, и в модель он попадать не должен.
          { day: 40, shift_type: "day", warehouse: "PNT-A" },
        ],
      })
    )

    expect(user.marks).toEqual({ 5: "vacation" })
    expect(user.externalShifts).toEqual({
      7: { shiftType: "night", warehouse: "PNT-A" },
    })
  })
})
