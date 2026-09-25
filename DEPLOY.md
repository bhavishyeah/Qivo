# Deployment Guide

## Live setup (as deployed)

```
Frontend (Vercel)  →  API (Railway, Docker)  →  PostgreSQL (Supabase)
qivo-web-dusky        qivo-production-587a       aws-0-ap-south-1.pooler
.vercel.app           .up.railway.app            .supabase.com
```

- **Frontend**: Vite SPA on Vercel (static, CDN).
- **API**: Node/Express on Railway, built from `apps/api/Dockerfile`.
- **Database**: Supabase Postgres (pooled URL for the app, direct URL for migrations).

---

## Routine redeploy (the normal flow)

Both services auto-deploy from the `main` branch on push.

```bash
git add .
git commit -m "your change"
git push origin main
```

- **API (Railway)**: rebuilds the Docker image, runs migrations via the
  entrypoint, then starts. Watch Deploy Logs for
  `Qivo API running on 0.0.0.0:<PORT>`.
- **Web (Vercel)**: rebuilds automatically. Note: `VITE_*` values are baked in
  at build time, so a redeploy is required to pick up any env var change.

### Verify after deploy
- `https://qivo-production-587a.up.railway.app/api/health` → `{"success":true,...}`
- `https://qivo-production-587a.up.railway.app/api/db-health` → `{"database":"connected"}`
- Load the Vercel site, log in with DevTools open, confirm the `/api/auth/*`
  request hits Railway and returns 200 with no CORS error.

---

## Adding a database migration

1. Edit `prisma/schema.prisma`.
2. Create the migration locally (needs a DB connection via `DIRECT_URL`):
   ```bash
   pnpm exec prisma migrate dev --name your_change
   ```
3. Commit the generated folder under `prisma/migrations/` together with the
   schema change, then push. The Railway entrypoint runs `prisma migrate deploy`
   on boot, applying it automatically.

Never edit an already-applied migration; add a new one.

---

## Environment variables

