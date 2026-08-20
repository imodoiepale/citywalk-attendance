import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface FaceEnrollment {
  id: string
  profileId: string
  status: 'pending' | 'enrolled' | 'failed' | 'revoked'
  storagePath: string | null
  consentedAt: string
  consentVersion: string
  cameraRef: string | null
  enrolledAt: string | null
  failureReason: string | null
}

/** The caller's live enrolment, if any. RLS restricts this to self. */
export async function getMyFaceEnrollment(userId: string): Promise<FaceEnrollment | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('face_enrollments')
    .select('*')
    .eq('profile_id', userId)
    .is('revoked_at', null)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    profileId: data.profile_id,
    status: data.status,
    storagePath: data.storage_path,
    consentedAt: data.consented_at,
    consentVersion: data.consent_version,
    cameraRef: data.camera_ref,
    enrolledAt: data.enrolled_at,
    failureReason: data.failure_reason,
  }
}

export interface FaceRosterRow {
  profileId: string
  fullName: string
  email: string
  branchName: string | null
  status: FaceEnrollment['status'] | 'none'
  enrolledAt: string | null
}

/**
 * Who has a face on file and who does not.
 *
 * Driven from profiles rather than from enrolments, so the people *without* one
 * appear — which is the actual question an administrator is asking.
 */
export async function getFaceRoster(): Promise<FaceRosterRow[]> {
  const supabase = await createClient()
  const [{ data: profiles }, { data: enrollments }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, branch:branches(name)')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('face_enrollments').select('profile_id, status, enrolled_at').is('revoked_at', null),
  ])

  const byProfile = new Map((enrollments ?? []).map((e) => [e.profile_id, e]))

  return (profiles ?? []).map((row) => {
    const branch = Array.isArray(row.branch) ? row.branch[0] : row.branch
    const enrollment = byProfile.get(row.id)
    return {
      profileId: row.id,
      fullName: row.full_name,
      email: row.email,
      branchName: branch?.name ?? null,
      status: (enrollment?.status as FaceEnrollment['status']) ?? 'none',
      enrolledAt: enrollment?.enrolled_at ?? null,
    }
  })
}
