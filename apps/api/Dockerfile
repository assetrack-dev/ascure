# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.33.2

FROM base AS production-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json
COPY prisma/schema.prisma prisma/schema.prisma

RUN pnpm install --frozen-lockfile --filter @ascure/api... --prod
RUN pnpm --dir apps/api exec prisma generate --schema=../../prisma/schema.prisma

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json
COPY prisma/schema.prisma prisma/schema.prisma

RUN pnpm install --frozen-lockfile --filter @ascure/api...

COPY tsconfig.base.json tsconfig.json ./
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json apps/api/tsconfig.build.json
COPY apps/api/src apps/api/src
COPY packages packages
COPY prisma prisma

RUN pnpm --dir apps/api exec prisma generate --schema=../../prisma/schema.prisma
RUN pnpm --filter @ascure/api build

FROM builder AS migration

ENV NODE_ENV=production

CMD ["pnpm", "--dir", "apps/api", "exec", "prisma", "migrate", "deploy", "--schema=../../prisma/schema.prisma"]

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOADS_DIR=/app/uploads

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/prisma ./prisma

RUN mkdir -p /app/uploads \
  && chown -R node:node /app/uploads

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/v1`).then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/api/dist/main.js"]
