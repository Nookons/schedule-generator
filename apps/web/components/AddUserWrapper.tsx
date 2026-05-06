'use client'
import React, { useState } from "react"
import { Input } from "@workspace/ui/components/input"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { useUsersStore } from "@/store/useUsersStore"
import ScheduleAutoGenerate from "@/components/ScheduleAutoGenerate"

const AddUserWrapper = ({ isPreview = false }: { isPreview: boolean }) => {
  const [fullName, setFullName] = useState("")
  const addUser = useUsersStore((state) => state.addUser)

  const handleAdd = () => {
    const trimmed = fullName.trim()
    if (!trimmed) return

    addUser({
      fullName: trimmed,
      position: "",
      color: "#4f46e5",
      priority: 1,
      shiftPreference: "all",
      daysOffUsers: [],
      daysOff: [],
      dayShifts: [],
      nightShifts: [],
      minShiftsPerMonth: 1,
      maxShiftsPerMonth: 31,
      contractType: "full-time",
      isActive: true,
      notes: "",
    })

    setFullName("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleAdd()
  }

  return (
    <div className={`w-full`}>
      <Field>
        <FieldLabel htmlFor="input-field-username">
          Employee full name
        </FieldLabel>
        <div
          className={`grid ${isPreview ? "grid-cols-3" : "grid-cols-3"} gap-2`}
        >
          <Input
            id="input-field-username"
            type="text"
            className="col-span-2"
            placeholder="Enter employee name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className={`flex items-center gap-2`}>
            <Button
              className={`${isPreview && "w-full"}`}
              onClick={handleAdd}
              disabled={!fullName.trim()}
            >
              Add
            </Button>
            {!isPreview && <ScheduleAutoGenerate />}
          </div>
        </div>
        <FieldDescription>
          Please provide employee name to add him in schedule and click to add.
        </FieldDescription>
      </Field>
    </div>
  )
}

export default AddUserWrapper
