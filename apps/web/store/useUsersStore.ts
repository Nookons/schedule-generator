import { create } from "zustand"
import { IUser } from "@/types/User"

export type ShiftPreference = "only_day" | "only_night" | "day" | "night" | "all"
export type ContractType = "full-time" | "part-time" | "freelance"



interface UsersState {
  users: IUser[]
  addUser: (IUser: Omit<IUser, "id">) => void
  updateUser: (id: string, data: Partial<IUser>) => void
  removeUser: (id: string) => void
  toggleActive: (id: string) => void

  addDayShift: (id: string, day: number) => void
  addNightShift: (id: string, day: number) => void
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],

  addUser: (user) =>
    set((state) => ({
      users: [...state.users, { ...user, id: crypto.randomUUID() }],
    })),

  updateUser: (id, data) =>
    set((state) => ({
      users: state.users.map((u) => (u.id === id ? { ...u, ...data } : u)),
    })),

  removeUser: (id) =>
    set((state) => ({
      users: state.users.filter((u) => u.id !== id),
    })),

  toggleActive: (id) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.id === id ? { ...u, isActive: !u.isActive } : u
      ),
    })),

  addDayShift: (id, day) =>
    set((state) => ({
      users: state.users.map((u) => {
        if (u.id !== id) return u

        // защита от дублей
        if (u.dayShifts.includes(day)) return u

        return {
          ...u,
          dayShifts: [...u.dayShifts, day],
        }
      }),
    })),

  addNightShift: (id, day) =>
    set((state) => ({
      users: state.users.map((u) => {
        if (u.id !== id) return u

        if (u.nightShifts.includes(day)) return u

        return {
          ...u,
          nightShifts: [...u.nightShifts, day],
        }
      }),
    })),
}))
