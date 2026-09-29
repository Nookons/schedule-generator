"use client"

import { useState } from "react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { ApiError } from "@/lib/api/client"
import type { DayMarkKind, DayState } from "@/lib/api/types"
import { dayVisual } from "@/lib/dayVisual"
import { ScheduleApi } from "@/services/ScheduleApi"
import { useUsersStore } from "@/store/useUsersStore"
import type { IUser } from "@/types/User"

/**
 * Клетка дня с меню состояний.
 *
 * Одна операция на все состояния: менеджер нажимает на день и выбирает, что
 * там стоит. Отдельные кнопки «сделать выходным» и «сделать отпуском»
 * заставляли бы искать нужную в зависимости от текущего состояния.
 *
 * Клетка — кнопка, а не div: по таблице нужно ходить с клавиатуры, и меню
 * должно открываться с Enter.
 *
 * Что именно нарисовать, решает `dayVisual`: цвета и подписи общие с
 * расшифровкой под таблицей и с экспортом в Excel. Копия тех же цветов здесь
 * означала бы, что расшифровка однажды начнёт врать.
 *
 * Смена, поставленная кликом, закрепляется на сервере: следующая генерация её
 * не переставит. Закрепление видно точкой в углу клетки, а снимается пунктом
 * меню — «Очистить день» для этого не годится, оно убирает и саму смену.
 */

/**
 * Названия отметок в меню. Цвета берутся из `dayVisual`, здесь только слова.
 *
 * Последний пункт отличается от остальных областью действия, и это в подписи
 * сказано прямо: отпуск, выходной и больничный снимают человека со всех
 * складов, а «не могу здесь» — только с этого.
 */
const MARK_MENU: Record<DayMarkKind, string> = {
  off: "Выходной",
  vacation: "Отпуск",
  sick: "Больничный",
  unavailable: "Не могу работать здесь",
}

function describeError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === "DUPLICATE_SHIFT") {
      const detail = cause.details[0] as
        | { warehouses?: string[] }
        | undefined
      const where = detail?.warehouses?.join(", ")
      return where
        ? `В этот день человек уже работает на другом складе: ${where}`
        : "В этот день у человека уже есть смена"
    }
    if (cause.code === "EMPLOYEE_NOT_IN_WAREHOUSE") {
      return "Работника нет в составе этого склада"
    }
    if (cause.code === "DAY_LOCKED_BY_PREFS") {
      return "День отмечен выходным в постоянных настройках работника — сначала уберите его там"
    }
    if (cause.code === "DAY_HAS_GLOBAL_MARK") {
      return (
        "В этот день уже стоит отпуск, выходной или больничный — он действует " +
        "на всех складах. Сначала очистите день"
      )
    }
    if (cause.code === "SHIFT_NOT_FOUND") {
      return "В этот день нет смены — закреплять нечего"
    }
    return cause.message
  }
  return "Не удалось изменить день"
}

const DayCell = ({
  user,
  day,
  warehouse,
  month,
}: {
  user: IUser
  day: number
  warehouse: string
  month: string
}) => {
  const [isSaving, setIsSaving] = useState(false)

  const visual = dayVisual(user, day)
  // Закрепить можно только свою смену: день на другом складе принадлежит ему,
  // и сервер такую правку отклонит.
  const ownShift =
    user.dayShifts.includes(day) || user.nightShifts.includes(day)
  const isPinned = ownShift && user.pinnedDays.includes(day)

  const apply = async (state: DayState) => {
    setIsSaving(true)
    try {
      const result = await ScheduleApi.setDayState({
        warehouse,
        subject: user.subject,
        month,
        day,
        state,
      })
      // Локально, без перезагрузки склада: сервер правку подтвердил, а три
      // запроса на каждый клик заставляли бы таблицу мигать. Закрепление
      // приходит в том же ответе — выводить его из состояния дня на клиенте
      // значило бы завести второе правило, которое однажды разойдётся с сервером.
      useUsersStore
        .getState()
        .setUserDay(user.subject, day, result.state, result.pinned)

      if (result.locked_by_prefs) {
        toast.info(
          "День отмечен выходным в постоянных настройках работника — уберите его там"
        )
      }
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const togglePin = async () => {
    setIsSaving(true)
    try {
      const result = await ScheduleApi.setDayPin({
        warehouse,
        subject: user.subject,
        month,
        day,
        pinned: !isPinned,
      })
      useUsersStore.getState().setUserPin(user.subject, day, result.pinned)
      toast.success(
        result.pinned
          ? "День закреплён: алгоритм его не переставит"
          : "День откреплён: алгоритм может его переставить"
      )
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Закрепление — часть доступного имени, а не только точка: с
          // клавиатуры и скринридером точку в углу не увидеть.
          title={isPinned ? `${visual.title} · закреплено` : visual.title}
          disabled={isSaving}
          className={`${visual.className} relative w-full cursor-pointer border-2 border-transparent py-2 text-center text-xs hover:border-primary focus:border-primary focus:outline-none disabled:opacity-60`}
        >
          {visual.label}
          {isPinned && (
            <span
              aria-hidden
              className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-current opacity-70"
            />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="center">
        <DropdownMenuLabel>
          {user.fullName} · {day}
          {isPinned && " · закреплено"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => apply("day")}>
          Дневная смена
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => apply("night")}>
          Ночная смена
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Общие отметки отделены от складской: они снимают человека со всех
            складов, а последний пункт — только с этого. */}
        {(["off", "vacation", "sick"] as const).map((kind) => (
          <DropdownMenuItem key={kind} onSelect={() => apply(kind)}>
            {MARK_MENU[kind]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => apply("unavailable")}>
          {MARK_MENU.unavailable}
        </DropdownMenuItem>
        {ownShift && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={togglePin}>
              {isPinned ? "Открепить день" : "Закрепить день"}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => apply("none")}>
          Очистить день
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default DayCell
