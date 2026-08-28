import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'
import type { Config, DeviceConfig } from './config.ts'
import type { Forwarder } from './forward.ts'
import type { EventTarget } from './fanout.ts'
import type { NormalizedEvent, VendorInput } from './types.ts'
import type { RawPayload } from './archive.ts'
import { buildRawPayload } from './archive.ts'
import { getParser, vendorNames } from './vendors/index.ts'
import { log, errFields } from './log.ts'
import { camsAuthToken, decryptCamsCallback, validCamsAuthToken } from './vendors/cams/security.ts'
import { M82_ENROLL, M82_HEARTBEAT, m82RequestCode, m82DeviceId, encodeM82Body } from './vendors/m82/push.ts'
import { M82Assembler } from './vendors/m82/assemble.ts'

// The listening half of the gateway: terminals push, this receives.
//
// Routing is deliberately loose. Firmware URL fields are inconsistent and often
// undocumented, so rather than demand an exact path, any POST that is not a
// known control route is treated as a device push. A device whose payload we
// can read is more useful than a device that got a tidy 404.

export interface ServerDeps {
  config: Config
  /**
   * Where accepted scans go. A single Forwarder or a Fanout across many
   * destinations — the server does not care which, and must not: adding a
   * destination is a deployment decision, not an ingress one.
   */
  forwarder: EventTarget
  /** Optional raw archive. Absent in tests that only care about parsing. */
  archive?: Forwarder<RawPayload>
  /** Called for every accepted push, before forwarding. Used by /status and tests. */
  onEvents?: (events: NormalizedEvent[], source: string) => void
  /**
   * Called once a `realtime_enroll_data` push from an M82 terminal has been
   * fully reassembled — see vendors/m82/assemble.ts. One call per credential
   * slot the device attached (finger, card, face...), each with its raw
   * template bytes.
   *
   * A terminal pushing this UNPROMPTED is the whole reason it exists as a
   * separate hook from onEvents: it is not an attendance event, and the
   * payload is biometric personal data that must be sealed before storage —
   * this hook is exactly the boundary where that has not happened yet, so
   * whatever consumes it must seal immediately, not log or forward it raw.
   */
  onM82Credential?: (credential: M82CredentialCapture) => void
}

export interface M82CredentialCapture {
  deviceSerial: string
  externalUserId: string
  name: string | null
  backupNumber: number
  /** Raw template bytes for this slot, base64-encoded for a text pipeline. */
  templateBase64: string
}

export interface PushResult {
  events: NormalizedEvent[]
  rejected: number
  /** Vendor module that claimed the payload. */
  vendor: string
  /**
   * The reply this firmware is waiting on, or null when it needs none.
   *
   * Non-null only when scans were actually accepted. A device we refuse to
   * record for is a device we must not tell "OK": staying silent makes it hold
   * the scans and retry, so adding its serial to devices.yaml recovers them
   * instead of losing the window.
   */
  ack: string | null
  /**
   * Status to answer with when the STATUS is the acknowledgement and no body is
   * involved. Null means the transport's normal response applies.
   */
  ackStatus: number | null
  /**
   * Raw bytes to send alongside ackStatus, for the one case where a firmware
   * needs BOTH a specific status AND a body in its own wire format — not the
   * generic `{received, rejected}` JSON the transport falls back to.
   *
   * Exists because of a hard-won distinction on M82 hardware: a bare 200 with
   * no body did NOT trigger the device to flush its locally-logged backlog,
   * even though a 200 carrying a real length-prefixed body did, in a dozen
   * separate live trials. The generic fallback response sends loose JSON with
   * no length prefix — plausibly indistinguishable, from the device's side,
   * from no body at all. Ignored when ackStatus is null.
   */
  ackBody: Buffer | null
}

export interface GatewayStats {
  startedAt: string
  received: number
  accepted: number
  rejectedUnknownSerial: number
  unparsed: number
  archived: number
  lastPushAt: string | null
  lastSerial: string | null
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('::ffff:127.') === true
}

