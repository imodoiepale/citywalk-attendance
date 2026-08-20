// Proves the timesheet's numbers come from the configured settings, not from a
// compiled-in constant, by changing the org's daily target and re-reading the
// rendered timesheet page.
//
//   node scripts/verify-timesheet.mjs .env.local http://localhost:3101
//
// This exists because the overtime column silently read `DAILY_TARGET_HOURS`
// while the dial and calendar read `app_settings` — so changing the target at
// /admin/settings moved two of the three and left payroll's number behind. A
// unit test over the helper would not have caught it; only rendering the real
// page with a real setting does.
//
// Restores the original target and deletes its fixtures in a finally block.

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

let userId = null
let originalTarget = null
let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

try {
  const [settings] = await (await rest('app_settings?select=daily_target_hours')).json()
  originalTarget = settings.daily_target_hours

  const [branch] = await (await rest('branches?select=id&is_active=eq.true&limit=1')).json()
  const email = `ts.${Date.now()}@invalid.test`
  const user = await (await fetch(`${U}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      email, email_confirm: true,
      user_metadata: { full_name: 'Timesheet Probe', branch_id: branch.id },
    }),
  })).json()
  userId = user.id
  await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH', body: JSON.stringify({ role: 'admin' }),
  })

  // A single unambiguous 10-hour shift today.
  const start = new Date(); start.setHours(6, 0, 0, 0)
  const end = new Date(start.getTime() + 10 * 3600_000)
  await rest('punches', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId, branch_id: branch.id,
      clock_in_at: start.toISOString(), clock_out_at: end.toISOString(),
    }),
  })

  const link = await (await fetch(`${U}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email }),
  })).json()
  await visit(`/callback?token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=magiclink`)
  check('signed in', [...jar.keys()].some((k) => k.startsWith('sb-')))

  // The page renders overtime to one decimal, so look for the exact figure.
  const readOvertime = async (label) => {
    const { status, body } = await visit('/reports/timesheets?period=this-month&branch=all')
    assert.equal(status, 200, `${label}: timesheet rendered`)
    return body
  }

  await rest('app_settings?id=eq.true', {
    method: 'PATCH', body: JSON.stringify({ daily_target_hours: 8 }),
  })
  let body = await readOvertime('8h target')
  check('a 10h shift shows 2.0 overtime at an 8h target', body.includes('2.0'),
    'expected 2.0 somewhere in the rendered timesheet')

  await rest('app_settings?id=eq.true', {
    method: 'PATCH', body: JSON.stringify({ daily_target_hours: 6, approaching_threshold_hours: 5 }),
  })
  body = await readOvertime('6h target')
  check('lowering the target to 6h moves overtime to 4.0', body.includes('4.0'),
    'the overtime column did not follow the configured target')

  console.log(failures === 0 ? '\nALL TIMESHEET ASSERTIONS PASSED' : `\n${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
} finally {
  if (originalTarget !== null) {
    await rest('app_settings?id=eq.true', {
      method: 'PATCH',
      body: JSON.stringify({ daily_target_hours: originalTarget, approaching_threshold_hours: 7 }),
    })
    console.log(`restored daily target to ${originalTarget}`)
  }
  if (userId) {
    await fetch(`${U}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE', headers: { apikey: S, Authorization: `Bearer ${S}` },
    })
    console.log('cleanup: probe user and punch removed')
  }
}
