import net from 'node:net'
import { once } from 'node:events'
import { JsonStream, encode, type CloudMessage, type CloudRequest } from '../cloud/protocol.ts'

// A fake terminal that speaks the device side of the cloud protocol.
//
// The point is to make the whole remote-management feature buildable and
// testable with no hardware in the room: it registers, answers commands the way
// the real firmware is documented to, and can be told to push punches and
// captured credentials on demand.
//
// It is also the honest way to develop against an UNVERIFIED protocol — it
// encodes our understanding of the spec, so when a real terminal disagrees, the
// difference is visible as a failing assumption in one place rather than a bug
// scattered through the gateway.
//
//   node src/probe/simulate-cloud.ts --serial ENS2025079 --port 7788
//   node src/probe/simulate-cloud.ts --serial ENS2025079 --punch 1027

export interface SimulatedUser {
  name: string
  admin: number
  /** backupnum → template */
  credentials: Map<number, string>
}

export interface SimulatorOptions {
  host?: string
  port?: number
  serial: string
  model?: string
  firmware?: string
  fpAlgo?: string
  /** Capacity reported at registration. */
  capacity?: Record<string, number>
  /** Rows per page for paged reads, so paging is actually exercised. */
  pageSize?: number
  /** What `adduser` should capture, keyed by enrollid. Defaults to a stub. */
  captureTemplate?: (enrollId: string) => string
}

export class SimulatedDevice {
  readonly users = new Map<string, SimulatedUser>()
  /** Every command the gateway has sent us, in order. */
  readonly received: CloudRequest[] = []

  private socket: net.Socket | null = null
  private readonly stream = new JsonStream()
  private readonly opts: Required<Omit<SimulatorOptions, 'captureTemplate'>> & {
    captureTemplate: (enrollId: string) => string
  }

  /** Paged reads in progress: command → rows still to hand out. */
  private paging = new Map<string, Record<string, unknown>[]>()
  private logs: Record<string, unknown>[] = []

