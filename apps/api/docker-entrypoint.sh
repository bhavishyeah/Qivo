#!/bin/sh
set -e

# Print which key env vars the container actually sees (presence only, never
# values) so we can diagnose missing config directly from the deploy log.
echo "[entrypoint] env check: NODE_ENV=$NODE_ENV PORT=$PORT"
echo "[entrypoint] cloudinary present: cloud=$([ -n \"$CLOUDINARY_CLOUD_NAME\" ] && echo yes || echo no) key=$([ -n \"$CLOUDINARY_API_KEY\" ] && echo yes || echo no) secret=$([ -n \"$CLOUDINARY_API_SECRET\" ] && echo yes || echo no)"
echo "[entrypoint] cloudinary value lengths:"
node -e "console.log('  cloud len:', (process.env.CLOUDINARY_CLOUD_NAME||'').length, 'key len:', (process.env.CLOUDINARY_API_KEY||'').length, 'secret len:', (process.env.CLOUDINARY_API_SECRET||'').length)"

echo "[entrypoint] Running prisma migrate deploy..."
if pnpm exec prisma migrate deploy; then
  echo "[entrypoint] Migrations applied (or none pending)."
else
  echo "[entrypoint] WARNING: migrate deploy exited non-zero. Continuing to start server."
fi

echo "[entrypoint] node sees cloudinary:"
node -e "console.log('  node process.env:', !!process.env.CLOUDINARY_CLOUD_NAME, !!process.env.CLOUDINARY_API_KEY, !!process.env.CLOUDINARY_API_SECRET)"
echo "[entrypoint] compiled cloudinary.js marker check:"
grep -q "signUpload missing config at request time" apps/api/dist/services/cloudinary.js && echo "  NEW code present" || echo "  OLD code (stale build)"
echo "[entrypoint] .env files present:"
ls -la /app/.env 2>/dev/null || echo "  no /app/.env"
ls -la /app/apps/api/.env 2>/dev/null || echo "  no /app/apps/api/.env"

echo "[entrypoint] Starting server: node apps/api/dist/server.js"
# Execute node directly — inheriting the full container environment without
# re-expanding shell variables (which can strip masked secrets on some platforms).
exec node apps/api/dist/server.js
