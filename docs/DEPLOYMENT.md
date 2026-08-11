# Deploy to Render

The middleware is a single Node.js (Express) web service + a Postgres DB.
Your DB is already hosted on **Neon**, so Render only needs to run the app.

**Why not the free plan:** Render's free web tier **sleeps after ~15 min idle**
and wakes on the next request. Bitrix24 / WhatsBox / SMS gateways push webhooks
at any time, and a sleeping instance would miss or delay them. Use the paid
**Starter** plan (`render.yaml` already sets `plan: starter`, ~$7/mo).

---

## 1. Push the code to GitHub

Render deploys from a Git repo (GitHub / GitLab).

```bash
git add -A
git commit -m "Add Render deploy config + SMS provider"
git remote add origin https://github.com/YOU/whatsapp-b24-integration.git   # if not added yet
git push -u origin main
```

> `.env` is gitignored — secrets stay on your machine and in Render's env vars.

## 2. Create the service from the Blueprint

1. Log in to https://dashboard.render.com
2. **New → Blueprint** → connect your GitHub account → select this repo.
3. Render reads `render.yaml`, finds the `whatsapp-b24-integration` web service and starts deploying.
4. **Before/while it builds**, open the service **Env** tab and fill the `sync: false` variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon Postgres connection string (same as local `.env`) |
| `WHATSBOX_API_URL` | `https://api.whatsbox.io` |
| `WHATSBOX_API_KEY` | Your WhatsBox API key |
| `WHATSBOX_CHANNEL_ID` | e.g. `9041800275` |
| `WHATSBOX_WEBHOOK_SECRET` | Secret WhatsBox sends on webhooks |
| `WHATSAPP_WEBHOOK_URL` | `https://<your-app>.onrender.com/webhooks/whatsbox` |
| `BITRIX24_WEBHOOK_URL` | `https://<portal>.bitrix24.com/rest/1/<webhook_code>/` |
| `BITRIX24_WEBHOOK_SECRET` | Same as local `.env` |
| `BITRIX24_CLIENT_ID` / `BITRIX24_CLIENT_SECRET` | Your Bitrix24 app OAuth credentials (same as local) |
| `MICROSOFT_*` | Optional — only if you use email password-reset |
| `API_KEYS` | Comma-separated legacy API keys |

`APP_BASE_URL` is left empty on purpose — the app falls back to
`RENDER_EXTERNAL_URL` automatically, so every handler URL (Bitrix24
uninstall, Open Channels, SMS provider, webhooks) points at your Render
domain with zero extra config. Set `APP_BASE_URL` only if you add a custom
domain later.

## 3. Wait for the build

The build runs `npm ci && npm run build:frontend` (compiles the dashboard
SPA into `public/`), then the start command runs
`npx prisma migrate deploy && node src/server.js` (applies DB migrations,
then boots). The service URL is `https://<app-name>.onrender.com`.

Confirm it's healthy: `https://<app-name>.onrender.com/health` →
`{ "success": true, "data": { "status": "ok", ... "database": { "connected": true } } }`

## 4. Point external systems at the new URL

| System | Where | Value |
|---|---|---|
| **Bitrix24 app** | App page → Application URLs | install/uninstall handler URLs → `https://<app>.onrender.com/webhooks/bitrix24` |
| **Bitrix24 portals** | Reinstall the app | So the OAuth/install flow runs against the Render URL (not localhost). Re-installing refreshes the access token on the install row. |
| **WhatsBox / gateway** | Gateway webhook settings | `https://<app>.onrender.com/webhooks/whatsbox` |
| **SMS gateway (MSG91 etc.)** | DLR callback | `https://<app>.onrender.com/webhooks/sms` (set `sms_webhook_secret` if used) |

> Reinstall matters: your local installs were tied to `localhost`, so tokens
> were issued for the local app. Running the same app from Render requires the
> portals to be (re)installed against the Render domain.

## 5. Verify end-to-end

1. Open `https://<app>.onrender.com` → log in with an existing dashboard user
   (same Neon DB, so accounts carry over).
2. Dashboard → **SMS Gateway** → Test Connection → Send Test SMS.
3. Bitrix24: contact → SMS/WhatsApp → **My SMS Gateway** → send; watch
   `Message Logs` in the dashboard go `sent → delivered`.
4. Send a WhatsApp message to the connected number → a lead appears in
   Bitrix24 (proves the WhatsBox webhook path works).
5. Check logs: Render **Logs** tab shows the same structured logger output as
   local (`bitrix24-message-provider`, `job:retry-outgoing`, etc.).

---

## Updating

Push to `main` → Render auto-rebuilds and redeploys. Migrations run again on
start (idempotent).

## Keeping local dev separate

Keep running `npm run dev` locally for testing — but remember the Bitrix24
app's handler URLs are single-valued. Use **one** canonical domain (Render) for
production portals; only test with localhost on throwaway test portals.
