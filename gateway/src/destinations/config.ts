import fs from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Direction } from '../types.ts'
import type { DestinationAuth, DestinationConfig, DestinationFilter, DestinationType } from './types.ts'

// Loading and validating the destination list.
//
// Everything here fails at BOOT rather than at the first scan. A gateway that
// starts happily and only discovers its webhook secret is missing when someone
// puts a finger on the reader is far worse than one that refuses to start with
// the variable's name in the error.

const TYPES: DestinationType[] = ['supabase', 'app', 'webhook']
const DIRECTIONS: Direction[] = ['in', 'out', 'both']

// The id becomes a directory name under the spool. Restricting it up front
// beats discovering that "n8n/payroll" created a nested directory whose queue
// nothing ever drains.
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Anything that looks like a credential sitting in the YAML instead of the env. */
const SECRET_SHAPED = /^(?:secret|token|key|bearer|hmac)/i

export function loadDestinations(
  file: string,
  inlineYaml?: string,
  env: NodeJS.ProcessEnv = process.env
): DestinationConfig[] {
  const source = inlineYaml?.trim() || (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')

  // No destinations file is not an error: it is every deployment that existed
  // before this feature. Those keep working unchanged, with SINK choosing the
  // single destination exactly as before.
  if (!source.trim()) return [legacyDestination(env)]

  const parsed = parseYaml(source) as { destinations?: unknown[] } | null
  const raw = Array.isArray(parsed?.destinations) ? parsed.destinations : []
  if (raw.length === 0) return [legacyDestination(env)]

  const seen = new Set<string>()
  const all = raw.map((entry, i) => parseOne(entry, i, file, env))

  for (const d of all) {
    if (seen.has(d.id)) throw new Error(`${file}: duplicate destination id "${d.id}"`)
    seen.add(d.id)
  }

  const enabled = all.filter((d) => d.enabled)
  if (enabled.length === 0) {
    throw new Error(`${file}: every destination is disabled — scans would spool with nowhere to go`)
  }
  return enabled
}

function legacyDestination(env: NodeJS.ProcessEnv): DestinationConfig {
  const sink = (env.SINK ?? 'supabase').toLowerCase()
  if (sink !== 'supabase' && sink !== 'app') {
    throw new Error(`SINK must be "supabase" or "app", got "${sink}".`)
  }
  return { id: sink === 'supabase' ? 'supabase-primary' : 'app-primary', type: sink, enabled: true }
}

function parseOne(
  entry: unknown,
  i: number,
  file: string,
  env: NodeJS.ProcessEnv
): DestinationConfig {
  const d = (entry ?? {}) as Record<string, unknown>
  const where = `${file}: destinations[${i}]`

  const id = String(d.id ?? '').trim()
  if (!ID.test(id)) {
    throw new Error(`${where} has id "${id}"; expected lowercase letters, digits, dash or underscore`)
  }

  const type = String(d.type ?? '').trim() as DestinationType
  if (!TYPES.includes(type)) {
    throw new Error(`${where} (${id}) has type "${type}"; expected one of ${TYPES.join(', ')}`)
  }

  const enabled = d.enabled === undefined ? true : Boolean(d.enabled)

  const rawBatch = d.batch_size ?? d.batchSize
  const batchSize = rawBatch === undefined || rawBatch === null ? undefined : Number(rawBatch)
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    throw new Error(`${where} (${id}) batch_size must be a positive integer`)
  }

  const config: DestinationConfig = {
    id,
    type,
    enabled,
    batchSize,
    filter: parseFilter(d.filter, `${where} (${id})`),
  }

  if (type !== 'webhook') {
    // supabase and app are wired from the environment, the same as before, so
    // that the service-role key and the app secret keep their single home.
    return config
  }

  const url = String(d.url ?? '').trim()
  if (!url) throw new Error(`${where} (${id}) is type webhook but has no url`)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`${where} (${id}) has an unparseable url: ${url}`)
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(`${where} (${id}) url must be http or https, got ${parsedUrl.protocol}`)
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.searchParams.has('token')) {
    // Credentials in a URL end up in logs, in the spool, and in every error
    // message. Use auth.secretEnv instead.
    throw new Error(`${where} (${id}) url carries a credential; move it to auth.secretEnv`)
  }

  const format = String(d.format ?? 'batch')
  if (format !== 'batch' && format !== 'single') {
    throw new Error(`${where} (${id}) has format "${format}"; expected batch or single`)
  }

  const template = d.template === undefined ? undefined : String(d.template)
  if (template !== undefined && format !== 'single') {
    throw new Error(`${where} (${id}) sets a template, which only applies to format: single`)
  }
  if (template !== undefined) {
    try {
      JSON.parse(template.replace(/\{\{\s*[\w.]+\s*\}\}/g, '""'))
    } catch {
      throw new Error(`${where} (${id}) template is not valid JSON once placeholders are filled`)
    }
  }

  return {
    ...config,
    url,
    format,
    template,
    headers: parseHeaders(d.headers, `${where} (${id})`),
    auth: parseAuth(d.auth, `${where} (${id})`, env),
  }
}

