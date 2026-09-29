"use client"

import { useEffect, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { RefreshCw } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { ApiError } from "@/lib/api/client"
import type { Warehouse } from "@/lib/api/types"
import { ScheduleApi } from "@/services/ScheduleApi"
import { useSettingStore } from "@/store/useSettingStore"

/**
 * Выбор склада — точка входа в приложение.
 *
 * Работники, требования и график привязаны к складу, поэтому до выбора
 * грузить нечего. Список берётся из справочника `warehouses` через API,
 * а не из данных графиков: пустой склад тоже должен быть доступен.
 *
 * Признак загрузки выводится из номера попытки, а не хранится флагом: флаг
 * пришлось бы выставлять синхронно в начале эффекта, что даёт лишний рендер.
 */

interface LoadError {
  attempt: number
  message: string
}

const WarehouseSelector = () => {
  const warehouse = useSettingStore((state) => state.warehouse)
  const updateWarehouse = useSettingStore((state) => state.updateWarehouse)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [attempt, setAttempt] = useState(0)
  const [loadedAttempt, setLoadedAttempt] = useState<number | null>(null)
  const [errorState, setErrorState] = useState<LoadError | null>(null)

  const isLoading = loadedAttempt !== attempt
  const error = errorState?.attempt === attempt ? errorState.message : null

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    ScheduleApi.listWarehouses()
      .then((rows) => {
        if (!active) return
        setWarehouses(rows)

        // Текущее значение читаем из стора, а не из замыкания: эффект
        // перезапускается только по кнопке «Повторить», и замкнутое значение
        // успело бы устареть.
        const settings = useSettingStore.getState()
        if (!settings.warehouse && rows.length === 1) {
          // Угадывать за менеджера при выборе из нескольких хуже, чем
          // попросить выбрать; при единственном складе выбора нет.
          settings.updateWarehouse(rows[0]?.title ?? "")
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        setErrorState({
          attempt,
          message:
            cause instanceof ApiError
              ? cause.message
              : "Не удалось загрузить список складов",
        })
      })
      .finally(() => {
        if (active) setLoadedAttempt(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  return (
    // `w-auto` обязателен: у `Field` жёстко задан `w-full`, и в ряду рядом
    // с выбором месяца он растягивался на всю ширину, оставляя между собой
    // и соседним блоком произвольный промежуток.
    <Field className="w-auto">
      <FieldLabel htmlFor="warehouse-select">Склад</FieldLabel>
      <div className="flex items-center gap-2">
        <Select
          // Пустая строка, а не `undefined`: с `undefined` селект стартовал
          // неконтролируемым и переключался на контролируемый, когда склад
          // появлялся. React об этом предупреждает, а выбранное значение
          // может не отобразиться. Radix показывает placeholder и при `""`.
          value={warehouse ?? ""}
          onValueChange={updateWarehouse}
          disabled={isLoading || warehouses.length === 0}
        >
          <SelectTrigger id="warehouse-select" className="w-[220px]">
            <SelectValue
              placeholder={isLoading ? "Загрузка…" : "Выберите склад"}
            />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((item) => (
              <SelectItem key={item.id} value={item.title}>
                {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {error && (
          <>
            <p className="text-xs text-destructive">{error}</p>
            <Button
              variant="outline"
              size="icon"
              aria-label="Повторить загрузку складов"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        )}

        {!error && !isLoading && warehouses.length === 0 && (
          <p className="text-xs text-muted-foreground">
            В справочнике нет ни одного склада
          </p>
        )}
      </div>
    </Field>
  )
}

export default WarehouseSelector
