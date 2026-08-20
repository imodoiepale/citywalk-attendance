import type { Adapter, Direction, NormalizedEvent } from '../types'
import { makeDedupeKey } from '../types'

/**
 * ZKTeco ADMS / "iclock" push protocol.
 *
 * The devices in this estate (TFT500P) post attendance logs as tab-separated
 * plain text to `/iclock/cdata?SN=<serial>&table=ATTLOG`, one record per line:
 *
 *   <pin>\t<yyyy-MM-dd HH:mm:ss>\t<status>\t<verify>\t<workcode>\t<reserved>
 *
 * The first field is the enrollment number, the second the scan time in the
 * device's local timezone, the third the in/out state where the device is
 * configured to report one.
 *
 * Timestamps carry no zone. They are interpreted as Africa/Nairobi (+03:00),
 * which is the only timezone this company operates in, rather than as the
 * server's — a server in a different region would otherwise shift every punch.
 */

const NAIROBI_OFFSET = '+03:00'

// The device's status column. 0/4 are the common check-in codes and 1/5 the
// check-out ones across ZKTeco firmwares; anything else means the device is not
// telling us a direction and its configured role should decide.
function toDirection(status: string | undefined): Direction | null {
  switch ((status ?? '').trim()) {
    case '0':
    case '4':
      return 'in'
    case '1':
    case '5':
      return 'out'
    default:
      return null
  }
}

export function parseAttlog(body: string, deviceSerial: string): NormalizedEvent[] {
  const events: NormalizedEvent[] = []

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const cols = trimmed.split('\t')
    const pin = cols[0]?.trim()
    const stamp = cols[1]?.trim()
    if (!pin || !stamp) continue

    // "2026-08-20 08:14:03" -> a real instant, pinned to EAT.
    const scannedAt = new Date(`${stamp.replace(' ', 'T')}${NAIROBI_OFFSET}`)
    if (Number.isNaN(scannedAt.getTime())) continue

    events.push({
      deviceSerial,
      externalUserId: pin,
      scannedAt: scannedAt.toISOString(),
      direction: toDirection(cols[2]),
      dedupeKey: makeDedupeKey([deviceSerial, pin, scannedAt.toISOString()]),
      raw: { line: trimmed, cols },
    })
  }

  return events
}

export const zktecoAdapter: Adapter = {
  name: 'zkteco',
  parse(payload, context) {
    if (typeof payload !== 'string' || !context?.deviceSerial) return []
    return parseAttlog(payload, context.deviceSerial)
  },
}
