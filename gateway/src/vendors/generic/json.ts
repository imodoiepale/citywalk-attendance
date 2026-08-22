import type { NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { toInstant } from '../../time.ts'
import { decode } from '../decode.ts'
import {
  DIRECTION_KEYS, METHOD_KEYS, SERIAL_KEYS, TIME_KEYS, USER_KEYS,
  pick, toDirection, toRows, toVerificationMethod, withoutSynthetic,
} from '../fields.ts'

// For anything that already speaks sane JSON: a middleware, a vendor cloud
// webhook, a future reader, or the test harness. Also the fallback when a
// device is configured with a vendor the registry does not know — better to
// try than to drop a real scan because of a config typo.

export const genericParser: VendorParser = {
  name: 'generic',
  parse(input: VendorInput): NormalizedEvent[] {
    const tz = input.timezone ?? 'Africa/Nairobi'
    const decoded = decode(input.body, input.headers?.['content-type'])
    if (decoded.kind !== 'json' && decoded.kind !== 'form') return []

    const rows = decoded.kind === 'form'
      ? [decoded.value as Record<string, unknown>]
      : toRows(decoded.value)

    const events: NormalizedEvent[] = []
    for (const row of rows) {
      const deviceSerial = pick(row, SERIAL_KEYS) ?? input.deviceSerial ?? null
      const externalUserId = pick(row, USER_KEYS)
      const rawTime = pick(row, TIME_KEYS)
      if (!deviceSerial || !externalUserId || !rawTime) continue

      const scannedAt = toInstant(rawTime, tz)
      if (!scannedAt) continue

      const iso = scannedAt.toISOString()
      events.push({
        deviceSerial,
        externalUserId,
        scannedAt: iso,
        direction: toDirection(pick(row, DIRECTION_KEYS)),
        dedupeKey: makeDedupeKey([deviceSerial, externalUserId, iso]),
        raw: {
          vendor: 'generic',
          verificationMethod: toVerificationMethod(pick(row, METHOD_KEYS)),
          record: withoutSynthetic(row),
        },
      })
    }
    return events
  },
}
