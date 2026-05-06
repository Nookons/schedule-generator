import { create } from "zustand"

interface UsersState {
  currentMonth: string
  dayCount: number
  nightCount: number
  afterNightDayOffs: number
  updateMonth: (date: string) => void
  updateDayCount: (date: number) => void
  updateNightCount: (date: number) => void
  updateAfterNightCount: (date: number) => void
}

export const useSettingStore = create<UsersState>((set) => ({
  currentMonth: "",
  dayCount: 1,
  nightCount: 1,
  afterNightDayOffs: 1,

  updateMonth: (date) => set({ currentMonth: date }),
  updateDayCount: (newCount) => set({ dayCount: newCount }),
  updateNightCount: (newCount) => set({ nightCount: newCount }),
  updateAfterNightCount: (newCount) => set({ afterNightDayOffs: newCount }),
}))
