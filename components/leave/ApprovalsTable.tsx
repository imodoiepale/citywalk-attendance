'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  MessageSquare,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import {
  ColumnMenu,
  FilterMenu,
  RowActions,
  TableSearch,
  TableTabs,
  type ColumnToggle,
} from '@/components/ui/data-table-controls'
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
import { decideLeaveRequestAction } from '@/lib/leave/actions'
import type { LeaveRequestRecord } from '@/lib/leave/queries'
import { cn } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'secondary',
}

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
]

const COLUMNS: { id: string; label: string; locked?: boolean }[] = [
  { id: 'requester', label: 'Staff', locked: true },
  { id: 'branch', label: 'Branch' },
  { id: 'type', label: 'Type' },
  { id: 'dates', label: 'Dates' },
  { id: 'days', label: 'Days' },
  { id: 'reason', label: 'Reason' },
  { id: 'filedBy', label: 'Filed by' },
  { id: 'status', label: 'Status' },
  { id: 'decision', label: 'Decision' },
]

type SortKey = 'requester' | 'branch' | 'type' | 'dates' | 'days' | 'status'

function dayCount(startDate: string, endDate: string) {
  const ms = new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Hoisted: a component defined inside the render is a new type each pass,
 *  which remounts the header and drops focus mid-sort. */
function SortHead({
  label,
  sortKey,
  right,
  sort,
  onSort,
}: {
  label: string
  sortKey: SortKey
  right?: boolean
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
}) {
  return (
    <TableHead className={cn('sticky top-0 z-10 bg-secondary', right && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex w-full items-center gap-1 hover:text-primary', right && 'justify-end')}
      >
        {label}
        {sort.key === sortKey ? (
          sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    </TableHead>
  )
}

export default function ApprovalsTable({
  requests,
  canDecide,
}: {
  requests: LeaveRequestRecord[]
  canDecide: boolean
}) {
  const [tab, setTab] = useState('pending')
  const [query, setQuery] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'dates',
    dir: 'desc',
  })
  const [hidden, setHidden] = useState<string[]>(['filedBy'])
  const [pending, startTransition] = useTransition()
  const [decision, setDecision] = useState<{ request: LeaveRequestRecord; to: 'approved' | 'rejected' } | null>(null)
  const [note, setNote] = useState('')

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: requests.length }
    for (const r of requests) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    return byStatus
  }, [requests])

  // Filter options carry counts within the current tab, so the numbers describe
  // what clicking would actually leave rather than the whole dataset.
  const inTab = useMemo(
    () => (tab === 'all' ? requests : requests.filter((r) => r.status === tab)),
    [requests, tab]
  )

  const branchOptions = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of inTab) map.set(r.branchName ?? '—', (map.get(r.branchName ?? '—') ?? 0) + 1)
    return [...map.entries()]
      .map(([label, count]) => ({ value: label, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [inTab])

  const typeOptions = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of inTab) map.set(r.type, (map.get(r.type) ?? 0) + 1)
    return [...map.entries()]
      .map(([value, count]) => ({ value, label: value[0].toUpperCase() + value.slice(1), count }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [inTab])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = inTab.filter((r) => {
      if (needle && !`${r.requesterName} ${r.branchName} ${r.type} ${r.reason ?? ''}`.toLowerCase().includes(needle)) {
        return false
      }
      if (branches.length && !branches.includes(r.branchName ?? '—')) return false
      if (types.length && !types.includes(r.type)) return false
      return true
    })

    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'requester':
          return a.requesterName.localeCompare(b.requesterName) * dir
        case 'branch':
          return (a.branchName ?? '').localeCompare(b.branchName ?? '') * dir
        case 'type':
          return a.type.localeCompare(b.type) * dir
        case 'days':
          return (dayCount(a.startDate, a.endDate) - dayCount(b.startDate, b.endDate)) * dir
        case 'status':
          return a.status.localeCompare(b.status) * dir
        default:
          return a.startDate.localeCompare(b.startDate) * dir
      }
    })
  }, [inTab, query, branches, types, sort])

  const visible = (id: string) => !hidden.includes(id)
  const columnToggles: ColumnToggle[] = COLUMNS.map((c) => ({
    id: c.id,
    label: c.label,
    visible: visible(c.id),
    locked: c.locked,
  }))

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const submitDecision = () => {
    if (!decision) return
    const formData = new FormData()
    formData.set('id', decision.request.id)
    formData.set('decision', decision.to)
    if (note.trim()) formData.set('note', note.trim())
    startTransition(async () => {
      await decideLeaveRequestAction(formData)
      setDecision(null)
      setNote('')
    })
  }

  return (
    <div className="space-y-3">
      <div data-tour="approval-tabs">
        <TableTabs
          active={tab}
          onChange={setTab}
          tabs={TABS.map((t) => ({ ...t, count: counts[t.value] ?? 0 }))}
        />
      </div>

      <div data-tour="approval-filters" className="flex flex-wrap items-center gap-2">
        <TableSearch value={query} onChange={setQuery} placeholder="Search staff, branch or reason…" />
        <FilterMenu label="Branch" options={branchOptions} selected={branches} onChange={setBranches} />
        <FilterMenu label="Type" options={typeOptions} selected={types} onChange={setTypes} />
        <div className="ml-auto">
          <ColumnMenu
            columns={columnToggles}
            onToggle={(id, isVisible) =>
              setHidden((h) => (isVisible ? h.filter((x) => x !== id) : [...h, id]))
            }
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {counts[tab] === 0
              ? `Nothing ${tab === 'all' ? 'here' : tab} yet.`
              : 'No requests match these filters.'}
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="max-h-[65vh] overflow-y-auto rounded-xl border border-border" data-tour="approval-table">
          <TableHeader>
            <TableRow>
              <TableRowNumberHead className="sticky top-0 z-10 bg-secondary" />
              <SortHead label="Staff" sortKey="requester" sort={sort} onSort={toggleSort} />
              {visible('branch') ? <SortHead label="Branch" sortKey="branch" sort={sort} onSort={toggleSort} /> : null}
              {visible('type') ? <SortHead label="Type" sortKey="type" sort={sort} onSort={toggleSort} /> : null}
              {visible('dates') ? <SortHead label="Dates" sortKey="dates" sort={sort} onSort={toggleSort} /> : null}
              {visible('days') ? <SortHead label="Days" sortKey="days" right sort={sort} onSort={toggleSort} /> : null}
              {visible('reason') ? (
                <TableHead className="sticky top-0 z-10 bg-secondary">Reason</TableHead>
              ) : null}
              {visible('filedBy') ? (
                <TableHead className="sticky top-0 z-10 bg-secondary">Filed by</TableHead>
              ) : null}
              {visible('status') ? <SortHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} /> : null}
              {visible('decision') ? (
                <TableHead className="sticky top-0 z-10 bg-secondary">Decision</TableHead>
              ) : null}
              {canDecide ? <TableHead className="sticky top-0 z-10 bg-secondary" /> : null}
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((request, index) => (
              <TableRow key={request.id}>
                <TableRowNumber value={index + 1} />
                <TableCell className="font-medium text-foreground">{request.requesterName}</TableCell>
                {visible('branch') ? (
                  <TableCell className="text-muted-foreground">{request.branchName}</TableCell>
                ) : null}
                {visible('type') ? <TableCell className="capitalize">{request.type}</TableCell> : null}
                {visible('dates') ? (
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(request.startDate)} – {formatDate(request.endDate)}
                  </TableCell>
                ) : null}
                {visible('days') ? (
                  <TableCell className="text-right tabular-nums">
                    {dayCount(request.startDate, request.endDate)}
                  </TableCell>
                ) : null}
                {visible('reason') ? (
                  <TableCell className="max-w-56 truncate text-muted-foreground" title={request.reason ?? ''}>
                    {request.reason || '—'}
                  </TableCell>
                ) : null}
                {visible('filedBy') ? (
                  <TableCell className="text-muted-foreground">{request.filedByName}</TableCell>
                ) : null}
                {visible('status') ? (
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[request.status] ?? 'secondary'} className="capitalize">
                      {request.status}
                    </Badge>
                  </TableCell>
                ) : null}
                {visible('decision') ? (
                  <TableCell className="text-xs text-muted-foreground">
                    {request.decidedByName ? (
                      <span className="inline-flex items-center gap-1">
                        {request.decidedByName}
                        {request.decisionNote ? (
                          <MessageSquare className="h-3 w-3" aria-label={request.decisionNote} />
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                ) : null}
                {canDecide ? (
                  <TableCell>
                    {request.status === 'pending' ? (
                      <RowActions
                        actions={[
                          {
                            label: 'Approve',
                            icon: Check,
                            onSelect: () => {
                              setNote('')
                              setDecision({ request, to: 'approved' })
                            },
                          },
                          {
                            label: 'Reject',
                            icon: X,
                            destructive: true,
                            onSelect: () => {
                              setNote('')
                              setDecision({ request, to: 'rejected' })
                            },
                          },
                        ]}
                      />
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Showing {rows.length} of {counts[tab] ?? 0}
        {tab === 'all' ? '' : ` ${tab}`} request{rows.length === 1 ? '' : 's'}.
      </p>

      <ConfirmDialog
        open={decision !== null}
        title={decision?.to === 'approved' ? 'Approve this leave?' : 'Reject this leave?'}
        description={
          decision
            ? `${decision.request.requesterName} — ${decision.request.type} leave, ${formatDate(decision.request.startDate)} to ${formatDate(decision.request.endDate)}. They'll be told the next time they open the app.`
            : undefined
        }
        confirmVariant={decision?.to === 'approved' ? 'default' : 'destructive'}
        isPending={pending}
        onCancel={() => setDecision(null)}
        confirmSlot={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note (optional)"
              className="h-9 text-xs sm:w-48"
            />
            <Button
              variant={decision?.to === 'approved' ? 'default' : 'destructive'}
              onClick={submitDecision}
              disabled={pending}
            >
              {pending ? 'Saving…' : decision?.to === 'approved' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        }
      />
    </div>
  )
}
