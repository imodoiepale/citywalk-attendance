import { Spool } from './spool.ts'
import type { Delivery } from './sinks/types.ts'
import { log } from './log.ts'

// Durability, ordering, batching and backoff. Where a batch actually goes is a
// Delivery (src/sinks/), so the same guarantees apply whether the destination is
// Supabase directly or the app's webhook.

export interface ForwarderOptions<T> {
  deliver: Delivery<T>
  label: string
  batchSize?: number
  /** Retry ceiling. Not a give-up point: the spool keeps the items regardless. */
  maxBackoffMs?: number
}

export class Forwarder<T> {
  private readonly spool: Spool<T>
  private readonly deliver: Delivery<T>
  private readonly label: string
  private readonly batchSize: number
  private readonly maxBackoffMs: number

  private running = false
  private draining = false
  private backoffMs = 0
  private timer: NodeJS.Timeout | null = null

  lastSuccessAt: string | null = null
  lastErrorAt: string | null = null
  lastError: string | null = null
  totals = { forwarded: 0, batches: 0, failures: 0, dropped: 0 }

  constructor(spool: Spool<T>, opts: ForwarderOptions<T>) {
    this.spool = spool
    this.deliver = opts.deliver
    this.label = opts.label
    this.batchSize = opts.batchSize ?? 100
    this.maxBackoffMs = opts.maxBackoffMs ?? 60_000
  }

  /** How many items are on disk waiting. Surfaced by /status. */
  get pending(): number {
    return this.spool.pending
  }

  /** Persist first, then nudge the drain. Never the other way round. */
  submit(items: T[]): void {
    for (const item of items) this.spool.add(item)
    if (items.length > 0) this.kick()
  }

  start(): void {
    this.running = true
    this.kick()
    // A slow heartbeat, so a spool left behind by a crash still drains even if
    // nothing new ever arrives to trigger one.
    this.timer = setInterval(() => this.kick(), 30_000)
    this.timer.unref()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearInterval(this.timer)
  }

  private kick(): void {
    if (!this.running || this.draining) return
    void this.drain()
  }

  private async drain(): Promise<void> {
    this.draining = true
    try {
      // Loop until the spool is empty or the sink pushes back, so a backlog from
      // an outage clears in one pass rather than one batch per heartbeat.
      for (;;) {
        const batch = this.spool.peek(this.batchSize)
        if (batch.length === 0) {
          this.backoffMs = 0
          return
        }

        let outcome: 'ok' | 'retry' | 'drop'
        try {
          outcome = await this.deliver(batch.map((b) => b.item))
        } catch (e) {
          // A thrown delivery is a network failure, which is always transient.
          this.note(e instanceof Error ? e.message : String(e))
          outcome = 'retry'
        }

        if (outcome === 'retry') {
          this.scheduleRetry()
          return
        }

        this.spool.ack(batch.map((b) => b.file))

        if (outcome === 'drop') {
          this.totals.dropped += batch.length
        } else {
          this.totals.forwarded += batch.length
          this.lastSuccessAt = new Date().toISOString()
        }

        this.totals.batches += 1
        this.backoffMs = 0
      }
    } finally {
      this.draining = false
    }
  }

  private scheduleRetry(): void {
    this.backoffMs = this.backoffMs === 0 ? 1_000 : Math.min(this.backoffMs * 2, this.maxBackoffMs)
    // Jitter, so forty branch gateways recovering from the same outage do not
    // all retry on the same tick and knock the destination over a second time.
    const delay = this.backoffMs * (0.5 + Math.random() / 2)
    log.warn('delivery failed, retrying', {
      queue: this.label, delayMs: Math.round(delay), pending: this.spool.pending,
    })
    const t = setTimeout(() => this.kick(), delay)
    t.unref()
  }

  private note(message: string): void {
    this.totals.failures += 1
    this.lastErrorAt = new Date().toISOString()
    this.lastError = message
  }
}

export function createForwarder<T>(
  dir: string,
  keyOf: (item: T) => { sort: string; id: string },
  opts: ForwarderOptions<T>
): Forwarder<T> {
  return new Forwarder(new Spool<T>(dir, keyOf), opts)
}
