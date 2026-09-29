"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { FileDown, Save, Sheet } from "lucide-react"

import { handleExcelExport } from "@/futures/handleExcelExport"
import { ApiError } from "@/lib/api/client"
import type { ScheduleShift } from "@/lib/api/types"
import { ScheduleApi } from "@/services/ScheduleApi"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"

/**
 * Действия с готовым графиком.
 *
 * Сохранение вынесено в отдельную кнопку, а не выполняется сразу после
 * генерации: алгоритм недетерминирован, и менеджеру нужно увидеть результат
 * прежде, чем он попадёт в базу и станет общим для всех.
 *
 * Сохранение — полная замена месяца на сервере. Это соответствует смыслу
 * экрана: то, что видно в таблице, и есть график на этот месяц.
 */
const ExportsButtonWrapper = () => {
  const users = useUsersStore((state) => state.users)
  const warehouse = useSettingStore((state) => state.warehouse)
  const currentMonth = useSettingStore((state) => state.currentMonth)
  // Норма уходит в файл вместе с графиком: в Excel она подписана рядом с
  // итогами, иначе красная цифра покрытия ничего не объясняет.
  const dayCount = useSettingStore((state) => state.dayCount)
  const nightCount = useSettingStore((state) => state.nightCount)

  const [isSaving, setIsSaving] = useState(false)

  const hasSchedule = users.some(
    (user) => user.dayShifts.length > 0 || user.nightShifts.length > 0
  )

  /**
   * Черновик графика для сохранения.
   *
   * Закреплённые дни помечаются признаком `pinned`: сервер по нему решает, что
   * можно удалять. Без признака сохранение сняло бы закрепление — вместе с ним
   * ушла бы и защита ручных правок от следующей генерации.
   */
  const buildShifts = (): ScheduleShift[] => {
    const shift = (
      user: (typeof users)[number],
      day: number,
      shift_type: "day" | "night"
    ): ScheduleShift => ({
      subject: user.subject,
      day,
      shift_type,
      pinned: user.pinnedDays.includes(day),
    })

    return users.flatMap((user) => [
      ...user.dayShifts.map((day) => shift(user, day, "day")),
      ...user.nightShifts.map((day) => shift(user, day, "night")),
    ])
  }

  const handleSave = async () => {
    if (!warehouse) return

    setIsSaving(true)
    try {
      const result = await ScheduleApi.saveShifts(
        warehouse,
        currentMonth,
        buildShifts()
      )
      toast.success(
        `Сохранено смен: ${result.saved} (${warehouse}, ${currentMonth})` +
          (result.notified
            ? `. Уведомления об изменениях отправлены: ${result.notified}`
            : "")
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "DUPLICATE_SHIFT") {
        // Такое возможно только при ручной правке графика: генератор
        // гарантирует одну смену в день на человека.
        toast.error("У одного участника две смены в один день")
      } else if (
        cause instanceof ApiError &&
        cause.code === "EMPLOYEE_NOT_IN_WAREHOUSE"
      ) {
        toast.error(
          "В графике есть работники другого склада. Обновите данные склада."
        )
      } else {
        toast.error(
          cause instanceof ApiError ? cause.message : "Не удалось сохранить график"
        )
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={handleSave}
        disabled={!warehouse || isSaving || !hasSchedule}
      >
        <Save />
        {isSaving ? "Сохранение…" : "Сохранить график"}
      </Button>

      <Button
        variant="outline"
        onClick={() =>
          handleExcelExport({ users, currentMonth, dayCount, nightCount })
        }
        disabled={!users.length}
      >
        <Sheet />
        Экспорт в Excel
      </Button>

      <Button variant="outline" disabled title="Появится позже">
        <FileDown />
        Экспорт в PDF
      </Button>
    </div>
  )
}

export default ExportsButtonWrapper
