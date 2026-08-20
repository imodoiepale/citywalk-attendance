import { headers } from 'next/headers'

/**
 * The canonical public origin of this deployment, e.g.
 * `https://citywalk-attendance.vercel.app`.
 *
 * Password-recovery and invite emails carry an absolute URL, so this value ends
 * up in somebody's inbox and has to be right without a request to lean on.
 * Resolution order:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — the only source that is correct in every
 *      context, including a preview build or a background job with no request.
 *   2. The Vercel production domain, so a deploy that forgets the variable
 *      still mails a working link rather than a preview URL that later rots.
 *   3. The incoming request's host, for local development.
 *
 * Deliberately NOT taken from a form field. The origin used to be read from the
 * request in the page and posted back in a hidden input, which made it
 * attacker-controlled: anyone could post their own origin and have Supabase
 * mail a recovery link pointing at a host they owned. Supabase's redirect
 * allow list is the backstop for that, but the app should not be handing it
 * hostile input to reject in the first place.
 */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`

  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000'
  const protocol = headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protocol}://${host}`
}
