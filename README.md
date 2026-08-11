# 💬 WhatsApp → Bitrix24 Lead Integration & 2-Way Dashboard

A multi-tenant production integration platform between **WhatsApp (WhatsBox / Meta Cloud API Gateway)** and **Bitrix24 CRM**.

It turns every incoming WhatsApp message into a deduplicated **Contact + Company + Lead** in Bitrix24, gives operators a full **2-way messaging channel inside Bitrix24 (Open Channels / Contact Center)**, and layers on auto-replies, reply templates, WhatsApp campaigns, operator routing, contact sync, message retries, audit logs, and a **React SPA dashboard** for tenants.

---

## 🚀 Key Features

| # | Feature | What it does |
|---|---|---|
| 1 | **Automatic Lead Creation** | Incoming WhatsApp messages auto-resolve a contact, find-or-create the related Bitrix24 **Company**, and create or reuse an **open Lead** in Bitrix24 CRM. |
| 2 | **Contact & Company Deduplication** | Contacts are deduped via `crm.duplicate.findbycomm` (phone) + normalized-number matching; companies via phone duplicate search with an exact-`TITLE` fallback — no duplicates are created on repeat messages. |
| 3 | **2-Way Operator Messaging** | Replies typed by operators in Bitrix24 are delivered back to the customer's WhatsApp (text + media/document). |
| 4 | **Auto-Replies** | Configurable instant reply body (text or a reply template) to customers; `ONCE_PER_CONTACT`, `SKIP_ASSIGNED` flags and per-tenant enablement. |
| 5 | **Reply Templates** | Canned replies with `{{var}}` interpolation and one default template per tenant. |
| 6 | **WhatsApp Campaigns** | Send text/media campaigns to a manual recipient list or a **segment** (customer lists, leads, deals); mirror campaign leads back into Bitrix24 via `ONCRMLEADADD`. |
| 7 | **Segment Catalog** | ~14 built-in segments (all clients/leads, active deals, won/lost deals, birthdays in 5 days, marketing-centre seasonal lists, …). |
| 8 | **Operator Routing** | Auto-assign incoming chats to the least-loaded or longest-waiting operator; supervisor exclusion + per-agent caps. |
| 9 | **Contact Sync & Resync** | Pull Bitrix24 contacts + leads into local DB (`syncNow` / auto-sync), and a background job pushes locally-created contacts back up to Bitrix24. |
| 10 | **Outbound Message Retry** | Background job retries PENDING/FAILED outgoing messages (provider-aware for WhatsBox & Meta) with a max-attempt budget. |
| 11 | **Bitrix24 App Lifecycle** | Marketplace/local app install (`ONAPPINSTALL`), uninstall hook, OAuth token exchange/refresh, per-portal open-line activation. |
| 12 | **Open Channels Connector** | Registers an `imconnector` connector (`wa_whatsapp`), sends operator messages through the Contact Center. |
| 13 | **Audit & Message Logs** | Live activity log (lead created, reply sent, contacts synced, auth events) + full webhook/message logs with a retry button for failures. |
| 14 | **Multi-Tenant** | Tenants with isolated settings, per-tenant WhatsApp channel/webhook, config wizard with live connection test + one-click auto-sync. |
| 15 | **React SPA Dashboard** | Vite + React 19 dark-glassmorphism dashboard: KPI stats, leads, live chat, webhook setup, auto-replies, campaigns, activity/message logs. |
| 16 | **Security** | JWT auth + roles, API keys, tenant context isolation, webhook HMAC/signature verification, rate limiting, helmet/CORS, masked secret settings, password reset via MS Graph email. |

---

## 🏗️ Architecture

