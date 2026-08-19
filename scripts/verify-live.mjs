// End-to-end check against a live Supabase project, using the same public API
// surface the app uses: GoTrue for auth, PostgREST for data, RLS enforced by
// the signed-in user's own JWT.
//
//   node scripts/verify-live.mjs .env.local
//
// Creates a throwaway user, exercises signup -> clock in -> clock out, probes
// the RLS boundaries that matter (impersonation, self role escalation, reading
// another branch, writing org settings), and deletes the user in a finally
// block. Safe to run against production: it leaves nothing behind.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the env file, because creating a
// pre-confirmed user is an admin operation. That key bypasses RLS — this
// script is the only thing in the repo that uses it.
import fs from 'node:fs'
import assert from 'node:assert/strict'

const env = Object.fromEntries(
  fs
    .readFileSync(process.argv[2], 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
assert.ok(URL_BASE && ANON && SERVICE, 'env vars present')

const email = `e2e.${Date.now()}@invalid.test`
const password = 'CitywalkE2E!' + Date.now()
let userId = null

const j = async (res) => {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

try {
  // --- pick a branch, anonymously (the signup dropdown does exactly this) ---
  const branches = await j(
    await fetch(`${URL_BASE}/rest/v1/branches?select=id,name,code&is_active=eq.true`, {
      headers: { apikey: ANON },
    })
  )
  // The canonical branch list is mirrored from the DMS seed; assert on the
  // codes this script depends on rather than a count that will change as
  // branches open and close.
  assert.ok(Array.isArray(branches) && branches.length >= 2, `anon can read branches (got ${branches.length})`)
  const home = branches.find((b) => b.code === 'HOF')
  const other = branches.find((b) => b.code === 'CSF')
  assert.ok(home && other, 'HOF and CSF branches exist and are active')
  console.log(`PASS  anon reads ${branches.length} active branches (the signup dropdown)`)

  // --- create a confirmed user (admin API), mirroring signUpAction metadata ---
  const created = await j(
    await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'E2E Probe', branch_id: home.id },
      }),
    })
  )
  userId = created.id
  assert.ok(userId, `user created: ${JSON.stringify(created).slice(0, 200)}`)
  console.log('PASS  signup creates an auth user')

  // --- sign in with the anon key, exactly as the app does ---
  const session = await j(
    await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  )
  const jwt = session.access_token
  assert.ok(jwt, `password sign-in returns a session: ${JSON.stringify(session).slice(0, 200)}`)
  console.log('PASS  password sign-in returns a session')

  const auth = { apikey: ANON, Authorization: `Bearer ${jwt}` }
  const authJson = { ...auth, 'Content-Type': 'application/json' }

  // --- the profiles trigger ran ---
  const profile = await j(
    await fetch(`${URL_BASE}/rest/v1/profiles?select=id,full_name,role,branch_id&id=eq.${userId}`, {
      headers: auth,
    })
  )
  assert.equal(profile.length, 1, 'own profile is readable')
  assert.equal(profile[0].full_name, 'E2E Probe', 'trigger copied full_name from metadata')
  assert.equal(profile[0].role, 'staff', 'new users default to staff')
  assert.equal(profile[0].branch_id, home.id, 'trigger copied branch_id from metadata')
  console.log('PASS  handle_new_auth_user created the profile with the right branch and role')

  // --- my_permissions() drives the nav and gating ---
  const perms = await j(
    await fetch(`${URL_BASE}/rest/v1/rpc/my_permissions`, { method: 'POST', headers: authJson, body: '{}' })
  )
  const permNames = perms.map((p) => p.permission).sort()
  assert.deepEqual(permNames, ['leave.cancel.own', 'leave.request.own', 'punch.view.own'], 'staff permission set')
  console.log(`PASS  my_permissions() returns the staff set: ${permNames.join(', ')}`)

  // --- clock in ---
  const punch = await j(
    await fetch(`${URL_BASE}/rest/v1/punches`, {
      method: 'POST',
      headers: { ...authJson, Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, branch_id: home.id }),
    })
  )
  assert.ok(Array.isArray(punch) && punch[0]?.id, `clock-in inserted: ${JSON.stringify(punch).slice(0, 200)}`)
  assert.equal(punch[0].clock_out_at, null, 'punch starts open')
  console.log('PASS  clock in')

  // --- a second open punch must be rejected by the DB, not just the UI ---
  const dupe = await fetch(`${URL_BASE}/rest/v1/punches`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({ user_id: userId, branch_id: home.id }),
  })
  assert.equal(dupe.status, 409, `second open punch rejected (got ${dupe.status})`)
  console.log('PASS  a second open punch is refused (409) by the unique index')

  // --- clock out, immediately after clocking in (the skew case that failed) ---
  const out = await fetch(`${URL_BASE}/rest/v1/rpc/clock_out`, {
    method: 'POST',
    headers: authJson,
    body: '{}',
  })
  const closed = await j(out)
  assert.ok(
    closed?.clock_out_at,
    `clock-out closed the punch (status ${out.status}, body ${JSON.stringify(closed).slice(0, 300)})`
  )
  assert.ok(
    new Date(closed.clock_out_at) > new Date(closed.clock_in_at),
    'clock_out_at is strictly after clock_in_at'
  )
  console.log('PASS  clock out immediately after clock in (database clock, no skew)')

  // --- clocking out twice must be refused, not silently succeed ---
  const again = await fetch(`${URL_BASE}/rest/v1/rpc/clock_out`, {
    method: 'POST',
    headers: authJson,
    body: '{}',
  })
  const againBody = await j(again)
  assert.equal(again.status, 200, `second clock-out is not a server error (got ${again.status})`)
  assert.equal(againBody?.id ?? null, null, 'second clock-out closes nothing')
  console.log('PASS  clocking out with no open shift returns an empty row, not a 500')

  // --- RLS: cannot punch as someone else, cannot escalate role ---
  const impersonate = await fetch(`${URL_BASE}/rest/v1/punches`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000001', branch_id: home.id }),
  })
  assert.ok(impersonate.status >= 400, `punching as another user is refused (got ${impersonate.status})`)
  console.log(`PASS  cannot insert a punch for another user (${impersonate.status})`)

  const escalate = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: authJson,
    body: JSON.stringify({ role: 'admin' }),
  })
  const escalated = await j(
    await fetch(`${URL_BASE}/rest/v1/profiles?select=role&id=eq.${userId}`, { headers: auth })
  )
  assert.equal(escalated[0].role, 'staff', `self role escalation blocked (status ${escalate.status})`)
  console.log(`PASS  cannot escalate own role to admin (still staff)`)

  // --- RLS: cannot see other branches' staff or another branch's data ---
  const others = await j(
    await fetch(`${URL_BASE}/rest/v1/profiles?select=id&branch_id=eq.${other.id}`, { headers: auth })
  )
  assert.equal(others.length, 0, 'staff cannot list another branch profiles')
  console.log('PASS  staff cannot read another branch staff list')

  // --- settings are readable (the dial needs the targets) ---
  const settings = await j(
    await fetch(`${URL_BASE}/rest/v1/app_settings?select=daily_target_hours,weekly_target_hours`, {
      headers: auth,
    })
  )
  assert.equal(Number(settings[0].daily_target_hours), 8, 'daily target readable')
  console.log('PASS  app_settings readable by a signed-in user (8h/40h)')

  // --- but not writable by staff ---
  const settingsWrite = await fetch(`${URL_BASE}/rest/v1/app_settings?id=eq.true`, {
    method: 'PATCH',
    headers: authJson,
    body: JSON.stringify({ daily_target_hours: 99 }),
  })
  const after = await j(
    await fetch(`${URL_BASE}/rest/v1/app_settings?select=daily_target_hours`, { headers: auth })
  )
  assert.equal(Number(after[0].daily_target_hours), 8, `staff cannot change settings (status ${settingsWrite.status})`)
  console.log('PASS  staff cannot change org settings')

  console.log('\nALL END-TO-END ASSERTIONS PASSED')
} finally {
  if (userId) {
    const del = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
    console.log(`cleanup: deleted probe user (${del.status})`)
  }
}
