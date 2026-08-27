# Node 22.18+ runs TypeScript directly by stripping types, so there is no build
# step and no compiled output to drift from the source. The tsconfig enforces
# erasable-syntax-only to keep it that way.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a source edit does not re-resolve the tree.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src
COPY devices.example.yaml destinations.example.yaml ./

# The spool must outlive the container. Without a volume mounted here, a
# restart during an outage would discard scans that had not yet been forwarded.
RUN mkdir -p /var/lib/smart-sentinel/spool && chown -R node:node /var/lib/smart-sentinel /app
VOLUME ["/var/lib/smart-sentinel/spool"]

ENV SPOOL_DIR=/var/lib/smart-sentinel/spool \
    DEVICES_FILE=/app/devices.yaml \
    DESTINATIONS_FILE=/app/destinations.yaml \
    GATEWAY_HTTP_PORT=8080 \
    TZ=Africa/Nairobi

USER node
# 8080 carries HTTP and WebSocket. 5005 is the FkWeb raw-TCP port the
# EN-K190FTW family dials; it is not HTTP and cannot go through a reverse proxy.
EXPOSE 8080 5005

# Fails the container if the process is up but not serving — which is the state
# a plain process check would happily call healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GATEWAY_HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.ts"]
