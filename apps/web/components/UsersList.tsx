'use client'
import React from "react"
import { useUsersStore } from "@/store/useUsersStore"
import UserRow from "@/components/UserRow"
import { useSettingStore } from "@/store/useSettingStore"
import dayjs from "dayjs"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { CloudAlert } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import AddUserWrapper from "@/components/AddUserWrapper"

const UsersList = () => {
  const { users } = useUsersStore()
  const { dayCount, nightCount, currentMonth } = useSettingStore()
  const daysInMonth = dayjs(currentMonth).daysInMonth()
  const user = useUsersStore(state => state.users)

  if (!user.length) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CloudAlert />
          </EmptyMedia>
          <EmptyTitle>No employees</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <AddUserWrapper isPreview={true} />
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div>
      <div className={`mb-1 grid grid-cols-[250px_1fr_150px] bg-muted p-1`}>
        <p className={`pl-2`}>Header</p>
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const isWeekend = (day: number) => {
              const d = dayjs(currentMonth).date(day).day() // 0 = вс, 6 = сб
              return d === 0 || d === 6
            }

            return (
              <div
                className={`text-center ${isWeekend(i + 1) ? "bg-orange-500" : ""}`}
                key={i + 1}
              >
                {i + 1}
              </div>
            )
          })}
        </div>
        <div
          className={`ml-1 grid grid-cols-4 items-center justify-center gap-2 px-2 text-center text-sm font-medium`}
        >
          <p>D</p>
          <p>N</p>
          <p>T</p>
          <p>H</p>
        </div>
      </div>
      {user.map((user, index) => (
        <UserRow key={`${user.fullName}-${index}`} user={user} />
      ))}
      <div className={`mt-1 grid grid-cols-[250px_1fr_150px] bg-muted py-2`}>
        <div className={`text-right`}>
          <p className={`py-1 pr-4`}>Day</p>
          <hr className={`my-1`} />
          <p className={`py-1 pr-4`}>Night</p>
        </div>
        <div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const currentDay = i + 1
              const currentEmployees = users.filter((item) =>
                item.dayShifts.includes(currentDay)
              ).length

              const isGood = dayCount === currentEmployees

              return (
                <div className={`text-center`} key={currentDay}>
                  <p
                    className={`py-1 ${isGood ? "" : "bg-rose-300 dark:bg-rose-500"}`}
                  >
                    {currentEmployees}
                  </p>
                </div>
              )
            })}
          </div>
          <hr className={`my-1`} />
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const currentDay = i + 1
              const currentEmployees = users.filter((item) =>
                item.nightShifts.includes(currentDay)
              ).length

              const isGood = nightCount === currentEmployees

              return (
                <div className={`text-center`} key={i + 1}>
                  <p
                    className={`py-1 ${isGood ? "" : "bg-rose-300 dark:bg-rose-500"}`}
                  >
                    {currentEmployees}
                  </p>
                </div>
              )
            })}
          </div>
          {/*<hr className={`my-1`} />
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const currentDay = i + 1
              const currentEmployees = users.filter((item) =>
                item.daysOffUsers.includes(currentDay)
              ).length

              return (
                <div
                  className={`text-center ${0 < currentEmployees ? "bg-primary" : ""}`}
                  key={i + 1}
                >
                  {currentEmployees}
                </div>
              )
            })}
          </div>*/}
        </div>
        <div>
          <div className="ml-1 grid grid-cols-4 items-start justify-center gap-2 px-2 py-1.5 text-center text-sm font-medium">
            <p>{users.reduce((acc, user) => acc + user.dayShifts.length, 0)}</p>
            <p>
              {users.reduce((acc, user) => acc + user.nightShifts.length, 0)}
            </p>
            <p>
              {Number(
                users.reduce((acc, user) => acc + user.dayShifts.length, 0) +
                  users.reduce((acc, user) => acc + user.nightShifts.length, 0)
              )}
            </p>
          </div>
          <hr className={`my-1`} />
        </div>
      </div>
    </div>
  )
}

export default UsersList