/**
 * Типы ответов tk-assist-api.
 *
 * Зеркалят Pydantic-модели `app/schemas/schedule.py` и `Employee` из
 * `app/schemas/common.py`. Пока контракт не генерируется из OpenAPI, эти
 * описания приходится поддерживать руками — расхождение проявится только
 * в рантайме, поэтому менять их нужно вместе с бэкендом.
 */

/** Предпочтение по типу смены. */
export type ShiftPreference = "only_day" | "only_night" | "day" | "night" | "all"

/** Тип смены в графике. */
export type ShiftType = "day" | "night"

/**
 * Почему человек не работает в этот день.
 *
 * `off`, `vacation` и `sick` действуют на всех складах сразу: это свойство
 * человека. `unavailable` — «не могу работать в этот день на этом складе»:
 * сервер отдаёт её только тому складу, которого она касается, поэтому клиенту
 * не нужно знать про область действия — он всегда видит уже отфильтрованное.
 */
export type DayMarkKind = "off" | "vacation" | "sick" | "unavailable"

/** Состояние клетки дня, которое ставит менеджер. `none` — пустой день. */
export type DayState = ShiftType | DayMarkKind | "none"

/** Месяц в формате `YYYY-MM`. */
export type MonthLabel = string

export interface Warehouse {
  id: number
  title: string
  address: string | null
  companies: unknown | null
}

/** Эффективные предпочтения: результат слияния базы и переопределения. */
export interface EmployeePrefsEffective {
  shift_preference: ShiftPreference
  min_shifts_per_month: number
  max_shifts_per_month: number
  priority: number
  days_off: number[]
  note: string | null
  has_month_override: boolean
}

export interface EmployeePrefsBase {
  employee_id: number
  shift_preference: ShiftPreference
  min_shifts_per_month: number
  max_shifts_per_month: number
  priority: number
  days_off: number[]
  note: string | null
  updated_at: string | null
}

export interface EmployeePrefsMonth {
  employee_id: number
  month: MonthLabel
  shift_preference: ShiftPreference | null
  min_shifts_per_month: number | null
  max_shifts_per_month: number | null
  priority: number | null
  days_off: number[] | null
  note: string | null
  updated_at: string | null
}

export interface EmployeePrefsBundle {
  employee_id: number
  month: MonthLabel
  base: EmployeePrefsBase | null
  month_override: EmployeePrefsMonth | null
  effective: EmployeePrefsEffective
}

/**
 * Отметка дня: выходной, отпуск, больничный. Склада нет — невыход общий.
 * Нет и участника: отметка всегда приходит внутри своего участника.
 */
export interface DayMark {
  day: number
  kind: DayMarkKind
  note: string | null
}

/** Смена этого человека на другом складе в том же месяце. */
export interface ExternalShift {
  day: number
  shift_type: ShiftType
  warehouse: string
}

/** Ссылка на участника графика: `e61` — работник, `w3` — нерeгистрированный. */
export type SubjectKey = string

/** Работник склада вместе с предпочтениями на выбранный месяц. */
export interface ScheduleParticipant {
  /** Ссылка, которой адресуются все операции: `e61` или `w3`. */
  subject: SubjectKey
  /** Зарегистрирован в tk-assist или заведён одним именем. */
  kind: "employee" | "worker"
  /** Идентификатор в своей таблице. */
  id: number
  card_id: number | null
  user_name: string
  warehouse: string | null
  role: string | null
  is_leader: boolean | null
  is_active: boolean | null
  avatar_url: string | null
  prefs: EmployeePrefsEffective
  /** Отметки дня на выбранный месяц. */
  marks?: DayMark[]
  /** Смены на других складах в том же месяце. */
  external_shifts?: ExternalShift[]
  /** Хвост предыдущего месяца: правила отдыха смотрят и за границу месяца. */
  previous_shifts?: PreviousShift[]
}

/**
 * Смена в конце предыдущего месяца.
 *
 * День задан смещением назад от первого числа планируемого месяца: `0` —
 * последний день предыдущего месяца, `-1` — предпоследний. Так клиенту не
 * нужно знать длину предыдущего месяца, а правило «после ночи не день»
 * вычитает из числа дня и попадает ровно в эти значения.
 */