```text
  Customer
     │  WhatsApp message
     ▼
┌────────────────────────────┐        ┌──────────────────────────────────────┐
│   WhatsApp Gateway         │  POST  │   this middleware (Express)          │
│   (WhatsBox / Meta Cloud   ├───────►│   POST /webhooks/whatsbox|meta       │
│    API / Meta Graph)       │        │                                      │
└────────────────────────────┘        │   - signature/HMAC verification      │
                                      │   - rate limiting                    │
                                      │   - persist Message (INCOMING)       │
                                      │   - ensureContact (dedupe)           │
                                      │   - ensureConversation               │
                                      │   - ensureOpenLead (+ Company)       │
                                      │   - auto-reply                       │
                                      │   - routing / assignment             │
                                      └───────────────┬──────────────────────┘
                                                      │ Bitrix24 REST API
                                                      ▼
                              ┌──────────────────────────────────────┐
                              │   Bitrix24 CRM                       │
                              │   - Contacts  - Companies  - Leads   │
                              │   - Open Channels / Contact Center   │
                              │   - Deal/Lead campaign mirror        │
                              └──────────────────────▲───────────────┘
                                                     │  operator reply
                                                     │  (webhook)
                                                     │
                              ┌──────────────────────┴───────────────┐
                              │  POST /webhooks/bitrix24             │
                              │  ONIMCONNECTORMESSAGEADD/UPDATE      │
                              │  → persist OUTGOING message          │
                              │  → send via WhatsBox / Meta          │
                              └──────────────────────────────────────┘
```

- **Inbound (WhatsApp → Bitrix24):** gateway webhook → normalize → dedupe contact → reuse/create conversation → find-or-create Company → reuse/create open Lead → reply/assign.
- **Outbound (Bitrix24 → WhatsApp):** operator message in Bitrix24 → `ONIMCONNECTORMESSAGEADD` → persisted → delivered through the WhatsApp provider; failures go to the retry job.
- **Persistence:** all messages, conversations, contacts, campaigns, logs are stored in **PostgreSQL via Prisma** so the dashboard and audit trails always reflect reality.

---

## 🧩 Full Feature / Functionality Catalog

### Inbound pipeline (`/webhooks/whatsbox`, `/webhooks/meta`)
- Flat (WhatsBox) and Meta `entry→changes→value` payload normalization into one internal event envelope.
- Persist incoming message → dedupe contact by phone (Bitrix24 `duplicate.findbycomm` + normalized local match) → create/reuse conversation (updating provider + `phoneNumberId`) → **find-or-create Company** → **find-or-reuse open Lead** (open-only, newest-first) → reopen closed chats.
- **Company linking is best-effort & non-fatal**: any company failure is logged and the lead still returns — WhatsApp flow never breaks.
- Auto-reply firing + operator auto-assignment.

### Bitrix24 CRM integration
- Inbound REST webhook client (`crm.contact.*`, `crm.company.*`, `crm.lead.*`, `crm.deal.*`, `crm.duplicate.findbycomm`).
- Contact/Company/Lead create with sensible defaults (assigned by ID, comments, `COMPANY_ID` linking).
- Full **Bitrix24 app (marketplace) OAuth**: install/uninstall webhooks, token refresh, `APP_BASE_URL`-based uninstall URL.
- **Open Channels connector**: `imconnector.register`, `imconnector.send.messages`, event binding, per-portal open line id, icon + welcome message; activation from the Contact Center placement page (`GET /app/connector`).
- Operator messages via `ONIMCONNECTORMESSAGEADD/UPDATE`; lead mirror via `ONCRMLEADADD` (campaign leads).
- Campaign source tracking with `CAMPAIGN_B24_SOURCE_ID` (`WHATSAPP_CAMPAIGN`) and `CAMPAIGN_B24_LEAD_PREFIX` titles.

### Outbound messaging
- Provider abstraction: **WhatsBox** (`sendText`/`sendMedia`, `MEDIUM=WHATSAPP_B24_INTEGRATION`) and **Meta Cloud API** (`sendText`, `sendMedia` link/media-id, `sendTemplate`, `sendLocation`).
- Persist-first pattern: message row created before sending; status moved `PENDING → SENT/FAILED`; provider message id backfilled.
- Retry job (`RetryOutgoingMessagesJob`): picks up stuck PENDING/FAILED messages within budget (`OUTGOING_MAX_RETRIES`), provider-aware (includes DOCUMENT/PDF handling), manual kick from admin diagnostics.
- Type mapping for both providers incl. text, image, audio, video, document/PDF, location, templates.

### Auto-replies
- Per-tenant settings: `AUTO_REPLY_ENABLED`, `AUTO_REPLY_BODY`, `AUTO_REPLY_TEMPLATE_ID`, `AUTO_REPLY_ONCE_PER_CONTACT`, `AUTO_REPLY_SKIP_ASSIGNED`.
- Body resolution: direct body → template render → default template; never throws (errors logged, no reply sent).
- Every auto-reply event recorded to `auto_reply_logs`.

### Reply templates
- CRUD + one `isDefault` template per tenant; `{{var}}` placeholders rendered per conversation; used by auto-reply and manual sends.

