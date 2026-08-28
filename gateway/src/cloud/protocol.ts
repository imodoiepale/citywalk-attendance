import { isRecord } from '../vendors/fields.ts'

// Codec and request/reply correlation for the cloud protocol (TCP 7788).
//
// See attendance/docs/cloud-protocol.md. Two properties of this protocol shape
// everything here, and neither is negotiable:
//
//   1. THERE ARE NO REQUEST IDS. A reply is {"ret":"<same name as cmd>"}. The
//      only way to know which request it answers is ordering, so exactly one
//      command may be in flight per device and the rest queue behind it.
//   2. READS ARE PAGED. "stn":true starts, "stn":false continues, until the
//      device stops returning rows.

export interface CloudRequest {
  cmd: string
  [key: string]: unknown
}

export interface CloudReply {
  ret: string
  result?: boolean
  [key: string]: unknown
}

/** Anything the device sends: a command of its own, or a reply to ours. */
export type CloudMessage = (CloudRequest | CloudReply) & Record<string, unknown>

export function isReply(msg: CloudMessage): msg is CloudReply {
  return typeof (msg as CloudReply).ret === 'string'
}

export function isCommand(msg: CloudMessage): msg is CloudRequest {
  return typeof (msg as CloudRequest).cmd === 'string'
}

export function encode(message: CloudRequest | CloudReply): string {
  return JSON.stringify(message)
}

/**
 * Splits a byte stream into whole JSON documents.
 *
 * The protocol is not length-prefixed and not reliably newline-delimited: over
 * raw TCP the frames arrive back to back, and a single read can hold half a
 * message or three of them. Brace counting — string- and escape-aware, so a
 * `}` inside a name or a base64 template does not end a frame early — is the
 * only framing that holds for both cases.
 *
 * WebSocket transports deliver whole frames already, but running them through
 * the same splitter costs nothing and means one code path.
 */
export class JsonStream {
  private buffer = ''
  private readonly maxBytes: number

  /** @param maxBytes Guard against a device that never closes a brace. */
  constructor(maxBytes = 8 * 1024 * 1024) {
    this.maxBytes = maxBytes
  }

  /** Feed bytes, get back whatever complete messages they completed. */
  push(chunk: Buffer | string): CloudMessage[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    if (this.buffer.length > this.maxBytes) {
      // Unrecoverable: we cannot find a boundary and cannot keep growing. Drop
      // the buffer rather than the process.
      this.buffer = ''
      throw new Error(`cloud frame exceeded ${this.maxBytes} bytes without closing`)
    }

    const out: CloudMessage[] = []
    for (;;) {
      const end = this.findFrameEnd()
      if (end < 0) break

      const text = this.buffer.slice(0, end + 1)
      this.buffer = this.buffer.slice(end + 1)

      try {
        const value: unknown = JSON.parse(text)
        if (isRecord(value)) out.push(value as CloudMessage)
      } catch {
        // Brace counting said this was complete, so a parse failure means the
        // device sent something malformed. Skip it; the archive keeps the bytes.
      }
    }
    return out
  }

  /** Index of the `}` closing the first complete object, or -1. */
  private findFrameEnd(): number {
    let depth = 0
    let inString = false
    let escaped = false
    let started = false

    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i] as string

      if (escaped) { escaped = false; continue }
      if (inString) {
        if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }

      if (ch === '{') { depth++; started = true }
      else if (ch === '}') {
        depth--
        if (started && depth === 0) return i
        if (depth < 0) {
          // Stray closing brace — resynchronise rather than wedging forever.
          this.buffer = this.buffer.slice(i + 1)
          return this.findFrameEnd()
        }
      } else if (!started && !/\s/.test(ch)) {
        // Junk before any object (a stray newline is fine, a bare token is not).
        this.buffer = this.buffer.slice(i + 1)
        return this.findFrameEnd()
      }
    }
    return -1
  }
}

export class CommandTimeoutError extends Error {
  constructor(cmd: string, ms: number) {
    super(`device did not answer "${cmd}" within ${ms}ms`)
    this.name = 'CommandTimeoutError'
  }
}

