import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { toUsers } from "@/lib/employeeMapping"
import type { ScheduleParticipant } from "@/lib/api/types"
import { seededRandom } from "@/lib/random"
import {
  generateSchedule,
  repairSchedule,
  type GenerationResult,
  type GeneratorSettings,
} from "@/lib/scheduleGenerator"
import type { IUser } from "@/types/User"

/**
 * Тесты перебора версий.
 *
 * Построение жадное и разрывает ничьи случайным шумом, поэтому один и тот же
 * состав даёт разные графики. Перебор строит несколько и оставляет лучшую по
 * оценке — здесь проверяется именно это: что выбор действительно лучший, что
 * результат воспроизводим по зерну и что перебор ничего не ломает в правилах.
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

describe("выбор версии", () => {
  it("по умолчанию строит одну — прежнее поведение", () => {
    const result = generateSchedule(crew(), settings())

    expect(result.variantsConsidered).toBe(1)
    expect(result.variantCosts).toHaveLength(1)
  })

  it("стартовая версия — лучшая из построенных, а поиск её не портит", () => {
    const result = generateSchedule(crew(), settings(), {
      variants: 6,
      random: seededRandom(5),
    })

    expect(result.variantsConsidered).toBe(6)
    expect(result.variantCosts).toHaveLength(6)

    // Перебор оставляет версию с наименьшей оценкой — это и есть стартовая
    // раскладка, до поиска.
    expect(result.initialCost).toBe(Math.min(...result.variantCosts))
    // Поиск принимает только ходы, не увеличивающие оценку, поэтому итог не
    // может быть хуже старта.
    expect(result.evaluation.cost).toBeLessThanOrEqual(result.initialCost)
  })

  it("старт из нескольких версий не хуже старта из одной", () => {
    const config = settings()
    // Одно и то же зерно: первые версии обоих прогонов совпадают, поэтому
    // перебор обязан дать старт не хуже.
    const single = generateSchedule(crew(), config, { random: seededRandom(7) })
    const multi = generateSchedule(crew(), config, {
      variants: 8,
      random: seededRandom(7),
    })

    expect(multi.initialCost).toBeLessThanOrEqual(single.initialCost)
  })

  it("перебор имеет смысл: версии действительно разные", () => {
    const config = settings()
    const seen = new Set<string>()

    for (let seed = 1; seed <= 6; seed++) {
      const result = generateSchedule(crew(), config, { random: seededRandom(seed) })
      seen.add(JSON.stringify(normalized(result.schedule)))
    }

    // Если бы все прогоны давали одно и то же, выбирать было бы не из чего.
    expect(seen.size).toBeGreaterThan(1)
  })

  it("не строит больше предела", () => {
    const result = generateSchedule(crew(), settings(), { variants: 1000 })

    expect(result.variantsConsidered).toBe(24)
    expect(result.variantCosts).toHaveLength(24)
  })

  it("считает вариантов не меньше одного при мусорном значении", () => {
    const result = generateSchedule(crew(), settings(), { variants: 0 })

    expect(result.variantsConsidered).toBe(1)
  })
})

describe("воспроизводимость", () => {
  it("одно зерно — один и тот же график", () => {
    const config = settings()
    const first = generateSchedule(crew(), config, {
      variants: 4,
      random: seededRandom(11),
    })
    const second = generateSchedule(crew(), config, {
      variants: 4,
      random: seededRandom(11),
    })

    expect(normalized(first.schedule)).toEqual(normalized(second.schedule))
    expect(first.variantCosts).toEqual(second.variantCosts)
    expect(first.evaluation.metrics).toEqual(second.evaluation.metrics)
  })

  it("разные зёрна — разные оценки версий", () => {
    const config = settings()
    const first = generateSchedule(crew(), config, {
      variants: 3,
      random: seededRandom(1),
    })
    const second = generateSchedule(crew(), config, {
      variants: 3,
      random: seededRandom(2),
    })

    expect(first.variantCosts).not.toEqual(second.variantCosts)
  })
})

/**
 * Текущий график с одной ручной правкой: у первого работника убран день.
 *
 * Так выглядит состояние после клика менеджера по клетке — именно с этого
 * начинается пересбор, и именно повторное нажатие на нём проверяется.
 */
