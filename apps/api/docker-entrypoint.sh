#!/bin/sh
set -e

# Print which key env vars the container actually sees (presence only, never
# values) so we can diagnose missing config directly from the deploy log.
echo "[entrypoint] env check: NODE_ENV=$NODE_ENV PORT=$PORT"
echo "[entrypoint] cloudinary present: cloud=$([ -n \"$CLOUDINARY_CLOUD_NAME\" ] && echo yes || echo no) key=$([ -n \"$CLOUDINARY_API_KEY\" ] && echo yes || echo no) secret=$([ -n \"$CLOUDINARY_API_SECRET\" ] && echo yes || echo no)"

echo "[entrypoint] Running prisma migrate deploy..."
if pnpm exec prisma migrate deploy; then
  echo "[entrypoint] Migrations applied (or none pending)."
else
  echo "[entrypoint] WARNING: migrate deploy exited non-zero. Continuing to start server."
fi

echo "[entrypoint] Starting server: node apps/api/dist/server.js"
exec node apps/api/dist/server.js
