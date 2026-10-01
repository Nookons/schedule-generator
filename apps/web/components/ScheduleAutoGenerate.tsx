"use client"

import { useState } from "react"
import { toast } from "sonner"
import dayjs from "dayjs"

import { Button } from "@workspace/ui/components/button"
import {
  generateSchedule,
  repairSchedule,
  type GenerationResult,
} from "@/lib/scheduleGenerator"
import { frozenThroughDay } from "@/lib/scheduleWindow"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"

/**
 * Кнопки построения графика.
 *
 * Сам алгоритм живёт в `lib/scheduleGenerator.ts` — здесь только чтение
 * состояния, вызов и обратная связь. Раньше он был внутри компонента, и
 * проверить его можно было единственным способом: нажать кнопку и посмотреть
 * на таблицу.
 *
 * Кнопок две, потому что это два разных вопроса менеджера:
 *
 *   * «Построить график» — составить месяц заново, не считаясь с прошлой
 *     раскладкой. Так начинают месяц и так пересобирают его, если всё пошло не
 *     так;
 *   * «Перебрать с минимальными правками» — поправить один день у одного
 *     человека и привести в порядок окружение, не перетасовывая остальных.
 *
 * Отдельная кнопка, а не галочка: разница между режимами не в тонкости
 * настройки, а в том, что один стирает работу менеджера, а второй её бережёт.
 *
 * Граница прошедших дней считается при каждом рендере, а не берётся из
 * состояния: приложение может висеть открытым через полночь, и «сегодня» тогда
 * сместится.
 */

/**
 * Сколько версий строить и сравнивать за одно нажатие.
 *
 * Построение жадное: смены раздаются по одной, и на каждом шаге алгоритм видит
 * только локальную картину. Два прогона на одном составе дают разные графики, и
 * какой из них лучше — из внутренних счётов не следует. Перебор строит
 * несколько и оставляет лучшую по внешней оценке.
 *
 * Число выбрано по замеру на реальном складе (10 человек, 30 дней, норма 2+2):
 * одна версия — 4 мс и оценка 577, восемь — 11 мс и 473, двенадцать — 14 мс и
 * 473, двадцать четыре — 26 мс и 457. Основной выигрыш набирается к восьми
 * версиям, дальше он убывает; двенадцать оставлены как запас на склады крупнее,
 * где разброс между версиями выше.
 *
 * После перебора работает поиск по целевой функции — он перестраивает окна дней
 * и принимает только те ходы, что не ухудшают оценку всего месяца. Его бюджет
 * считается по числу людей (шесть перестроек на человека), поэтому здесь о нём
 * заботиться не нужно. Вместе на десяти человеках это около 30 мс, на тридцати —
 * порядка двухсот.
 */
const GENERATION_VARIANTS = 12

/**
 * Подробности перебора и поиска — в консоль.
 *
 * Короткая фраза в уведомлении говорит «выбрана лучшая из двенадцати», но не
 * показывает ни разброса между версиями, ни того, что дал поиск. Когда график
 * выглядит странно, вопрос ровно в этом: то ли перебор ничего не дал, то ли
 * оценщик счёл лучшей версию, которая человеку не нравится. Список оценок и
 * метрики победителя отвечают на него сразу.
 */
function reportChoice(result: GenerationResult) {
  if (result.variantsConsidered <= 1 && !result.acceptedMoves) return

  console.info(
    `Построено версий: ${result.variantsConsidered}. ` +
      `Оценки версий: ${result.variantCosts.join(", ")}. ` +
      `Старт ${result.initialCost} → после поиска ${result.evaluation.cost} ` +
      `(принято перестроек: ${result.acceptedMoves}).`,
    result.evaluation.metrics
  )
}

/** Короткая строка о том, как получился график, — для уведомления. */
function describeChoice(result: GenerationResult): string {
  const phrases: string[] = []

  if (result.variantsConsidered > 1) {
    const worst = Math.max(...result.variantCosts)
    phrases.push(
      `выбрана лучшая из ${result.variantsConsidered} версий` +
        (worst > result.initialCost ? ` (у худшей оценка ${worst})` : "")
    )
  }

  if (result.acceptedMoves > 0) {
    phrases.push(
      `поиск улучшил оценку с ${result.initialCost} до ${result.evaluation.cost}`
    )
  }

  if (!phrases.length) return ""

  const sentence = phrases.join("; ")
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + "."
}

