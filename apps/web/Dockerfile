# =============================================================================
# TalentFlow Web (Next.js 14) — multi-stage Dockerfile
# (Sub-fase 2A: monorepo-root context)
# =============================================================================
# Uses Next.js standalone output (output: 'standalone' in next.config.mjs)
# to produce a minimal runtime image — only files actually imported at
# runtime are copied.
#
# Build args expose NEXT_PUBLIC_* values to the client bundle. They MUST
# be present at build-time because Next inlines them into JS chunks.
#
# Build context is the MONOREPO ROOT (not apps/web), zodat we
# `packages/contracts/` mee kunnen COPYen.
#
# Build (vanuit repo-root):
#   docker build --target runtime -t talentflow/web:latest -f apps/web/Dockerfile .
# =============================================================================

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Workspace bootstrap — root + alle workspace package.jsons vóór install.
COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/i18n/package.json ./packages/i18n/package.json

RUN npm install --no-audit --no-fund --include=dev --legacy-peer-deps --workspaces --include-workspace-root

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ARG NEXT_PUBLIC_USE_MOCK_DATA=false
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION=false
ARG NEXT_PUBLIC_APP_HOSTS
# CUSTOM_DOMAIN_RESOLVE_BASE moet BUILD-TIME ingebakken worden: de custom-domain-
# middleware draait in de Edge-runtime, die niet-NEXT_PUBLIC_ env-vars niet op
# runtime leest. Next inlinet hier de letterlijke string; de URL is pas op
# runtime (compose-netwerk) bereikbaar — dat volstaat.
ARG CUSTOM_DOMAIN_RESOLVE_BASE=http://api:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_USE_MOCK_DATA=$NEXT_PUBLIC_USE_MOCK_DATA
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION=$NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION
ENV NEXT_PUBLIC_APP_HOSTS=$NEXT_PUBLIC_APP_HOSTS
ENV CUSTOM_DOMAIN_RESOLVE_BASE=$CUSTOM_DOMAIN_RESOLVE_BASE
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
# Workspace manifests (consistent met api Dockerfile + nodig voor evt. prune)
COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/i18n/package.json ./packages/i18n/package.json
COPY packages/contracts ./packages/contracts
COPY packages/i18n ./packages/i18n
COPY apps/web ./apps/web

# Shared package mag onbroken-builden zodat de `dist`-export bestaat — Next.js
# bundelt via transpilePackages alsnog vanuit src, maar de fallback `main`
# moet bestaan voor non-Next consumers (Vitest, Node runtime).
RUN cd packages/contracts && npx tsc

# Next.js standalone-output tracer scant deps relatief vanaf het webapp
# package (`apps/web/node_modules`). npm-workspaces hoist standaard alles
# op `/app/node_modules`, dus we mirror'en daar een fysieke kopie naar
# `apps/web/node_modules` vóór de build. Een symlink werkt niet — de
# tracer kopieert de link zelf mee naar de standalone bundle en eindigt
# als loop in de runtime image.
RUN cp -r /app/node_modules /app/apps/web/node_modules

# Guarantee public/ exists — Next.js standalone runtime expects it even
# when empty, and the runtime stage COPYs it unconditionally.
RUN cd apps/web && mkdir -p public && npm run build

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

# Next.js standalone bundelt @talentflow/contracts mee (transpilePackages),
# dus de runtime image hoeft de package niet apart te dragen. We kopiëren
# alleen de standalone-output + static + public, gerooted onder apps/web
# vanwege de monorepo-tracer.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# Next.js standalone in monorepo: server.js zoekt static op /app/.next/static,
# maar Next bouwt ze op /app/apps/web/.next/static. Beide paden behouden
# zodat de runtime werkt zonder afhankelijk te zijn van internal Next behavior.
# Zie ROADMAP "Next.js standalone monorepo paden documenteren".
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
# server.js (cwd /app) serveert public vanuit /app/public, maar Next bouwt het
# op /app/apps/web/public. Beide paden behouden — anders 404 op /sw.js,
# /manifest.json en /icons (zelfde monorepo-tracer-valkuil als static hierboven).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# Standalone-output legt server.js op de root van de bundle, ook met
# outputFileTracingRoot — alleen `node_modules` en static-assets verhuizen
# in de nested apps/web/ structuur.
CMD ["node", "server.js"]

# Healthcheck doet TWEE probes:
#   1. /login → HTTP 200 (server.js draait + rendert HTML)
#   2. een echte JS-chunk uit .next/static → HTTP 200 (static-assets worden
#      ook daadwerkelijk geserveerd, niet alleen de HTML)
# Probe 2 is toegevoegd na het incident van 2026-05-18..21: de container stond
# 3 dagen `(healthy)` terwijl alle client-bundles 404'den (witte pagina). De
# oude check (alleen /login) was een false positive. Chunk-naam bevat een
# content-hash, dus we zoeken er één op schijf en verifiëren dat exact die via
# HTTP geserveerd wordt — hash-agnostisch en bestand tegen rebuilds.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD set -e; \
      wget -qO- http://localhost:3000/login >/dev/null 2>&1; \
      asset=$(ls .next/static/chunks/*.js 2>/dev/null | head -n1) || true; \
      if [ -n "$asset" ]; then \
        wget -qO- "http://localhost:3000/_next/static/chunks/$(basename "$asset")" >/dev/null 2>&1; \
      fi
