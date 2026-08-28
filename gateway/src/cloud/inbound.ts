import type { NormalizedEvent } from '../types.ts'
import { makeDedupeKey } from '../types.ts'
import { toInstant } from '../time.ts'
import { isRecord, pick, toDirection, toVerificationMethod, USER_KEYS } from '../vendors/fields.ts'
import type { CloudRequest } from './protocol.ts'

// Device-originated cloud messages → the shapes the rest of the gateway
// already understands.
//
// The important constraint: a punch that arrives here must be INDISTINGUISHABLE
// from the same punch arriving over FkWeb. Same dedupeKey formula, same
// timestamp resolution. During a cutover both transports can be live at once,
// and a device replaying its buffer must not create a second punch.

/** `devinfo` from the registration handshake. Free fleet inventory. */
export interface DeviceInfo {
  modelname: string | null
  firmware: string | null
  /** Template algorithm. Replication is only valid between matching values. */
  fpalgo: string | null
  capacity: Record<string, number>
}

export function parseDeviceInfo(msg: CloudRequest): DeviceInfo | null {
  const info = msg.devinfo
  if (!isRecord(info)) return null

  const capacity: Record<string, number> = {}
  for (const key of [
    'usersize', 'useduser', 'fpsize', 'usedfp', 'cardsize', 'usedcard',
    'pwdsize', 'usedpwd', 'logsize', 'usedlog', 'usednewlog',
  ]) {
    const n = Number(info[key])
    if (Number.isFinite(n)) capacity[key] = n
  }

  return {
    modelname: str(info.modelname),
    firmware: str(info.firmware),
    fpalgo: str(info.fpalgo),
    capacity,
  }
}

/**
 * `sendlog` → normalized attendance events.
 *
 * `mode` is the verification method on this protocol, NOT the direction —
 * `inout` is the direction. Reading `mode` as in/out would clock people in as
 * they leave, which is why the shared DIRECTION_KEYS list deliberately excludes
 * it and this parser names both fields explicitly.
 */
export function parseSendLog(
  msg: CloudRequest,
  fallbackSerial: string | null,
  timezone: string
): NormalizedEvent[] {
  const deviceSerial = str(msg.sn) ?? fallbackSerial
  if (!deviceSerial) return []

  const record = msg.record
  const rows = Array.isArray(record) ? record.filter(isRecord) : isRecord(record) ? [record] : []

  const events: NormalizedEvent[] = []
  for (const row of rows) {
    const externalUserId = pick(row, ['enrollid', 'enrollId', ...USER_KEYS])
    const rawTime = pick(row, ['time', 'logtime', 'punchtime'])
    if (!externalUserId || !rawTime) continue

    const scannedAt = toInstant(rawTime, timezone)
    if (!scannedAt) continue

    const iso = scannedAt.toISOString()
    events.push({
      deviceSerial,
      externalUserId,
      scannedAt: iso,
      direction: toDirection(pick(row, ['inout', 'in_out', 'io'])),
      // Identical to every other vendor module. This is what makes a punch
      // arriving by cloud and by FkWeb one punch rather than two.
      dedupeKey: makeDedupeKey([deviceSerial, externalUserId, iso]),
      raw: {
        vendor: 'cloud',
        verificationMethod: toVerificationMethod(pick(row, ['mode', 'verifymode'])),
        eventType: pick(row, ['event']),
        record: row,
      },
    })
  }
  return events
}

/**
 * The acknowledgement a device expects for `sendlog`.
 *
 * Echoing count and logindex is how the terminal advances its own read pointer.
 * Get this wrong and it re-sends the same block forever; omit it and some
 * firmwares fall back to the short form, which is why both are accepted here.
 */
export function sendLogAck(msg: CloudRequest, accepted: number): Record<string, unknown> {
  const ack: Record<string, unknown> = { ret: 'sendlog', result: true, count: accepted }
  const logindex = Number(msg.logindex)
  if (Number.isFinite(logindex)) ack.logindex = logindex
  return ack
}

/** A credential captured ON the device and pushed up to us. */
export interface CapturedCredential {
  deviceSerial: string
  externalUserId: string
  /** Credential slot: finger index, or the model's card / password / face slot. */
  backupNum: number
  /** The template, verbatim. Opaque, algorithm-specific, and sensitive. */
  template: string
  name: string | null
  admin: number | null
}

/**
 * `senduser` → a captured credential.
 *
 * The other half of remote enrolment: `adduser` asks the device to capture,
 * the person presents a finger, and the template arrives here ready to be
 * replicated to the rest of the fleet.
 */
export function parseSendUser(
  msg: CloudRequest,
  fallbackSerial: string | null
): CapturedCredential | null {
  const deviceSerial = str(msg.sn) ?? fallbackSerial
  const externalUserId = str(msg.enrollid)
  const template = str(msg.record)

  // Without all three this cannot be stored or replayed. A `senduser` carrying
  // only a name is a rename, not an enrolment, and is not our business here.
  if (!deviceSerial || !externalUserId || !template) return null

  const backupNum = Number(msg.backupnum)
  const admin = Number(msg.admin)

  return {
    deviceSerial,
    externalUserId,
    backupNum: Number.isFinite(backupNum) ? backupNum : 0,
    template,
    name: str(msg.name),
    admin: Number.isFinite(admin) ? admin : null,
  }
}

export type CredentialType = 'fingerprint' | 'face' | 'card' | 'password'

/**
 * What kind of credential a device slot holds.
 *
 * UNVERIFIED PER MODEL. The convention across this SDK family is ten finger
 * slots, then password, then card, with face well above — but the vendor
 * documentation we have does not state it, and a model that numbers them
 * differently would mislabel credentials.
 *
 * Getting this wrong is cosmetic rather than dangerous: `backup_num` is what
 * actually addresses the slot on the device, and it is stored verbatim
 * alongside. The type is a label for the UI. Correct it per model once a real
 * terminal has been observed.
 */
export function credentialTypeForSlot(backupNum: number): CredentialType {
  if (backupNum >= 0 && backupNum <= 9) return 'fingerprint'
  if (backupNum === 10) return 'password'
  if (backupNum === 11) return 'card'
  if (backupNum >= 20) return 'face'
  return 'fingerprint'
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
