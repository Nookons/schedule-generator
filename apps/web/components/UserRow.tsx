"use client"
import React from "react"
import { IUser } from "@/types/User"
import dayjs from "dayjs"
import { useSettingStore } from "@/store/useSettingStore"
import UserSettingDialog from "@/components/userSettingDialog"
import { toast } from "sonner"

const UserRow = ({ user }: { user: IUser }) => {
  const { currentMonth, updateMonth } = useSettingStore()
  const daysInMonth = dayjs(currentMonth).daysInMonth()

  const total_days = user.dayShifts.length
  const total_nights = user.nightShifts.length
  const total_shifts = total_days + total_nights
  const total_hours = total_shifts * 12

  const getDayStatus = (day: number) => {
    if (user.daysOffUsers.includes(day))
      return {
        label: "OFF",
        bg: "bg-rose-300 dark:hover:bg-primary dark:bg-rose-500",
      }
    if (user.dayShifts.includes(day))
      return {
        label: "D",
        bg: "bg-yellow-200 dark:hover:bg-primary dark:bg-yellow-500",
      }
    if (user.nightShifts.includes(day))
      return {
        label: "N",
        bg: "bg-blue-200 dark:hover:bg-primary dark:bg-blue-500",
      }

    return { label: "—", bg: "bg-muted" }
  }

  return (
    <div className="grid grid-cols-[250px_1fr_150px] mb-1">
      <div
        className={`flex items-center justify-between gap-2 bg-muted px-2`}
        /*style={{ backgroundColor: `${user.color}` }}*/
      >
        <p className={`line-clamp-1`}>{user.fullName}</p>
        <UserSettingDialog user={user} />
      </div>

      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
          backgroundColor: `${user.color}`,
        }}
      >
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const { label, bg } = getDayStatus(day)

          return (
            <div
              onClick={() => toast.info(`Will be done in next update`)}
              className={`${bg} cursor-pointer border-2 border-transparent py-2 text-center hover:border-primary hover:bg-primary`}
              key={i + 1}
            >
              {label}
            </div>
          )
        })}
      </div>
      <div
        className="ml-1 grid grid-cols-4 items-center justify-center gap-2 px-2 text-center text-sm font-medium"
        style={{ backgroundColor: `${user.color}` }}
      >
        <p>{total_days}</p>
        <p>{total_nights}</p>
        <p>{total_shifts}</p>
        <p>{total_hours}</p>
      </div>
    </div>
  )
}

export default UserRow
