"use client"
import React, { useState } from "react"
import dayjs from "dayjs"
import { Button } from "@workspace/ui/components/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"

const MonthPicker = () => {
  const { currentMonth, updateMonth } = useSettingStore()

  const goingMonth = dayjs().format('YYYY-MM')
  const current = currentMonth ? dayjs(currentMonth) : dayjs()

  if (!currentMonth) {
    updateMonth(goingMonth)
  }

  const handlePrev = () => {
    updateMonth(current.subtract(1, "month").format("YYYY-MM"))
  }

  const handleNext = () => {
    updateMonth(current.add(1, "month").format("YYYY-MM"))
  }

  const isGoing = goingMonth === currentMonth

  return (
    <div className={`flex flex-col items-center gap-2`}>
      {isGoing && (
        <div className={`text-left w-full`}>
          <p className={`text-left text-xs text-red-500`}>
            This month is already started
          </p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={handlePrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="min-w-32 text-center font-medium">
          {current.format("MMMM YYYY")}
        </span>

        <Button variant="outline" size="icon" onClick={handleNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export default MonthPicker
