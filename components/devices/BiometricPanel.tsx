import { Fingerprint, ScanFace, CreditCard, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import {
  getEnrollmentForProfile, hasLiveConsent, listCredentials, listManageableDevices,
} from '@/lib/biometric/queries'
import { startFingerprintEnrolAction } from '@/lib/biometric/device-actions'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import ConsentForm from '@/components/devices/ConsentForm'
import { FingerprintEnrolForm } from '@/components/devices/DeviceActions'

// One person's biometric credentials: consent, what is held, where each has
// reached, and how to enrol another.
//
// The order on screen is the order of the actual gating. Consent first, because
// the database refuses to store a template without it — showing an "Enrol"
// button above an unmet prerequisite would just produce a confusing failure.

const ICONS = {
  fingerprint: Fingerprint,
  face: ScanFace,
  card: CreditCard,
  password: KeyRound,
} as const

const STATE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  synced: 'success',
  pending: 'warning',
  failed: 'destructive',
  removed: 'secondary',
  unsupported: 'destructive',
}

export default async function BiometricPanel({
  profileId,
  consentVersion,
}: {
  profileId: string
  consentVersion: string
}) {
  const [consented, credentials, enrollment, devices] = await Promise.all([
    hasLiveConsent(profileId),
    listCredentials(profileId),
    getEnrollmentForProfile(profileId),
    listManageableDevices(),
  ])

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Biometric credentials</h2>
          {consented ? (
            <Badge variant="success">
              <ShieldCheck className="mr-1 h-3 w-3" />
              Consent on file
            </Badge>
          ) : (
            <Badge variant="warning">No consent</Badge>
          )}
        </div>

        {!enrollment ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              This person has no enrollment number yet. A reader knows people only as numbers, so
              map one at <span className="font-medium">Devices → Enrollments</span> before enrolling
              a credential — otherwise a captured template arrives with nobody to attach it to.
            </span>
          </div>
        ) : null}

        {!consented ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              A fingerprint or face template is sensitive personal data. Recording consent is a
              hard prerequisite — the database will refuse to store a template without it.
            </p>
            <ConsentForm profileId={profileId} consentVersion={consentVersion} />
          </div>
        ) : null}

        {credentials.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-3">
            {credentials.map((credential) => {
              const Icon = ICONS[credential.credentialType]
              return (
                <div key={credential.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium capitalize">
                      {credential.credentialType}
                    </span>
                    <span className="text-xs text-muted-foreground">slot {credential.backupNum}</span>
                    {credential.capturedVia === 'photo' ? (
                      <Badge variant="secondary">from photo</Badge>
                    ) : null}
                    {credential.fpAlgo ? (
                      <span className="text-xs text-muted-foreground">{credential.fpAlgo}</span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {credential.devices.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Not yet on any reader.
                      </span>
                    ) : (
                      credential.devices.map((d) => (
                        <Badge key={d.deviceId} variant={STATE_VARIANT[d.state] ?? 'secondary'}>
                          {d.deviceName ?? 'unknown'}
                          {d.state === 'synced' ? '' : ` · ${d.state}`}
                        </Badge>
                      ))
                    )}
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">{credential.fleetRolloutSummary}</p>

                  {credential.devices.some((d) => d.lastError) ? (
                    <p className="mt-1.5 text-xs text-destructive">
                      {credential.devices.find((d) => d.lastError)?.lastError}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            No credentials held for this person.
          </p>
        )}

        {consented && enrollment ? (
          <div className="space-y-2 border-t border-border pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Enrol a fingerprint
            </h3>
            <FingerprintEnrolForm
              serials={devices.map((d) => ({ serial: d.serial, name: d.name, online: d.online }))}
              defaultEnrollId={enrollment.deviceUserId}
              profileId={profileId}
              action={startFingerprintEnrolAction}
            />
            <p className="text-xs text-muted-foreground">
              Face enrolment from a photograph is supported by the hardware
              (<code className="rounded bg-secondary px-1">EnrollFaceByPhoto</code>) but is not
              wired up yet — it runs over a different device protocol to this one.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
