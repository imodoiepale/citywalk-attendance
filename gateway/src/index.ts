import path from 'node:path'
import { loadConfig } from './config.ts'
import { createForwarder } from './forward.ts'
import { createServer } from './server.ts'
import { Fanout } from './fanout.ts'
import { buildDestinations, rawDelivery } from './destinations/index.ts'
import type { RawPayload } from './archive.ts'
import { log, errFields } from './log.ts'

// Entry point.
//
//                             ┌─▶ spool/dest/<id> ─▶ supabase → punches
//   device push ─▶ server ────┼─▶ spool/dest/<id> ─▶ app webhook (HMAC)
//                             ├─▶ spool/dest/<id> ─▶ any third-party webhook
//                             └─▶ spool/raw ──────▶ device_raw_payloads
//
// The spools sit in the middle deliberately. Nothing forwards straight from the
// socket, so a destination being slow, mid-upgrade or unreachable costs a delay
// rather than a person's shift.
//
// One spool PER DESTINATION, not one shared queue: a partner's endpoint that is
// rate-limiting must not be able to hold up a punch reaching Supabase. And the
// raw archive is separate again, because the audit trail must never delay
// attendance.

let config
try {
  config = loadConfig()
} catch (e) {
  // Config errors are the commonest way this fails to start, so they get a
  // plain message rather than a stack trace nobody reads.
  console.error(`\nconfiguration error: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}

const wiring = {
  supabaseUrl: config.supabaseUrl,
  supabaseKey: config.supabaseKey,
  appUrl: config.appUrl,
  secret: config.secret,
}

let destinations
try {
  destinations = buildDestinations(config.destinations, config.spoolDir, wiring)
} catch (e) {
  console.error(`\ndestination error: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}

// devices.yaml is the only place that knows which branch a reader sits in, and
// destination filters need it without a round trip to Supabase on every scan.
const branchBySerial = new Map(config.devices.map((d) => [d.serial, d.branch ?? null]))
const fanout = new Fanout(destinations, (serial) => branchBySerial.get(serial) ?? null)

const rawSink = config.archiveRaw ? rawDelivery(config.destinations, wiring) : null
const archive = rawSink
  ? createForwarder<RawPayload>(
      path.join(config.spoolDir, 'raw'),
      (p) => ({ sort: p.receivedAt, id: p.payloadKey }),
      { deliver: rawSink, label: 'raw', batchSize: 25 }
    )
  : undefined

if (config.archiveRaw && !rawSink) {
  // Webhook-only deployments have nowhere first-party to put verbatim frames,
  // and fanning unredacted device payloads out to third parties is not an
  // acceptable substitute. Say so once rather than silently doing neither.
  log.warn('raw archive disabled: no supabase or app destination is configured', {
    hint: 'add a first-party destination, or set ARCHIVE_RAW=false to silence this',
  })
}

const gateway = createServer({ config, forwarder: fanout, archive })

fanout.start()
archive?.start()
gateway.listen()

log.info('gateway started', {
  destinations: destinations.map((d) => ({
    id: d.config.id,
    type: d.config.type,
    // The URL is operationally essential and carries no credential — the
    // loader rejects destinations whose URL embeds one.
    url: d.config.url ?? (d.config.type === 'supabase' ? config.supabaseUrl : config.appUrl),
    filtered: Boolean(d.config.filter),
    pending: d.forwarder.pending,
  })),
  spoolDir: config.spoolDir,
  timezone: config.timezone,
  strictSerials: config.strictSerials,
  archiveRaw: Boolean(archive),
  devices: config.devices.length,
  tcpPorts: config.tcpPorts,
  // A backlog here means the last run ended with a destination unreachable.
  // It drains on its own; saying so up front saves debugging a phantom.
  pendingEvents: fanout.pending,
  pendingRaw: archive?.pending ?? 0,
})

if (config.devices.length === 0) {
  log.warn('no devices configured', {
    hint: 'copy devices.example.yaml to devices.yaml — with STRICT_SERIALS on, every push is rejected',
  })
}

if (config.tcpPorts.length === 0 && config.devices.some((d) => d.vendor === 'fkweb')) {
  // An FkWeb terminal dials a raw TCP port. Configured as fkweb with no TCP
  // listener open, it would connect to nothing and buffer silently.
  log.warn('an fkweb device is configured but no raw TCP port is listening', {
    hint: 'set GATEWAY_TCP_PORTS to the port the terminal is pointed at, e.g. 5005',
  })
}

function shutdown(signal: string): void {
  log.info('shutting down', {
    signal, pendingEvents: fanout.pending, pendingRaw: archive?.pending ?? 0,
  })
  fanout.stop()
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
