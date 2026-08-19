import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

// Next.js 16 renamed middleware.ts -> proxy.ts (same behavior).
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and PWA/manifest
     * files, which are fetched uncredentialed by the browser install
     * flow — gating them behind auth breaks `beforeinstallprompt`.
     */
    '/((?!_next/static|_next/image|manifest.webmanifest|sw.js|workbox-|logo-mark.png|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)',
  ],
}
