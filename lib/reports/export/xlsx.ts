import 'server-only'
import ExcelJS from 'exceljs'
import type { ExportTable } from './shape'

const GOLD = 'FFAB8704'
const INK = 'FF0B0D10'
const SUBTLE = 'FFF3F1EA'

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: 'FFB9B9B9' } }
  return { top: side, left: side, bottom: side, right: side }
}

/**
 * A styled workbook, not a CSV with a different extension: title block, frozen
 * header, borders on every cell, auto-fitted columns, branch group headings and
 * a bold totals row. This is the file Accounts actually opens.
 */
export async function buildXlsx(table: ExportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Citywalk Attendance'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Timesheet', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const columnCount = table.columns.length
  sheet.columns = table.columns.map((column) => ({
    key: column.key,
    width: Math.max(column.width, column.header.length + 2),
  }))

  // --- Title block -------------------------------------------------------
  const titleRow = sheet.addRow([table.title])
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount)
  titleRow.height = 24
  titleRow.getCell(1).font = { size: 14, bold: true, color: { argb: INK } }
  titleRow.getCell(1).alignment = { vertical: 'middle' }

  const subtitleRow = sheet.addRow([table.subtitle])
  sheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, columnCount)
  subtitleRow.getCell(1).font = { size: 10, color: { argb: 'FF6B6B6B' } }

  const generatedRow = sheet.addRow([`Generated ${table.generatedAt}`])
  sheet.mergeCells(generatedRow.number, 1, generatedRow.number, columnCount)
  generatedRow.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF8A8A8A' } }

  sheet.addRow([])

  // --- Header ------------------------------------------------------------
  const headerRow = sheet.addRow(table.columns.map((column) => column.header))
  headerRow.height = 20
  headerRow.eachCell((cell, columnNumber) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
    cell.border = thinBorder()
    cell.alignment = {
      horizontal: table.columns[columnNumber - 1]?.align ?? 'left',
      vertical: 'middle',
      wrapText: true,
    }
  })

  // --- Body --------------------------------------------------------------
  const groupBreakByIndex = new Map(table.groupBreaks.map((brk) => [brk.index, brk.label]))

  table.rows.forEach((cells, index) => {
    const groupLabel = groupBreakByIndex.get(index)
    if (groupLabel) {
      const groupRow = sheet.addRow([groupLabel])
      sheet.mergeCells(groupRow.number, 1, groupRow.number, columnCount)
      const cell = groupRow.getCell(1)
      cell.font = { bold: true, size: 10, color: { argb: INK } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE } }
      cell.border = thinBorder()
    }

    const row = sheet.addRow(cells)
    row.eachCell((cell, columnNumber) => {
      const column = table.columns[columnNumber - 1]
      cell.border = thinBorder()
      cell.alignment = { horizontal: column?.align ?? 'left', vertical: 'middle' }
      if (column?.numeric) {
        // Whole counts stay integers; hours get one decimal.
        cell.numFmt = column.key === 'daysWorked' ? '0' : '0.0'
      }
    })
  })

  // --- Totals ------------------------------------------------------------
  const totalsRow = sheet.addRow(table.totals)
  totalsRow.eachCell((cell, columnNumber) => {
    const column = table.columns[columnNumber - 1]
    cell.font = { bold: true, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTLE } }
    cell.border = { ...thinBorder(), top: { style: 'double', color: { argb: 'FF8A8A8A' } } }
    cell.alignment = { horizontal: column?.align ?? 'left' }
    if (column?.numeric) cell.numFmt = column.key === 'daysWorked' ? '0' : '0.0'
  })

  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: columnCount },
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
