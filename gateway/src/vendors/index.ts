import type { VendorParser } from '../types.ts'
import { ebknParser } from './ebkn/push.ts'
import { fkwebParser } from './fkweb/push.ts'
import { m82Parser } from './m82/push.ts'
import { zktecoParser } from './zkteco/adms.ts'
import { genericParser } from './generic/json.ts'
import { camsParser } from './cams/callback.ts'

// The seam, mirroring lib/biometric/adapters/index.ts in the app. Supporting
// another reader family is one new file plus one line here; the server, spool,
// forwarder and every deployment target stay untouched.

const PARSERS: Record<string, VendorParser> = {
  // The FK/EBKN native real-time protocol, written from the vendor's own
  // server implementation. Prefer this over `ebkn` for any terminal set to
  // "Server-Client Mode: FkWeb" — it is the only parser that returns the
  // acknowledgement those terminals block on.
  // The M82 firmware generation, verified against hardware. Distinct from
  // fkweb despite the terminal menu calling both "FkWeb": it routes by header,
  // length-prefixes its body, and has no log_id. Listed first so it claims its
  // own frames before fkweb sees a body it cannot parse.
  m82: m82Parser,
  fkweb: fkwebParser,
  ebkn: ebknParser,
  zkteco: zktecoParser,
  generic: genericParser,
  cams: camsParser,
}

export function getParser(name: string | null | undefined): VendorParser {
  return PARSERS[(name ?? 'generic').toLowerCase()] ?? genericParser
}

export function vendorNames(): string[] {
  return Object.keys(PARSERS)
}

export { ebknParser, fkwebParser, m82Parser, zktecoParser, genericParser, camsParser }
