import { describe, expect, it } from "vitest"

import {
  currentLoad,
  fitsBlock,
  generateSchedule,
  isMidBlock,
  type GenerationResult,
  type GeneratorSettings,
} from "@/lib/scheduleGenerator"
import type { IUser } from "@/types/User"

/**
 * Тесты алгоритма построения графика.
 *
 * Поводом стали два дефекта, которые видно только на нескольких складах сразу:
 * после ночной смены на другом складе ставился день, а выравнивание нагрузки
 * считало только смены текущего склада и добивало того, кто уже загружен в
 * другом месте. Оба сводятся к одному: чужие смены не попадали в карту
 * занятости алгоритма.
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
    daysInMonth: 10,
    // По умолчанию месяц не ограничен: тесты про заморозку задают
    // границу явно, остальным она только мешала бы.
    frozenThroughDay: 0,
    ...overrides,
  }
}

/** Смены на другом складе по списку дней. */
function external(days: number[], shiftType: "day" | "night", warehouse = "PNT-A") {
  return Object.fromEntries(
    days.map((day) => [day, { shiftType, warehouse }])
  ) as IUser["externalShifts"]
}

type Schedule = GenerationResult["schedule"]

/** Раскладка участника: отдельная функция, чтобы индекс не был «возможно undefined». */
function planOf(schedule: Schedule, subject: string) {
  const plan = schedule[subject]
  if (!plan) throw new Error(`в раскладке нет участника ${subject}`)
  return plan
}

/** Суммарная нагрузка: свои смены плюс смены на других складах. */
function totalOf(user: IUser, schedule: Schedule): number {
  const own = planOf(schedule, user.subject)
  return (
    own.dayShifts.length +
    own.nightShifts.length +
    Object.keys(user.externalShifts).length
  )
}

/**
 * Прогоняет построение несколько раз и возвращает раскладки.
 *
 * Алгоритм добавляет к счёту случайный разброс, чтобы ничьи не решались всегда
 * в пользу первого в списке. Из-за этого один прогон ничего не доказывает:
 * свойство нужно проверять на серии, иначе тест проходит и на сломанном коде
 * примерно в половине случаев.
 */
function generateRepeatedly(
  users: IUser[],
  config: GeneratorSettings,
  runs = 15
): Schedule[] {
  return Array.from({ length: runs }, () => generateSchedule(users, config).schedule)
}

describe("смены на других складах", () => {
  it("не ставит день после ночи, отработанной на другом складе", () => {
    // Ровно тот случай из жалобы: ночь на чужом складе, следом день здесь.
    const users = [makeUser({ subject: "e1", externalShifts: external([5], "night") })]

    const { schedule } = generateSchedule(
      users,
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 10 })
    )
    const plan = planOf(schedule, "e1")

    expect(plan.dayShifts).not.toContain(6)
    // Для сравнения: обычный день ставится, то есть дело именно в правиле.
    expect(plan.dayShifts).toContain(4)
  })

  it("не записывает чужие смены в график этого склада", () => {
    const users = [
      makeUser({ subject: "e1", externalShifts: external([2, 3], "night") }),
    ]

    const { schedule } = generateSchedule(
      users,
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 6 })
    )
    const plan = planOf(schedule, "e1")

    // Дни 2 и 3 принадлежат другому складу: сохранять их сюда нельзя.
    expect(plan.nightShifts).toEqual([])
    expect(plan.dayShifts).not.toContain(2)
    expect(plan.dayShifts).not.toContain(3)
  })

  it("не превращает чужую смену в местную", () => {
    const users = [
      makeUser({ subject: "e1", externalShifts: external([1], "day") }),
      makeUser({ subject: "e2", id: 2 }),
    ]

    const { schedule } = generateSchedule(
      users,
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 4 })
    )

    expect(planOf(schedule, "e1").dayShifts).not.toContain(1)
    // А сам день закрывает свободный: смена нужна складу, и взять её больше
    // некому — это не «переезд» чужой смены, а обычное назначение.
    expect(planOf(schedule, "e2").dayShifts).toContain(1)
  })

  it("не теряет покрытие на дне, занятом другим складом", () => {
    const busy = makeUser({ subject: "e1", externalShifts: external([1, 2, 3], "day") })
    const free = makeUser({ subject: "e2", id: 2 })

    for (const schedule of generateRepeatedly(
      [busy, free],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 8 })
    )) {
      for (const day of [1, 2, 3]) {
        // День обязан быть закрыт свободным, а не «назначен» занятому и
        // потерян при сохранении.
        expect(planOf(schedule, "e2").dayShifts).toContain(day)
      }
    }
  })
})