### Campaigns & segments
- Campaign types: `TEXT` / `MEDIA`; recipients from a manual list (phone/name) or a `segmentId`/`segmentName`.
- Statuses: `DRAFT → PROCESSING → COMPLETED | PARTIAL | FAILED`; recipient-level statuses tracked.
- Segment catalog (`CAMPAIGN_SEGMENTS`, JSON per tenant):
  - `all_clients_and_leads`, `all_clients`, `all_leads`
  - `active_deals_in_progress`, `clients_with_lost_deals`, `clients_with_won_deals`
  - `contacts_birthday_in_5_days`, `marketing_centre_new_clients`, seasonal lists, etc.
- Segments resolved live via `crm.contact.list` / `crm.lead.list` / `crm.deal.list`; resolved campaign leads mirrored back to Bitrix24.

### Contacts sync
- `SyncService`: pulls Bitrix24 contacts + leads into local `Contact` rows; matches by Bitrix24 id first, then normalized phone; skips no-phone rows; limits (200 contacts / 5 pages) with `CONTACT_SELECT`/`LEAD_SELECT` fields.
- `ResyncContactsJob`: pushes locally-created contacts (`PENDING`/`FAILED` sync status) up to Bitrix24 — search-first, then create; batch limit 50.

### Operator routing
- `ROUTING_STRATEGY`: `least-loaded` (fewest open chats) or `round-robin` (longest-waiting).
- `ROUTING_MAX_ACTIVE_PER_AGENT` cap; `ROUTING_EXCLUDE_SUPERVISORS`; returning customers reuse their previous agent; supervisors can still take over via assign/unassign.

### Dashboard & observability
- KPI stats (contacts, conversations, messages, open chats, linked leads via `meta.bitrix24LeadId`), trends, activities, history.
- Admin **diagnostics** (`/api/admin/diagnostics`): DB health/latency, provider config status, contact/conversation/message/agent counts, pending-outgoing queue, retry config; **manual retry sweep** trigger.
- Webhook logs (`WebhookLog`) with per-source counts; failed messages retryable from the UI.
- Structured winston logging to `src/logs/{combined,error}.log` with per-service child loggers.

### Auth, tenants & security
- Login / forgot-password / reset-password (MS Graph **client-credentials** mail via `MsGraphEmailService`, SHA-256 hashed single-use 1-hour tokens, `FRONTEND_URL`).
- Roles: `ADMIN`, `SUPER_ADMIN`, `TENANT_ADMIN`, `USER`.
- Auth: JWT Bearer / `x-auth-token`; legacy `x-api-key` header + `?api_key` query (comma-separated `API_KEYS`).
- Tenant context: from the JWT user or `x-tenant-id` / `x-tenant-slug` headers; tenant-scoped settings.
- Security: webhook HMAC verification (`x-webhook-signature` / `x-whatsbox-signature` / `x-signature`, hex or base64, optional `x-webhook-secret`), Meta `X-Hub-Signature-256`, Bitrix24 secret check, rate limiters (API + webhook), helmet (CSP/clickjacking tuned for Bitrix24 iframe), CORS, secret masking in settings.

---

## 🔌 API Reference

### Public / auth
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (DB, providers, uptime) |
| `GET` | `/connector` | Connector metadata |
| `POST` | `/connector/install` | Open Channels install (auto-auth into SPA via JWT) |
| `POST` | `/connector/handler` | Open Channels message handler |
| `GET/POST` | `/connector/app` | Open Channels app placement |
| `POST` | `/auth/login` | Login |
| `POST` | `/auth/forgot-password` | Request reset link (emails via MS Graph) |
| `POST` | `/auth/reset-password` | Reset password (token) |
| `GET` | `/auth/me` | Current user + tenant (auth) |
| `POST` | `/auth/logout` | Logout (auth) |

