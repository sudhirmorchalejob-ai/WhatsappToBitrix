# Bitrix24 Setup & Marketplace Guide

End-to-end guide for wiring the middleware into Bitrix24 as a **Marketplace app**:
left-sidebar access (DEFAULT placement), the Open Channels (Contact Center)
connector, and marketing campaigns launched from inside Bitrix24.

---

## 1. Prerequisites & environment

Create your `.env` from `.env.example` and make sure these are set:

| Variable | Example | Purpose |
|---|---|---|
| `APP_BASE_URL` | `https://wa-b24.example.com` | Public URL of this middleware. Every Bitrix24 handler URL is derived from it. |
| `BITRIX24_CLIENT_ID` | `local.xxx.abc123` | Bitrix24 app client id. |
| `BITRIX24_CLIENT_SECRET` | `secret` | Bitrix24 app client secret. |
| `BITRIX24_CONNECTOR_ID` | `wa_whatsapp` | Connector id registered in Contact Center (lowercase, underscores, no dots). |
| `BITRIX24_OPENLINE_ID` | `0` | Set to an open line id to auto-activate on install; `0` requires manual activation from the Contact Center. |
| `ENABLE_OPENLINES_CONNECTOR` | `true` | **Feature flag. Off by default — set it to `true` or the connector module refuses to run.** |
| `DATABASE_URL` | `postgresql://…` | PostgreSQL connection string. |

Then:

```bash
npm install
npx prisma migrate deploy      # apply the campaign_recipients migration
npx prisma generate
npm run build:frontend
npm start                       # serves the SPA + API on PORT (default 9191)
```

---

## 2. Create the Bitrix24 app

Two options — both work; the Marketplace path additionally gives you
**discoverability** (see step 5).

### Option A — Local app (fastest for testing)

1. In Bitrix24, go to **Applications → Developer resources** (or open
   `https://<portal>/local/dev/`).
2. Choose **Local application**, `add` a new one:

| Field | Value |
|---|---|
| Application type | Server |
| Install handler URL | `https://wa-b24.example.com/api/connector/install` |
| Handler URL | `https://wa-b24.example.com/api/connector/install` (same) |
| Uninstall handler URL | `https://wa-b24.example.com/webhooks/bitrix24` |
| Scope | `imopenlines, crm, im, user, placement, messageservice` |
| Placement | Add placement: **`DEFAULT`** with handler `https://wa-b24.example.com/api/connector/app` |

3. Copy the **client id** and **secret** into `.env`
   (`BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET`).
4. Restart the middleware.

> The **`imopenlines` scope is mandatory** for the Open Channels connector.
> Without it, `imconnector.*` calls fail with `ERROR_METHOD_NOT_FOUND` and
> `imconnector.send.messages` fails with `WRONG_AUTH_TYPE / Application context
> required`.

> The **`messageservice` scope is required for the SMS provider** (Phase 8).
> It lets the app register a message provider via `messageservice.sender.add`
> and update delivery statuses via `messageservice.message.status.update`.
> These methods only work inside an installed application (OAuth) context —
> an incoming webhook is not sufficient.

### Option B — Marketplace app (for discoverability)

