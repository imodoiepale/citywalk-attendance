import crypto from 'node:crypto'
import { buildM50Response, looksLikeM50, parseM50Message } from './protocol.ts'
import { log } from '../../log.ts'

// The Register → Login handshake, per WebSocket connection.
//
// THIS IS WHY THE TERMINAL WOULD NOT TALK. The device dials the Web Server URL
// every ten seconds, completes the WebSocket handshake, and sends
// `<Message><Request>Register</Request>…</Message>` as its first frame. It then
// waits for a *well-formed XML* reply carrying a token. Anything else — a bare
// "OK", JSON, an empty frame, silence — is not a token, so it never logs in,
// never sends a scan, and closes. From the server's side that is a connection
// which opens and shuts having produced nothing: fresh TIME_WAIT entries, a
// clean TLS handshake, and not one useful byte.
//
// The state machine is gated the way the vendor's own reference server gates it
// (`worker.py` in the Python SDK): logs are only accepted from a connection
// that has logged in. A device we will not record for is a device we do not
// acknowledge, so it holds its scans and re-sends them once its serial is added
// to devices.yaml — the contract every other vendor module here honours.

export type M50Stage = 'new' | 'registered' | 'loggedIn'

export interface M50SessionDeps {
  /** Human-readable peer, for logs. */
  from: string
  /** True when this serial is in devices.yaml. */
  knownSerial: (serial: string) => boolean
  /** When false, an unknown serial is still accepted (capture mode). */
  strictSerials: boolean
  /**
   * Hand a log frame to the gateway's normal pipeline.
   *
   * Returns the vendor acknowledgement, or null when nothing was accepted —
   * which this session turns into `Result: Fail`, so the device retains the
   * record and tries again rather than dropping it on the floor.
   */
  deliver: (body: Buffer, serial: string) => string | null
  /** Write one frame back to the device. */
  send: (text: string) => void
}

/**
 * The token the device stores and presents on every later connection.
 *
 * Derived rather than stored: an HMAC of the serial under a gateway-wide
 * secret. That makes it stable across restarts with no persistence at all, and
 * verifiable by recomputation. If the secret does change — a fresh deployment
 * with no `M50_TOKEN_SECRET` set — the device presents a token that no longer
 * verifies, gets `FailUnknownToken`, and re-registers on the spot. That is
 * precisely the result code the vendor added in September 2023 for this case.
 */
function mintToken(serial: string, secret: Buffer): string {
  const mac = crypto.createHmac('sha256', secret).update(`m50:${serial}`).digest('hex')
  // Shaped like the vendor's own GUID-style sample tokens. Some firmware is
  // fussy about field widths in ways no document records, and matching the
  // sample costs nothing.
  return [mac.slice(0, 8), mac.slice(8, 12), mac.slice(12, 16), mac.slice(16, 20), mac.slice(20, 32)].join('-')
}

let cachedSecret: Buffer | null = null

/** The signing secret, fixed for the life of the process. */
export function m50TokenSecret(): Buffer {
  if (cachedSecret) return cachedSecret
  const configured = process.env.M50_TOKEN_SECRET ?? process.env.BIOMETRIC_WEBHOOK_SECRET
  if (configured && configured.trim()) {
    cachedSecret = Buffer.from(configured.trim(), 'utf8')
  } else {
    // Not fatal: tokens simply become per-process and devices re-register after
    // a restart. Warned about because that churn is otherwise a confusing thing
    // to find in the logs.
    cachedSecret = crypto.randomBytes(32)
    log.warn('M50 tokens are ephemeral; set M50_TOKEN_SECRET to keep devices registered across restarts')
  }
  return cachedSecret
}

/** Exposed for tests, and for anyone needing to pre-seed a device by hand. */
export function m50TokenFor(serial: string): string {
  return mintToken(serial, m50TokenSecret())
}

export class M50Session {
  stage: M50Stage = 'new'
  serial: string | null = null
  terminalType: string | null = null

  private readonly deps: M50SessionDeps

  constructor(deps: M50SessionDeps) {
    this.deps = deps
  }

  /**
   * Offer a frame to this session.
   *
   * Returns false when the frame is not M50 at all, which lets the WebSocket
   * handler fall back to the generic push path for the other device families
   * that share this port.
   */
  handle(body: Buffer): boolean {
    let text: string
    try {
      text = body.toString('utf8')
    } catch {
      return false
    }
    if (!looksLikeM50(text)) return false

    const message = parseM50Message(text)
    if (!message) return false

    if (message.kind === 'request') {
      switch (message.name) {
        case 'Register': return this.onRegister(message.fields)
        case 'Login': return this.onLogin(message.fields)
        default:
          log.warn('unhandled M50 request from device', { from: this.deps.from, request: message.name })
          return true
      }
    }

    if (message.kind === 'event') {
      switch (message.name) {
        case 'KeepAlive': return this.onKeepAlive(message.fields)
        case 'TimeLog':
        case 'TimeLog_v2': return this.onLog(body, message.name, message.fields)
        case 'AdminLog':
        case 'AdminLog_v2': return this.onAdminLog(message.name, message.fields)
        default:
          log.info('unhandled M50 event', { from: this.deps.from, event: message.name })
          return true
      }
    }

    // A reply to a server-initiated command. Nothing issues those yet — the
    // remote-management half of this protocol is not wired up — so this is
    // recorded and dropped rather than pretended about.
    log.debug('M50 command response', { from: this.deps.from, response: message.name, serial: this.serial })
    return true
  }

