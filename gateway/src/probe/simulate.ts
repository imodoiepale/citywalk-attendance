// Pretends to be a terminal, so the whole chain can be proven before anyone
// stands in front of the real one.
//
//   node src/probe/simulate.ts                      # one in-scan, ebkn JSON
//   node src/probe/simulate.ts --pin 1027 --out     # a clock-out
//   node src/probe/simulate.ts --vendor zkteco      # ADMS tab-separated push
//   node src/probe/simulate.ts --repeat 2           # same scan twice: must dedupe
//
// Points at the gateway, not the app, so it exercises the parser, the
// allowlist, the spool, the signing and the app's ingest in one go — which is
// the whole path a real scan takes.

const args = process.argv.slice(2)
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1] : fallback
}
const has = (name: string): boolean => args.includes(`--${name}`)

const GATEWAY = (flag('gateway', process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080') ?? '').replace(/\/$/, '')
const SERIAL = flag('serial', process.env.DEVICE_SERIAL ?? 'ENS2025079')!
const PIN = flag('pin', '1027')!
const VENDOR = flag('vendor', 'ebkn')!
const REPEAT = Number(flag('repeat', '1'))

// The device's own wall clock, to the second — which is exactly what a real
// terminal sends, and what makes the dedupe key stable across a replay.
const now = new Date()
const local = new Intl.DateTimeFormat('sv-SE', {
  timeZone: process.env.TZ || 'Africa/Nairobi',
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(now).replace('T', ' ')

const direction = has('out') ? '1' : '0'

interface Shape {
  url: string
  body: string
  contentType: string
}

function build(): Shape {
  if (VENDOR === 'zkteco') {
    return {
      url: `${GATEWAY}/iclock/cdata?SN=${encodeURIComponent(SERIAL)}&table=ATTLOG`,
      body: `${PIN}\t${local}\t${direction}\t1\t0\t0\n`,
      contentType: 'text/plain',
    }
  }

  if (VENDOR === 'cams') {
    const token = process.env.CAMS_AUTH_TOKEN
    if (!token) {
      throw new Error('CAMS_AUTH_TOKEN is required for --vendor cams')
    }
    return {
      url: `${GATEWAY}/callbacks/cams`,
      body: JSON.stringify({
        RealTime: {
          OperationID: `simulate-${Date.now()}`,
          SerialNumber: SERIAL,
          PunchLog: {
            Type: direction === '0' ? 'CheckIn' : 'CheckOut',
            InputType: 'Face',
            UserId: PIN,
            LogTime: `${local} GMT +0300`,
          },
          AuthToken: token,
          Time: new Date().toISOString(),
        },
      }),
      contentType: 'application/json',
    }
  }

  return {
    url: `${GATEWAY}/push?vendor=${encodeURIComponent(VENDOR)}`,
    body: JSON.stringify({
      cmd: 'sendlog',
      sn: SERIAL,
      count: 1,
      record: [{ enrollid: PIN, time: local, mode: 3, inout: Number(direction) }],
    }),
    contentType: 'application/json',
  }
}

const shape = build()

console.log(`simulating ${VENDOR} scan`)
console.log(`  gateway   ${GATEWAY}`)
console.log(`  serial    ${SERIAL}`)
console.log(`  pin       ${PIN}`)
console.log(`  local     ${local} (${process.env.TZ || 'Africa/Nairobi'})`)
console.log(`  direction ${direction === '0' ? 'in' : 'out'}`)
console.log('')

for (let i = 1; i <= REPEAT; i++) {
  try {
    const res = await fetch(shape.url, {
      method: 'POST',
      headers: { 'content-type': shape.contentType },
      body: shape.body,
      signal: AbortSignal.timeout(10_000),
    })
    const text = await res.text()
    console.log(`  attempt ${i}: HTTP ${res.status} ${text.trim()}`)
  } catch (e) {
    console.error(`  attempt ${i}: FAILED — ${e instanceof Error ? e.message : String(e)}`)
    console.error('\n  Is the gateway running? `npm start` in gateway/.')
    process.exit(1)
  }
}

console.log('')
console.log('The gateway accepting it is only half the story. Now check:')
console.log(`  curl ${GATEWAY}/status         # pending should settle back to 0`)
console.log('  the app: biometric_events should hold the scan')
console.log('  the app: /admin/devices/unmatched if the enrollment is not mapped yet')
if (REPEAT > 1) {
  console.log('')
  console.log(`Sent ${REPEAT}x with an identical timestamp: the app must report`)
  console.log('duplicates and create exactly one punch.')
}