function draftWithManualEdit(config: GeneratorSettings) {
  const users = crew()
  const built = generateSchedule(users, config, { random: seededRandom(4) })
  const draft = users.map((user) => {
    const plan = built.schedule[user.subject]!
    return {
      ...user,
      dayShifts: [...plan.dayShifts],
      nightShifts: [...plan.nightShifts],
      pinnedDays: [...plan.pinnedDays],
    }
  })

  const victim = draft.find((user) => user.dayShifts.length > 0)!
  const day = victim.dayShifts[0]!
  victim.dayShifts = victim.dayShifts.filter((value) => value !== day)

  return { draft, victim }
}

describe("перебор в пересборе", () => {
  it("выбирает версию с наименьшим числом правок", () => {
    const config = settings()
    const { draft, victim } = draftWithManualEdit(config)
    const options = { frozenSubjects: [victim.subject] }

    const single = repairSchedule(draft, config, {
      ...options,
      random: seededRandom(3),
    })
    const multi = repairSchedule(draft, config, {
      ...options,
      variants: 6,
      random: seededRandom(3),
    })

    expect(multi.variantsConsidered).toBe(6)
    // Первая версия перебора — тот же прогон, что и одиночный, поэтому правок
    // не может стать больше: перебор только выбирает.
    expect(multi.changes.length).toBeLessThanOrEqual(single.changes.length)
  })

  it("воспроизводим и в пересборе", () => {
    const config = settings()
    const { draft, victim } = draftWithManualEdit(config)
    const options = { frozenSubjects: [victim.subject], variants: 4 }

    const first = repairSchedule(draft, config, {
      ...options,
      random: seededRandom(21),
    })
    const second = repairSchedule(draft, config, {
      ...options,
      random: seededRandom(21),
    })

    expect(normalized(first.schedule)).toEqual(normalized(second.schedule))
    expect(first.changes).toEqual(second.changes)
  })
})

/**
 * Главное свойство для менеджера: кнопка обязана быть предсказуемой.
 *
 * Если при одних и тех же складе, месяце, составе и настройках смены после
 * каждого нажатия встают по-новому, согласовать график невозможно: непонятно,
 * что изменилось — твоя правка или очередной бросок алгоритма.
 */
