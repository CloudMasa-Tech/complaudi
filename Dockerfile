# syntax=docker/dockerfile:1

# ─── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY web/package*.json ./web/
RUN npm install --ignore-scripts --legacy-peer-deps && npm install --ignore-scripts --legacy-peer-deps --prefix web

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

COPY web ./web
RUN npm run --prefix web build

# ─── runtime dependencies ─────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --ignore-scripts --legacy-peer-deps && npx prisma generate

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl tini

ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_WEB=true \
    WEB_DIST_DIR=/app/web/dist

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/web/dist     ./web/dist
COPY prisma ./prisma
COPY package.json ./

# Never run as root; the image writes nothing outside /tmp.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards SIGTERM, which the app already handles by
# draining in-flight requests before closing the database connection.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
