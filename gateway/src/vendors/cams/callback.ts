import type { NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { toInstant } from '../../time.ts'
import { decode } from '../decode.ts'
import { isRecord, toDirection, toVerificationMethod } from '../fields.ts'

// Cams Biometric Web API v3 callback parser. This is intentionally separate
// from the EN-K190FTW parser: Cams is a cloud protocol service, not the device's
// native FkWeb wire format. A site may use either path without conflating them.

function value(record: Record<string, unknown>, ...keys: string[]): string | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()))
  for (const [key, candidate] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && candidate != null && String(candidate).trim()) {
      return String(candidate).trim()
    }
  }
  return null
}

export function parseCamsCallback(input: VendorInput): NormalizedEvent[] {
  const decoded = decode(input.body, input.headers?.['content-type'])
  if (decoded.kind !== 'json' || !isRecord(decoded.value)) return []

  const realTimeCandidate = decoded.value.RealTime ?? decoded.value.realTime
  if (!isRecord(realTimeCandidate)) return []

  const punchCandidate = realTimeCandidate.PunchLog ?? realTimeCandidate.punchLog
  if (!isRecord(punchCandidate)) return []

  const deviceSerial =
    value(realTimeCandidate, 'SerialNumber') ?? input.deviceSerial ?? null
  const externalUserId = value(punchCandidate, 'UserId', 'UserID')
  const rawTime = value(punchCandidate, 'LogTime')
  if (!deviceSerial || !externalUserId || !rawTime) return []

  const scannedAt = toInstant(rawTime, input.timezone ?? 'Africa/Nairobi')
  if (!scannedAt) return []

  const iso = scannedAt.toISOString()
  return [{
    deviceSerial,
    externalUserId,
    scannedAt: iso,
    direction: toDirection(value(punchCandidate, 'Type')),
    dedupeKey: makeDedupeKey([deviceSerial, externalUserId, iso]),
    raw: {
      vendor: 'cams',
      operationId: value(realTimeCandidate, 'OperationID'),
      verificationMethod: toVerificationMethod(value(punchCandidate, 'InputType')),
      record: punchCandidate,
    },
  }]
}

export const camsParser: VendorParser = {
  name: 'cams',
  parse: parseCamsCallback,
}
