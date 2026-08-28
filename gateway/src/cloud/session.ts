import http from 'node:http'
import net from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { NormalizedEvent } from '../types.ts'
import { log, errFields } from '../log.ts'
import {
  Correlator, JsonStream, encode, isCommand, isReply, readPaged,
  type CloudMessage, type CloudReply, type CloudRequest,
} from './protocol.ts'
import {
  parseDeviceInfo, parseSendLog, parseSendUser, sendLogAck,
  type CapturedCredential, type DeviceInfo,
} from './inbound.ts'

// The cloud channel: terminals dial in, and we hold the connection open so
// commands can go back down it.
//
// This is the one stateful part of the gateway. Everything else is
// payload-in / events-out and forgets the sender immediately; here a live
// socket per device IS the resource, because it is the only route to that
// device — it sits behind NAT and we can never dial it.

export interface CloudDeps {
  /** Fallback zone for devices with no per-device setting. */
  timezone: string
  /** Reject devices absent from devices.yaml. */
  strictSerials: boolean
  isKnownSerial(serial: string): boolean
  deviceTimezone(serial: string): string
  /** Accepted punches. Wired to the same Fanout the push path uses. */
  onEvents(events: NormalizedEvent[], source: string): void
  /** A credential captured on the device, ready to replicate. */
  onCapturedCredential(credential: CapturedCredential): void
  /** Registration, with the free inventory it carries. */
  onRegister(serial: string, info: DeviceInfo | null): void
  /** Verbatim frames, for diagnosis. */
  onRawFrame?(serial: string | null, text: string, transport: string): void
}

export interface SessionStatus {
  serial: string
  transport: string
  remote: string | null
  connectedAt: string
  lastMessageAt: string
  model: string | null
  firmware: string | null
  fpAlgo: string | null
  capacity: Record<string, number>
  busy: boolean
  queued: number
  punches: number
}

/** One live device connection. */
export class DeviceSession {
  readonly connectedAt = new Date().toISOString()
  lastMessageAt = this.connectedAt
  devinfo: DeviceInfo | null = null
  punches = 0

  readonly serial: string
  readonly transport: string
  readonly remote: string | null

  private readonly correlator: Correlator
  private readonly closeTransport: () => void

  constructor(
    serial: string,
    transport: string,
    remote: string | null,
    write: (text: string) => void,
    closeTransport: () => void
  ) {
    this.serial = serial
    this.transport = transport
    this.remote = remote
    this.closeTransport = closeTransport
    this.correlator = new Correlator(write)
  }

  /** Send one command and wait for its reply. Serialised per device. */
  request(request: CloudRequest, timeoutMs?: number): Promise<CloudReply> {
    return this.correlator.request(request, timeoutMs)
  }

  /** Run a paged read (`getallusers`, `getnewlog`, …) to completion. */
  readPaged(cmd: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    return readPaged((r) => this.correlator.request(r), cmd, extra)
  }

  /** Offer a reply to the in-flight command; false if it matches nothing. */
  acceptReply(reply: CloudReply): boolean {
    return this.correlator.accept(reply)
  }

  get busy(): boolean { return this.correlator.busy }
  get queued(): number { return this.correlator.queued }

  close(reason: string): void {
    this.correlator.close(reason)
    try { this.closeTransport() } catch { /* already gone */ }
  }

  status(): SessionStatus {
    return {
      serial: this.serial,
      transport: this.transport,
      remote: this.remote,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      model: this.devinfo?.modelname ?? null,
      firmware: this.devinfo?.firmware ?? null,
      fpAlgo: this.devinfo?.fpalgo ?? null,
      capacity: this.devinfo?.capacity ?? {},
      busy: this.busy,
      queued: this.queued,
      punches: this.punches,
    }
  }
}

export class CloudServer {
  private readonly sessions = new Map<string, DeviceSession>()
  private readonly tcp: net.Server
  private readonly http: http.Server
  private readonly wss: WebSocketServer
  private readonly deps: CloudDeps

