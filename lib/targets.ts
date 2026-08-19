// Hour targets and thresholds, in one place.
//
// These were hardcoded across TimeDial, WeeklyProgressRing and calendar-buckets.
// Collecting them here is the seam for making them admin-editable (a settings
// table + loader) without hunting through components a second time.

export const DAILY_TARGET_HOURS = 8
export const WEEKLY_TARGET_HOURS = 40

export const DAILY_TARGET_SECONDS = DAILY_TARGET_HOURS * 60 * 60
/** Point at which the dial warns the day is nearly done. */
export const APPROACHING_THRESHOLD_SECONDS = 7 * 60 * 60
