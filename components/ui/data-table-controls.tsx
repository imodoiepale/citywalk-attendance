'use client'

import * as React from 'react'
import { Check, ChevronDown, Columns3, Filter, MoreHorizontal, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Shared toolbar parts for the data tables: a filter popover that shows how
// many rows each option would leave, a column-visibility popover, a row-action
// menu, and tabs that carry their own counts.
//
// Counts are the point. A filter list without them makes you click each option
// to discover it is empty; with them the table tells you where the work is
// before you touch it.

/** Closes a popover on outside click and Escape. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])
  return ref
}

function Popover({
  label,
  icon: Icon,
  badge,
  children,
  align = 'start',
}: {
  label: string
  icon: typeof Filter
  badge?: number
  children: React.ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = React.useState(false)
  const ref = useDismiss(open, React.useCallback(() => setOpen(false), []))

  return (
    <div ref={ref} className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Icon className="h-3.5 w-3.5" />
        {label}
        {badge ? (
          <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {badge}
          </span>
        ) : null}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </Button>
      {open ? (
        <div
          className={cn(
            'absolute z-40 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-card-hover',
            align === 'end' ? 'right-0' : 'left-0'
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export interface FilterOption {
  value: string
  label: string
  count: number
}

/** Multi-select filter with per-option row counts. */
export function FilterMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <Popover label={label} icon={Filter} badge={selected.length}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-primary hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
      {options.map((option) => {
        const isOn = selected.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 ease-standard hover:bg-card-hover"
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong'
              )}
            >
              {isOn ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
              {option.count}
            </span>
          </button>
        )
      })}
    </Popover>
  )
}

export interface ColumnToggle {
  id: string
  label: string
  visible: boolean
  /** Columns the table cannot render without. */
  locked?: boolean
}

export function ColumnMenu({
  columns,
  onToggle,
}: {
  columns: ColumnToggle[]
  onToggle: (id: string, visible: boolean) => void
}) {
  const hidden = columns.filter((c) => !c.visible).length
  return (
    <Popover label="Columns" icon={Columns3} badge={hidden} align="end">
      {columns.map((column) => (
        <button
          key={column.id}
          type="button"
          disabled={column.locked}
          onClick={() => onToggle(column.id, !column.visible)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 ease-standard hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
              column.visible
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border-strong'
            )}
          >
            {column.visible ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
          </span>
          <span className="min-w-0 flex-1 truncate">{column.label}</span>
        </button>
      ))}
    </Popover>
  )
}

export function TableSearch({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 text-xs"
      />
    </div>
  )
}

export interface RowAction {
  label: string
  icon?: typeof MoreHorizontal
  onSelect: () => void
  /** Renders in the destructive tone and sits below a divider. */
  destructive?: boolean
  disabled?: boolean
}

export function RowActions({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = React.useState(false)
  const ref = useDismiss(open, React.useCallback(() => setOpen(false), []))

  const normal = actions.filter((a) => !a.destructive)
  const destructive = actions.filter((a) => a.destructive)

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-40 w-44 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-card-hover"
        >
          {[normal, destructive].map((group, groupIndex) =>
            group.length === 0 ? null : (
              <div
                key={groupIndex}
                className={groupIndex === 1 ? 'mt-1 border-t border-border pt-1' : undefined}
              >
                {group.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    onClick={() => {
                      setOpen(false)
                      action.onSelect()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 ease-standard disabled:cursor-not-allowed disabled:opacity-40',
                      action.destructive
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'text-muted-foreground hover:bg-card-hover hover:text-foreground'
                    )}
                  >
                    {action.icon ? <action.icon className="h-3.5 w-3.5" /> : null}
                    {action.label}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}

export interface TableTab {
  value: string
  label: string
  count: number
}

export function TableTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TableTab[]
  active: string
  onChange: (value: string) => void
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === active
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ease-standard',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              )}
            >
              {tab.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
