import { describe, expect, it } from "vitest"

import {
  DAY_LEGEND,
  EXCEL_FILL,
  dayKind,
  dayVisual,
  type DayKind,
} from "@/lib/dayVisual"
import type { DayMarkKind } from "@/lib/api/types"
import type { IUser } from "@/types/User"

/**
 * Тесты разбора дня.
 *
 * Поводом стала расшифровка под таблицей: она повторяла цвета клеток вторым
 * списком, и любая правка в одном месте оставляла второе врать. Теперь оба
 * места берут цвета из `dayVisual`, а порядок проверок закреплён здесь.
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

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return { ...BASE_USER, subject: "e1", ...overrides }
}

const ALL_KINDS: DayKind[] = [
  "day",
  "night",
  "off",
  "vacation",
  "sick",
  "unavailableHere",
  "externalDay",
  "externalNight",
  "prefsOff",
  "empty",
]

describe("dayKind", () => {
  it("называет смену текущего склада", () => {
    expect(dayKind(makeUser({ dayShifts: [3] }), 3)).toBe("day")
    expect(dayKind(makeUser({ nightShifts: [3] }), 3)).toBe("night")
  })

  it("переводит отметки дня в те же состояния", () => {
    expect(dayKind(makeUser({ marks: { 1: "off" } }), 1)).toBe("off")
    expect(dayKind(makeUser({ marks: { 1: "vacation" } }), 1)).toBe("vacation")
    expect(dayKind(makeUser({ marks: { 1: "sick" } }), 1)).toBe("sick")
  })

  it("показывает смену, если в базе оказались и смена, и отметка", () => {
    const user = makeUser({ dayShifts: [5], marks: { 5: "vacation" } })
    expect(dayKind(user, 5)).toBe("day")
  })

  it("различает день и ночь на другом складе", () => {
    const user = makeUser({
      externalShifts: {
        2: { shiftType: "day", warehouse: "SMALL-P3" },
        3: { shiftType: "night", warehouse: "SMALL-P3" },
      },
    })
    expect(dayKind(user, 2)).toBe("externalDay")
    expect(dayKind(user, 3)).toBe("externalNight")
  })

  it("ставит чужую смену выше постоянного выходного", () => {
    // Иначе день выглядел бы свободным, и менеджер поставил бы человека
    // второй раз в те сутки, когда он уже работает в другом месте.
    const user = makeUser({
      daysOffUsers: [7],
      externalShifts: { 7: { shiftType: "day", warehouse: "SP-3" } },
    })
    expect(dayKind(user, 7)).toBe("externalDay")
  })

  it("отличает выходной по настройкам от пустого дня", () => {
    expect(dayKind(makeUser({ daysOffUsers: [9] }), 9)).toBe("prefsOff")
    expect(dayKind(makeUser(), 9)).toBe("empty")
  })

  it("не падает на неизвестной отметке из сети", () => {
    const user = makeUser({
      marks: { 4: "compensation" as DayMarkKind },
      daysOffUsers: [4],
    })
    expect(dayKind(user, 4)).toBe("prefsOff")
  })

  it("ничего не находит за пределами месяца", () => {
    expect(dayKind(makeUser({ dayShifts: [1] }), 31)).toBe("empty")
  })
})

describe("dayVisual", () => {
  it("подставляет склад в подсказку чужой смены", () => {
    const user = makeUser({
      externalShifts: { 2: { shiftType: "day", warehouse: "SMALL-P3" } },
    })
    expect(dayVisual(user, 2).title).toContain("SMALL-P3")
  })

  it("не оставляет пустого названия склада в подсказке", () => {
    const user = makeUser({
      externalShifts: { 2: { shiftType: "night", warehouse: "" } },
    })
    const visual = dayVisual(user, 2)
    expect(visual.title).toBe("Ночная смена на другом складе")
    expect(visual.title.endsWith(": ")).toBe(false)
  })

  it("даёт подпись и цвет каждому состоянию", () => {
    for (const kind of ALL_KINDS) {
      const user = userFor(kind)
      const visual = dayVisual(user, 1)
      expect(visual.kind).toBe(kind)
      expect(visual.label.length).toBeGreaterThan(0)
      expect(visual.className.length).toBeGreaterThan(0)
      expect(visual.title.length).toBeGreaterThan(0)
    }
  })
})

describe("таблицы оформления", () => {
  it("описывает цвета Excel для каждого состояния", () => {
    for (const kind of ALL_KINDS) {
      expect(EXCEL_FILL[kind]?.fill).toMatch(/^FF[0-9A-F]{6}$/)
      expect(EXCEL_FILL[kind]?.text).toMatch(/^FF[0-9A-F]{6}$/)
    }
  })

  it("не повторяет состояния в расшифровке", () => {
    const keys = DAY_LEGEND.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("объясняет в расшифровке всё, что встречается в сетке", () => {
    // Пустой день — это отсутствие отметки; отдельная плашка «не задано» в
    // расшифровке только добавляла бы строку, не добавляя смысла. Чужая ночная
    // смена объяснена плашкой чужой дневной: понятие одно, различает их только
    // буква в клетке, и вторая такая же плашка была бы шумом.
    const described = new Set<string>(DAY_LEGEND.map((item) => item.key))
    if (described.has("externalDay")) described.add("externalNight")
    for (const kind of ALL_KINDS) {
      if (kind === "empty") continue
      expect(described.has(kind)).toBe(true)
    }
  })

  it("рисует чужую смену одним цветом, но разными буквами", () => {
    const day = dayVisual(userFor("externalDay"), 1)
    const night = dayVisual(userFor("externalNight"), 1)
    expect(day.className).toBe(night.className)
    expect(day.label).toBe("D")
    expect(night.label).toBe("N")
  })
})

function userFor(kind: DayKind): IUser {
  switch (kind) {
    case "day":
      return makeUser({ dayShifts: [1] })
    case "night":
      return makeUser({ nightShifts: [1] })
    case "off":
      return makeUser({ marks: { 1: "off" } })
    case "vacation":
      return makeUser({ marks: { 1: "vacation" } })
    case "sick":
      return makeUser({ marks: { 1: "sick" } })
    case "unavailableHere":
      // Вид отметки с сервера и состояние клетки называются по-разному.
      return makeUser({ marks: { 1: "unavailable" } })
    case "externalDay":
      return makeUser({
        externalShifts: { 1: { shiftType: "day", warehouse: "SP-3" } },
      })
    case "externalNight":
      return makeUser({
        externalShifts: { 1: { shiftType: "night", warehouse: "SP-3" } },
      })
    case "prefsOff":
      return makeUser({ daysOffUsers: [1] })
    case "empty":
      return makeUser()
  }
}
