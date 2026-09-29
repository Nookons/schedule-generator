"use client"

import { Button } from "@workspace/ui/components/button"
import { LogOut, RefreshCw } from "lucide-react"

import DayLegend from "@/components/DayLegend"
import ExportsButtonWrapper from "@/components/ExportsButtonWrapper"
import MonthPicker from "@/components/MonthPicker"
import ScheduleAutoGenerate from "@/components/ScheduleAutoGenerate"
import StaffDialog from "@/components/StaffDialog"
import ShiftsSettings from "@/components/ShiftsSettings"
import UsersList from "@/components/UsersList"
import WarehouseSelector from "@/components/WarehouseSelector"
import { useScheduleData } from "@/hooks/useScheduleData"
import { useAuthStore } from "@/store/useAuthStore"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"

/**
 * Экран планировщика: выбор склада и месяца, требования, генерация, таблица.
 *
 * Загрузка данных живёт в `useScheduleData` и запускается сама при смене
 * склада или месяца — экран только показывает её состояние.
 */
const ScheduleScreen = () => {
  const email = useAuthStore((state) => state.email)
  const signOut = useAuthStore((state) => state.signOut)

  const warehouse = useSettingStore((state) => state.warehouse)
  const currentMonth = useSettingStore((state) => state.currentMonth)
  const { isLoading, error, reload } = useScheduleData()

  const handleSignOut = async () => {
    // Сначала очищаем данные склада: они принадлежали конкретному человеку,
    // и следующий вошедший не должен увидеть чужой график даже мгновение.
    useUsersStore.getState().reset()
    useSettingStore.getState().reset()
    await signOut()
  }

  return (
    <div className="flex min-h-svh flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-end gap-4">
          <WarehouseSelector />
          <MonthPicker />
          {warehouse && (
            <StaffDialog
              warehouse={warehouse}
              month={currentMonth}
              onChanged={reload}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{email}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Выйти"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {warehouse && (
        <div className="flex flex-wrap items-end gap-4">
          {/* key: при смене склада или месяца несохранённые правки
              требований не должны переезжать на новые данные. */}
          <ShiftsSettings key={`${warehouse}|${currentMonth}`} />
          <ScheduleAutoGenerate />
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка данных склада…</p>
      )}

      {error && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Повторить
          </Button>
        </div>
      )}

      {warehouse && !error && <DayLegend />}

      {!error && <UsersList />}

      <ExportsButtonWrapper />
    </div>
  )
}

export default ScheduleScreen