describe("выравнивание нагрузки", () => {
  it("считает загрузку по всем складам, а не только по этому", () => {
    // e1 уже отработал пять дней в другом месте, e2 свободен.
    const heavy = makeUser({
      subject: "e1",
      externalShifts: external([1, 2, 3, 4, 5], "day"),
    })
    const free = makeUser({ subject: "e2", id: 2 })

    for (const schedule of generateRepeatedly(
      [heavy, free],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 20 })
    )) {
      // Суммарная нагрузка должна сойтись. Если бы считались только местные
      // смены, heavy добрал бы столько же, сколько free, и оказался бы
      // загружен вдвое сильнее.
      expect(
        Math.abs(totalOf(heavy, schedule) - totalOf(free, schedule))
      ).toBeLessThanOrEqual(3)
    }
  })
})

describe("свои ограничения продолжают работать", () => {
  it("отметка дня закрывает день", () => {
    const user = makeUser({ subject: "e1", marks: { 3: "vacation" } })

    const { schedule } = generateSchedule(
      [user],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 6 })
    )

    expect(planOf(schedule, "e1").dayShifts).not.toContain(3)
  })

  it("выходной по постоянным настройкам закрывает день", () => {
    const user = makeUser({ subject: "e1", daysOffUsers: [4] })

    const { schedule } = generateSchedule(
      [user],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 6 })
    )

    expect(planOf(schedule, "e1").dayShifts).not.toContain(4)
  })

  it("предпочтение only_day не пускает в ночь", () => {
    const user = makeUser({ subject: "e1", shiftPreference: "only_day" })
    const other = makeUser({ subject: "e2", id: 2 })

    const { schedule } = generateSchedule(
      [user, other],
      settings({ dayCount: 1, nightCount: 1, daysInMonth: 5 })
    )

    expect(planOf(schedule, "e1").nightShifts).toEqual([])
    expect(planOf(schedule, "e2").nightShifts.length).toBeGreaterThan(0)
  })

  it("пустой состав не роняет построение", () => {
    const result = generateSchedule([], settings())
    expect(result.schedule).toEqual({})
    expect(result.unfilledSlots).toEqual([])
  })
})

/**
 * Свойство, которое обязано держаться при любой раскладке.
 *
 * Проверять его на удачно подобранном примере недостаточно: пост-проходы
 * двигают смены уже после основного расчёта, и нарушение отдыха появляется
 * только на некоторых сочетаниях. Поэтому состав перебирается случайно, но
 * воспроизводимо.
 */
