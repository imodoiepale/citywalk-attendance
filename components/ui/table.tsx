import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn's Table primitives, hand-rolled to match the rest of components/ui
// (no CLI, no Radix — these are plain semantic elements, so there's nothing
// to wrap). Bordered by default: HR reads these as ledgers, not as loose text.

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => (
  <div className={cn('relative w-full overflow-x-auto', containerClassName)}>
    <table
      ref={ref}
      className={cn('w-full border-collapse caption-bottom text-sm', className)}
      {...props}
    />
  </div>
))
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }
>(({ className, sticky, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'bg-secondary/60 [&_tr]:border-b',
      // Applied to the cells, not the thead: a sticky <thead> is not honoured
      // in most browsers, whereas sticky <th> is. Opaque background, or rows
      // scroll visibly underneath it.
      sticky && '[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-secondary',
      className
    )}
    {...props}
  />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn(
      // Alternating rows: on a wide grid of numbers the eye loses its place
      // between columns without them.
      '[&_tr:last-child]:border-0 [&_tr:nth-child(even)]:bg-card-soft/60',
      className
    )}
    {...props}
  />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-secondary/60 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-border transition-colors hover:bg-accent/40 data-[state=selected]:bg-accent',
      className
    )}
    {...props}
  />
))
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-9 whitespace-nowrap border border-border px-2.5 text-left align-middle text-xs font-semibold text-foreground [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('border border-border px-2.5 py-1.5 align-middle', className)}
    {...props}
  />
))
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-3 text-xs text-muted-foreground', className)} {...props} />
))
TableCaption.displayName = 'TableCaption'

/**
 * Row-number cell. Tables here are read against printed rosters and payroll
 * runs, where "row 14" is how people point at a line out loud.
 */
const TableRowNumber = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { value: number }
>(({ className, value, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'w-10 border border-border px-2 py-1.5 text-right align-middle text-xs tabular-nums text-muted-foreground',
      className
    )}
    {...props}
  >
    {value}
  </td>
))
TableRowNumber.displayName = 'TableRowNumber'

const TableRowNumberHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, children, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    aria-label="Row number"
    className={cn(
      'h-9 w-10 border border-border px-2 text-right align-middle text-xs font-semibold text-muted-foreground',
      className
    )}
    {...props}
  >
    {children ?? '#'}
  </th>
))
TableRowNumberHead.displayName = 'TableRowNumberHead'

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableRowNumber,
  TableRowNumberHead,
}
