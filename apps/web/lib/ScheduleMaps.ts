import { IUser } from "@/types/User"

export class ScheduleMaps {
  shiftCount: Record<string, number> = {}
  dayShiftsMap: Record<string, number[]> = {}
  nightShiftsMap: Record<string, number[]> = {}
  dayCoverage: Record<number, number> = {}
  nightCoverage: Record<number, number> = {}

  constructor(users: IUser[], daysInMonth: number) {
    users.forEach((u) => {
      this.shiftCount[u.id] = 0
      this.dayShiftsMap[u.id] = []
      this.nightShiftsMap[u.id] = []
    })
    for (let d = 1; d <= daysInMonth; d++) {
      this.dayCoverage[d] = 0
      this.nightCoverage[d] = 0
    }
  }

  getDayShifts(id: string): number[] {
    return this.dayShiftsMap[id] ?? []
  }

  getNightShifts(id: string): number[] {
    return this.nightShiftsMap[id] ?? []
  }

  hadNightBefore(id: string, day: number): boolean {
    return this.getNightShifts(id).includes(day - 1)
  }

  alreadyAssigned(id: string, day: number): boolean {
    return (
      this.getDayShifts(id).includes(day) ||
      this.getNightShifts(id).includes(day)
    )
  }

  canWorkDay(user: IUser, day: number): boolean {
    if (!user.isActive) return false
    if (user.daysOffUsers.includes(day)) return false
    if ((this.shiftCount[user.id] ?? 0) >= user.maxShiftsPerMonth) return false
    if (this.hadNightBefore(user.id, day)) return false
    if (this.alreadyAssigned(user.id, day)) return false
    return true
  }

  canWorkNight(user: IUser, day: number): boolean {
    if (!user.isActive) return false
    if (user.daysOffUsers.includes(day)) return false
    if ((this.shiftCount[user.id] ?? 0) >= user.maxShiftsPerMonth) return false
    if (this.alreadyAssigned(user.id, day)) return false
    if (this.getDayShifts(user.id).includes(day + 1)) return false
    return true
  }

  assignDay(user: IUser, day: number) {
    const nightShifts = this.getNightShifts(user.id)
    const prevNightIndex = nightShifts.indexOf(day - 1)
    if (prevNightIndex !== -1) {
      this.nightShiftsMap[user.id]!.splice(prevNightIndex, 1)
      this.shiftCount[user.id] = (this.shiftCount[user.id] ?? 1) - 1
    }
    this.dayShiftsMap[user.id]!.push(day)
    this.shiftCount[user.id] = (this.shiftCount[user.id] ?? 0) + 1
  }

  assignNight(user: IUser, day: number) {
    this.nightShiftsMap[user.id]!.push(day)
    this.shiftCount[user.id] = (this.shiftCount[user.id] ?? 0) + 1
  }
}
