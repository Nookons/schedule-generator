import dayjs from "@/lib/dayjs"
import ExcelJS from "exceljs"
import { saveAs } from "file-saver"

import { EXCEL_FILL, dayVisual } from "@/lib/dayVisual"
import { SHIFT_HOURS } from "@/lib/shift"
import type { IUser } from "@/types/User"

/**
 * Экспорт графика в Excel.
 *
 * Файл должен читаться так же, как экран: те же обозначения дней (D, N, В, О,
 * Б), те же цвета и та же арифметика в итогах. Раньше он знал только о сменах
 * этого склада — ни отметок, ни смен на других складах, — и распечатанный
 * график показывал отпуск как пустой день, а ночь на другом складе как
 * выходной.
 *
 * Оформление светлое: файл печатают и открывают в Excel, где тёмная заливка на
 * весь лист читается хуже и расходует картридж.
 */

/** Цвета, которых нет в состоянии дня: шапка, имя, итоги. */
const STYLE = {
  header: { fill: "FF1F2937", text: "FFFFFFFF" },
  headerWeekend: { fill: "FF475569", text: "FFFFFFFF" },
  name: { fill: "FFF8FAFC", text: "FF0F172A" },
  summary: { fill: "FFF1F5F9", text: "FF0F172A" },
  coverageLabel: { fill: "FFE2E8F0", text: "FF0F172A" },
  coverage: { fill: "FFFFFFFF", text: "FF334155" },
  // Дефицит людей в дне — тот же сигнал, что и красная цифра на экране.
  coverageShort: { fill: "FFFECDD3", text: "FF9F1239" },
} as const

const BORDER_COLOR = "FFCBD5E1"

export const handleExcelExport = async ({
  users,
  currentMonth,
  dayCount,
  nightCount,
}: {
  users: IUser[]
  currentMonth: string
  /** Норма людей в дневную смену — по ней считается дефицит в итогах. */
  dayCount: number
  /** Норма людей в ночную смену. */
  nightCount: number
}) => {
  const daysInMonth = dayjs(currentMonth).daysInMonth()
  const monthLabel = dayjs(currentMonth).format("MMMM YYYY")

  /** 1 колонка имени, дни месяца, затем D, N, Всего и Часы. */
  const lastColumn = daysInMonth + 5

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(monthLabel)

  const center: Partial<ExcelJS.Alignment> = {
    horizontal: "center",
    vertical: "middle",
  }

  const writeCell = (
    cell: ExcelJS.Cell,
    value: string | number,
    style: { fill: string; text: string },
    options: { bold?: boolean; align?: Partial<ExcelJS.Alignment> } = {}
  ) => {
    cell.value = value
    cell.alignment = options.align ?? center
    cell.font = {
      bold: options.bold ?? false,
      color: { argb: style.text },
      size: 11,
    }
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: style.fill },
    }
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    }
  }

  /** Строка целиком: одинаковые границы и заливка по умолчанию. */
  const writeRow = (
    rowNumber: number,
    styleFor: (column: number) => {
      style: { fill: string; text: string }
      bold?: boolean
      align?: Partial<ExcelJS.Alignment>
    }
  ) => {
    const row = worksheet.getRow(rowNumber)
    for (let column = 1; column <= lastColumn; column++) {
      const { style, bold, align } = styleFor(column)
      const value = row.getCell(column).value ?? ""
      writeCell(row.getCell(column), value as string | number, style, {
        bold,
        align,
      })
    }
  }

  // ── Заголовок ──────────────────────────────────────────────────────
  worksheet.addRow([
    "Сотрудник",
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    "D",
    "N",
    "Всего",
    "Часы",
  ])
  const headerRow = worksheet.getRow(1)
  headerRow.height = 24
  writeRow(1, (column) => {
    if (column === 1) {
      return {
        style: STYLE.header,
        bold: true,
        align: { horizontal: "left", vertical: "middle" },
      }
    }
    if (column <= daysInMonth + 1) {
      // Выходные дни недели выделены фоном — как на экране, где у них своя
      // подложка, а не свой цвет.
      const weekday = dayjs(currentMonth).date(column - 1).day()
      const weekend = weekday === 0 || weekday === 6
      return { style: weekend ? STYLE.headerWeekend : STYLE.header, bold: true }
    }
    return { style: STYLE.header, bold: true }
  })

  // ── Строки работников ──────────────────────────────────────────────
  users.forEach((user, index) => {
    const rowNumber = worksheet.rowCount + 1

    worksheet.addRow([
      user.fullName,
      ...Array.from({ length: daysInMonth }, (_, i) => dayVisual(user, i + 1).label),
      user.dayShifts.length,
      user.nightShifts.length,
      user.dayShifts.length + user.nightShifts.length,
      (user.dayShifts.length + user.nightShifts.length) * SHIFT_HOURS,
    ])
    const row = worksheet.getRow(rowNumber)
    row.height = 22

    writeRow(rowNumber, (column) => {
      if (column === 1) {
        return {
          style: STYLE.name,
          bold: true,
          align: { horizontal: "left", vertical: "middle" },
        }
      }
      if (column <= daysInMonth + 1) {
        const kind = dayVisual(user, column - 1).kind
        return { style: EXCEL_FILL[kind] }
      }
      // Итоги считают только этот склад — так же, как смены в строке.
      return { style: STYLE.summary, bold: index % 2 === 1 }
    })
  })

  // ── Итоги покрытия ─────────────────────────────────────────────────
  const totalDays = users.reduce((sum, user) => sum + user.dayShifts.length, 0)
  const totalNights = users.reduce((sum, user) => sum + user.nightShifts.length, 0)

  const addCoverageRow = (
    label: string,
    kind: "dayShifts" | "nightShifts",
    norm: number,
    withTotals: boolean
  ) => {
    const rowNumber = worksheet.rowCount + 1
    const counts = Array.from({ length: daysInMonth }, (_, i) =>
      users.filter((user) => user[kind].includes(i + 1)).length
    )

    worksheet.addRow([
      `${label} · нужно ${norm}`,
      ...counts,
      ...(withTotals
        ? [totalDays, totalNights, totalDays + totalNights, (totalDays + totalNights) * SHIFT_HOURS]
        : ["", "", "", ""]),
    ])
    const row = worksheet.getRow(rowNumber)
    row.height = 20

    writeRow(rowNumber, (column) => {
      if (column === 1) {
        return {
          style: STYLE.coverageLabel,
          bold: true,
          align: { horizontal: "left", vertical: "middle" },
        }
      }
      if (column <= daysInMonth + 1) {
        const count = counts[column - 2] ?? 0
        return { style: count < norm ? STYLE.coverageShort : STYLE.coverage, bold: count < norm }
      }
      return { style: STYLE.summary, bold: true }
    })
  }

  addCoverageRow("День", "dayShifts", dayCount, true)
  addCoverageRow("Ночь", "nightShifts", nightCount, false)

  // ── Ширина колонок и закрепление шапки ─────────────────────────────
  worksheet.getColumn(1).width = 26
  for (let i = 2; i <= daysInMonth + 1; i++) worksheet.getColumn(i).width = 4.5
  for (let i = daysInMonth + 2; i <= lastColumn; i++) {
    worksheet.getColumn(i).width = 7
  }

  // Шапка и колонка имён остаются на месте при прокрутке: в месяце тридцать
  // одна колонка, и без закрепления к двадцатому числу уже не видно, чья это
  // строка.
  worksheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }]

  // ── Скачать ────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(new Blob([buffer]), `schedule_${currentMonth}.xlsx`)
}
