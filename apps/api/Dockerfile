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
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
# Build (what `pnpm --filter api build` does, minus the type check that CI already ran: same output,
# about half the time; --isolatedModules too, or tsc still checks every file to elide imports),
# copy the production dependencies into /out, drop the ones only linked as optional peers, and
# check that the app still loads.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm --filter api exec tsc -p tsconfig.json --noCheck --isolatedModules \
  && cp -r apps/api/src/migrations apps/api/dist/ \
  && pnpm --filter api deploy --prod --legacy /out \
  && node apps/api/scripts/prune-optional-peers.mjs /out \
  && cd /out && node -e "import('./dist/app.js').then(() => process.exit(0))"

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.js"]
