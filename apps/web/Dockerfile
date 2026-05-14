# =============================================================================
# TalentFlow Web (Next.js 14) — multi-stage Dockerfile
# =============================================================================
# Uses Next.js standalone output (output: 'standalone' in next.config.mjs)
# to produce a minimal runtime image — only files actually imported at
# runtime are copied.
#
# Build args expose NEXT_PUBLIC_* values to the client bundle. They MUST
# be present at build-time because Next inlines them into JS chunks.
# =============================================================================

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package*.json ./
RUN npm ci --include=dev

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ARG NEXT_PUBLIC_USE_MOCK_DATA=false
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_USE_MOCK_DATA=$NEXT_PUBLIC_USE_MOCK_DATA
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Guarantee public/ exists — Next.js standalone runtime expects it even
# when empty, and the runtime stage COPYs it unconditionally.
RUN mkdir -p public && npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache wget tini && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Standalone bundle + static assets.
# `public/` is created in the builder stage (mkdir -p) below to guarantee
# it exists before COPY — Next.js standalone expects it even when empty.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1
