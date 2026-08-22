import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'
import type { Config, DeviceConfig } from './config.ts'
import type { Forwarder } from './forward.ts'
import type { NormalizedEvent, VendorInput } from './types.ts'
import type { RawPayload } from './archive.ts'
import { buildRawPayload } from './archive.ts'
import { getParser, vendorNames } from './vendors/index.ts'
import { log, errFields } from './log.ts'
import { camsAuthToken, decryptCamsCallback, validCamsAuthToken } from './vendors/cams/security.ts'

// The listening half of the gateway: terminals push, this receives.
//
// Routing is deliberately loose. Firmware URL fields are inconsistent and often
// undocumented, so rather than demand an exact path, any POST that is not a
// known control route is treated as a device push. A device whose payload we
// can read is more useful than a device that got a tidy 404.

export interface ServerDeps {
  config: Config
  forwarder: Forwarder<NormalizedEvent>
  /** Optional raw archive. Absent in tests that only care about parsing. */
  archive?: Forwarder<RawPayload>
  /** Called for every accepted push, before forwarding. Used by /status and tests. */
  onEvents?: (events: NormalizedEvent[], source: string) => void
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
  ): { events: NormalizedEvent[]; rejected: number } {
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
      stats.unparsed += 1
      archive(input.deviceSerial ?? null, 0)
      log.warn('push produced no events (archived for analysis)', {
        source,
        bytes: input.body.length,
        // The first bytes, so an unrecognised format is diagnosable from the
        // log alone without turning on debug and waiting for another scan.
        preview: input.body.subarray(0, 200).toString('utf8'),
      })
      return { events: [], rejected: 0 }
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

    return { events: accepted, rejected }
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
      return send(200, {
        status: 'ok',
        startedAt: stats.startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        vendors: vendorNames(),
        devices: config.devices.map((d) => ({
          serial: d.serial, vendor: d.vendor, mode: d.mode, label: d.label ?? null,
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

      let result: { events: NormalizedEvent[]; rejected: number }
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
      handlePayload(
        { body, path: url.pathname, query, deviceSerial: query.SN ?? query.sn ?? query.serial },
        `ws ${from}`,
        { transport: 'ws', sourceIp: from }
      )
      // Acknowledge: firmware that does not hear back tends to re-send the
      // whole buffer on the next connection.
      try { ws.send('OK') } catch { /* peer already gone */ }
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
        if (pending.length === 0) return
        const body = Buffer.concat(pending)
        pending = []
        handlePayload({ body }, `tcp:${port} ${from}`, {
          transport: `tcp:${port}`,
          sourceIp: socket.remoteAddress ?? undefined,
        })
      }

      socket.on('data', (chunk: Buffer) => {
        pending.push(chunk)
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
