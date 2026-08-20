// Checks every rendered table for column alignment and row numbering.
//
//   node scripts/verify-tables.mjs .env.local http://localhost:3101
//
// This exists because a header and body can disagree silently: the timesheet
// once rendered more body cells than header cells and every value sat under the
// wrong heading, and it looked plausible enough to ship. Counting <th> against
// <td> per table catches that class of fault without a browser.
//
// Seeds a row into each list so tables render populated — an empty table has no
// body cells to disagree with anything.

import fs from 'node:fs'
import assert from 'node:assert/strict'

const envPath = process.argv[2] ?? '.env.local'
const APP = (process.argv[3] ?? 'http://localhost:3101').replace(/\/$/, '')

const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const S = env.SUPABASE_SERVICE_ROLE_KEY
assert.ok(U && S, 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')

const H = { apikey: S, Authorization: `Bearer ${S}`, 'Content-Type': 'application/json' }
const rest = (p, init = {}) => fetch(`${U}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })

const jar = new Map()
const store = (r) => {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=')
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1))
  }
}
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function visit(path) {
  let url = `${APP}${path}`
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, { headers: { cookie: ck() }, redirect: 'manual' })
    store(r)
    const loc = r.headers.get('location')
    if (!loc) return { status: r.status, body: await r.text() }
    url = loc.startsWith('http') ? loc : `${APP}${loc}`
  }
  throw new Error(`too many redirects from ${path}`)
}

/**
 * Column counts per <table>. Rows with a colspan (empty states, expanded diffs)
 * are skipped — they are legitimately not one cell per column.
 */
function analyse(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((match) => {
    const table = match[0]
    const thead = /<thead[\s\S]*?<\/thead>/.exec(table)?.[0] ?? ''
    const tbody = /<tbody[\s\S]*?<\/tbody>/.exec(table)?.[0] ?? ''
    const headCols = (thead.match(/<th\b/g) ?? []).length
    const bodyRows = [...tbody.matchAll(/<tr[\s\S]*?<\/tr>/g)]
      .map((r) => r[0])
      .filter((r) => !/colspan=/i.test(r))
      .map((r) => (r.match(/<td\b/g) ?? []).length)
    // A comparison table (a before/after pair) is not an enumerable list, so
    // numbering it would be noise. Those opt out explicitly.
    const isComparison = /data-table-kind="comparison"/.test(table)
    return { headCols, bodyRows, hasRowNumberHead: /Row number/.test(thead), isComparison }
  })
}

const PAGES = [
  '/reports',
  '/reports/timesheets?period=this-month&branch=all',
  // Each roll-up rebuilds the column set, so header/body alignment has to be
  // proven at every granularity, not just the default day view.
  '/reports/timesheets?period=this-month&branch=all&granularity=week',
  '/reports/timesheets?period=this-month&branch=all&granularity=month',
  '/reports/timesheets?period=this-month&branch=all&granularity=quarter',
  '/reports/timesheets?period=this-month&branch=all&granularity=year',
  '/leave/approvals',
  '/attendance/corrections',
  '/admin/users',
  '/admin/branches',
  '/admin/devices',
  '/admin/devices/enrollments',
  '/admin/devices/unmatched',
  '/admin/settings',
  '/admin/audit',
]

let userId = null
let probeDeviceId = null
let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

try {
  const [branch] = await (await rest('branches?select=id,name&is_active=eq.true&limit=1')).json()
  const email = `tables.${Date.now()}@invalid.test`
  const user = await (await fetch(`${U}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      email, email_confirm: true,
      user_metadata: { full_name: 'Table Probe', branch_id: branch.id },
    }),
  })).json()
  userId = user.id
  await rest(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) })

  // Populate every list this run renders.
  const today = new Date()
  const iso = (d) => d.toISOString()
  await rest('punches', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId, branch_id: branch.id,
      clock_in_at: iso(new Date(today.getTime() - 6 * 3600_000)),
      clock_out_at: iso(new Date(today.getTime() - 1 * 3600_000)),
    }),
  })
  await rest('leave_requests', {
    method: 'POST',
    body: JSON.stringify({
      requester_id: userId, filed_by_id: userId, branch_id: branch.id,
      type: 'annual', start_date: iso(today).slice(0, 10),
      end_date: iso(new Date(today.getTime() + 86400000)).slice(0, 10),
      reason: 'table probe', status: 'pending',
    }),
  })

  // Devices, enrollments, unmatched scans, corrections and audit all have
  // tables that only render when populated — and those are precisely the ones
  // most likely to drift, so an empty skip is not good enough.
  const serial = `TBL${Date.now()}`
  const [device] = await (await rest('biometric_devices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      serial_no: serial, name: 'Table probe reader', purpose: 'attendance',
      direction: 'both', branch_id: branch.id,
    }),
  })).json()
  probeDeviceId = device.id

  await rest('biometric_enrollments', {
    method: 'POST',
    body: JSON.stringify({ vendor: 'zkteco', device_user_id: `TP${Date.now()}`, profile_id: userId }),
  })

  await rest('biometric_events', {
    method: 'POST',
    body: JSON.stringify({
      device_id: device.id, device_serial: serial, external_user_id: 'UNKNOWN-PROBE',
      scanned_at: iso(today), dedupe_key: `tbl-${Date.now()}`, status: 'unmatched',
    }),
  })

  const [punchRow] = await (await rest(`punches?select=id&user_id=eq.${userId}&limit=1`)).json()
  await rest('punch_corrections', {
    method: 'POST',
    body: JSON.stringify({
      punch_id: punchRow?.id ?? null, user_id: userId, branch_id: branch.id,
      requested_by_id: userId, proposed_clock_in_at: iso(new Date(today.getTime() - 7 * 3600_000)),
      proposed_clock_out_at: iso(today), reason: 'table probe', status: 'pending',
    }),
  })

  await rest('audit_log', {
    method: 'POST',
    body: JSON.stringify({
      source: 'system', actor_name: 'Table Probe', action: 'probe.seeded',
      entity_type: 'profile', entity_id: userId, summary: 'Seeded for the table check',
      before: { role: 'staff' }, after: { role: 'admin' },
    }),
  })

  const link = await (await fetch(`${U}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email }),
  })).json()
  await visit(`/callback?token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=magiclink`)
  check('signed in', [...jar.keys()].some((k) => k.startsWith('sb-')))

  for (const page of PAGES) {
    const { status, body } = await visit(page)
    if (status !== 200) { check(page, false, `HTTP ${status}`); continue }

    const tables = analyse(body)
    if (tables.length === 0) { console.log(`SKIP  ${page} — no table rendered`); continue }

    const mismatched = tables
      .map((t, i) => ({ i, bad: t.bodyRows.filter((n) => n !== t.headCols), head: t.headCols }))
      .filter((t) => t.bad.length > 0)

    check(
      `${page} — every row matches its header`,
      mismatched.length === 0,
      mismatched.map((m) => `table ${m.i}: header ${m.head} vs rows ${[...new Set(m.bad)].join('/')}`).join('; ')
    )

    const populated = tables.filter((t) => t.bodyRows.length > 0 && !t.isComparison)
    if (populated.length > 0) {
      check(
        `${page} — populated tables are numbered`,
        populated.every((t) => t.hasRowNumberHead),
        `${populated.filter((t) => !t.hasRowNumberHead).length} of ${populated.length} without a row-number column`
      )
    }
  }

  console.log(failures === 0 ? '\nALL TABLE ASSERTIONS PASSED' : `\n${failures} TABLE CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
} finally {
  await rest(`audit_log?action=eq.probe.seeded`, { method: 'DELETE' })
  await rest(`biometric_events?device_serial=like.TBL*`, { method: 'DELETE' })
  if (probeDeviceId) await rest(`biometric_devices?id=eq.${probeDeviceId}`, { method: 'DELETE' })
  if (userId) {
    await fetch(`${U}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE', headers: { apikey: S, Authorization: `Bearer ${S}` },
    })
    console.log('cleanup: probe user, punch and leave request removed')
  }
}
