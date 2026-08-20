// End-to-end check of the biometric ingest pipeline against a running app.
//
//   node scripts/verify-biometric.mjs .env.local http://localhost:3101
//
// Exercises the paths that matter and are easy to get wrong: a signed webhook
// creating a punch, the same payload replayed creating nothing, an OUT scan
// closing the shift, a restricted-area reader NOT creating a punch, an unknown
// enrollment queuing instead of vanishing, and the ZKTeco push endpoint's
// plain-text protocol.
//
// Requires BIOMETRIC_WEBHOOK_SECRET and BIOMETRIC_PUSH_TOKEN to be set for the
// running server, and the same values here. Creates its own device, staff and
// scans, and deletes all of them in a finally block.

import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const envPath = process.argv[2] ?? '.env.local'
const APP = (process.argv[3] ?? 'http://localhost:3101').replace(/\/$/, '')

const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)

const U = env.NEXT_PUBLIC_SUPABASE_URL
const S = env.SUPABASE_SERVICE_ROLE_KEY
const SECRET = env.BIOMETRIC_WEBHOOK_SECRET
const PUSH_TOKEN = env.BIOMETRIC_PUSH_TOKEN
assert.ok(U && S, 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
assert.ok(SECRET, 'BIOMETRIC_WEBHOOK_SECRET required (must match the running server)')
assert.ok(PUSH_TOKEN, 'BIOMETRIC_PUSH_TOKEN required (must match the running server)')

const H = { apikey: S, Authorization: `Bearer ${S}`, 'Content-Type': 'application/json' }
const rest = (path, init = {}) => fetch(`${U}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })

const stamp = Date.now()
const CLOCK_SERIAL = `TESTCLOCK${stamp}`
const DOOR_SERIAL = `TESTDOOR${stamp}`
const PIN = `9${String(stamp).slice(-6)}`
const UNKNOWN_PIN = `8${String(stamp).slice(-6)}`

let userId = null
const deviceIds = []

/** POST a signed batch to the generic webhook. */
async function postSigned(events) {
  const body = JSON.stringify({ events })
  const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
  const res = await fetch(`${APP}/api/biometric/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': signature },
    body,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const punches = async () =>
  (await (await rest(`punches?select=id,clock_in_at,clock_out_at,method&user_id=eq.${userId}&order=clock_in_at`)).json())

const eventsFor = async (pin) =>
  (await (await rest(`biometric_events?select=status,error&external_user_id=eq.${pin}`)).json())

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

try {
  const branches = await (await rest('branches?select=id,name&is_active=eq.true&limit=1')).json()
  const branchId = branches[0].id

  // --- fixtures -----------------------------------------------------------
  const user = await (await fetch(`${U}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      email: `biometric.${stamp}@invalid.test`, email_confirm: true,
      user_metadata: { full_name: 'Biometric Probe', branch_id: branchId },
    }),
  })).json()
  userId = user.id
  assert.ok(userId, `probe staff created: ${JSON.stringify(user).slice(0, 200)}`)

  const mk = async (serial, name, purpose, direction) => {
    const r = await rest('biometric_devices', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        serial_no: serial, name, purpose, direction,
        branch_id: purpose === 'attendance' ? branchId : null,
        location_label: purpose === 'access' ? 'Server room' : null,
      }),
    })
    const [row] = await r.json()
    deviceIds.push(row.id)
    return row
  }
  await mk(CLOCK_SERIAL, 'Probe clock', 'attendance', 'both')
  await mk(DOOR_SERIAL, 'Probe server room door', 'access', 'both')

  await rest('biometric_enrollments', {
    method: 'POST',
    body: JSON.stringify({ vendor: 'zkteco', device_user_id: PIN, profile_id: userId }),
  })

  // --- 1. a scan opens a shift -------------------------------------------
  const inAt = new Date(Date.now() - 3 * 3600_000).toISOString()
  let res = await postSigned([{ device_serial: CLOCK_SERIAL, user_id: PIN, timestamp: inAt, direction: 'in' }])
  check('signed webhook accepted', res.status === 200, `status ${res.status}`)
  let rows = await punches()
  check('an IN scan opens a punch', rows.length === 1 && rows[0].clock_out_at === null)
  check('the punch is recorded as biometric', rows[0]?.method === 'biometric', rows[0]?.method)

  // --- 2. replaying the same scan changes nothing -------------------------
  res = await postSigned([{ device_serial: CLOCK_SERIAL, user_id: PIN, timestamp: inAt, direction: 'in' }])
  rows = await punches()
  check('a replayed scan is deduped, not double-punched',
    rows.length === 1 && res.body?.duplicates === 1, JSON.stringify(res.body))

  // --- 3. an OUT scan closes it ------------------------------------------
  const outAt = new Date(Date.now() - 30 * 60_000).toISOString()
  await postSigned([{ device_serial: CLOCK_SERIAL, user_id: PIN, timestamp: outAt, direction: 'out' }])
  rows = await punches()
  check('an OUT scan closes the punch', rows.length === 1 && rows[0].clock_out_at !== null)
  check('clock_out_at is after clock_in_at',
    rows[0]?.clock_out_at && new Date(rows[0].clock_out_at) > new Date(rows[0].clock_in_at))

  // --- 4. a restricted-area reader must NOT clock anyone in ---------------
  const doorAt = new Date().toISOString()
  await postSigned([{ device_serial: DOOR_SERIAL, user_id: PIN, timestamp: doorAt, direction: 'in' }])
  rows = await punches()
  check('an access-control scan creates no punch', rows.length === 1, `${rows.length} punches`)
  const doorEvents = (await eventsFor(PIN)).filter((e) => e.status === 'ignored')
  check('the access scan is still recorded, marked ignored', doorEvents.length === 1)

  // --- 5. an unknown enrollment queues rather than disappearing -----------
  await postSigned([{ device_serial: CLOCK_SERIAL, user_id: UNKNOWN_PIN, timestamp: new Date().toISOString(), direction: 'in' }])
  const unknown = await eventsFor(UNKNOWN_PIN)
  check('an unknown enrollment is queued as unmatched',
    unknown.length === 1 && unknown[0].status === 'unmatched', JSON.stringify(unknown))

  // --- 6. an unsigned request is rejected --------------------------------
  const unsigned = await fetch(`${APP}/api/biometric/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{ device_serial: CLOCK_SERIAL, user_id: PIN, timestamp: new Date().toISOString() }] }),
  })
  check('an unsigned payload is rejected', unsigned.status === 401, `status ${unsigned.status}`)

  const badSig = await fetch(`${APP}/api/biometric/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': 'deadbeef' },
    body: JSON.stringify({ events: [] }),
  })
  check('a wrong signature is rejected', badSig.status === 401, `status ${badSig.status}`)

  // --- 7. the ZKTeco push endpoint ---------------------------------------
  const pushPin = PIN
  const pushTime = new Date(Date.now() - 10 * 60_000)
  const local = pushTime.toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' }).replace('T', ' ')
  const attlog = `${pushPin}\t${local}\t0\t1\t0\t0\n`
  const push = await fetch(
    `${APP}/api/biometric/iclock/cdata?SN=${CLOCK_SERIAL}&table=ATTLOG&token=${PUSH_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: attlog }
  )
  const pushBody = await push.text()
  check('the push endpoint answers OK', push.status === 200 && pushBody.trim() === 'OK',
    `${push.status} ${pushBody.slice(0, 40)}`)
  rows = await punches()
  check('a pushed ATTLOG record opens a new shift', rows.length === 2, `${rows.length} punches`)

  const noToken = await fetch(`${APP}/api/biometric/iclock/cdata?SN=${CLOCK_SERIAL}&table=ATTLOG`, {
    method: 'POST', body: attlog,
  })
  check('the push endpoint rejects a missing token', noToken.status === 401, `status ${noToken.status}`)

  // --- 8. device health is updated ---------------------------------------
  const [device] = await (await rest(`biometric_device_health?select=health,last_seen_at,events_24h&serial_no=eq.${CLOCK_SERIAL}`)).json()
  check('the device reports healthy after scanning', device?.health === 'online', device?.health)
  check('24h scan count is populated', Number(device?.events_24h ?? 0) >= 3, String(device?.events_24h))

  console.log(failures === 0 ? '\nALL BIOMETRIC ASSERTIONS PASSED' : `\n${failures} BIOMETRIC CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
} finally {
  for (const pin of [PIN, UNKNOWN_PIN]) {
    await rest(`biometric_events?external_user_id=eq.${pin}`, { method: 'DELETE' })
  }
  await rest(`biometric_enrollments?device_user_id=eq.${PIN}`, { method: 'DELETE' })
  for (const id of deviceIds) await rest(`biometric_devices?id=eq.${id}`, { method: 'DELETE' })
  if (userId) {
    await fetch(`${U}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE', headers: { apikey: S, Authorization: `Bearer ${S}` },
    })
  }
  console.log('cleanup: probe staff, devices, enrollments and events removed')
}
