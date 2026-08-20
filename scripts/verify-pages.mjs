// Renders every authenticated page as a real signed-in admin and asserts each
// one returns 200.
//
//   node scripts/verify-pages.mjs .env.local http://localhost:3101
//
// This exists because verify-live.mjs talks to Supabase's API directly and
// never renders a Next page, and the unauthenticated smoke checks only ever saw
// the redirect to /login. That blind spot hid a server error on every signed-in
// page: AppShell passed NavItem objects — which carry a `match` function —
// into Client Components, and functions cannot cross that boundary.
//
// Creates a throwaway admin, signs in by consuming a magic link through
// /callback to get real session cookies, walks the routes, and deletes the user
// in a finally block.

import fs from 'node:fs'
import assert from 'node:assert/strict'

const envPath = process.argv[2] ?? '.env.local'
const APP = (process.argv[3] ?? 'http://localhost:3101').replace(/\/$/, '')

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
assert.ok(URL_BASE && SERVICE, 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')

// Minimal cookie jar — fetch does not keep cookies between calls, and the
// session lives in chunked sb-* cookies set by /callback.
const jar = new Map()
function storeCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';')
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1)
    if (value === '' || /Max-Age=0/i.test(raw)) jar.delete(name)
    else jar.set(name, value)
  }
}
const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

/** fetch that carries the jar and follows redirects manually so we see each hop. */
async function visit(path, { maxHops = 5 } = {}) {
  let url = path.startsWith('http') ? path : `${APP}${path}`
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(url, {
      headers: { cookie: cookieHeader(), 'user-agent': 'citywalk-verify-pages' },
      redirect: 'manual',
    })
    storeCookies(res)
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { status: res.status, url, body: '' }
      url = loc.startsWith('http') ? loc : `${APP}${loc}`
      continue
    }
    return { status: res.status, url, body: await res.text() }
  }
  throw new Error(`too many redirects from ${path}`)
}

const email = `pages.${Date.now()}@invalid.test`
let userId = null
let failures = 0

try {
  // Reachability first, so a stopped dev server reads as that and not as a
  // wall of failing routes.
  const ping = await fetch(`${APP}/login`, { redirect: 'manual' }).catch(() => null)
  assert.ok(ping, `dev server not reachable at ${APP} — is it running?`)

  const branches = await (
    await fetch(`${URL_BASE}/rest/v1/branches?select=id,code&is_active=eq.true&limit=1`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
  ).json()
  assert.ok(branches[0]?.id, 'at least one active branch exists')

  const created = await (
    await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { full_name: 'Page Probe', branch_id: branches[0].id },
      }),
    })
  ).json()
  userId = created.id
  assert.ok(userId, `probe user created: ${JSON.stringify(created).slice(0, 200)}`)

  // Admin, so the run covers every gated route in one pass.
  const promote = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'admin' }),
  })
  assert.ok(promote.ok, `probe promoted to admin (${promote.status})`)

  // Sign in the way a human would: consume a link through /callback, which is
  // what actually writes the session cookies this app reads.
  const link = await (
    await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'magiclink', email }),
    })
  ).json()
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token
  assert.ok(tokenHash, 'magic link generated')

  const landed = await visit(`/callback?token_hash=${tokenHash}&type=magiclink`)
  assert.ok(
    [...jar.keys()].some((k) => k.startsWith('sb-')),
    `session cookies set by /callback (landed ${landed.status} ${landed.url})`
  )
  console.log('PASS  signed in through /callback')

  const today = new Date().toISOString().slice(0, 10)
  const routes = [
    '/',
    '/calendar',
    `/calendar/${today}`,
    '/leave',
    '/leave/new',
    '/leave/approvals',
    '/reports',
    '/reports/timesheets',
    '/attendance/corrections',
    '/me',
    '/admin/users',
    '/admin/permissions',
    '/admin/branches',
    '/admin/settings',
  ]

  for (const route of routes) {
    const res = await visit(route)
    const redirected = !res.url.endsWith(route) && !res.url.includes(route)
    if (res.status !== 200) {
      failures++
      console.log(`FAIL  ${route} -> HTTP ${res.status}`)
    } else if (redirected && res.url.includes('/login')) {
      failures++
      console.log(`FAIL  ${route} -> bounced to login (session lost)`)
    } else {
      console.log(`PASS  ${route}`)
    }
  }

  // A route that does not exist must render the custom 404, not blow up.
  const missing = await visit('/definitely-not-a-route')
  if (missing.status !== 404 || !missing.body.includes('Page not found')) {
    failures++
    console.log(`FAIL  unknown route -> HTTP ${missing.status} (expected 404 with the custom page)`)
  } else {
    console.log('PASS  unknown route renders the custom 404')
  }

  if (failures > 0) {
    console.log(`\n${failures} PAGE(S) FAILED`)
    process.exitCode = 1
  } else {
    console.log('\nALL PAGES RENDERED')
  }
} finally {
  if (userId) {
    const del = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
    console.log(`cleanup: deleted probe user (${del.status})`)
  }
}
