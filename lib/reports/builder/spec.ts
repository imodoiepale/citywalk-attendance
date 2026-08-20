// What a custom report *is*, independent of how it is loaded or drawn.
//
// The spec is the single description shared by the URL, the toolbar, the
// loaders and the charts. Keeping it in one client-safe module is what stops
// the three from drifting: the toolbar can only offer dimensions the dataset
// declares, and the loader can only be asked for combinations the toolbar can
// produce. An unrepresentable report is better than one that renders a wrong
// number.

import type { Granularity } from '@/lib/reports/grouping'

/** A dimension to group rows by. Time dimensions map onto `Granularity`. */
export type Dimension =
  | 'branch'
  | 'staff'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'type'
  | 'status'
  | 'health'
  | 'purpose'
  | 'action'
  | 'entity'
  | 'actor'
  | 'source'

export const DIMENSION_LABELS: Record<Dimension, string> = {
  branch: 'Branch',
  staff: 'Staff member',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
  type: 'Leave type',
  status: 'Status',
  health: 'Device health',
  purpose: 'Device purpose',
  action: 'Action',
  entity: 'Entity type',
  actor: 'Actor',
  source: 'Source',
}

const TIME_DIMENSIONS = ['day', 'week', 'month', 'quarter', 'year'] as const

export function isTimeDimension(dimension: Dimension): dimension is Granularity {
  return (TIME_DIMENSIONS as readonly string[]).includes(dimension)
}

export type DatasetId = 'hours' | 'leave' | 'corrections' | 'devices' | 'audit'

export type ChartType = 'bar' | 'line' | 'stacked' | 'donut' | 'table'

export const CHART_LABELS: Record<ChartType, string> = {
  bar: 'Bar',
  line: 'Line',
  stacked: 'Stacked bar',
  donut: 'Donut',
  table: 'Table',
}

export interface DatasetMeta {
  id: DatasetId
  label: string
  /** What one unit of the measure is, e.g. "Hours". Used for the axis label. */
  valueLabel: string
  description: string
  dimensions: Dimension[]
  /** Dimensions usable as the second (stacking) dimension. */
  splits: Dimension[]
  /** Whether the period filter applies. Device state is current, not historic. */
  periodFiltered: boolean
}

export const DATASETS: Record<DatasetId, DatasetMeta> = {
  hours: {
    id: 'hours',
    label: 'Hours worked',
    valueLabel: 'Hours',
    description: 'Time on the clock, from punches.',
    dimensions: ['branch', 'staff', 'day', 'week', 'month', 'quarter', 'year'],
    splits: ['branch'],
    periodFiltered: true,
  },
  leave: {
    id: 'leave',
    label: 'Leave requests',
    valueLabel: 'Requests',
    description: 'Leave filed in the period, by its start date.',
    dimensions: ['branch', 'type', 'status', 'staff', 'day', 'week', 'month', 'quarter', 'year'],
    splits: ['type', 'status', 'branch'],
    periodFiltered: true,
  },
  corrections: {
    id: 'corrections',
    label: 'Punch corrections',
    valueLabel: 'Corrections',
    description: 'Requests to amend a recorded shift.',
    dimensions: ['branch', 'status', 'staff', 'day', 'week', 'month', 'quarter', 'year'],
    splits: ['status', 'branch'],
    periodFiltered: true,
  },
  devices: {
    id: 'devices',
    label: 'Devices',
    valueLabel: 'Devices',
    // Not period-filtered: a device is online or offline *now*. Showing a
    // date range beside it would imply a history the table does not keep.
    description: 'Current state of the reader estate.',
    dimensions: ['health', 'purpose', 'branch'],
    splits: ['health', 'purpose'],
    periodFiltered: false,
  },
  audit: {
    id: 'audit',
    label: 'Audit activity',
    valueLabel: 'Entries',
    description: 'Privileged actions recorded in the audit log.',
    dimensions: ['action', 'entity', 'actor', 'source', 'day', 'week', 'month', 'quarter', 'year'],
    splits: ['source', 'entity'],
    periodFiltered: true,
  },
}

export const DATASET_LIST = Object.values(DATASETS)

export interface ReportSpec {
  dataset: DatasetId
  groupBy: Dimension
  /** Only meaningful for a stacked chart; ignored otherwise. */
  splitBy: Dimension | null
  chart: ChartType
  branchId: string | null
}

function isDataset(value: string | undefined): value is DatasetId {
  return value !== undefined && value in DATASETS
}

function isChart(value: string | undefined): value is ChartType {
  return value !== undefined && value in CHART_LABELS
}

/**
 * Builds a valid spec from arbitrary query parameters.
 *
 * Every field falls back rather than throwing, and — importantly — a dimension
 * the chosen dataset does not offer is replaced with one it does. A URL can be
 * edited, shared, or left in a bookmark across a release that removed a
 * dimension, and none of those should produce a broken page or, worse, a chart
 * grouped by something the loader quietly ignored.
 */
export function parseSpec(params: Record<string, string | undefined>): ReportSpec {
  const dataset: DatasetId = isDataset(params.dataset) ? params.dataset : 'hours'
  const meta = DATASETS[dataset]

  const requested = params.groupBy as Dimension | undefined
  const groupBy: Dimension =
    requested && meta.dimensions.includes(requested) ? requested : meta.dimensions[0]

  const chart: ChartType = isChart(params.chart) ? params.chart : 'bar'

  // A line needs something ordered along the x axis. Grouping a line by branch
  // would draw a trend through categories that have no order — a chart that
  // invites a conclusion the data cannot support.
  const resolvedChart: ChartType = chart === 'line' && !isTimeDimension(groupBy) ? 'bar' : chart

  const requestedSplit = params.splitBy as Dimension | undefined
  const splitBy =
    resolvedChart === 'stacked' &&
    requestedSplit &&
    meta.splits.includes(requestedSplit) &&
    requestedSplit !== groupBy
      ? requestedSplit
      : resolvedChart === 'stacked'
        ? (meta.splits.find((d) => d !== groupBy) ?? null)
        : null

  return {
    dataset,
    groupBy,
    splitBy,
    chart: resolvedChart,
    branchId: params.branch && params.branch !== 'all' ? params.branch : null,
  }
}

/** Serialises a spec back to query parameters, omitting anything at its default. */
export function specToParams(spec: ReportSpec): Record<string, string> {
  const params: Record<string, string> = {
    dataset: spec.dataset,
    groupBy: spec.groupBy,
    chart: spec.chart,
  }
  if (spec.splitBy) params.splitBy = spec.splitBy
  if (spec.branchId) params.branch = spec.branchId
  return params
}
