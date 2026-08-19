import { getCurrentUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { loadTimesheet, type GroupBy } from '@/lib/reports/timesheets'
import { isPeriodPreset, resolvePeriod } from '@/lib/reports/periods'
import { buildExportTable, exportFileStem } from '@/lib/reports/export/shape'
import { buildCsv } from '@/lib/reports/export/csv'
import { buildXlsx } from '@/lib/reports/export/xlsx'
import { buildPdf } from '@/lib/reports/export/pdf'
import { createClient } from '@/lib/supabase/server'

// Export rights ride on the existing report.view.* permissions rather than a
// new one: report.view.org means every branch, report.view.branch means your
// own. RLS enforces the same scope on the underlying rows, so a hand-crafted
// ?branch= for someone else's branch returns nothing rather than leaking.

export const dynamic = 'force-dynamic'

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const

type Format = keyof typeof CONTENT_TYPES

function isFormat(value: string | null): value is Format {
  return value === 'csv' || value === 'xlsx' || value === 'pdf'
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || !user.isActive) {
    return new Response('Unauthorized', { status: 401 })
  }

  const orgWide = canAtLeast(user.permissions, user.role, 'report.view.org', 'org')
  const branchScoped = canAtLeast(user.permissions, user.role, 'report.view.branch', 'branch')
  if (!orgWide && !branchScoped) {
    return new Response('Forbidden', { status: 403 })
  }

  const params = new URL(request.url).searchParams

  const format = params.get('format')
  if (!isFormat(format)) {
    return new Response('Unsupported format. Use csv, xlsx or pdf.', { status: 400 })
  }

  const preset = params.get('period') ?? 'this-month'
  const { from, to, label: periodLabel } = resolvePeriod(
    isPeriodPreset(preset) ? preset : 'this-month',
    { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }
  )

  const groupBy: GroupBy = params.get('groupBy') === 'name' ? 'name' : 'branch'

  // "All branches" is only honoured for org-wide viewers; everyone else is
  // pinned to their own branch no matter what the query string asks for.
  const requestedBranch = params.get('branch')
  const branchId = orgWide ? (requestedBranch && requestedBranch !== 'all' ? requestedBranch : null) : user.branchId

  let branchLabel = 'All branches'
  if (branchId) {
    const supabase = await createClient()
    const { data } = await supabase.from('branches').select('name').eq('id', branchId).maybeSingle()
    branchLabel = data?.name ?? user.branchName
  }

  const timesheet = await loadTimesheet({ branchId, from, to, groupBy, branchLabel })
  const table = buildExportTable(timesheet)
  table.subtitle = `${branchLabel} · ${periodLabel} · grouped by ${groupBy}`

  const stem = exportFileStem(timesheet)

  let body: Buffer | string
  if (format === 'csv') body = buildCsv(table)
  else if (format === 'xlsx') body = await buildXlsx(table)
  else body = await buildPdf(table)

  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${stem}.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
}
