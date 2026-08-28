import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Template encryption.
//
// A fingerprint or face template is biometric personal data. Storing it in
// Postgres in the clear would make every database dump, every backup and every
// read-replica a biometric dataset — which is a materially different thing to
// be responsible for than a table of clock-in times.
//
// So templates are sealed HERE, before they leave the gateway, with a key that
// lives only in the process environment. A dump on its own is then ciphertext.
// This is not a substitute for RLS or for consent; it removes one specific and
// very large failure mode.
//
// AES-256-GCM: authenticated, so a tampered ciphertext fails to open rather
// than yielding a wrong template that gets pushed to a reader.

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12   // GCM standard; 96-bit nonces are the recommended size
const TAG_BYTES = 16
const KEY_BYTES = 32

export interface SealedTemplate {
  /**
   * Which key sealed this, so a rotation can re-seal in the background and
   * both generations remain readable meanwhile. Derived from the key, never
   * the key itself.
   */
  keyId: string
  /** base64( iv | tag | ciphertext ) */
  ciphertext: string
}

export interface TemplateKey {
  id: string
  material: Buffer
}

/**
 * A short, stable, non-reversible name for a key.
 *
 * Storing a hash prefix rather than "v1" means two deployments cannot disagree
 * about what "v1" was, and a mis-set key is detected as "no key with that id"
 * instead of silently producing garbage.
 */
export function keyIdOf(material: Buffer): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

/**
 * Reads a key from an environment variable.
 *
 * Accepts base64 or hex, because both are what people paste. Rejects anything
 * that is not exactly 32 bytes rather than padding or truncating — a silently
 * wrong-length key would encrypt happily and be undecryptable later.
 */
export function parseTemplateKey(value: string): TemplateKey {
  const trimmed = value.trim()

  let material: Buffer | null = null
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    material = Buffer.from(trimmed, 'hex')
  } else {
    const decoded = Buffer.from(trimmed, 'base64')
    if (decoded.length === KEY_BYTES) material = decoded
  }

  if (!material || material.length !== KEY_BYTES) {
    throw new Error(
      'BIOMETRIC_TEMPLATE_KEY must be 32 bytes, as 64 hex characters or base64. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    )
  }

  return { id: keyIdOf(material), material }
}

export function seal(plaintext: string, key: TemplateKey): SealedTemplate {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key.material, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    keyId: key.id,
    ciphertext: Buffer.concat([iv, tag, body]).toString('base64'),
  }
}

/**
 * Opens a sealed template.
 *
 * Takes every key we hold rather than one, so a rotation does not make older
 * rows unreadable the moment the new key is deployed.
 */
export function open(sealed: SealedTemplate, keys: TemplateKey[]): string {
  const key = keys.find((k) => k.id === sealed.keyId)
  if (!key) {
    throw new Error(
      `no template key with id ${sealed.keyId} is loaded — this row was sealed with a key ` +
      'that is not in BIOMETRIC_TEMPLATE_KEY or BIOMETRIC_TEMPLATE_KEYS_PREVIOUS'
    )
  }

  const raw = Buffer.from(sealed.ciphertext, 'base64')
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error('sealed template is truncated')

  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const body = raw.subarray(IV_BYTES + TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key.material, iv)
  decipher.setAuthTag(tag)
  // Throws on a tampered or corrupt ciphertext, which is the point: a wrong
  // template pushed to a reader would let the wrong person through a door.
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/**
 * Loads the active key and any previous ones still needed for decryption.
 *
 * Returns null when no key is configured. That is a legitimate deployment —
 * a gateway doing attendance only, never enrolment — and the caller refuses
 * credential work rather than storing anything unsealed.
 */
export function loadTemplateKeys(env: NodeJS.ProcessEnv = process.env): {
  active: TemplateKey
  all: TemplateKey[]
} | null {
  const primary = env.BIOMETRIC_TEMPLATE_KEY?.trim()
  if (!primary) return null

  const active = parseTemplateKey(primary)
  const previous = (env.BIOMETRIC_TEMPLATE_KEYS_PREVIOUS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map(parseTemplateKey)

  // Dedupe by id so listing the active key in both variables is harmless.
  const all = [active, ...previous].filter(
    (k, i, list) => list.findIndex((o) => o.id === k.id) === i
  )
  return { active, all }
}
