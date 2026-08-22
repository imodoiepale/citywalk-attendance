// Maps everything the terminal exposes: which ports are open, which of them
// speak HTTP, and which known device-family endpoints answer.
//
//   node src/probe/scan-device.ts 192.168.1.150
//   node src/probe/scan-device.ts 192.168.1.150 --ports 80,5005,8080
//
// Read-only by design. Every request is a GET or an OPTIONS against a
// documentation or status path; nothing here enrolls, deletes, reboots or
// writes configuration. A scanner that can brick a live attendance terminal is
// not one worth running during business hours.
//
// Run this only against equipment you own or are authorised to test.

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = process.argv[2] ?? process.env.DEVICE_HOST ?? '192.168.1.150'

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// Ports these terminal families are known to use. Cheap to test, and the answer
// tells you which vendor's protocol documentation is even relevant.
const DEFAULT_PORTS = [
  21,    // FTP — some readers export logs this way
  22,    // SSH
  23,    // Telnet — often an unauthenticated debug shell on cheap firmware
  80,    // HTTP web UI
  443,   // HTTPS web UI
  554,   // RTSP, if the face camera streams
  1935,  // RTMP
  4370,  // ZKTeco standard
  5005,  // this terminal's configured comms port
  8000,  // Hikvision SDK / common alt-HTTP
  8080,  // alt-HTTP
  8081,
  8090,
  8443,
  8899,  // several Chinese OEM web UIs
  9922,  // some EBKN/Realand builds
  37777, // Dahua
]

// Paths worth trying on anything that speaks HTTP. Each is the "who are you"
// endpoint of a device family; whichever answers identifies the firmware.
const HTTP_PATHS = [
  { path: '/', note: 'root / web UI' },
  { path: '/index.html', note: 'static web UI' },
  { path: '/login.html', note: 'login page' },
  { path: '/cgi-bin/', note: 'CGI root' },
  { path: '/iclock/cdata', note: 'ZKTeco ADMS push endpoint' },
  { path: '/iclock/getrequest', note: 'ZKTeco ADMS command poll' },
  { path: '/ISAPI/System/deviceInfo', note: 'Hikvision ISAPI device info' },
  { path: '/cgi-bin/magicBox.cgi?action=getSystemInfo', note: 'Dahua system info' },
  { path: '/form/login', note: 'OEM form handler' },
  { path: '/goform/', note: 'OEM form handler' },
  { path: '/api/', note: 'generic REST root' },
  { path: '/api/device/info', note: 'generic REST device info' },
  { path: '/device.rsp', note: 'OEM status handler' },
  { path: '/config', note: 'config endpoint' },
  { path: '/status', note: 'status endpoint' },
]

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../captures')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `scan-${HOST}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

interface PortResult {
  port: number
  open: boolean
  banner: string | null
  speaksHttp: boolean
}

/** Connect, wait briefly for an unprompted banner, close. */
function checkPort(port: number, timeoutMs = 1500): Promise<PortResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let open = false
    let settled = false

    const socket = net.createConnection({ host: HOST, port, timeout: timeoutMs })
    const finish = () => {
      if (settled) return
      settled = true
      socket.destroy()
      const banner = Buffer.concat(chunks).toString('utf8').trim()
      resolve({ port, open, banner: banner || null, speaksHttp: false })
    }

    socket.on('connect', () => {
      open = true
      // Many services greet on connect (FTP, SSH, Telnet). Give them a moment
      // before deciding the port is silent.
      setTimeout(finish, 400)
    })
    socket.on('data', (b: Buffer) => chunks.push(b))
    socket.on('timeout', finish)
    socket.on('error', finish)
    socket.on('close', finish)
  })
}

interface PathResult {
  url: string
  note: string
  status: number | null
  server: string | null
  contentType: string | null
  bytes: number
  preview: string
  error: string | null
}

