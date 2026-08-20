'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { replayUnmatched } from '@/lib/biometric/process'

export interface DeviceFormState {
  ok?: boolean
  error?: string
}

export async function saveDeviceAction(
  _prev: DeviceFormState,
  formData: FormData
): Promise<DeviceFormState> {
  await requireUser()
  const supabase = await createClient()

  const purpose = String(formData.get('purpose') ?? 'attendance')
  const branchId = String(formData.get('branch_id') ?? '') || null

  // Mirrors the check inside admin_upsert_device so the message arrives next to
  // the field instead of as a raw Postgres exception.
  if (purpose === 'attendance' && !branchId) {
    return { error: 'An attendance device must be assigned to a branch.' }
  }

  const int = (key: string) => {
    const raw = String(formData.get(key) ?? '').trim()
    if (!raw) return null
    const n = Number(raw)
    return Number.isInteger(n) ? n : null
  }

  const { error } = await supabase.rpc('admin_upsert_device', {
    p_id: String(formData.get('id') ?? '') || null,
    p_serial_no: String(formData.get('serial_no') ?? ''),
    p_name: String(formData.get('name') ?? ''),
    p_branch_id: branchId,
    p_purpose: purpose,
    p_direction: String(formData.get('direction') ?? 'both'),
    p_location_label: String(formData.get('location_label') ?? ''),
    p_model: String(formData.get('model') ?? ''),
    p_ip_address: String(formData.get('ip_address') ?? ''),
    p_port: int('port') ?? 4370,
    p_node_id: int('node_id'),
    p_is_active: formData.get('is_active') === 'on',
  })

  if (error) return { error: error.message }

  revalidatePath('/admin/devices')
  return { ok: true }
}

export interface MapEnrollmentState {
  ok?: boolean
  error?: string
  /** Scans that were waiting on this mapping and have now become punches. */
  replayed?: number
}

export async function mapEnrollmentAction(
  _prev: MapEnrollmentState,
  formData: FormData
): Promise<MapEnrollmentState> {
  await requireUser()
  const supabase = await createClient()

  const deviceUserId = String(formData.get('device_user_id') ?? '').trim()
  const profileId = String(formData.get('profile_id') ?? '')
  if (!deviceUserId || !profileId) {
    return { error: 'Pick both an enrollment number and a person.' }
  }

  const { error } = await supabase.rpc('admin_map_enrollment', {
    p_device_user_id: deviceUserId,
    p_profile_id: profileId,
    p_vendor: 'zkteco',
    p_note: String(formData.get('note') ?? '').trim() || null,
  })
  if (error) return { error: error.message }

  // Scans that arrived before this person was mapped become real punches now,
  // rather than being lost to the gap between their first scan and being set up.
  const replayed = await replayUnmatched(deviceUserId)

  revalidatePath('/admin/devices/enrollments')
  revalidatePath('/admin/devices/unmatched')
  revalidatePath('/reports/timesheets')
  return { ok: true, replayed }
}
