import type { NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { naiveToInstant } from '../../time.ts'
import { toDelimitedRows } from '../decode.ts'
import { toDirection, toVerificationMethod } from '../fields.ts'

// ZKTeco ADMS / "iclock" push. The 36 TFT500P readers already in the estate
// speak this, and the app has its own handler for it at
// app/api/biometric/iclock. Terminating it here as well is what lets the whole
// fleet move onto the HMAC-signed path and the durable spool, instead of the
// query-string token the devices are limited to.
//
// Records are tab-separated, one per line:
//   <pin>\t<yyyy-MM-dd HH:mm:ss>\t<status>\t<verify>\t<workcode>\t<reserved>
//
// This mirrors lib/biometric/adapters/zkteco.ts in the app, including the
// status-code mapping, so a reader migrated to the gateway produces byte-equal
// events to the ones it produced before.

export function parseAttlog(text: string, deviceSerial: string, timezone: string): NormalizedEvent[] {
  const events: NormalizedEvent[] = []

  for (const cols of toDelimitedRows(text)) {
    const pin = cols[0]
    const stamp = cols[1]
    if (!pin || !stamp) continue

    const scannedAt = naiveToInstant(stamp, timezone)
    if (!scannedAt) continue

    const iso = scannedAt.toISOString()
    events.push({
      deviceSerial,
      externalUserId: pin,
      scannedAt: iso,
      direction: toDirection(cols[2] ?? null),
      dedupeKey: makeDedupeKey([deviceSerial, pin, iso]),
      raw: {
        vendor: 'zkteco',
        verificationMethod: toVerificationMethod(cols[3] ?? null),
        line: cols.join('\t'),
        cols,
      },
    })
  }

  return events
}

export const zktecoParser: VendorParser = {
  name: 'zkteco',
  parse(input: VendorInput): NormalizedEvent[] {
    // The serial always rides in the query string on this protocol
    // (`?SN=...&table=ATTLOG`), never in the body.
    const serial = input.query?.SN ?? input.query?.sn ?? input.deviceSerial
    if (!serial) return []

    // Only attendance logs become punches. Operation logs and fingerprint
    // template uploads use the same endpoint and are acknowledged and dropped —
    // clocking someone in because an admin opened a menu would be wrong.
    const table = (input.query?.table ?? input.query?.Table ?? 'ATTLOG').toUpperCase()
    if (table !== 'ATTLOG') return []

    return parseAttlog(input.body.toString('utf8'), serial, input.timezone ?? 'Africa/Nairobi')
  },
}
