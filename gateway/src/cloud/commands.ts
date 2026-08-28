import type { CloudRequest } from './protocol.ts'

// Typed builders for every server→device command in the cloud protocol.
//
// One function per command, rather than callers hand-writing JSON, because the
// field names are the vendor's and are easy to get subtly wrong — `enflag` not
// `enabled`, `backupnum` not `slot`, `cloudtime` not `time`. A typo produces a
// device that silently ignores the command, which is the worst failure mode
// available.
//
// Reference: attendance/docs/cloud-protocol.md

// ── Users and credentials ────────────────────────────────────────────────────

export interface UserCredential {
  enrollId: string | number
  /** Credential slot: finger index, or the model's card / password / face slot. */
  backupNum: number
  /** The template, verbatim. Opaque and algorithm-specific. */
  record: string
  name?: string
  /** 0 = ordinary user, non-zero = administrator on the device. */
  admin?: number
}

/** Write a credential to the device. The core of replication. */
export function setUserInfo(c: UserCredential): CloudRequest {
  const req: CloudRequest = {
    cmd: 'setuserinfo',
    enrollid: c.enrollId,
    backupnum: c.backupNum,
    admin: c.admin ?? 0,
    record: c.record,
  }
  // Only send a name when we have one: some firmwares blank the stored name
  // when handed an empty string.
  if (c.name) req.name = c.name
  return req
}

/** Read one credential back out. The source side of replication. */
export function getUserInfo(enrollId: string | number, backupNum: number): CloudRequest {
  return { cmd: 'getuserinfo', enrollid: enrollId, backupnum: backupNum }
}

/**
 * Ask the device to capture an enrolment now.
 *
 * The person then presents a finger (or face) at the terminal and the captured
 * template arrives back as an unsolicited `senduser`. This is the only way to
 * originate a fingerprint — a template cannot be synthesised.
 */
export function addUser(enrollId: string | number): CloudRequest {
  return { cmd: 'adduser', enrollid: enrollId }
}

export function deleteUser(enrollId: string | number, backupNum: number): CloudRequest {
  return { cmd: 'deleteuser', enrollid: enrollId, backupnum: backupNum }
}

/** Wipes every user on the device. Deliberately verbose to call by accident. */
export function cleanAllUsers(): CloudRequest {
  return { cmd: 'cleanuser' }
}

export function enableUser(enrollId: string | number, enabled: boolean): CloudRequest {
  return { cmd: 'enableuser', enrollid: enrollId, enflag: enabled ? 1 : 0 }
}

export function getUserName(enrollId: string | number): CloudRequest {
  return { cmd: 'getusername', enrollid: enrollId }
}

export function setUserName(enrollId: string | number, name: string): CloudRequest {
  return { cmd: 'setusername', count: 1, record: [{ enrollid: enrollId, name }] }
}

export function setCard(enrollId: string | number, cardNo: string): CloudRequest {
  return { cmd: 'setcard', enrollid: enrollId, record: cardNo }
}

export function setPassword(enrollId: string | number, password: string): CloudRequest {
  return { cmd: 'setpwd', enrollid: enrollId, record: password }
}

/** Paged. Pass to readPaged() rather than sending directly. */
export const GET_USER_LIST = 'getuserlist'
export const GET_ALL_USERS = 'getallusers'

// ── Logs ─────────────────────────────────────────────────────────────────────

/**
 * Records since the device's own read pointer.
 *
 * This is outage recovery: the push path can only deliver what the device is
 * currently holding and still re-sending, so after a long disconnect this is
 * what actually gets the missing punches back. Paged.
 */
export const GET_NEW_LOG = 'getnewlog'

/** Everything still stored on the device. Paged, and can be very large. */
export const GET_ALL_LOG = 'getalllog'

export function cleanLog(): CloudRequest {
  return { cmd: 'cleanlog' }
}

// ── Device ───────────────────────────────────────────────────────────────────

export function getDeviceInfo(): CloudRequest {
  return { cmd: 'getdevinfo' }
}

export interface DeviceSettings {
  deviceId?: number
  language?: number
  volume?: number
  screensaver?: number
  /** Which credentials the device accepts (model-specific enum). */
  verifyMode?: number
  sleep?: number
  userFpNum?: number
  logHint?: number
  /** Anti-double-punch window, in the device's own units. */
  reverifyTime?: number
}

