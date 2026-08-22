import { test } from 'node:test'
import assert from 'node:assert/strict'
import { naiveToInstant, toInstant } from '../src/time.ts'

// The timestamp rules matter more than they look. Every one of these cases has
// a plausible-looking wrong answer that would silently shift real punches.

test('a naive Nairobi timestamp resolves to the right instant', () => {
  const at = naiveToInstant('2026-08-22 13:48:32', 'Africa/Nairobi')
  assert.equal(at?.toISOString(), '2026-08-22T10:48:32.000Z')
})

test('resolution does not depend on the server timezone', () => {
  // The bug this guards: a VPS in Europe reading the device's wall clock as its
  // own local time, shifting an entire estate's attendance by hours.
  const nairobi = naiveToInstant('2026-08-22 08:00:00', 'Africa/Nairobi')
  const london = naiveToInstant('2026-08-22 08:00:00', 'Europe/London')
  assert.equal(nairobi?.toISOString(), '2026-08-22T05:00:00.000Z')
  assert.equal(london?.toISOString(), '2026-08-22T07:00:00.000Z')
})

test('a DST zone resolves against the offset in force on that date', () => {
  const winter = naiveToInstant('2026-01-15 12:00:00', 'Europe/London')
  const summer = naiveToInstant('2026-07-15 12:00:00', 'Europe/London')
  assert.equal(winter?.toISOString(), '2026-01-15T12:00:00.000Z')
  assert.equal(summer?.toISOString(), '2026-07-15T11:00:00.000Z')
})

test('separator and second-precision variants are all accepted', () => {
  const expected = '2026-08-22T10:48:00.000Z'
  assert.equal(naiveToInstant('2026-08-22 13:48', 'Africa/Nairobi')?.toISOString(), expected)
  assert.equal(naiveToInstant('2026-08-22T13:48:00', 'Africa/Nairobi')?.toISOString(), expected)
  assert.equal(naiveToInstant('2026/08/22 13:48:00', 'Africa/Nairobi')?.toISOString(), expected)
})

test('an unparseable timestamp is null, never a wrong date', () => {
  // Returning null forces the caller to skip the record. An Invalid Date or a
  // silent fallback to "now" would put a fictional time on someone's shift.
  assert.equal(naiveToInstant('not a date', 'Africa/Nairobi'), null)
  assert.equal(naiveToInstant('', 'Africa/Nairobi'), null)
  assert.equal(naiveToInstant('22-08-2026 13:48:32', 'Africa/Nairobi'), null)
})

test('an explicit offset is honoured rather than overridden', () => {
  assert.equal(toInstant('2026-08-22T13:48:32Z', 'Africa/Nairobi')?.toISOString(), '2026-08-22T13:48:32.000Z')
  assert.equal(toInstant('2026-08-22T13:48:32+03:00', 'Africa/Nairobi')?.toISOString(), '2026-08-22T10:48:32.000Z')
})

test('epoch seconds and milliseconds are recognised', () => {
  // Derived, not hardcoded: a literal epoch in a test is a number nobody can
  // check by eye, and a wrong one fails against correct code.
  const iso = '2026-08-22T10:48:32.000Z'
  const seconds = String(Date.parse(iso) / 1000)
  const millis = String(Date.parse(iso))

  assert.equal(toInstant(seconds, 'Africa/Nairobi')?.toISOString(), iso)
  assert.equal(toInstant(millis, 'Africa/Nairobi')?.toISOString(), iso)
})
