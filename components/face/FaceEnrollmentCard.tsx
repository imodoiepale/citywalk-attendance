'use client'

import { useActionState, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { ScanFace, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { uploadFaceAction, revokeFaceAction, type FaceFormState } from '@/lib/face/actions'
import type { FaceEnrollment } from '@/lib/face/queries'

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  pending: { label: 'Waiting for the camera', variant: 'warning' },
  enrolled: { label: 'Active', variant: 'success' },
  failed: { label: 'Rejected by the camera', variant: 'destructive' },
  revoked: { label: 'Removed', variant: 'secondary' },
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Uploading…' : 'Upload and consent'}
    </Button>
  )
}

/**
 * Face enrolment on a person's own profile.
 *
 * The consent checkbox is unticked by default and the copy states plainly what
 * is kept and what is not — pre-ticking it, or burying the detail, would not be
 * consent in any meaningful sense.
 */
export default function FaceEnrollmentCard({
  enabled,
  enrollment,
  consentVersion,
  retentionDays,
}: {
  enabled: boolean
  enrollment: FaceEnrollment | null
  consentVersion: string
  retentionDays: number
}) {
  const [state, formAction] = useActionState<FaceFormState, FormData>(uploadFaceAction, {})
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [pending, startTransition] = useTransition()

  if (!enabled) {
    return (
      <Card>
        <CardContent className="space-y-1 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanFace className="h-4 w-4 text-primary-strong" strokeWidth={1.8} />
            Face recognition
          </h2>
          <p className="text-sm text-muted-foreground">
            Not switched on for Citywalk yet. When it is, you will be able to add a photo here so
            the cameras can recognise you at your branch.
          </p>
        </CardContent>
      </Card>
    )
  }

  const status = enrollment ? STATUS[enrollment.status] : null

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ScanFace className="h-4 w-4 text-primary-strong" strokeWidth={1.8} />
              Face recognition
            </h2>
            {status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
          </div>

          {enrollment && enrollment.status !== 'revoked' ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {enrollment.status === 'enrolled'
                  ? 'The cameras at your branch can recognise you, so scanning clocks you in automatically.'
                  : enrollment.status === 'failed'
                    ? `The camera could not use that photo${enrollment.failureReason ? `: ${enrollment.failureReason}` : ''}. Try a clearer, front-facing one.`
                    : 'Your photo is with the camera. Recognition starts once it confirms.'}
              </p>
              <p className="text-xs text-muted-foreground">
                You agreed on{' '}
                {new Date(enrollment.consentedAt).toLocaleDateString('en-KE', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}{' '}
                ({enrollment.consentVersion}).
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmRevoke(true)}
                disabled={pending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove my photo
              </Button>
            </div>
          ) : (
            <form action={formAction} className="space-y-3">
              {state.error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {state.error}
                </p>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="photo">A clear, front-facing photo</Label>
                <Input
                  id="photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  JPEG, PNG or WebP, up to 5MB.
                </p>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3">
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-strong" />
                  <span>
                    Your photo is stored privately and sent to Citywalk&rsquo;s own cameras so they
                    can recognise you at work. <strong className="text-foreground">The cameras
                    hold the face data — this app never stores a face scan or template.</strong>{' '}
                    Photos are kept for {retentionDays} days. You can remove yours at any time, which
                    deletes it and stops the cameras recognising you.
                  </span>
                </p>
                <label className="flex items-start gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    name="consent"
                    required
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    I agree to Citywalk using my photo for attendance recognition ({consentVersion}).
                  </span>
                </label>
              </div>

              <SubmitButton />
            </form>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmRevoke}
        title="Remove your face photo?"
        description="The photo is deleted and the cameras will stop recognising you. You will need to clock in manually or with your fingerprint. You can add a photo again later."
        confirmVariant="destructive"
        confirmLabel="Remove it"
        isPending={pending}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() =>
          startTransition(async () => {
            await revokeFaceAction()
            setConfirmRevoke(false)
          })
        }
      />
    </>
  )
}
