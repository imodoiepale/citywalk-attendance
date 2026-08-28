import path from 'node:path'
import { loadConfig } from './config.ts'
import { createForwarder } from './forward.ts'
import { createServer } from './server.ts'
import { Fanout } from './fanout.ts'
import { buildDestinations, rawDelivery } from './destinations/index.ts'
import { CloudServer } from './cloud/session.ts'
import { CommandQueue } from './cloud/queue.ts'
import { createPersistence } from './cloud/persistence.ts'
import { loadTemplateKeys, seal } from './cloud/crypto.ts'
import { credentialTypeForSlot, type CapturedCredential } from './cloud/inbound.ts'
import { buildRawPayload, type RawPayload } from './archive.ts'
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

const gateway = createServer({
  config, forwarder: fanout, archive,
  // An M82 terminal pushes its own users unprompted — see
  // vendors/m82/assemble.ts. It lands here as base64, already reassembled from
  // however many blocks it took; reuse the exact sealing and storage path the
  // cloud channel's remote-enrolment flow uses, rather than a second one, so
  // there is one place that decides how a template comes to rest.
  onM82Credential: (credential) => {
    void storeCapturedCredential({
      deviceSerial: credential.deviceSerial,
      externalUserId: credential.externalUserId,
      backupNum: credential.backupNumber,
      template: credential.templateBase64,
      name: credential.name,
      admin: null,
    })
  },
})

// The cloud channel: terminals dial in and stay connected, so commands can go
// back down the same socket. Punches arriving this way go through the very same
// Fanout as every other transport — one delivery path, one dedupe rule.
const knownSerials = new Set(config.devices.map((d) => d.serial))
const deviceTimezones = new Map(config.devices.map((d) => [d.serial, d.timezone]))

// Device management needs a database of its own — the command queue and the
// credential store — and that is only the Supabase path. A webhook-only
// deployment can still receive punches; it just cannot manage devices.
const persistence = config.supabaseUrl && config.supabaseKey
  ? createPersistence({ url: config.supabaseUrl, serviceRoleKey: config.supabaseKey })
  : null

// Templates are sealed here, before they reach Postgres, so a database dump is
// ciphertext. No key means no credential storage at all — refusing is correct,
// because the alternative is writing biometric data in the clear.
const templateKeys = loadTemplateKeys()

async function storeCapturedCredential(credential: CapturedCredential): Promise<void> {
  // Never log the template itself; it is biometric data and this is a log file.
  const context = {
    serial: credential.deviceSerial,
    enrollId: credential.externalUserId,
    backupNum: credential.backupNum,
    templateBytes: credential.template.length,
  }

  if (!persistence) {
    log.error('captured a credential but no Supabase destination is configured; discarding', context)
    return
  }
  if (!templateKeys) {
    log.error('captured a credential but BIOMETRIC_TEMPLATE_KEY is not set; discarding', {
      ...context,
      hint: 'generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    })
    return
  }

  try {
    const sealed = seal(credential.template, templateKeys.active)
    const session = cloud?.get(credential.deviceSerial)

    const id = await persistence.storeCapturedCredential({
      serial: credential.deviceSerial,
      externalUserId: credential.externalUserId,
      backupNum: credential.backupNum,
      credentialType: credentialTypeForSlot(credential.backupNum),
      templateSealed: sealed.ciphertext,
      templateKeyId: sealed.keyId,
      fpAlgo: session?.devinfo?.fpalgo ?? null,
      capturedVia: 'device',
    })

    if (id) log.info('credential stored', { ...context, credentialId: id })
    // A null id means the enrolment number is not mapped to anyone. The capture
    // is real, so say so loudly — guessing whose finger it was would attach
    // biometric data to the wrong person.
    else log.warn('captured credential for an unmapped enrolment number; not stored', {
      ...context, hint: 'map it at /admin/devices/enrollments, then re-enrol',
    })
  } catch (e) {
    log.error('failed to store a captured credential', { ...context, ...errFields(e) })
  }
}

const cloud = config.cloudPort > 0
  ? new CloudServer({
      timezone: config.timezone,
      strictSerials: config.strictSerials,
      isKnownSerial: (serial) => knownSerials.has(serial),
      deviceTimezone: (serial) => deviceTimezones.get(serial) ?? config.timezone,
      onEvents: (events) => fanout.submit(events),
      onCapturedCredential: (credential) => {
        void storeCapturedCredential(credential)
      },
      onRegister: (serial, info) => {
        void persistence?.registerDevice({
          serial,
          model: info?.modelname ?? null,
          firmware: info?.firmware ?? null,
          fpAlgo: info?.fpalgo ?? null,
          capacity: info?.capacity ?? {},
        })
      },
      onRawFrame: (serial, text, transport) => {
        archive?.submit([
          buildRawPayload({
            body: Buffer.from(text, 'utf8'),
            transport: `cloud:${transport}`,
            deviceSerial: serial,
            vendor: 'cloud',
            parsedEventCount: 0,
          }),
        ])
      },
    })
  : null

// The app→device path: the app writes device_commands rows, this claims and
// dispatches them. Only meaningful when both a cloud channel and a database
// exist, which is why it is conditional rather than always-on.
const commands = cloud && persistence
  ? new CommandQueue({
      persistence,
      sessionFor: (serial) => cloud.get(serial),
      onlineSerials: () => cloud.online(),
      pollIntervalMs: Number(process.env.COMMAND_POLL_MS ?? 2_000),
    })
  : null

fanout.start()
archive?.start()
gateway.listen()
cloud?.listen(config.cloudPort)
commands?.start()

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
  cloudPort: config.cloudPort > 0 ? config.cloudPort : 'disabled',
  deviceManagement: commands ? 'enabled' : 'disabled',
  // Whether we can store a credential at all. Worth stating at boot rather
  // than discovering at the first enrolment.
  templateSealing: templateKeys ? templateKeys.active.id : 'no key configured',
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
  commands?.stop()
  gateway.close()
  cloud?.close()
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
