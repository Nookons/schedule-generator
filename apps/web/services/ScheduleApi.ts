import { apiFetch } from "@/lib/api/client"
import type {
  DayPinResult,
  DayState,
  DayStateResult,
  DirectoryEmployee,
  EmployeePrefsBundle,
  EmployeePrefsUpdate,
  MonthLabel,
  ScheduleParticipant,
  ScheduleStaffMember,
  StaffChangeResult,
  SubjectKey,
  UnregisteredWorker,
  UnregisteredWorkerCreate,
  UnregisteredWorkerLinkResult,
  UnregisteredWorkerUpdate,
  ScheduleMonth,
  ScheduleSettings,
  ScheduleSettingsUpdate,
  ScheduleShift,
  ScheduleShiftsSaved,
  Warehouse,
} from "@/lib/api/types"

/**
 * Сервисный слой планировщика.
 *
 * Каждый метод — одна строка: путь, метод, типы. Вся работа с HTTP, токеном
 * и конвертом ответа живёт в `lib/api/client.ts`.
 *
 * Склад передаётся явно, хотя бэкенд умеет брать его из карточки сотрудника:
 * в планировщике менеджер осознанно выбирает склад, и неявный выбор по
 * карточке приводил бы к графикам не того склада.
 */
export class ScheduleApi {
  static listWarehouses(): Promise<Warehouse[]> {
    return apiFetch<Warehouse[]>("/v1/warehouses")
  }

  /** Состав склада с эффективными предпочтениями на месяц. */
  static listEmployees(
    warehouse: string,
    month: MonthLabel,
    signal?: AbortSignal
  ): Promise<ScheduleParticipant[]> {
    return apiFetch<ScheduleParticipant[]>("/v1/schedule/employees", {
      query: { warehouse, month },
      signal,
    })
  }

  static getPrefs(
    employeeId: number,
    month: MonthLabel
  ): Promise<EmployeePrefsBundle> {
    return apiFetch<EmployeePrefsBundle>(
      `/v1/schedule/employees/${employeeId}/prefs`,
      { query: { month } }
    )
  }

  /**
   * Сохраняет предпочтения.
   *
   * `month` в теле выбирает, куда писать: не задан — в базовые, задан —
   * в переопределение на этот месяц. `month` в аргументах — контекст ответа.
   */
  static savePrefs(
    employeeId: number,
    payload: EmployeePrefsUpdate,
    month: MonthLabel
  ): Promise<EmployeePrefsBundle> {
    return apiFetch<EmployeePrefsBundle>(
      `/v1/schedule/employees/${employeeId}/prefs`,
      { method: "PUT", query: { month }, body: payload }
    )
  }

  /** Снимает переопределение: работник возвращается к базовым настройкам. */
  static deleteMonthOverride(
    employeeId: number,
    month: MonthLabel
  ): Promise<EmployeePrefsBundle> {
    return apiFetch<EmployeePrefsBundle>(
      `/v1/schedule/employees/${employeeId}/prefs`,
      { method: "DELETE", query: { month } }
    )
  }

  /**
   * Сбрасывает постоянные предпочтения к значениям по умолчанию.
   *
   * Отдельный путь `/prefs/base`, а не тот же `/prefs` без параметра: без
   * сегмента в адресе «снять переопределение» и «сбросить всё» было бы не
   * различить, и один неверный запрос стирал бы постоянные настройки.
   */
  static deleteBasePrefs(
    employeeId: number,
    month: MonthLabel
  ): Promise<EmployeePrefsBundle> {
    return apiFetch<EmployeePrefsBundle>(
      `/v1/schedule/employees/${employeeId}/prefs/base`,
      { method: "DELETE", query: { month } }
    )
  }

  // --- Состав склада ---

  /**
   * Кто относится к составу склада на этот месяц.
   *
   * Месяц обязателен: сервер отдаёт и тех, кого на этот месяц убрали
   * (`is_staff: false`), — иначе клиент не смог бы их показать и вернуть.
   */
  static listStaff(
    warehouse: string,
    month: string,
    signal?: AbortSignal
  ): Promise<ScheduleStaffMember[]> {
    return apiFetch<ScheduleStaffMember[]>("/v1/schedule/staff", {
      query: { warehouse, month },
      signal,
    })
  }

  /**
   * Добавляет участников в состав. Повторное добавление не ошибка.
   *
   * `permanent: false` — только указанный месяц, `true` — базовый состав
   * склада, то есть все месяцы.
   */
  static addStaff(
    warehouse: string,
    month: string,
    subjects: SubjectKey[],
    permanent: boolean
  ): Promise<StaffChangeResult> {
    return apiFetch<StaffChangeResult>("/v1/schedule/staff", {
      method: "POST",
      body: { warehouse, month, subjects, permanent },
    })
  }

  /**
   * Убирает участника. Смены при этом сохраняются.
   *
   * `permanent` тот же: false — правка месяца, true — исключение из состава
   * склада целиком.
   */
  static removeStaff(
    warehouse: string,
    subject: SubjectKey,
    month: string,
    permanent: boolean
  ): Promise<StaffChangeResult> {
    return apiFetch<StaffChangeResult>("/v1/schedule/staff", {
      method: "DELETE",
      query: { warehouse, subject, month, permanent },
    })
  }

