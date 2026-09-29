"use client"

import dayjs from "dayjs"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { CloudAlert } from "lucide-react"

import UserRow from "@/components/UserRow"
import { SHIFT_HOURS } from "@/lib/shift"
import { useSettingStore } from "@/store/useSettingStore"
import { useUsersStore } from "@/store/useUsersStore"
import type { IUser } from "@/types/User"

/**
 * Ряд покрытия: сколько людей выходит в каждый день месяца.
 *
 * Рядов два — «День» и «Ночь», — и различаются они только списком смен и
 * нормой. Копия разметки вторым блоком означала бы, что подсветка дефицита
 * однажды появится только в одном из рядов.
 */
const CoverageRow = ({
  users,
  kind,
  norm,
  daysInMonth,
  gridColumns,
}: {
  users: IUser[]
  kind: "dayShifts" | "nightShifts"
  norm: number
  daysInMonth: number
  gridColumns: string
}) => (
  <div className="grid" style={{ gridTemplateColumns: gridColumns }}>
    {Array.from({ length: daysInMonth }).map((_, index) => {
      const day = index + 1
      const count = users.filter((user) => user[kind].includes(day)).length
      // Покрытие ниже нормы — сигнал менеджеру, а не ошибка: мест может не
      // хватать из-за нехватки людей на складе. Красная заливка во всю клетку
      // перекрывала соседние числа, поэтому дефицит показан спокойной
      // подложкой и жирной цифрой, а не третьим цветом во всю клетку.
      const short = count < norm
      return (
        <div key={day} className="text-center">
          <p
            title={short ? `Людей меньше нормы: ${count} из ${norm}` : undefined}
            className={`py-1 text-sm tabular-nums ${
              short
                ? "bg-rose-500/20 font-semibold text-rose-700 dark:text-rose-300"
                : ""
            }`}
          >
            {count}
          </p>
        </div>
      )
    })}
  </div>
)

/**
 * Таблица графика: строка на работника, колонка на день месяца.
 *
 * Состав приходит из базы по выбранному складу, поэтому «добавить работника»
 * здесь негде: локально созданный сотрудник не существует в `employees`, и
 * сохранение графика упало бы на внешнем ключе. Новых людей заводят в
 * tk-assist.
 */
