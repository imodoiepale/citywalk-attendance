FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY proxy.mjs entrypoint.sh ./
RUN chmod +x entrypoint.sh
EXPOSE 8443
ENTRYPOINT ["./entrypoint.sh"]
