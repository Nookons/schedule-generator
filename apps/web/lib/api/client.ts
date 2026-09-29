/**
 * Клиент tk-assist-api.
 *
 * Один слой на все запросы: подстановка токена, разбор конверта `{data, meta}`
 * (ADR-0004) и машиночитаемых ошибок `{error: {code, message, status}}`.
 *
 * Токен берётся из сессии Supabase при каждом запросе, а не кладётся в стор:
 * библиотека обновляет его сама, и копия в сторе рано или поздно протухла бы,
 * дав «внезапный» 401 посреди работы.
 */

import { getAccessToken, getSupabaseClient } from "@/lib/supabase/client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"

/** Коды ошибок, на которые интерфейс реагирует по-разному. */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "EMPLOYEE_NOT_FOUND"
  | "INVALID_SHIFT_DAY"
  | "DUPLICATE_SHIFT"
  | "EMPLOYEE_NOT_IN_WAREHOUSE"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK"
  | "UNKNOWN"

export class ApiError extends Error {
  readonly code: ApiErrorCode | string
  readonly status: number
  readonly requestId?: string
  readonly details: unknown[]

  constructor(
    message: string,
    options: {
      code: string
      status: number
      requestId?: string
      details?: unknown[]
    }
  ) {
    super(message)
    this.name = "ApiError"
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.details = options.details ?? []
  }

  /** Токен истёк или отсутствует — нужен повторный вход. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === "UNAUTHENTICATED"
  }

  /** Не хватает прав: чужой склад или недостаточная роль. */
  get isPermissionError(): boolean {
    return this.status === 403 || this.code === "PERMISSION_DENIED"
  }

  /** Таблицы планировщика ещё нет в базе — не накатили миграции 0010–0015. */
  get isMigrationMissing(): boolean {
    return this.code === "SERVICE_UNAVAILABLE"
  }
}

type QueryValue = string | number | boolean | null | undefined

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path.replace(/^\//, ""), `${API_URL.replace(/\/$/, "")}/`)
  for (const [key, value] of Object.entries(query ?? {})) {
    // Пустые значения не отправляем: иначе `?warehouse=` уехало бы как пустая
    // строка и на бэкенде превратилось бы в фильтр по несуществующему складу.
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

/**
 * Выполняет запрос к API и возвращает `data` из конверта.
 *
 * Ошибки всегда приходят исключением `ApiError`: вызывающий код ветвится по
 * `code`, а не разбирает текст сообщения — тексты меняются, коды нет.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { method = "GET", query, body, signal } = options

  const token = await getAccessToken()
  if (!token) {
    throw new ApiError("Not signed in", {
      code: "UNAUTHENTICATED",
      status: 401,
    })
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    // Сеть недоступна или запрос отменён. Отмену пробрасываем как есть, чтобы
    // вызывающий код мог отличить её от настоящей ошибки.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError(
      `Cannot reach the API at ${API_URL}. Is the backend running?`,
      { code: "NETWORK", status: 0 }
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = payload?.error
    throw new ApiError(error?.message ?? `Request failed with ${response.status}`, {
      code: error?.code ?? "UNKNOWN",
      status: error?.status ?? response.status,
      requestId: error?.request_id,
      details: error?.details,
    })
  }

  // Конверт обязателен: его отсутствие означает, что отвечает не наш API
  // (например, прокси или страница ошибки), и молча вернуть undefined хуже,
  // чем сказать об этом прямо.
  if (payload === null || !("data" in payload)) {
    throw new ApiError("Unexpected response shape: no data envelope", {
      code: "UNKNOWN",
      status: response.status,
    })
  }

  return payload.data as T
}

/**
 * Подписка на смену сессии.
 *
 * Нужна, чтобы разлогинить интерфейс в тот момент, когда токен перестал
 * обновляться: иначе пользователь увидит 401 посреди работы.
 */
export function onAuthStateChange(
  callback: (hasSession: boolean) => void
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    callback(Boolean(session))
  })
  return () => data.subscription.unsubscribe()
}

export { API_URL }
