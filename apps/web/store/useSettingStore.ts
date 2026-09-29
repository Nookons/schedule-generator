import dayjs from "dayjs"
import { create } from "zustand"

/**
 * Настройки, из которых строится график.
 *
 * «Мои предпочтения» в терминах задачи: сколько людей нужно в день и в ночь
 * и сколько дней отдыха положено после смены каждого типа. Эти значения
 * хранятся в базе по паре (склад, месяц) в таблице `schedule_settings`,
 * а здесь живёт их текущее состояние для интерфейса.
 */

interface SettingsState {
  /** Склад, для которого строится график. Null — ещё не выбран. */
  warehouse: string | null

  /** Месяц в формате `YYYY-MM`. */
  currentMonth: string

  dayCount: number
  nightCount: number
  afterNightDayOffs: number
  afterDayDayOffs: number

  updateWarehouse: (warehouse: string | null) => void
  updateMonth: (month: string) => void
  updateDayCount: (value: number) => void
  updateNightCount: (value: number) => void
  updateAfterNightCount: (value: number) => void
  updateAfterDayCount: (value: number) => void
  /** Заполняет всё сразу из ответа API. */
  applySettings: (settings: {
    day_count: number
    night_count: number
    after_night_off: number
    after_day_off: number
  }) => void
  reset: () => void
}

/** Значения по умолчанию должны совпадать с `DEFAULT_SETTINGS` на бэкенде. */
const DEFAULTS = {
  dayCount: 1,
  nightCount: 1,
  afterNightDayOffs: 1,
  afterDayDayOffs: 0,
}

export const useSettingStore = create<SettingsState>((set) => ({
  warehouse: null,
  // Текущий месяц, а не пустая строка. Раньше здесь было `""`, и первый
  // рендер успевал посчитать `dayjs("").daysInMonth()` — то есть NaN —
  // прежде чем MonthPicker записывал месяц. Сетка дней строилась из NaN.
  currentMonth: dayjs().format("YYYY-MM"),
  ...DEFAULTS,

  updateWarehouse: (warehouse) => set({ warehouse }),
  updateMonth: (currentMonth) => set({ currentMonth }),
  updateDayCount: (dayCount) => set({ dayCount }),
  updateNightCount: (nightCount) => set({ nightCount }),
  updateAfterNightCount: (afterNightDayOffs) => set({ afterNightDayOffs }),
  updateAfterDayCount: (afterDayDayOffs) => set({ afterDayDayOffs }),

  applySettings: (settings) =>
    set({
      dayCount: settings.day_count,
      nightCount: settings.night_count,
      afterNightDayOffs: settings.after_night_off,
      afterDayDayOffs: settings.after_day_off,
    }),

  reset: () =>
    set({ warehouse: null, currentMonth: dayjs().format("YYYY-MM"), ...DEFAULTS }),
}))