const ScheduleAutoGenerate = () => {
  const users = useUsersStore((state) => state.users)
  const touchedSubjects = useUsersStore((state) => state.touchedSubjects)
  const {
    dayCount,
    nightCount,
    afterNightDayOffs,
    afterDayDayOffs,
    currentMonth,
  } = useSettingStore()

  const [isBusy, setIsBusy] = useState(false)

  const frozen = frozenThroughDay(currentMonth)

  /**
   * Предупреждения о покрытии — общие для обоих режимов.
   *
   * Это предупреждения, а не ошибки: график построен, но людей где-то не
   * хватает или, наоборот, больше нормы, и решать это менеджеру — добавить
   * людей, ослабить норму или снять закрепление. Прошедшие дни сюда не
   * попадают: их не планируют.
   */
  const warnAboutCoverage = (
    result: GenerationResult,
    what: string
  ): boolean => {
    if (result.eligible.day < dayCount) {
      toast.warning(
        `В день могут работать ${result.eligible.day} чел., а нужно ${dayCount} — будут пропуски`
      )
    }
    if (result.eligible.night < nightCount) {
      toast.warning(
        `В ночь могут работать ${result.eligible.night} чел., а нужно ${nightCount} — будут пропуски`
      )
    }
    if (result.unfilledSlots.length > 0) {
      console.warn(`Незакрытые слоты (${what}):`, result.unfilledSlots)
      toast.warning(
        `Не удалось закрыть слотов: ${result.unfilledSlots.length}. Подробности — в консоли.`
      )
      return false
    }
    // Излишек остаётся только там, где все смены закреплены: снять их алгоритм
    // не вправе. Молчать об этом нельзя — со стороны это выглядит как «программа
    // не видит, что людей больше нормы».
    if (result.excessSlots.length > 0) {
      console.warn(`Слоты сверх нормы (${what}):`, result.excessSlots)
      toast.warning(
        `Людей больше нормы на ${result.excessSlots.length} сменах — снять нечего: ` +
          "все смены этого дня закреплены. Подробности — в консоли."
      )
      return false
    }
    return true
  }

  const handleGenerate = () => {
    if (!users.length) {
      toast.error("Сначала добавьте людей в состав склада")
      return
    }

    setIsBusy(true)
    try {
      const daysInMonth = dayjs(currentMonth).daysInMonth()

      const result = generateSchedule(
        users,
        {
          dayCount,
          nightCount,
          afterNightDayOffs,
          afterDayDayOffs,
          daysInMonth,
          frozenThroughDay: frozen,
        },
        { variants: GENERATION_VARIANTS }
      )

      useUsersStore.getState().applySchedule(result.schedule)

      // Сколько дней алгоритм не тронул, потому что их поставил менеджер.
      // Без этого числа «Построить график» выглядит так, будто часть правок
      // потерялась: они остались на месте, но об этом нужно сказать.
      const pinnedCount = Object.values(result.schedule).reduce(
        (sum, plan) => sum + plan.pinnedDays.length,
        0
      )

      if (!warnAboutCoverage(result, "полная пересборка")) return

      reportChoice(result)

      toast.success(
        `График на ${currentMonth} построен.` +
          ` ${describeChoice(result)}` +
          (pinnedCount
            ? ` Закреплённых дней не тронуто: ${pinnedCount}.`
            : "") +
          " Не забудьте сохранить."
      )
    } finally {
      setIsBusy(false)
    }
  }

  /**
   * Пересбор с минимальными правками.
   *
   * Строки работников, которых менеджер правил руками, замораживаются целиком —
   * и смены, и пустые дни. Иначе освободившийся день закрылся бы тем же
   * человеком, у которого его только что убрали, и правка отменилась бы на
   * глазах.
   */
  const handleRepair = () => {
    if (!users.length) {
      toast.error("Сначала добавьте людей в состав склада")
      return
    }

    // Перебирать нечего, если график пуст: получился бы добор покрытия без
    // выравнивания и без достройки серий — то есть худшая версия построения.
    const shiftCount = users.reduce(
      (sum, user) => sum + user.dayShifts.length + user.nightShifts.length,
      0
    )
    if (!shiftCount) {
      toast.info("График пока пуст — сначала постройте его целиком")
      return
    }

    setIsBusy(true)
    try {
      const daysInMonth = dayjs(currentMonth).daysInMonth()

      const result = repairSchedule(
        users,
        {
          dayCount,
          nightCount,
          afterNightDayOffs,
          afterDayDayOffs,
          daysInMonth,
          frozenThroughDay: frozen,
        },
        { frozenSubjects: touchedSubjects, variants: GENERATION_VARIANTS }
      )

      useUsersStore.getState().applySchedule(result.schedule)

      if (!warnAboutCoverage(result, "пересбор")) return

      reportChoice(result)

      if (!result.changes.length) {
        toast.success(
          "Правки не потребовались: график уже согласован с правилами и закрыт"
        )
        return
      }

      // Отчёт о правках — не украшение: без него пересбор выглядит как
      // перетасовка всего месяца, и непонятно, уцелела ли ручная правка.
      const affected = new Set(result.changes.map((change) => change.subject))
      console.info("Пересбор с минимальными правками:", result.changes)

      toast.success(
        `Пересобрано с минимальными правками: изменено клеток ${result.changes.length} у ${affected.size} чел.` +
          ` ${describeChoice(result)}` +
          (touchedSubjects.length
            ? ` Правки не тронуты у ${touchedSubjects.length} чел.`
            : "") +
          " Не забудьте сохранить."
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={handleGenerate} disabled={isBusy || !users.length}>
        {isBusy ? "Генерация…" : "Построить график"}
      </Button>
      <Button
        variant="outline"
        onClick={handleRepair}
        disabled={isBusy || !users.length}
        // Подсказка объясняет не «что делает кнопка», а чем она отличается от
        // соседней: без этого её нажимают вместо полной пересборки.
        title="Сохранить текущую раскладку и поправить только то, что мешает правилам и покрытию"
      >
        Перебрать с минимальными правками
      </Button>
      {/* Без этой подписи начало месяца выглядит нетронутым без причины:
          менеджер нажал кнопку, а первые дни не изменились. */}
      {frozen > 0 && (
        <p className="max-w-[15rem] text-xs text-muted-foreground">
          Дни 1–{frozen} не перестраиваются: они уже прошли
        </p>
      )}
      {touchedSubjects.length > 0 && (
        <p className="max-w-[18rem] text-xs text-muted-foreground">
          Правки вручную: {touchedSubjects.length} чел. — при переборе их строки
          не тронутся
        </p>
      )}
    </div>
  )
}

export default ScheduleAutoGenerate
