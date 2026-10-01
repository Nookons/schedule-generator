import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { toUsers } from "@/lib/employeeMapping"
import { seededRandom } from "@/lib/random"
import type { ScheduleParticipant } from "@/lib/api/types"
import {
  generateSchedule,
  repairSchedule,
  type GenerationResult,
  type GeneratorSettings,
} from "@/lib/scheduleGenerator"
import type { IUser } from "@/types/User"

/**
 * Тесты пересбора с минимальными правками.
 *
 * Поводом стала рабочая ситуация: менеджер правит график одному работнику —
 * убирает смену, ставит отпуск, — а «Построить график» пересобирает месяц
 * целиком, и у всех остальных смены перетасовываются без причины. Проверяется
 * обратное свойство: чужие смены остаются на месте, а двигается только то, что
 * мешает закрыть слот или нарушает правило.
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
    dayCount: 1,
    nightCount: 1,
    afterNightDayOffs: 1,
    afterDayDayOffs: 0,
    daysInMonth: 12,
    frozenThroughDay: 0,
    ...overrides,
  }
}

type Schedule = GenerationResult["schedule"]

/** Раскладка участника: без проверки на undefined в каждом тесте. */
function planOf(schedule: Schedule, subject: string) {
  const plan = schedule[subject]
  if (!plan) throw new Error(`в раскладке нет участника ${subject}`)
  return plan
}

/** Дни работника в этом складе, независимо от типа смены. */
function daysOf(schedule: Schedule, subject: string): number[] {
  const plan = planOf(schedule, subject)
  return [...plan.dayShifts, ...plan.nightShifts].sort((a, b) => a - b)
}

/** Сколько человек выходит в этот день в смену этого типа. */
function coverage(schedule: Schedule, day: number, type: "day" | "night"): number {
  const key = type === "day" ? "dayShifts" : "nightShifts"
  return Object.values(schedule).filter((plan) => plan[key].includes(day)).length
}

/**
 * Отдаёт построенный график обратно как «текущий».
 *
 * Ровно это делает хранилище после построения: раскладка становится составом
 * работников, и следующий пересбор отталкивается уже от неё.
 */
function asDraft(users: IUser[], schedule: Schedule): IUser[] {
  return users.map((user) => {
    const plan = planOf(schedule, user.subject)
    return {
      ...user,
      dayShifts: [...plan.dayShifts],
      nightShifts: [...plan.nightShifts],
      pinnedDays: [...plan.pinnedDays],
    }
  })
}

/** Раскладка в сравнимом виде: дни отсортированы, как их хранит хранилище. */
function normalized(schedule: Schedule) {
  return Object.fromEntries(
    Object.entries(schedule).map(([subject, plan]) => [
      subject,
      {
        dayShifts: [...plan.dayShifts].sort((a, b) => a - b),
        nightShifts: [...plan.nightShifts].sort((a, b) => a - b),
        pinnedDays: [...plan.pinnedDays].sort((a, b) => a - b),
      },
    ])
  )
}

const crew = () => [
  makeUser({ subject: "e1", fullName: "Первый" }),
  makeUser({ subject: "e2", fullName: "Второй" }),
  makeUser({ subject: "e3", fullName: "Третий" }),
  makeUser({ subject: "e4", fullName: "Четвёртый" }),
]

