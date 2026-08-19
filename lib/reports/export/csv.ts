import 'server-only'
import type { ExportTable } from './shape'

function escapeCell(value: string | number): string {
  const text = String(value)
  // Quote anything that could break a row, and double any embedded quotes.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Raw data only — no borders or spacing, because CSV has no concept of either.
 * This format exists for importing into another payroll system; the styled
 * human-readable versions are XLSX and PDF.
 */
export function buildCsv(table: ExportTable): string {
  const lines: string[] = [
    [table.title].map(escapeCell).join(','),
    [table.subtitle].map(escapeCell).join(','),
    [`Generated ${table.generatedAt}`].map(escapeCell).join(','),
    '',
    table.columns.map((column) => escapeCell(column.header)).join(','),
    ...table.rows.map((row) => row.map(escapeCell).join(',')),
    table.totals.map(escapeCell).join(','),
  ]
  // BOM so Excel opens UTF-8 names (e.g. accented staff names) correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