describe("инвариант отдыха после ночи", () => {
  /** Линейный конгруэнтный генератор: нужен воспроизводимый «случай». */
  function makeRandom(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  function assertNoDayAfterNight(users: IUser[], schedule: Schedule) {
    for (const user of users) {
      const plan = planOf(schedule, user.subject)
      const nights = new Set<number>(plan.nightShifts)
      for (const [day, shift] of Object.entries(user.externalShifts)) {
        if (shift.shiftType === "night") nights.add(Number(day))
      }
      for (const day of plan.dayShifts) {
        expect(
          nights.has(day - 1),
          `${user.subject}: день ${day} сразу после ночи ${day - 1}`
        ).toBe(false)
      }
    }
  }

  it("держится на двухстах случайных составах", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = makeRandom(seed)
      const size = 2 + Math.floor(random() * 4)
      const users: IUser[] = Array.from({ length: size }, (_, index) => {
        const externalDays = Array.from({ length: 5 }, (_, i) => i + 1).filter(
          () => random() < 0.4
        )
        return makeUser({
          subject: `e${index + 1}`,
          id: index + 1,
          priority: 1 + Math.floor(random() * 3),
          shiftPreference: random() < 0.2 ? "all" : "all",
          externalShifts: externalDays.length
            ? external(
                externalDays,
                random() < 0.5 ? "day" : "night",
                "PNT-A"
              )
            : {},
          marks: random() < 0.2 ? { 9: "vacation" } : {},
        })
      })

      const { schedule } = generateSchedule(users, {
        dayCount: 1 + Math.floor(random() * 2),
        nightCount: 1 + Math.floor(random() * 2),
        afterNightDayOffs: 1,
        afterDayDayOffs: 0,
        daysInMonth: 14,
        frozenThroughDay: 0,
      })

      assertNoDayAfterNight(users, schedule)
    }
  })
})