async function checkPath(port: number, scheme: string, p: string, note: string): Promise<PathResult> {
  const url = `${scheme}://${HOST}:${port}${p}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
    })
    const body = await res.text().catch(() => '')
    return {
      url,
      note,
      status: res.status,
      server: res.headers.get('server'),
      contentType: res.headers.get('content-type'),
      bytes: body.length,
      preview: body.replace(/\s+/g, ' ').slice(0, 160),
      error: null,
    }
  } catch (e) {
    return {
      url, note, status: null, server: null, contentType: null, bytes: 0, preview: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

const ports = flag('ports')
  ? flag('ports')!.split(',').map((p) => Number(p.trim())).filter(Boolean)
  : DEFAULT_PORTS

console.log(`scanning ${HOST} — ${ports.length} ports\n`)

// ── stage 1: which ports are open ────────────────────────────────────────────
const portResults = await Promise.all(ports.map((p) => checkPort(p)))
const open = portResults.filter((r) => r.open)

console.log('PORTS')
for (const r of portResults) {
  if (!r.open) continue
  const banner = r.banner ? `  banner: ${JSON.stringify(r.banner.slice(0, 80))}` : ''
  console.log(`  ${String(r.port).padEnd(6)} OPEN${banner}`)
}
if (open.length === 0) console.log('  none open — is the host right, and are you on the same LAN?')
const closed = portResults.filter((r) => !r.open).map((r) => r.port)
console.log(`  (closed/filtered: ${closed.join(', ') || 'none'})\n`)

// ── stage 2: which open ports answer HTTP, and on what paths ─────────────────
const pathResults: PathResult[] = []

for (const r of open) {
  // Try HTTPS only where it is conventional; a plaintext port will just refuse
  // the handshake and waste four seconds per path otherwise.
  const schemes = r.port === 443 || r.port === 8443 ? ['https'] : ['http']

  for (const scheme of schemes) {
    const probe = await checkPath(r.port, scheme, '/', 'root / web UI')
    if (probe.status === null) {
      console.log(`PORT ${r.port} (${scheme}) — not HTTP: ${probe.error}`)
      pathResults.push(probe)
      continue
    }

    r.speaksHttp = true
    console.log(`PORT ${r.port} (${scheme}) — SPEAKS HTTP${probe.server ? `, server: ${probe.server}` : ''}`)

    for (const { path: p, note } of HTTP_PATHS) {
      const result = p === '/' ? probe : await checkPath(r.port, scheme, p, note)
      pathResults.push(result)

      // 404 on a path that does not exist is the expected, boring answer; only
      // print the ones that told us something.
      if (result.status !== null && result.status !== 404) {
        console.log(
          `    ${String(result.status).padEnd(4)} ${p.padEnd(42)} ${result.note}` +
          (result.bytes ? `\n         ${result.preview.slice(0, 120)}` : '')
        )
      }
    }
    console.log('')
  }
}

fs.writeFileSync(
  outFile,
  JSON.stringify({ host: HOST, at: new Date().toISOString(), ports: portResults, paths: pathResults }, null, 2),
  'utf8'
)

// ── what it means ────────────────────────────────────────────────────────────
console.log('SUMMARY')
const http = open.filter((r) => r.speaksHttp)
console.log(`  open ports:      ${open.map((r) => r.port).join(', ') || 'none'}`)
console.log(`  speaking HTTP:   ${http.map((r) => r.port).join(', ') || 'none'}`)

if (http.length === 0) {
  console.log('')
  console.log('  No HTTP anywhere. This terminal has no browser interface — which settles')
  console.log('  the original question. Its 5005 is a proprietary protocol port, so the')
  console.log('  integration path is push mode: run `npm run capture` and point the')
  console.log("  terminal's Web Server URL at this machine.")
} else {
  console.log('')
  console.log('  There is a web interface. Open it in a browser and look for a')
  console.log('  server/cloud settings page — that is where the push URL goes.')
}

const risky = open.filter((r) => [21, 23].includes(r.port))
if (risky.length > 0) {
  console.log('')
  console.log(`  WARNING: ${risky.map((r) => r.port).join(', ')} open (FTP/Telnet).`)
  console.log('  These are usually unauthenticated on this class of hardware. Make sure')
  console.log('  the branch router never forwards them, and disable them on the device')
  console.log('  if its firmware allows it.')
}

console.log(`\nfull results: ${outFile}`)
