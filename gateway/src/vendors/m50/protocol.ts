// M50 WebSocket SDK — the wire format itself.
//
// Source: "M50 WebSocket SDK Communication Protocol" (vendor document, rev
// 2025/8/28) shipped in WebSocketSDK20251226, cross-checked against the
// vendor's own reference server — `packages/devicebroker/worker.py` in the
// Python SDK. Where the document and the reference disagree, the reference
// wins: it is what the firmware was tested against.
//
// Unlike FkWeb (one JSON object per TCP connection, stateless), this is a
// *session* protocol over WebSocket. The device will not send a single scan
// until it has completed Register → Login, and it says nothing about why when
// the handshake fails — it just closes and dials again ten seconds later. See
// session.ts for that state machine; this file only reads and writes frames.

/** Every message is one of these three. The tag present decides which. */
export type M50Kind = 'request' | 'event' | 'response'

export interface M50Message {
  kind: M50Kind
  /** Command name, whitespace-trimmed — the vendor pads them (`<Response> TimeLog_v2 </Response>`). */
  name: string
  /** Flat tag → text map. This protocol has no nesting and no attributes. */
  fields: Record<string, string>
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
}

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&apos;'
    }
  })
}

/** Cheap pre-filter so a non-M50 frame costs one regex, not a parse. */
export function looksLikeM50(text: string): boolean {
  return /<Message[\s>]/.test(text) && /<(?:Re[uq]{2}est|Event|Response)>/.test(text)
}

/**
 * Parse one device frame.
 *
 * Returns null for anything that is not an M50 message, which is how the
 * WebSocket handler decides whether this session belongs to the M50 state
 * machine or to the generic push path.
 *
 * The `<Reuqest>` spelling is normalised away first. That typo is in the
 * vendor's own document for GetUserData and friends, and it is asymmetric —
 * the closing tag is spelled correctly — so it has to be repaired before the
 * open/close matching below can see the element at all. Accepting it costs one
 * string replacement and saves a miserable afternoon if some firmware build
 * really does emit it.
 */
export function parseM50Message(text: string): M50Message | null {
  if (!looksLikeM50(text)) return null

  const body = /<Message[^>]*>([\s\S]*)<\/Message>/.exec(text)?.[1]?.replace(/<(\/?)Reuqest\s*>/g, '<$1Request>')
  if (body === undefined) return null

  const fields: Record<string, string> = {}
  // Flat children only. Deliberately not a general XML parser: this grammar has
  // no nesting, and a hand-rolled reader has no entity-expansion attack surface
  // to worry about on a socket that faces the internet.
  const child = /<([A-Za-z_][\w.-]*)\s*>([\s\S]*?)<\/\1\s*>/g
  for (let m = child.exec(body); m !== null; m = child.exec(body)) {
    fields[m[1]!] = unescapeXml(m[2]!).trim()
  }

  for (const [tag, kind] of [['Request', 'request'], ['Event', 'event'], ['Response', 'response']] as const) {
    const name = fields[tag]
    if (name) {
      delete fields[tag]
      return { kind, name, fields }
    }
  }
  return null
}

/**
 * Build a server response.
 *
 * No XML declaration: the reference server uses
 * `ElementTree.tostring(encoding="unicode")`, which emits none, and that is the
 * output the firmware is known to accept. Order is preserved because the
 * document shows a fixed order and there is no reason to find out the hard way
 * whether the parser cares.
 */
export function buildM50Response(name: string, fields: Array<[string, string | null | undefined]>): string {
  const parts = [`<Response>${escapeXml(name)}</Response>`]
  for (const [tag, value] of fields) {
    if (value === null || value === undefined) continue
    parts.push(`<${tag}>${escapeXml(value)}</${tag}>`)
  }
  return `<Message>${parts.join('')}</Message>`
}

/**
 * `2013-05-06-T11:09:30Z` → `2013-05-06T11:09:30`.
 *
 * That stray hyphen before the `T` is in every timestamp the firmware sends,
 * and it is why `new Date()` returns Invalid Date on a real frame. It also
 * tells you what the trailing `Z` is worth: a string being assembled by
 * `sprintf`, not a genuine ISO-8601 instant. See push.ts for how that suspicion
 * is resolved into an actual time.
 */
export function m50TimeParts(value: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})-?T(\d{1,2}):(\d{2}):(\d{2})Z?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return { y: Number(y), mo: Number(mo), d: Number(d), h: Number(h), mi: Number(mi), s: Number(s) }
}

/** The device's own `Name` fields are base64 UTF-16LE. Everything else is plain. */
export function decodeM50Text(base64: string): string {
  try {
    return Buffer.from(base64, 'base64').toString('utf16le')
  } catch {
    return ''
  }
}
