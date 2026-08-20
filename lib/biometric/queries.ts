import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type DeviceHealth = 'online' | 'stale' | 'offline' | 'never_seen' | 'disabled'

export interface DeviceRow {
  id: string
  serialNo: string
  name: string
  model: string | null
  purpose: 'attendance' | 'access'
  direction: 'in' | 'out' | 'both'
  isActive: boolean
  branchId: string | null
  branchName: string | null
  locationLabel: string | null
  ipAddress: string | null
  lastSeenAt: string | null
  lastEventAt: string | null
  events24h: number
  health: DeviceHealth
}

/** Devices with their derived health bucket — the view owns the thresholds. */
export async function listDevices(): Promise<DeviceRow[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('biometric_device_health').select('*').order('name')

  return (data ?? []).map((row) => ({
    id: row.id,
    serialNo: row.serial_no,
    name: row.name,
    model: row.model,
    purpose: row.purpose,
    direction: row.direction,
    isActive: row.is_active,
    branchId: row.branch_id,
    branchName: row.branch_name,
    locationLabel: row.location_label,
    ipAddress: row.ip_address,
    lastSeenAt: row.last_seen_at,
    lastEventAt: row.last_event_at,
    events24h: Number(row.events_24h ?? 0),
    health: row.health as DeviceHealth,
  }))
}

export interface EnrollmentRow {
  id: string
  deviceUserId: string
  profileId: string
  fullName: string
  email: string
  branchName: string | null
  note: string | null
}

export async function listEnrollments(): Promise<EnrollmentRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('biometric_enrollments')
    .select('id, device_user_id, profile_id, note, profile:profiles(full_name, email, branch:branches(name))')
    .order('device_user_id')

  type Embed = { full_name: string; email: string; branch: { name: string } | { name: string }[] | null }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  return (data ?? []).map((row) => {
    const profile = one(row.profile as Embed | Embed[] | null)
    return {
      id: row.id,
      deviceUserId: row.device_user_id,
      profileId: row.profile_id,
      fullName: profile?.full_name ?? 'Unknown',
      email: profile?.email ?? '',
      branchName: one(profile?.branch ?? null)?.name ?? null,
      note: row.note,
    }
  })
}

export interface UnmatchedScan {
  externalUserId: string
  deviceSerial: string
  deviceName: string | null
  scans: number
  firstSeen: string
  lastSeen: string
}

/**
 * Unmatched scans grouped by enrollment number — the triage queue.
 *
 * Grouped rather than listed one row per scan: an unmapped person scanning
 * twice a day for a fortnight is one problem to fix, not thirty.
 */
export async function listUnmatchedScans(): Promise<UnmatchedScan[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('biometric_events')
    .select('external_user_id, device_serial, scanned_at, device:biometric_devices(name)')
    .eq('status', 'unmatched')
    .order('scanned_at', { ascending: false })
    .limit(2000)

  const grouped = new Map<string, UnmatchedScan>()
  for (const row of data ?? []) {
    const device = Array.isArray(row.device) ? row.device[0] : row.device
    const key = `${row.external_user_id}|${row.device_serial}`
    const existing = grouped.get(key)
    if (existing) {
      existing.scans += 1
      if (row.scanned_at < existing.firstSeen) existing.firstSeen = row.scanned_at
      if (row.scanned_at > existing.lastSeen) existing.lastSeen = row.scanned_at
    } else {
      grouped.set(key, {
        externalUserId: row.external_user_id,
        deviceSerial: row.device_serial,
        deviceName: device?.name ?? null,
        scans: 1,
        firstSeen: row.scanned_at,
        lastSeen: row.scanned_at,
      })
    }
  }

  return [...grouped.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
}

export interface EstateSummary {
  total: number
  online: number
  stale: number
  offline: number
  neverSeen: number
  disabled: number
  attendance: number
  access: number
  unassigned: number
  events24h: number
}

export function summarise(devices: DeviceRow[]): EstateSummary {
  return {
    total: devices.length,
    online: devices.filter((d) => d.health === 'online').length,
    stale: devices.filter((d) => d.health === 'stale').length,
    offline: devices.filter((d) => d.health === 'offline').length,
    neverSeen: devices.filter((d) => d.health === 'never_seen').length,
    disabled: devices.filter((d) => d.health === 'disabled').length,
    attendance: devices.filter((d) => d.purpose === 'attendance').length,
    access: devices.filter((d) => d.purpose === 'access').length,
    // An attendance clock with no branch cannot produce usable punches, so
    // this count is a to-do list, not a statistic.
    unassigned: devices.filter((d) => d.purpose === 'attendance' && !d.branchId).length,
    events24h: devices.reduce((sum, d) => sum + d.events24h, 0),
  }
}
