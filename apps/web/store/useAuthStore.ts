import { create } from "zustand"

import { getSupabaseClient } from "@/lib/supabase/client"

/**
 * Состояние сессии Supabase.
 *
 * Приложение клиентское, поэтому вход выполняется прямо в браузере, а токен
 * живёт в хранилище supabase-js. Серверный middleware здесь не нужен: все
 * данные приходят из API, который сам проверяет подпись токена.
 */

export type AuthStatus = "loading" | "signed-out" | "signed-in"

interface AuthState {
  status: AuthStatus
  email: string | null
  error: string | null
  /** Восстанавливает сессию при загрузке страницы и следит за её сменой. */
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  email: null,
  error: null,

  initialize: async () => {
    const supabase = getSupabaseClient()

    const { data } = await supabase.auth.getSession()
    set({
      status: data.session ? "signed-in" : "signed-out",
      email: data.session?.user.email ?? null,
    })

    // Обновление токена, выход из другой вкладки и истечение сессии приходят
    // сюда. Без подписки интерфейс остался бы «вошедшим» с мёртвым токеном
    // и показывал бы 401 на каждый запрос.
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        status: session ? "signed-in" : "signed-out",
        email: session?.user.email ?? null,
      })
    })
  },

  signIn: async (email, password) => {
    set({ error: null })
    const supabase = getSupabaseClient()

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      // Текст от Supabase англоязычный и технический; показываем понятную
      // формулировку, а исходный текст оставляем в консоли для разбора.
      console.error("sign-in failed", error)
      set({
        error:
          error.message === "Invalid login credentials"
            ? "Неверная почта или пароль."
            : `Не удалось войти: ${error.message}`,
      })
      return false
    }

    set({ error: null })
    return true
  },

  signOut: async () => {
    await getSupabaseClient().auth.signOut()
    set({ status: "signed-out", email: null, error: null })
  },

  clearError: () => set({ error: null }),
}))