### Authenticated (JWT / API key + tenant context)
| Method | Path | Description |
|---|---|---|
| `GET` | `/tenant/setup-status` | Tenant configuration state |
| `POST` | `/tenant/setup` | Save tenant integration settings |
| `POST` | `/tenant/test-connection` | Live-test Bitrix24 + WhatsApp credentials |
| `POST` | `/tenant/sync` | One-click contact sync from Bitrix24 |
| `GET/POST` | `/tenant` | List / create tenants (ADMIN/SUPER_ADMIN) |
| `GET` | `/dashboard/stats` | KPI statistics |
| `GET` | `/dashboard/trends` | Trend series |
| `GET` | `/dashboard/activities` | Recent activities |
| `GET` | `/dashboard/history` | History view |
| `POST` | `/messages/send` | Send a WhatsApp message |
| `POST` | `/messages/media` | Send media/document |
| `GET` | `/messages` | List messages |
| `GET` | `/messages/:id` | Get message |
| `GET` | `/contacts` | List contacts |
| `GET/POST` | `/conversations` | List / create conversations |
| `POST` | `/conversations/:id/read` | Mark conversation read |
| `POST` | `/conversations/:id/assign` | Assign conversation |
| `POST` | `/conversations/:id/unassign` | Unassign conversation |
| `GET/PUT` | `/settings` | List / update tenant settings (secrets masked) |
| `GET` | `/settings/:key` | Get one setting |
| `DELETE` | `/settings/:key` | Delete one setting |
| `GET` | `/admin/diagnostics` | Admin health + volumes overview |
| `GET` | `/admin/messages` | Admin message view |
| `POST` | `/admin/messages/retry` | Retry failed/pending messages |
| `GET` | `/admin/webhooks` | Webhook logs |
| `GET/POST` | `/agents` | List / create agents |
| `GET/POST/PUT/DELETE` | `/templates` | Reply-template CRUD |
| `POST` | `/templates/:id/default` | Set the default template |
| `GET/POST` | `/campaigns` | List / create campaigns |
| `GET/PUT/DELETE` | `/campaigns/:id` | Get / update / delete campaign |
| `GET` | `/campaigns/segments` | Available segments |
| `POST` | `/campaigns/:id/execute` | Run the campaign |
| `GET` | `/autoReply` | Auto-reply configuration |
| `PUT` | `/autoReply` | Update auto-reply configuration |

