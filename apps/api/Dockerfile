# =============================================================================
# TalentFlow API — multi-stage Dockerfile
# =============================================================================
# Targets:
#   - deps     : install all deps (dev + prod) for build/test
#   - builder  : compile TS -> dist
#   - runtime  : production image, prod-only deps + dist + migrations
#
# Build:
#   docker build --target runtime -t talentflow/api:latest apps/api
#
# Local dev still works against the unnamed final stage because docker
# defaults to the last stage when no --target is supplied.
# =============================================================================

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++
# NB: only copy package.json (not package-lock.json). The monorepo uses
# npm workspaces — the lock file lives in the repo root and the legacy
# workspace-level lock files are stale relics from before the workspaces
# migration. Using `npm install` (not `npm ci`) here regenerates a
# valid dependency tree from package.json alone.
COPY package.json ./
RUN npm install --no-audit --no-fund --include=dev --legacy-peer-deps

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Reduce node_modules to production-only for the runtime stage
RUN npm prune --omit=dev

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Non-root user — best practice; matches Alpine's default `node` UID.
RUN apk add --no-cache wget tini

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/migrations ./migrations

# Local-disk fallback voor uploads. In productie staat STORAGE_DRIVER=s3 en
# wordt MinIO gebruikt, maar `candidates.router.ts` doet alsnog een
# `mkdirSync(uploadsDir)` op module load — die moet kunnen slagen onder de
# non-root `node` user.
RUN mkdir -p /app/uploads/resumes && chown -R node:node /app/uploads

USER node

EXPOSE 4000

# tini reaps zombies and forwards signals (BullMQ workers need clean SIGTERM)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