describe("пересбор не трогает то, что не сломано", () => {
  it("оставляет согласованный график без единой правки", () => {
    const config = settings({ dayCount: 2, nightCount: 2, daysInMonth: 14 })

    // Прогонов несколько с разными зёрнами: построение детерминировано по входу,
    // и один прогон ничего не доказывает — нужны разные раскладки.
    for (let run = 0; run < 5; run++) {
      const users = crew()
      const built = generateSchedule(users, config, {
        random: seededRandom(run + 1),
      })
      const draft = asDraft(users, built.schedule)

      const { changes, schedule } = repairSchedule(draft, config)

      expect(changes).toEqual([])
      expect(normalized(schedule)).toEqual(normalized(built.schedule))
    }
  })

  it("не переставляет смены между работниками ради красоты", () => {
    const config = settings({ dayCount: 2, nightCount: 2, daysInMonth: 14 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    const { schedule } = repairSchedule(draft, config)

    // Нагрузка в исходной раскладке могла быть неровной, но выравнивать её
    // здесь нечем: выравнивание — это перестановки, то есть правки.
    for (const user of draft) {
      expect(daysOf(schedule, user.subject)).toEqual(daysOf(built.schedule, user.subject))
    }
  })
})

describe("правка одного работника переживает перебор остальных", () => {
  it("закрывает освободившийся день другим человеком, а не тем же самым", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Менеджер убрал у первого его рабочий день: ровно то, что делает клик
    // «Очистить день» в клетке.
    const victim = draft.find((user) => user.dayShifts.length > 0)!
    const cleared = victim.dayShifts[0]!
    victim.dayShifts = victim.dayShifts.filter((day) => day !== cleared)

    const { changes, schedule } = repairSchedule(draft, config, {
      frozenSubjects: [victim.subject],
    })

    // День снова закрыт — но уже другим человеком.
    expect(coverage(schedule, cleared, "day")).toBe(1)
    expect(planOf(schedule, victim.subject).dayShifts).not.toContain(cleared)

    // Изменена ровно одна клетка: добавление у того, кто закрыл день.
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ day: cleared, from: null, to: "day" })
    expect(changes[0]!.subject).not.toBe(victim.subject)

    // У всех, кроме закрывшего день, раскладка не изменилась.
    for (const user of draft) {
      if (user.subject === changes[0]!.subject) continue
      expect(normalized({ [user.subject]: planOf(schedule, user.subject) })).toEqual(
        normalized({
          [user.subject]: {
            dayShifts: user.dayShifts,
            nightShifts: user.nightShifts,
            pinnedDays: user.pinnedDays,
          },
        })
      )
    }
  })

  it("не отменяет ручную правку, даже если день остался пустым", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    const victim = draft.find((user) => user.dayShifts.length > 0)!
    const cleared = victim.dayShifts[0]!
    victim.dayShifts = victim.dayShifts.filter((day) => day !== cleared)

    const { schedule } = repairSchedule(draft, config, {
      frozenSubjects: [victim.subject],
    })

    // Заморозка и есть разница между «в этом дне у него пусто» и «в этом дне
    // ему не место»: без неё пересбор вернул бы смену тому же человеку,
    // потому что после правки он самый незагруженный.
    expect(daysOf(schedule, victim.subject)).toEqual(
      [...victim.dayShifts, ...victim.nightShifts].sort((a, b) => a - b)
    )
  })
})

