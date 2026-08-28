import type { DeviceSession } from './session.ts'
import type { DeviceCommandRow, Persistence } from './persistence.ts'
import type { CloudRequest } from './protocol.ts'
import { log, errFields } from '../log.ts'

// The bridge between the app and a terminal.
//
// The app writes a row to device_commands; this claims it, sends it down the
// device's live socket, and writes the outcome back. That indirection is the
// design: the gateway exposes NO inbound control API, so there is no second
// public endpoint on the VPS and no second shared secret to distribute. It also
// means commands queue correctly while the app is down, while the gateway is
// down, or while the device is offline — each of which happens.

/** Commands whose answer arrives across several pages rather than one reply. */
const PAGED = new Set(['getallusers', 'getuserlist', 'getnewlog', 'getalllog'])

export interface CommandQueueTotals {
  dispatched: number
  succeeded: number
  failed: number
}

export interface CommandQueueStatus {
  pollIntervalMs: number
  lastTickAt: string | null
  totals: CommandQueueTotals
}

export interface CommandQueueDeps {
  persistence: Persistence
  /** Live session for a serial, or undefined if it is not connected. */
  sessionFor(serial: string): DeviceSession | undefined
  /** Serials connected to THIS gateway right now. */
  onlineSerials(): string[]
  pollIntervalMs?: number
  batchSize?: number
  /** Per-command ceiling. Paged reads of a full log can be slow. */
  commandTimeoutMs?: number
}

export class CommandQueue {
  private readonly deps: CommandQueueDeps
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly commandTimeoutMs: number

  private timer: NodeJS.Timeout | null = null
  private running = false
  private ticking = false

  totals: CommandQueueTotals = { dispatched: 0, succeeded: 0, failed: 0 }
  lastTickAt: string | null = null

  constructor(deps: CommandQueueDeps) {
    this.deps = deps
    this.pollIntervalMs = deps.pollIntervalMs ?? 2_000
    this.batchSize = deps.batchSize ?? 20
    this.commandTimeoutMs = deps.commandTimeoutMs ?? 60_000
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs)
    this.timer.unref?.()
    void this.tick()
    log.info('command queue polling', { intervalMs: this.pollIntervalMs })
  }

  stop(): void {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One poll cycle. Returns how many commands were dispatched. */
  async tick(): Promise<number> {
    // Overlapping ticks would claim work the previous one is still sending.
    if (this.ticking) return 0
    this.ticking = true

    try {
      const online = this.deps.onlineSerials()
      if (online.length === 0) return 0

      const rows = await this.deps.persistence.claimCommands(online, this.batchSize)
      if (rows.length === 0) return 0

      this.lastTickAt = new Date().toISOString()

      // Group by device so each device's commands run in the order they were
      // queued, while different devices proceed in parallel. Without the
      // grouping, "set the template" and "enable the user" could interleave
      // across an await and arrive backwards.
      const byDevice = new Map<string, DeviceCommandRow[]>()
      for (const row of rows) {
        const list = byDevice.get(row.serial_no) ?? []
        list.push(row)
        byDevice.set(row.serial_no, list)
      }

      await Promise.all(
        [...byDevice.entries()].map(([serial, list]) => this.runForDevice(serial, list))
      )

      this.totals.dispatched += rows.length
      return rows.length
    } catch (e) {
      log.error('command queue tick failed', errFields(e))
      return 0
    } finally {
      this.ticking = false
    }
  }

  private async runForDevice(serial: string, rows: DeviceCommandRow[]): Promise<void> {
    for (const row of rows) {
      const session = this.deps.sessionFor(serial)
      if (!session) {
        // It disconnected between the claim and now. Fail this one so it is
        // visible rather than silently stuck in 'sent' forever; the operator
        // re-issues it, which is honest about what happened.
        await this.finish(row, false, null, 'device disconnected before the command was sent')
        continue
      }
      await this.runOne(session, row)
    }
  }

  private async runOne(session: DeviceSession, row: DeviceCommandRow): Promise<void> {
    const request: CloudRequest = { cmd: row.command, ...(row.payload ?? {}) }

    try {
      if (PAGED.has(row.command)) {
        const records = await session.readPaged(row.command, stripPagingKeys(row.payload))
        await this.finish(row, true, { count: records.length, record: records }, null)
        return
      }

      const reply = await session.request(request, this.commandTimeoutMs)

      // The device answered, but answered "no". That is a real outcome, not a
      // transport failure, and must not be reported as success.
      const ok = reply.result !== false
      await this.finish(row, ok, reply, ok ? null : String(reply.reason ?? 'device refused the command'))
    } catch (e) {
      await this.finish(row, false, null, e instanceof Error ? e.message : String(e))
    }
  }

  private async finish(
    row: DeviceCommandRow, ok: boolean, result: unknown, error: string | null
  ): Promise<void> {
    if (ok) this.totals.succeeded += 1
    else this.totals.failed += 1

    log[ok ? 'info' : 'warn']('device command completed', {
      id: row.id, serial: row.serial_no, command: row.command, ok, error: error ?? undefined,
    })

    try {
      await this.deps.persistence.completeCommand(row.id, ok, result, error)
    } catch (e) {
      // The command ran; only recording it failed. Leaving it 'sent' is the
      // least-wrong state — it expires rather than being retried, and a retried
      // "open door" would be worse than a lost status line.
      log.error('could not record command outcome', { id: row.id, ...errFields(e) })
    }
  }

  status(): CommandQueueStatus {
    return { pollIntervalMs: this.pollIntervalMs, lastTickAt: this.lastTickAt, totals: this.totals }
  }
}

/**
 * `stn` is owned by the paging loop, so a caller cannot pin it and turn a paged
 * read into an infinite first page.
 */
function stripPagingKeys(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const copy = { ...(payload ?? {}) }
  delete copy.stn
  return copy
}
