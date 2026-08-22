import { createDecipheriv, timingSafeEqual } from 'node:crypto'
import { isRecord } from '../fields.ts'

export function decryptCamsCallback(body: Buffer, securityKey?: string): Buffer {
  if (!securityKey) return body

  let encoded = body.toString('utf8').trim()
  // Some HTTP stacks JSON-encode the Base64 string even though the Cams docs
  // describe a raw Base64 body. Supporting both avoids a misleading 400.
  if (encoded.startsWith('"')) {
    const parsed: unknown = JSON.parse(encoded)
    if (typeof parsed !== 'string') throw new Error('encrypted Cams body is not a Base64 string')
    encoded = parsed
  }

  const decipher = createDecipheriv('aes-256-ecb', Buffer.from(securityKey, 'utf8'), null)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(Buffer.from(encoded, 'base64')), decipher.final()])
}

export function camsAuthToken(body: Buffer): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const realTime = parsed.RealTime ?? parsed.realTime
  if (!isRecord(realTime)) return null
  const token = realTime.AuthToken ?? realTime.authToken
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

export function validCamsAuthToken(provided: string | null, allowed: string[]): boolean {
  if (!provided || allowed.length === 0) return false
  const candidate = Buffer.from(provided, 'utf8')
  return allowed.some((token) => {
    const expected = Buffer.from(token, 'utf8')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
}
