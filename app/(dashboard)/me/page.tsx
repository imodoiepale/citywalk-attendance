import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { getWeeklyHours } from '@/lib/punches/queries'
import { getMyCorrections } from '@/lib/corrections/queries'
import { getMyFaceEnrollment } from '@/lib/face/queries'
import FaceEnrollmentCard from '@/components/face/FaceEnrollmentCard'
import { ROLE_META } from '@/lib/rbac-catalog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  approved: 'success',
  rejected: 'destructive',
  pending: 'warning',
  cancelled: 'secondary',
}

export default async function ProfilePage() {
  const user = await requireUser()
  const [settings, weeklyHours, corrections, faceEnrollment] = await Promise.all([
    getSettings(),
    getWeeklyHours(user.id),
    getMyCorrections(user.id),
    getMyFaceEnrollment(user.id),
  ])

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">{user.fullName}</h1>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>

        <Card>
          <CardContent className="grid grid-cols-2 gap-3 p-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Branch</p>
              <p className="font-medium">{user.branchName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="font-medium">{ROLE_META[user.role].label}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Job title</p>
              <p className="font-medium">{user.jobTitle ?? 'Not set'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
              <p className="font-medium tabular-nums">
                {weeklyHours.toFixed(1)}h of {settings.weeklyTargetHours}h
              </p>
            </div>
          </CardContent>
        </Card>

        <FaceEnrollmentCard
          enabled={settings.faceEnabled}
          enrollment={faceEnrollment}
          consentVersion={settings.faceConsentVersion}
          retentionDays={settings.faceRetentionDays}
        />

        {/* Staff should be able to see what the system records about them —
          a stated privacy requirement, not just a nice-to-have. */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-semibold text-foreground">What we record about you</h2>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Your name, work email, branch, job title and role.</li>
              <li>
                The time of every clock in and clock out, and which branch you were assigned to at
                the time.
              </li>
              <li>Leave requests you file or that are filed for you, and their decisions.</li>
              <li>Any punch corrections you request, and who approved or rejected them.</li>
              <li>
                If your branch uses a fingerprint reader, the scans it sends and the enrolment
                number that identifies you on it.
              </li>
              {settings.faceEnabled ? (
                <li>
                  If you have added a face photo: the photo itself and your recorded consent. The
                  face data the cameras use to recognise you is held by the cameras — this app never
                  stores a face scan or template. Photos are kept for {settings.faceRetentionDays}{' '}
                  days, and removing yours deletes it.
                </li>
              ) : null}
            </ul>
            <p className="text-xs text-muted-foreground">
              No location data is recorded. Your branch manager and HR/Accounts can see your hours
              and leave; other staff cannot. To correct anything, open the day on your{' '}
              <Link href="/calendar" className="underline">
                calendar
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-semibold text-foreground">My punch corrections</h2>
            {corrections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You haven&rsquo;t requested any corrections.
              </p>
            ) : (
              <ul className="space-y-2">
                {corrections.slice(0, 10).map((correction) => (
                  <li
                    key={correction.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="tabular-nums">
                      {formatDateTime(correction.proposedClockInAt)} →{' '}
                      {correction.proposedClockOutAt
                        ? formatDateTime(correction.proposedClockOutAt)
                        : 'open'}
                    </span>
                    <Badge variant={STATUS_VARIANT[correction.status] ?? 'secondary'}>
                      {correction.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
