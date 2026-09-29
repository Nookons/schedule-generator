"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { CalendarCog } from "lucide-react"

import { useAuthStore } from "@/store/useAuthStore"

/**
 * Вход по почте и паролю Supabase.
 *
 * Отдельной страницы входа нет намеренно: приложение состоит из одного экрана,
 * и редирект на `/login` только добавлял бы мигание при возврате. Форма
 * показывается вместо содержимого, пока сессии нет.
 */
const LoginScreen = () => {
  const signIn = useAuthStore((state) => state.signIn)
  const error = useAuthStore((state) => state.error)
  const clearError = useAuthStore((state) => state.clearError)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) return

    setIsSubmitting(true)
    try {
      await signIn(email, password)
    } finally {
      // Пароль не сохраняем в состоянии после попытки: он больше не нужен,
      // а держать его в памяти вкладки незачем.
      setPassword("")
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <CalendarCog className="h-5 w-5" />
          <h1 className="text-lg font-semibold">График смен</h1>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Почта</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) clearError()
              }}
              placeholder="name@company.com"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="password">Пароль</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                if (error) clearError()
              }}
            />
            <FieldDescription>
              Используется та же учётная запись, что и в tk-assist.
            </FieldDescription>
          </Field>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !email.trim() || !password}
          >
            {isSubmitting ? "Вход…" : "Войти"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  )
}

export default LoginScreen
