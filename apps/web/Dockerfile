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

RUN npm install --no-audit --no-fund --include=dev --legacy-peer-deps --workspaces --include-workspace-root

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ARG NEXT_PUBLIC_USE_MOCK_DATA=false
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_USE_MOCK_DATA=$NEXT_PUBLIC_USE_MOCK_DATA
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION=$NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web

# Shared package mag onbroken-builden zodat de `dist`-export bestaat — Next.js
# bundelt via transpilePackages alsnog vanuit src, maar de fallback `main`
# moet bestaan voor non-Next consumers (Vitest, Node runtime).
RUN cd packages/contracts && npx tsc

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
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# Standalone server.js leeft onder apps/web/ in de monorepo-output structure.
CMD ["node", "apps/web/server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/login >/dev/null 2>&1 || exit 1
