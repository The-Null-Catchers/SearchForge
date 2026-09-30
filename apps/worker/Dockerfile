FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/search-core/package.json packages/search-core/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
COPY apps/worker apps/worker
COPY packages packages
RUN pnpm --filter @searchforge/worker build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4020
CMD ["pnpm", "--filter", "@searchforge/worker", "start"]
