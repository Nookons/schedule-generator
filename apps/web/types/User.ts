import { ContractType, ShiftPreference } from "@/store/useUsersStore"

export interface IUser {
  id: string
  fullName: string
  position: string
  color: string
  priority: number
  shiftPreference: ShiftPreference

  daysOffUsers: number[]
  dayShifts: number[]
  nightShifts: number[]
  daysOff: number[]

  minShiftsPerMonth: number // минимум смен в месяц
  maxShiftsPerMonth: number // максимум смен в месяц

  contractType: ContractType
  isActive: boolean
  notes: string // пожелания / комментарии
}