import { log } from '../log.ts'

// The gateway's read/write surface against Supabase for device management.
//
// Deliberately RPC-only, via PostgREST, with no table access: every operation
// here is one function call with its rules enforced in the database. That keeps
// the service-role key — which bypasses RLS entirely — reaching as little as
// possible, and it means the "no consent, no stored template" rule cannot be
// bypassed by a bug on this side.

export interface DeviceCommandRow {
  id: string
  serial_no: string
  command: string
  payload: Record<string, unknown>
  attempts: number
}

export interface StoreCapturedCredential {
  serial: string
  externalUserId: string
  backupNum: number
  credentialType: 'fingerprint' | 'face' | 'card' | 'password'
  templateSealed: string
  templateKeyId: string
  fpAlgo: string | null
  capturedVia: 'device' | 'photo' | 'imported'
}

export interface PendingCredentialRow {
  credential_id: string
  external_user_id: string
  full_name: string | null
  backup_num: number
  template_sealed: string
  template_key_id: string
}

export interface Persistence {
  registerDevice(input: {
    serial: string
    model: string | null
    firmware: string | null
    fpAlgo: string | null
    capacity: Record<string, number>
  }): Promise<void>

  /** Returns the credential id, or null when the enrolment number is unmapped. */
  storeCapturedCredential(input: StoreCapturedCredential): Promise<string | null>

  /**
   * Claim work for the devices currently connected to THIS gateway.
   *
   * Passing the online set matters: a command for an offline reader must stay
   * queued until it dials back in, not be consumed and failed.
   */
  claimCommands(onlineSerials: string[], limit: number): Promise<DeviceCommandRow[]>

  completeCommand(id: string, ok: boolean, result: unknown, error: string | null): Promise<void>
  claimPendingCredentials(serial: string, limit: number): Promise<PendingCredentialRow[]>
  updateCredentialState(serial: string, credentialId: string, ok: boolean, error: string | null): Promise<void>
}

export interface SupabaseOptions {
  url: string
  serviceRoleKey: string
}

/** Anything logged from here is scrubbed: a key in a log file is a key on disk. */
function redact(text: string, key: string): string {
  return key ? text.split(key).join('«service-role-key»') : text
}

export function createPersistence(opts: SupabaseOptions): Persistence {
  const base = `${opts.url.replace(/\/$/, '')}/rest/v1/rpc`

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
    let res: Response
    try {
      res = await fetch(`${base}/${fn}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: opts.serviceRoleKey,
          authorization: `Bearer ${opts.serviceRoleKey}`,
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (e) {
      log.warn('supabase rpc unreachable', { fn, error: e instanceof Error ? e.message : String(e) })
      return null
    }

    const text = await res.text().catch(() => '')

    if (!res.ok) {
      // A missing function means the migration has not been applied. Say which
      // one, once, rather than emitting a PostgREST code nobody can act on.
      if (res.status === 404 || text.includes('PGRST202')) {
        log.error('device-management RPC not found — apply the migration', {
          fn, hint: 'supabase/migrations/20260828000001_biometric_credentials.sql',
        })
      } else {
        log.error('supabase rpc failed', {
          fn, status: res.status, detail: redact(text.slice(0, 300), opts.serviceRoleKey),
        })
      }
      return null
    }

    if (!text.trim()) return null
    try {
      return JSON.parse(text) as T
    } catch {
      return null
    }
  }

  return {
    async registerDevice(input) {
      await rpc('gateway_register_device', {
        p_serial: input.serial,
        p_model: input.model,
        p_firmware: input.firmware,
        p_fp_algo: input.fpAlgo,
        p_capacity: input.capacity,
      })
    },

    async storeCapturedCredential(input) {
      const id = await rpc<string | null>('gateway_store_captured_credential', {
        p_serial: input.serial,
        p_external_user_id: input.externalUserId,
        p_backup_num: input.backupNum,
        p_credential_type: input.credentialType,
        p_template_sealed: input.templateSealed,
        p_template_key_id: input.templateKeyId,
        p_fp_algo: input.fpAlgo,
        p_captured_via: input.capturedVia,
      })
      return typeof id === 'string' ? id : null
    },

    async claimCommands(onlineSerials, limit) {
      if (onlineSerials.length === 0) return []
      const rows = await rpc<DeviceCommandRow[]>('gateway_claim_commands', {
        p_serials: onlineSerials,
        p_limit: limit,
      })
      return Array.isArray(rows) ? rows : []
    },

    async completeCommand(id, ok, result, error) {
      await rpc('gateway_complete_command', {
        p_id: id,
        p_ok: ok,
        p_result: result ?? null,
        p_error: error,
      })
    },

    async claimPendingCredentials(serial, limit) {
      const rows = await rpc<PendingCredentialRow[]>('gateway_claim_pending_credentials', {
        p_serial: serial,
        p_limit: limit,
      })
      return Array.isArray(rows) ? rows : []
    },

    async updateCredentialState(serial, credentialId, ok, error) {
      await rpc('gateway_update_credential_state', {
        p_serial: serial,
        p_credential_id: credentialId,
        p_ok: ok,
        p_error: error,
      })
    },
  }
}
