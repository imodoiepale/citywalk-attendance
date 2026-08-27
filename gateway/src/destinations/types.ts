import type { Direction } from '../types.ts'

// A destination is "somewhere a scan should end up". The gateway used to have
// exactly one, chosen globally by SINK=supabase|app. That was fine while the
// only consumer was the Citywalk app, and wrong the moment a second consumer
// existed: a payroll webhook, an n8n automation, a partner's HRMS.
//
// The important property is INDEPENDENCE. Each destination gets its own spool
// directory and its own Forwarder, so a third-party endpoint that is down, slow
// or rate-limiting cannot delay a punch reaching Supabase. Sharing one queue
// across destinations would make the slowest consumer set the pace for
// attendance itself, which is exactly backwards.

export type DestinationType = 'supabase' | 'app' | 'webhook'

export type AuthKind = 'none' | 'hmac' | 'bearer' | 'header'

export interface DestinationAuth {
  kind: AuthKind
  /**
   * Name of the environment variable holding the secret — never the secret.
   *
   * destinations.yaml is a file humans edit and review in a diff; it is exactly
   * the wrong place for a credential. The indirection is enforced at load time,
   * so a literal secret in the YAML fails at boot rather than leaking quietly.
   */
  secretEnv?: string
  /** Header the signature or token is sent in. Defaults per kind. */
  header?: string
}

export interface DestinationFilter {
  /** Only these device serials. Absent means every device. */
  serials?: string[]
  /** Only these directions, after the device row's override has been applied. */
  directions?: Direction[]
  /** Only devices whose devices.yaml entry names one of these branches. */
  branches?: string[]
}

export interface DestinationConfig {
  /** Stable identifier. Names the spool directory, so changing it orphans a queue. */
  id: string
  type: DestinationType
  enabled: boolean

  /** webhook: where to POST. */
  url?: string
  /** webhook: one request per batch, or one per scan. */
  format?: 'batch' | 'single'
  /** webhook: extra static headers, e.g. a tenant id. */
  headers?: Record<string, string>
  auth?: DestinationAuth
  /**
   * webhook + format=single: a JSON body template with {{field}} placeholders
   * drawn from the NormalizedEvent. Absent means send the event as-is.
   */
  template?: string

  batchSize?: number
  filter?: DestinationFilter
}

export interface DestinationStatus {
  id: string
  type: DestinationType
  pending: number
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  totals: { forwarded: number; batches: number; failures: number; dropped: number }
}
