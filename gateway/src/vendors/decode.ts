import { isRecord } from './fields.ts'

// A device push arrives as bytes with, at best, a content-type header the
// firmware may well be lying about. Before any vendor logic runs, this turns
// bytes into either a parsed structure or a string, and says which — so a
// parser never has to guess whether it is holding JSON.

export type Decoded =
  | { kind: 'json'; value: unknown; text: string }
  | { kind: 'form'; value: Record<string, string>; text: string }
  | { kind: 'text'; value: string; text: string }
  | { kind: 'binary'; value: Buffer; text: string }

/**
 * True when a buffer really is text rather than a binary frame.
 *
 * This decides whether a payload is handed to a text parser or kept as opaque
 * bytes, so a ratio-of-printable-characters guess is not good enough: a short
 * binary frame is easily 85% "printable" by that measure and gets mangled into
 * a text parse. Validity is the test instead — a buffer is text if it decodes
 * as UTF-8 and contains no NUL or stray control bytes, which no real device
 * payload in any of these protocols does.
 */
export function looksTextual(buf: Buffer): boolean {
  if (buf.length === 0) return false

  // NUL is the single strongest signal. No text encoding these devices use
  // emits it; every length-prefixed binary header does.
  if (buf.includes(0)) return false

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return false
  }

  // Control bytes other than tab, LF and CR mean a framing byte, not text.
  for (const b of buf.subarray(0, 1024)) {
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13) return false
  }
  return true
}

export function decode(body: Buffer, contentType?: string): Decoded {
  if (body.length === 0) return { kind: 'text', value: '', text: '' }

  if (!looksTextual(body)) {
    return { kind: 'binary', value: body, text: body.toString('utf8') }
  }

  // Strip a UTF-8 BOM; some firmwares emit one and it makes JSON.parse fail
  // with a message that sends you looking in entirely the wrong place.
  const text = body.toString('utf8').replace(/^﻿/, '')
  const trimmed = text.trim()
  const ct = (contentType ?? '').toLowerCase()

  // Try JSON on shape, not on the declared content-type: several of these
  // firmwares post JSON as text/plain.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value: unknown = JSON.parse(trimmed)
      if (isRecord(value) || Array.isArray(value)) return { kind: 'json', value, text }
    } catch {
      // Malformed JSON falls through to text; the raw bytes are preserved
      // either way, so nothing is lost by being wrong here.
    }
  }

  if (ct.includes('form-urlencoded') || (!trimmed.includes('\n') && /^[^=&\s]+=[^&]*(&|$)/.test(trimmed))) {
    const params = new URLSearchParams(trimmed)
    const value: Record<string, string> = {}
    for (const [k, v] of params) value[k] = v
    if (Object.keys(value).length > 0) return { kind: 'form', value, text }
  }

  return { kind: 'text', value: text, text }
}

/**
 * Splits delimited text into rows of columns.
 *
 * Handles the tab-separated ADMS style and the comma-separated variants, and
 * tolerates the trailing blank line every one of these devices sends.
 */
export function toDelimitedRows(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cols = trimmed.includes('\t') ? trimmed.split('\t') : trimmed.split(',')
    rows.push(cols.map((c) => c.trim()))
  }
  return rows
}
