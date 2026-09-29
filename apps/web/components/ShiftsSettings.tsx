"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { ApiError } from "@/lib/api/client"
import { ScheduleApi } from "@/services/ScheduleApi"
import { useSettingStore } from "@/store/useSettingStore"

/**
 * Требования менеджера к графику.
 *
 * Правки хранятся отдельно от сохранённых значений: в форме показывается
 * сохранённое значение, перекрытое правкой, если она есть. Так значения,
 * пришедшие из API, подхватываются сами, и не нужен эффект, синхронизирующий
 * стор с локальным состоянием, — раньше их было два встречных, и это давало
 * каскадные рендеры.
 *
 * При смене склада или месяца компонент пересоздаётся по `key`, поэтому
 * несохранённые правки не переезжают на другой месяц.
 */

type FieldName =
  | "dayCount"
  | "nightCount"
  | "afterNightDayOffs"
  | "afterDayDayOffs"

const ShiftsSettings = () => {
  const warehouse = useSettingStore((state) => state.warehouse)
  const month = useSettingStore((state) => state.currentMonth)
  const stored = {
    dayCount: useSettingStore((state) => state.dayCount),
    nightCount: useSettingStore((state) => state.nightCount),
    afterNightDayOffs: useSettingStore((state) => state.afterNightDayOffs),
    afterDayDayOffs: useSettingStore((state) => state.afterDayDayOffs),
  }
  const applySettings = useSettingStore((state) => state.applySettings)

  const [edits, setEdits] = useState<Partial<Record<FieldName, number>>>({})
  const [isSaving, setIsSaving] = useState(false)

  const form = { ...stored, ...edits }
  const isDirty = Object.keys(edits).length > 0

  const setField = (field: FieldName, value: number) =>
    setEdits((prev) => ({ ...prev, [field]: value }))

  const handleSave = async () => {
    if (!warehouse) return

    setIsSaving(true)
    try {
      const saved = await ScheduleApi.saveSettings({
        warehouse,
        month,
        day_count: form.dayCount,
        night_count: form.nightCount,
        after_night_off: form.afterNightDayOffs,
        after_day_off: form.afterDayDayOffs,
      })
      applySettings(saved)
      setEdits({})
      toast.success("Требования сохранены")
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : "Не удалось сохранить требования"
      )
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Ограничения те же, что в схеме API: значения вне диапазона сервер
   * отклонил бы ошибкой 422, и пользователь увидел бы отказ без объяснения.
   *
   * Пояснение к полю уходит в `title`, а не отдельной строкой под ним:
   * подписи разной длины растягивали сетку по высоте, и кнопка сохранения,
   * выровненная по нижнему краю, уезжала вниз от полей.
   */
  const numberField = (
    id: string,
    label: string,
    value: number,
    max: number,
    onChange: (value: number) => void,
    hint?: string
  ) => (
    <Field>
      <FieldLabel htmlFor={id} title={hint}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        min={0}
        max={max}
        title={hint}
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          // Пустое поле даёт NaN — приводим к нулю, чтобы в API не уехал null.
          onChange(
            Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0
          )
        }}
      />
    </Field>
  )

  return (
    // Одна сетка вместо «flex + FieldGroup + Button».
    //
    // У `FieldGroup` жёстко заданы `flex w-full flex-col`, а у `Field` —
    // `w-full`. В обычном flex-ряду они растягивались на всю доступную ширину
    // и выдавливали кнопку «Сохранить» за край, а между полями появлялись
    // произвольные промежутки. Здесь ширина колонок задана явно, кнопка —
    // пятая колонка по содержимому, и никакие чужие значения по умолчанию
    // в раскладку не вмешиваются.
    <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))_auto] items-end gap-2">
      {numberField(
        "day-count",
        "Человек в день",
        form.dayCount,
        100,
        (value) => setField("dayCount", value)
      )}
      {numberField(
        "night-count",
        "Человек в ночь",
        form.nightCount,
        100,
        (value) => setField("nightCount", value)
      )}
      {numberField(
        "after-night-off",
        "Отдых после ночи",
        form.afterNightDayOffs,
        30,
        (value) => setField("afterNightDayOffs", value),
        "День сразу после ночи запрещён всегда; здесь — сколько ещё дней отдыха нужно"
      )}
      {numberField(
        "after-day-off",
        "Отдых после дня",
        form.afterDayDayOffs,
        30,
        (value) => setField("afterDayDayOffs", value),
        "Ночь сразу после дневной алгоритм избегает всегда; здесь — на сколько дней вперёд это правило смотрит"
      )}

      <Button
        onClick={handleSave}
        disabled={!warehouse || isSaving || !isDirty}
        variant={isDirty ? "default" : "outline"}
      >
        {isSaving ? "Сохранение…" : "Сохранить"}
      </Button>
    </div>
  )
}

export default ShiftsSettings
