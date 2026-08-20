import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Direction, NormalizedEvent } from './types'

// Ingest runs with the service role and therefore bypasses RLS. It has to:
// a device has no user session. The signature check on the route is the only
// thing in front of this, which is why it is tested separately.

export interface IngestResult {
  received: number
  processed: number
  duplicates: number
  unmatched: number
  ignored: number
  errors: number
}

interface DeviceRow {
  id: string
  serial_no: string
  branch_id: string | null
  purpose: 'attendance' | 'access'
  direction: Direction
  is_active: boolean
}

const EMPTY: IngestResult = {
  received: 0,
  processed: 0,
  duplicates: 0,
  unmatched: 0,
  ignored: 0,
  errors: 0,
}

/**
 * Records a batch of scans and applies the ones that resolve to a person.
 *
 * Every event is written to biometric_events first, whatever happens to it
 * afterwards. An event that cannot be matched is kept as `unmatched` rather
 * than dropped — that queue is what HR triages, and it is replayed once the
 * enrollment number is mapped. Silently discarding a scan would mean someone's
 * shift quietly not existing.
 */
export async function ingestEvents(events: NormalizedEvent[]): Promise<IngestResult> {
  if (events.length === 0) return { ...EMPTY }

  const supabase = createAdminClient()
  const result: IngestResult = { ...EMPTY, received: events.length }

  // Resolve the devices and enrollments this batch touches in two queries
  // rather than two per event — a device replaying a day's buffer can send
  // hundreds at once.
  const serials = [...new Set(events.map((e) => e.deviceSerial))]
  const userIds = [...new Set(events.map((e) => e.externalUserId))]

  const [{ data: deviceRows }, { data: enrollmentRows }] = await Promise.all([
    supabase
      .from('biometric_devices')
      .select('id, serial_no, branch_id, purpose, direction, is_active')
      .in('serial_no', serials),
    supabase
      .from('biometric_enrollments')
      .select('device_user_id, profile_id')
      .in('device_user_id', userIds),
  ])

  const devices = new Map<string, DeviceRow>(
    ((deviceRows ?? []) as DeviceRow[]).map((d) => [d.serial_no, d])
  )
  const profiles = new Map<string, string>(
    (enrollmentRows ?? []).map((e) => [e.device_user_id, e.profile_id])
  )

  const seenAt = new Date().toISOString()

  for (const event of events) {
    const device = devices.get(event.deviceSerial) ?? null
    const profileId = profiles.get(event.externalUserId) ?? null

    // Direction: the device's own report wins when it gave one, otherwise its
    // configured role. A reader wired as the exit door says so by being an
    // 'out' device even when the firmware reports nothing.
    const direction: Direction = event.direction ?? device?.direction ?? 'both'

    let status: string
    let error: string | null = null

    if (!device) {
      // Unknown serial. Recorded anyway so the device shows up in the admin
      // screen to be claimed, instead of vanishing.
      status = 'unmatched'
      error = 'unknown device serial'
    } else if (!device.is_active) {
      status = 'ignored'
      error = 'device is disabled'
    } else if (device.purpose === 'access') {
      // A restricted-area reader. The scan is real and worth keeping as an
      // access record, but it is not attendance — clocking someone in because
      // they opened the server room would be wrong.
      status = 'ignored'
      error = 'access-control device; not an attendance clock'
    } else if (!profileId) {
      status = 'unmatched'
      error = 'no enrollment for this device user id'
    } else {
      status = 'processed'
    }

    const { data: inserted, error: insertError } = await supabase
      .from('biometric_events')
      .insert({
        device_id: device?.id ?? null,
        device_serial: event.deviceSerial,
        external_user_id: event.externalUserId,
        scanned_at: event.scannedAt,
        direction: event.direction,
        raw: event.raw as Record<string, unknown>,
        dedupe_key: event.dedupeKey,
        status: status === 'processed' ? 'unmatched' : status,
        profile_id: profileId,
        error,
      })
      .select('id')
      .single()

    if (insertError) {
      // 23505 on dedupe_key: this exact scan is already recorded. Expected
      // whenever a device replays its buffer, and the whole point of the key.
      if (insertError.code === '23505') {
        result.duplicates += 1
      } else {
        result.errors += 1
      }
      continue
    }

    if (status === 'ignored') {
      result.ignored += 1
    } else if (status === 'unmatched') {
      result.unmatched += 1
    } else if (profileId && inserted) {
      const applied = await applyEvent(inserted.id, profileId, direction, event.scannedAt)
      if (applied) result.processed += 1
      else result.errors += 1
    }
  }

  // Health: any contact counts as "seen", but only a real scan updates
  // last_event_at. A reader that is reachable yet has recorded nothing all day
  // is a different fault from one that is offline, and the admin screen
  // distinguishes them.
  if (serials.length > 0) {
    await supabase
      .from('biometric_devices')
      .update({ last_seen_at: seenAt, last_event_at: seenAt })
      .in('serial_no', serials)
  }

  return result
}

async function applyEvent(
  eventId: string,
  profileId: string,
  direction: Direction,
  scannedAt: string
): Promise<boolean> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('apply_biometric_punch', {
    p_profile_id: profileId,
    p_direction: direction,
    p_scanned_at: scannedAt,
  })

  const outcome = Array.isArray(data) ? data[0] : data

  if (error) {
    await supabase
      .from('biometric_events')
      .update({ status: 'error', error: error.message, processed_at: new Date().toISOString() })
      .eq('id', eventId)
    return false
  }

  await supabase
    .from('biometric_events')
    .update({
      status: 'processed',
      punch_id: outcome?.punch_id ?? null,
      error: outcome?.action === 'opened' || outcome?.action === 'closed' ? null : outcome?.action,
      processed_at: new Date().toISOString(),
    })
    .eq('id', eventId)

  return true
}

/**
 * Applies scans that arrived before their enrollment existed. Called after HR
 * maps a device user id, so the person's earlier shifts appear rather than
 * being lost to the gap between their first scan and being set up.
 */
export async function replayUnmatched(externalUserId: string): Promise<number> {
  const supabase = createAdminClient()

  const { data: enrollment } = await supabase
    .from('biometric_enrollments')
    .select('profile_id')
    .eq('device_user_id', externalUserId)
    .maybeSingle()
  if (!enrollment) return 0

  const { data: pending } = await supabase
    .from('biometric_events')
    .select('id, scanned_at, direction, device_id, biometric_devices(direction, purpose, is_active)')
    .eq('external_user_id', externalUserId)
    .eq('status', 'unmatched')
    // Oldest first: replaying out of order would toggle a 'both' device the
    // wrong way and invert someone's whole day.
    .order('scanned_at', { ascending: true })

  let applied = 0
  for (const row of pending ?? []) {
    const device = Array.isArray(row.biometric_devices)
      ? row.biometric_devices[0]
      : row.biometric_devices
    if (!device || device.is_active === false || device.purpose === 'access') continue

    const direction: Direction = row.direction ?? device.direction ?? 'both'
    await supabase.from('biometric_events').update({ profile_id: enrollment.profile_id }).eq('id', row.id)
    if (await applyEvent(row.id, enrollment.profile_id, direction, row.scanned_at)) {
      applied += 1
    }
  }

  return applied
}
