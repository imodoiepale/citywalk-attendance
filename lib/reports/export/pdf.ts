import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { ExportTable } from './shape'

// pdf-lib rather than pdfkit/react-pdf: it is pure JS with no font files or
// native deps to bundle, which matters for a Next server route. Tables aren't
// built in — we lay out and stroke the grid ourselves, which is why the column
// widths from ExportColumn.width are load-bearing here.

const GOLD = rgb(0.67, 0.53, 0.02)
const INK = rgb(0.04, 0.05, 0.06)
const GRID = rgb(0.72, 0.72, 0.72)
const BAND = rgb(0.95, 0.945, 0.92)
const MUTED = rgb(0.42, 0.42, 0.42)

const PAGE = { width: 841.89, height: 595.28 } // A4 landscape
const MARGIN = 28
const ROW_HEIGHT = 16
const HEADER_HEIGHT = 20
const FONT_SIZE = 7.5

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let result = text
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}…`
}

export async function buildPdf(table: ExportTable): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.setTitle(table.title)
  doc.setCreator('Citywalk Attendance')

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  // Scale the declared character widths to fill the printable area exactly, so
  // the grid always meets the right margin regardless of how many day columns
  // the chosen period produced.
  const printable = PAGE.width - MARGIN * 2
  const declared = table.columns.reduce((sum, column) => sum + column.width, 0)
  const scale = printable / declared
  const widths = table.columns.map((column) => column.width * scale)
  const offsets = widths.reduce<number[]>((acc, width, index) => {
    acc.push(index === 0 ? MARGIN : acc[index - 1] + widths[index - 1])
    return acc
  }, [])

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height])
  let y = 0

  const drawCells = (
    cells: (string | number)[],
    top: number,
    opts: { font: PDFFont; background?: ReturnType<typeof rgb>; color?: ReturnType<typeof rgb> }
  ) => {
    const height = ROW_HEIGHT
    if (opts.background) {
      page.drawRectangle({
        x: MARGIN,
        y: top - height,
        width: printable,
        height,
        color: opts.background,
      })
    }
    table.columns.forEach((column, index) => {
      page.drawRectangle({
        x: offsets[index],
        y: top - height,
        width: widths[index],
        height,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      const text = truncate(String(cells[index] ?? ''), opts.font, FONT_SIZE, widths[index] - 6)
      const textWidth = opts.font.widthOfTextAtSize(text, FONT_SIZE)
      const x =
        column.align === 'right'
          ? offsets[index] + widths[index] - 3 - textWidth
          : offsets[index] + 3
      page.drawText(text, {
        x,
        y: top - height + 5,
        size: FONT_SIZE,
        font: opts.font,
        color: opts.color ?? INK,
      })
    })
    return top - height
  }

  const drawColumnHeader = () => {
    page.drawRectangle({
      x: MARGIN,
      y: y - HEADER_HEIGHT,
      width: printable,
      height: HEADER_HEIGHT,
      color: GOLD,
    })
    table.columns.forEach((column, index) => {
      page.drawRectangle({
        x: offsets[index],
        y: y - HEADER_HEIGHT,
        width: widths[index],
        height: HEADER_HEIGHT,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      const text = truncate(column.header, bold, FONT_SIZE, widths[index] - 6)
      const textWidth = bold.widthOfTextAtSize(text, FONT_SIZE)
      const x =
        column.align === 'right'
          ? offsets[index] + widths[index] - 3 - textWidth
          : offsets[index] + 3
      page.drawText(text, {
        x,
        y: y - HEADER_HEIGHT + 6.5,
        size: FONT_SIZE,
        font: bold,
        color: rgb(1, 1, 1),
      })
    })
    y -= HEADER_HEIGHT
  }

  const startPage = (withTitle: boolean) => {
    y = PAGE.height - MARGIN
    if (withTitle) {
      page.drawText(table.title, { x: MARGIN, y: y - 14, size: 14, font: bold, color: INK })
      page.drawText(table.subtitle, { x: MARGIN, y: y - 28, size: 8.5, font, color: MUTED })
      page.drawText(`Generated ${table.generatedAt}`, {
        x: MARGIN,
        y: y - 40,
        size: 7.5,
        font,
        color: MUTED,
      })
      y -= 52
    }
    drawColumnHeader()
  }

  startPage(true)

  const groupBreakByIndex = new Map(table.groupBreaks.map((brk) => [brk.index, brk.label]))
  // Leave room for the totals row plus the footer line.
  const floor = MARGIN + ROW_HEIGHT + 16

  table.rows.forEach((cells, index) => {
    if (y - ROW_HEIGHT < floor) {
      page = doc.addPage([PAGE.width, PAGE.height])
      startPage(false)
    }

    const groupLabel = groupBreakByIndex.get(index)
    if (groupLabel) {
      page.drawRectangle({
        x: MARGIN,
        y: y - ROW_HEIGHT,
        width: printable,
        height: ROW_HEIGHT,
        color: BAND,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      page.drawText(groupLabel, {
        x: MARGIN + 4,
        y: y - ROW_HEIGHT + 5,
        size: FONT_SIZE,
        font: bold,
        color: INK,
      })
      y -= ROW_HEIGHT
    }

    y = drawCells(cells, y, {
      font,
      background: index % 2 === 1 ? rgb(0.98, 0.98, 0.97) : undefined,
    })
  })

  if (y - ROW_HEIGHT < MARGIN) {
    page = doc.addPage([PAGE.width, PAGE.height])
    startPage(false)
  }
  y = drawCells(table.totals, y, { font: bold, background: BAND })

  // Page numbers, added once the total count is known.
  const pages = doc.getPages()
  pages.forEach((current, index) => {
    current.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: PAGE.width - MARGIN - 60,
      y: MARGIN - 12,
      size: 7,
      font,
      color: MUTED,
    })
  })

  return Buffer.from(await doc.save())
}