export interface PreviousShift {
  day: number
  shift_type: ShiftType
  warehouse: string
}

/** Участник в составе склада на выбранный месяц. */
export interface ScheduleStaffMember {
  subject: SubjectKey
  kind: "employee" | "worker"
  id: number
  user_name: string
  /** Склад из карточки. Может не совпадать с текущим — состав ведётся отдельно. */
  home_warehouse: string | null
  role: string | null
  is_active: boolean | null
  /** Числится в составе склада вообще, независимо от правок месяца. */
  in_base: boolean
  /** Правка именно этого месяца: добавлен или убран точечно. */
  month_action: "add" | "remove" | null
  /** Виден ли в составе выбранного месяца — сервер считает это сам. */
  is_staff: boolean
}

export interface StaffChangeResult {
  warehouse: string
  month: string
  added: number
  removed: number
  total: number
}

/** Что стоит в дне после правки. */
export interface DayStateResult {
  subject: SubjectKey
  day: number
  state: DayState
  /** День занят выходным по постоянным настройкам — ручная правка его не снимает. */
  locked_by_prefs: boolean
  /**
   * Смена, поставленная кликом, закрепляется автоматически: сервер сообщает об
   * этом прямо, чтобы клиент не выводил закрепление из состояния дня сам.
   */
  pinned: boolean
}

/** Ответ на переключение закрепления смены. */
export interface DayPinResult {
  subject: SubjectKey
  day: number
  pinned: boolean
}

/** Человек, заведённый одним именем: ни карты, ни почты, ни роли. */
export interface UnregisteredWorker {
  id: number
  subject: SubjectKey
  full_name: string
  note: string | null
  /** Заполняется, когда человека связали с записью в employees. */
  linked_employee_id: number | null
  created_at: string | null
}

export interface UnregisteredWorkerCreate {
  full_name: string
  note?: string | null
}

/** Итог связывания нерeгистрированного с работником. */
export interface UnregisteredWorkerLinkResult {
  worker_id: number
  employee_id: number
  /** Ссылка работника, на которую теперь ссылается график. */
  subject: SubjectKey
  staff: number
  marks: number
  shifts: number
}

export interface UnregisteredWorkerUpdate {
  full_name?: string
  note?: string | null
}

/** Работник из общего справочника — для выбора кандидатов в состав склада. */
export interface DirectoryEmployee {
  id: number
  card_id: number | null
  user_name: string | null
  warehouse: string | null
  role: string | null
  is_leader: boolean | null
  is_active: boolean | null
  avatar_url: string | null
}

/** Тело сохранения предпочтений. `month` не задан — пишем в базовые. */
export interface EmployeePrefsUpdate {
  month?: MonthLabel | null
  shift_preference?: ShiftPreference
  min_shifts_per_month?: number
  max_shifts_per_month?: number
  priority?: number
  days_off?: number[]
  note?: string | null
}

export interface ScheduleSettings {
  warehouse: string
  month: MonthLabel
  day_count: number
  night_count: number
  after_night_off: number
  after_day_off: number
  updated_at?: string | null
}

export interface ScheduleSettingsUpdate {
  warehouse: string
  month: MonthLabel
  day_count: number
  night_count: number
  after_night_off: number
  after_day_off: number
}

export interface ScheduleShift {
  subject: SubjectKey
  day: number
  shift_type: ShiftType
  /** Смена поставлена вручную: алгоритм её не двигает. */
  pinned: boolean
}

export interface ScheduleMonth {
  warehouse: string
  month: MonthLabel
  shifts: ScheduleShift[]
}

export interface ScheduleShiftsSaved {
  warehouse: string
  month: MonthLabel
  saved: number
  /**
   * Скольким людям ушло уведомление об изменении их смен.
   *
   * Ноль — обычное дело: повторное сохранение того же графика никого не
   * касается. Показываем число менеджеру, иначе он не знает, дошло ли до людей.
   */
  notified: number
}
