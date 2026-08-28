'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// Device commands and enrolment.
//
// Everything here writes a row to device_commands and returns its id. The
// gateway polls that table, sends the command down the device's live socket,
// and writes the outcome back — so the app never talks to the gateway directly,
// needs no route to it, and keeps working when the VPS is unreachable. The
// caller then polls readCommandStatus() for the result.

/** Commands safe to expose as buttons. Anything destructive is deliberately absent. */
const ALLOWED = new Set([
  'getdevinfo', 'settime', 'reboot',
  'opendoor',
  'getnewlog', 'getalllog',
  'getallusers', 'getuserlist',
  'enabledevice', 'disabledevice',
  'adduser', 'deleteuser', 'enableuser', 'setusername',
])

// `cleanuser` (wipe every user), `initsys` (factory reset) and `cleanadmin` are
// intentionally NOT here. They destroy an estate's enrolment in one click and
// belong behind a deliberate, separately-built confirmation flow — not behind a
// generic action that a stray form post could reach.

export interface CommandState {
  ok?: boolean
  error?: string
  commandId?: string
}

export async function queueCommandAction(
  _prev: CommandState,
  formData: FormData
): Promise<CommandState> {
  await requireUser()

  const serial = String(formData.get('serial_no') ?? '').trim()
  const command = String(formData.get('command') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim() || null

  if (!serial || !command) return { error: 'Pick a device and a command.' }
  if (!ALLOWED.has(command)) return { error: `"${command}" cannot be sent from here.` }

  let payload: Record<string, unknown> = {}
  const rawPayload = String(formData.get('payload') ?? '').trim()
  if (rawPayload) {
    try {
      const parsed: unknown = JSON.parse(rawPayload)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { error: 'Payload must be a JSON object.' }
      }
      payload = parsed as Record<string, unknown>
    } catch {
      return { error: 'Payload is not valid JSON.' }
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('queue_device_command', {
    p_serial: serial,
    p_command: command,
    p_payload: payload,
    p_reason: reason,
  })

  if (error) return { error: error.message }

  revalidatePath(`/admin/devices/${serial}`)
  return { ok: true, commandId: String(data) }
}

export interface CommandStatus {
  status: 'queued' | 'sent' | 'succeeded' | 'failed' | 'expired'
  error: string | null
  result: unknown
}

/**
 * Poll one command.
 *
 * The wizard calls this on a timer. It is a read of a row the caller already
 * has the id of, so there is nothing to authorise beyond the RLS policy that
 * already governs device_commands.
 */
export async function readCommandStatus(commandId: string): Promise<CommandStatus | null> {
  await requireUser()
  const supabase = await createClient()

  const { data } = await supabase
    .from('device_commands')
    .select('status, error, result')
    .eq('id', commandId)
    .maybeSingle()

  if (!data) return null
  return { status: data.status, error: data.error, result: data.result }
}

export interface ConsentState {
  ok?: boolean
  error?: string
}

/**
 * Record consent to hold and replicate someone's biometric credentials.
 *
 * A hard prerequisite, not a checkbox: the database refuses to store a template
 * without a live consent row, so this must succeed before any enrolment can.
 */
export async function recordConsentAction(
  _prev: ConsentState,
  formData: FormData
): Promise<ConsentState> {
  await requireUser()

  const profileId = String(formData.get('profile_id') ?? '')
  const version = String(formData.get('consent_version') ?? '').trim()
  if (!profileId || !version) return { error: 'Missing the person or the consent version.' }
  if (formData.get('confirmed') !== 'on') {
    return { error: 'Confirm that consent was given before recording it.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('biometric_consents').insert({
    profile_id: profileId,
    consent_version: version,
    method: String(formData.get('method') ?? 'in_person'),
  })

  if (error) return { error: error.message }

  revalidatePath(`/admin/users/${profileId}`)
  return { ok: true }
}

export interface EnrolState {
  ok?: boolean
  error?: string
  commandId?: string
}

/**
 * Start a fingerprint enrolment on a chosen reader.
 *
 * Asynchronous by nature: this only asks the device to capture. The person then
 * presents a finger, the device pushes the template up as `senduser`, and the
 * gateway stores and replicates it. The UI watches for the credential to appear
 * rather than for this command to finish — the command succeeding only means
 * the device accepted the request.
 */
export async function startFingerprintEnrolAction(
  _prev: EnrolState,
  formData: FormData
): Promise<EnrolState> {
  await requireUser()

  const serial = String(formData.get('serial_no') ?? '').trim()
  const enrollId = String(formData.get('enroll_id') ?? '').trim()
  const profileId = String(formData.get('profile_id') ?? '')

  if (!serial || !enrollId) return { error: 'Pick a reader and an enrollment number.' }

  const supabase = await createClient()

  // Without the mapping the captured template arrives with nobody to attach it
  // to, and the gateway correctly refuses to guess. Catch it here, where it can
  // still be fixed, rather than after someone has queued at a reader.
  const { data: mapping } = await supabase
    .from('biometric_enrollments')
    .select('profile_id')
    .eq('device_user_id', enrollId)
    .maybeSingle()

  if (!mapping) {
    return { error: `Enrollment number ${enrollId} is not mapped to anyone yet. Map it first.` }
  }
  if (profileId && mapping.profile_id !== profileId) {
    return { error: `Enrollment number ${enrollId} already belongs to someone else.` }
  }

  const { data, error } = await supabase.rpc('queue_device_command', {
    p_serial: serial,
    p_command: 'adduser',
    p_payload: { enrollid: enrollId },
    p_reason: 'fingerprint enrolment',
    p_ttl_seconds: 600,
  })

  if (error) return { error: error.message }

  revalidatePath(`/admin/users/${profileId}`)
  return { ok: true, commandId: String(data) }
}

export interface RevokeState {
  ok?: boolean
  error?: string
  queued?: number
}

/**
 * Revoke a credential and remove it from every reader that holds it.
 *
 * Revoking centrally without also deleting from the devices would be theatre —
 * the finger would still open the door. So this queues a `deleteuser` per
 * device that reports holding it, and only then marks the row revoked.
 */
export async function revokeCredentialAction(
  _prev: RevokeState,
  formData: FormData
): Promise<RevokeState> {
  const user = await requireUser()

  const credentialId = String(formData.get('credential_id') ?? '')
  const profileId = String(formData.get('profile_id') ?? '')
  const enrollId = String(formData.get('enroll_id') ?? '').trim()
  if (!credentialId) return { error: 'Missing the credential.' }

  const supabase = await createClient()

  const { data: credential } = await supabase
    .from('biometric_credential_summary')
    .select('backup_num')
    .eq('id', credentialId)
    .maybeSingle()

  const { data: states } = await supabase
    .from('device_credential_state')
    .select('device:biometric_devices(serial_no)')
    .eq('credential_id', credentialId)
    .in('state', ['synced', 'pending', 'failed'])

  let queued = 0
  if (enrollId && credential) {
    for (const row of states ?? []) {
      const device = Array.isArray(row.device) ? row.device[0] : row.device
      if (!device?.serial_no) continue
      const { error } = await supabase.rpc('queue_device_command', {
        p_serial: device.serial_no,
        p_command: 'deleteuser',
        p_payload: { enrollid: enrollId, backupnum: credential.backup_num },
        p_reason: 'credential revoked',
      })
      if (!error) queued += 1
    }
  }

  const { error } = await supabase
    .from('biometric_credentials')
    .update({ revoked_at: new Date().toISOString(), revoked_by_id: user.id })
    .eq('id', credentialId)

  if (error) return { error: error.message }

  revalidatePath(`/admin/users/${profileId}`)
  return { ok: true, queued }
}