describe("закреплённые дни", () => {
  const MONTH = settings({ dayCount: 1, nightCount: 1, daysInMonth: 10 })

  it("оставляет закреплённую смену на месте", () => {
    // Ровно жалоба менеджера: ночь поставлена кликом, «Построить график» её
    // стирал — месяц пересобирался целиком.
    const pinner = makeUser({
      subject: "e1",
      dayShifts: [3],
      pinnedDays: [3],
      maxShiftsPerMonth: 1,
    })
    const other = makeUser({ subject: "e2", id: 2 })

    for (const schedule of generateRepeatedly([pinner, other], MONTH)) {
      expect(planOf(schedule, "e1").dayShifts).toContain(3)
    }
  })

  it("не ставит второго человека в закреплённый день", () => {
    // Иначе смена стала бы двойной: сервер бы это пропустил, а склад получил
    // бы в этот день двух людей вместо одного.
    const pinner = makeUser({
      subject: "e1",
      dayShifts: [3],
      pinnedDays: [3],
      maxShiftsPerMonth: 1,
    })
    const other = makeUser({ subject: "e2", id: 2 })

    for (const schedule of generateRepeatedly([pinner, other], MONTH)) {
      expect(planOf(schedule, "e2").dayShifts).not.toContain(3)
    }
  })

  it("не считает закрытый закреплением слот незакрытым", () => {
    const pinner = makeUser({
      subject: "e1",
      dayShifts: [3],
      pinnedDays: [3],
      maxShiftsPerMonth: 1,
    })

    const { unfilledSlots } = generateSchedule([pinner], MONTH)

    // День 3 закрыт закреплённой сменой: предупреждать о нехватке людей в нём
    // не о чем. Ночь того же дня закрыть некому — о ней сказать нужно.
    expect(unfilledSlots.map((slot) => `${slot.day}${slot.type}`)).not.toContain(
      "3Day"
    )
    expect(unfilledSlots.map((slot) => `${slot.day}${slot.type}`)).toContain(
      "3Night"
    )
  })

  it("не отдаёт закреплённую смену при выравнивании нагрузки", () => {
    // Раскладка подобрана так, чтобы перенос закреплённого дня был единственным
    // возможным: у второго человека свободен ровно один день в месяце, и он же
    // закреплён за первым. Первый при этом перегружен, и балансировка обязана
    // хотеть этот день забрать. Забрать его может только отсутствие
    // закрепления, поэтому тест детерминированный, а не вероятностный.
    const pinned = makeUser({
      subject: "e1",
      dayShifts: [1, 2, 3, 4, 5, 6, 7, 8],
      pinnedDays: [2],
    })
    const backup = makeUser({
      subject: "e2",
      id: 2,
      daysOffUsers: [1, 3, 4, 5, 6, 7, 8, 9, 10],
    })

    for (const schedule of generateRepeatedly(
      [pinned, backup],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 10 }),
      30
    )) {
      expect(planOf(schedule, "e1").dayShifts).toContain(2)
      expect(planOf(schedule, "e2").dayShifts).not.toContain(2)
    }
  })

  it("сообщает в раскладке, какие дни закреплены", () => {
    const pinner = makeUser({
      subject: "e1",
      dayShifts: [3],
      nightShifts: [5],
      pinnedDays: [3],
      maxShiftsPerMonth: 2,
    })

    const { schedule } = generateSchedule([pinner], MONTH)

    // Признак возвращается вместе со сменами: клиент сохраняет месяц целиком и
    // обязан сказать серверу, какие дни остаются неприкосновенными.
    expect(planOf(schedule, "e1").pinnedDays).toEqual([3])
  })

  it("не закрепляет дни, поставленные прошлым прогоном алгоритма", () => {
    // Разница принципиальная: незакреплённое «Построить график» вправе
    // переставить, иначе кнопка после первого сохранения ничего не делала бы.
    const user = makeUser({
      subject: "e1",
      dayShifts: [1, 2, 3],
      pinnedDays: [],
    })

    const { schedule } = generateSchedule([user], MONTH)

    expect(planOf(schedule, "e1").pinnedDays).toEqual([])
  })

  it("видит закреплённую смену как занятость человека", () => {
    const pinner = makeUser({
      subject: "e1",
      nightShifts: [4],
      pinnedDays: [4],
    })

    for (const schedule of generateRepeatedly([pinner], MONTH)) {
      const plan = planOf(schedule, "e1")
      // День после закреплённой ночи не ставится — правило отдыха работает по
      // той же карте занятости, что и для обычных смен.
      expect(plan.dayShifts).not.toContain(5)
      expect(plan.nightShifts).toContain(4)
    }
  })

  it("держит закреплённые дни при повторных построениях", () => {
    const users = [
      makeUser({ subject: "e1", dayShifts: [2], pinnedDays: [2] }),
      makeUser({ subject: "e2", id: 2, nightShifts: [7], pinnedDays: [7] }),
      makeUser({ subject: "e3", id: 3 }),
    ]

    // Имитация «построить, сохранить, построить ещё раз»: раскладка предыдущего
    // прогона становится входом следующего вместе с закреплением.
    let current = users
    for (let round = 0; round < 5; round++) {
      const { schedule } = generateSchedule(current, MONTH)
      expect(planOf(schedule, "e1").dayShifts).toContain(2)
      expect(planOf(schedule, "e2").nightShifts).toContain(7)

      current = current.map((user) => {
        const plan = planOf(schedule, user.subject)
        return {
          ...user,
          dayShifts: plan.dayShifts,
          nightShifts: plan.nightShifts,
          pinnedDays: plan.pinnedDays,
        }
      })
    }
  })

  it("не пускает закреплённую смену в чужой месяц на другом складе", () => {
    // День занят другим складом: закреплённая строка этого склада устарела и
    // не должна ни попасть в раскладку, ни закрыть слот.
    const user = makeUser({
      subject: "e1",
      dayShifts: [2],
      pinnedDays: [2],
      externalShifts: external([2], "day"),
    })

    const { schedule } = generateSchedule([user], MONTH)

    // День 2 остаётся за другим складом: своей смены в нём нет, и закрепления
    // в нём тоже — закреплять чужой день нельзя.
    expect(planOf(schedule, "e1").dayShifts).not.toContain(2)
    expect(planOf(schedule, "e1").pinnedDays).toEqual([])
  })
})

