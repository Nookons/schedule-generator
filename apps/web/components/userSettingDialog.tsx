"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Label } from "@workspace/ui/components/label"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { UserPen } from "lucide-react"
import dayjs from "dayjs"

import { ApiError } from "@/lib/api/client"
import type { EmployeePrefsUpdate, ShiftPreference } from "@/lib/api/types"
import { normalizePreference } from "@/lib/employeeMapping"
import { ScheduleApi } from "@/services/ScheduleApi"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"
import type { IUser } from "@/types/User"

/**
 * Настройки предпочтений работника.
 *
 * Данные хранятся на двух уровнях: постоянные («база») и переопределение на
 * конкретный месяц. Интерфейс не скрывает это разделение, потому что от него
 * зависит результат: то, что менеджер правит в сентябре, не обязано
 * действовать в октябре.
 *
 * Сохранение идёт на сервер сразу — локальной копии настроек нет, иначе она
 * разошлась бы с базой при работе в двух вкладках.
 */

type Scope = "base" | "month"

const SHIFT_PREFERENCES: { value: ShiftPreference; label: string }[] = [
  { value: "all", label: "Любые смены" },
  { value: "day", label: "День (предпочтительно)" },
  { value: "night", label: "Ночь (предпочтительно)" },
  { value: "only_day", label: "Только день" },
  { value: "only_night", label: "Только ночь" },
]

interface FormState {
  shiftPreference: ShiftPreference
  priority: number
  minShiftsPerMonth: number
  maxShiftsPerMonth: number
  daysOff: number[]
  note: string
}

function formFromUser(user: IUser): FormState {
  return {
    shiftPreference: user.shiftPreference,
    priority: user.priority,
    minShiftsPerMonth: user.minShiftsPerMonth,
    maxShiftsPerMonth: user.maxShiftsPerMonth,
    daysOff: [...user.daysOffUsers].sort((a, b) => a - b),
    note: user.note ?? "",
  }
}