export function setDeviceInfo(s: DeviceSettings): CloudRequest {
  const req: CloudRequest = { cmd: 'setdevinfo' }
  // Only send what the caller set: these devices treat a present field as an
  // instruction, so a default-filled payload would silently reset settings the
  // caller never meant to touch.
  if (s.deviceId !== undefined) req.deviceid = s.deviceId
  if (s.language !== undefined) req.language = s.language
  if (s.volume !== undefined) req.volume = s.volume
  if (s.screensaver !== undefined) req.screensaver = s.screensaver
  if (s.verifyMode !== undefined) req.verifymode = s.verifyMode
  if (s.sleep !== undefined) req.sleep = s.sleep
  if (s.userFpNum !== undefined) req.userfpnum = s.userFpNum
  if (s.logHint !== undefined) req.loghint = s.logHint
  if (s.reverifyTime !== undefined) req.reverifytime = s.reverifyTime
  return req
}

/**
 * Set the device clock.
 *
 * Format is the vendor's `yyyy-MM-dd HH:mm:ss`, in the DEVICE's local time —
 * these terminals have no timezone concept, they have a wall clock. Sending UTC
 * to a Nairobi reader shifts every subsequent punch by three hours.
 */
export function setTime(deviceLocal: Date): CloudRequest {
  const p = (n: number) => String(n).padStart(2, '0')
  const cloudtime =
    `${deviceLocal.getFullYear()}-${p(deviceLocal.getMonth() + 1)}-${p(deviceLocal.getDate())} ` +
    `${p(deviceLocal.getHours())}:${p(deviceLocal.getMinutes())}:${p(deviceLocal.getSeconds())}`
  return { cmd: 'settime', cloudtime }
}

/** Same, when the caller has already formatted device-local wall clock. */
export function setTimeRaw(cloudtime: string): CloudRequest {
  return { cmd: 'settime', cloudtime }
}

export function reboot(): CloudRequest {
  return { cmd: 'reboot' }
}

/** Factory reset. Destroys users, templates and logs. */
export function initSystem(): CloudRequest {
  return { cmd: 'initsys' }
}

/** Clears device administrators — the lockout escape hatch. */
export function cleanAdmin(): CloudRequest {
  return { cmd: 'cleanadmin' }
}

export function enableDevice(enabled: boolean): CloudRequest {
  return { cmd: enabled ? 'enabledevice' : 'disabledevice' }
}

export function openDoor(doorNum?: number): CloudRequest {
  return doorNum === undefined ? { cmd: 'opendoor' } : { cmd: 'opendoor', doornum: doorNum }
}

// ── Access control ───────────────────────────────────────────────────────────

export interface UserAccess {
  enrollId: string | number
  weekZone: number
  weekZone2?: number
  weekZone3?: number
  weekZone4?: number
  group?: number
  /** Validity window — the right primitive for contractors and visitors. */
  startTime?: string
  endTime?: string
}

export function setUserLock(a: UserAccess): CloudRequest {
  const record: Record<string, unknown> = { enrollid: a.enrollId, weekzone: a.weekZone }
  if (a.weekZone2 !== undefined) record.weekzone2 = a.weekZone2
  if (a.weekZone3 !== undefined) record.weekzone3 = a.weekZone3
  if (a.weekZone4 !== undefined) record.weekzone4 = a.weekZone4
  if (a.group !== undefined) record.group = a.group
  if (a.startTime !== undefined) record.starttime = a.startTime
  if (a.endTime !== undefined) record.endtime = a.endTime
  return { cmd: 'setuserlock', count: 1, record: [record] }
}

export function getUserLock(enrollId: string | number): CloudRequest {
  return { cmd: 'getuserlock', enrollid: enrollId }
}

export function deleteUserLock(enrollId: string | number): CloudRequest {
  return { cmd: 'deleteuserlock', enrollid: enrollId }
}

export function cleanUserLock(): CloudRequest {
  return { cmd: 'cleanuserlock' }
}

export function getDeviceLock(): CloudRequest {
  return { cmd: 'getdevlock' }
}

/**
 * Door hardware behaviour: strike timing, sensors, anti-passback, interlock,
 * Wiegand output, and the day/week time zones.
 *
 * Passed through largely untyped because the field set is model-specific and a
 * partial mapping would be worse than none — the caller should send back a
 * modified copy of what `getdevlock` returned.
 */
export function setDeviceLock(settings: Record<string, unknown>): CloudRequest {
  return { cmd: 'setdevlock', ...settings }
}
