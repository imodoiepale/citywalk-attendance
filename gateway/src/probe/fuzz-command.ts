// Third stage of discovery.
//
// scan-device found an HTTP server on 8090. discover-api found that GET 404s on
// everything while POST to *any* path returns the same envelope:
//
//   {"code":"LAN_EXP-1000","msg":"未知异常","result":0,"success":false}
//
// "未知异常" is "unknown exception". So the path is not the route — the command
// is in the body, and an empty body means the dispatcher cannot tell what we
// want. This tries field-name/verb combinations until the device answers
// something other than LAN_EXP-1000.
//
//   node src/probe/fuzz-command.ts 192.168.1.150 8090
//
// READ-ONLY. Every verb in the list reads or identifies; there is deliberately
// nothing that enrolls, deletes, unlocks a door, sets configuration or reboots.
// Run only against hardware you own or are authorised to test.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = process.argv[2] ?? '192.168.1.150'
const PORT = Number(process.argv[3] ?? 8090)
const BASE = `http://${HOST}:${PORT}`

// What the dispatcher might call the command field.
const KEYS = [
  'cmd', 'command', 'action', 'method', 'func', 'function', 'type', 'msgType',
  'msg_type', 'api', 'name', 'operation', 'op', 'service', 'interface', 'code',
  'event', 'request', 'req', 'transType', 'trans_type',
]

// Read-only verbs, in the naming styles this firmware family uses.
const VERBS = [
  'getDeviceInfo', 'GetDeviceInfo', 'get_device_info', 'deviceInfo', 'device_info',
  'getDevInfo', 'getInfo', 'info',
  'getTime', 'GetDeviceTime', 'get_time', 'getDateTime',
  'getSN', 'getSerial', 'getVersion', 'getState', 'getStatus', 'heartbeat', 'ping',
  'getUserList', 'GetUserInfo', 'get_user_list', 'getUser', 'queryUser', 'getAllUser',
  'getLogData', 'GetGeneralLogData', 'get_log_data', 'getAttLog', 'getRecord',
  'getNewLog', 'queryLog', 'getAttendance',
  'getConfig', 'getParam', 'getNetwork',
]

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../captures')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `fuzz-${HOST}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

// The response we already know means "I did not understand you".
const BASELINE = 'LAN_EXP-1000'

interface Attempt {
  label: string
  body: string
  contentType: string
  path?: string
}

async function send(a: Attempt): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(`${BASE}${a.path ?? '/'}`, {
      method: 'POST',
      headers: { 'content-type': a.contentType },
      body: a.body,
      signal: AbortSignal.timeout(5000),
    })
    return { status: res.status, body: (await res.text().catch(() => '')).trim() }
  } catch {
    return null
  }
}

const novel = new Map<string, { label: string; status: number; body: string }>()

async function tryIt(a: Attempt): Promise<void> {
  const res = await send(a)
  if (!res) return

  // Anything that is not the known "unknown exception" is a real signal — the
  // dispatcher understood enough to fail differently.
  if (res.body.includes(BASELINE)) return

  const key = `${res.status}:${res.body}`
  if (!novel.has(key)) {
    novel.set(key, { label: a.label, status: res.status, body: res.body })
    console.log(`\n★ ${a.label}`)
    console.log(`   → ${res.status} ${res.body.slice(0, 400)}`)
  }
  fs.appendFileSync(outFile, JSON.stringify({ ...a, ...res, at: new Date().toISOString() }) + '\n', 'utf8')
}

console.log(`fuzzing ${BASE} — ${KEYS.length} field names × ${VERBS.length} verbs\n`)
console.log(`baseline (means "not understood"): ${BASELINE}`)
console.log('anything else is printed below.\n')

// ── 1. one key, one verb, flat JSON ──────────────────────────────────────────
for (const key of KEYS) {
  for (const verb of VERBS) {
    await tryIt({
      label: `json {${key}: "${verb}"}`,
      body: JSON.stringify({ [key]: verb }),
      contentType: 'application/json',
    })
  }
  process.stderr.write(`  key "${key}" done\n`)
}

// ── 2. envelope shapes ───────────────────────────────────────────────────────
// The reply has {code,msg,result,success}, so the request may well be wrapped
// the same way rather than flat.
for (const verb of ['getDeviceInfo', 'GetDeviceInfo', 'getTime']) {
  const shapes: Attempt[] = [
    { label: `nested data {cmd,data:{}} ${verb}`, contentType: 'application/json',
      body: JSON.stringify({ cmd: verb, data: {} }) },
    { label: `nested params {cmd,params:{}} ${verb}`, contentType: 'application/json',
      body: JSON.stringify({ cmd: verb, params: {} }) },
    { label: `with device id ${verb}`, contentType: 'application/json',
      body: JSON.stringify({ cmd: verb, deviceId: 1, sn: 'ENS2025079' }) },
    { label: `jsonrpc ${verb}`, contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', method: verb, params: {}, id: 1 }) },
    { label: `form-encoded cmd=${verb}`, contentType: 'application/x-www-form-urlencoded',
      body: `cmd=${verb}` },
    { label: `bare string "${verb}"`, contentType: 'text/plain', body: verb },
    { label: `xml <cmd>${verb}</cmd>`, contentType: 'application/xml',
      body: `<?xml version="1.0"?><request><cmd>${verb}</cmd></request>` },
    // The path is ignored for routing, but a dispatcher sometimes uses it as
    // the command when the body has none.
    { label: `path-as-command /${verb}`, contentType: 'application/json',
      body: '{}', path: `/${verb}` },
  ]
  for (const s of shapes) await tryIt(s)
}

// ── 3. malformed, to learn the error vocabulary ──────────────────────────────
// A different error for "bad JSON" than for "unknown command" tells us the
// dispatcher parses first and routes second, which narrows where {} failed.
await tryIt({ label: 'malformed json', body: '{', contentType: 'application/json' })
await tryIt({ label: 'empty body', body: '', contentType: 'application/json' })
await tryIt({ label: 'json array', body: '[]', contentType: 'application/json' })

console.log(`\n${novel.size} distinct non-baseline response(s).`)
console.log(`written to ${outFile}`)

if (novel.size === 0) {
  console.log(
    [
      '',
      'Every shape produced the same "unknown exception". The dispatcher wants',
      'something we have not guessed — likely a signed or session-bearing',
      'envelope, or a vendor-specific field name.',
      '',
      'Stop guessing here; the cost curve has turned. Do this instead:',
      '  1. npm run capture — point the terminal at this machine and scan. The',
      '     device volunteers its own protocol, which is worth more than any',
      '     number of guesses at its API.',
      '  2. Ask the supplier for the EN-K190FTW HTTP API document. The server is',
      '     Boost.Beast with a JSON envelope, so one exists.',
    ].join('\n')
  )
}
