"use client"

import { useEffect } from "react"

import LoginScreen from "@/components/LoginScreen"
import ScheduleScreen from "@/components/ScheduleScreen"
import { useAuthStore } from "@/store/useAuthStore"

/**
 * Точка входа.
 *
 * Экран один, поэтому вместо отдельного маршрута `/login` форма входа
 * показывается на месте, пока сессии нет. `initialize` восстанавливает сессию
 * из хранилища браузера и подписывается на её изменения.
 */
export default function Page() {
  const status = useAuthStore((state) => state.status)
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  if (status === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    )
  }

  if (status === "signed-out") {
    return <LoginScreen />
  }

  return <ScheduleScreen />
}