1. Join the Bitrix24 **Partner program** and add a new **application** in the
   [partner area](https://partners.bitrix24.com/).
2. Use the same handler URLs and scopes as above.
3. Fill in the public listing data (name, description, category, icon,
   screenshots) and submit for moderation.
4. Once approved, the app is **listed in the Bitrix24 Marketplace** under its
   category, discoverable by search, and installable by any portal.

---

## 3. Install / re-install the app on the portal

> **After changing scopes you MUST re-install the app** — Bitrix24 only grants
> the scopes that were present at install time.

1. Open **Applications → Marketplace → (your app)** (or the local app in
   Developer resources) and click **Install / Re-install**.
2. Bitrix24 redirects to
   `https://wa-b24.example.com/api/connector/install` — the middleware
   exchanges the OAuth token, stores the install row in `bitrix24_installs`,
   registers the connector tile, binds the Open Channels events
   (`ONIMCONNECTORMESSAGEADD`, `ONIMCONNECTORMESSAGEUPDATE`), registers the
   **SMS message provider** (`messageservice.sender.add`, code
   `wa_b24_sms_<member_id>`) and, if `BITRIX24_OPENLINE_ID` is set, activates
   the connector on that line.
3. You should see the **“✓ WhatsApp Connector Installed”** page.

Verify the granted scopes were stored:

```bash
node inspect-db.js                 # or inspect the bitrix24_installs table
```

Confirm the `scope` column contains `imopenlines`. If it does not, re-install
again (the scope string is only captured from a fresh install).

---

## 4. Activate the connector on an Open Line

If you left `BITRIX24_OPENLINE_ID=0` (recommended), activate manually:

1. In Bitrix24 go to **Contact Center** (left menu).
2. You will see the **“WhatsApp”** tile (registered automatically on install).
3. Click the tile → **Connect** → choose the **Open Line** that should carry
   WhatsApp chats.
4. The middleware stores the mapping (`connector_line_mappings`) and
   `lineId` on the install row. From now on incoming WhatsApp messages are
   forwarded to that line’s chat, and operator replies are sent back to
   WhatsApp.

The connector is **auto-reactivated** (`imconnector.activate` +
`imconnector.connector.data.set`) when a send attempt hits `NOT_ACTIVE_LINE`.

---

## 5. Left-sidebar access (LEFT_MENU placement)

On install, `provision()` calls `placement.bind` with the `LEFT_MENU` placement
whose handler is `https://wa-b24.example.com/api/connector/app`. (`DEFAULT` is
only the app's own main page; the left sidebar uses the `LEFT_MENU` placement
code.)

- A **“WhatsApp Integration”** item appears in the Bitrix24 left navigation.
- Clicking it opens the handler in an iframe; the middleware auto-authenticates
  the user (persists the portal tokens, ensures a local user, signs a JWT) and
  redirects into the SPA — no manual login inside Bitrix24.

If the placement is missing (e.g. the app was installed before the placement
was registered), re-install the app, or call:

```
POST https://<portal>/rest/placement.bind
    PLACEMENT=LEFT_MENU
    HANDLER=https://wa-b24.example.com/api/connector/app
    TITLE=WhatsApp Integration
```

---

## 6. Run marketing campaigns from Bitrix24

The sidebar SPA includes a **Campaigns** view backed by the REST API at
`/api/campaigns` (create / list / detail / update / delete / execute).

1. Open the app from the left sidebar → **Campaigns**.
2. **New Campaign** → name, type (text or media + caption), message body/media
   URL, and recipient phone numbers (comma/newline separated).
3. Click **Send** to launch. The middleware sends each recipient through the
   WhatsApp provider, tracks per-recipient status, and reports campaign totals
   (queued / sent / failed, and overall status: `DRAFT`, `PROCESSING`,
   `COMPLETED`, `PARTIAL`, `FAILED`).

---

## 7. Send SMS via the message provider (SMS Service)

On install the app registers a message provider named **“My SMS Gateway”**
(`messageservice.sender.add`, `TYPE=SMS`). Once registered it is available
in every Bitrix24 sending scenario — CRM card **SMS/WhatsApp**, CRM
Automation **Send SMS** rules, Workflows, and the Marketing tool.

The handler URL is derived from `APP_BASE_URL`:
`https://wa-b24.example.com/api/bitrix24/sms`. When a message is sent,
Bitrix24 POSTs the message data to this handler; the middleware forwards it
through the configured SMS gateway and reports the delivery status back with
`messageservice.message.status.update`.

1. Configure SMS gateway credentials (env defaults or per-tenant Settings):
   `SMS_PROVIDER`, `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`,
   `SMS_ROUTE`, `SMS_TEMPLATE_ID`, `SMS_WEBHOOK_SECRET`. See
   `docs/BITRIX24_SMS_PROVIDER.md`.
2. In Bitrix24, open a CRM contact with a phone number → **SMS/WhatsApp** →
   pick **My SMS Gateway** → send.
3. The middleware stores the message (`provider=SMS`), sends it to the
   recipient and updates the delivery status in Bitrix24 as the SMS gateway
   reports `sent` / `delivered` / `undelivered` / `failed`.

> SMS availability in the **Marketing tool** (segment broadcasts) depends on
> the Bitrix24 plan/region and can be restricted by Bitrix24 itself — the
> provider is registered for all scenarios, but visible entry points vary by
> portal configuration.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `imconnector.send.messages` → `WRONG_AUTH_TYPE "Application context required"` | Called with a webhook (login) token instead of app (OAuth) token | Uses `callAsApp` — ensure `BITRIX24_CLIENT_ID`/`SECRET` are set and the app is installed. |
| `imconnector.*` → `ERROR_METHOD_NOT_FOUND "Method not found!"` | `imopenlines` scope missing | Add `imopenlines` to app scope, then **re-install** the app. |
| `messageservice.*` → `ACCESS_DENIED "Application context required"` | Called with a webhook (login) token instead of the app OAuth token | Uses `callAsApp` — ensure the app is installed and `BITRIX24_CLIENT_ID`/`SECRET` are set. |
| `messageservice.*` → `ACCESS_DENIED "Access denied!"` | `messageservice` scope not granted at install time | Add `messageservice` to app scope, then **re-install** the app. |
| SMS provider missing from CRM SMS/WhatsApp menu | Provider not registered, or wrong portal | Re-install the app; check the install log for `messageservice.sender.add`; verify `APP_BASE_URL` is publicly reachable. |
| `NOT_ACTIVE_LINE` | Connector not active on the chosen line | Activate from **Contact Center → WhatsApp tile**, or set `BITRIX24_OPENLINE_ID` and re-install. |
| “Open Lines Connector module is currently disabled” | `ENABLE_OPENLINES_CONNECTOR` unset/false | Set `ENABLE_OPENLINES_CONNECTOR=true`, restart. |
| Message appears but no chat in Contact Center | Connector data (`chat.id`) not set for the line | Re-activate the line; the middleware calls `imconnector.connector.data.set`. |
| No sidebar item | Placement not bound | Re-install app, or run `placement.bind` manually (step 5). |
| App not in Marketplace search | Listing not published / moderation pending | Submit the listing in the partner area and get it approved (step 2B). |

---

## 9. Relevant endpoints (summary)

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/connector/install` | App install / re-install OAuth handler. |
| `GET/POST /api/connector/app` | LEFT_MENU placement iframe handler (auto-login to SPA). |
| `POST /webhooks/bitrix24` | Open Channels event handler (operator replies). |
| `POST /webhooks/whatsbox` | Incoming WhatsApp webhook. |
| `POST /api/bitrix24/sms` | Bitrix24 Message Service handler (SMS provider callback). |
| `POST /webhooks/sms` | SMS gateway delivery-status webhook. |
| `GET/PUT /api/sms/config`, `POST /api/sms/test` | SMS gateway configuration + connection test (dashboard). |
| `/api/campaigns` | Campaign REST API (CRUD + `POST /:id/execute`). |
