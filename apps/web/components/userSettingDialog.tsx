"use client"
import React, { useState } from "react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Label } from "@workspace/ui/components/label"
import { Input } from "@workspace/ui/components/input"
import { Settings, UserPen } from "lucide-react"
import { IUser } from "@/types/User"
import {
  ContractType,
  ShiftPreference,
  useUsersStore,
} from "@/store/useUsersStore"
import dayjs from "dayjs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

const COLORS = [
  "#4f46e5",
  "#e11d48",
  "#16a34a",
  "#d97706",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#65a30d",
]

const UserSettingDialog = ({ user }: { user: IUser }) => {
  const { updateUser, removeUser } = useUsersStore()
  const daysInMonth = dayjs().daysInMonth()

  const [form, setForm] = useState<Omit<IUser, "id">>({
    fullName: user.fullName,
    position: user.position,
    color: user.color,
    priority: user.priority,
    shiftPreference: user.shiftPreference,
    daysOffUsers: user.daysOffUsers,
    daysOff: user.daysOff,
    dayShifts: user.dayShifts,
    nightShifts: user.nightShifts,
    minShiftsPerMonth: user.minShiftsPerMonth,
    maxShiftsPerMonth: user.maxShiftsPerMonth,
    contractType: user.contractType,
    isActive: user.isActive,
    notes: user.notes,
  })

  const handleSave = () => {
    updateUser(user.id, form)
  }

  const handleRemove = () => {
    removeUser(user.id)
  }

  const toggleDay = (
    day: number,
    field: "daysOff" | "daysOffUsers"
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].includes(day)
        ? prev[field].filter((d) => d !== day)
        : [...prev[field], day],
    }))
  }

  const DaySelector = ({
    field,
    label,
  }: {
    field: "daysOff" | "daysOffUsers"
    label: string
  }) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1 flex flex-wrap gap-1">
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const selected = form[field].includes(day)

          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day, field)}
              className={`h-7 w-7 rounded border text-xs transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </Field>
  )

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <UserPen className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Employee Settings</DialogTitle>
          <DialogDescription>
            Edit employee details and schedule preferences.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {/* Basic Info */}
          <Field>
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>

          {/*<Field>
            <Label htmlFor="position">Position</Label>
            <Input
              id="position"
              placeholder="e.g. Cashier, Manager"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </Field>*/}

          {/* Color */}
          <Field>
            <FieldLabel>Color</FieldLabel>
            <div className="mt-1 flex gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, color })}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${form.color === color ? "scale-110 border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </Field>

          {/* Priority */}
          <Field>
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              min={1}
              max={10}
              value={form.priority}
              onChange={(e) =>
                setForm({ ...form, priority: Number(e.target.value) })
              }
            />
          </Field>

          {/* Shift Preference */}
          <Field>
            <FieldLabel>Shift Preference</FieldLabel>
            <Select
              value={form.shiftPreference}
              onValueChange={(val) =>
                setForm({ ...form, shiftPreference: val as ShiftPreference })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="only_day">Only Day</SelectItem>
                <SelectItem value="only_night">Only Night</SelectItem>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="night">Night</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* Contract Type */}
          {/*<Field>
            <FieldLabel>Contract Type</FieldLabel>
            <Select
              value={form.contractType}
              onValueChange={(val) =>
                setForm({ ...form, contractType: val as ContractType })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full-time">Full-time</SelectItem>
                <SelectItem value="part-time">Part-time</SelectItem>
                <SelectItem value="freelance">Freelance</SelectItem>
              </SelectContent>
            </Select>
          </Field>*/}

          {/* Shifts per month */}
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <Label htmlFor="minShifts">Min Shifts / Month</Label>
              <Input
                id="minShifts"
                type="number"
                min={0}
                value={form.minShiftsPerMonth}
                onChange={(e) =>
                  setForm({
                    ...form,
                    minShiftsPerMonth: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field>
              <Label htmlFor="maxShifts">Max Shifts / Month</Label>
              <Input
                id="maxShifts"
                type="number"
                min={0}
                value={form.maxShiftsPerMonth}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maxShiftsPerMonth: Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>

          {/* Day Selectors */}
          <DaySelector field="daysOffUsers" label="Days Off" />

          {/* Notes */}
          {/*<Field>
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              placeholder="Any special requests..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>*/}
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="outline" onClick={handleRemove}>
              Remove
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={handleSave}>Save changes</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default UserSettingDialog
