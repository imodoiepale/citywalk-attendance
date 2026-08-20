import Link from 'next/link'
import Image from 'next/image'
import { MapPinOff } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'

// Root-level 404. Lives outside both route groups so it covers a bad URL
// whether or not the visitor is signed in — which also means it cannot assume
// a session, and so links home rather than anywhere role-specific.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex items-center gap-2">
        <Image src="/logo-mark.png" alt="" width={28} height={28} className="rounded-md" />
        <span className="bg-gradient-to-r from-[#AB8704] to-[#FDEC06] bg-clip-text text-sm font-semibold text-transparent">
          Citywalk Attendance
        </span>
      </div>

      <MapPinOff className="h-9 w-9 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />

      <div className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">Page not found</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          That link doesn&rsquo;t point anywhere in this app. It may have been renamed, or the
          address may have a typo.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className={buttonVariants({ size: 'sm' })}>
          Go to the dial
        </Link>
        <Link href="/calendar" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          My hours
        </Link>
      </div>
    </div>
  )
}
