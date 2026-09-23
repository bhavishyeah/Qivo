# Deployment Guide

## Architecture

```
Frontend (Vercel/Cloudflare Pages) → API (Railway) → PostgreSQL (Railway)
```

- **Frontend**: Static files served from CDN (fast globally)
- **API**: Node.js server on Railway
- **Database**: PostgreSQL on Railway (auto-provisioned)

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
