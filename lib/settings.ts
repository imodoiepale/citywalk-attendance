import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import {
  DAILY_TARGET_HOURS,
  WEEKLY_TARGET_HOURS,
  APPROACHING_THRESHOLD_HOURS,
  GRACE_PERIOD_MINUTES,
  MAX_SHIFT_HOURS,
  DUPLICATE_WINDOW_SECONDS,
} from '@/lib/targets'

export interface AppSettings {
  dailyTargetHours: number
  weeklyTargetHours: number
  approachingThresholdHours: number
  gracePeriodMinutes: number
  maxShiftHours: number
  duplicateWindowSeconds: number
  faceEnabled: boolean
  faceMinConfidence: number
  faceRetentionDays: number
  faceReenrollDays: number
  faceConsentVersion: string
}

/** The compiled-in values, used until the settings row is read. */
export const DEFAULT_SETTINGS: AppSettings = {
  dailyTargetHours: DAILY_TARGET_HOURS,
  weeklyTargetHours: WEEKLY_TARGET_HOURS,
  approachingThresholdHours: APPROACHING_THRESHOLD_HOURS,
  gracePeriodMinutes: GRACE_PERIOD_MINUTES,
  maxShiftHours: MAX_SHIFT_HOURS,
  duplicateWindowSeconds: DUPLICATE_WINDOW_SECONDS,
  // Face recognition is off until an administrator turns it on and the cameras
  // are configured — the safe default for a feature that handles biometric data.
  faceEnabled: false,
  faceMinConfidence: 0.9,
  faceRetentionDays: 365,
  faceReenrollDays: 730,
  faceConsentVersion: 'v1',
}

/**
 * Org settings, cached per request like getCurrentUser().
 *
 * Falls back to the compiled defaults rather than throwing: the settings row
 * is created by migration 20260819000003, and until that has been applied the
 * app should still render with the values it shipped with, not 500.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select(
      'daily_target_hours, weekly_target_hours, approaching_threshold_hours, grace_period_minutes, max_shift_hours, duplicate_window_seconds, face_enabled, face_min_confidence, face_retention_days, face_reenroll_days, face_consent_version'
    )
    .maybeSingle()

  if (!data) return DEFAULT_SETTINGS

  return {
    dailyTargetHours: Number(data.daily_target_hours),
    weeklyTargetHours: Number(data.weekly_target_hours),
    approachingThresholdHours: Number(data.approaching_threshold_hours),
    gracePeriodMinutes: Number(data.grace_period_minutes),
    maxShiftHours: Number(data.max_shift_hours),
    duplicateWindowSeconds: Number(data.duplicate_window_seconds ?? DUPLICATE_WINDOW_SECONDS),
    faceEnabled: Boolean(data.face_enabled),
    faceMinConfidence: Number(data.face_min_confidence ?? 0.9),
    faceRetentionDays: Number(data.face_retention_days ?? 365),
    faceReenrollDays: Number(data.face_reenroll_days ?? 730),
    faceConsentVersion: String(data.face_consent_version ?? 'v1'),
  }
})
