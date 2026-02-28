# Deploy OpenPlaud on Railway + Cloudflare R2

This guide walks you through deploying OpenPlaud on [Railway](https://railway.app) with [Cloudflare R2](https://developers.cloudflare.com/r2/) for audio storage.

## Architecture

| Component      | Service              | Notes                                     |
|----------------|----------------------|-------------------------------------------|
| App hosting    | Railway              | Next.js via Dockerfile                    |
| Database       | Railway PostgreSQL   | Managed, auto-provisioned                 |
| Audio storage  | Cloudflare R2        | S3-compatible, generous free tier         |
| Transcription  | Groq / OpenAI       | Configured via OpenPlaud UI               |

## Prerequisites

- A [Railway](https://railway.app) account
- A [Cloudflare](https://dash.cloudflare.com) account (for R2 storage)
- A [Groq](https://console.groq.com) or [OpenAI](https://platform.openai.com) API key
- This repository forked to your GitHub account

## Step 1: Create Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **Deploy from GitHub repo**
3. Select your fork of OpenPlaud
4. Railway will detect the `Dockerfile` automatically

## Step 2: Add PostgreSQL

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway provisions the database and creates a `DATABASE_URL` variable on the database service
3. You'll reference this in the app's environment variables (see Step 4)

## Step 3: Set Up Cloudflare R2

### Create a Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2 Object Storage**
2. Click **Create bucket**
3. Name: `openplaud`
4. Location: `Automatic` (or `Europe (WEUR)` for EU)

### Create API Tokens

1. Go to **R2** → **Manage R2 API Tokens**
2. Click **Create API token**
3. Permissions: **Object Read & Write**
4. Specify bucket: `openplaud`
5. Click **Create API Token**
6. Save the **Access Key ID** and **Secret Access Key** — you'll need them in Step 4

### Note Your Account ID

Your Cloudflare Account ID is visible in the dashboard URL or on the R2 overview page.
The R2 endpoint URL is: `https://<account-id>.r2.cloudflarestorage.com`

## Step 4: Configure Environment Variables

In your Railway project, click on the **app service** → **Variables** tab, and add:

```env
# === Required Secrets ===
# Generate both with: openssl rand -hex 32
BETTER_AUTH_SECRET=<your-generated-secret>
ENCRYPTION_KEY=<your-generated-key>

# === Database ===
# Reference the Railway PostgreSQL service variable:
DATABASE_URL=${{Postgres.DATABASE_URL}}

# === App URL ===
# Use your Railway-provided domain or a custom domain
APP_URL=https://<your-app>.up.railway.app

# === Storage ===
DEFAULT_STORAGE_TYPE=s3
S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
S3_BUCKET=openplaud
S3_REGION=auto
S3_ACCESS_KEY_ID=<your-r2-access-key>
S3_SECRET_ACCESS_KEY=<your-r2-secret-key>
```

> **Tip:** Generate secrets locally with `openssl rand -hex 32`.

## Step 5: Deploy

1. Push any changes to your fork — Railway deploys automatically
2. Or click **Deploy** in the Railway dashboard to trigger a manual deploy
3. Railway builds the Docker image and starts the container
4. Database migrations run automatically on startup via `docker-entrypoint.sh`

### Verify the Deploy

- Check the **Deploy Logs** in Railway for migration output and startup messages
- Visit `https://<your-app>.up.railway.app/api/health` — should return `{"status":"ok"}`

## Step 6: Initial App Setup

1. Open your Railway app URL in a browser
2. **Create an account** via the onboarding wizard
3. **Configure AI provider** in Settings:

### Option A: Groq (free tier available)

| Setting              | Value                                |
|----------------------|--------------------------------------|
| Base URL             | `https://api.groq.com/openai/v1`    |
| API Key              | Your Groq API key                    |
| Transcription model  | `whisper-large-v3`                   |
| Chat model           | `llama-3.1-70b-versatile`           |

### Option B: OpenAI

| Setting              | Value                      |
|----------------------|----------------------------|
| Base URL             | *(leave empty)*            |
| API Key              | Your OpenAI API key        |
| Transcription model  | `whisper-1`                |
| Chat model           | `gpt-4o`                  |

## Step 7: Connect Your Plaud Device

1. Go to [web.plaud.ai](https://web.plaud.ai) and log in
2. Open browser DevTools (F12) → **Network** tab
3. Refresh the page
4. Find a request to `api.plaud.ai` (or `api-euc1.plaud.ai` for EU)
5. Copy the full `Authorization` header value (starts with `Bearer `)
6. In OpenPlaud Settings → **Plaud Connection**, paste the bearer token
7. Select the correct API server region (Global or EU)
8. Set a sync interval (e.g., every 15 or 30 minutes)

## Step 8: Verify Everything Works

1. Make a test recording with your Plaud device
2. Sync it to Plaud Cloud (via the Plaud app or wait for auto-sync)
3. Wait for OpenPlaud to pick up the recording (based on your sync interval)
4. Verify:
   - Audio file is stored in Cloudflare R2
   - Transcription is generated via Groq/OpenAI
   - Transcription is visible in the OpenPlaud web UI

## Custom Domain (Optional)

1. In Railway, go to your app service → **Settings** → **Networking**
2. Click **Generate Domain** for a `*.up.railway.app` subdomain, or
3. Click **Custom Domain** and enter your domain (e.g., `openplaud.yourdomain.com`)
4. Add the CNAME record to your DNS provider as instructed
5. Update `APP_URL` in Railway environment variables to match

## Troubleshooting

### App won't start

- Check deploy logs for missing environment variables
- Ensure `DATABASE_URL` references the PostgreSQL service correctly
- Verify `BETTER_AUTH_SECRET` is at least 32 characters
- Verify `ENCRYPTION_KEY` is exactly 64 hex characters

### Authentication issues (CSRF errors)

- Ensure `APP_URL` matches your actual public URL (including `https://`)
- The app includes `trustedOrigins` derived from `APP_URL` for proxy compatibility

### Storage not working

- Verify your R2 API token has **Object Read & Write** permissions
- Check that `S3_ENDPOINT` includes your Cloudflare Account ID
- Ensure `S3_REGION` is set to `auto` for R2

### Database migration errors

- Check Railway logs for migration output
- The migration script uses advisory locks and retries, so it handles concurrent deploys safely
- If stuck, you can manually reset via Railway's PostgreSQL plugin shell

## Cost Estimate

| Service             | Free Tier                    | Paid                         |
|---------------------|------------------------------|------------------------------|
| Railway (app)       | $5/month trial credit        | ~$5-10/month for light usage |
| Railway (PostgreSQL)| Included in project          | Usage-based                  |
| Cloudflare R2       | 10 GB storage, 10M reads/mo  | $0.015/GB/month beyond free  |
| Groq                | Free tier available           | Usage-based                  |
| OpenAI              | No free tier                  | ~$0.006/minute of audio      |
