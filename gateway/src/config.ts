import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { loadDestinations } from './destinations/config.ts'
import type { DestinationConfig } from './destinations/types.ts'

// Config is split in two on purpose.
//
// Secrets and per-deployment wiring come from the environment, because that is
// what Docker, Railway and systemd all hand a process and what must never reach
// git. The device inventory comes from a file, because it is a list a human
// maintains, wants comments in, and reviews in a diff before a reader goes live.

export interface DeviceConfig {
  /** Must match biometric_devices.serial_no in the app exactly. */
  serial: string
  vendor: string
  mode: 'listen' | 'poll'
  /** Poll mode only: where to dial. */
  host?: string
  port?: number
  /** IANA zone used to resolve the device's naive timestamps. */
  timezone: string
  /** Override the direction the device reports. Null defers to the app's device row. */
  direction: 'in' | 'out' | 'both' | null
  /** Poll mode only. */
  pollIntervalMs: number
  label?: string
  /**
   * Which branch this reader sits in.
   *
   * Purely a routing hint for destination filters — the app remains the
   * authority on which branch a device belongs to. It lives here because a
   * destination that should only receive HQ scans has to be able to say so
   * without the gateway querying Supabase on every push.
   */
  branch?: string
}

export type SinkName = 'supabase' | 'app'

export interface Config {
  /**
   * Where scans go.
   *
   * 'supabase' writes straight to the database, so attendance keeps working
   * when the web app does not. 'app' posts to the HMAC-signed webhook instead
   * and is the right choice wherever a service-role key should not live.
   */
  sink: SinkName
  /** sink=supabase */
  supabaseUrl?: string
  supabaseKey?: string
  /** sink=app */
  appUrl?: string
  secret?: string
  httpPort: number
  tcpPorts: number[]
  spoolDir: string
  timezone: string
  /** Reject pushes whose serial is not in devices.yaml. */
  strictSerials: boolean
  /** Store a verbatim copy of every payload, parsed or not, via /api/biometric/raw. */
  archiveRaw: boolean
  /** Accepted Cams API Monitor callback tokens. Empty disables /callbacks/cams. */
  camsAuthTokens: string[]
  /** Optional 32-byte AES-256 key configured in the Cams API Monitor. */
  camsSecurityKey?: string
  devices: DeviceConfig[]
  /**
   * Every place a scan should be delivered.
   *
   * Always at least one. When no destinations.yaml exists this holds a single
   * entry synthesised from SINK, so deployments that predate fan-out behave
   * exactly as they did before.
   */
  destinations: DestinationConfig[]
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    // Fail at boot with the variable's name, not at the first scan with a 401.
    throw new Error(`${name} is required but not set. See gateway/.env.example.`)
  }
  return value.trim()
}

export function loadDevices(file: string, defaultTimezone: string, inlineYaml?: string): DeviceConfig[] {
  if (!inlineYaml && !fs.existsSync(file)) return []

  const source = inlineYaml?.trim() || fs.readFileSync(file, 'utf8')
  const parsed = parseYaml(source) as { devices?: unknown[] } | null
  const raw = Array.isArray(parsed?.devices) ? parsed.devices : []

  return raw.map((entry, i) => {
    const d = (entry ?? {}) as Record<string, unknown>
    const serial = String(d.serial ?? '').trim()
    if (!serial) throw new Error(`${file}: devices[${i}] has no serial`)

    const mode = String(d.mode ?? 'listen')
    if (mode !== 'listen' && mode !== 'poll') {
      throw new Error(`${file}: devices[${i}] (${serial}) has mode "${mode}"; expected listen or poll`)
    }
    if (mode === 'poll' && !d.host) {
      throw new Error(`${file}: devices[${i}] (${serial}) is mode poll but has no host`)
    }

    const direction = d.direction == null ? null : String(d.direction)
    if (direction !== null && !['in', 'out', 'both'].includes(direction)) {
      throw new Error(`${file}: devices[${i}] (${serial}) has direction "${direction}"`)
    }

    return {
      serial,
      vendor: String(d.vendor ?? 'generic').toLowerCase(),
      mode,
      host: d.host ? String(d.host) : undefined,
      port: d.port ? Number(d.port) : 5005,
      timezone: String(d.timezone ?? defaultTimezone),
      direction: direction as DeviceConfig['direction'],
      pollIntervalMs: Number(d.poll_interval_ms ?? d.pollIntervalMs ?? 30_000),
      label: d.label ? String(d.label) : undefined,
      branch: d.branch ? String(d.branch).trim() : undefined,
    }
  })
}