  constructor(options: SimulatorOptions) {
    this.opts = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 7788,
      serial: options.serial,
      model: options.model ?? 'EN-K190FTW',
      firmware: options.firmware ?? 'SIM-1.0.0',
      fpAlgo: options.fpAlgo ?? 'ZK10',
      capacity: options.capacity ?? {
        usersize: 3000, useduser: 0, fpsize: 5000, usedfp: 0,
        cardsize: 3000, usedcard: 0, pwdsize: 3000, usedpwd: 0,
        logsize: 100000, usedlog: 0, usednewlog: 0,
      },
      pageSize: options.pageSize ?? 2,
      captureTemplate: options.captureTemplate ?? ((id) => `SIMULATED-TEMPLATE-${id}`),
    }
  }

  async connect(): Promise<void> {
    const socket = net.createConnection({ host: this.opts.host, port: this.opts.port })
    this.socket = socket
    await once(socket, 'connect')

    socket.on('data', (chunk: Buffer) => {
      for (const msg of this.stream.push(chunk)) this.onMessage(msg)
    })
    socket.on('error', () => { /* the test or operator sees it via close */ })

    this.send({
      cmd: 'reg',
      sn: this.opts.serial,
      devinfo: {
        modelname: this.opts.model,
        firmware: this.opts.firmware,
        fpalgo: this.opts.fpAlgo,
        time: new Date().toISOString(),
        ...this.opts.capacity,
      },
    })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
  }

  /** Push a punch, exactly as a real scan would. */
  sendLog(enrollId: string, time: string, opts: { mode?: number; inout?: number } = {}): void {
    const record = { enrollid: enrollId, time, mode: opts.mode ?? 1, inout: opts.inout ?? 0, event: 0 }
    this.logs.push(record)
    this.send({ cmd: 'sendlog', sn: this.opts.serial, count: 1, record: [record] })
  }

  /** Push a credential captured on the device — the reply to `adduser`. */
  sendUser(enrollId: string, backupNum: number, template: string, name?: string): void {
    this.send({
      cmd: 'senduser', sn: this.opts.serial,
      enrollid: enrollId, backupnum: backupNum, admin: 0, record: template,
      ...(name ? { name } : {}),
    })
  }

  /** Commands received matching a name — the usual test assertion. */
  commandsNamed(cmd: string): CloudRequest[] {
    return this.received.filter((c) => c.cmd === cmd)
  }

  private send(message: Record<string, unknown>): void {
    this.socket?.write(encode(message as CloudRequest))
  }

  private onMessage(msg: CloudMessage): void {
    // Our own registration acknowledgement, not a command.
    if (typeof (msg as { ret?: string }).ret === 'string') return
    const cmd = (msg as CloudRequest).cmd
    if (typeof cmd !== 'string') return

    this.received.push(msg as CloudRequest)
    const req = msg as CloudRequest

    switch (cmd) {
      case 'setuserinfo': return this.onSetUserInfo(req)
      case 'getuserinfo': return this.onGetUserInfo(req)
      case 'deleteuser': return this.onDeleteUser(req)
      case 'cleanuser': {
        this.users.clear()
        return this.reply(cmd, true)
      }
      case 'adduser': return this.onAddUser(req)
      case 'setusername': case 'enableuser': case 'setcard': case 'setpwd':
      case 'settime': case 'reboot': case 'initsys': case 'cleanadmin':
      case 'enabledevice': case 'disabledevice': case 'opendoor':
      case 'setdevlock': case 'setuserlock': case 'deleteuserlock':
      case 'cleanuserlock': case 'cleanlog':
        return this.reply(cmd, true)
      case 'getdevinfo':
        return this.reply(cmd, true, { devinfo: { modelname: this.opts.model, ...this.opts.capacity } })
      case 'getallusers': case 'getuserlist':
        return this.onPagedUsers(req, cmd)
      case 'getnewlog': case 'getalllog':
        return this.onPagedLogs(req, cmd)
      default:
        // Unknown commands get a truthful refusal rather than silence, so the
        // gateway's error path is exercised too.
        return this.reply(cmd, false, { reason: 'unsupported' })
    }
  }

  private onSetUserInfo(req: CloudRequest): void {
    const id = String(req.enrollid)
    const backupNum = Number(req.backupnum)
    const user = this.users.get(id) ?? { name: '', admin: 0, credentials: new Map<number, string>() }
    if (typeof req.name === 'string' && req.name) user.name = req.name
    if (req.admin !== undefined) user.admin = Number(req.admin)
    if (typeof req.record === 'string') user.credentials.set(backupNum, req.record)
    this.users.set(id, user)
    this.reply('setuserinfo', true)
  }

  private onGetUserInfo(req: CloudRequest): void {
    const user = this.users.get(String(req.enrollid))
    const template = user?.credentials.get(Number(req.backupnum))
    if (!template) return this.reply('getuserinfo', false, { reason: 'not found' })
    this.reply('getuserinfo', true, {
      enrollid: req.enrollid, backupnum: req.backupnum, name: user?.name ?? '', record: template,
    })
  }

  private onDeleteUser(req: CloudRequest): void {
    const id = String(req.enrollid)
    this.users.get(id)?.credentials.delete(Number(req.backupnum))
    if (this.users.get(id)?.credentials.size === 0) this.users.delete(id)
    this.reply('deleteuser', true)
  }

  /**
   * `adduser` is asynchronous in reality: the device acknowledges, a human
   * presents a finger some seconds later, and only then does `senduser`
   * arrive. The simulator keeps that shape — the template does NOT come back
   * on the reply — because code that assumes otherwise would break on real
   * hardware.
   */
  private onAddUser(req: CloudRequest): void {
    this.reply('adduser', true)
    const id = String(req.enrollid)
    setTimeout(() => {
      const template = this.opts.captureTemplate(id)
      const user = this.users.get(id) ?? { name: '', admin: 0, credentials: new Map<number, string>() }
      user.credentials.set(0, template)
      this.users.set(id, user)
      this.sendUser(id, 0, template)
    }, 10).unref?.()
  }

  private onPagedUsers(req: CloudRequest, cmd: string): void {
    if (req.stn === true) {
      this.paging.set(cmd, [...this.users].flatMap(([enrollid, u]) =>
        [...u.credentials].map(([backupnum, record]) => ({ enrollid, backupnum, name: u.name, record }))
      ))
    }
    this.handOutPage(cmd)
  }

  private onPagedLogs(req: CloudRequest, cmd: string): void {
    if (req.stn === true) this.paging.set(cmd, [...this.logs])
    this.handOutPage(cmd)
  }

  private handOutPage(cmd: string): void {
    const remaining = this.paging.get(cmd) ?? []
    const page = remaining.splice(0, this.opts.pageSize)
    this.paging.set(cmd, remaining)
    // An empty page is how the device says "that is everything" — the gateway's
    // readPaged() stops on it.
    this.reply(cmd, true, { count: page.length, record: page })
  }

  private reply(ret: string, result: boolean, extra: Record<string, unknown> = {}): void {
    this.send({ ret, result, ...extra })
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

if (process.argv[1]?.includes('simulate-cloud')) {
  const device = new SimulatedDevice({
    host: flag('host', '127.0.0.1'),
    port: Number(flag('port', '7788')),
    serial: flag('serial', 'ENS2025079') as string,
    model: flag('model'),
  })

  await device.connect()
  console.log(`simulated device ${flag('serial', 'ENS2025079')} connected; registration sent`)

  const punch = flag('punch')
  if (punch) {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp =
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
      `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
    device.sendLog(punch, stamp)
    console.log(`pushed a punch for enrollid ${punch} at ${stamp}`)
  }

  console.log('staying connected — commands from the gateway will be answered. Ctrl-C to stop.')
  process.on('SIGINT', () => { device.close(); process.exit(0) })
}
