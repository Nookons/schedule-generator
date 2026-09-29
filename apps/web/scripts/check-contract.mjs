#!/usr/bin/env node
/**
 * Проверка контракта между фронтендом планировщика и tk-assist-api.
 *
 * Что сверяется:
 *   1. путь и метод каждого вызова `apiFetch` есть в схеме API;
 *   2. query-параметры, которые отправляет клиент, объявлены у эндпоинта —
 *      лишний параметр FastAPI молча игнорирует, и фильтр «не работает» без
 *      единой ошибки (ровно этот класс дефектов разобран в docs/INTEGRATION.md
 *      как C-02: фронт передаёт `warehouse`, бэк его выбрасывает);
 *   3. поля тела запроса совпадают со схемой — у моделей стоит
 *      `extra="forbid"`, поэтому опечатка в имени поля даёт 422, и узнать об
 *      этом можно только в рантайме.
 *
 * Запуск:
 *   node scripts/check-contract.mjs
 *   node scripts/check-contract.mjs path/to/openapi.json
 *   API_OPENAPI_URL=http://127.0.0.1:8000/openapi.json node scripts/check-contract.mjs
 *
 * Код возврата 1 при расхождениях — пригодно для CI.
 */

import { readFileSync } from "node:fs"
import { argv, env, exit } from "node:process"

const SERVICES = new URL("../services/ScheduleApi.ts", import.meta.url)
const TYPES = new URL("../lib/api/types.ts", import.meta.url)

const openapiSource = argv[2] ?? env.API_OPENAPI_URL ?? "http://127.0.0.1:8000/openapi.json"

async function loadOpenApi(source) {
  if (source.startsWith("http")) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`OpenAPI недоступен: ${response.status} ${source}`)
    return response.json()
  }
  return JSON.parse(readFileSync(source, "utf8"))
}

/** Разбирает `lib/api/types.ts` в карту «имя интерфейса → набор полей». */
function parseInterfaces(source) {
  const map = new Map()
  const pattern = /export interface (\w+)\s*\{([\s\S]*?)\n\}/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    const [, name, body] = match
    const fields = []
    // Поля верхнего уровня: строка начинается с двух пробелов и имени.
    for (const line of body.split("\n")) {
      const field = /^ {2}(\w+)\??\s*:/.exec(line)
      if (field) fields.push(field[1])
    }
    map.set(name, fields)
  }
  return map
}

/** Разбивает файл сервиса на методы: `static name(...) { ... }`. */
function parseMethods(source) {
  const methods = []
  const pattern = /static\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1]
    // Границы метода — до следующего `static` или конца файла.
    const rest = source.slice(match.index + match[0].length)
    const next = rest.search(/\n {2}static\s/)
    methods.push({ name, body: next === -1 ? rest : rest.slice(0, next), head: match[0] })
  }
  return methods
}

function extractCall(body) {
  const path = /apiFetch<[^>]*>\(\s*[`"]([^`"]+)[`"]/.exec(body)
  if (!path) return null
  const method = /method:\s*"(\w+)"/.exec(body)
  const query = /query:\s*\{([^}]*)\}/.exec(body)
  return {
    path: path[1],
    method: (method?.[1] ?? "GET").toUpperCase(),
    query: query
      ? query[1]
          .split(",")
          .map((part) => part.split(":")[0].trim())
          .filter(Boolean)
      : [],
    body: extractBody(body),
    signature: body.slice(0, body.indexOf("{")) + body,
  }
}

/** Поля тела: либо литерал `{ a, b }`, либо имя переменной с её типом. */
function extractBody(body) {
  const inline = /body:\s*\{([\s\S]*?)\n?\s*\}/.exec(body)
  if (inline) {
    return {
      kind: "inline",
      fields: inline[1]
        .split(/[,\n]/)
        .map((part) => part.split(":")[0].trim())
        .filter((part) => part && !part.startsWith("//")),
    }
  }
  const variable = /body:\s*(\w+)/.exec(body)
  if (variable) {
    const type = new RegExp(`${variable[1]}\\s*:\\s*(\\w+)`).exec(body)
    return { kind: "variable", fields: [], type: type?.[1] ?? null }
  }
  return null
}

function matches(template, concrete) {
  return new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(concrete)
}

const openapi = await loadOpenApi(openapiSource)
const interfaces = parseInterfaces(readFileSync(TYPES, "utf8"))
const methods = parseMethods(readFileSync(SERVICES, "utf8"))

const problems = []
let checked = 0

for (const method of methods) {
  const call = extractCall(method.body)
  if (!call) continue
  checked++

  const concrete = call.path.replace(/\$\{[^}]+\}/g, "0")
  const template = Object.keys(openapi.paths).find((key) => matches(key, concrete))

  if (!template) {
    problems.push(`${method.name}: путь ${call.path} отсутствует в схеме API`)
    continue
  }
  const operation = openapi.paths[template][call.method.toLowerCase()]
  if (!operation) {
    problems.push(`${method.name}: ${call.method} ${template} не объявлен`)
    continue
  }

  const declaredQuery = new Set(
    (operation.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name)
  )
  for (const param of call.query) {
    if (!declaredQuery.has(param)) {
      problems.push(
        `${method.name}: параметр «${param}» не объявлен у ${call.method} ${template} — сервер его молча проигнорирует`
      )
    }
  }

  if (!call.body) continue

  const ref = operation.requestBody?.content?.["application/json"]?.schema?.$ref
  const schemaName = ref?.split("/").pop()
  const declaredFields = new Set(
    Object.keys(openapi.components?.schemas?.[schemaName]?.properties ?? {})
  )

  let sentFields = call.body.fields
  if (call.body.kind === "variable") {
    if (!call.body.type) {
      problems.push(`${method.name}: не удалось определить тип тела запроса`)
      continue
    }
    sentFields = interfaces.get(call.body.type)
    if (!sentFields) {
      problems.push(
        `${method.name}: интерфейс ${call.body.type} не найден в lib/api/types.ts`
      )
      continue
    }
  }

  for (const field of sentFields) {
    if (!declaredFields.has(field)) {
      problems.push(
        `${method.name}: поле «${field}» отсутствует в схеме ${schemaName} — сервер ответит 422`
      )
    }
  }

  const missing = [...declaredFields].filter(
    (field) => !sentFields.includes(field) && field !== "month"
  )
  const required = openapi.components?.schemas?.[schemaName]?.required ?? []
  for (const field of required) {
    if (!sentFields.includes(field)) {
      problems.push(
        `${method.name}: обязательное поле «${field}» схемы ${schemaName} не отправляется`
      )
    }
  }
  void missing
}

if (problems.length) {
  console.error(`Контракт нарушен (${problems.length}):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  exit(1)
}

console.log(`Контракт в порядке: проверено вызовов — ${checked}`)
