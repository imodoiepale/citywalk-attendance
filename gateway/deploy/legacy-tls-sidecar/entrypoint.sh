#!/bin/sh
set -e

# Self-signed on purpose: this terminal's firmware carries no trusted CA
# bundle we can target, so a CA-issued cert buys nothing over a self-signed
# one here (unlike the main Traefik-fronted hostname, which serves ordinary
# browsers and API clients that DO check the chain). Generated fresh on each
# container start rather than committed, so no key material lives in the
# repo. If this same firmware turns out to validate the chain after all and
# reject self-signed certs, that will show as the TLS handshake completing
# (this proxy logs the connection) followed by an immediate client-side
# close with zero application bytes — the fix at that point is a CA-issued
# cert mounted here instead, not a code change.
mkdir -p /certs
if [ ! -f /certs/cert.pem ]; then
  # subjectAltName is required, not optional decoration: modern TLS stacks
  # (and plenty of embedded ones) reject a cert with no SAN entry even when
  # they don't otherwise validate the chain, aborting right after the
  # handshake with no application data ever sent — reproduced locally
  # against a CN-only cert before this fix.
  HOST="${GATEWAY_HOSTNAME:-citywalk-biometric-legacy}"
  openssl req -x509 -newkey rsa:2048 -keyout /certs/key.pem -out /certs/cert.pem \
    -days 3650 -nodes -subj "/CN=${HOST}" \
    -addext "subjectAltName=DNS:${HOST}${TLS_SIDECAR_EXTRA_SAN:+,${TLS_SIDECAR_EXTRA_SAN}}"
fi

exec node proxy.mjs
