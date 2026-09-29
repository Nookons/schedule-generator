import type {
  EmployeePrefsEffective,
  ScheduleParticipant,
  ShiftPreference,
  ShiftType,
} from "@/lib/api/types"
import type { IUser } from "@/types/User"

/**
 * Преобразование работника из API в модель генератора.
 *
 * Участник — это либо зарегистрированный работник, либо человек, заведённый
 * одним именем. Разница видна в `kind`, но для таблицы и генератора они
 * одинаковы: у нерeгистрированного просто нет карты, роли и предпочтений,
 * а значения по умолчанию приходят с сервера.
 *
 * Границы здесь ровно две, и обе важны:
 *  - сервер считает эффективные предпочтения (слияние базы и переопределения
 *    на месяц), клиент их только раскладывает по полям;
 *  - график (`dayShifts`/`nightShifts`) приходит не отсюда, а из
 *    `/schedule/shifts`, поэтому здесь он всегда пустой.
 *
 * Значения из сети приводятся к известным здесь же: генератор вызывает
 * `shiftPreference.toLowerCase()`, и любое неожиданное значение — пустая
 * строка, отсутствующее поле, новое слово с сервера — роняло построение
 * графика с `TypeError`. Проверять это в генераторе поздно: он работает
 * с моделью, а не с ответом API.
 */

const PREFERENCES: readonly ShiftPreference[] = [
  "only_day",
  "only_night",
  "day",
  "night",
  "all",
]

/** Неизвестное значение трактуется как «любые смены» — это безопасный выбор. */
export function normalizePreference(value: unknown): ShiftPreference {
  return PREFERENCES.includes(value as ShiftPreference)
    ? (value as ShiftPreference)
    : "all"
}

/**
 * Приводит число к безопасному значению.
 *
 * `Number.isFinite` отсекает и `undefined`, и `NaN`, и `Infinity`: любое из
 * них, попав в генератор, дало бы `NaN` в счёте смен и пустой график без
 * единого сообщения об ошибке.
 */
function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/**
 * Раскладывает список с днём по карте «число месяца → значение».
 *
 * Записи с днём вне месяца отбрасываются: рисовать их всё равно негде, а
 * сдвинуть раскладку строки они могут — колонок ровно столько, сколько дней
 * в месяце.
 */
function toDayMap<TRow extends { day: number }, T>(
  rows: TRow[],
  value: (row: TRow) => T,
  daysInMonth = 31
): Record<number, T> {
  const map: Record<number, T> = {}
  for (const row of rows) {
    if (row.day >= 1 && row.day <= daysInMonth) {
      map[row.day] = value(row)
    }
  }
  return map
}

export function toUser(employee: ScheduleParticipant): IUser {
  // Ответ сети, а не доверенный объект: поля помечены обязательными в типах,
  // но типы не проверяются в рантайме, поэтому читаем их как необязательные.
  const prefs: Partial<EmployeePrefsEffective> | undefined = employee.prefs
  const daysOff = Array.isArray(prefs?.days_off) ? prefs.days_off : []

  return {
    subject: employee.subject,
    kind: employee.kind,
    id: employee.id,
    // Пустое имя сделало бы строку графика неотличимой от соседней, поэтому
    // подставляем идентификатор: он хотя бы уникален.
    fullName: employee.user_name?.trim() || `Участник #${employee.id}`,
    warehouse: employee.warehouse,
    priority: safeNumber(prefs?.priority, 1),
    shiftPreference: normalizePreference(prefs?.shift_preference),
    daysOffUsers: [...daysOff].sort((a, b) => a - b),
    marks: toDayMap(employee.marks ?? [], (mark) => mark.kind),
    externalShifts: toDayMap(employee.external_shifts ?? [], (shift) => ({
      shiftType: shift.shift_type as ShiftType,
      warehouse: shift.warehouse,
    })),
    // Не `toDayMap`: тот отбрасывает дни вне месяца, а здесь как раз они и
    // нужны — 0 и отрицательные. Это хвост предыдущего месяца для правил
    // отдыха, а не содержимое таблицы.
    previousShifts: (employee.previous_shifts ?? [])
      .filter((shift) => Number.isFinite(shift.day) && shift.day <= 0)
      .map((shift) => ({
        day: shift.day,
        shiftType: shift.shift_type as ShiftType,
        warehouse: shift.warehouse,
      })),
    dayShifts: [],
    nightShifts: [],
    // Закрепление приезжает не с составом, а вместе с графиком
    // (`/schedule/shifts`): это свойство смены, а не человека.
    pinnedDays: [],
    minShiftsPerMonth: safeNumber(prefs?.min_shifts_per_month, 0),
    // Ноль максимума заблокировал бы работника полностью, поэтому вместо
    // отсутствующего значения берём «без ограничения», как на сервере.
    maxShiftsPerMonth: safeNumber(prefs?.max_shifts_per_month, 31),
    // `null` в базе означает «не задано», и это не то же самое, что «отключён».
    isActive: employee.is_active !== false,
    hasMonthOverride: Boolean(prefs?.has_month_override),
    note: prefs?.note ?? null,
  }
}

export function toUsers(employees: ScheduleParticipant[]): IUser[] {
  return employees.map(toUser)
}
