// The one shape every ingest path converges on. Adapters translate a vendor's
// payload into this; nothing downstream — processing, the admin screens, the
// tests — knows which vendor an event came from.

export type Direction = 'in' | 'out' | 'both'

export interface NormalizedEvent {
  /** Serial of the reader. The stable device identity; names and IPs are not. */
  deviceSerial: string
  /** The enrollment number as the device knows it. Always text: some vendors zero-pad. */
  externalUserId: string
  /** When the person actually scanned, per the device. */
  scannedAt: string
  /**
   * Direction the device reported, if it reported one. Null means "use the
   * device's configured direction" — most readers only know their own role.
   */
  direction: Direction | null
  /**
   * Stable per-scan identity for idempotency. Must be derived from the scan
   * itself (device + user + timestamp), never from receipt time, or a device
   * replaying its buffer after an outage would look like new scans.
   */
  dedupeKey: string
  /** The untouched payload, kept for audit and for adapters we later get wrong. */
  raw: unknown
}

export interface Adapter {
  name: string
  parse(payload: unknown, context?: { deviceSerial?: string }): NormalizedEvent[]
}

export function makeDedupeKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => String(p ?? '')).join('|')
}
