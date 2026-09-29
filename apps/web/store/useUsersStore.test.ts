import { beforeEach, describe, expect, it } from "vitest"

import type { DayMarkKind } from "@/lib/api/types"
import { useUsersStore } from "@/store/useUsersStore"
import type { IUser } from "@/types/User"

/**
 * Тесты локального применения правок дня.
 *
 * Поводом стал `unavailable`: ветка «отметка» перечисляла три вида поимённо,
 * новый вид в неё не попал, и отметка стиралась из таблицы сразу после клика —
 * со стороны это выглядело как «не сохраняется», хотя в базе она была.
 */

const BASE_USER: Omit<IUser, "subject"> = {
  kind: "employee",
  id: 1,
  fullName: "Анна",
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

function only(): IUser {
  const user = useUsersStore.getState().users[0]
  if (!user) throw new Error("в хранилище нет работника")
  return user
}

const MARKS: DayMarkKind[] = ["off", "vacation", "sick", "unavailable"]

beforeEach(() => {
  useUsersStore.setState({ users: [makeUser()] })
})

describe("setUserDay", () => {
  it.each(MARKS)("ставит отметку «%s»", (kind) => {
    useUsersStore.getState().setUserDay("e1", 5, kind, false)

    expect(only().marks[5]).toBe(kind)
    expect(only().dayShifts).toEqual([])
    expect(only().nightShifts).toEqual([])
  })

  it("снимает смену, когда ставит отметку", () => {
    useUsersStore.setState({ users: [makeUser({ dayShifts: [5], pinnedDays: [5] })] })

    useUsersStore.getState().setUserDay("e1", 5, "unavailable", false)

    expect(only().dayShifts).toEqual([])
    expect(only().pinnedDays).toEqual([])
    expect(only().marks[5]).toBe("unavailable")
  })

  it("ставит закреплённую смену и снимает отметку", () => {
    useUsersStore.setState({ users: [makeUser({ marks: { 5: "unavailable" } })] })

    useUsersStore.getState().setUserDay("e1", 5, "night", true)

    expect(only().marks).toEqual({})
    expect(only().nightShifts).toEqual([5])
    expect(only().pinnedDays).toEqual([5])
  })

  it("чистит день целиком", () => {
    useUsersStore.setState({
      users: [makeUser({ dayShifts: [5], pinnedDays: [5], marks: { 6: "sick" } })],
    })

    useUsersStore.getState().setUserDay("e1", 5, "none", false)

    expect(only().dayShifts).toEqual([])
    expect(only().pinnedDays).toEqual([])
    // Соседний день правка не задевает.
    expect(only().marks[6]).toBe("sick")
  })

  it("меняет одну отметку на другую", () => {
    useUsersStore.setState({ users: [makeUser({ marks: { 5: "vacation" } })] })

    useUsersStore.getState().setUserDay("e1", 5, "unavailable", false)

    expect(only().marks).toEqual({ 5: "unavailable" })
  })
})

describe("setUserPin", () => {
  it("закрепляет и открепляет день", () => {
    useUsersStore.setState({ users: [makeUser({ dayShifts: [5] })] })

    useUsersStore.getState().setUserPin("e1", 5, true)
    expect(only().pinnedDays).toEqual([5])

    useUsersStore.getState().setUserPin("e1", 5, false)
    expect(only().pinnedDays).toEqual([])
  })

  it("не трогает саму смену", () => {
    useUsersStore.setState({ users: [makeUser({ dayShifts: [5] })] })

    useUsersStore.getState().setUserPin("e1", 5, true)

    expect(only().dayShifts).toEqual([5])
  })
})

describe("applySchedule", () => {
  it("проставляет смены и закрепление из раскладки генератора", () => {
    useUsersStore.getState().applySchedule({
      e1: { dayShifts: [2], nightShifts: [3], pinnedDays: [2] },
    })

    expect(only().dayShifts).toEqual([2])
    expect(only().nightShifts).toEqual([3])
    expect(only().pinnedDays).toEqual([2])
  })

  it("обнуляет всё у участника, которого нет в раскладке", () => {
    useUsersStore.setState({
      users: [makeUser({ dayShifts: [1], nightShifts: [2], pinnedDays: [1] })],
    })

    useUsersStore.getState().applySchedule({})

    expect(only().dayShifts).toEqual([])
    expect(only().nightShifts).toEqual([])
    expect(only().pinnedDays).toEqual([])
  })

  it("оставляет отметки дня нетронутыми", () => {
    // Отметки живут отдельно от графика: пересборка месяца их не касается.
    useUsersStore.setState({ users: [makeUser({ marks: { 4: "unavailable" } })] })

    useUsersStore.getState().applySchedule({
      e1: { dayShifts: [5], nightShifts: [], pinnedDays: [] },
    })

    expect(only().marks).toEqual({ 4: "unavailable" })
  })
})
