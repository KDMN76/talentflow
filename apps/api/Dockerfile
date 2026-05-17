# =============================================================================
# TalentFlow API — multi-stage Dockerfile (Sub-fase 2A: monorepo-root context)
# =============================================================================
# Targets:
#   - deps     : install all deps for build/test (api + shared workspaces)
#   - builder  : build shared package, then compile api TS -> dist
#   - runtime  : production image, prod-only deps + dist + migrations
#
# Build context is the MONOREPO ROOT (not apps/api), zodat we
# `packages/contracts/` mee kunnen COPYen — die wordt door
# `@talentflow/contracts: *` als workspace dependency gelinkt.
#
# Build (vanuit repo-root):
#   docker build --target runtime -t talentflow/api:latest -f apps/api/Dockerfile .
# =============================================================================

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++

# Workspace bootstrap: we hebben drie package.jsons nodig vóór npm install
# zodat workspaces resolved kunnen worden, plus alle shared/*/package.json
# files. Lock file lives in repo-root (zie root package.json).
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

# `npm install` op monorepo-root, --workspaces zorgt dat shared mee-linked
# wordt als symlink in apps/api/node_modules/@talentflow/contracts.
RUN npm install --no-audit --no-fund --include=dev --legacy-peer-deps --workspaces --include-workspace-root

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
# Hoisted node_modules (npm workspaces verzamelt alle deps op root)
COPY --from=deps /app/node_modules ./node_modules
# Workspace manifests (nodig voor `npm prune` op root, anders ENOENT)
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
# Source-files
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

# Eerst shared bouwen — produceert dist/index.js + dist/index.d.ts die de
# api runtime via require('@talentflow/contracts') gaat resolven via
# package.json main: ./dist/index.js
RUN cd packages/contracts && npx tsc

# Dan de api zelf
RUN cd apps/api && npm run build

# Prune naar productie-only deps (drops dev-deps zoals typescript, tsx).
# MUST op monorepo-root draaien — vanuit een workspace-subdir kan npm de
# workspace-protocol deps niet resolven en faalt op registry-lookup.
RUN npm prune --omit=dev --legacy-peer-deps --workspaces --include-workspace-root

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache wget tini

# Api eigen artifacts
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/migrations ./migrations

# Hoisted node_modules (alles op root) + de shared contracts package
# zodat de workspace-symlink in node_modules/@talentflow/contracts ->
# /app/packages/contracts gewoon werkt op runtime.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/contracts ./packages/contracts

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