/**
 * True when the bytes received so far are already a whole JSON document.
 *
 * Used to end a raw-TCP frame early. The idle timer below is the general
 * boundary for protocols that are not self-delimiting, but a terminal that is
 * blocking on an acknowledgement should not have to wait it out — a quarter of
 * a second per scan is the difference between a reader that feels instant and
 * one that feels broken.
 */
function isCompleteJson(chunks: Buffer[]): boolean {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  // Beyond this it is a template or image upload, not a scan frame; fall back
  // to the idle timer rather than re-parsing megabytes on every chunk.
  if (total === 0 || total > 512 * 1024) return false

  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return false

  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export function createServer(deps: ServerDeps) {
  const { config, forwarder } = deps

  const stats: GatewayStats = {
    startedAt: new Date().toISOString(),
    received: 0,
    accepted: 0,
    rejectedUnknownSerial: 0,
    unparsed: 0,
    archived: 0,
    lastPushAt: null,
    lastSerial: null,
  }

  const bySerial = new Map<string, DeviceConfig>(config.devices.map((d) => [d.serial, d]))

  // M82 enrolment payloads arrive split across several POSTs, all sharing a
  // request_code and serial and numbered by blk_no. One assembler instance
  // per server, because the blocks of one push must be collected across the
  // separate HTTP requests that carry them.
  const m82Assembler = new M82Assembler()

  /**
   * Feeds one block of an M82 `realtime_enroll_data` push to the assembler,
   * and — once the whole push is in hand — emits one onM82Credential call per
   * non-empty credential slot.
   *
   * Returns whether the push is now complete, which is what decides the
   * acknowledgement: see the M82_ENROLL branch in handlePayload for why that
   * decision cannot be made by the parser alone.
   */
  function handleM82Enrollment(input: VendorInput, source: string): boolean {
    const serial = m82DeviceId(input) ?? input.deviceSerial ?? null
    if (!serial) {
      log.warn('M82 enrolment push with no dev_id header; cannot assemble', { source })
      return false
    }

    const blkNo = Number(input.headers?.['blk_no'])
    const assembled = m82Assembler.add(
      { serial, requestCode: M82_ENROLL },
      Number.isFinite(blkNo) ? blkNo : null,
      input.body
    )
    if (!assembled) return false   // more blocks needed, or the frame was malformed

    const { json, blobs } = assembled
    const externalUserId = json?.['user_id']
    const userName = json?.['user_name']
    const array = json?.['enroll_data_array']

    if (typeof externalUserId !== 'string' || !Array.isArray(array)) {
      log.warn('M82 enrolment push assembled but had no usable user_id/enroll_data_array', { source, serial })
      return true   // still complete — do not leave the device retrying a push we cannot use
    }

    let emitted = 0
    for (const entry of array) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const backupNumber = Number(row['backup_number'])
      const blobRef = row['enroll_data']
      if (!Number.isFinite(backupNumber) || typeof blobRef !== 'string') continue

      // "BIN_1", "BIN_2"... are 1-indexed into the blobs in wire order.
      const match = /^BIN_(\d+)$/.exec(blobRef)
      if (!match) continue
      const blob = blobs[Number(match[1]) - 1]

      // A credential slot with no captured data yet — the device reserves the
      // slot before it is filled. Nothing to store.
      if (!blob || blob.length === 0) continue

      deps.onM82Credential?.({
        deviceSerial: serial,
        externalUserId,
        name: typeof userName === 'string' ? userName : null,
        backupNumber,
        templateBase64: blob.toString('base64'),
      })
      emitted += 1
    }

    log.info('M82 enrolment push assembled', {
      source, serial, externalUserId, credentials: emitted, totalBytes: assembled.totalBytes,
    })
    return true
  }

  /**
   * Turns one received payload into forwarded events.
   *
   * Shared by every transport — HTTP, WebSocket and raw TCP all funnel here, so
   * the allowlist, the vendor choice and the spool behave identically no matter
   * how a device chose to connect.
   */
  function handlePayload(
    input: VendorInput,
    source: string,
    meta: { transport?: string; method?: string; sourceIp?: string } = {}
  ): PushResult {
    stats.received += 1
    stats.lastPushAt = new Date().toISOString()

    // Choosing a vendor is chicken-and-egg: the device row names the parser, but
    // the serial that finds the row often lives inside the body only the parser
    // can read. So try the candidates in confidence order and take the first
    // that yields events, rather than defaulting to `generic` and quietly
    // mis-parsing a reader whose format generic does not understand.
    const hinted = input.deviceSerial ? bySerial.get(input.deviceSerial) : undefined
    const candidates = hinted
      ? [hinted.vendor]
      : [...new Set([input.query?.vendor, ...config.devices.map((d) => d.vendor), 'generic'].filter(
          (v): v is string => typeof v === 'string' && v.length > 0
        ))]

    let parsed: NormalizedEvent[] = []
    let vendorName = candidates[0] ?? 'generic'

    for (const candidate of candidates) {
      try {
        const events = getParser(candidate).parse({
          ...input,
          timezone: hinted?.timezone ?? config.timezone,
        })
        if (events.length > 0) {
          parsed = events
          vendorName = candidate
          break
        }
      } catch (e) {
        // One parser throwing must not stop the others from trying — a badly
        // framed payload for vendor A may be perfectly valid for vendor B.
        log.warn('parser threw, trying next candidate', { source, vendor: candidate, ...errFields(e) })
      }
    }

    // Archive first, and archive everything — parsed, unparsed, heartbeat,
    // handshake. The payloads we could NOT read are the most valuable ones to
    // keep, because they are what the next parser gets written from.
    const archive = (serial: string | null, count: number) => {
      if (!deps.archive) return
      stats.archived += 1
      deps.archive.submit([
        buildRawPayload({
          body: input.body,
          transport: meta.transport ?? 'http',
          method: meta.method,
          path: input.path,
          query: input.query,
          headers: input.headers,
          deviceSerial: serial,
          vendor: count > 0 ? vendorName : null,
          parsedEventCount: count,
          sourceIp: meta.sourceIp,
        }),
      ])
    }

    if (parsed.length === 0) {
      // An M82 enrolment push is detected by its own request_code header,
      // never by vendorName — vendorName is only updated when a candidate's
      // parse() returns events, and an enrolment push correctly returns none,
      // so vendorName here could still be whatever candidate was tried first.
      const requestCode = m82RequestCode(input)

      if (requestCode === M82_ENROLL) {
        // Acknowledgement for this one is decided HERE, not by the parser's
        // ackStatus, because it must track assembly progress the parser
        // cannot see. Confirming block 1 before every block has arrived risks
        // the device concluding the WHOLE transfer is delivered and never
        // sending the rest — we have never yet observed a blk_no beyond 1,
        // which is consistent with that risk being real rather than
        // hypothetical. So: 204 only once assembly is complete: otherwise no
        // opinion, which lets the transport's default apply and the device
        // keep sending.
        const complete = handleM82Enrollment(input, source)
        return {
          events: [], rejected: 0, vendor: vendorName, ack: null,
          ackStatus: complete ? 204 : null, ackBody: null,
        }
      }

      // The M82 heartbeat: not just answered, but answered with a real body in
      // the device's own wire format. This is NOT decided by the parser's
      // ackStatus for the same reason enrolment isn't — server.ts is where the
      // hard-won behaviour lives. A bare 200 with no body (the generic
      // fallback, further down) left a device holding 37 locally-logged
      // punches sending none of them; a 200 carrying this exact length-prefixed
      // shape made it flush its backlog on the very next cycle, in every one of
      // a dozen live trials, regardless of what the JSON inside said.
      if (requestCode === M82_HEARTBEAT) {
        return {
          events: [], rejected: 0, vendor: vendorName, ack: null,
          ackStatus: 200, ackBody: encodeM82Body({ result: 0 }),
        }
      }

      stats.unparsed += 1
      archive(input.deviceSerial ?? null, 0)
      log.warn('push produced no events (archived for analysis)', {
        source,
        bytes: input.body.length,
        // The first bytes, so an unrecognised format is diagnosable from the
        // log alone without turning on debug and waiting for another scan.
        preview: input.body.subarray(0, 200).toString('utf8'),
      })

      // A payload with no events is not necessarily a payload with no reply.
      // Vendors other than M82 (handled above) may still have a firmware-level
      // opinion about how to answer a payload that produced nothing.
      let idleStatus: number | null = null
      try {
        idleStatus = getParser(vendorName).ackStatus?.({
          ...input,
          timezone: hinted?.timezone ?? config.timezone,
        }, []) ?? null
      } catch (e) {
        log.error('failed to choose acknowledgement status', { source, vendor: vendorName, ...errFields(e) })
      }
      return { events: [], rejected: 0, vendor: vendorName, ack: null, ackStatus: idleStatus, ackBody: null }
    }

    archive(parsed[0]?.deviceSerial ?? null, parsed.length)

    const accepted: NormalizedEvent[] = []
    let rejected = 0

    for (const event of parsed) {
      const device = bySerial.get(event.deviceSerial)

      if (!device && config.strictSerials) {
        // Logged loudly rather than silently dropped: an unknown serial is
        // either a device someone forgot to add to devices.yaml — which is a
        // five-second fix — or someone POSTing fabricated attendance, which
        // needs to be visible.
        rejected += 1
        stats.rejectedUnknownSerial += 1
        log.warn('rejected push from unknown serial', {
          source, serial: event.deviceSerial, hint: 'add it to devices.yaml, or set STRICT_SERIALS=false while capturing',
        })
        continue
      }

      // A device configured with an explicit direction overrides whatever the
      // firmware claimed. That is how a reader physically wired as the exit
      // door stays an exit door even when its firmware reports every scan as
      // a check-in.
      accepted.push(device?.direction ? { ...event, direction: device.direction } : event)
    }

    if (accepted.length > 0) {
      stats.accepted += accepted.length
      stats.lastSerial = accepted[0]?.deviceSerial ?? null
      deps.onEvents?.(accepted, source)
      forwarder.submit(accepted)
      log.info('accepted scans', {
        source,
        vendor: vendorName,
        count: accepted.length,
        serial: accepted[0]?.deviceSerial,
      })
    }

    // Built only from accepted scans, and only after they are spooled — so the
    // "OK" a terminal hears always means the scan is durably ours, never just
    // that the bytes arrived.
    let ack: string | null = null
    if (accepted.length > 0) {
      try {
        ack = getParser(vendorName).ack?.(input, accepted) ?? null
      } catch (e) {
        // A parser that cannot phrase its acknowledgement must not lose the
        // scan that is already spooled. Stay silent and let the device retry.
        log.error('failed to build device acknowledgement', { source, vendor: vendorName, ...errFields(e) })
      }
    }

    // Status-only acknowledgements are asked for even when there were no
    // events, because for those firmwares a heartbeat is a request that still
    // needs answering correctly — and answering it wrongly is what starts an
    // unbounded retry storm. The parser is handed the accepted events and
    // decides for itself: it must not confirm a SCAN it cannot see in that
    // list, which keeps the "never acknowledge what you did not store" rule
    // intact while still letting it answer a poll.
    let ackStatus: number | null = null
    if (ack === null) {
      try {
        ackStatus = getParser(vendorName).ackStatus?.(input, accepted) ?? null
      } catch (e) {
        log.error('failed to choose acknowledgement status', { source, vendor: vendorName, ...errFields(e) })
      }
    }

    return { events: accepted, rejected, vendor: vendorName, ack, ackStatus, ackBody: null }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'gateway'}`)
    const send = (status: number, body: unknown, type = 'application/json') => {
      const payload = type === 'application/json' ? JSON.stringify(body) : String(body)
      res.writeHead(status, { 'content-type': type })
      res.end(payload)
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return send(200, { status: 'ok' })
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      // Queue contents, device serials and recent errors are operational data,
      // not a public health check. Inspect from inside the container only.
      if (!isLoopback(req.socket.remoteAddress)) return send(404, { error: 'not found' })
      return send(200, {
        status: 'ok',
        startedAt: stats.startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        vendors: vendorNames(),
        devices: config.devices.map((d) => ({
          serial: d.serial, vendor: d.vendor, mode: d.mode, label: d.label ?? null, branch: d.branch ?? null,
        })),
        pushes: stats,
        archive: deps.archive
          ? { pending: deps.archive.pending, lastSuccessAt: deps.archive.lastSuccessAt, lastError: deps.archive.lastError }
          : null,
        forwarder: {
          pending: forwarder.pending,
          lastSuccessAt: forwarder.lastSuccessAt,
          lastErrorAt: forwarder.lastErrorAt,
          lastError: forwarder.lastError,
          totals: forwarder.totals,
        },
        // Per-destination detail. The aggregate above hides the case that
        // matters most once there is fan-out: everything healthy except one
        // third-party webhook quietly building a backlog.
        destinations: forwarder.destinations?.() ?? null,
      })
    }

    const isCamsCallback = url.pathname === '/callbacks/cams'
    if (isCamsCallback && req.method !== 'POST') {
      return send(405, { error: 'method not allowed' })
    }

    const chunks: Buffer[] = []
    let size = 0
    let aborted = false

    req.on('data', (c: Buffer) => {
      size += c.length
      // A terminal uploading a fingerprint template can send megabytes. Cap it
      // so a misconfigured device cannot exhaust memory on a shared VPS.
      if (size > 4 * 1024 * 1024) {
        aborted = true
        res.writeHead(413, { 'content-type': 'text/plain' })
        res.end('too large')
        req.destroy()
        return
      }
      chunks.push(c)
    })

    req.on('end', () => {
      if (aborted) return

      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v
      }
      const query = Object.fromEntries(url.searchParams)
      let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks)

      if (isCamsCallback) {
        if (config.camsAuthTokens.length === 0) {
          return send(503, { error: 'Cams callbacks are not configured' })
        }
        try {
          body = decryptCamsCallback(body, config.camsSecurityKey)
        } catch (e) {
          log.warn('rejected unreadable encrypted Cams callback', errFields(e))
          return send(400, { error: 'invalid encrypted callback' })
        }
        if (!validCamsAuthToken(camsAuthToken(body), config.camsAuthTokens)) {
          log.warn('rejected Cams callback with invalid AuthToken', {
            sourceIp: req.socket.remoteAddress,
          })
          return send(401, { error: 'invalid AuthToken' })
        }
        query.vendor = 'cams'
      }

      let result: PushResult
      try {
        result = handlePayload(
          {
            body,
            path: url.pathname,
            query,
            headers,
            deviceSerial: query.SN ?? query.sn ?? query.serial ?? undefined,
          },
          `http ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`,
          {
            transport: 'http',
            method: req.method ?? undefined,
            // Behind Caddy the socket address is the proxy, so the forwarded
            // header is the only way to know which branch a push came from.
            sourceIp: headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? undefined,
          }
        )
      } catch (e) {
        log.error('callback processing failed', errFields(e))
        // Cams explicitly requires an immediate acknowledgement even when our
        // internal processing fails. Durable spooling handles the retry path.
        if (isCamsCallback) return send(200, { status: 'done' })
        return send(500, { error: 'processing failed' })
      }

      if (isCamsCallback) return send(200, { status: 'done' })

      // A vendor module that defines an acknowledgement gets the last word on
      // what this device hears. FkWeb terminals, for one, match the reply
      // against the record they sent and re-send until it comes back.
      if (result.ack !== null) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(result.ack)
      }

      // Some firmware reads the status alone. M82 terminals re-send a record
      // indefinitely on a 200 — no matter what the body says — and treat a 204
      // as "stored, forget it". Answering with the wrong one is invisible until
      // you notice the same punch arriving three times a second.
      //
      // ackBody is the one exception to "the body doesn't matter": the M82
      // heartbeat needs its 200 to carry a real body in the device's own wire
      // format, or it does not trigger the backlog flush it exists to trigger.
      // See the M82_HEARTBEAT branch in handlePayload.
      if (result.ackStatus !== null) {
        if (result.ackBody) {
          res.writeHead(result.ackStatus, { 'content-type': 'application/octet-stream' })
          return res.end(result.ackBody)
        }
        res.writeHead(result.ackStatus)
        return res.end()
      }

      // ADMS-family firmware expects the literal string "OK" and retries on
      // anything else. Replying JSON to those devices makes them resend forever.
      if (url.pathname.includes('iclock') || url.pathname.includes('cdata')) {
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end('OK')
      }

      send(200, { received: result.events.length, rejected: result.rejected })
    })
  })

  // ── WebSocket, on the same port ────────────────────────────────────────────
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws, req) => {
    const from = req.socket.remoteAddress ?? 'unknown'
    const url = new URL(req.url ?? '/', 'http://gateway')
    const query = Object.fromEntries(url.searchParams)
    log.info('websocket connected', { from, path: url.pathname })

    ws.on('message', (data) => {
      const body = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer)
      const result = handlePayload(
        { body, path: url.pathname, query, deviceSerial: query.SN ?? query.sn ?? query.serial },
        `ws ${from}`,
        { transport: 'ws', sourceIp: from }
      )
      // Acknowledge: firmware that does not hear back tends to re-send the
      // whole buffer on the next connection. A vendor-specific acknowledgement
      // wins over the bare "OK" when the parser supplies one.
      try { ws.send(result.ack ?? 'OK') } catch { /* peer already gone */ }
    })

    ws.on('error', (e) => log.warn('websocket error', { from, ...errFields(e) }))
    ws.on('close', (code) => log.info('websocket closed', { from, code }))
  })

  // ── Raw TCP, for LogClient-style firmware ──────────────────────────────────
  const tcpServers: net.Server[] = []
  for (const port of config.tcpPorts) {
    const tcp = net.createServer((socket) => {
      const from = `${socket.remoteAddress}:${socket.remotePort}`
      log.info('tcp connected', { port, from })

      // Buffer until the peer pauses. These protocols are not self-delimiting
      // in any way we know yet, so a short idle gap is the only frame boundary
      // available — and handing the parser a half-frame would corrupt a scan.
      let pending: Buffer[] = []
      let idle: NodeJS.Timeout | null = null

      const flush = () => {
        if (idle) { clearTimeout(idle); idle = null }
        if (pending.length === 0) return
        const body = Buffer.concat(pending)
        pending = []

        const result = handlePayload({ body }, `tcp:${port} ${from}`, {
          transport: `tcp:${port}`,
          sourceIp: socket.remoteAddress ?? undefined,
        })

        // For the FkWeb family this reply IS the protocol. The terminal holds
        // the scan in its own buffer until it hears back and re-sends
        // otherwise, so a listener that accepts bytes and says nothing is
        // indistinguishable — from the terminal's side — from no listener.
        if (result.ack !== null && !socket.destroyed) {
          socket.write(result.ack, (e) => {
            if (e) log.warn('tcp acknowledgement write failed', { port, from, ...errFields(e) })
          })
        }
      }

      socket.on('data', (chunk: Buffer) => {
        pending.push(chunk)
        // A frame that is already complete JSON needs no boundary guess, and
        // the device is waiting on the answer.
        if (isCompleteJson(pending)) return flush()
        if (idle) clearTimeout(idle)
        idle = setTimeout(flush, 250)
      })
      socket.on('close', () => { if (idle) clearTimeout(idle); flush() })
      socket.on('error', (e) => log.warn('tcp error', { port, from, ...errFields(e) }))
    })

    tcp.on('error', (e: NodeJS.ErrnoException) => {
      log.error('tcp listener failed', { port, code: e.code, ...errFields(e) })
    })
    tcpServers.push(tcp)
  }

  return {
    server,
    stats,
    handlePayload,
    listen(): void {
      server.listen(config.httpPort, '0.0.0.0', () => {
        log.info('listening for device pushes', { httpPort: config.httpPort, websocket: true })
      })
      for (const [i, tcp] of tcpServers.entries()) {
        const port = config.tcpPorts[i]
        if (port) tcp.listen(port, '0.0.0.0', () => log.info('listening on raw tcp', { port }))
      }
    },
    close(): void {
      server.close()
      for (const tcp of tcpServers) tcp.close()
    },
  }
}