const UsersList = () => {
  const users = useUsersStore((state) => state.users)
  const dayCount = useSettingStore((state) => state.dayCount)
  const nightCount = useSettingStore((state) => state.nightCount)
  const currentMonth = useSettingStore((state) => state.currentMonth)
  const warehouse = useSettingStore((state) => state.warehouse)

  const daysInMonth = dayjs(currentMonth).daysInMonth()

  // Итоги по всему складу за месяц — та же четвёрка значений, что в шапке
  // и в строке каждого работника, иначе колонки не совпадают.
  const totalDays = users.reduce((sum, user) => sum + user.dayShifts.length, 0)
  const totalNights = users.reduce((sum, user) => sum + user.nightShifts.length, 0)
  const totals = {
    days: totalDays,
    nights: totalNights,
    shifts: totalDays + totalNights,
    hours: (totalDays + totalNights) * SHIFT_HOURS,
  }

  if (!warehouse) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CloudAlert />
          </EmptyMedia>
          <EmptyTitle>Выберите склад</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (!users.length) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CloudAlert />
          </EmptyMedia>
          <EmptyTitle>На складе {warehouse} нет работников</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <p className="text-sm text-muted-foreground">
            Работники привязываются к складу в tk-assist. Проверьте поле
            warehouse у сотрудников.
          </p>
        </EmptyContent>
      </Empty>
    )
  }

  const gridColumns = `repeat(${daysInMonth}, minmax(0, 1fr))`

  const isWeekend = (day: number) => {
    const weekday = dayjs(currentMonth).date(day).day()
    return weekday === 0 || weekday === 6
  }

  return (
    // `min-w-fit` здесь был ошибкой: он сжимал таблицу до ширины содержимого,
    // и сетка дней переставала растягиваться на всю страницу — весь график
    // уезжал узкой колонкой влево. `w-full` заполняет доступную ширину,
    // а `min-w-[1100px]` оставляет горизонтальную прокрутку только там, где
    // 31 колонка действительно не помещается.
    <div className="overflow-x-auto">
      <div className="w-full min-w-[1100px]">
        {/* Шапка с числами месяца.
            Промежутков между колонками здесь нет намеренно: та же сетка в
            строках работников и в итогах идёт без `gap`. С `gap-2` шапка
            сдвигалась относительно тела на 30 промежутков — около 240 px, и
            числа переставали стоять над своими колонками.

            Горизонтальных отступов у шапки тоже нет (`py-1`, а не `p-1`):
            четыре пикселя слева сдвигали сетку дней относительно строк, и
            числа стояли не над своими клетками. Отступ у подписи
            «Сотрудник» задан отдельно. */}
        <div className="mb-1 grid grid-cols-[250px_1fr_220px] items-center rounded-md bg-muted py-1">
          <p className="pl-2 text-sm font-medium">Сотрудник</p>
          <div className="grid" style={{ gridTemplateColumns: gridColumns }}>
            {Array.from({ length: daysInMonth }).map((_, index) => {
              const day = index + 1
              // Выходные дня недели отмечены фоном, а не цветом: оранжевая
              // плашка была ещё одним цветом в таблице, где цвет означает
              // состояние смены, и путала сильнее, чем помогала.
              return (
                <div
                  key={day}
                  title={isWeekend(day) ? "Выходной день недели" : undefined}
                  className={`text-center text-xs tabular-nums ${
                    isWeekend(day)
                      ? "rounded bg-background font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {day}
                </div>
              )
            })}
          </div>
          {/* Колонка 220px, а не 150: словам «Всего» и «Часы» нужно ~45px,
              а в 150px на четыре ячейки приходилось по 27px — заголовки
              вылезали из своих колонок.

              Подписи «D» и «N» однобуквенные намеренно: это те же буквы,
              которыми помечены смены в строках графика («D» — день,
              «N» — ночь), поэтому расшифровка не нужна. */}
          <div className="ml-1 grid grid-cols-4 items-center gap-2 px-2 text-center text-xs font-medium">
            <p title="Дневные смены">D</p>
            <p title="Ночные смены">N</p>
            <p title="Всего смен">Всего</p>
            <p title="Часов за месяц">Часы</p>
          </div>
        </div>

        {users.map((user, index) => (
          <UserRow key={user.subject} user={user} index={index} />
        ))}

        {/* Итоги по покрытию: сколько людей выходит в каждый день.
            Ряды и подписи слева разделены одинаковыми <hr>, поэтому
            «День» и «Ночь» стоят напротив своих строк. Норма подписана рядом
            с названием ряда: без неё красная цифра ничего не сообщает —
            непонятно, с чем сравнивать. */}
        <div className="mt-1 grid grid-cols-[250px_1fr_220px] items-center rounded-md bg-muted py-2">
          <div className="text-right text-sm">
            <p className="py-1 pr-4">
              День
              <span className="text-muted-foreground"> · нужно {dayCount}</span>
            </p>
            <hr className="my-1" />
            <p className="py-1 pr-4">
              Ночь
              <span className="text-muted-foreground"> · нужно {nightCount}</span>
            </p>
          </div>

          <div>
            <CoverageRow
              users={users}
              kind="dayShifts"
              norm={dayCount}
              daysInMonth={daysInMonth}
              gridColumns={gridColumns}
            />
            <hr className="my-1" />
            <CoverageRow
              users={users}
              kind="nightShifts"
              norm={nightCount}
              daysInMonth={daysInMonth}
              gridColumns={gridColumns}
            />
          </div>

          {/* Четыре значения, как в шапке и в строках работников.
              Раньше их было три на четыре колонки — итоги не попадали
              под заголовок «Часы». */}
          <div className="ml-1 grid grid-cols-4 items-start gap-2 px-2 py-1.5 text-center text-sm font-medium tabular-nums">
            <p title="Дневные смены на складе">{totals.days}</p>
            <p title="Ночные смены на складе">{totals.nights}</p>
            <p title="Всего смен на складе">{totals.shifts}</p>
            <p title="Часов на складе">{totals.hours}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UsersList
