'use client'
import React from "react"
import { useUsersStore } from "@/store/useUsersStore"
import { Button } from "@workspace/ui/components/button"
import { CloudUpload, FileDown, Sheet } from "lucide-react"
import * as XLSX from "xlsx"
import { useSettingStore } from "@/store/useSettingStore"
import dayjs from "dayjs"
import ExcelJS from "exceljs"
import { saveAs } from "file-saver"

const ExportsButtonWrapper = () => {
  const { users } = useUsersStore()
  const { currentMonth } = useSettingStore()


  const handleExcelExport = async () => {
    const daysInMonth = dayjs(currentMonth).daysInMonth()
    const monthLabel = dayjs(currentMonth).format("MMMM YYYY")

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet(monthLabel)

    const center: Partial<ExcelJS.Alignment> = {
      horizontal: "center",
      vertical: "middle",
    }

    const COLORS = {
      day: "FFFFA500", // оранжевый
      night: "FF4A90D9", // синий
      empty: "FF2D2D2D", // тёмный
      header: "FF1A1A1A", // заголовок
      headerText: "FFFFFFFF",
      nameCol: "FF111111",
      countRow: "FF1E1E1E",
    }

    const makeCell = (
      cell: ExcelJS.Cell,
      value: string | number,
      bgColor: string,
      textColor = "FFFFFFFF",
      bold = false
    ) => {
      cell.value = value
      cell.alignment = center
      cell.font = { bold, color: { argb: textColor }, size: 11 }
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bgColor },
      }
      cell.border = {
        top: { style: "thin", color: { argb: "FF333333" } },
        left: { style: "thin", color: { argb: "FF333333" } },
        bottom: { style: "thin", color: { argb: "FF333333" } },
        right: { style: "thin", color: { argb: "FF333333" } },
      }
    }

    // ── Заголовок ──────────────────────────────────────────────────────
    const headerRow = worksheet.addRow([
      "Name",
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
      "D",
      "N",
      "T",
    ])
    headerRow.height = 24
    headerRow.eachCell((cell, col) => {
      makeCell(
        cell,
        cell.value as string | number,
        COLORS.header,
        COLORS.headerText,
        true
      )
    })

    // ── Строки пользователей ───────────────────────────────────────────
    users.forEach((user) => {
      const rowData: (string | number)[] = [user.fullName]

      for (let day = 1; day <= daysInMonth; day++) {
        if (user.dayShifts.includes(day)) rowData.push("D")
        else if (user.nightShifts.includes(day)) rowData.push("N")
        else rowData.push("—")
      }

      rowData.push(user.dayShifts.length)
      rowData.push(user.nightShifts.length)
      rowData.push(user.dayShifts.length + user.nightShifts.length)

      const row = worksheet.addRow(rowData)
      row.height = 22

      row.eachCell((cell, colIndex) => {
        const val = cell.value as string

        if (colIndex === 1) {
          makeCell(cell, val, COLORS.nameCol, COLORS.headerText, true)
        } else if (val === "D") {
          makeCell(cell, "D", COLORS.day, "FF000000")
        } else if (val === "N") {
          makeCell(cell, "N", COLORS.night, COLORS.headerText)
        } else {
          makeCell(cell, val, COLORS.empty, "FF666666")
        }
      })
    })

    // ── Day / Night count ──────────────────────────────────────────────
    const buildCountRow = (
      label: string,
      getCount: (day: number) => number
    ) => {
      const rowData: (string | number)[] = [label]
      for (let day = 1; day <= daysInMonth; day++) rowData.push(getCount(day))
      rowData.push("", "", "")

      const row = worksheet.addRow(rowData)
      row.height = 20
      row.eachCell((cell, colIndex) => {
        const bg = label === "Day" ? COLORS.day : COLORS.night
        const textColor = label === "Day" ? "FF000000" : COLORS.headerText
        if (colIndex === 1) {
          makeCell(cell, label, COLORS.countRow, COLORS.headerText, true)
        } else {
          makeCell(cell, cell.value as number, bg, textColor)
        }
      })
    }

    buildCountRow(
      "Day",
      (day) => users.filter((u) => u.dayShifts.includes(day)).length
    )
    buildCountRow(
      "Night",
      (day) => users.filter((u) => u.nightShifts.includes(day)).length
    )

    // ── Ширина колонок ─────────────────────────────────────────────────
    worksheet.getColumn(1).width = 24
    for (let i = 2; i <= daysInMonth + 1; i++)
      worksheet.getColumn(i).width = 4.5
    worksheet.getColumn(daysInMonth + 2).width = 6
    worksheet.getColumn(daysInMonth + 3).width = 6
    worksheet.getColumn(daysInMonth + 4).width = 6

    // ── Скачать ────────────────────────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(new Blob([buffer]), `schedule_${currentMonth}.xlsx`)
  }

  return (
    <div>
      <Button>
        <CloudUpload />
        Save on Server
      </Button>
      <Button onClick={handleExcelExport}>
        <Sheet />
        Export Excel
      </Button>
      <Button>
        <FileDown />
        Export PDF
      </Button>
    </div>
  )
}

export default ExportsButtonWrapper