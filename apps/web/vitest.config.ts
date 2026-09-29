import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * Конфигурация тестов.
 *
 * Псевдоним `@` повторяет тот, что в `tsconfig.json`: без него тесты не
 * увидят модули приложения. Отдельная зависимость для этого не нужна —
 * хватает встроенного разрешения путей Vite.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Не только `lib`: правила применения правок живут в хранилище, и именно
    // там разошлись список видов отметок и ветки их разбора.
    include: ["{lib,store}/**/*.test.ts"],
    environment: "node",
  },
})
