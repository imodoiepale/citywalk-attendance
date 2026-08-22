// PHASE 0 — the other half. Where capture.ts waits for the terminal to speak,
// this speaks first: it opens a socket to the device's own port and sends
// candidate request frames, hex-dumping whatever comes back.
//
//   node src/probe/poll-probe.ts 192.168.1.150 5005
//
// The candidates below are HYPOTHESES, not documented facts. The EBKN/Realand
// family is only partially reverse-engineered in public and this M82 build may
// differ. The point is not that one of them is right — it is that a device
// which answers *anything* to *one* of them has told us the shape of its
// framing, and the real client gets written from that. A device that stays
// silent on all of them is also a result: it means poll mode is out and push
// mode is the only path.
//
// Nothing here writes to the device. Every candidate is a read or a handshake;
// there are deliberately no enroll, delete or set-time commands — a probe that
// can brick a live terminal is not a probe worth running.

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = process.argv[2] ?? process.env.DEVICE_HOST ?? '192.168.1.150'
const PORT = Number(process.argv[3] ?? process.env.DEVICE_PORT ?? 5005)
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 3000)

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../captures')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

interface Candidate {
  name: string
  note: string
  build(): Buffer
}

/**
 * EBKN-style request header hypothesis: a fixed ASCII magic, a command byte, a
 * device number, a little-endian payload length, and a header checksum.
 */
function ebknFrame(command: number, machine = 1, payload = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(16)
  head.write('EBKN', 0, 'ascii')
  head.writeUInt8(command, 4)
  head.writeUInt8(machine, 5)
  head.writeUInt32LE(payload.length, 8)
  let sum = 0
  for (let i = 0; i < 15; i++) sum = (sum + (head[i] ?? 0)) & 0xff
  head.writeUInt8(sum, 15)
  return Buffer.concat([head, payload])
}

const CANDIDATES: Candidate[] = [
  {
    name: 'ebkn-getdeviceinfo',
    note: 'EBKN-style binary header, hypothesised "get device info" command',
    build: () => ebknFrame(0x01),
  },
  {
    name: 'ebkn-getdevicetime',
    note: 'EBKN-style binary header, hypothesised "get time" command',
    build: () => ebknFrame(0x02),
  },
  {
    name: 'ebkn-getlogdata',
    note: 'EBKN-style binary header, hypothesised "read attendance log" command',
    build: () => ebknFrame(0x20),
  },
  {
    name: 'zkteco-connect',
    note: 'ZKTeco CMD_CONNECT (0x03e8) — cheap to rule the family in or out',
    build: () => {
      const cmd = Buffer.alloc(8)
      cmd.writeUInt16LE(0x03e8, 0) // CMD_CONNECT
      cmd.writeUInt16LE(0x0000, 2) // checksum, ignored by most firmwares
      cmd.writeUInt16LE(0x0000, 4) // session id
      cmd.writeUInt16LE(0x0000, 6) // reply counter
      const wrap = Buffer.alloc(8)
      wrap.writeUInt32LE(0x7d825050, 0) // documented ZK TCP magic
      wrap.writeUInt32LE(cmd.length, 4)
      return Buffer.concat([wrap, cmd])
    },
  },
  {
    name: 'http-get-root',
    note: 'Is 5005 actually an HTTP server? Settles the "open it in a browser" question',
    build: () =>
      Buffer.from(
        ['GET / HTTP/1.1', `Host: ${HOST}:${PORT}`, 'Connection: close', '', ''].join('\r\n'),
        'ascii'
      ),
  },
  {
    name: 'plain-newline',
    note: 'Some firmwares only need a nudge before they greet',
    build: () => Buffer.from('\r\n', 'ascii'),
  },
  {
    name: 'silent-listen',
    note: 'Send nothing — many terminals emit a banner the moment you connect',
    build: () => Buffer.alloc(0),
  },
]

function hexDump(buf: Buffer, limit = 256): string {
  const slice = buf.subarray(0, limit)
  const rows: string[] = []
  for (let i = 0; i < slice.length; i += 16) {
    const chunk = slice.subarray(i, i + 16)
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)
    const ascii = [...chunk]
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('')
    rows.push(`  ${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`)
  }
  if (buf.length > limit) rows.push(`  … ${buf.length - limit} more bytes`)
  return rows.join('\n')
}

interface ProbeResult {
  name: string
  reply: Buffer
  connected: boolean
  error?: string
}

function tryCandidate(c: Candidate): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let connected = false
    let settled = false

    const socket = net.createConnection({ host: HOST, port: PORT, timeout: WAIT_MS + 2000 })

    const finish = (error?: string) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ name: c.name, reply: Buffer.concat(chunks), connected, ...(error ? { error } : {}) })
    }

    socket.on('connect', () => {
      connected = true
      const frame = c.build()
      if (frame.length > 0) socket.write(frame)
      // A fixed window, then move on. A terminal that needs longer than a few
      // seconds to acknowledge a read is not one we can poll on a schedule.
      setTimeout(() => finish(), WAIT_MS)
    })
    socket.on('data', (b: Buffer) => chunks.push(b))
    socket.on('error', (e) => finish(e.message))
    socket.on('timeout', () => finish('socket timeout'))
    socket.on('close', () => finish())
  })
}

console.log(`probing ${HOST}:${PORT}\n`)

let answered = 0

for (const c of CANDIDATES) {
  process.stdout.write(`${c.name.padEnd(22)} `)
  const r = await tryCandidate(c)

  fs.appendFileSync(
    outFile,
    JSON.stringify({
      at: new Date().toISOString(),
      host: HOST,
      port: PORT,
      candidate: c.name,
      note: c.note,
      sentBase64: c.build().toString('base64'),
      connected: r.connected,
      error: r.error ?? null,
      replyBytes: r.reply.length,
      replyBase64: r.reply.toString('base64'),
      replyUtf8: r.reply.toString('utf8'),
    }) + '\n',
    'utf8'
  )

  if (!r.connected) {
    console.log(`connect failed — ${r.error ?? 'unknown'}`)
  } else if (r.reply.length === 0) {
    console.log(`connected, no reply${r.error ? ` (${r.error})` : ''}`)
  } else {
    answered += 1
    console.log(`REPLY ${r.reply.length} bytes`)
    console.log(hexDump(r.reply))
  }
}

console.log(`\n${answered}/${CANDIDATES.length} candidate(s) got a reply.`)
console.log(`written to ${outFile}`)

if (answered === 0) {
  console.log(
    [
      '',
      'The port accepts connections but answers nothing we sent. That is a real',
      'result, not a failure: the framing is something else, and push mode is the',
      'faster path from here.',
      '',
      'Next: run `npm run capture`, point the terminal at this machine, and scan.',
    ].join('\n')
  )
}
