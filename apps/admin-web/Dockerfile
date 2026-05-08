# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json

RUN pnpm install --frozen-lockfile --filter @ascure/admin-web...

COPY tsconfig.base.json tsconfig.json ./
COPY apps/admin-web apps/admin-web
COPY packages packages

ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN mkdir -p apps/admin-web/public
RUN pnpm --filter @ascure/admin-web build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=node:node /app/apps/admin-web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/admin-web/.next/static ./apps/admin-web/.next/static
COPY --from=builder --chown=node:node /app/apps/admin-web/public ./apps/admin-web/public

USER node

WORKDIR /app/apps/admin-web

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3001}/`).then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
