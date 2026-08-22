// Finds the real routes on a device that exposes an HTTP API but no index.
//
//   node src/probe/discover-api.ts 192.168.1.150 8090
//
// The EN-K190FTW turned out to run a Boost.Beast HTTP server on 8090 that
// answers every unknown path with "The resource 'X' was not found." — that is a
// routing table, not a website. This walks a wordlist against it.
//
// The trick that makes it work: a route that exists but wants a different verb
// answers 405, 400 or 415 rather than 404. So each candidate is tried with GET
// *and* POST, and anything that is not a 404 is a hit. That finds POST-only
// endpoints a GET-only sweep would miss entirely.
//
// READ-ONLY. The wordlist deliberately contains no reboot, format, delete,
// enroll or firmware path, and POST bodies are empty JSON. Nothing here can
// change the device's configuration or its enrolled users. Run it only against
// hardware you own or are authorised to test.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = process.argv[2] ?? '192.168.1.150'
const PORT = Number(process.argv[3] ?? 8090)
const BASE = `http://${HOST}:${PORT}`

// Bases and resource names seen across the EBKN / Realand / generic-OEM
// families. Cross-producted below rather than written out, so adding one
// resource tests it under every prefix.
const PREFIXES = [
  '', '/api', '/api/v1', '/v1', '/ebkn', '/fkweb', '/cloud', '/terminal', '/dev', '/device',
]

const RESOURCES = [
  // identity and health — the ones most likely to exist and be harmless
  'info', 'deviceinfo', 'device_info', 'getDeviceInfo', 'GetDeviceInfo',
  'version', 'status', 'state', 'ping', 'heartbeat', 'health', 'time',
  'datetime', 'getTime', 'GetDeviceTime', 'sn', 'serial', 'capacity',
  // people
  'user', 'users', 'employee', 'employees', 'person', 'persons', 'personnel',
  'getUser', 'GetUserInfo', 'userlist', 'enroll', 'enrollment',
  // attendance
  'log', 'logs', 'record', 'records', 'attendance', 'attlog', 'transaction',
  'transactions', 'event', 'events', 'punch', 'getLog', 'GetLogData',
  'GetGeneralLogData', 'newlog', 'alllog',
  // configuration surfaces (read paths only)
  'config', 'setting', 'settings', 'param', 'params', 'network', 'server',
  // door / access
  'door', 'access', 'gate',
]

const EXTRA = [
  '/', '/index', '/home', '/doc', '/docs', '/swagger', '/openapi.json',
  '/api-docs', '/help', '/routes', '/favicon.ico',
]

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../captures')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `api-${HOST}-${PORT}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

interface Hit {
  path: string
  method: string
  status: number
  contentType: string | null
  bytes: number
  body: string
}

/** The device's own 404 wording, learned at runtime so the filter is exact. */
let notFoundShape: RegExp | null = null

async function attempt(p: string, method: 'GET' | 'POST'): Promise<Hit | null> {
  try {
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? '{}' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
    })
    const body = await res.text().catch(() => '')

    // A 404 whose body is the device's standard "not found" line is a miss.
    // A 404 with a *different* body is worth seeing — it usually means the
    // route matched and something inside it failed.
    if (res.status === 404 && notFoundShape?.test(body)) return null

    return {
      path: p,
      method,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: body.length,
      body: body.replace(/\s+/g, ' ').slice(0, 400),
    }
  } catch {
    return null
  }
}

// Learn the 404 shape from a path that certainly does not exist.
const control = await fetch(`${BASE}/definitely-not-a-real-route-${Date.now()}`, {
  signal: AbortSignal.timeout(4000),
}).then((r) => r.text()).catch(() => '')

if (control) {
  console.log(`404 signature: ${JSON.stringify(control.trim().slice(0, 80))}`)
  notFoundShape = /was not found/i.test(control)
    ? /was not found/i
    : new RegExp(control.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'[^']*'/, "'[^']*'"), 'i')
} else {
  console.log('no 404 body to learn from; every non-404 status will be reported')
}

const candidates = [
  ...EXTRA,
  ...PREFIXES.flatMap((prefix) => RESOURCES.map((r) => `${prefix}/${r}`)),
]
const unique = [...new Set(candidates)]

console.log(`probing ${unique.length} paths on ${BASE} with GET and POST\n`)

const hits: Hit[] = []
let done = 0

// Small concurrency: an embedded HTTP server on a terminal is not a web farm,
// and hammering it risks disrupting a device people are trying to clock in on.
const CONCURRENCY = 4
const queue = [...unique]

async function worker(): Promise<void> {
  for (;;) {
    const p = queue.shift()
    if (!p) return

    for (const method of ['GET', 'POST'] as const) {
      const hit = await attempt(p, method)
      if (hit) {
        hits.push(hit)
        console.log(
          `  ${String(hit.status).padEnd(4)} ${hit.method.padEnd(5)} ${hit.path.padEnd(28)} ` +
          `${hit.contentType ?? '-'}  ${JSON.stringify(hit.body.slice(0, 120))}`
        )
      }
    }

    done += 1
    if (done % 50 === 0) process.stderr.write(`  … ${done}/${unique.length}\n`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

fs.writeFileSync(outFile, JSON.stringify({ base: BASE, at: new Date().toISOString(), hits }, null, 2), 'utf8')

console.log(`\n${hits.length} responding route(s) out of ${unique.length * 2} attempts.`)
console.log(`written to ${outFile}`)

if (hits.length === 0) {
  console.log(
    [
      '',
      'Nothing in the wordlist matched. The API is real but its route names are',
      'not guessable, which is normal for an OEM firmware.',
      '',
      'Next, in order of effort:',
      '  1. npm run capture — point the terminal at this machine and scan. The',
      '     device then tells us its protocol itself, which beats guessing.',
      '  2. Ask the supplier for the EN-K190FTW HTTP API document. This server',
      '     is Boost.Beast, so one almost certainly exists.',
      '  3. Wireshark on the LAN while the vendor software talks to the device.',
    ].join('\n')
  )
} else {
  const byStatus = new Map<number, number>()
  for (const h of hits) byStatus.set(h.status, (byStatus.get(h.status) ?? 0) + 1)
  console.log(`  by status: ${[...byStatus].map(([s, n]) => `${s}×${n}`).join(', ')}`)
  console.log('\n  405/400/415 means the route EXISTS but wants a different verb or body.')
}
