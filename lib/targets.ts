// Compiled-in fallbacks for the org's hour targets.
//
// These are no longer the source of truth — `app_settings` is, read via
// lib/settings.ts. They remain as the defaults used before that row exists
// (and by pure client code that has no server round-trip available), which is
// why the numbers still live in one place rather than back in the components.

export const DAILY_TARGET_HOURS = 8
export const WEEKLY_TARGET_HOURS = 40
export const APPROACHING_THRESHOLD_HOURS = 7
export const GRACE_PERIOD_MINUTES = 10
export const MAX_SHIFT_HOURS = 16
/** Same device+person scans closer together than this count as one duplicate. */
export const DUPLICATE_WINDOW_SECONDS = 60

export const DAILY_TARGET_SECONDS = DAILY_TARGET_HOURS * 60 * 60
/** Point at which the dial warns the day is nearly done. */
export const APPROACHING_THRESHOLD_SECONDS = APPROACHING_THRESHOLD_HOURS * 60 * 60

export const hoursToSeconds = (hours: number) => Math.round(hours * 60 * 60)