const UserSettingDialog = ({ user }: { user: IUser }) => {
  const month = useSettingStore((state) => state.currentMonth)
  const daysInMonth = dayjs(month).daysInMonth()

  const [isOpen, setIsOpen] = useState(false)
  const [scope, setScope] = useState<Scope>("base")
  const [form, setForm] = useState<FormState>(() => formFromUser(user))
  const [isSaving, setIsSaving] = useState(false)

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    // Открытие всегда начинается с текущих данных: диалог мог остаться
    // с несохранёнными правками от прошлого раза.
    if (open) setForm(formFromUser(user))
  }

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOff: prev.daysOff.includes(day)
        ? prev.daysOff.filter((value) => value !== day)
        : [...prev.daysOff, day].sort((a, b) => a - b),
    }))
  }

  const handleSave = async () => {
    if (form.maxShiftsPerMonth < form.minShiftsPerMonth) {
      toast.error("Максимум смен не может быть меньше минимума")
      return
    }

    const payload: EmployeePrefsUpdate = {
      shift_preference: form.shiftPreference,
      priority: form.priority,
      min_shifts_per_month: form.minShiftsPerMonth,
      max_shifts_per_month: form.maxShiftsPerMonth,
      days_off: form.daysOff,
      note: form.note.trim() || null,
    }
    // Поле month в теле выбирает, куда писать: null — база, строка — месяц.
    if (scope === "month") payload.month = month

    setIsSaving(true)
    try {
      const bundle = await ScheduleApi.savePrefs(user.id, payload, month)
      applyBundle(bundle.effective, bundle.month_override !== null)
      toast.success(
        scope === "base"
          ? "Базовые настройки сохранены"
          : `Настройки на ${month} сохранены`
      )
      setIsOpen(false)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Не удалось сохранить"
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetMonth = async () => {
    setIsSaving(true)
    try {
      const bundle = await ScheduleApi.deleteMonthOverride(user.id, month)
      applyBundle(bundle.effective, false)
      toast.success(`Переопределение на ${month} снято`)
      setIsOpen(false)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Не удалось сбросить"
      )
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Сброс постоянных настроек к значениям по умолчанию.
   *
   * Переопределение на месяц при этом сохраняется — это отдельные данные,
   * и стирать договорённость по конкретному месяцу заодно с «обычным режимом»
   * было бы неожиданно.
   */
  const handleResetBase = async () => {
    setIsSaving(true)
    try {
      const bundle = await ScheduleApi.deleteBasePrefs(user.id, month)
      applyBundle(bundle.effective, bundle.month_override !== null)
      // Диалог остаётся открытым: сброс — это не сохранение, и менеджеру
      // полезно увидеть, к чему вернулись значения, прежде чем закрывать.
      setForm({
        shiftPreference: bundle.effective.shift_preference,
        priority: bundle.effective.priority,
        minShiftsPerMonth: bundle.effective.min_shifts_per_month,
        maxShiftsPerMonth: bundle.effective.max_shifts_per_month,
        daysOff: [...bundle.effective.days_off].sort((a, b) => a - b),
        note: bundle.effective.note ?? "",
      })
      toast.success("Постоянные настройки сброшены к значениям по умолчанию")
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Не удалось сбросить"
      )
    } finally {
      setIsSaving(false)
    }
  }

  /** Переносит ответ сервера в стор — без повторной загрузки всего склада. */
  const applyBundle = (
    effective: {
      shift_preference: ShiftPreference
      priority: number
      min_shifts_per_month: number
      max_shifts_per_month: number
      days_off: number[]
      note: string | null
    },
    hasOverride: boolean
  ) => {
    useUsersStore.getState().updateUser(user.subject, {
      // Через нормализатор, а не как есть: значение пришло из сети, а
      // генератор вызывает у него `toLowerCase()`.
      shiftPreference: normalizePreference(effective.shift_preference),
      priority: effective.priority,
      minShiftsPerMonth: effective.min_shifts_per_month,
      maxShiftsPerMonth: effective.max_shifts_per_month,
      daysOffUsers: [...effective.days_off].sort((a, b) => a - b),
      note: effective.note,
      hasMonthOverride: hasOverride,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Настройки ${user.fullName}`}>
          <UserPen className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user.fullName}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            Предпочтения работника
            {user.hasMonthOverride && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                на {month} переопределены
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>Куда сохранять</FieldLabel>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as Scope)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">
                  Постоянные настройки (по умолчанию)
                </SelectItem>
                <SelectItem value="month">Только на {month}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Предпочтение по сменам</FieldLabel>
            <Select
              value={form.shiftPreference}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  shiftPreference: value as ShiftPreference,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_PREFERENCES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <Label htmlFor="priority">Приоритет (1–10)</Label>
            <Input
              id="priority"
              type="number"
              min={1}
              max={10}
              value={form.priority}
              onChange={(event) => {
                const parsed = Number(event.target.value)
                setForm((prev) => ({
                  ...prev,
                  priority: Number.isFinite(parsed)
                    ? Math.min(10, Math.max(1, parsed))
                    : 1,
                }))
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field>
              <Label htmlFor="minShifts">Минимум смен в месяц</Label>
              <Input
                id="minShifts"
                type="number"
                min={0}
                max={31}
                value={form.minShiftsPerMonth}
                onChange={(event) => {
                  const parsed = Number(event.target.value)
                  setForm((prev) => ({
                    ...prev,
                    minShiftsPerMonth: Number.isFinite(parsed)
                      ? Math.max(0, parsed)
                      : 0,
                  }))
                }}
              />
            </Field>
            <Field>
              <Label htmlFor="maxShifts">Максимум смен в месяц</Label>
              <Input
                id="maxShifts"
                type="number"
                min={0}
                max={31}
                value={form.maxShiftsPerMonth}
                onChange={(event) => {
                  const parsed = Number(event.target.value)
                  setForm((prev) => ({
                    ...prev,
                    maxShiftsPerMonth: Number.isFinite(parsed)
                      ? Math.max(0, parsed)
                      : 0,
                  }))
                }}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Выходные дни</FieldLabel>
            <div className="mt-1 flex flex-wrap gap-1">
              {Array.from({ length: daysInMonth }).map((_, index) => {
                const day = index + 1
                const selected = form.daysOff.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleDay(day)}
                    className={`h-7 w-7 rounded border text-xs transition-colors ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field>
            <Label htmlFor="note">Комментарий</Label>
            <Input
              id="note"
              placeholder="Пожелания, ограничения…"
              value={form.note}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, note: event.target.value }))
              }
            />
          </Field>
        </FieldGroup>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {user.hasMonthOverride && (
              <Button
                variant="outline"
                onClick={handleResetMonth}
                disabled={isSaving}
              >
                Сбросить на {month}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleResetBase}
              disabled={isSaving}
              title="Вернуть постоянные настройки к значениям по умолчанию"
            >
              Сбросить всё
            </Button>
          </div>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline">Отмена</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default UserSettingDialog