describe("прошедшие дни месяца", () => {
  /** Месяц, в котором дни 1–4 уже прошли. */
  const FROZEN = settings({
    dayCount: 1,
    nightCount: 1,
    daysInMonth: 10,
    frozenThroughDay: 4,
  })

  it("не ставит смены в прошедшие дни", () => {
    const users = [makeUser({ subject: "e1" }), makeUser({ subject: "e2", id: 2 })]

    const { schedule } = generateSchedule(users, FROZEN)

    const coveredDays = new Set<number>()
    for (const subject of ["e1", "e2"]) {
      const plan = planOf(schedule, subject)
      for (const day of [1, 2, 3, 4]) {
        expect(plan.dayShifts).not.toContain(day)
        expect(plan.nightShifts).not.toContain(day)
      }
      plan.dayShifts.forEach((day) => coveredDays.add(day))
      plan.nightShifts.forEach((day) => coveredDays.add(day))
    }
    // Кто именно закроет день 5 — решает счёт, но закрыть его обязан кто-то:
    // иначе тест прошёл бы и на пустом графике.
    expect(coveredDays.has(5)).toBe(true)
    expect(Math.min(...coveredDays)).toBeGreaterThan(4)
  })

  it("сохраняет смены, которые уже стоят в прошедших днях", () => {
    // Незакреплённые и поставленные не менеджером, а прошлым сохранением:
    // пересборка месяца не должна обнулять начало месяца.
    const user = makeUser({ subject: "e1", dayShifts: [2, 3], nightShifts: [4] })

    const { schedule } = generateSchedule([user], FROZEN)

    const plan = planOf(schedule, "e1")
    expect(plan.dayShifts).toEqual(expect.arrayContaining([2, 3]))
    expect(plan.nightShifts).toContain(4)
    // Закреплением они от этого не становятся: признак ставит только менеджер.
    expect(plan.pinnedDays).toEqual([])
  })

  it("не жалуется на нехватку людей в прошедших днях", () => {
    // Норму закрыть некому, но дни уже прошли — предупреждать о них не о чем.
    const { unfilledSlots } = generateSchedule(
      [makeUser({ subject: "e1" })],
      settings({ dayCount: 5, nightCount: 5, daysInMonth: 10, frozenThroughDay: 4 })
    )

    expect(unfilledSlots.map((slot) => slot.day)).not.toContain(1)
    expect(unfilledSlots.length).toBeGreaterThan(0)
    expect(Math.min(...unfilledSlots.map((slot) => slot.day))).toBeGreaterThan(4)
  })

  it("не растягивает блок смен в прошедший день", () => {
    // Одинокая смена 5-го числа: сосед справа закрыт выходным, слева — граница.
    // Без неё алгоритм дорастил бы блок до 4-го числа, то есть задним числом
    // поставил бы человеку смену, которой не было.
    const user = makeUser({ subject: "e1", daysOffUsers: [6] })

    const { schedule } = generateSchedule(
      [user],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 10, frozenThroughDay: 4 })
    )

    const plan = planOf(schedule, "e1")
    expect(plan.dayShifts).toContain(5)
    for (const day of [1, 2, 3, 4]) {
      expect(plan.dayShifts).not.toContain(day)
    }
  })

  it("не отдаёт прошедшую смену при выравнивании нагрузки", () => {
    // Раскладка как в тесте про закрепление: у второго человека свободен ровно
    // один день в месяце, и он же лежит в прошедшей части. Первый перегружен,
    // и балансировка обязана хотеть этот день забрать.
    const worker = makeUser({
      subject: "e1",
      dayShifts: [1, 2, 3, 4, 5, 6, 7, 8],
    })
    const backup = makeUser({
      subject: "e2",
      id: 2,
      daysOffUsers: [1, 3, 4, 5, 6, 7, 8, 9, 10],
    })

    for (const schedule of generateRepeatedly(
      [worker, backup],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 10, frozenThroughDay: 4 }),
      30
    )) {
      expect(planOf(schedule, "e1").dayShifts).toContain(2)
      expect(planOf(schedule, "e2").dayShifts).not.toContain(2)
    }
  })

  it("учитывает прошедшую ночь в отдыхе после неё", () => {
    // Прошедшее не переставляется, но остаётся частью месяца: человек,
    // отработавший ночь 4-го, не должен получить день 5-го. Это и есть
    // доказательство, что сохранённые смены лежат в карте занятости, а не
    // просто переносятся в результат.
    const user = makeUser({ subject: "e1", nightShifts: [4] })

    const { schedule } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 10,
        afterNightDayOffs: 1,
        frozenThroughDay: 4,
      })
    )

    const plan = planOf(schedule, "e1")
    expect(plan.nightShifts).toContain(4)
    expect(plan.dayShifts).not.toContain(5)
    // Для сравнения: обычный день ставится, то есть дело именно в правиле.
    expect(plan.dayShifts).toContain(6)
  })

  it("при нулевой границе планирует весь месяц", () => {
    const { schedule } = generateSchedule(
      [makeUser({ subject: "e1" })],
      settings({ dayCount: 1, nightCount: 0, daysInMonth: 10 })
    )

    expect(planOf(schedule, "e1").dayShifts).toContain(1)
  })
})

