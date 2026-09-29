import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Браузерный клиент Supabase.
 *
 * Создаётся один раз на вкладку: несколько клиентов означали бы несколько
 * независимых хранилищ сессии, и выход из одного не завершал бы другой.
 *
 * Приложение целиком клиентское (`"use client"`), поэтому сессия живёт в
 * браузере, а серверный middleware не нужен. Токен обновляется автоматически
 * (`autoRefreshToken` включён по умолчанию) — от него зависит доступ к API.
 *
 * Тип указан явно: `createBrowserClient` обобщённая, и `ReturnType` от неё
 * выводится как `any`. С `any` пропадала бы типизация сессии и подписки на её
 * изменения — ровно там, где ошибка стоит дорого.
 */
let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!url || !key) {
      // Ошибка конфигурации, а не пользовательская: без этих значений
      // приложение не сможет ни войти, ни позвать API. Падаем сразу и явно,
      // иначе симптомом будет «неверный пароль» при верных данных.
      throw new Error(
        "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
      )
    }

    client = createBrowserClient(url, key)
  }

  return client
}

/** Текущий access-token или null, если пользователь не вошёл. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  return data.session?.access_token ?? null
}
