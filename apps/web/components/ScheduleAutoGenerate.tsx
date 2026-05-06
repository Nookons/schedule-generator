"use client"
import React, { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { useUsersStore } from "@/store/useUsersStore"
import { useSettingStore } from "@/store/useSettingStore"
import dayjs from "dayjs"
import { ScheduleMaps } from "@/lib/ScheduleMaps"
import { toast } from "sonner"

const ScheduleAutoGenerate = () => {
  const { users, updateUser, addDayShift, addNightShift } = useUsersStore()
  const { dayCount, nightCount, afterNightDayOffs, currentMonth } = useSettingStore()
  const daysInMonth = dayjs(currentMonth).daysInMonth()

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const generateHandler = () => {
    setIsLoading(true)
    const maps = new ScheduleMaps(users, daysInMonth)

    // userId → Map<day, shiftType>
    const assignedDays = new Map<string, Map<number, string>>()
    users.forEach((u) => assignedDays.set(u.id, new Map()))

    users.forEach((user) => {
      updateUser(user.id, { ...user, nightShifts: [], dayShifts: [] })
    })

    const shifts_count = daysInMonth * 2
    const shifts = Array.from({ length: shifts_count }, (_, i) => ({
      type: i % 2 === 0 ? "Day" : "Night",
      day: Math.floor(i / 2) + 1,
    }))

    shifts.forEach((shift) => {
      const user_list = users
        .filter((user) => {
          const userMap = assignedDays.get(user.id)!

          if (user.daysOffUsers.includes(shift.day)) {
            console.log(
              `Day Off for ${user.fullName} | ${shift.day} - ${shift.type} skipping...`
            )
            return false
          }

          // уже назначена смена в этот день
          if (userMap.has(shift.day)) {
            console.log(
              `Already assigned: ${user.fullName} | day ${shift.day} — skipping`
            )
            return false
          }

          const dayRestriction = userMap.get(shift.day)?.toLowerCase()
          const shiftType = shift.type.toLowerCase()

          if (user.shiftPreference === "only_day" && shiftType === "night") {
            console.log(
              `Only day restriction: ${user.fullName} | day ${shift.day} skipping...`
            )
            return false
          }

          if (user.shiftPreference === "only_night" && shiftType === "day") {
            console.log(
              `Only night restriction: ${user.fullName} | day ${shift.day} skipping...`
            )
            return false
          }

          const hasNightDayConflict = Array.from(
            { length: afterNightDayOffs },
            (_, i) => userMap.get(shift.day - (i + 1))
          ).some(
            (s) =>
              s?.toLowerCase() === "night" && shift.type.toLowerCase() === "day"
          )

          if (hasNightDayConflict) {
            console.log(
              `Night→Day conflict: ${user.fullName} | day ${shift.day} skipping...`
            )
            return false
          }

          return true
        })
        .map((user) => {
          const userMap = assignedDays.get(user.id)!
          const assignedCount = userMap.size
          const shiftType = shift.type.toLowerCase()
          let final_score = 0

          // ─── 1. Базовый приоритет ───────────────────────────────────────
          final_score += user.priority * 3 // вес × 3, чтобы приоритет был значимым

          // ─── 2. Предпочтение смены ─────────────────────────────────────
          if (shiftType === user.shiftPreference.toLowerCase()) {
            final_score += 5
          } else if (user.shiftPreference === "all") {
            final_score += 2 // гибкий — небольшой бонус
          }

          // ─── 4. Балансировка нагрузки ──────────────────────────────────
          const totalShiftsAssigned = users.reduce(
            (sum, u) => sum + (assignedDays.get(u.id)?.size ?? 0),
            0
          )
          const totalPriority = users.reduce((sum, u) => sum + u.priority, 0)

          // Целевое кол-во смен для этого пользователя пропорционально его приоритету
          const targetShifts =
            (user.priority / totalPriority) * totalShiftsAssigned

          const deviation = assignedCount - targetShifts // насколько выше/ниже своей цели

          if (assignedCount < user.minShiftsPerMonth) {
            final_score += 6
          } else if (assignedCount >= user.maxShiftsPerMonth) {
            final_score -= 200
          } else {
            const fillRatio = assignedCount / user.maxShiftsPerMonth
            final_score -= Math.round(fillRatio * 5)
          }

          // Штраф/бонус за отклонение от персональной цели
          final_score -= Math.round(deviation * 4)

          // ─── 5. Серия одинаковых смен (штраф накапливается) ───────────
          const streak = [
            userMap.get(shift.day - 1),
            userMap.get(shift.day - 2),
            userMap.get(shift.day - 3),
            userMap.get(shift.day - 4),
          ].filter((s) => s?.toLowerCase() === shiftType).length

          const streakPenalty: Record<number, number> = {
            1: +3,
            2: +7,
            3: -13,
            4: -20,
          }
          if (streak > 0) {
            final_score += streakPenalty[streak] ?? -20
            console.log(
              `Streak x${streak} penalty for ${user.fullName}: ${streakPenalty[streak] ?? -20}`
            )
          }

          console.log(
            `Score [${user.fullName}]: ${final_score} (priority=${user.priority}, assigned=${assignedCount}, streak=${streak})`
          )

          return { id: user.id, score: final_score }
        })
        .sort((a, b) => b.score - a.score)

      const count = shift.type.toLowerCase() === "day" ? dayCount : nightCount
      const only_need = user_list.slice(0, count)

      only_need.forEach((user) => {
        assignedDays.get(user.id)!.set(shift.day, shift.type)

        if (shift.type.toLowerCase() === "day") {
          addDayShift(user.id, shift.day)
        } else {
          addNightShift(user.id, shift.day)
        }
      })
    })

    console.log(assignedDays)

    toast.promise<{ name: string }>(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            setIsLoading(false)
            resolve({ name: "Schedule" })
          }, 2000)
        ),
      {
        loading: "Loading...",
        success: (data) => `${data.name} has been created`,
        error: "Error",
      }
    )

    console.log(maps)
  }

  return <Button onClick={generateHandler}>Auto Fill</Button>
}

export default ScheduleAutoGenerate
