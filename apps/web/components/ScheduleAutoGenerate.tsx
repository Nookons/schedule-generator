"use client"

import { useState } from "react"
import { toast } from "sonner"
import dayjs from "dayjs"

import { Button } from "@workspace/ui/components/button"
import { generateSchedule } from "@/lib/scheduleGenerator"
import { frozenThroughDay } from "@/lib/scheduleWindow"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"

/**
 * Кнопка построения графика.
 *
 * Сам алгоритм живёт в `lib/scheduleGenerator.ts` — здесь только чтение
 * состояния, вызов и обратная связь. Раньше он был внутри компонента, и
 * проверить его можно было единственным способом: нажать кнопку и посмотреть
 * на таблицу.
 *
 * Граница прошедших дней считается при каждом рендере, а не берётся из
 * состояния: приложение может висеть открытым через полночь, и «сегодня» тогда
 * сместится.
 */
const ScheduleAutoGenerate = () => {
  const users = useUsersStore((state) => state.users)
  const {
    dayCount,
    nightCount,
    afterNightDayOffs,
    afterDayDayOffs,
    currentMonth,
  } = useSettingStore()

  const [isGenerating, setIsGenerating] = useState(false)

  const frozen = frozenThroughDay(currentMonth)

  const handleGenerate = () => {
    if (!users.length) {
      toast.error("Сначала добавьте людей в состав склада")
      return
    }

    setIsGenerating(true)
    try {
      const daysInMonth = dayjs(currentMonth).daysInMonth()

      const { schedule, unfilledSlots, eligible } = generateSchedule(users, {
        dayCount,
        nightCount,
        afterNightDayOffs,
        afterDayDayOffs,
        daysInMonth,
        frozenThroughDay: frozen,
      })

      useUsersStore.getState().applySchedule(schedule)

      // Сколько дней алгоритм не тронул, потому что их поставил менеджер.
      // Без этого числа «Построить график» выглядит так, будто часть правок
      // потерялась: они остались на месте, но об этом нужно сказать.
      const pinnedCount = Object.values(schedule).reduce(
        (sum, plan) => sum + plan.pinnedDays.length,
        0
      )

      // Предупреждения, а не ошибки: график построен, но покрытие где-то
      // неполное, и решать это менеджеру — добавить людей или ослабить норму.
      // Прошедшие дни сюда не попадают: их не планируют, и предупреждать о
      // нехватке людей в них не о чем.
      if (eligible.day < dayCount) {
        toast.warning(
          `В день могут работать ${eligible.day} чел., а нужно ${dayCount} — будут пропуски`
        )
      }
      if (eligible.night < nightCount) {
        toast.warning(
          `В ночь могут работать ${eligible.night} чел., а нужно ${nightCount} — будут пропуски`
        )
      }
      if (unfilledSlots.length > 0) {
        console.warn("Unfilled shift slots:", unfilledSlots)
        toast.warning(
          `Не удалось закрыть слотов: ${unfilledSlots.length}. Подробности — в консоли.`
        )
        return
      }

      toast.success(
        `График на ${currentMonth} построен.` +
          (pinnedCount
            ? ` Закреплённых дней не тронуто: ${pinnedCount}.`
            : "") +
          " Не забудьте сохранить."
      )
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleGenerate} disabled={isGenerating || !users.length}>
        {isGenerating ? "Генерация…" : "Построить график"}
      </Button>
      {/* Без этой подписи начало месяца выглядит нетронутым без причины:
          менеджер нажал кнопку, а первые дни не изменились. */}
      {frozen > 0 && (
        <p className="max-w-[15rem] text-xs text-muted-foreground">
          Дни 1–{frozen} не перестраиваются: они уже прошли
        </p>
      )}
    </div>
  )
}

export default ScheduleAutoGenerate
