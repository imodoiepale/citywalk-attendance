import tls from 'node:tls'
import net from 'node:net'
import fs from 'node:fs'

// Legacy-TLS terminator for terminal firmware that cannot negotiate a modern
// TLS stack — observed on hardware: a ClientHello declaring TLS 1.0
// (client_version 0x0301) offering only old CBC cipher suites, no TLS 1.2/1.3
// suites at all. Traefik's default minVersion is TLS 1.2, and Traefik's TLS
// options (minVersion, cipherSuites) cannot be set from Docker labels alone —
// they require its separate file provider, which lives outside this compose
// file since Hostinger's Traefik is a pre-existing, separately-managed
// instance. So this sidecar terminates TLS itself and hands the gateway
// plain HTTP, the same way Traefik would for a modern client — published on
// its own port, bypassing Traefik entirely, exactly like FkWeb's raw TCP 5005
// already does for the same underlying reason (a protocol Traefik cannot
// front).

const FRONT_PORT = Number(process.env.TLS_SIDECAR_PORT ?? 8443)
const BACKEND_HOST = process.env.TLS_SIDECAR_BACKEND_HOST ?? 'gateway'
const BACKEND_PORT = Number(process.env.TLS_SIDECAR_BACKEND_PORT ?? 8080)
const CERT_DIR = process.env.TLS_SIDECAR_CERT_DIR ?? '/certs'

const log = (level, msg, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }))

const options = {
  key: fs.readFileSync(`${CERT_DIR}/key.pem`),
  cert: fs.readFileSync(`${CERT_DIR}/cert.pem`),
  minVersion: 'TLSv1',
  ciphers: 'ALL:@SECLEVEL=0',
  honorCipherOrder: true,
}

const server = tls.createServer(options, (front) => {
  const from = `${front.remoteAddress}:${front.remotePort}`
  const back = net.connect(BACKEND_PORT, BACKEND_HOST, () => {
    front.pipe(back)
    back.pipe(front)
  })
  back.on('error', (e) => { log('warn', 'legacy TLS sidecar backend error', { from, error: e.message }); front.destroy() })
  front.on('error', (e) => log('warn', 'legacy TLS sidecar front error', { from, error: e.message }))
})

server.on('tlsClientError', (e, socket) => {
  log('warn', 'legacy TLS sidecar client error', { from: socket.remoteAddress, error: e.message })
})

server.listen(FRONT_PORT, '0.0.0.0', () => {
  log('info', 'legacy TLS sidecar listening', { port: FRONT_PORT, backend: `${BACKEND_HOST}:${BACKEND_PORT}` })
})