  // --- Люди без регистрации ---

  static listWorkers(): Promise<UnregisteredWorker[]> {
    return apiFetch<UnregisteredWorker[]>("/v1/schedule/workers")
  }

  /** Заводит человека по одному имени — без карты, почты и роли. */
  static createWorker(
    payload: UnregisteredWorkerCreate
  ): Promise<UnregisteredWorker> {
    return apiFetch<UnregisteredWorker>("/v1/schedule/workers", {
      method: "POST",
      body: payload,
    })
  }

  static updateWorker(
    workerId: number,
    payload: UnregisteredWorkerUpdate
  ): Promise<UnregisteredWorker> {
    return apiFetch<UnregisteredWorker>(`/v1/schedule/workers/${workerId}`, {
      method: "PATCH",
      body: payload,
    })
  }

  /**
   * Связывает человека с записью в `employees` и переносит на неё график.
   *
   * Вызывается, когда новый сотрудник наконец получил почту, карту и роль.
   */
  static linkWorker(
    workerId: number,
    employeeId: number
  ): Promise<UnregisteredWorkerLinkResult> {
    return apiFetch<UnregisteredWorkerLinkResult>(
      `/v1/schedule/workers/${workerId}/link`,
      { method: "POST", body: { employee_id: employeeId } }
    )
  }

  /** Удаляет человека вместе с его графиком — каскадом. */
  static deleteWorker(workerId: number): Promise<{ id: number }> {
    return apiFetch<{ id: number }>(`/v1/schedule/workers/${workerId}`, {
      method: "DELETE",
    })
  }

  /**
   * Общий справочник работников — кандидаты для добавления в состав.
   *
   * Берётся из `/v1/employees`, а не из планировщика: планировщик отдаёт
   * только тех, кто уже в составе, а добавить нужно как раз остальных.
   */
  static listDirectoryEmployees(): Promise<DirectoryEmployee[]> {
    return apiFetch<DirectoryEmployee[]>("/v1/employees", {
      // Справочник небольшой, но по умолчанию отдаётся страница в 50 человек,
      // и часть склада просто не попала бы в список кандидатов.
      query: { pagination: "offset", page_size: 200 },
    })
  }

  // --- Правка дня ---

  /**
   * Ставит состояние одного дня: смену, невыход или очищает его.
   *
   * Поставленная смена закрепляется на сервере: её не переставит следующая
   * генерация. Ответ сообщает об этом в поле `pinned`.
   */
  static setDayState(params: {
    warehouse: string
    subject: SubjectKey
    month: MonthLabel
    day: number
    state: DayState
  }): Promise<DayStateResult> {
    return apiFetch<DayStateResult>("/v1/schedule/day", {
      method: "PUT",
      body: {
        warehouse: params.warehouse,
        subject: params.subject,
        month: params.month,
        day: params.day,
        state: params.state,
      },
    })
  }

  /**
   * Закрепляет смену за менеджером или возвращает её алгоритму.
   *
   * Отдельный вызов, а не флаг у смены дня: «что здесь стоит» и «можно ли это
   * двигать» — разные вопросы, и менеджеру нужно снять закрепление, не убирая
   * саму смену. Для дня без смены сервер отвечает 404 `SHIFT_NOT_FOUND`.
   */
  static setDayPin(params: {
    warehouse: string
    subject: SubjectKey
    month: MonthLabel
    day: number
    pinned: boolean
  }): Promise<DayPinResult> {
    return apiFetch<DayPinResult>("/v1/schedule/day/pin", {
      method: "PUT",
      body: {
        warehouse: params.warehouse,
        subject: params.subject,
        month: params.month,
        day: params.day,
        pinned: params.pinned,
      },
    })
  }

  static getSettings(
    warehouse: string,
    month: MonthLabel
  ): Promise<ScheduleSettings> {
    return apiFetch<ScheduleSettings>("/v1/schedule/settings", {
      query: { warehouse, month },
    })
  }

  static saveSettings(
    payload: ScheduleSettingsUpdate
  ): Promise<ScheduleSettings> {
    return apiFetch<ScheduleSettings>("/v1/schedule/settings", {
      method: "PUT",
      body: payload,
    })
  }

  static getShifts(
    warehouse: string,
    month: MonthLabel,
    signal?: AbortSignal
  ): Promise<ScheduleMonth> {
    return apiFetch<ScheduleMonth>("/v1/schedule/shifts", {
      query: { warehouse, month },
      signal,
    })
  }

  /** Полная замена графика склада на месяц. */
  static saveShifts(
    warehouse: string,
    month: MonthLabel,
    shifts: ScheduleShift[]
  ): Promise<ScheduleShiftsSaved> {
    return apiFetch<ScheduleShiftsSaved>("/v1/schedule/shifts", {
      method: "PUT",
      body: { warehouse, month, shifts },
    })
  }
}
