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

echo "[entrypoint] node sees cloudinary:"
node -e "console.log('  node process.env:', !!process.env.CLOUDINARY_CLOUD_NAME, !!process.env.CLOUDINARY_API_KEY, !!process.env.CLOUDINARY_API_SECRET)"
echo "[entrypoint] compiled cloudinary.js marker check:"
grep -q "signUpload missing config at request time" apps/api/dist/services/cloudinary.js && echo "  NEW code present" || echo "  OLD code (stale build)"
echo "[entrypoint] .env files present:"
ls -la /app/.env 2>/dev/null || echo "  no /app/.env"
ls -la /app/apps/api/.env 2>/dev/null || echo "  no /app/apps/api/.env"

echo "[entrypoint] Starting server: node apps/api/dist/server.js"
# Use 'env' to explicitly forward all current environment variables to the
# Node process. Without this, some platforms drop vars between the shell
# entrypoint and the exec'd process.
exec env \
  CLOUDINARY_CLOUD_NAME="$CLOUDINARY_CLOUD_NAME" \
  CLOUDINARY_API_KEY="$CLOUDINARY_API_KEY" \
  CLOUDINARY_API_SECRET="$CLOUDINARY_API_SECRET" \
  NODE_ENV="$NODE_ENV" \
  PORT="$PORT" \
  DATABASE_URL="$DATABASE_URL" \
  DIRECT_URL="$DIRECT_URL" \
  WEB_URL="$WEB_URL" \
  SESSION_COOKIE_NAME="$SESSION_COOKIE_NAME" \
  SESSION_DAYS="$SESSION_DAYS" \
  RESEND_API_KEY="$RESEND_API_KEY" \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  node apps/api/dist/server.js
