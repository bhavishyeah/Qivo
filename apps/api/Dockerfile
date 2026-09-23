# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/api ./apps/api/

# Generate Prisma client
RUN pnpm exec prisma generate

# Build TypeScript
WORKDIR /app/apps/api
RUN pnpm exec tsc --outDir dist

# Stage 2: Production
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist/
COPY --from=builder /app/apps/api/src/generated ./apps/api/src/generated/

ENV NODE_ENV=production

EXPOSE 3000

WORKDIR /app
# Run migrations against the DB, then start the server.
# Railway injects PORT at runtime; the app reads it from env.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node apps/api/dist/server.js"]
