import type { VendorParser } from '../types.ts'
import { ebknParser } from './ebkn/push.ts'
import { zktecoParser } from './zkteco/adms.ts'
import { genericParser } from './generic/json.ts'
import { camsParser } from './cams/callback.ts'

// The seam, mirroring lib/biometric/adapters/index.ts in the app. Supporting
// another reader family is one new file plus one line here; the server, spool,
// forwarder and every deployment target stay untouched.

const PARSERS: Record<string, VendorParser> = {
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

export { ebknParser, zktecoParser, genericParser, camsParser }
