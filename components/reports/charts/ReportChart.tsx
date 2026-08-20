'use client'

import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartType } from '@/lib/reports/builder/spec'

/**
 * Draws a report result.
 *
 * The rules applied here are deliberate, not defaults:
 *
 *  - **Colour comes from CSS variables**, read once on mount and again when the
 *    theme changes. Recharts wants concrete colours for its SVG fills, so a
 *    bare `var(--chart-1)` silently renders black in some paths.
 *  - **The y axis starts at zero.** These are counts and hours; a truncated
 *    axis exaggerates differences that payroll decisions get made on.
 *  - **Long category labels are angled, not dropped.** Recharts hides
 *    overlapping ticks by default, which loses branches from the axis while
 *    leaving their bars — a chart that is quietly incomplete.
 *  - **A donut only appears for parts of one whole**, with small slices folded
 *    into "Other" so the ring stays readable rather than fraying into slivers.
 */
const SERIES_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6']

/** Slices below this share of the total are folded into "Other". */
const DONUT_MIN_SHARE = 0.02
const DONUT_MAX_SLICES = 8

function useThemeColours() {
  const [colours, setColours] = useState<{ series: string[]; grid: string; axis: string } | null>(
    null
  )

  useEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement)
      const value = (token: string) => styles.getPropertyValue(token).trim()
      setColours({
        series: SERIES_TOKENS.map(value),
        grid: value('--chart-grid'),
        axis: value('--chart-axis'),
      })
    }
    read()
    // next-themes toggles a class on <html>, which does not fire any event of
    // its own — so watch the attribute rather than guess when it changed.
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return colours
}

interface TooltipEntry {
  name?: string | number
  value?: string | number
  color?: string
}

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
  showSeriesName,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  valueLabel: string
  showSeriesName: boolean
}) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0)

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.name)} className="flex items-center gap-2 text-muted-foreground">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
          />
          {showSeriesName ? <span>{entry.name}</span> : null}
          <span className="ml-auto font-semibold tabular-nums text-foreground">{entry.value}</span>
        </p>
      ))}
      {payload.length > 1 ? (
        <p className="mt-1 flex gap-2 border-t border-border pt-1 font-semibold text-foreground">
          <span>Total</span>
          <span className="ml-auto tabular-nums">{Math.round(total * 10) / 10}</span>
        </p>
      ) : null}
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {valueLabel}
      </p>
    </div>
  )
}

export default function ReportChart({
  chart,
  rows,
  series,
  valueLabel,
  groupLabel,
}: {
  chart: ChartType
  rows: { group: string; [key: string]: string | number }[]
  series: string[]
  valueLabel: string
  groupLabel: string
}) {
  const colours = useThemeColours()

  // Rendered only after the colours are read, so no frame is ever painted with
  // an unresolved variable.
  if (!colours) return <div className="h-80 animate-pulse rounded-xl bg-secondary" />

  if (rows.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-border">
        <p className="text-sm text-muted-foreground">No data for this selection.</p>
      </div>
    )
  }

  const axisProps = {
    stroke: colours.axis,
    tick: { fill: colours.axis, fontSize: 11 },
    tickLine: false,
  }
  const longLabels = rows.some((row) => row.group.length > 10) && rows.length > 4
  const multiSeries = series.length > 1

  if (chart === 'donut') {
    const single = series[0]
    const totalValue = rows.reduce((sum, row) => sum + Number(row[single] ?? 0), 0)
    const keep = rows.filter(
      (row, index) =>
        index < DONUT_MAX_SLICES && Number(row[single] ?? 0) / (totalValue || 1) >= DONUT_MIN_SHARE
    )
    const remainder = totalValue - keep.reduce((sum, row) => sum + Number(row[single] ?? 0), 0)
    const slices = [
      ...keep.map((row) => ({ name: row.group, value: Number(row[single] ?? 0) })),
      ...(remainder > 0 ? [{ name: 'Other', value: Math.round(remainder * 10) / 10 }] : []),
    ]

    return (
      <ResponsiveContainer width="100%" height={340}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={1}
            stroke="none"
          >
            {slices.map((slice, index) => (
              <Cell
                key={slice.name}
                // "Other" is not a category — greying it keeps it from
                // competing with the real ones for attention.
                fill={
                  slice.name === 'Other'
                    ? colours.axis
                    : colours.series[index % colours.series.length]
                }
              />
            ))}
          </Pie>
          <Tooltip
            content={<ChartTooltip valueLabel={valueLabel} showSeriesName={false} />}
            cursor={false}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: colours.axis }}
          />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (chart === 'line') {
    return (
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: longLabels ? 64 : 8, left: 0 }}>
          <CartesianGrid stroke={colours.grid} vertical={false} />
          <XAxis
            dataKey="group"
            {...axisProps}
            interval={0}
            angle={longLabels ? -40 : 0}
            textAnchor={longLabels ? 'end' : 'middle'}
            height={longLabels ? 70 : 30}
          />
          <YAxis
            {...axisProps}
            allowDecimals={false}
            domain={[0, 'auto']}
            label={{
              value: valueLabel,
              angle: -90,
              position: 'insideLeft',
              fill: colours.axis,
              fontSize: 11,
            }}
          />
          <Tooltip
            content={<ChartTooltip valueLabel={valueLabel} showSeriesName={multiSeries} />}
            cursor={{ stroke: colours.grid }}
          />
          {multiSeries ? (
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: colours.axis }} />
          ) : null}
          {series.map((name, index) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={colours.series[index % colours.series.length]}
              strokeWidth={2}
              dot={rows.length <= 30}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: longLabels ? 64 : 8, left: 0 }}>
        <CartesianGrid stroke={colours.grid} vertical={false} />
        <XAxis
          dataKey="group"
          {...axisProps}
          interval={0}
          angle={longLabels ? -40 : 0}
          textAnchor={longLabels ? 'end' : 'middle'}
          height={longLabels ? 70 : 30}
        />
        <YAxis
          {...axisProps}
          allowDecimals={false}
          domain={[0, 'auto']}
          label={{
            value: valueLabel,
            angle: -90,
            position: 'insideLeft',
            fill: colours.axis,
            fontSize: 11,
          }}
        />
        <Tooltip
          content={<ChartTooltip valueLabel={valueLabel} showSeriesName={multiSeries} />}
          cursor={{ fill: colours.grid }}
        />
        {multiSeries ? (
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: colours.axis }} />
        ) : null}
        {series.map((name, index) => (
          <Bar
            key={name}
            dataKey={name}
            // Stacking is what makes a multi-series bar chart readable as a
            // composition; side-by-side bars at 40 branches are unreadable.
            stackId={chart === 'stacked' ? 'stack' : undefined}
            fill={colours.series[index % colours.series.length]}
            radius={chart === 'stacked' ? 0 : [4, 4, 0, 0]}
            maxBarSize={48}
            aria-label={`${name} by ${groupLabel}`}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
