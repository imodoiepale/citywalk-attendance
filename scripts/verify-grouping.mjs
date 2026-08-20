// The timesheet roll-up invariant.
//
//   node --experimental-strip-types scripts/verify-grouping.mjs
//
// Folding day columns into weeks, months, quarters or years is a pure
// regrouping of the same per-day numbers. So the one thing that must hold at
// every granularity is that the total does not move: a roll-up that changes the
// total is presenting a wrong number as a right one, which is worse than not
// offering the feature. Everything else here supports that claim — that each
// day lands in exactly one bucket, and that weeks start Monday because a
// payroll week is a working week.

import assert from 'node:assert/strict'
import { GRANULARITIES, groupKeysFor, bucketHours } from '../lib/reports/grouping.ts'

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// A span deliberately crossing a month, a quarter and a year boundary, so the
// bucketing is exercised where it is most likely to be wrong.
const days = {}
const start = new Date(Date.UTC(2025, 10, 15)) // 15 Nov 2025
for (let i = 0; i < 120; i++) {
  const d = new Date(start.getTime() + i * 86_400_000)
  days[d.toISOString().slice(0, 10)] = 1 + (i % 4) * 0.5
}
const dateKeys = Object.keys(days)
const expectedTotal = Object.values(days).reduce((a, b) => a + b, 0)

for (const { value } of GRANULARITIES) {
  const buckets = groupKeysFor(dateKeys, value)
  const total = buckets.reduce((sum, b) => sum + bucketHours(days, b), 0)
  check(
    `${value}: total is unchanged by the roll-up`,
    Math.abs(total - expectedTotal) < 1e-9,
    `expected ${expectedTotal}, got ${total}`
  )

  const covered = buckets.flatMap((b) => b.dateKeys)
  check(
    `${value}: every day lands in exactly one bucket`,
    covered.length === dateKeys.length && new Set(covered).size === dateKeys.length,
    `${dateKeys.length} days in, ${covered.length} out (${new Set(covered).size} distinct)`
  )

  const keys = buckets.map((b) => b.key)
  check(`${value}: buckets are in chronological order`,
    JSON.stringify(keys) === JSON.stringify([...keys].sort()))
}

// Monday-first is a payroll rule, not a display preference — asserted directly
// rather than inferred from the labels.
const weeks = groupKeysFor(dateKeys, 'week')
const firstFullWeek = weeks.find((w) => w.dateKeys.length === 7)
const firstDay = new Date(`${firstFullWeek.dateKeys[0]}T12:00:00Z`).getUTCDay()
check('weeks start on Monday', firstDay === 1, `first day of a full week is weekday ${firstDay}`)

// Coarser groupings must never produce more columns than finer ones.
const counts = GRANULARITIES.map(({ value }) => groupKeysFor(dateKeys, value).length)
check('bucket counts decrease as granularity coarsens',
  counts.every((n, i) => i === 0 || n <= counts[i - 1]), counts.join(' >= '))

console.log(failures === 0 ? '\nALL GROUPING ASSERTIONS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