describe("нарушения, появившиеся после ручной правки", () => {
  it("снимает день, поставленный сразу после ночи", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Менеджер поставил человеку день сразу после его же ночи. Сервер такую
    // правку принимает — правила отдыха проверяет алгоритм, а не он.
    const offender = draft.find(
      (user) =>
        user.nightShifts.some(
          (day) => day + 1 <= config.daysInMonth && !daysOf(built.schedule, user.subject).includes(day + 1)
        )
    )!
    const night = offender.nightShifts.find(
      (day) => !daysOf(built.schedule, offender.subject).includes(day + 1)
    )!
    const broken = night + 1
    offender.dayShifts = [...offender.dayShifts, broken].sort((a, b) => a - b)

    const { schedule } = repairSchedule(draft, config)

    // Правило важнее правки: день после ночи не остаётся.
    expect(planOf(schedule, offender.subject).dayShifts).not.toContain(broken)
    // А ночь остаётся: виноват день, а не она. Если снимать ночь, пересбор
    // отменил бы уже согласованную смену вместо только что поставленной и
    // оставил бы дырку в ночном слоте.
    expect(planOf(schedule, offender.subject).nightShifts).toContain(night)
    expect(coverage(schedule, night, "night")).toBe(1)
    // И дневной слот не остаётся пустым — его закрывает кто-то другой.
    expect(coverage(schedule, broken, "day")).toBe(1)
  })

  it("снимает смены человека, ушедшего в отпуск, и закрывает его дни", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    const resting = draft.find((user) => daysOf(built.schedule, user.subject).length >= 3)!
    const vacation = daysOf(built.schedule, resting.subject).slice(0, 3)
    resting.marks = Object.fromEntries(vacation.map((day) => [day, "vacation" as const]))

    const { schedule } = repairSchedule(draft, config)

    // Отпуск действует на всех складах и снимает человека с этих дней.
    for (const day of vacation) {
      expect(planOf(schedule, resting.subject).dayShifts).not.toContain(day)
      expect(planOf(schedule, resting.subject).nightShifts).not.toContain(day)
    }

    // Дни закрыты остальными: людей хватает, значит пропусков быть не должно.
    for (const day of vacation) {
      const filled =
        coverage(schedule, day, "day") + coverage(schedule, day, "night")
      expect(filled).toBeGreaterThan(0)
    }

    // Вне отпуска у человека всё как было.
    const outside = daysOf(built.schedule, resting.subject).filter(
      (day) => !vacation.includes(day)
    )
    expect(daysOf(schedule, resting.subject)).toEqual(outside)
  })

  it("снимает лишнее сверх месячного максимума", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Прошлый прогон или ручная правка могли выдать больше, чем разрешено: в
    // полной пересборке максимум — штраф, а не запрет, и такого она не ловит.
    // Здесь правило меняется задним числом: «этому не больше двух смен».
    const overworked = draft.reduce((a, b) =>
      daysOf(built.schedule, b.subject).length >
      daysOf(built.schedule, a.subject).length
        ? b
        : a
    )
    const before = daysOf(built.schedule, overworked.subject)
    expect(before.length).toBeGreaterThan(2)

    overworked.maxShiftsPerMonth = 2

    const { schedule } = repairSchedule(draft, config)

    expect(daysOf(schedule, overworked.subject).length).toBeLessThanOrEqual(2)

    // Освободившиеся дни закрыты, а не брошены: людей в составе хватает.
    for (const day of before) {
      const type = planOf(built.schedule, overworked.subject).dayShifts.includes(day)
        ? ("day" as const)
        : ("night" as const)
      expect(coverage(schedule, day, type)).toBe(1)
    }
  })
})

