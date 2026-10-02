# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
# Copy both workspace package.json files so pnpm's frozen-lockfile check
# passes — it validates that every workspace member's package.json matches
# what's recorded in pnpm-lock.yaml.
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/api ./apps/api/

# Generate Prisma client
RUN pnpm exec prisma generate

# Cache-bust: bump this value to force a clean TypeScript rebuild (prevents a
# stale cached dist/ from shipping old request-handling code).
ARG BUILD_REV=2026-09-27-2
RUN echo "build rev: $BUILD_REV"

# Build TypeScript. Use the explicit project + outDir so tsc resolves the
# api's tsconfig regardless of pnpm's working dir, then fail the build if the
# entrypoint wasn't emitted (prevents a green-but-broken image).
WORKDIR /app/apps/api
RUN pnpm exec tsc --project tsconfig.json --outDir dist \
  && test -f dist/server.js || (echo "ERROR: dist/server.js not emitted" && ls -R dist && exit 1)

# Stage 2: Production
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
# Carry the web package.json into the runner too so pnpm --frozen-lockfile passes
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist/
COPY --from=builder /app/apps/api/src/generated ./apps/api/src/generated/
COPY apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3000

WORKDIR /app
# Entrypoint runs migrations then unconditionally starts the server, so a
# migrate quirk can never prevent the server from booting.
CMD ["./docker-entrypoint.sh"]
