import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type DeviceHealth = 'online' | 'stale' | 'offline' | 'never_seen' | 'disabled'

export interface DeviceRow {
  id: string
  serialNo: string
  name: string
  model: string | null
  vendor: string
  nodeId: number | null
  port: number
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
    vendor: row.vendor,
    nodeId: row.node_id,
    port: row.port,
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
  vendor: string
}

export async function listEnrollments(): Promise<EnrollmentRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('biometric_enrollments')
    .select('id, vendor, device_user_id, profile_id, note, profile:profiles(full_name, email, branch:branches(name))')
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
      vendor: row.vendor,
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
  vendor: string
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
    .select('external_user_id, device_serial, scanned_at, device:biometric_devices(name, vendor)')
    .eq('status', 'unmatched')
    .order('scanned_at', { ascending: false })
    .limit(2000)

  const grouped = new Map<string, UnmatchedScan>()
  for (const row of data ?? []) {
    const device = Array.isArray(row.device) ? row.device[0] : row.device
    const vendor = device?.vendor ?? 'generic'
    const key = `${vendor}|${row.external_user_id}|${row.device_serial}`
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
        vendor,
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

// ── Device management: inventory, credentials, command history ───────────────
//
// Added with the cloud channel. These read what the gateway writes: the
// registration inventory, what each reader actually holds, and the audit trail
// of every command someone sent it.

export interface DeviceDetail extends DeviceRow {
  firmware: string | null
  /** Template algorithm. Credentials only replicate between matching values. */
  fpAlgo: string | null
  capacity: Record<string, number> | null
  cloudConnectedAt: string | null
  /** Device family, which decides what the UI may offer for this reader. */
  protocol: string | null
}

export async function getDeviceDetail(serialNo: string): Promise<DeviceDetail | null> {
  const supabase = await createClient()

  const [health, extra] = await Promise.all([
    supabase.from('biometric_device_health').select('*').eq('serial_no', serialNo).maybeSingle(),
    supabase
      .from('biometric_devices')
      .select('firmware, fp_algo, capacity, cloud_connected_at, protocol')
      .eq('serial_no', serialNo)
      .maybeSingle(),
  ])

  const row = health.data
  if (!row) return null

  return {
    id: row.id,
    serialNo: row.serial_no,
    name: row.name,
    model: row.model,
    vendor: row.vendor,
    nodeId: row.node_id,
    port: row.port,
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
    firmware: extra.data?.firmware ?? null,
    fpAlgo: extra.data?.fp_algo ?? null,
    capacity: (extra.data?.capacity as Record<string, number> | null) ?? null,
    cloudConnectedAt: extra.data?.cloud_connected_at ?? null,
    protocol: extra.data?.protocol ?? null,
  }
}

export interface DeviceCommandRow {
  id: string
  command: string
  status: 'queued' | 'sent' | 'succeeded' | 'failed' | 'expired'
  error: string | null
  reason: string | null
  requestedBy: string | null
  createdAt: string
  completedAt: string | null
}

/** Recent commands for one device. The audit trail for anything door-related. */
export async function listDeviceCommands(deviceId: string, limit = 50): Promise<DeviceCommandRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('device_commands')
    .select('id, command, status, error, reason, created_at, completed_at, requester:profiles!device_commands_requested_by_id_fkey(full_name)')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => {
    const requester = Array.isArray(row.requester) ? row.requester[0] : row.requester
    return {
      id: row.id,
      command: row.command,
      status: row.status,
      error: row.error,
      reason: row.reason,
      requestedBy: requester?.full_name ?? null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }
  })
}

export interface CredentialRow {
  id: string
  credentialType: 'fingerprint' | 'face' | 'card' | 'password'
  backupNum: number
  fpAlgo: string | null
  capturedVia: 'device' | 'photo' | 'imported'
  capturedAt: string
  revokedAt: string | null
  /** Per-device replication state. Empty means it has reached no reader yet. */
  devices: { deviceId: string; deviceName: string | null; state: string; lastError: string | null }[]
}

/**
 * A person's credentials and where each has reached.
 *
 * Reads the summary VIEW, never the table: the sealed template is not granted
 * to `authenticated` at all, so there is no path from the browser to a
 * biometric template even with a compromised session.
 */
export async function listCredentials(profileId: string): Promise<CredentialRow[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('biometric_credential_summary')
    .select('id, credential_type, backup_num, fp_algo, captured_via, captured_at, revoked_at')
    .eq('profile_id', profileId)
    .is('revoked_at', null)
    .order('credential_type')

  const credentials = data ?? []
  if (credentials.length === 0) return []

  const { data: states } = await supabase
    .from('device_credential_state')
    .select('credential_id, state, last_error, device:biometric_devices(id, name)')
    .in('credential_id', credentials.map((c) => c.id))

  const byCredential = new Map<string, CredentialRow['devices']>()
  for (const row of states ?? []) {
    const device = Array.isArray(row.device) ? row.device[0] : row.device
    const list = byCredential.get(row.credential_id) ?? []
    list.push({
      deviceId: device?.id ?? '',
      deviceName: device?.name ?? null,
      state: row.state,
      lastError: row.last_error,
    })
    byCredential.set(row.credential_id, list)
  }

  return credentials.map((c) => ({
    id: c.id,
    credentialType: c.credential_type,
    backupNum: c.backup_num,
    fpAlgo: c.fp_algo,
    capturedVia: c.captured_via,
    capturedAt: c.captured_at,
    revokedAt: c.revoked_at,
    devices: byCredential.get(c.id) ?? [],
  }))
}

/** Whether this person has consented to us holding biometric credentials. */
export async function hasLiveConsent(profileId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('biometric_consents')
    .select('id')
    .eq('profile_id', profileId)
    .is('withdrawn_at', null)
    .maybeSingle()
  return Boolean(data)
}