**Railway (API service)** — set in the service, not in `.env.example`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **pooled** URL (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase **direct** URL (port 5432) — used by migrations |
| `NODE_ENV` | `production` |
| `WEB_URL` | Vercel URL, no trailing slash. Comma-separate for multiple origins. |
| `SESSION_COOKIE_NAME` | `qivo_session` |
| `SESSION_DAYS` | `30` |
| `RESEND_API_KEY` | Resend key (optional; email skipped if unset) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (optional) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (for file uploads; not secret) |
| `CLOUDINARY_API_KEY` | Cloudinary API key (not secret) |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret — **server-side only, never exposed to the frontend** |
| `PORT` | **leave unset** — Railway injects it (currently 8080) |

**Vercel (web project)** — build-time, keep the `VITE_` prefix (these are public):

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://qivo-production-587a.up.railway.app` |
| `VITE_GOOGLE_CLIENT_ID` | same as `GOOGLE_CLIENT_ID` (optional) |

If the Vercel domain changes, update `WEB_URL` on Railway to match (CORS).
If the Railway domain changes, update `VITE_API_URL` on Vercel and **redeploy**.

---

## Gotchas learned during the first deploy

- **Port must match.** Railway injects `PORT` (8080). The app honors it, and the
  domain's **target port must equal that** (Settings → Networking → 8080).
  A mismatch shows as a `502` with `x-railway-fallback: true`.
- **No custom Start Command in Railway.** Leave it empty so the Dockerfile
  `CMD ["./docker-entrypoint.sh"]` runs. A stale UI Start Command overrides both
  railway.json and the Dockerfile.
- **`prisma generate` at build time** must not require `DIRECT_URL`
  (`prisma.config.ts` reads it lazily via `process.env`).
- **`prisma` CLI is a prod dependency** (root `package.json`) so it survives
  `pnpm install --prod` and can run migrations at runtime.
- **`docker-entrypoint.sh` must stay LF** (enforced by `.gitattributes`) or it
  won't run in the Alpine container.
- **Don't put secrets behind `VITE_`** — that prefix exposes values to the
  browser. `VITE_API_URL` and the Google client ID are public, so they're fine.
- **`.env.example` is committed** — keep placeholders only, never real secrets.

---

## Legacy reference (original plan — Railway Postgres)

The steps below were the initial plan before switching to Supabase + Docker.
Kept for reference.

---

## Step 1: Push to GitHub

```bash
git add .
git commit -m "feat: complete V1"
git push origin main
```

---

## Step 2: Deploy API on Railway

1. Go to https://railway.app → Sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your `Qivo` repository
4. In the service settings:
   - **Root Directory**: leave empty (deploy from repo root)
   - **Builder**: `Dockerfile`
   - **Dockerfile Path**: `apps/api/Dockerfile`
   - No build/start commands needed — the Dockerfile builds with `tsc` and its
     `CMD` runs `prisma migrate deploy` then `node apps/api/dist/server.js`.
     Railway's injected `$PORT` is read automatically by the server.
5. Click **"New"** → **"Database"** → **"Add PostgreSQL"**
6. Railway auto-sets `DATABASE_URL`. Add these **additional variables**:

```
NODE_ENV=production
PORT=3000
WEB_URL=https://qivo.vercel.app          ← (update after Step 3)
SESSION_COOKIE_NAME=qivo_session
SESSION_DAYS=30
DIRECT_URL=${{Postgres.DATABASE_URL}}     ← (Railway variable reference)
```

7. Click **Deploy**. Note the generated URL (e.g. `https://qivo-api-production.up.railway.app`)

---

> **Note:** `apps/api/railway.json` and `apps/web/railway.json` pin the builder,
> Dockerfile path, start command, healthcheck, and restart policy. When you set a
> service's Root Directory to `apps/api` (or `apps/web`), Railway auto-detects
> that service's `railway.json`, so most settings above are applied for you.

---

## Step 3: Deploy Frontend

You can host the frontend on Railway (Docker) or on Vercel/Cloudflare Pages.

### Option A — Railway (Docker)

1. In the same Railway project, click **"New"** → **"GitHub Repo"** → same repo
2. Service settings:
   - **Root Directory**: `apps/web` (Railway picks up `apps/web/railway.json`)
   - **Builder**: `Dockerfile`, path `apps/web/Dockerfile`
3. Add a **build-time variable** (not a runtime var — Vite inlines it at build):
   ```
   VITE_API_URL=https://qivo-api-production.up.railway.app
   ```
   In Railway, mark it as available at build time so the Docker `ARG` receives it.
4. Deploy. nginx listens on Railway's injected `$PORT` automatically.

### Option B — Vercel

1. Go to https://vercel.com → Sign in with GitHub
2. Click **"Add New Project"** → Select your `Qivo` repository
3. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `apps/web`
   - **Build Command**: `pnpm exec vite build` (or leave default)
   - **Output Directory**: `dist`
4. Add **Environment Variable**:
   ```
   VITE_API_URL=https://qivo-api-production.up.railway.app
   ```
   (use the Railway URL from Step 2)
5. Click **Deploy**

6. Note your frontend URL (e.g. `https://qivo.vercel.app`)
7. Go back to Railway → Update the API's `WEB_URL` to this Vercel URL

---

## Step 4: Verify

1. Visit your Vercel URL → you should see the landing page
2. Click "Sign up" → create an account
3. Create a form → add questions → publish → share via QR

---

## Custom Domain (Optional)

- **Vercel**: Settings → Domains → Add your domain
- **Railway**: Settings → Domains → Add custom domain
- Update `WEB_URL` env var on Railway to match

---

## Environment Variables Reference

### API (Railway)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Auto-set by Railway PostgreSQL |
| `DIRECT_URL` | Yes | Same as DATABASE_URL (for migrations) |
| `NODE_ENV` | Yes | `production` |
| `PORT` | Yes | `3000` (Railway sets this automatically) |
| `WEB_URL` | Yes | Your frontend URL |
| `SESSION_COOKIE_NAME` | Yes | `qivo_session` |
| `SESSION_DAYS` | No | Default: `30` |
| `RESEND_API_KEY` | No | For sending emails (optional for testing) |
| `EMAIL_FROM` | No | Sender address |

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Your Railway API URL |

---

## Troubleshooting

**"Cannot connect to database"**
- Check that `DATABASE_URL` and `DIRECT_URL` are set in Railway variables
- The PostgreSQL service must be in the same Railway project

**"CORS error in browser"**
- Ensure `WEB_URL` on Railway matches your exact Vercel URL (including https://)

**"Session cookie not working"**
- Both frontend and API must be on HTTPS
- Cookie `secure: true` only works over HTTPS (handled automatically in production)

**"Build fails on Railway"**
- Check that the build command includes `pnpm install` first
- Ensure prisma schema is accessible from the repo root