### Webhooks
| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/whatsbox` | WhatsBox inbound (raw body + HMAC) |
| `GET` | `/webhooks/whatsbox` | Meta-style hub challenge |
| `POST` | `/webhooks/meta` | Meta Cloud API inbound (`X-Hub-Signature-256`) |
| `GET` | `/webhooks/meta` | Meta hub verification |
| `POST` | `/webhooks/bitrix24` | Bitrix24 events (operator replies, lead mirror) |

### Bitrix24 app endpoints
| Method | Path | Description |
|---|---|---|
| `GET/POST` | `/bitrix24/install` | `ONAPPINSTALL` handler (OAuth exchange) |
| `POST` | `/bitrix24/uninstall` | `ONAPPUNINSTALL` cleanup |
| `GET` | `/bitrix24/app/settings` | In-app settings placement |
| `GET` | `/bitrix24/app/connector` | Open Channels `SETTING_CONNECTOR` placement |

---

## 📨 Webhook Payload Envelopes

**WhatsBox (flat):**
```json
{
  "event": "message",
  "channel_id": "9041800275",
  "message": {
    "id": "wamid.ABC123",
    "from": "919999876541",
    "body": "Hello",
    "timestamp": 1710000000
  }
}
```
Also accepts `status` events. Signature via `x-webhook-signature` / `x-whatsbox-signature` / `x-signature` (hex or base64), optional `x-webhook-secret`.

**Meta Cloud API:**
```json
{
  "entry": [
    { "changes": [
      { "value": {
          "metadata": { "phone_number_id": "104553123456789" },
          "contacts": [{ "wa_id": "919999876541", "profile": { "name": "John" } }],
          "messages": [{ "from": "919999876541", "text": { "body": "Hello" } }],
          "statuses": []
      } }
    ] }
  ]
}
```
Verified with `X-Hub-Signature-256` (HMAC-SHA256 of raw body using `META_APP_SECRET`).

**Bitrix24 (form-encoded, event in `event` field):**
- `ONIMCONNECTORMESSAGEADD` / `ONIMCONNECTORMESSAGEUPDATE` — operator replies to deliver to WhatsApp.
- `ONCRMLEADADD` — campaign lead mirror (`CAMPAIGN_B24_SOURCE_ID` source filter).

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode |
| `APP_NAME` | `whatsapp-b24-integration` | App identity |
| `HOST` / `PORT` | `0.0.0.0` / `9191` | Bind address / port |
| `DATABASE_URL` | — | PostgreSQL connection string (Prisma) |
| `LOG_LEVEL` / `LOG_FILE_ENABLED` | `info` / `true` | Winston logging |
| `API_KEYS` | `change-me` | Comma-separated legacy API keys (`x-api-key`) |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `TRUST_PROXY` | `false` | Behind nginx/load balancer |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | API rate limit |
| `WEBHOOK_RATE_LIMIT_MAX` | `600` | Webhook burst allowance |
| `RETRY_ENABLED` / `RETRY_INTERVAL_MS` / `OUTGOING_MAX_RETRIES` | `true` / `300000` / `3` | Retry job |
| `WHATSBOX_API_URL` / `WHATSBOX_API_KEY` / `WHATSBOX_CHANNEL_ID` / `WHATSBOX_WEBHOOK_SECRET` | — | WhatsBox provider |
| `WHATSAPP_WEBHOOK_URL` | — | Public webhook URL (per-tenant default fallback) |
| `META_API_BASE_URL` / `META_GRAPH_VERSION` / `META_ACCESS_TOKEN` / `META_PHONE_NUMBER_ID` | `graph.facebook.com` / `v21.0` / — | Meta Cloud API |
| `META_APP_ID` / `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` | — | Meta webhook verification |
| `BITRIX24_WEBHOOK_URL` / `BITRIX24_WEBHOOK_SECRET` | — | Inbound REST webhook + secret |
| `BITRIX24_CLIENT_ID` / `BITRIX24_CLIENT_SECRET` / `BITRIX24_MEMBER_ID` | — | Marketplace app OAuth |
| `BITRIX24_OAUTH_TOKEN_URL` | `oauth.bitrix.info` | Token endpoint |
| `APP_BASE_URL` | — | Public app URL (builds uninstall URL) |
| `BITRIX24_CONNECTOR_ID` | `wa_whatsapp` | Open Channels connector id |
| `BITRIX24_OPENLINE_ID` | `0` | Auto-activate line on install (`0` = manual) |
| `ENABLE_OPENLINES_CONNECTOR` | `false` | Open Channels connector feature flag |
| `ROUTING_ENABLED` / `ROUTING_STRATEGY` | `true` / `least-loaded` | Operator routing |
| `ROUTING_MAX_ACTIVE_PER_AGENT` | `100` | Routing cap |
| `ROUTING_EXCLUDE_SUPERVISORS` | `true` | Skip supervisors on auto-assign |
| `FRONTEND_URL` | — | Password-reset links (e.g. Render frontend) |
| MS Graph (SMTP) vars | — | `MsGraphEmailService` client-credentials email for reset mail |

See `.env.example` for the full commented reference.

---

## 🗄️ Data Model (Prisma)

| Model | Purpose |
|---|---|
| `Tenant` | Multi-tenant org (name, slug, WhatsApp channel id, Bitrix24 config, `isConfigured`) |
| `User` | Admins/agents (email, password hash, role, last login, password-reset token/expiry) |
| `Contact` | WhatsApp contact (phones, name, company, email, `bitrix24ContactId`, `syncStatus`, `createdVia`, `meta` incl. `bitrix24LeadId`) |
| `Conversation` | Chat session (status open/closed, provider, `phoneNumberId`, assignments) |
| `ConversationAssignment` | Operator ↔ conversation assignments |
| `Message` | Every message (direction, status, provider, media, error) |
| `MessageStatus` | Provider status transitions |
| `Campaign` / `CampaignRecipient` | WhatsApp campaigns + per-recipient status |
| `Template` | Canned reply templates (one `isDefault` per tenant) |
| `Agent` | Operator routing config |
| `Setting` | Per-tenant key/value settings (typed: string/number/boolean/json; secrets masked) |
| `Install` | Bitrix24 marketplace installs (portal tokens per tenant) |
| `ConnectorLineMapping` | Open-line ↔ tenant mapping |
| `WebhookLog` | Incoming webhook audit |
| `ActivityLog` | Audit trail (lead created, reply sent, contacts synced, auth, …) |
| `AutoReplyLog` | Auto-reply audit |

> Note: there is no `Channel` model — WhatsApp lines live on `Tenant.whatsboxChannelId`.

---

## 📂 Project Structure

```text
whatsappintegration/
├── README.md                  # This document
├── package.json               # Backend config & scripts
├── .env / .env.example        # Environment configuration
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Prisma migrations
├── src/
│   ├── server.js              # Entry point
│   ├── app.js                 # Express app (helmet, CORS, rate limits, static)
│   ├── config/                # env + config loading
│   ├── constants/             # Enums (message/status/direction), Bitrix24 methods & events
│   ├── controllers/           # Route controllers
│   ├── routes/                # API + webhook route definitions
│   ├── middlewares/           # auth, tenantContext, apiKeyAuth, webhookAuth, rate limiters
│   ├── services/              # Business logic
│   │   ├── bitrix24/          #   service, client, oauth, connector
│   │   ├── whatsbox/          #   WhatsBox provider
│   │   ├── meta/              #   Meta Cloud API provider
│   │   ├── conversation.service.js
│   │   ├── customerResolver.service.js
│   │   ├── outgoingMessage.service.js
│   │   ├── autoReply.service.js
│   │   ├── template.service.js
│   │   ├── campaign.service.js
│   │   ├── segmentResolver.service.js
│   │   ├── routing.service.js
│   │   ├── sync.service.js
│   │   ├── dashboard.service.js
│   │   ├── diagnostics.service.js
│   │   ├── tenant.service.js
│   │   ├── setting.service.js
│   │   ├── auth.service.js
│   │   └── email/             # MS Graph email service
│   ├── repositories/          # Prisma data-access layer
│   ├── jobs/                  # RetryOutgoingMessagesJob, ResyncContactsJob
│   ├── webhooks/              # Provider webhook handlers
│   └── logs/                  # Winston combined.log / error.log
├── docs/
│   ├── BITRIX24_SETUP.md      # Bitrix24 app/connector setup guide
│   └── ERD.md                 # Entity relationship reference
├── public/                    # Compiled SPA (Express static)
└── frontend/                  # React 19 SPA (Vite)
    ├── vite.config.js         # Builds directly into ../public
    └── src/
        ├── App.jsx            # Tab routing (?tab= deep links)
        ├── index.css          # Dark glassmorphism theme
        ├── lib/               # useFetch, useTheme, formatDuration
        └── views/             # Login, Dashboard, Leads, Chat, Webhook Setup,
                               # Auto-Replies, Campaigns, Activity Logs, Message Logs, Reset Password
