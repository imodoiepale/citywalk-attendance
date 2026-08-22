// PHASE 0 — protocol capture. Run this on a laptop on the same LAN as the
// terminal, point the terminal's "Web Server URL" at it, and scan a finger.
//
// Nobody knows what the EN-K190FTW's M82 firmware puts on the wire. It offers
// FkWeb, WebSocket and LogClient modes, and public reverse-engineering of the
// EBKN/Realand family describes a *related* protocol, not necessarily this
// build. Rather than guess a parser and spend a week debugging a fiction, this
// binds every plausible transport at once, accepts literally anything, and
// writes down exactly what arrives.
//
//   node src/probe/capture.ts
//
// Then try each row of the table in the README until something lands. Whatever
// it writes to captures/ becomes the fixture the real parser is written against.

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const HTTP_PORT = Number(process.env.CAPTURE_HTTP_PORT ?? 8080)
const TCP_PORTS = (process.env.CAPTURE_TCP_PORTS ?? '5005,8090,4370')
  .split(',').map((p) => Number(p.trim())).filter(Boolean)

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../captures')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

let n = 0

/**
 * Records one observation.
 *
 * Bodies are kept as base64 *and* as a UTF-8 rendering *and* as a hex dump.
 * Which one is readable tells you most of what you need: if the UTF-8 is JSON
 * the firmware speaks FkWeb-over-HTTP, if it is tab-separated it is ADMS-like,
 * and if only the hex makes sense it is a binary frame and the hex is what the
 * parser gets written against.
 */
function record(kind: string, detail: Record<string, unknown>, body?: Buffer): void {
  n += 1
  const entry: Record<string, unknown> = { seq: n, at: new Date().toISOString(), kind, ...detail }

  if (body && body.length > 0) {
    entry.bytes = body.length
    entry.base64 = body.toString('base64')
    entry.utf8 = body.toString('utf8')
    entry.hex = hexDump(body)
  }

  fs.appendFileSync(outFile, JSON.stringify(entry) + '\n', 'utf8')

  console.log(`\n─── #${n} ${kind} ${'─'.repeat(Math.max(0, 50 - kind.length))}`)
  for (const [k, v] of Object.entries(detail)) {
    console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  if (body && body.length > 0) {
    console.log(`  bytes: ${body.length}`)
    console.log(`  utf8 : ${JSON.stringify(body.toString('utf8').slice(0, 600))}`)
    console.log(hexDump(body).split('\n').map((l) => '  ' + l).join('\n'))
  }
}

/** Classic 16-byte-per-row hex + printable-ASCII dump. Capped so a template blob does not fill the terminal. */
function hexDump(buf: Buffer, limit = 512): string {
  const slice = buf.subarray(0, limit)
  const rows: string[] = []
  for (let i = 0; i < slice.length; i += 16) {
    const chunk = slice.subarray(i, i + 16)
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)
    const ascii = [...chunk].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    rows.push(`${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`)
  }
  if (buf.length > limit) rows.push(`… ${buf.length - limit} more bytes`)
  return rows.join('\n')
}

// ── HTTP: any method, any path ───────────────────────────────────────────────
// The device's URL shape is unknown, so nothing is routed. Everything is
// accepted and answered 200 with a short body, because a firmware that gets a
// 404 usually stops retrying and we lose the chance to see a second packet.
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'x'}`)
    record('http', {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      from: req.socket.remoteAddress,
    }, Buffer.concat(chunks))

    // "OK" is what ADMS-family firmware expects; harmless to anything else.
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('OK')
  })
})

// ── WebSocket on the same port ───────────────────────────────────────────────
const wss = new WebSocketServer({ server })
wss.on('connection', (ws, req) => {
  record('ws-open', { path: req.url, headers: req.headers, from: req.socket.remoteAddress })
  ws.on('message', (data, isBinary) => {
    record('ws-message', { isBinary }, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
  })
  ws.on('close', (code, reason) => record('ws-close', { code, reason: reason.toString() }))
  ws.on('error', (e) => record('ws-error', { message: e.message }))
})

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`http + ws  listening on 0.0.0.0:${HTTP_PORT}`)
})

// ── Raw TCP, for LogClient mode and anything proprietary ─────────────────────
for (const port of TCP_PORTS) {
  net.createServer((socket) => {
    const from = `${socket.remoteAddress}:${socket.remotePort}`
    record('tcp-open', { port, from })
    socket.on('data', (buf) => record('tcp-data', { port, from }, buf))
    socket.on('close', () => record('tcp-close', { port, from }))
    socket.on('error', (e) => record('tcp-error', { port, from, message: e.message }))
  }).listen(port, '0.0.0.0', () => {
    console.log(`tcp        listening on 0.0.0.0:${port}`)
  }).on('error', (e: NodeJS.ErrnoException) => {
    // A port already in use is worth saying out loud rather than dying: the
    // other listeners are still useful.
    console.error(`tcp        could NOT listen on ${port}: ${e.code ?? e.message}`)
  })
}

console.log(`\nwriting to ${outFile}`)
console.log('waiting for the terminal. Scan a finger, then Ctrl+C.\n')
console.log('If nothing arrives, the Windows firewall is the usual culprit — see gateway/README.md.')

process.on('SIGINT', () => {
  console.log(`\n\n${n} observation(s) written to ${outFile}`)
  process.exit(0)
})