  private allowed(serial: string): boolean {
    return !this.deps.strictSerials || this.deps.knownSerial(serial)
  }

  private onRegister(f: Record<string, string>): boolean {
    const serial = f.DeviceSerialNo ?? ''
    if (!serial) {
      log.warn('M50 Register with no DeviceSerialNo', { from: this.deps.from })
      return true
    }

    this.serial = serial
    this.terminalType = f.TerminalType ?? null

    if (!this.allowed(serial)) {
      // Refused loudly, because this is the one failure a person can fix in
      // thirty seconds — and the log line carries the serial to paste in.
      log.warn('refused M50 registration for unknown serial; add it to devices.yaml', {
        from: this.deps.from, serial, terminalType: this.terminalType,
      })
      this.deps.send(buildM50Response('Register', [['DeviceSerialNo', serial], ['Result', 'Fail']]))
      return true
    }

    const token = m50TokenFor(serial)
    this.stage = 'registered'
    log.info('M50 device registered', {
      from: this.deps.from, serial, terminalType: this.terminalType, cloudId: f.CloudId ?? null,
    })
    this.deps.send(buildM50Response('Register', [
      ['DeviceSerialNo', serial], ['Token', token], ['Result', 'OK'],
    ]))
    return true
  }

  private onLogin(f: Record<string, string>): boolean {
    const serial = f.DeviceSerialNo ?? ''
    const token = f.Token ?? ''
    if (!serial) {
      log.warn('M50 Login with no DeviceSerialNo', { from: this.deps.from })
      return true
    }

    this.serial = serial
    if (f.TerminalType) this.terminalType = f.TerminalType

    if (!this.allowed(serial)) {
      log.warn('refused M50 login for unknown serial; add it to devices.yaml', { from: this.deps.from, serial })
      this.deps.send(buildM50Response('Login', [['DeviceSerialNo', serial], ['Result', 'Fail']]))
      return true
    }

    const expected = m50TokenFor(serial)
    // Constant-time, and length-guarded because timingSafeEqual throws on a
    // length mismatch rather than returning false.
    const ok = token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))

    if (!ok) {
      // Not plain "Fail": FailUnknownToken is what tells the firmware to discard
      // its stored token and register again, which is the only way a device
      // recovers by itself after the gateway's secret changes.
      log.info('M50 login presented an unrecognised token; asking the device to re-register', {
        from: this.deps.from, serial,
      })
      this.deps.send(buildM50Response('Login', [['DeviceSerialNo', serial], ['Result', 'FailUnknownToken']]))
      return true
    }

    this.stage = 'loggedIn'
    log.info('M50 device logged in', { from: this.deps.from, serial, terminalType: this.terminalType })
    this.deps.send(buildM50Response('Login', [['DeviceSerialNo', serial], ['Result', 'OK']]))
    return true
  }

  private onKeepAlive(f: Record<string, string>): boolean {
    if (!this.requireLogin('KeepAlive')) return true
    // DevTime and ServerTime are in the document but absent from the reference
    // server's reply. Sending them is a superset of what the firmware is known
    // to accept, and it puts device clock skew — the usual cause of punches
    // landing on the wrong day — straight into the log.
    const devTime = f.DevTime ?? null
    this.deps.send(buildM50Response('KeepAlive', [
      ['Result', 'OK'], ['DevTime', devTime], ['ServerTime', serverTime()],
    ]))
    log.debug('M50 keepalive', { from: this.deps.from, serial: this.serial, devTime })
    return true
  }

  private onLog(body: Buffer, event: string, f: Record<string, string>): boolean {
    if (!this.requireLogin(event)) return true

    const serial = f.DeviceSerialNo || this.serial || ''
    const ack = this.deps.deliver(body, serial)
    if (ack !== null) {
      this.deps.send(ack)
      return true
    }

    // Nothing was accepted. Say so explicitly: a `Fail` makes the device retain
    // the record and re-send it, which is recoverable. Silence would too, but an
    // explicit answer is what the protocol asks for and it saves the device
    // waiting out its own timeout on every scan.
    log.warn('M50 log frame produced no event; replying Fail so the device retains it', {
      from: this.deps.from, serial, event, logId: f.LogID ?? null,
    })
    this.deps.send(buildM50Response(event, [['Result', 'Fail'], ['TransID', f.TransID ?? null]]))
    return true
  }

  private onAdminLog(event: string, f: Record<string, string>): boolean {
    if (!this.requireLogin(event)) return true
    // Device housekeeping — enrolments, menu access, setting changes. Not
    // attendance, so it is acknowledged and logged rather than forwarded.
    log.info('M50 admin log', {
      from: this.deps.from, serial: this.serial,
      action: f.Action ?? null, adminId: f.AdminID ?? null, userId: f.UserID ?? null, time: f.Time ?? null,
    })
    this.deps.send(buildM50Response(event, [['Result', 'OK'], ['TransID', f.TransID ?? null]]))
    return true
  }

  private requireLogin(what: string): boolean {
    if (this.stage === 'loggedIn') return true
    log.warn('M50 frame before login; ignoring', {
      from: this.deps.from, serial: this.serial, stage: this.stage, frame: what,
    })
    return false
  }
}

/** `2022-12-28-T20:02:43Z` — the firmware's own format, stray hyphen included. */
export function serverTime(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(now.getUTCFullYear(), 4)}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}-T` +
    `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}Z`
}