```

---

## 🖥️ Frontend SPA (React 19 + Vite)

- **Login / Forgot / Reset password** (eye toggle, placeholders, brand emails via MS Graph).
- **Sidebar + Header** with role-aware navigation.
- **Dashboard** — KPI stats (contacts, conversations, open chats, linked leads), trends.
- **Leads** — lead list/view.
- **WhatsApp Chat** — conversation view.
- **Webhook Setup** — integration wizard with live `test-connection` + one-click sync (with timer UI).
- **Auto-Replies** — enable/configure instant replies + template picker.
- **Campaigns** — draft/run campaigns against segments or lists.
- **Activity Logs / Message Logs** — audit trail + message/retry history.
- **Dark/Light theme** toggle; deep-linkable via `?tab=...`.

---

## 💻 How to Run

### Option A: Unified production mode (recommended)
```bash
npm install            # install backend deps (runs prisma generate via postinstall)
npm run build:frontend # compile React into public/
npm start              # serve API + SPA on http://localhost:9191
```

### Option B: Development mode (hot reload)
```bash
# Terminal 1 — backend
npm run dev

# Terminal 2 — frontend (Vite proxies /api to :9191)
cd frontend && npm run dev   # http://localhost:5173
```

### Database
```bash
npx prisma migrate deploy    # apply migrations
npx prisma generate          # regenerate client (stop the server first on Windows)
```

> See `docs/BITRIX24_SETUP.md` for Bitrix24 marketplace/app/connector setup and `docs/ERD.md` for the schema.

---

## 🔐 Default Admin Credentials

- **Email:** `admin@system.com`
- **Password:** `Admin@12345` *(seeded; change it after first login)*

---

## 🧪 Verification

- `GET /health` — liveness + provider/DB status.
- Webhook probes: `POST /webhooks/whatsbox` with a flat envelope (no HMAC needed while `WHATSBOX_WEBHOOK_SECRET` is empty) verifies contact + company + lead creation end-to-end.
- `POST /tenant/test-connection` — validates Bitrix24 webhook + WhatsApp channel credentials from the UI.
- Admin diagnostics (`/api/admin/diagnostics`) — DB health, provider config, queue depth, manual retry trigger.
