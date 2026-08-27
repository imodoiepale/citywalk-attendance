import path from 'node:path'
import { createForwarder } from '../forward.ts'
import type { NormalizedEvent } from '../types.ts'
import type { RawPayload } from '../archive.ts'
import type { Delivery } from '../sinks/types.ts'
import type { DestinationRuntime } from '../fanout.ts'
import { supabaseEventSink, supabaseRawSink } from '../sinks/supabase.ts'
import { appEventSink, appRawSink } from '../sinks/app.ts'
import { webhookEventSink } from './webhook.ts'
import type { DestinationConfig } from './types.ts'

// Turns the validated destination list into running queues.
//
// One Forwarder and one spool directory per destination, named by its id. The
// id is therefore load-bearing: renaming a destination orphans its queue, which
// is why loadDestinations() constrains the character set and the README says so.

export interface WiringEnv {
  supabaseUrl?: string
  supabaseKey?: string
  appUrl?: string
  secret?: string
}

function eventDelivery(
  d: DestinationConfig,
  wiring: WiringEnv,
  env: NodeJS.ProcessEnv
): Delivery<NormalizedEvent> {
  switch (d.type) {
    case 'supabase':
      if (!wiring.supabaseUrl || !wiring.supabaseKey) {
        throw new Error(
          `destination "${d.id}" is type supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set`
        )
      }
      return supabaseEventSink({ url: wiring.supabaseUrl, serviceRoleKey: wiring.supabaseKey })

    case 'app':
      if (!wiring.appUrl || !wiring.secret) {
        throw new Error(
          `destination "${d.id}" is type app but APP_URL / BIOMETRIC_WEBHOOK_SECRET are not set`
        )
      }
      return appEventSink({ appUrl: wiring.appUrl, secret: wiring.secret })

    case 'webhook':
      return webhookEventSink(d, env)
  }
}

export function buildDestinations(
  destinations: DestinationConfig[],
  spoolDir: string,
  wiring: WiringEnv,
  env: NodeJS.ProcessEnv = process.env
): DestinationRuntime[] {
  return destinations.map((d) => ({
    config: d,
    forwarder: createForwarder<NormalizedEvent>(
      path.join(spoolDir, 'dest', d.id),
      (e) => ({ sort: e.scannedAt, id: e.dedupeKey }),
      { deliver: eventDelivery(d, wiring, env), label: `events:${d.id}`, batchSize: d.batchSize }
    ),
  }))
}

/**
 * Where the verbatim raw archive goes.
 *
 * Only ever one place, and only ever a first-party destination. The archive is
 * unredacted diagnostic material — whole device frames, including anything a
 * firmware chose to put in them — so it belongs in our own store and must not
 * be fanned out to third-party webhooks along with the events.
 *
 * Returns null when no first-party destination is configured, in which case the
 * caller simply does not run an archive queue.
 */
export function rawDelivery(
  destinations: DestinationConfig[],
  wiring: WiringEnv
): Delivery<RawPayload> | null {
  const primary = destinations.find((d) => d.type === 'supabase') ?? destinations.find((d) => d.type === 'app')
  if (!primary) return null

  if (primary.type === 'supabase' && wiring.supabaseUrl && wiring.supabaseKey) {
    return supabaseRawSink({ url: wiring.supabaseUrl, serviceRoleKey: wiring.supabaseKey })
  }
  if (primary.type === 'app' && wiring.appUrl && wiring.secret) {
    return appRawSink({ appUrl: wiring.appUrl, secret: wiring.secret })
  }
  return null
}