describe("стык месяцев", () => {
  /** Ночь в последний день предыдущего месяца: смещение 0. */
  const nightBefore = [{ day: 0, shiftType: "night" as const, warehouse: "GLP-C" }]

  it("не ставит день 1-го после ночи 31-го", () => {
    // Ровно жалоба: работник 31-го в ночь, 1-го — день. Карта занятости
    // строилась только по текущему месяцу, и ночь за её границей не виделась.
    const user = makeUser({ subject: "e1", previousShifts: nightBefore })

    const { schedule } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 6,
        afterNightDayOffs: 1,
      })
    )
    const plan = planOf(schedule, "e1")

    expect(plan.dayShifts).not.toContain(1)
    // Для сравнения: второе число ставится, то есть дело именно в правиле.
    expect(plan.dayShifts).toContain(2)
  })

  it("ставит день 1-го, если месяц закончился не ночью", () => {
    const user = makeUser({
      subject: "e1",
      previousShifts: [{ day: 0, shiftType: "day", warehouse: "GLP-C" }],
    })

    const { schedule } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 6,
        afterNightDayOffs: 1,
      })
    )

    expect(planOf(schedule, "e1").dayShifts).toContain(1)
  })

  it("видит ночь и за два дня до конца месяца", () => {
    // Отдых после ночи в два дня: ночь 30-го (смещение -1) закрывает 1-е.
    const user = makeUser({
      subject: "e1",
      previousShifts: [{ day: -1, shiftType: "night", warehouse: "PNT-A" }],
    })

    const { schedule } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 6,
        afterNightDayOffs: 2,
      })
    )
    const plan = planOf(schedule, "e1")

    expect(plan.dayShifts).not.toContain(1)
    expect(plan.dayShifts).toContain(3)
  })

  it("учитывает хвост предыдущего месяца на другом складе", () => {
    // Отдых общий для всех складов: ночь на PNT-A запрещает день на GLP-C.
    const user = makeUser({
      subject: "e1",
      previousShifts: [{ day: 0, shiftType: "night", warehouse: "PNT-A" }],
    })

    const { schedule } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 4,
        afterNightDayOffs: 1,
      })
    )

    expect(planOf(schedule, "e1").dayShifts).not.toContain(1)
  })

  it("не записывает хвост предыдущего месяца в график", () => {
    // Дни 0 и отрицательные — это чужой месяц: сохранить их здесь значило бы
    // либо создать дубль, либо перенести в этот месяц чужую историю.
    const user = makeUser({
      subject: "e1",
      previousShifts: [
        { day: 0, shiftType: "night", warehouse: "GLP-C" },
        { day: -1, shiftType: "day", warehouse: "GLP-C" },
      ],
    })

    const { schedule } = generateSchedule(
      [user],
      settings({ dayCount: 1, nightCount: 1, daysInMonth: 5 })
    )
    const plan = planOf(schedule, "e1")

    expect([...plan.dayShifts, ...plan.nightShifts].every((day) => day >= 1)).toBe(true)
    expect(plan.dayShifts).not.toContain(-1)
    expect(plan.nightShifts).not.toContain(0)
  })

  it("не считает хвост нагрузкой этого месяца", () => {
    // Иначе человек с длинным хвостом выглядел бы перегруженным и недополучил
    // бы смен в новом месяце.
    //
    // Проверяется помощник, а не итог раскладки: у длинного хвоста есть и
    // законные причины получить меньше смен — усталость и серия, — и по итогу
    // эти причины не отличить от ошибки в подсчёте нагрузки.
    expect(currentLoad(new Map([[0, "Day"], [-1, "Day"], [-2, "Night"]]))).toBe(0)
    expect(currentLoad(new Map([[0, "Day"], [1, "Day"], [2, "Night"]]))).toBe(2)
    expect(currentLoad(new Map())).toBe(0)
  })
})


