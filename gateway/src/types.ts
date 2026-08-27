// The shape the attendance app's ingest webhook understands.
//
// This is a deliberate verbatim mirror of `lib/biometric/types.ts` in the
// Next.js app. The gateway's whole job is to turn vendor noise into this and
// nothing else, so the app never learns what an EBKN frame looks like. If the
// app's type changes, this changes with it — test/contract.test.ts pins them
// together.

export type Direction = 'in' | 'out' | 'both'

export interface NormalizedEvent {
  /** Serial of the reader. The stable device identity; names and IPs are not. */
  deviceSerial: string
  /** The enrollment number as the device knows it. Always text: some vendors zero-pad. */
  externalUserId: string
  /** When the person actually scanned, per the device. ISO 8601, absolute. */
  scannedAt: string
  /** Direction the device reported, or null to let the app's device row decide. */
  direction: Direction | null
  /**
   * Stable per-scan identity for idempotency. Derived from the scan itself
   * (device + user + timestamp), never from receipt time — a terminal replaying
   * its buffer after an outage must not look like a fresh set of scans.
   */
  dedupeKey: string
  /** The untouched payload, kept for audit and for adapters we later get wrong. */
  raw: unknown
}

export function makeDedupeKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => String(p ?? '')).join('|')
}

/** Every vendor module exposes this. Adding a reader family is one new file. */
export interface VendorParser {
  name: string
  /**
   * Turn one received payload into zero or more events. Returning [] is a
   * normal outcome (heartbeats, handshakes, keep-alives) and is not an error.
   */
  parse(input: VendorInput): NormalizedEvent[]
  /**
   * The reply this firmware waits for before it considers a scan delivered.
   *
   * Optional because most HTTP-family readers are happy with the transport's
   * own 200. It exists for the raw-TCP families that will re-send their whole
   * buffer — forever — until they get an application-level acknowledgement.
   * Returning null means "nothing to say", not "failure".
   *
   * Only called once a scan has actually been accepted, so a device we refuse
   * to record for is also a device we do not tell "OK".
   */
  ack?(input: VendorInput, events: NormalizedEvent[]): string | null
}

export interface VendorInput {
  /** Raw bytes exactly as received. Never re-encoded before this point. */
  body: Buffer
  /** Path the device posted to, when the transport has one. */
  path?: string
  /** Query parameters, when the transport has them. */
  query?: Record<string, string>
  /** Headers, lowercased, when the transport has them. */
  headers?: Record<string, string>
  /** Serial from config or transport, used when the payload omits its own. */
  deviceSerial?: string
  /** IANA zone for interpreting naive local timestamps. */
  timezone?: string
}
