import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { toNairobiDateKey } from '@/lib/timezone'
import { groupKeysFor, type Granularity } from '@/lib/reports/grouping'
import { listDevices } from '@/lib/biometric/queries'
import {
  DATASETS,
  isTimeDimension,
  type Dimension,
  type ReportSpec,
} from '@/lib/reports/builder/spec'

/**
 * The most rows any one report will read.
 *
 * `loadAttendanceAnalytics` used to carry a bare `.limit(10000)` with nothing
 * shown to the reader — a report that quietly dropped the 10,001st punch and
 * still presented its total as the answer. A cap is fine; a *silent* cap turns
 * a wrong number into a confident one. So the value is named here, returned
 * alongside every result, and surfaced on the page when it bites.
 */
export const ROW_CAP = 20000

/**
 * One record before grouping. Every dataset flattens into this shape so a
 * single aggregator can serve all of them, and so adding a dimension is a
 * change in one place rather than five.
 */
interface Fact {
  /** Nairobi calendar day, or null for datasets with no meaningful date. */
  dateKey: string | null
  value: number
  branch: string
  staff: string
  type: string
  status: string
  health: string
  purpose: string
  action: string
  entity: string
  actor: string
  source: string
}

const EMPTY: Omit<Fact, 'value'> = {
  dateKey: null,
  branch: 'Unknown',
  staff: 'Unknown',
  type: '—',
  status: '—',
  health: '—',
  purpose: '—',
  action: '—',
  entity: '—',
  actor: '—',
  source: '—',
}

type Embed<T> = T | T[] | null
const one = <T>(embed: Embed<T>): T | null => (Array.isArray(embed) ? (embed[0] ?? null) : embed)

export interface BuilderResult {
  /** Group label, then one numeric entry per split series. */
  rows: { group: string; [series: string]: string | number }[]
  /** Series names present in `rows`, in draw order. */
  series: string[]
  total: number
  valueLabel: string
  truncated: boolean
  cap: number
}

/** Maps a fact onto its bucket label for a given dimension. */
function facetOf(fact: Fact, dimension: Dimension, timeLabels: Map<string, string>): string {
  if (isTimeDimension(dimension)) {
    return fact.dateKey ? (timeLabels.get(fact.dateKey) ?? fact.dateKey) : '—'
  }
  switch (dimension) {
    case 'branch':
      return fact.branch
    case 'staff':
      return fact.staff
    case 'type':
      return fact.type
    case 'status':
      return fact.status
    case 'health':
      return fact.health
    case 'purpose':
      return fact.purpose
    case 'action':
      return fact.action
    case 'entity':
      return fact.entity
    case 'actor':
      return fact.actor
    case 'source':
      return fact.source
  }
}

async function loadFacts(
  spec: ReportSpec,
  range: { from: string; to: string }
): Promise<{ facts: Fact[]; truncated: boolean }> {
  const supabase = await createClient()

  switch (spec.dataset) {
    case 'hours': {
      let query = supabase
        .from('punches')
        .select(
          'user_id, branch_id, clock_in_at, clock_out_at, branch:branches!punches_branch_id_fkey(name), staff:profiles!punches_user_id_fkey(full_name)'
        )
        .gte('clock_in_at', range.from)
        .lt('clock_in_at', range.to)
        .limit(ROW_CAP)
      if (spec.branchId) query = query.eq('branch_id', spec.branchId)
      const { data } = await query
      const rows = (data ?? []) as unknown as {
        clock_in_at: string
        clock_out_at: string | null
        branch: Embed<{ name: string }>
        staff: Embed<{ full_name: string }>
      }[]
      return {
        truncated: rows.length >= ROW_CAP,
        facts: rows.map((row) => {
          // An open shift is measured to now, matching what the dial shows the
          // person standing at the clock.
          const end = row.clock_out_at ? new Date(row.clock_out_at).getTime() : Date.now()
          return {
            ...EMPTY,
            dateKey: toNairobiDateKey(row.clock_in_at),
            value: Math.max(0, (end - new Date(row.clock_in_at).getTime()) / 3_600_000),
            branch: one(row.branch)?.name ?? 'Unknown',
            staff: one(row.staff)?.full_name ?? 'Unknown',
          }
        }),
      }
    }

    case 'leave': {
      let query = supabase
        .from('leave_requests')
        .select(
          'type, status, start_date, branch:branches!leave_requests_branch_id_fkey(name), staff:profiles!leave_requests_requester_id_fkey(full_name)'
        )
        .gte('start_date', range.from.slice(0, 10))
        .lt('start_date', range.to.slice(0, 10))
        .limit(ROW_CAP)
      if (spec.branchId) query = query.eq('branch_id', spec.branchId)
      const { data } = await query
      const rows = (data ?? []) as unknown as {
        type: string
        status: string
        start_date: string
        branch: Embed<{ name: string }>
        staff: Embed<{ full_name: string }>
      }[]
      return {
        truncated: rows.length >= ROW_CAP,
        facts: rows.map((row) => ({
          ...EMPTY,
          dateKey: row.start_date,
          value: 1,
          branch: one(row.branch)?.name ?? 'Unknown',
          staff: one(row.staff)?.full_name ?? 'Unknown',
          type: row.type,
          status: row.status,
        })),
      }
    }

    case 'corrections': {
      let query = supabase
        .from('punch_corrections')
        .select(
          'status, created_at, branch:branches!punch_corrections_branch_id_fkey(name), staff:profiles!punch_corrections_user_id_fkey(full_name)'
        )
        .gte('created_at', range.from)
        .lt('created_at', range.to)
        .limit(ROW_CAP)
      if (spec.branchId) query = query.eq('branch_id', spec.branchId)
      const { data } = await query
      const rows = (data ?? []) as unknown as {
        status: string
        created_at: string
        branch: Embed<{ name: string }>
        staff: Embed<{ full_name: string }>
      }[]
      return {
        truncated: rows.length >= ROW_CAP,
        facts: rows.map((row) => ({
          ...EMPTY,
          dateKey: toNairobiDateKey(row.created_at),
          value: 1,
          branch: one(row.branch)?.name ?? 'Unknown',
          staff: one(row.staff)?.full_name ?? 'Unknown',
          status: row.status,
        })),
      }
    }

    case 'audit': {
      const { data } = await supabase
        .from('audit_log')
        .select('occurred_at, source, action, entity_type, actor_name')
        .gte('occurred_at', range.from)
        .lt('occurred_at', range.to)
        .limit(ROW_CAP)
      const rows = (data ?? []) as unknown as {
        occurred_at: string
        source: string
        action: string
        entity_type: string
        actor_name: string | null
      }[]
      return {
        truncated: rows.length >= ROW_CAP,
        facts: rows.map((row) => ({
          ...EMPTY,
          dateKey: toNairobiDateKey(row.occurred_at),
          value: 1,
          action: row.action,
          entity: row.entity_type,
          // A device-sourced entry legitimately has no person behind it;
          // labelling that "Unknown" would read as missing data.
          actor: row.actor_name ?? (row.source === 'user' ? 'Unknown' : 'System'),
          source: row.source,
        })),
      }
    }

    case 'devices': {
      const devices = await listDevices()
      const scoped = spec.branchId ? devices.filter((d) => d.branchId === spec.branchId) : devices
      return {
        truncated: false,
        facts: scoped.map((device) => ({
          ...EMPTY,
          value: 1,
          branch: device.branchName ?? 'Unassigned',
          health: device.health.replace('_', ' '),
          purpose: device.purpose,
        })),
      }
    }
  }
}

