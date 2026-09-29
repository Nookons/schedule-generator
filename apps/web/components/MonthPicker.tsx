"use client"

import dayjs from "@/lib/dayjs"
import { Button } from "@workspace/ui/components/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { useSettingStore } from "@/store/useSettingStore"

/**
 * Выбор месяца.
 *
 * Раньше компонент записывал месяц в стор прямо во время рендера, если тот
 * был пуст. Это меняло состояние другого компонента в середине отрисовки, и
 * первый проход успевал посчитать сетку по пустой строке. Теперь месяц
 * инициализируется в самом сторе — текущим, а не пустым.
 */
const MonthPicker = () => {
  const currentMonth = useSettingStore((state) => state.currentMonth)
  const updateMonth = useSettingStore((state) => state.updateMonth)

  const current = dayjs(currentMonth)

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Предыдущий месяц"
          onClick={() =>
            updateMonth(current.subtract(1, "month").format("YYYY-MM"))
          }
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="min-w-32 text-center font-medium">
          {current.format("MMMM YYYY")}
        </span>

        <Button
          variant="outline"
          size="icon"
          aria-label="Следующий месяц"
          onClick={() => updateMonth(current.add(1, "month").format("YYYY-MM"))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export default MonthPicker