export function loadConfig(): Config {
  const timezone = process.env.TZ?.trim() || 'Africa/Nairobi'
  const devicesFile = path.resolve(process.env.DEVICES_FILE ?? 'devices.yaml')
  const devices = loadDevices(devicesFile, timezone, process.env.DEVICES_YAML)

  const serials = new Set<string>()
  for (const d of devices) {
    if (serials.has(d.serial)) throw new Error(`${devicesFile}: duplicate serial ${d.serial}`)
    serials.add(d.serial)
  }

  const destinationsFile = path.resolve(process.env.DESTINATIONS_FILE ?? 'destinations.yaml')
  const destinations = loadDestinations(destinationsFile, process.env.DESTINATIONS_YAML)
  const types = new Set(destinations.map((d) => d.type))

  // Validate the credentials every configured destination needs, at boot rather
  // than at the first scan. A gateway that starts happily and only fails when
  // someone puts their finger on the reader is far worse than one that refuses
  // to start with the variable's name in the message.
  const wiring: { supabaseUrl?: string; supabaseKey?: string; appUrl?: string; secret?: string } = {}

  if (types.has('supabase')) {
    wiring.supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '')
    wiring.supabaseKey = required('SUPABASE_SERVICE_ROLE_KEY')
    if (wiring.supabaseKey.length < 40) {
      // The anon key is the classic paste error here, and it fails with a 401
      // that reads like a network problem.
      throw new Error('SUPABASE_SERVICE_ROLE_KEY looks too short — is that the anon key?')
    }
  }

  if (types.has('app')) {
    wiring.appUrl = required('APP_URL').replace(/\/$/, '')
    wiring.secret = required('BIOMETRIC_WEBHOOK_SECRET')
  }

  // Retained for the startup banner and for anything still reading it. The
  // destination list is the real answer now; this is just which first-party
  // store is in play.
  const sink: SinkName = types.has('supabase') ? 'supabase' : types.has('app') ? 'app' : 'supabase'

  const camsAuthTokens = [
    process.env.CAMS_AUTH_TOKEN,
    ...(process.env.CAMS_AUTH_TOKENS ?? '').split(','),
  ].map((token) => token?.trim() ?? '').filter(Boolean)
  const camsSecurityKey = process.env.CAMS_SECURITY_KEY?.trim() || undefined
  if (camsSecurityKey && Buffer.byteLength(camsSecurityKey, 'utf8') !== 32) {
    throw new Error('CAMS_SECURITY_KEY must be exactly 32 UTF-8 bytes for AES-256.')
  }

  return {
    sink,
    ...wiring,
    httpPort: Number(process.env.GATEWAY_HTTP_PORT ?? 8080),
    tcpPorts: (process.env.GATEWAY_TCP_PORTS ?? '')
      .split(',').map((p) => Number(p.trim())).filter((p) => Number.isFinite(p) && p > 0),
    spoolDir: path.resolve(process.env.SPOOL_DIR ?? 'spool'),
    timezone,
    // Default on. The push endpoints cannot authenticate a device — the
    // firmware has no way to sign a body — so the serial allowlist is the only
    // thing standing between a public endpoint and anyone able to POST it
    // fabricated attendance. Turn it off only while capturing an unknown
    // device, and turn it back on before the box faces the internet.
    strictSerials: (process.env.STRICT_SERIALS ?? 'true').toLowerCase() !== 'false',
    // On by default: the payloads we cannot parse today are what tomorrow's
    // parser is written from, and a log line that rotated out is no evidence.
    archiveRaw: (process.env.ARCHIVE_RAW ?? 'true').toLowerCase() !== 'false',
    camsAuthTokens,
    camsSecurityKey,
    devices,
    destinations,
  }
}
