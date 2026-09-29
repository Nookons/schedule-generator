"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import dayjs from "@/lib/dayjs"
import {
  ArrowUpToLine,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { ApiError } from "@/lib/api/client"
import type {
  DirectoryEmployee,
  ScheduleStaffMember,
  SubjectKey,
  UnregisteredWorker,
} from "@/lib/api/types"
import { ScheduleApi } from "@/services/ScheduleApi"

/**
 * Состав склада на выбранный месяц.
 *
 * Состав ведётся отдельным списком, а не полем в карточке работника: человек
 * может работать на нескольких складах сразу. Здесь же заводят людей, которых
 * в системе ещё нет, — нового сотрудника можно добавить одним именем, не
 * дожидаясь, пока ему заведут почту, карту и роль.
 *
 * Базовый состав склада общий для всех месяцев, а правка может быть точечной:
 * переключатель «Только на этот месяц» решает, писать её в месяц или в склад.
 */

/** Человекочитаемый месяц: интерфейс планировщика русский. */
const formatMonth = (month: string) =>
  dayjs(`${month}-01`).format("MMMM YYYY")

/** Кандидат к добавлению: либо работник из справочника, либо заведённый вручную. */
interface Candidate {
  subject: SubjectKey
  name: string
  hint: string
  workerId: number | null
}

interface LoadedData {
  key: string
  staff: ScheduleStaffMember[]
  candidates: Candidate[]
  /** Все активные работники — из них выбирают, с кем связать. */
  employees: { id: number; name: string }[]
}

const StaffDialog = ({
  warehouse,
  month,
  onChanged,
}: {
  warehouse: string
  month: string
  onChanged: () => void
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [data, setData] = useState<LoadedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  /**
   * Правка по умолчанию — только на выбранный месяц: чаще всего состав
   * подгоняют под конкретный график, а не меняют склад навсегда.
   */
  const [onlyThisMonth, setOnlyThisMonth] = useState(true)
  /** Участник, для которого сейчас выбирают работника для связывания. */
  const [linking, setLinking] = useState<SubjectKey | null>(null)
  const [linkTarget, setLinkTarget] = useState<string>("")

  const monthLabel = formatMonth(month)
  const key = `${warehouse}|${month}|${reloadToken}`
  const isLoading = isOpen && data?.key !== key && !error

  const reload = useCallback(() => {
    setError(null)
    setReloadToken((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let active = true

    Promise.all([
      ScheduleApi.listStaff(warehouse, month),
      ScheduleApi.listDirectoryEmployees(),
      ScheduleApi.listWorkers(),
    ])
      .then(([staff, directory, workers]) => {
        if (!active) return
        // Именно все subject из ответа, а не только `is_staff`: убранный на
        // этот месяц человек уже числится за складом, и в кандидатах он
        // позволил бы добавить себя второй раз вместо «Вернуть».
        const known = new Set(staff.map((row) => row.subject))
        setData({
          key,
          staff,
          employees: directory
            .filter((row) => row.is_active !== false)
            .map((row) => ({
              id: row.id,
              name: row.user_name ?? `Сотрудник #${row.id}`,
            })),
          candidates: [
            // Уволенные не должны предлагаться к добавлению: они не выйдут
            // на смену, и добавление только засорило бы состав.
            ...directory
              .filter((row) => row.is_active !== false)
              .map((row: DirectoryEmployee) => ({
                subject: `e${row.id}`,
                name: row.user_name ?? `Сотрудник #${row.id}`,
                hint: row.warehouse ?? "склад не указан",
                workerId: null,
              })),
            ...workers.map((row: UnregisteredWorker) => ({
              subject: row.subject,
              name: row.full_name,
              hint: "без регистрации",
              workerId: row.id,
            })),
          ].filter((row) => !known.has(row.subject)),
        })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(
          cause instanceof ApiError ? cause.message : "Не удалось загрузить состав"
        )
      })

    return () => {
      active = false
    }
  }, [isOpen, warehouse, month, key])

  const staff = data?.key === key ? data.staff : []
  const candidates = data?.key === key ? data.candidates : []
  const employees = data?.key === key ? data.employees : []

  const staffThisMonth = staff.filter((row) => row.is_staff)
  const removedThisMonth = staff.filter(
    (row) => row.month_action === "remove" && !row.is_staff
  )

  const describe = (cause: unknown, fallback: string) =>
    toast.error(cause instanceof ApiError ? cause.message : fallback)

  /**
   * Одна правка состава.
   *
   * `permanent` решает, куда она ляжет: в выбранный месяц или в базовый
   * состав склада. Выбор делает переключатель — кроме действий, у которых
   * постоянство зашито в само название («Сделать постоянным», «Вернуть»).
   */
  const applyChange = async (
    subject: SubjectKey,
    action: "add" | "remove",
    permanent: boolean,
    busyKey: string,
    success: string
  ) => {
    setBusy(busyKey)
    try {
      if (action === "add") {
        await ScheduleApi.addStaff(warehouse, month, [subject], permanent)
      } else {
        await ScheduleApi.removeStaff(warehouse, subject, month, permanent)
      }
      reload()
      onChanged()
      toast.success(success)
    } catch (cause) {
      describe(
        cause,
        action === "add" ? "Не удалось добавить" : "Не удалось убрать"
      )
    } finally {
      setBusy(null)
    }
  }

  const handleAdd = (subject: SubjectKey) =>
    applyChange(
      subject,
      "add",
      !onlyThisMonth,
      subject,
      onlyThisMonth
        ? `Участник добавлен в состав на ${monthLabel}`
        : "Участник добавлен в состав склада"
    )

  const handleRemove = (subject: SubjectKey) =>
    applyChange(
      subject,
      "remove",
      !onlyThisMonth,
      subject,
      onlyThisMonth
        ? `Участник убран из состава на ${monthLabel}`
        : "Участник убран из состава склада"
    )

  /** Добавленный только на месяц уходит в базовый состав склада. */
  const handleMakePermanent = (subject: SubjectKey, name: string) =>
    applyChange(
      subject,
      "add",
      true,
      `base-${subject}`,
      `${name} теперь в составе склада во всех месяцах`
    )

  /** «Вернуть» снимает правку месяца, а не трогает базовый состав. */
  const handleRestore = (subject: SubjectKey, name: string) =>
    applyChange(
      subject,
      "add",
      false,
      subject,
      `${name} возвращён в состав на ${monthLabel}`
    )

  /** Заводит человека одним именем и сразу ставит в состав выбранного месяца. */
  const handleCreate = async () => {
    const fullName = newName.trim()
    if (!fullName) return

    setBusy("create")
    try {
      const worker = await ScheduleApi.createWorker({ full_name: fullName })
      await ScheduleApi.addStaff(warehouse, month, [worker.subject], !onlyThisMonth)
      setNewName("")
      reload()
      onChanged()
      toast.success(`${worker.full_name} добавлен в состав`)
    } catch (cause) {
      describe(cause, "Не удалось завести человека")
    } finally {
      setBusy(null)
    }
  }

  /** Удаляет нерeгистрированного вместе с его графиком. */
  const handleDeleteWorker = async (workerId: number, name: string) => {
    setBusy(`delete-${workerId}`)
    try {
      await ScheduleApi.deleteWorker(workerId)
      reload()
      onChanged()
      toast.success(`${name} удалён вместе со своим графиком`)
    } catch (cause) {
      describe(cause, "Не удалось удалить")
    } finally {
      setBusy(null)
    }
  }

  /** Переносит график нерeгистрированного на зарегистрированного работника. */
  const handleLink = async (subject: SubjectKey) => {
    const worker = staff.find((row) => row.subject === subject)
    const employeeId = Number(linkTarget)
    if (!worker || !employeeId) return

    setBusy(subject)
    try {
      const result = await ScheduleApi.linkWorker(worker.id, employeeId)
      setLinking(null)
      setLinkTarget("")
      reload()
      onChanged()
      toast.success(
        `График перенесён: смен ${result.shifts}, отметок ${result.marks}`
      )
    } catch (cause) {
      describe(cause, "Не удалось связать")
    } finally {
      setBusy(null)
    }
  }

  const filtered = candidates.filter((row) =>
    row.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Users />
          Состав склада
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Состав склада {warehouse} · {monthLabel}
          </DialogTitle>
          <DialogDescription>
            Правки применяются к выбранному месяцу, а базовый состав склада общий
            для всех месяцев. Участник может числиться сразу в нескольких складах,
            и нового человека можно завести одним именем — карта, почта и роль
            появятся позже, а график уже будет за ним.
          </DialogDescription>
        </DialogHeader>

        <section className="flex items-start gap-2 rounded border p-3">
          <Checkbox
            id="staff-only-this-month"
            checked={onlyThisMonth}
            onCheckedChange={(value) => setOnlyThisMonth(value === true)}
          />
          <div className="grid gap-1">
            <Label htmlFor="staff-only-this-month">Только на этот месяц</Label>
            <p className="text-xs text-muted-foreground">
              {onlyThisMonth
                ? `Изменение только для ${monthLabel}: базовый состав склада не изменится.`
                : "Изменение для всех месяцев: базовый состав склада изменится."}
            </p>
          </div>
        </section>

        <section className="rounded border p-3">
          <h3 className="mb-2 text-sm font-medium">Завести человека по имени</h3>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreate()
              }}
              placeholder="Имя и фамилия"
            />
            <Button
              onClick={handleCreate}
              disabled={busy === "create" || !newName.trim()}
            >
              <UserPlus />
              Завести и добавить
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Запись в списке сотрудников не создаётся: там обязательны карта и
            роль. Такой человек живёт только в графике.
          </p>
        </section>

        {isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}

        {error && (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Повторить
            </Button>
          </div>
        )}

        {!isLoading && !error && (
          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-medium">
                В составе · {monthLabel}: {staffThisMonth.length}
              </h3>
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {staffThisMonth.map((row) => (
                  <li
                    key={row.subject}
                    className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {row.user_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.kind === "worker"
                          ? "без регистрации"
                          : `карточка: ${row.home_warehouse ?? "—"}`}
                      </span>
                      {row.month_action === "add" && !row.in_base && (
                        <span className="block truncate text-xs text-muted-foreground">
                          только в этом месяце
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0">
                      {row.month_action === "add" && !row.in_base && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Сделать постоянным: ${row.user_name}`}
                          title="Сделать постоянным — добавить в состав склада во всех месяцах"
                          disabled={
                            busy === row.subject || busy === `base-${row.subject}`
                          }
                          onClick={() =>
                            handleMakePermanent(row.subject, row.user_name)
                          }
                        >
                          <ArrowUpToLine className="h-4 w-4" />
                        </Button>
                      )}
                      {row.kind === "worker" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Связать ${row.user_name} с работником`}
                          title="Человек получил регистрацию — перенести график"
                          disabled={busy === row.subject}
                          onClick={() => {
                            setLinking(linking === row.subject ? null : row.subject)
                            setLinkTarget("")
                          }}
                        >
                          <Link2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Убрать ${row.user_name}`}
                        title={
                          onlyThisMonth
                            ? `Убрать из состава на ${monthLabel} — базовый состав склада не изменится`
                            : "Убрать из состава склада — во всех месяцах"
                        }
                        disabled={busy === row.subject}
                        onClick={() => handleRemove(row.subject)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </span>
                  </li>
                ))}
                {staffThisMonth.length === 0 && (
                  <li
                    key="empty-staff"
                    className="text-sm text-muted-foreground"
                  >
                    В этом месяце на складе никого нет
                  </li>
                )}
              </ul>
            </section>

            <div className="grid gap-4">
              {removedThisMonth.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-medium">
                    Убраны в этом месяце: {removedThisMonth.length}
                  </h3>
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {removedThisMonth.map((row) => (
                      <li
                        key={row.subject}
                        className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {row.user_name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.kind === "worker"
                              ? "без регистрации"
                              : `карточка: ${row.home_warehouse ?? "—"}`}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          aria-label={`Вернуть ${row.user_name} в состав`}
                          title={`Вернуть в состав на ${monthLabel} — базовый состав склада уже включает этого человека`}
                          disabled={busy === row.subject}
                          onClick={() => handleRestore(row.subject, row.user_name)}
                        >
                          <Undo2 className="h-4 w-4" />
                          Вернуть
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-medium">Добавить</h3>
                {linking && (
                  <div className="mb-2 rounded border border-primary/40 p-2">
                    <p className="mb-1 text-xs">
                      С кем связать:{" "}
                      <strong>
                        {staff.find((row) => row.subject === linking)?.user_name}
                      </strong>
                    </p>
                    <div className="flex gap-2">
                      <Select value={linkTarget} onValueChange={setLinkTarget}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Выберите работника" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((employee) => (
                            <SelectItem key={employee.id} value={String(employee.id)}>
                              {employee.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={!linkTarget || busy === linking}
                        onClick={() => handleLink(linking)}
                      >
                        Связать
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Смены, отметки и место в составе переедут на работника.
                    </p>
                  </div>
                )}
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск по имени"
                  className="mb-2"
                />
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {filtered.map((row) => (
                    <li
                      key={row.subject}
                      className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{row.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.hint}
                        </span>
                      </span>
                      <span className="flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Добавить ${row.name}`}
                          title={
                            onlyThisMonth
                              ? `Добавить в состав на ${monthLabel}`
                              : "Добавить в состав склада — во всех месяцах"
                          }
                          disabled={busy === row.subject}
                          onClick={() => handleAdd(row.subject)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        {row.workerId !== null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Удалить ${row.name} навсегда`}
                            title="Удалить вместе с графиком"
                            disabled={busy === `delete-${row.workerId}`}
                            onClick={() =>
                              handleDeleteWorker(row.workerId as number, row.name)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                  {filtered.length === 0 && (
                    <li key="empty-candidates" className="text-sm text-muted-foreground">
                      {candidates.length === 0
                        ? "Все уже в составе"
                        : "Никого не найдено"}
                    </li>
                  )}
                </ul>
              </section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default StaffDialog