describe("якоря пересбора", () => {
  it("оставляет закреплённые дни на месте", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    const anchored = draft.find((user) => user.dayShifts.length > 0)!
    anchored.pinnedDays = [anchored.dayShifts[0]!]

    const { schedule } = repairSchedule(draft, config)

    expect(planOf(schedule, anchored.subject).dayShifts).toContain(
      anchored.dayShifts[0]
    )
    expect(planOf(schedule, anchored.subject).pinnedDays).toContain(
      anchored.dayShifts[0]
    )
  })

  it("не переставляет прошедшие дни, даже если они нарушают правила", () => {
    const config = settings({ dayCount: 1, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Первому в прошедший день ставим день сразу после ночи: человек его уже
    // отработал, и задним числом график не переписывается.
    const past = 4
    const worker = draft[0]!
    worker.dayShifts = [past]
    worker.nightShifts = [past - 1]

    const { schedule } = repairSchedule(draft, settings({ ...config, frozenThroughDay: past }))

    expect(planOf(schedule, worker.subject).dayShifts).toContain(past)
    expect(planOf(schedule, worker.subject).nightShifts).toContain(past - 1)
  })
})

describe("крайние случаи", () => {
  it("не падает на пустом составе", () => {
    const result = repairSchedule([], settings())

    expect(result.schedule).toEqual({})
    expect(result.changes).toEqual([])
    expect(result.unfilledSlots).toEqual([])
  })

  it("на пустом графике закрывает слоты, но не выдумывает правки", () => {
    const result = repairSchedule(crew(), settings({ dayCount: 1, nightCount: 1 }))

    // Сохранять было нечего: правок нет, но покрытие собрано.
    expect(result.changes.length).toBeGreaterThan(0)
    expect(coverage(result.schedule, 1, "day")).toBe(1)
  })
})

/**
 * Норма — «ровно столько, сколько задано», а не «хотя бы».
 *
 * Поводом стала ручная правка: менеджер переносит человека на другой день, и
 * новый день оказывается с лишним — пять человек там, где нужно четыре. Добор
 * покрытия лечил только опустевший день, а переполненный оставался как есть.
 */
describe("норма соблюдается ровно", () => {
  /** Свободен в этот день и не выходит в ночь накануне: день ему ставить можно. */
  function freeForDay(users: IUser[], schedule: Schedule, day: number) {
    return users.find(
      (user) =>
        !daysOf(schedule, user.subject).includes(day) &&
        !planOf(schedule, user.subject).nightShifts.includes(day - 1)
    )!
  }

  /** День, на котором ровно двое дневных: есть куда добавить третьего. */
  function dayWithFullDaySlot(schedule: Schedule, dayCount: number): number {
    for (let day = 1; day <= 30; day++) {
      if (coverage(schedule, day, "day") === dayCount) return day
    }
    throw new Error("не нашлось дня с полным дневным слотом")
  }

  it("сводит пять человек к четырём, когда норма четыре", () => {
    // Ровно тот случай, из-за которого режим и правился: в дне пять человек,
    // а нужно четыре. «Не меньше» здесь не годится — норма это ровно четыре.
    const config = settings({ dayCount: 4, nightCount: 1, daysInMonth: 10 })
    const users = Array.from({ length: 6 }, (_, i) =>
      makeUser({ subject: `e${i + 1}`, fullName: `Работник ${i + 1}` })
    )
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    const day = dayWithFullDaySlot(built.schedule, config.dayCount)
    const extra = freeForDay(draft, built.schedule, day)
    extra.dayShifts = [...extra.dayShifts, day].sort((a, b) => a - b)

    const asSchedule = (list: IUser[]): Schedule =>
      Object.fromEntries(
        list.map((user) => [
          user.subject,
          {
            dayShifts: user.dayShifts,
            nightShifts: user.nightShifts,
            pinnedDays: user.pinnedDays,
          },
        ])
      )

    // Предпосылка теста: до пересбора в дне действительно пять человек.
    expect(coverage(asSchedule(draft), day, "day")).toBe(config.dayCount + 1)

    const { schedule } = repairSchedule(draft, config)

    expect(coverage(schedule, day, "day")).toBe(config.dayCount)
  })

  it("снимает лишнего с переполненного дня", () => {
    const config = settings({ dayCount: 2, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Менеджер добавил в день третьего человека — при норме два.
    const day = dayWithFullDaySlot(built.schedule, config.dayCount)
    const extra = freeForDay(draft, built.schedule, day)
    extra.dayShifts = [...extra.dayShifts, day].sort((a, b) => a - b)

    const { changes, schedule } = repairSchedule(draft, config)

    expect(coverage(schedule, day, "day")).toBe(config.dayCount)
    // Ровно одна правка — снятие лишнего, и ничего больше.
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ day, to: null })
  })

  it("переносит лишнего на опустевший день", () => {
    const config = settings({ dayCount: 2, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Один день переполнен, другой опустел — обычный след ручного переноса.
    const overloaded = dayWithFullDaySlot(built.schedule, config.dayCount)
    const extra = freeForDay(draft, built.schedule, overloaded)
    extra.dayShifts = [...extra.dayShifts, overloaded].sort((a, b) => a - b)

    const emptied = extra.dayShifts.find((day) => day !== overloaded)!
    extra.dayShifts = extra.dayShifts.filter((day) => day !== emptied)

    const { changes, schedule } = repairSchedule(draft, config)

    expect(coverage(schedule, overloaded, "day")).toBe(config.dayCount)
    expect(coverage(schedule, emptied, "day")).toBe(config.dayCount)
    // Снятие в одном дне и добавление в другом: это и есть перенос.
    expect(changes).toHaveLength(2)
    expect(changes.filter((change) => change.to === null)).toHaveLength(1)
    expect(changes.filter((change) => change.from === null)).toHaveLength(1)
  })

  it("не трогает закреплённый излишек, но сообщает о нём", () => {
    const config = settings({ dayCount: 2, nightCount: 1, daysInMonth: 12 })
    const users = crew()
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    const day = dayWithFullDaySlot(built.schedule, config.dayCount)
    const extra = freeForDay(draft, built.schedule, day)
    extra.dayShifts = [...extra.dayShifts, day].sort((a, b) => a - b)

    // Весь день поставлен руками, значит закреплён целиком: снять нечего.
    for (const user of draft) {
      if (!user.dayShifts.includes(day)) continue
      user.pinnedDays = [...user.pinnedDays, day]
    }

    const { changes, schedule, excessSlots } = repairSchedule(draft, config)

    expect(coverage(schedule, day, "day")).toBe(config.dayCount + 1)
    expect(changes).toEqual([])
    // Молча оставить переполненный день нельзя: об этом сказано явно.
    expect(excessSlots).toContainEqual({
      day,
      type: "Day",
      needed: config.dayCount,
      filled: config.dayCount + 1,
    })
  })

  it("полная пересборка тоже сообщает о закреплённом переполнении", () => {
    const config = settings({ dayCount: 2, nightCount: 1, daysInMonth: 12 })
    const day = 5
    // Трое закреплены на день, где нужно двое: алгоритм их не снимает.
    const users = [
      makeUser({ subject: "e1", dayShifts: [day], pinnedDays: [day] }),
      makeUser({ subject: "e2", dayShifts: [day], pinnedDays: [day] }),
      makeUser({ subject: "e3", dayShifts: [day], pinnedDays: [day] }),
      makeUser({ subject: "e4" }),
    ]

    const { schedule, excessSlots } = generateSchedule(users, config)

    expect(coverage(schedule, day, "day")).toBe(3)
    expect(excessSlots).toContainEqual({
      day,
      type: "Day",
      needed: config.dayCount,
      filled: 3,
    })
  })
})

describe("реальный склад", () => {
  const fixture: { warehouse: string; month: string; rows: ScheduleParticipant[] } =
    JSON.parse(
      readFileSync(
        new URL("./__fixtures__/warehouse-participants.json", import.meta.url),
        "utf8"
      )
    )
  const config = settings({ dayCount: 2, nightCount: 2, daysInMonth: 30 })

  it("правит только то, что сломала ручная правка", () => {
    const users = toUsers(fixture.rows)
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Менеджер снимает один день у одного работника.
    const victim = draft.find(
      (user) => user.dayShifts.length > 0 || user.nightShifts.length > 0
    )!
    const fromDay = [...victim.dayShifts, ...victim.nightShifts].sort((a, b) => a - b)[0]!
    const type = victim.dayShifts.includes(fromDay) ? "dayShifts" : "nightShifts"
    victim[type] = victim[type].filter((day) => day !== fromDay)

    const { changes, schedule, unfilledSlots } = repairSchedule(draft, config, {
      frozenSubjects: [victim.subject],
    })

    const kind = type === "dayShifts" ? ("day" as const) : ("night" as const)

    // Строка замороженного работника не изменилась ни в одной клетке.
    expect(normalized({ s: planOf(schedule, victim.subject) }).s).toEqual(
      normalized({
        s: {
          dayShifts: victim.dayShifts,
          nightShifts: victim.nightShifts,
          pinnedDays: victim.pinnedDays,
        },
      }).s
    )

    // Правок мало: пересбор не перетасовал месяц.
    expect(changes.length).toBeLessThanOrEqual(4)

    // Покрытие не стало хуже, чем после ручной правки, и если слот всё ещё не
    // закрыт, об этом сказано прямо. На реальном складе закрыть его удаётся не
    // всегда: после ночи день не ставится, и свободных людей может не остаться.
    // Молча оставить дырку нельзя, но и выдумать кандидата в обход правил тоже.
    const filled = coverage(schedule, fromDay, kind)
    expect(filled).toBeGreaterThanOrEqual(
      coverage(built.schedule, fromDay, kind) - 1
    )

    const needed = kind === "day" ? config.dayCount : config.nightCount
    if (filled < needed) {
      expect(
        unfilledSlots.some(
          (slot) => slot.day === fromDay && slot.type.toLowerCase() === kind
        )
      ).toBe(true)
    }
  })

  it("не оставляет день после ночи — ни своей, ни чужой", () => {
    const users = toUsers(fixture.rows)
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Ломаем график руками в нескольких местах сразу.
    const offender = draft[0]!
    const day = [...offender.dayShifts, ...offender.nightShifts].sort((a, b) => a - b)[0]!
    if (offender.dayShifts.includes(day)) {
      offender.nightShifts = [...offender.nightShifts, day + 1].sort((a, b) => a - b)
    } else {
      offender.dayShifts = [...offender.dayShifts, day + 1].sort((a, b) => a - b)
    }

    const { schedule } = repairSchedule(draft, config)

    for (const user of draft) {
      const nights = new Set<number>()
      for (const [rawDay, shift] of Object.entries(user.externalShifts)) {
        if (shift.shiftType === "night") nights.add(Number(rawDay))
      }
      for (const night of planOf(schedule, user.subject).nightShifts) {
        nights.add(night)
      }

      for (const dayShift of planOf(schedule, user.subject).dayShifts) {
        expect(
          nights.has(dayShift - 1),
          `${user.fullName}: день ${dayShift} сразу после ночи ${dayShift - 1}`
        ).toBe(false)
      }
    }
  })

  it("доводит каждый слот ровно до нормы — или объясняет, почему не смог", () => {
    const users = toUsers(fixture.rows)
    const built = generateSchedule(users, config)
    const draft = asDraft(users, built.schedule)

    // Ручной перенос: человека снимаем с одного дня и ставим в другой, где его
    // не было. Так и появляется пара «опустевший день + переполненный».
    const mover = draft.find((user) => user.dayShifts.length >= 2)!
    const from = mover.dayShifts[0]!
    const to = Array.from({ length: config.daysInMonth }, (_, i) => i + 1).find(
      (day) => !daysOf(built.schedule, mover.subject).includes(day)
    )!
    mover.dayShifts = [
      ...mover.dayShifts.filter((day) => day !== from),
      to,
    ].sort((a, b) => a - b)

    // И в тот же день добавляем ещё одного — уже сверх нормы.
    const spare = draft.find(
      (user) =>
        user.subject !== mover.subject &&
        !daysOf(built.schedule, user.subject).includes(to)
    )!
    spare.dayShifts = [...spare.dayShifts, to].sort((a, b) => a - b)

    const result = repairSchedule(draft, config)

    const reported = (day: number, kind: "day" | "night") =>
      result.unfilledSlots.some(
        (slot) => slot.day === day && slot.type.toLowerCase() === kind
      ) ||
      result.excessSlots.some(
        (slot) => slot.day === day && slot.type.toLowerCase() === kind
      )

    // Инвариант нормы: слот либо ровно по норме, либо назван в отчёте. Третьего
    // быть не может — молча оставить день переполненным или пустым нельзя.
    for (let day = 1; day <= config.daysInMonth; day++) {
      for (const kind of ["day", "night"] as const) {
        const needed = kind === "day" ? config.dayCount : config.nightCount
        const filled = coverage(result.schedule, day, kind)
        if (reported(day, kind)) continue
        expect(
          filled,
          `день ${day}, ${kind}: ${filled} при норме ${needed}`
        ).toBe(needed)
      }
    }
  })
})