function parseHeaders(value: unknown, where: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} headers must be a mapping of name to value`)
  }

  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const name = k.trim().toLowerCase()
    if (name === 'authorization' || SECRET_SHAPED.test(name)) {
      throw new Error(`${where} sets header "${k}" inline; use auth.secretEnv so the value stays out of git`)
    }
    out[name] = String(v)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseAuth(value: unknown, where: string, env: NodeJS.ProcessEnv): DestinationAuth | undefined {
  if (value === undefined || value === null) return undefined
  const a = value as Record<string, unknown>

  const kind = String(a.kind ?? 'none') as AuthKindLoose
  if (!['none', 'hmac', 'bearer', 'header'].includes(kind)) {
    throw new Error(`${where} auth.kind is "${kind}"; expected none, hmac, bearer or header`)
  }
  if (kind === 'none') return { kind: 'none' }

  if (a.secret !== undefined) {
    throw new Error(`${where} auth.secret is not supported; use auth.secretEnv naming an environment variable`)
  }

  const secretEnv = String(a.secret_env ?? a.secretEnv ?? '').trim()
  if (!secretEnv) throw new Error(`${where} auth.kind "${kind}" requires auth.secretEnv`)
  if (!env[secretEnv]?.trim()) {
    throw new Error(`${where} auth.secretEnv names ${secretEnv}, which is not set in the environment`)
  }
  if (kind === 'header' && !String(a.header ?? '').trim()) {
    throw new Error(`${where} auth.kind "header" requires auth.header naming the header to send`)
  }

  return { kind, secretEnv, header: a.header ? String(a.header).trim() : undefined }
}

type AuthKindLoose = 'none' | 'hmac' | 'bearer' | 'header'

function parseFilter(value: unknown, where: string): DestinationFilter | undefined {
  if (value === undefined || value === null) return undefined
  const f = value as Record<string, unknown>

  const list = (v: unknown, name: string): string[] | undefined => {
    if (v === undefined || v === null) return undefined
    if (!Array.isArray(v)) throw new Error(`${where} filter.${name} must be a list`)
    const items = v.map((x) => String(x).trim()).filter(Boolean)
    return items.length > 0 ? items : undefined
  }

  const directions = list(f.directions, 'directions')
  for (const d of directions ?? []) {
    if (!DIRECTIONS.includes(d as Direction)) {
      throw new Error(`${where} filter.directions has "${d}"; expected in, out or both`)
    }
  }

  const filter: DestinationFilter = {
    serials: list(f.serials, 'serials'),
    directions: directions as Direction[] | undefined,
    branches: list(f.branches, 'branches'),
  }

  return filter.serials || filter.directions || filter.branches ? filter : undefined
}
