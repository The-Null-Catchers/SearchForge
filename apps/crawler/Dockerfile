FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @searchforge/crawler... build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/indexes && chown node:node /data/indexes
USER node
EXPOSE 4010
CMD ["node", "apps/crawler/dist/index.js"]