describe("серии смен", () => {
  it("не ставит ночь сразу после дня, когда есть кому ещё", () => {
    // Правило мягкое: при нехватке людей ночь всё же ставится, иначе слот
    // останется незакрытым. Здесь людей втрое больше нормы, поэтому выбора
    // хватает всегда, и перехода быть не должно.
    const users = Array.from({ length: 6 }, (_, index) =>
      makeUser({ subject: `e${index + 1}`, id: index + 1 })
    )

    for (const schedule of generateRepeatedly(
      users,
      settings({ dayCount: 1, nightCount: 1, daysInMonth: 20 }),
      15
    )) {
      for (const user of users) {
        const plan = planOf(schedule, user.subject)
        const days = new Set(plan.dayShifts)
        for (const night of plan.nightShifts) {
          expect(
            days.has(night - 1),
            `${user.subject}: ночь ${night} сразу после дня ${night - 1}`
          ).toBe(false)
        }
      }
    }
  })

  it("не забирает смену из середины серии", () => {
    // Такую смену выравнивание нагрузки забрать не должно: у перегруженного
    // останется дыра, и одна серия превратится в две.
    const block = new Map([
      [4, "Day"],
      [5, "Day"],
      [6, "Day"],
    ])

    expect(isMidBlock(block, 5)).toBe(true)
    // Края серии — можно: серия просто станет короче, но не разорвётся.
    expect(isMidBlock(block, 4)).toBe(false)
    expect(isMidBlock(block, 6)).toBe(false)
  })

  it("не создаёт одиночную смену у получателя", () => {
    const again = new Map([
      [4, "Day"],
      [6, "Day"],
    ])

    // Разрыв между двумя сериями заполнить можно и нужно: это склеивает две
    // коротких серии в одну длинную.
    expect(fitsBlock(again, 5, "day")).toBe(true)
    // А вот смена после одного дня отдыха — уже одиночка в разрыве.
    expect(fitsBlock(new Map([[6, "Day"]]), 8, "day")).toBe(false)
    // Продолжение серии годится.
    expect(fitsBlock(again, 3, "day")).toBe(true)
    expect(fitsBlock(again, 7, "day")).toBe(true)
    // Начало новой серии годится, но после двух дней отдыха — как и в оценке
    // блока: смена через один день отдыха и есть та самая «смена в разрыве».
    expect(fitsBlock(new Map(), 5, "day")).toBe(true)
    expect(fitsBlock(new Map([[3, "Night"]]), 6, "day")).toBe(true)
    expect(fitsBlock(new Map([[3, "Night"]]), 5, "day")).toBe(false)
    // А сразу после чужой смены другого типа — нет.
    expect(fitsBlock(new Map([[4, "Night"]]), 5, "day")).toBe(false)
  })

  it("держит блоки в реальном составе склада", () => {
    // Десять человек, по два дневных и три ночных слота в день — как на живом
    // складе. Порог подобран по замерам: до правок алгоритм давал в среднем
    // 14 одиночных смен на месяц, после — около девяти, из которых треть
    // приходится на обрезку серий границей месяца.
    const users = Array.from({ length: 10 }, (_, index) =>
      makeUser({ subject: `e${index + 1}`, id: index + 1 })
    )
    const config = settings({ dayCount: 2, nightCount: 3, daysInMonth: 30 })

    let isolated = 0
    const runs = 15
    for (const schedule of generateRepeatedly(users, config, runs)) {
      for (const user of users) {
        const plan = planOf(schedule, user.subject)
        const days = new Set([...plan.dayShifts, ...plan.nightShifts])
        if (!days.size) continue
        for (const day of days) {
          const before = days.has(day - 1)
          const after = days.has(day + 1)
          if (!before && !after) isolated += 1
        }
      }
    }

    expect(isolated / runs).toBeLessThan(14)
  })
})


