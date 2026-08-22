import path from 'node:path'
import { loadConfig } from './config.ts'
import { createForwarder } from './forward.ts'
import { createServer } from './server.ts'
import { supabaseEventSink, supabaseRawSink } from './sinks/supabase.ts'
import { appEventSink, appRawSink } from './sinks/app.ts'
import type { NormalizedEvent } from './types.ts'
import type { RawPayload } from './archive.ts'
import { log, errFields } from './log.ts'

// Entry point.
//
//                             ┌─▶ spool ─▶ events queue ─▶ ingest_biometric_events()
//   device push ─▶ server ────┤                            → biometric_events → punches
//                             └─▶ spool ─▶ raw queue ────▶ device_raw_payloads
//                                                          (verbatim archive)
//
// The spools sit in the middle deliberately. Nothing forwards straight from the
// socket, so Supabase being slow, mid-upgrade or unreachable costs a delay
// rather than a person's shift.
//
// Two queues, not one: the archive must never be able to delay a punch. If the
// raw path is slow, attendance keeps flowing and only the audit trail lags.

let config
try {
  config = loadConfig()
} catch (e) {
  // Config errors are the commonest way this fails to start, so they get a
  // plain message rather than a stack trace nobody reads.
  console.error(`\nconfiguration error: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}

// `supabase` is the live path: a scan becomes a punch without the web app being
// involved, so a deploy or a hosting incident cannot stop people clocking in.
// `app` routes through the HMAC-signed webhook instead and is the right choice
// wherever a service-role key should not live.
const sinks =
  config.sink === 'supabase'
    ? {
        events: supabaseEventSink({ url: config.supabaseUrl!, serviceRoleKey: config.supabaseKey! }),
        raw: supabaseRawSink({ url: config.supabaseUrl!, serviceRoleKey: config.supabaseKey! }),
      }
    : {
        events: appEventSink({ appUrl: config.appUrl!, secret: config.secret! }),
        raw: appRawSink({ appUrl: config.appUrl!, secret: config.secret! }),
      }

const forwarder = createForwarder<NormalizedEvent>(
  path.join(config.spoolDir, 'events'),
  (e) => ({ sort: e.scannedAt, id: e.dedupeKey }),
  { deliver: sinks.events, label: 'events' }
)

const archive = config.archiveRaw
  ? createForwarder<RawPayload>(
      path.join(config.spoolDir, 'raw'),
      (p) => ({ sort: p.receivedAt, id: p.payloadKey }),
      { deliver: sinks.raw, label: 'raw', batchSize: 25 }
    )
  : undefined

const gateway = createServer({ config, forwarder, archive })

forwarder.start()
archive?.start()
gateway.listen()

log.info('gateway started', {
  sink: config.sink,
  destination: config.sink === 'supabase' ? config.supabaseUrl : config.appUrl,
  spoolDir: config.spoolDir,
  timezone: config.timezone,
  strictSerials: config.strictSerials,
  archiveRaw: config.archiveRaw,
  devices: config.devices.length,
  // A backlog here means the last run ended with the destination unreachable.
  // It drains on its own; saying so up front saves debugging a phantom.
  pendingEvents: forwarder.pending,
  pendingRaw: archive?.pending ?? 0,
})

if (config.devices.length === 0) {
  log.warn('no devices configured', {
    hint: 'copy devices.example.yaml to devices.yaml — with STRICT_SERIALS on, every push is rejected',
  })
}

function shutdown(signal: string): void {
  log.info('shutting down', {
    signal, pendingEvents: forwarder.pending, pendingRaw: archive?.pending ?? 0,
  })
  forwarder.stop()
  archive?.stop()
  gateway.close()
  // Anything still spooled is on disk and gets picked up next boot, so exiting
  // promptly is safe and beats hanging a container restart.
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// A gateway that dies on an unexpected error stops recording attendance for a
// whole branch. Log loudly and stay up; the spool makes staying up safe.
process.on('uncaughtException', (e) => log.error('uncaught exception', errFields(e)))
process.on('unhandledRejection', (e) => log.error('unhandled rejection', errFields(e)))
