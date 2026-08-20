import { getPushToken } from '@/lib/biometric/auth'
import { parseAttlog } from '@/lib/biometric/adapters/zkteco'
import { ingestEvents } from '@/lib/biometric/process'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ZKTeco ADMS / "iclock" push endpoint.
 *
 * Point a device's ADMS server setting at `https://<host>/api/biometric/iclock`
 * and it posts its own attendance logs here. This is the path that works
 * without any access to the branch LAN — which matters, because the fleet sits
 * on 192.168.x.x addresses that a hosted app cannot reach to poll.
 *
 * The protocol is old and blunt: plain text bodies, query-string parameters,
 * and replies that must be exactly `OK` or the device retries forever. It is
 * not authenticated in any modern sense — the firmware cannot sign a request —
 * so a shared token in the query string is the available control, and this
 * route is deliberately limited to recording attendance logs. It can create
 * punches; it cannot read anything back out.
 *
 * Handshake the devices expect:
 *   GET  /iclock/cdata?SN=..&options=all   -> configuration block
 *   POST /iclock/cdata?SN=..&table=ATTLOG  -> tab-separated scan records
 *   GET  /iclock/getrequest?SN=..          -> command queue (we issue none)
 */

export const dynamic = 'force-dynamic'

// Devices treat any non-OK response as a failure and re-send. That is the
// behaviour we want on a real error (nothing is lost), so errors return 500.
const OK = new Response('OK', {
  status: 200,
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
})

function unauthorized() {
  return new Response('Unauthorized', { status: 401 })
}

function tokenOk(url: URL): boolean {
  const expected = getPushToken()
  if (!expected) return false
  return url.searchParams.get('token') === expected
}

async function touchDevice(serial: string) {
  // A heartbeat is still contact: it proves the reader is alive even on a day
  // it records no scans, which is what the health view distinguishes.
  const supabase = createAdminClient()
  await supabase
    .from('biometric_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('serial_no', serial)
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const url = new URL(request.url)
  if (!tokenOk(url)) return unauthorized()

  const serial = url.searchParams.get('SN')
  if (!serial) return new Response('SN required', { status: 400 })

  await touchDevice(serial)

  const { path } = await params
  const endpoint = path?.[0] ?? ''

  if (endpoint === 'cdata') {
    // Registration reply. Delay/TransTimes govern how often the device calls
    // back; TransFlag asks for attendance logs and nothing else.
    return new Response(
      [
        `GET OPTION FROM: ${serial}`,
        'Stamp=0',
        'OpStamp=0',
        'ErrorDelay=30',
        'Delay=10',
        'TransTimes=00:00;12:00',
        'TransInterval=1',
        'TransFlag=1000000000',
        'Realtime=1',
        'Encrypt=0',
      ].join('\n'),
      { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    )
  }

  // getrequest: the device asking for commands. We never push commands to
  // readers — this integration only listens — so the queue is always empty.
  return OK
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const url = new URL(request.url)
  if (!tokenOk(url)) return unauthorized()

  const serial = url.searchParams.get('SN')
  if (!serial) return new Response('SN required', { status: 400 })

  const { path } = await params
  const endpoint = path?.[0] ?? ''
  const table = url.searchParams.get('table')

  const body = await request.text()

  if (endpoint !== 'cdata' || (table && table.toUpperCase() !== 'ATTLOG')) {
    // Operation logs, fingerprint templates, and the rest of the protocol are
    // deliberately not handled: acknowledge so the device stops retrying, but
    // record nothing. Biometric templates in particular are never stored.
    await touchDevice(serial)
    return OK
  }

  const events = parseAttlog(body, serial)
  if (events.length === 0) {
    await touchDevice(serial)
    return OK
  }

  try {
    await ingestEvents(events)
  } catch {
    // Non-OK makes the device keep the batch and re-send it. Combined with the
    // dedupe key, retrying is safe and losing scans is not.
    return new Response('ERROR', { status: 500 })
  }

  return OK
}
