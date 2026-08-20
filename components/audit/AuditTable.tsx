'use client'

import { Fragment, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Bot, ChevronRight, Cpu, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { FilterMenu, TableSearch, TableTabs } from '@/components/ui/data-table-controls'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowNumber,
  TableRowNumberHead,
} from '@/components/ui/table'
import type { AuditEntry } from '@/lib/audit/queries'
import { cn } from '@/lib/utils'

const ENTITY_TABS = [
  { value: 'all', label: 'All' },
  { value: 'profile', label: 'People' },
  { value: 'role_permission', label: 'Permissions' },
  { value: 'app_settings', label: 'Settings' },
  { value: 'biometric_enrollment', label: 'Enrollments' },
  { value: 'face_enrollment', label: 'Face' },
]

const SOURCE_ICON = { user: UserRound, device: Cpu, system: Bot } as const

const PERIODS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

/** Only the keys that actually differ — a diff of everything is not a diff. */
function changedKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
}

function renderValue(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export default function AuditTable({
  entries,
  nowIso,
}: {
  entries: AuditEntry[]
  /**
   * Reference time for the period filter, taken on the server.
   *
   * Not Date.now() in the memo: calling it during render is impure, so the
   * cutoff would shift on any incidental re-render and rows could appear or
   * vanish without the filter changing.
   */
  nowIso: string
}) {
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [actors, setActors] = useState<string[]>([])
  const [period, setPeriod] = useState('30')
  const [sortDesc, setSortDesc] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  const withinPeriod = useMemo(() => {
    if (period === 'all') return entries
    const cutoff = new Date(nowIso).getTime() - Number(period) * 86_400_000
    return entries.filter((e) => new Date(e.occurredAt).getTime() >= cutoff)
  }, [entries, period, nowIso])

  const counts = useMemo(() => {
    const byEntity: Record<string, number> = { all: withinPeriod.length }
    for (const e of withinPeriod) byEntity[e.entityType] = (byEntity[e.entityType] ?? 0) + 1
    return byEntity
  }, [withinPeriod])

  const inTab = useMemo(
    () => (tab === 'all' ? withinPeriod : withinPeriod.filter((e) => e.entityType === tab)),
    [withinPeriod, tab]
  )

  const actorOptions = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of inTab) {
      const label = e.actorName ?? (e.source === 'device' ? 'Device' : 'System')
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([label, count]) => ({ value: label, label, count }))
      .sort((a, b) => b.count - a.count)
  }, [inTab])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = inTab.filter((e) => {
      if (
        needle &&
        !`${e.summary} ${e.action} ${e.actorName ?? ''} ${e.actorEmail ?? ''}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false
      }
      if (actors.length) {
        const label = e.actorName ?? (e.source === 'device' ? 'Device' : 'System')
        if (!actors.includes(label)) return false
      }
      return true
    })
    return [...filtered].sort((a, b) =>
      sortDesc ? b.occurredAt.localeCompare(a.occurredAt) : a.occurredAt.localeCompare(b.occurredAt)
    )
  }, [inTab, query, actors, sortDesc])

  return (
    <div className="space-y-3">
      <div data-tour="audit-tabs">
        <TableTabs
          active={tab}
          onChange={setTab}
          tabs={ENTITY_TABS.map((t) => ({ ...t, count: counts[t.value] ?? 0 }))}
        />
      </div>

      <div data-tour="audit-filters" className="flex flex-wrap items-center gap-2">
        <TableSearch value={query} onChange={setQuery} placeholder="Search actions or people…" />
        <Select
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          className="h-8 w-40 text-xs"
          aria-label="Period"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        <FilterMenu label="Actor" options={actorOptions} selected={actors} onChange={setActors} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {entries.length === 0
              ? 'Nothing recorded yet. Privileged actions appear here as they happen.'
              : 'No entries match these filters.'}
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="max-h-[65vh] overflow-y-auto rounded-xl border border-border">
          <TableHeader>
            <TableRow>
              <TableRowNumberHead className="sticky top-0 z-10 bg-secondary" />
              <TableHead className="sticky top-0 z-10 bg-secondary">
                <button
                  type="button"
                  onClick={() => setSortDesc((d) => !d)}
                  className="inline-flex items-center gap-1 hover:text-primary"
                >
                  When
                  {sortDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                </button>
              </TableHead>
              <TableHead className="sticky top-0 z-10 bg-secondary">Who</TableHead>
              <TableHead className="sticky top-0 z-10 bg-secondary">Action</TableHead>
              <TableHead className="sticky top-0 z-10 bg-secondary">What changed</TableHead>
              <TableHead className="sticky top-0 z-10 bg-secondary" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry, index) => {
              const Icon = SOURCE_ICON[entry.source]
              const diff = changedKeys(entry.before, entry.after)
              const isOpen = expanded === entry.id
              return (
                // The key belongs on the outermost element of the map, which is
                // the fragment — a keyed child inside an unkeyed fragment still
                // warns and defeats reconciliation.
                <Fragment key={entry.id}>
                  <TableRow>
                    <TableRowNumber value={index + 1} />
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatWhen(entry.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {/* A machine action names the machine, not a blank
                                where a person's name should be. */}
                            {entry.actorName ??
                              (entry.source === 'device' ? 'Device' : 'System')}
                          </span>
                          {entry.actorRole ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {entry.actorRole}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{entry.summary}</TableCell>
                    <TableCell>
                      {diff.length > 0 ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : entry.id)}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ChevronRight
                            className={cn(
                              'h-3 w-3 transition-transform duration-150 ease-standard',
                              isOpen && 'rotate-90'
                            )}
                          />
                          {diff.length}
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-card-soft/60 p-0">
                        <div className="px-4 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="pb-1 font-medium">Field</th>
                                <th className="pb-1 font-medium">Before</th>
                                <th className="pb-1 font-medium">After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diff.map((key) => (
                                <tr key={key}>
                                  <td className="py-0.5 pr-4 font-mono">{key}</td>
                                  <td className="py-0.5 pr-4 text-destructive">
                                    {renderValue(entry.before?.[key])}
                                  </td>
                                  <td className="py-0.5 text-success">
                                    {renderValue(entry.after?.[key])}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Showing {rows.length} of {counts[tab] ?? 0} entries. The log is append-only — entries cannot
        be edited or removed from within the app.
      </p>
    </div>
  )
}