  constructor(deps: CloudDeps) {
    this.deps = deps

    // WebSocket and raw TCP share one port because the vendor software runs
    // both there and a given firmware may use either. Rather than guess, sniff
    // the first bytes: an HTTP verb means a WebSocket upgrade, anything else is
    // a bare JSON stream.
    this.http = http.createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain' })
      res.end('this port speaks the device cloud protocol')
    })
    this.wss = new WebSocketServer({ server: this.http })
    this.wss.on('connection', (ws, req) => {
      this.attachWebSocket(ws, req.socket.remoteAddress ?? null)
    })

    this.tcp = net.createServer((socket) => this.route(socket))
    this.tcp.on('error', (e: NodeJS.ErrnoException) => {
      log.error('cloud listener failed', { code: e.code, ...errFields(e) })
    })
  }

  listen(port: number): void {
    this.tcp.listen(port, '0.0.0.0', () => {
      log.info('listening for cloud devices', { port, websocket: true, rawTcp: true })
    })
  }

  close(): void {
    for (const session of this.sessions.values()) session.close('gateway shutting down')
    this.sessions.clear()
    this.wss.close()
    this.http.close()
    this.tcp.close()
  }

  get(serial: string): DeviceSession | undefined {
    return this.sessions.get(serial)
  }

  online(): string[] {
    return [...this.sessions.keys()]
  }

  status(): SessionStatus[] {
    return [...this.sessions.values()].map((s) => s.status())
  }

  // ── transport routing ──────────────────────────────────────────────────────

  private route(socket: net.Socket): void {
    socket.once('data', (first: Buffer) => {
      const head = first.subarray(0, 8).toString('ascii')
      if (/^(GET|POST|PUT|HEAD|OPTIONS) /.test(head)) {
        // Hand it to the HTTP server so `ws` can complete the upgrade. Unshift
        // first so the bytes we consumed are still there for it to parse.
        socket.pause()
        socket.unshift(first)
        this.http.emit('connection', socket)
        socket.resume()
        return
      }
      this.attachRawTcp(socket, first)
    })
    socket.on('error', (e) => log.warn('cloud socket error before routing', errFields(e)))
  }

  private attachRawTcp(socket: net.Socket, first: Buffer): void {
    const remote = socket.remoteAddress ?? null
    const stream = new JsonStream()
    const conn = this.makeConnection(
      'tcp',
      remote,
      (text) => socket.write(text),
      () => socket.destroy()
    )

    const feed = (chunk: Buffer) => {
      let messages: CloudMessage[] = []
      try {
        messages = stream.push(chunk)
      } catch (e) {
        log.warn('cloud frame discarded', { remote, ...errFields(e) })
        return
      }
      for (const m of messages) conn.handle(m)
    }

    feed(first)
    socket.on('data', feed)
    socket.on('close', () => conn.dispose('tcp closed'))
    socket.on('error', (e) => {
      log.warn('cloud tcp error', { remote, ...errFields(e) })
      conn.dispose('tcp error')
    })
  }

  private attachWebSocket(ws: WebSocket, remote: string | null): void {
    const stream = new JsonStream()
    const conn = this.makeConnection(
      'ws',
      remote,
      (text) => ws.send(text),
      () => ws.close()
    )

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      let messages: CloudMessage[] = []
      try {
        messages = stream.push(buf)
      } catch (e) {
        log.warn('cloud ws frame discarded', { remote, ...errFields(e) })
        return
      }
      for (const m of messages) conn.handle(m)
    })
    ws.on('close', () => conn.dispose('ws closed'))
    ws.on('error', (e) => {
      log.warn('cloud ws error', { remote, ...errFields(e) })
      conn.dispose('ws error')
    })
  }

  /**
   * Per-connection state machine, shared by both transports.
   *
   * A connection is anonymous until it registers. That matters: the serial
   * arrives in the first message, and until then there is nothing to key a
   * session on and no way to check the allowlist.
   */
  private makeConnection(
    transport: string,
    remote: string | null,
    write: (text: string) => void,
    closeTransport: () => void
  ) {
    let session: DeviceSession | null = null
    let disposed = false

    const handle = (msg: CloudMessage): void => {
      if (disposed) return
      this.deps.onRawFrame?.(session?.serial ?? null, encode(msg), transport)
      if (session) session.lastMessageAt = new Date().toISOString()

      if (isReply(msg)) {
        if (!session || !session.acceptReply(msg)) {
          // A reply matching nothing is usually a late answer to a command that
          // already timed out. Worth seeing, never worth acting on.
          log.warn('unmatched cloud reply', { transport, remote, ret: msg.ret })
        }
        return
      }
      if (!isCommand(msg)) return

      switch (msg.cmd) {
        case 'reg': return onRegister(msg)
        case 'sendlog': return onSendLog(msg)
        case 'senduser': return onSendUser(msg)
        default:
          log.warn('unhandled cloud command from device', {
            transport, remote, cmd: msg.cmd, serial: session?.serial ?? null,
          })
      }
    }

    const onRegister = (msg: CloudRequest): void => {
      const serial = msg.sn === undefined || msg.sn === null ? '' : String(msg.sn).trim()
      if (!serial) {
        log.warn('cloud registration with no serial; closing', { transport, remote })
        closeTransport()
        return
      }

      if (this.deps.strictSerials && !this.deps.isKnownSerial(serial)) {
        // Closing rather than answering: the device retries on its own, so
        // adding the serial to devices.yaml recovers it. Auto-registering
        // whatever dials in — as the vendor software does — would let anyone
        // who can reach the port enrol themselves a device.
        log.warn('rejected cloud registration from unknown serial', {
          transport, remote, serial,
          hint: 'add it to devices.yaml, or set STRICT_SERIALS=false while commissioning',
        })
        closeTransport()
        return
      }

      // One session per serial. A reconnect after an unclean drop would
      // otherwise leave a dead session shadowing the live one, and commands
      // would be written to a socket nobody is reading.
      const existing = this.sessions.get(serial)
      if (existing) existing.close('superseded by a new connection')

      session = new DeviceSession(serial, transport, remote, write, closeTransport)
      session.devinfo = parseDeviceInfo(msg)
      this.sessions.set(serial, session)

      write(encode({ ret: 'reg', result: true }))
      this.deps.onRegister(serial, session.devinfo)

      log.info('cloud device registered', {
        serial, transport, remote,
        model: session.devinfo?.modelname ?? null,
        firmware: session.devinfo?.firmware ?? null,
        fpAlgo: session.devinfo?.fpalgo ?? null,
        capacity: session.devinfo?.capacity ?? {},
      })
    }

    const onSendLog = (msg: CloudRequest): void => {
      if (!session) return requireRegistration('sendlog')

      const events = parseSendLog(msg, session.serial, this.deps.deviceTimezone(session.serial))
      if (events.length > 0) {
        session.punches += events.length
        this.deps.onEvents(events, `cloud ${session.serial}`)
      }

      // Acknowledge only after the events are handed over — onEvents spools
      // them synchronously, so "OK" means durably ours, not merely received.
      write(encode(sendLogAck(msg, events.length) as CloudReply))

      log.info('cloud punches accepted', {
        serial: session.serial, count: events.length, claimed: Number(msg.count) || undefined,
      })
    }

    const onSendUser = (msg: CloudRequest): void => {
      if (!session) return requireRegistration('senduser')

      const credential = parseSendUser(msg, session.serial)
      if (credential) {
        this.deps.onCapturedCredential(credential)
        log.info('credential captured on device', {
          serial: session.serial,
          enrollId: credential.externalUserId,
          backupNum: credential.backupNum,
          // Never the template itself: it is biometric data and this is a log.
          templateBytes: credential.template.length,
        })
      }
      write(encode({ ret: 'senduser', result: true }))
    }

    const requireRegistration = (cmd: string): void => {
      log.warn('cloud command before registration; closing', { transport, remote, cmd })
      closeTransport()
    }

    const dispose = (reason: string): void => {
      if (disposed) return
      disposed = true
      if (!session) return
      // Only drop it from the registry if it is still the current one — a
      // superseded session disposing later must not evict its replacement.
      if (this.sessions.get(session.serial) === session) this.sessions.delete(session.serial)
      session.close(reason)
      log.info('cloud device disconnected', { serial: session.serial, transport, reason })
    }

    return { handle, dispose }
  }
}
