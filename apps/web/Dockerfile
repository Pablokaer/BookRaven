# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
# pnpm at the version in package.json "packageManager", in a layer of its own
COPY package.json ./
RUN corepack enable && corepack install
# pnpm's package store persists between builds (BuildKit cache), so a deploy only downloads new packages
ENV npm_config_store_dir=/pnpm/store
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches patches
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
# CI already typechecks (pnpm build), so only Vite runs here, then the prerendered landing page
# (with the site's address and whether it takes sign-ups, docker-compose.yml) and .br/.gz copies
# for Caddy.
ARG PUBLIC_URL=""
ARG ALLOW_SIGNUP=""
RUN pnpm --filter web exec vite build \
  && PUBLIC_URL="$PUBLIC_URL" ALLOW_SIGNUP="$ALLOW_SIGNUP" node apps/web/scripts/prerender.mjs apps/web/dist \
  && node apps/web/scripts/precompress.mjs apps/web/dist

FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