describe("повторное нажатие не двигает смены", () => {
  const VARIANTS = 12

  /**
   * Ровно то, что делает хранилище после построения.
   *
   * Без этого шага тест бесполезен: он проверяет не приложение, а вызов
   * функции дважды подряд на одном и том же массиве. Настоящий поток —
   * построил, применил, построил снова, — и именно на нём график прыгал.
   */
  function applyLikeStore(users: IUser[], result: GenerationResult): IUser[] {
    return users.map((user) => {
      const plan = result.schedule[user.subject]!
      return {
        ...user,
        dayShifts: [...plan.dayShifts],
        nightShifts: [...plan.nightShifts],
        pinnedDays: [...plan.pinnedDays],
      }
    })
  }

  it("нажатие с записью результата в состав не сдвигает график", () => {
    const config = settings()
    let users = crew()
    let previous = generateSchedule(users, config, { variants: VARIANTS })

    // Три нажатия подряд: график обязан сойтись и стоять на месте.
    for (let press = 0; press < 3; press++) {
      users = applyLikeStore(users, previous)
      const next = generateSchedule(users, config, { variants: VARIANTS })

      expect(normalized(next.schedule)).toEqual(normalized(previous.schedule))
      previous = next
    }
  })

  it("пересбор с записью результата в состав тоже стоит на месте", () => {
    const config = settings()
    const { draft, victim } = draftWithManualEdit(config)
    const options = { frozenSubjects: [victim.subject], variants: VARIANTS }

    let users = draft
    let previous = repairSchedule(users, config, options)

    for (let press = 0; press < 3; press++) {
      users = applyLikeStore(users, previous)
      const next = repairSchedule(users, config, options)

      expect(normalized(next.schedule)).toEqual(normalized(previous.schedule))
      previous = next
    }
  })

  it("одни и те же данные — один и тот же месяц", () => {
    const config = settings()

    const first = generateSchedule(crew(), config, { variants: VARIANTS })
    const second = generateSchedule(crew(), config, { variants: VARIANTS })

    expect(normalized(first.schedule)).toEqual(normalized(second.schedule))
    expect(first.variantCosts).toEqual(second.variantCosts)
    expect(first.evaluation.metrics).toEqual(second.evaluation.metrics)
  })

  it("порядок состава в списке не влияет", () => {
    // База после перезагрузки страницы может вернуть тот же склад в другом
    // порядке; график от этого меняться не должен.
    const config = settings()
    const users = crew()

    const straight = generateSchedule(users, config, { variants: VARIANTS })
    const shuffled = generateSchedule([...users].reverse(), config, {
      variants: VARIANTS,
    })

    expect(normalized(straight.schedule)).toEqual(normalized(shuffled.schedule))
  })

  it("имя и заметка на график не влияют", () => {
    // В зерно попадает только то, что алгоритм читает. Правка заметки не
    // должна перетасовывать месяц.
    const config = settings()
    const renamed = crew().map((user) => ({
      ...user,
      fullName: `Переименован ${user.subject}`,
      note: "примечание менеджера",
    }))

    const base = generateSchedule(crew(), config, { variants: VARIANTS })
    const withNotes = generateSchedule(renamed, config, { variants: VARIANTS })

    expect(normalized(base.schedule)).toEqual(normalized(withNotes.schedule))
  })

  it("пересбор при повторном нажатии тоже не двигает смены", () => {
    const config = settings()
    const { draft, victim } = draftWithManualEdit(config)
    const options = { frozenSubjects: [victim.subject], variants: VARIANTS }

    const first = repairSchedule(draft, config, options)
    const second = repairSchedule(draft, config, options)

    expect(normalized(first.schedule)).toEqual(normalized(second.schedule))
    expect(first.changes).toEqual(second.changes)
  })

  it("больше версий не может сделать старт хуже", () => {
    // Версии строятся одним потоком случайных чисел, поэтому первые
    // двенадцать из двадцати четырёх — те же самые. Выбор из большего числа
    // обязан быть не хуже.
    //
    // Сравнивается именно старт: поиск после него идёт по своей траектории, и
    // обещать по ней монотонность нельзя — из лучшего старта он теоретически
    // может попасть в худший локальный оптимум. А вот сам перебор монотонен.
    const config = settings()

    const twelve = generateSchedule(crew(), config, { variants: 12 })
    const twentyFour = generateSchedule(crew(), config, { variants: 24 })

    expect(twentyFour.variantCosts.slice(0, 12)).toEqual(twelve.variantCosts)
    expect(twentyFour.initialCost).toBeLessThanOrEqual(twelve.initialCost)
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

  it("перебор не ломает правила и держит норму", () => {
    const users = toUsers(fixture.rows)
    const result = generateSchedule(users, config, {
      variants: 8,
      random: seededRandom(13),
    })

    expect(result.evaluation.metrics.restViolations).toBe(0)
    expect(result.evaluation.metrics.markViolations).toBe(0)

    // Оценщик и построение смотрят на покрытие одинаково: сколько слотов без
    // людей, столько же названо в отчёте.
    expect(result.evaluation.metrics.shortfall).toBe(
      result.unfilledSlots.reduce((sum, slot) => sum + (slot.needed - slot.filled), 0)
    )

    for (const user of users) {
      const plan = result.schedule[user.subject]!
      const nights = new Set<number>()
      for (const [rawDay, shift] of Object.entries(user.externalShifts)) {
        if (shift.shiftType === "night") nights.add(Number(rawDay))
      }
      for (const night of plan.nightShifts) nights.add(night)

      for (const day of plan.dayShifts) {
        expect(nights.has(day - 1), `${user.fullName}: день ${day} после ночи`).toBe(
          false
        )
      }
    }
  })

  it("перебор не хуже одиночного прогона на том же зерне", () => {
    const users = toUsers(fixture.rows)

    const single = generateSchedule(users, config, { random: seededRandom(17) })
    const multi = generateSchedule(users, config, {
      variants: 8,
      random: seededRandom(17),
    })

    expect(multi.evaluation.cost).toBeLessThanOrEqual(single.evaluation.cost)
  })
})
