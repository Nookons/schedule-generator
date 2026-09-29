"use client"

import { useCallback, useEffect, useState } from "react"

import { ApiError } from "@/lib/api/client"
import type { ScheduleShift } from "@/lib/api/types"
import { toUsers } from "@/lib/employeeMapping"
import { ScheduleApi } from "@/services/ScheduleApi"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore, type SubjectSchedule } from "@/store/useUsersStore"

/**
 * Загрузка всего, что нужно для графика: состав склада, требования и уже
 * сохранённый график.
 *
 * Три запроса идут параллельно, потому что не зависят друг от друга, но
 * применяются строго по порядку: график накладывается на уже загруженный
 * состав. Если сделать наоборот, смены не к чему было бы привязать.
 *
 * Состояния загрузки и ошибки не хранятся отдельными флагами, а выводятся из
 * ключа запроса. Флаг пришлось бы сбрасывать синхронно в начале эффекта, а
 * это лишний каскад рендеров; производное значение меняется само вместе с
 * ключом и не может «застрять» от предыдущего склада.
 */

export interface ScheduleDataState {
  isLoading: boolean
  error: string | null
  /** Повторная загрузка — для кнопки «Повторить» после ошибки. */
  reload: () => void
}

/**
 * Раскладывает смены по работникам.
 *
 * Смены людей, которых больше нет в составе склада, отбрасываются: строка в
 * `schedule_shifts` остаётся даже после перевода работника в другой склад, и
 * без этой проверки в графе появились бы смены «ни за кем».
 *
 * Закрепление берётся отсюда же, из тех же строк: это свойство смены, и
 * отдельный запрос за ним означал бы, что смены и закрепления могут приехать
 * в разных состояниях.
 */
function buildScheduleMap(
  subjects: string[],
  shifts: ScheduleShift[]
): Record<string, SubjectSchedule> {
  const known = new Set(subjects)
  const map: Record<string, SubjectSchedule> = {}

  for (const subject of subjects) {
    map[subject] = { dayShifts: [], nightShifts: [], pinnedDays: [] }
  }

  for (const shift of shifts) {
    if (!known.has(shift.subject)) continue
    // Запись создана выше для каждого участника состава; проверка нужна
    // только чтобы типы сошлись.
    const entry = map[shift.subject]
    if (!entry) continue
    if (shift.shift_type === "day") entry.dayShifts.push(shift.day)
    else entry.nightShifts.push(shift.day)
    if (shift.pinned) entry.pinnedDays.push(shift.day)
  }

  return map
}

/** Понятное сообщение вместо кода ошибки. */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isAuthError) return "Сессия истекла. Войдите заново."
    if (error.isPermissionError) return "Нет доступа к этому складу."
    if (error.isMigrationMissing) {
      return (
        "Таблицы планировщика не найдены. Примените миграции " +
        "0010–0015 из supabase/migrations."
      )
    }
    // Пятисотка при загрузке графика почти всегда означает ту же
    // неприменённую миграцию, только другого рода: таблицы есть, а колонки
    // (например, `pinned` из 0014) ещё нет. Общая формулировка «Internal error»
    // не подсказывает, что делать, а действие здесь ровно одно.
    if (error.status >= 500) {
      return (
        "Сервер не смог прочитать график. Если планировщик только что " +
        "обновили, примените свежие миграции из supabase/migrations."
      )
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return "Не удалось загрузить данные"
}

interface ErrorState {
  key: string
  message: string
}

export function useScheduleData(): ScheduleDataState {
  const warehouse = useSettingStore((state) => state.warehouse)
  const month = useSettingStore((state) => state.currentMonth)

  const [reloadToken, setReloadToken] = useState(0)
  const [resolvedKey, setResolvedKey] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<ErrorState | null>(null)

  const requestKey = warehouse ? `${warehouse}|${month}|${reloadToken}` : null

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    // Склад не выбран — грузить нечего. Состав очищаем, иначе на экране
    // остался бы график предыдущего склада. Это обновление внешнего стора,
    // а не состояние этого компонента.
    if (!requestKey || !warehouse) {
      useUsersStore.getState().reset()
      return
    }

    const controller = new AbortController()
    let active = true

    Promise.all([
      ScheduleApi.listEmployees(warehouse, month, controller.signal),
      ScheduleApi.getSettings(warehouse, month),
      ScheduleApi.getShifts(warehouse, month, controller.signal),
    ])
      .then(([employees, settings, schedule]) => {
        if (!active) return

        useSettingStore.getState().applySettings(settings)
        useUsersStore.getState().setUsers(toUsers(employees))
        useUsersStore
          .getState()
          .applySchedule(
            buildScheduleMap(
              employees.map((employee) => employee.subject),
              schedule.shifts
            )
          )
      })
      .catch((cause: unknown) => {
        // Отмена при смене склада или месяца — не ошибка: результат этого
        // запроса всё равно больше не нужен.
        if (cause instanceof DOMException && cause.name === "AbortError") return
        if (!active) return
        setErrorState({ key: requestKey, message: describeError(cause) })
      })
      .finally(() => {
        if (active) setResolvedKey(requestKey)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [requestKey, warehouse, month])

  return {
    // Ошибка относится только к текущему ключу: сообщение от прошлого склада
    // не должно висеть на экране после переключения.
    error: errorState?.key === requestKey ? errorState.message : null,
    isLoading: requestKey !== null && resolvedKey !== requestKey,
    reload,
  }
}
