import type { NormalizedEvent } from './types.ts'
import type { Forwarder } from './forward.ts'
import type { DestinationConfig, DestinationFilter, DestinationStatus } from './destinations/types.ts'
import { log } from './log.ts'

// Fan-out across independent destinations.
//
// The contract the server depends on is small — submit these events somewhere
// durable — so Fanout deliberately presents the same surface a single Forwarder
// does. That is what lets the server, the tests and /status stay unchanged
// whether there is one destination or ten.

export interface EventTarget {
  submit(events: NormalizedEvent[]): void
  readonly pending: number
  readonly lastSuccessAt: string | null
  readonly lastErrorAt: string | null
  readonly lastError: string | null
  readonly totals: { forwarded: number; batches: number; failures: number; dropped: number }
  /** Present only on a Fanout. Absent on a bare Forwarder. */
  destinations?(): DestinationStatus[]
}

export interface DestinationRuntime {
  config: DestinationConfig
  forwarder: Forwarder<NormalizedEvent>
}

/** Which branch a serial belongs to, from devices.yaml. Null when unknown. */
export type BranchLookup = (serial: string) => string | null

/**
 * Does this destination want this scan?
 *
 * An absent filter means everything, which is the right default: a destination
 * someone bothered to configure should receive scans unless they said otherwise.
 * Filtering happens here rather than in the sink so that a filtered-out scan
 * never touches that destination's spool at all.
 */
export function matches(
  filter: DestinationFilter | undefined,
  event: NormalizedEvent,
  branchOf: BranchLookup
): boolean {
  if (!filter) return true

  if (filter.serials && !filter.serials.includes(event.deviceSerial)) return false

  if (filter.directions) {
    // A scan whose direction the firmware did not report is deliberately NOT
    // filtered out: the app resolves it from the device row later, so dropping
    // it here would silently lose punches from readers that report nothing.
    if (event.direction !== null && !filter.directions.includes(event.direction)) return false
  }

  if (filter.branches) {
    const branch = branchOf(event.deviceSerial)
    if (branch === null || !filter.branches.includes(branch)) return false
  }

  return true
}

export class Fanout implements EventTarget {
  private readonly dests: DestinationRuntime[]
  private readonly branchOf: BranchLookup

  constructor(dests: DestinationRuntime[], branchOf: BranchLookup = () => null) {
    this.dests = dests
    this.branchOf = branchOf
  }

  /**
   * Hand the batch to every destination that wants it.
   *
   * Each submit() is a write to that destination's own spool, so this returns
   * as soon as the scans are on disk N times over. Delivery — and any retry
   * storm a slow third party causes — happens per destination, afterwards, with
   * no shared queue for one to block the other on.
   */
  submit(events: NormalizedEvent[]): void {
    if (events.length === 0) return

    for (const d of this.dests) {
      const wanted = d.config.filter
        ? events.filter((e) => matches(d.config.filter, e, this.branchOf))
        : events
      if (wanted.length > 0) d.forwarder.submit(wanted)
    }
  }

  start(): void {
    for (const d of this.dests) d.forwarder.start()
    log.info('fan-out started', {
      destinations: this.dests.map((d) => ({
        id: d.config.id,
        type: d.config.type,
        pending: d.forwarder.pending,
      })),
    })
  }

  stop(): void {
    for (const d of this.dests) d.forwarder.stop()
  }

  /** Total scans waiting across every destination. */
  get pending(): number {
    return this.dests.reduce((n, d) => n + d.forwarder.pending, 0)
  }

  /** The most recent success anywhere. Aggregate view for the old /status shape. */
  get lastSuccessAt(): string | null {
    return newest(this.dests.map((d) => d.forwarder.lastSuccessAt))
  }

  get lastErrorAt(): string | null {
    return newest(this.dests.map((d) => d.forwarder.lastErrorAt))
  }

  /**
   * The error from whichever destination failed most recently, tagged with its
   * id — an untagged message would be unreadable once several destinations can
   * fail for different reasons.
   */
  get lastError(): string | null {
    const failed = this.dests
      .filter((d) => d.forwarder.lastErrorAt !== null)
      .sort((a, b) => (a.forwarder.lastErrorAt! < b.forwarder.lastErrorAt! ? 1 : -1))[0]
    return failed ? `${failed.config.id}: ${failed.forwarder.lastError}` : null
  }

  get totals(): { forwarded: number; batches: number; failures: number; dropped: number } {
    return this.dests.reduce(
      (acc, d) => ({
        forwarded: acc.forwarded + d.forwarder.totals.forwarded,
        batches: acc.batches + d.forwarder.totals.batches,
        failures: acc.failures + d.forwarder.totals.failures,
        dropped: acc.dropped + d.forwarder.totals.dropped,
      }),
      { forwarded: 0, batches: 0, failures: 0, dropped: 0 }
    )
  }

  destinations(): DestinationStatus[] {
    return this.dests.map((d) => ({
      id: d.config.id,
      type: d.config.type,
      pending: d.forwarder.pending,
      lastSuccessAt: d.forwarder.lastSuccessAt,
      lastErrorAt: d.forwarder.lastErrorAt,
      lastError: d.forwarder.lastError,
      totals: d.forwarder.totals,
    }))
  }
}

function newest(values: (string | null)[]): string | null {
  return values.filter((v): v is string => v !== null).sort().pop() ?? null
}
