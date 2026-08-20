import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Ingest is the only surface in this app that accepts writes without a user
// session, so the signature is the entire authorization story. It gets its own
// tests for that reason.

/**
 * Verifies an HMAC-SHA256 signature over the raw request body.
 *
 * Compared with timingSafeEqual rather than `===`: a plain string comparison
 * returns early on the first differing byte, which leaks the correct prefix to
 * anyone able to time the response and lets a signature be recovered a byte at
 * a time.
 */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  // Accept "sha256=<hex>" as well as bare hex — different senders format it
  // differently and both are unambiguous.
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided.trim().toLowerCase(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function getWebhookSecret(): string | null {
  return process.env.BIOMETRIC_WEBHOOK_SECRET || null
}

/**
 * The shared token ZKTeco push devices send. Those devices cannot compute an
 * HMAC over their body — the firmware just posts plain text — so this path
 * authenticates with a fixed token in the query string instead, and is
 * deliberately a separate, weaker door that only accepts attendance logs.
 */
export function getPushToken(): string | null {
  return process.env.BIOMETRIC_PUSH_TOKEN || null
}
