"use client"

import dayjs from "dayjs"

import DayCell from "@/components/DayCell"
import UserSettingDialog from "@/components/userSettingDialog"
import { SHIFT_HOURS } from "@/lib/shift"
import { useSettingStore } from "@/store/useSettingStore"
import type { IUser } from "@/types/User"

/**
 * Строка работника в таблице графика.
 *
 * Своего цвета у строки нет. Раньше он был у каждого человека, и поверх него
 * лежали цвета смен: в таблице на десять человек получалась радуга, в которой
 * не разобрать, где день, а где ночь, а цвет всё равно ничего не сообщал —
 * имя и так называет человека. Вместо него — чередование фона и подсветка
 * строки под курсором: они ведут взгляд по тридцати одной колонке и не спорят
 * с цветом смен.
 */

/** Тон чипа: нейтральный, предупреждающий и «чужой склад» — как у клеток. */
const CHIP_TONE = {
  neutral: "bg-foreground/5 text-muted-foreground",
  danger: "bg-destructive/10 text-destructive",
  external:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
} as const

interface Chip {
  key: string
  text: string
  title: string
  tone?: keyof typeof CHIP_TONE
}

/**
 * Состояния человека, которые не видно в сетке дней: без них менеджер не
 * поймёт, почему у одного работника нет кнопки настроек, а у другого часть
 * дней уже занята в другом месте.
 */
function describe(user: IUser, externalCount: number): Chip[] {
  const chips: Chip[] = []

  if (user.kind === "worker") {
    chips.push({
      key: "kind",
      text: "без регистрации",
      title: "Человек заведён одним именем — в tk-assist его ещё нет",
    })
  }
  if (!user.isActive) {
    chips.push({
      key: "active",
      text: "отключён",
      title: "Сотрудник отключён в tk-assist",
      tone: "danger",
    })
  }
  if (user.hasMonthOverride) {
    chips.push({
      key: "override",
      text: "настройки на месяц",
      title: "Предпочтения на этот месяц отличаются от постоянных",
    })
  }
  if (externalCount > 0) {
    chips.push({
      key: "external",
      text: `др. склад: ${externalCount}`,
      title:
        `Ещё ${externalCount} смен в этом месяце на других складах. ` +
        "В итогах строки они не учтены — те считают только этот склад",
      tone: "external",
    })
  }

  return chips
}

const UserRow = ({ user, index }: { user: IUser; index: number }) => {
  const currentMonth = useSettingStore((state) => state.currentMonth)
  const warehouse = useSettingStore((state) => state.warehouse)
  const daysInMonth = dayjs(currentMonth).daysInMonth()

  const totalDays = user.dayShifts.length
  const totalNights = user.nightShifts.length
  const totalShifts = totalDays + totalNights

  const externalCount = Object.keys(user.externalShifts).length
  const chips = describe(user, externalCount)

  const columns = `repeat(${daysInMonth}, minmax(0, 1fr))`

  return (
    <div
      className={`grid grid-cols-[250px_1fr_220px] items-stretch border-b border-border/40 hover:bg-accent/40 ${
        index % 2 ? "bg-muted/30" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={user.fullName}>
            {user.fullName}
          </p>
          {chips.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  title={chip.title}
                  className={`rounded px-1 text-[10px] leading-4 whitespace-nowrap ${
                    CHIP_TONE[chip.tone ?? "neutral"]
                  }`}
                >
                  {chip.text}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Предпочтения живут в таблице работников: у человека без регистрации
            их нет, и открывать нечего — выходные ему ставят отметками дня. */}
        {user.kind === "employee" && <UserSettingDialog user={user} />}
      </div>

      <div className="grid items-center" style={{ gridTemplateColumns: columns }}>
        {Array.from({ length: daysInMonth }).map((_, dayIndex) => (
          <DayCell
            key={dayIndex + 1}
            user={user}
            day={dayIndex + 1}
            warehouse={warehouse ?? ""}
            month={currentMonth}
          />
        ))}
      </div>

      {/* Итоги считают только этот склад — так же, как смены в сетке. Смены на
          других складах вынесены в чип у имени: иначе «Всего» переставало
          сходиться с суммой D и N, и строке нельзя было верить. */}
      <div className="ml-1 grid grid-cols-4 items-center gap-2 px-2 text-center text-sm tabular-nums">
        <p title={`Дневные смены на складе ${warehouse ?? ""}`.trim()}>
          {totalDays}
        </p>
        <p title={`Ночные смены на складе ${warehouse ?? ""}`.trim()}>
          {totalNights}
        </p>
        <p title={`Всего смен здесь: ${totalDays} днём и ${totalNights} ночью`}>
          {totalShifts}
        </p>
        <p title={`Часов здесь: ${totalShifts} × ${SHIFT_HOURS}`}>
          {totalShifts * SHIFT_HOURS}
        </p>
      </div>
    </div>
  )
}

export default UserRow
