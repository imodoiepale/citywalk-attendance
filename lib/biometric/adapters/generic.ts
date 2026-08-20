import type { Adapter, Direction, NormalizedEvent } from '../types'
import { makeDedupeKey } from '../types'

// Plain JSON webhook, for an on-site server (or the connector script) to POST.
// Accepts a single event or an array, and tolerates the field-name variations
// every one of these systems has: user_id / userId / pin / badge, etc.

function pick(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return null
}

function toDirection(value: string | null): Direction | null {
  if (!value) return null
  const v = value.toLowerCase()
  if (['in', '0', 'checkin', 'check-in', 'entry'].includes(v)) return 'in'
  if (['out', '1', 'checkout', 'check-out', 'exit'].includes(v)) return 'out'
  return null
}

export const genericAdapter: Adapter = {
  name: 'generic',
  parse(payload, context) {
    const body = payload as Record<string, unknown>
    const rows = Array.isArray(payload)
      ? (payload as Record<string, unknown>[])
      : Array.isArray(body?.events)
        ? (body.events as Record<string, unknown>[])
        : [body]

    const events: NormalizedEvent[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue

      const deviceSerial =
        pick(row, ['device_serial', 'deviceSerial', 'serial_no', 'serialNumber', 'sn']) ??
        context?.deviceSerial ??
        null
      const externalUserId = pick(row, [
        'external_user_id', 'externalUserId', 'user_id', 'userId', 'pin', 'badge', 'employee_id',
      ])
      const scannedRaw = pick(row, [
        'scanned_at', 'scannedAt', 'timestamp', 'time', 'punch_time', 'event_time',
      ])
      if (!deviceSerial || !externalUserId || !scannedRaw) continue

      const scannedAt = new Date(scannedRaw)
      if (Number.isNaN(scannedAt.getTime())) continue

      events.push({
        deviceSerial,
        externalUserId,
        scannedAt: scannedAt.toISOString(),
        direction: toDirection(pick(row, ['direction', 'state', 'status', 'in_out', 'type'])),
        dedupeKey: makeDedupeKey([deviceSerial, externalUserId, scannedAt.toISOString()]),
        raw: row,
      })
    }
    return events
  },
}
