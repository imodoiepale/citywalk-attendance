'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { recordConsentAction, type ConsentState } from '@/lib/biometric/device-actions'

// Recording consent to hold and replicate someone's biometric credentials.
//
// The checkbox is not decoration: it is an attestation by the admin recording
// it, and the action refuses without it. The version is stored too, because
// consent given against a superseded notice is evidence of nothing.

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Recording…' : 'Record consent'}
    </Button>
  )
}

export default function ConsentForm({
  profileId,
  consentVersion,
}: {
  profileId: string
  consentVersion: string
}) {
  const [state, formAction] = useActionState<ConsentState, FormData>(recordConsentAction, {})

  if (state.ok) {
    return <p className="text-xs text-success">Consent recorded.</p>
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="consent_version" value={consentVersion} />

      <div className="space-y-1">
        <Label htmlFor="method">How was consent given?</Label>
        <Select id="method" name="method" defaultValue="in_person">
          <option value="in_person">In person</option>
          <option value="self_service">Self-service</option>
          <option value="imported">Imported from a previous system</option>
        </Select>
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="confirmed" className="mt-0.5" />
        <span>
          I confirm this person was told what will be held, why, and how to withdraw — and agreed.
          Recorded against notice version{' '}
          <span className="font-mono">{consentVersion}</span>.
        </span>
      </label>

      <Submit />
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  )
}
