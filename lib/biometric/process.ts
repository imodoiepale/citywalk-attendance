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
  // Both the direct gateway sink and the fallback app webhook use the same
  // database function. Device/enrollment matching cannot drift between paths.
  const { data, error } = await supabase.rpc('ingest_biometric_events', { p_events: events })
  if (error) throw new Error(`biometric ingest failed: ${error.message}`)

  const row = (Array.isArray(data) ? data[0] : data) as Partial<IngestResult> | null
  return {
    received: Number(row?.received ?? 0),
    processed: Number(row?.processed ?? 0),
    duplicates: Number(row?.duplicates ?? 0),
    unmatched: Number(row?.unmatched ?? 0),
    ignored: Number(row?.ignored ?? 0),
    errors: Number(row?.errors ?? 0),
  }
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
export async function replayUnmatched(externalUserId: string, vendor: string): Promise<number> {
  const supabase = createAdminClient()

  const { data: enrollment } = await supabase
    .from('biometric_enrollments')
    .select('profile_id')
    .eq('device_user_id', externalUserId)
    .eq('vendor', vendor)
    .maybeSingle()
  if (!enrollment) return 0

  const { data: pending } = await supabase
    .from('biometric_events')
    .select('id, scanned_at, direction, device_id, biometric_devices(direction, purpose, is_active, vendor)')
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
    if (!device || device.vendor !== vendor || device.is_active === false || device.purpose === 'access') continue

    const direction: Direction = row.direction ?? device.direction ?? 'both'
    await supabase.from('biometric_events').update({ profile_id: enrollment.profile_id }).eq('id', row.id)
    if (await applyEvent(row.id, enrollment.profile_id, direction, row.scanned_at)) {
      applied += 1
    }
  }

  return applied
}
