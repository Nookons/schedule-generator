'use client'
import React, { useEffect, useState } from "react"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { useSettingStore } from "@/store/useSettingStore"
import { Checkbox } from "@workspace/ui/components/checkbox"

const ShiftsSettings = () => {
  const {
    dayCount,
    nightCount,
    afterNightDayOffs,
    updateDayCount,
    updateNightCount,
    updateAfterNightCount,
  } = useSettingStore()

  const [dayCountValue, setDayCountValue] = useState<number>(dayCount ?? 1)
  const [nightCountValue, setNightCountValue] = useState<number>(nightCount ?? 1)
  const [afterNightValue, setAfterNightValue] = useState<number>(afterNightDayOffs ?? 1)

  useEffect(() => {
    if (dayCount !== dayCountValue) {
      updateDayCount(dayCountValue)
    }
    if (nightCount !== nightCountValue) {
      updateNightCount(nightCountValue)
    }
    if (afterNightValue !== afterNightDayOffs) {
      updateAfterNightCount(afterNightValue)
    }
  }, [dayCountValue, nightCountValue, dayCount, nightCount, afterNightDayOffs, afterNightValue])

  return (
    <FieldGroup className="grid grid-cols-6 items-end gap-2">
      <Field>
        <FieldLabel htmlFor="first-name">Employees in Day</FieldLabel>
        <Input
          value={dayCountValue}
          onChange={(e) => setDayCountValue(Number(e.target.value))}
          type={`number`}
          id="day-count"
          defaultValue={dayCount}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="last-name">Employees in Night</FieldLabel>
        <Input
          value={nightCountValue}
          onChange={(e) => setNightCountValue(Number(e.target.value))}
          type={`number`}
          id="night-count"
          defaultValue={nightCount}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="last-name">Night 🠪 Day | Day Offs</FieldLabel>
        <Input
          value={afterNightValue}
          onChange={(e) => setAfterNightValue(Number(e.target.value))}
          type={`number`}
          id="night-count"
          defaultValue={nightCount}
        />
      </Field>
      {/*<Field className={`pb-1`} orientation="horizontal">
        <Checkbox
          id="terms-checkbox-2"
          name="terms-checkbox-2"
          defaultChecked
        />
        <FieldContent>
          <FieldLabel htmlFor="terms-checkbox-2">
            Accept terms and conditions
          </FieldLabel>
        </FieldContent>
      </Field>*/}
    </FieldGroup>
  )
}

export default ShiftsSettings