import { create } from "zustand"

import type { DayMarkKind, DayState, SubjectKey } from "@/lib/api/types"
import type { IUser } from "@/types/User"

/**
 * Состав склада и построенный для него график.
 *
 * Работники больше не создаются в браузере: источник — таблица `employees`,
 * привязанная к складу. Локально добавленный сотрудник не существовал бы в
 * базе, и сохранение графика падало бы на внешнем ключе.
 */

/** График одного участника: смены и закреплённые среди них дни. */
export interface SubjectSchedule {
  dayShifts: number[]
  nightShifts: number[]
  pinnedDays: number[]
}

interface UsersState {
  users: IUser[]
  /** Заменяет состав целиком: он всегда загружается складом, а не по частям. */
  setUsers: (users: IUser[]) => void
  updateUser: (subject: SubjectKey, data: Partial<IUser>) => void
  /**
   * Проставляет смены всем работникам после генерации или загрузки склада.
   *
   * Закреплённые дни перезаписываются вместе с остальными: генератор их
   * сохраняет, а загрузка берёт из базы. Отдельного «сохрани закрепления»
   * здесь быть не должно — признак приходит из того же ответа, что и смены, и
   * два источника разошлись бы.
   */
  applySchedule: (schedule: Record<SubjectKey, SubjectSchedule>) => void
  /** Применяет состояние одного дня после успешной правки на сервере. */
  setUserDay: (
    subject: SubjectKey,
    day: number,
    state: DayState,
    pinned: boolean
  ) => void
  /** Применяет переключение закрепления после ответа сервера. */
  setUserPin: (subject: SubjectKey, day: number, pinned: boolean) => void
  reset: () => void
}

/**
 * Виды отметок дня.
 *
 * `Record` по всем видам, а не список в условии: когда появился `unavailable`,
 * ветка «отметка» его не знала, и отметка стиралась из таблицы сразу после
 * клика — «не сохраняется». Пропустить новый вид здесь больше нельзя: тип
 * потребует дописать его в таблицу.
 */
const MARK_STATES: Record<DayMarkKind, true> = {
  off: true,
  vacation: true,
  sick: true,
  unavailable: true,
}

function isMarkState(state: DayState): state is DayMarkKind {
  return state in MARK_STATES
}

/**
 * Применяет состояние дня к работнику.
 *
 * Локально, без перезагрузки склада: сервер уже подтвердил правку, а полная
 * перезагрузка на каждый клик — это три запроса и мигание таблицы. Меняются
 * только те поля, которых правка касается; чужие смены не трогаем, потому
 * что сервер такую правку отклонил бы.
 */
function applyDayState(
  user: IUser,
  day: number,
  state: DayState,
  pinned: boolean
): IUser {
  const dayShifts = user.dayShifts.filter((value) => value !== day)
  const nightShifts = user.nightShifts.filter((value) => value !== day)
  const pinnedDays = user.pinnedDays.filter((value) => value !== day)
  const marks = { ...user.marks }
  delete marks[day]

  if (isMarkState(state)) {
    // Смена и отметка несовместимы: день не может быть рабочим и выходным
    // одновременно, поэтому смены уже сняты выше. Закреплять нечего — в дне
    // не смена, а отметка.
    marks[day] = state
  } else if (state === "day") {
    dayShifts.push(day)
    if (pinned) pinnedDays.push(day)
  } else if (state === "night") {
    nightShifts.push(day)
    if (pinned) pinnedDays.push(day)
  }
  // Для «none» ничего добавлять не нужно: день уже очищен, и закрепление
  // уходит вместе со сменой — закреплять пустой день нечего.

  return {
    ...user,
    dayShifts: dayShifts.sort((a, b) => a - b),
    nightShifts: nightShifts.sort((a, b) => a - b),
    pinnedDays: pinnedDays.sort((a, b) => a - b),
    marks,
  }
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],

  setUsers: (users) => set({ users }),

  updateUser: (subject, data) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.subject === subject ? { ...u, ...data } : u
      ),
    })),

  applySchedule: (schedule) =>
    set((state) => ({
      users: state.users.map((u) => {
        const shifts = schedule[u.subject]
        if (!shifts) {
          return { ...u, dayShifts: [], nightShifts: [], pinnedDays: [] }
        }
        return {
          ...u,
          dayShifts: [...shifts.dayShifts].sort((a, b) => a - b),
          nightShifts: [...shifts.nightShifts].sort((a, b) => a - b),
          pinnedDays: [...shifts.pinnedDays].sort((a, b) => a - b),
        }
      }),
    })),

  setUserDay: (subject, day, dayState, pinned) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.subject === subject ? applyDayState(u, day, dayState, pinned) : u
      ),
    })),

  setUserPin: (subject, day, pinned) =>
    set((state) => ({
      users: state.users.map((u) => {
        if (u.subject !== subject) return u
        const pinnedDays = u.pinnedDays.filter((value) => value !== day)
        if (pinned) pinnedDays.push(day)
        return { ...u, pinnedDays: pinnedDays.sort((a, b) => a - b) }
      }),
    })),

  reset: () => set({ users: [] }),
}))
