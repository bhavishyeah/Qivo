#!/bin/sh
set -e

echo "[entrypoint] Running prisma migrate deploy..."
if pnpm exec prisma migrate deploy; then
  echo "[entrypoint] Migrations applied (or none pending)."
else
  echo "[entrypoint] WARNING: migrate deploy exited non-zero. Continuing to start server."
fi

echo "[entrypoint] Starting server: node apps/api/dist/server.js"
exec node apps/api/dist/server.js
