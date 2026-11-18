# syntax=docker/dockerfile:1
# Images for the API, the staff web panel and the member app, built from the monorepo root:
#   docker build --target api .      (also runs migrations and the seed)
#   docker build --target web .
#   docker build --target member .
# infra/docker-compose.staging.yml builds all three.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.18.0
WORKDIR /repo

# ---------------------------------------------------------------------------
# Build everything once. No .env is copied (.dockerignore): configuration comes from the
# container environment at run time.
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
# The Next servers proxy /api to this address; Next fixes rewrites at build time.
ARG API_INTERNAL_URL=http://api:8000
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_OUTPUT=standalone
# Two Next.js builds at once need several GB of memory; lower this on small builders.
ARG BUILD_CONCURRENCY=2
RUN pnpm turbo run build --concurrency=$BUILD_CONCURRENCY

# ---------------------------------------------------------------------------
# API. Keeps the full workspace (dev dependencies included) so the same image runs
# `prisma migrate deploy` and the seed. A slimmer production image is an M8 task.
FROM build AS api
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
EXPOSE 8000
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# Next.js standalone servers: only the traced files, no package manager, no sources.
FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node:24-bookworm-slim AS member
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/member/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/member/.next/static ./apps/member/.next/static
COPY --from=build --chown=node:node /repo/apps/member/public ./apps/member/public
USER node
EXPOSE 3001
CMD ["node", "apps/member/server.js"]