/**
 * Runs a report spec and returns chart-ready rows.
 *
 * Grouping happens here rather than in SQL so that every dataset shares one
 * aggregation path — including the time buckets, which reuse the same
 * `groupKeysFor` the timesheet uses. Two implementations of "what is a week"
 * is exactly how two screens end up disagreeing about the same period.
 */
export async function runReport(
  spec: ReportSpec,
  range: { from: string; to: string }
): Promise<BuilderResult> {
  const meta = DATASETS[spec.dataset]
  const { facts, truncated } = await loadFacts(spec, range)

  // Time labels come from the shared bucketer, so a "week" here is the same
  // Monday-first week the timesheet draws.
  const timeLabels = new Map<string, string>()
  const timeOrder = new Map<string, number>()
  const timeDimension = [spec.groupBy, spec.splitBy].find(
    (d): d is Granularity => d !== null && isTimeDimension(d)
  )
  if (timeDimension) {
    const dateKeys = [...new Set(facts.map((f) => f.dateKey).filter((k): k is string => !!k))]
    groupKeysFor(dateKeys, timeDimension).forEach((bucket, index) => {
      for (const key of bucket.dateKeys) {
        timeLabels.set(key, bucket.title)
        timeOrder.set(key, index)
      }
    })
  }

  const groups = new Map<string, Map<string, number>>()
  const seriesTotals = new Map<string, number>()
  const groupSort = new Map<string, number>()
  let total = 0

  for (const fact of facts) {
    const group = facetOf(fact, spec.groupBy, timeLabels)
    const series = spec.splitBy ? facetOf(fact, spec.splitBy, timeLabels) : meta.valueLabel

    if (!groups.has(group)) groups.set(group, new Map())
    const bucket = groups.get(group)!
    bucket.set(series, (bucket.get(series) ?? 0) + fact.value)
    seriesTotals.set(series, (seriesTotals.get(series) ?? 0) + fact.value)
    total += fact.value

    if (isTimeDimension(spec.groupBy) && fact.dateKey) {
      groupSort.set(group, timeOrder.get(fact.dateKey) ?? 0)
    }
  }

  // Time reads left-to-right; every other dimension is a ranking, so the
  // largest bar goes first and the eye lands on what matters.
  const orderedGroups = [...groups.keys()].sort((a, b) => {
    if (isTimeDimension(spec.groupBy)) return (groupSort.get(a) ?? 0) - (groupSort.get(b) ?? 0)
    const sum = (g: string) => [...groups.get(g)!.values()].reduce((x, y) => x + y, 0)
    return sum(b) - sum(a)
  })

  const series = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)

  const rows = orderedGroups.map((group) => {
    const bucket = groups.get(group)!
    const row: { group: string; [key: string]: string | number } = { group }
    for (const name of series) row[name] = round(bucket.get(name) ?? 0)
    return row
  })

  return { rows, series, total: round(total), valueLabel: meta.valueLabel, truncated, cap: ROW_CAP }
}

/** Hours carry one decimal; counts are whole. Rounding once here keeps the
 * chart, the legend and the table from disagreeing in the last digit. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}