describe("отдых на стыке складов и при нулевой настройке", () => {
  it("не ставит день после ночи, даже если отдых не настроен", () => {
    // Ноль в настройке означает «без дополнительных дней отдыха», а не «можно
    // день сразу после ночи». Раньше ноль отключал проверку целиком.
    //
    // Ночь взята чужая: незакреплённая своя смена прошлого прогона в карту
    // занятости не попадает — её алгоритм волен перепланировать.
    const user = makeUser({ subject: "e1", externalShifts: external([3], "night") })

    const { schedule, unfilledSlots } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 6,
        afterNightDayOffs: 0,
      })
    )

    expect(planOf(schedule, "e1").dayShifts).not.toContain(4)
    // Слот 4-го числа остался незакрытым: закрыть его некому, и это честнее,
    // чем поставить день после ночи.
    expect(unfilledSlots.map((slot) => slot.day)).toContain(4)
  })

  it("не ставит ночь накануне дня на другом складе", () => {
    // День на PNT-A уже стоит, и ночь накануне него — та же пара «ночь → день»,
    // только собранная из двух складов. Порядок сохранения графиков не должен
    // на это влиять.
    const user = makeUser({ subject: "e1", externalShifts: external([5], "day") })

    const { schedule, unfilledSlots } = generateSchedule(
      [user],
      settings({ dayCount: 0, nightCount: 1, daysInMonth: 8 })
    )

    expect(planOf(schedule, "e1").nightShifts).not.toContain(4)
    expect(unfilledSlots.map((slot) => slot.day)).toContain(4)
    // Соседние дни ставить не запрещено.
    expect(planOf(schedule, "e1").nightShifts).toContain(3)
  })

  it("не ставит ночь накануне закреплённого дня", () => {
    // Закреплённый день менеджер уже решил, и ночь перед ним — тот же запрет.
    const user = makeUser({
      subject: "e1",
      dayShifts: [6],
      pinnedDays: [6],
    })

    const { schedule } = generateSchedule(
      [user],
      settings({ dayCount: 0, nightCount: 1, daysInMonth: 8 })
    )

    expect(planOf(schedule, "e1").nightShifts).not.toContain(5)
  })

  it("не ставит день после ночи в конце прошлого месяца", () => {
    // Ночь 31-го на другом складе: день 1-го запрещён, как и внутри месяца.
    const user = makeUser({
      subject: "e1",
      previousShifts: [{ day: 0, shiftType: "night", warehouse: "PNT-A" }],
    })

    const { schedule } = generateSchedule(
      [user],
      settings({
        dayCount: 1,
        nightCount: 0,
        daysInMonth: 5,
        afterNightDayOffs: 0,
      })
    )

    expect(planOf(schedule, "e1").dayShifts).not.toContain(1)
  })
})
