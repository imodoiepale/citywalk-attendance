'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'face-enrollments'

export interface FaceFormState {
  ok?: boolean
  error?: string
}

/**
 * Records consent and stores the uploaded photo.
 *
 * The consent checkbox is validated here as well as in the database, so the
 * message lands next to the box rather than as a raw Postgres exception — but
 * the database is the actual guard: consent_version is NOT NULL, so there is no
 * code path that produces an enrolment without one.
 */
export async function uploadFaceAction(
  _prev: FaceFormState,
  formData: FormData
): Promise<FaceFormState> {
  const user = await requireUser()
  const supabase = await createClient()

  const consented = formData.get('consent') === 'on'
  if (!consented) {
    return { error: 'You have to agree before a photo can be used for recognition.' }
  }

  const file = formData.get('photo')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a photo first.' }
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: 'That photo is larger than 5MB. Try a smaller one.' }
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return { error: 'Use a JPEG, PNG or WebP image.' }
  }

  const { data: settings } = await supabase
    .from('app_settings')
    .select('face_enabled, face_consent_version')
    .maybeSingle()
  if (!settings?.face_enabled) {
    return { error: 'Face recognition is not switched on for this organisation yet.' }
  }

  // Keyed by owner so the storage policies can be written against the first
  // path segment.
  const extension = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${user.id}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) return { error: uploadError.message }

  const { error } = await supabase.rpc('request_face_enrollment', {
    p_storage_path: path,
    p_consent_version: settings.face_consent_version ?? 'v1',
  })
  if (error) {
    // Do not leave an orphaned photo behind if the record could not be written.
    await supabase.storage.from(BUCKET).remove([path])
    return { error: error.message }
  }

  revalidatePath('/me')
  revalidatePath('/admin/settings')
  return { ok: true }
}

/**
 * Revokes an enrolment and deletes the stored photo.
 *
 * The RPC returns the object key precisely so the file can then be removed —
 * a revocation that only flips a flag would leave the photo sitting in storage,
 * which is not what "delete my data" means.
 */
export async function revokeFaceAction(profileId?: string): Promise<FaceFormState> {
  await requireUser()
  const supabase = await createClient()

  const { data: path, error } = await supabase.rpc('revoke_face_enrollment', {
    p_profile_id: profileId ?? null,
  })
  if (error) return { error: error.message }

  if (typeof path === 'string' && path.length > 0) {
    // Service role: an administrator revoking someone else's enrolment cannot
    // delete an object under that person's folder with their own credentials.
    const admin = createAdminClient()
    await admin.storage.from(BUCKET).remove([path])
  }

  revalidatePath('/me')
  revalidatePath('/admin/settings')
  return { ok: true }
}