export class DeviceGoneError extends Error {
  constructor(cmd: string) {
    super(`device disconnected before answering "${cmd}"`)
    this.name = 'DeviceGoneError'
  }
}

interface InFlight {
  cmd: string
  resolve: (reply: CloudReply) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Serialises commands to one device and matches replies to them.
 *
 * Strictly one in flight. That is a correctness requirement, not a
 * simplification: with no request ids, two outstanding commands make the first
 * reply ambiguous, and a wrong match would attribute one device's answer to
 * another question — silently.
 */
export class Correlator {
  private inFlight: InFlight | null = null
  private readonly waiting: (() => void)[] = []
  private closedReason: string | null = null
  private readonly write: (text: string) => void
  private readonly defaultTimeoutMs: number

  constructor(write: (text: string) => void, defaultTimeoutMs = 15_000) {
    this.write = write
    this.defaultTimeoutMs = defaultTimeoutMs
  }

  get busy(): boolean {
    return this.inFlight !== null
  }

  /** Commands queued behind the one in flight. Surfaced by /status. */
  get queued(): number {
    return this.waiting.length
  }

  async request(request: CloudRequest, timeoutMs?: number): Promise<CloudReply> {
    if (this.closedReason) throw new DeviceGoneError(request.cmd)

    // Wait for our turn. A plain FIFO of resumers rather than a promise chain,
    // so a rejected command does not poison the ones behind it.
    if (this.inFlight) {
      await new Promise<void>((resume) => this.waiting.push(resume))
      if (this.closedReason) throw new DeviceGoneError(request.cmd)
    }

    const ms = timeoutMs ?? this.defaultTimeoutMs

    return new Promise<CloudReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(() => reject(new CommandTimeoutError(request.cmd, ms)))
      }, ms)
      timer.unref?.()

      this.inFlight = { cmd: request.cmd, resolve, reject, timer }

      try {
        this.write(encode(request))
      } catch (e) {
        this.settle(() => reject(e instanceof Error ? e : new Error(String(e))))
      }
    })
  }

  /**
   * Offer a reply to the in-flight command.
   *
   * Returns false when it does not match, so the caller can treat it as an
   * unsolicited message rather than assuming every `ret` answers something.
   */
  accept(reply: CloudReply): boolean {
    const flight = this.inFlight
    if (!flight) return false
    // The device echoes the command name. A mismatch means this reply belongs
    // to something else — a stale answer after a timeout, most likely — and
    // accepting it would resolve the wrong request.
    if (reply.ret !== flight.cmd) return false

    this.settle(() => flight.resolve(reply))
    return true
  }

  /** The connection went away. Fail everything rather than hanging callers. */
  close(reason: string): void {
    this.closedReason = reason
    const flight = this.inFlight
    if (flight) {
      clearTimeout(flight.timer)
      this.inFlight = null
      flight.reject(new DeviceGoneError(flight.cmd))
    }
    while (this.waiting.length > 0) this.waiting.shift()?.()
  }

  private settle(finish: () => void): void {
    const flight = this.inFlight
    if (flight) clearTimeout(flight.timer)
    this.inFlight = null
    finish()
    this.waiting.shift()?.()
  }
}

/**
 * Runs a paged read to completion.
 *
 * `stn:true` opens, `stn:false` continues. Terminates when a page carries no
 * records, or when the device says `result:false`, or at `maxPages` — because a
 * firmware that always returns rows would otherwise loop forever, and a bounded
 * wrong answer beats an unbounded one.
 */
export async function readPaged(
  send: (request: CloudRequest) => Promise<CloudReply>,
  cmd: string,
  extra: Record<string, unknown> = {},
  maxPages = 500
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []

  for (let page = 0; page < maxPages; page++) {
    const reply = await send({ cmd, stn: page === 0, ...extra })
    if (reply.result === false) break

    const record = reply.record
    const batch = Array.isArray(record) ? record.filter(isRecord) : []

    // An empty page is the only reliable end-of-data signal. `count` in a reply
    // is the number of records in THAT page, not the total — the same meaning
    // it has in the device's own `sendlog` — so it cannot be used to decide
    // when to stop.
    if (batch.length === 0) break

    rows.push(...batch)
  }

  return rows
}
