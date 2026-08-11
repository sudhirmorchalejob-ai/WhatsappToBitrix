# Bitrix24 SMS Provider — “My SMS Gateway”

How the middleware turns your SMS gateway (MSG91, or any HTTP JSON gateway) into a native
Bitrix24 **message provider**, so CRM cards, Automation rules and Workflows can send SMS and
track delivery — all through the same install flow as the WhatsApp connector.

---

## 1. How it fits together

```
Bitrix24 portal
   │  user clicks "send SMS" (CRM / Automation / Workflow)
   │  messageservice.sender.add provider chosen = "My SMS Gateway"
   ▼
POST /api/bitrix24/sms        (public, rate-limited)
   │  payload: { module_id, code, message_id, message_to, message_body, ts, ... }
   ▼
middleware
   │  1. resolve install from `code`  (code = wa_b24_sms_<member_id>)
   │  2. persist Message (provider=SMS, status=PENDING)      [persist-first]
   │  3. send via tenant SMS gateway (MSG91 / generic HTTP POST)
   │  4. persist SENT + providerMessageId
   │  5. report "sent"  →  messageservice.message.status.update
   ▼
SMS gateway (MSG91 etc.)
   │  delivery DLR callback
   ▼
POST /webhooks/sms             (public; secret / HMAC optional)
   │  maps DLR status → local state → Bitrix24 STATUS
   ▼
messageservice.message.status.update  { CODE, MESSAGE_ID, STATUS }
   STATUS ∈ queued | sent | delivered | undelivered | failed   (no "read")
```

---

## 2. Bitrix24 scope requirement

The provider registration and status updates run **in the app context** and need the
`messageservice` scope. Bitrix24 **does not** expose an app-scope config file, so:

1. Open the app page in the Bitrix24 Market (Apps → your app → Edit).
2. Add `messageservice` to the **Scope list** (keep `imconnector`, `crm`, `user`, `bizproc`…).
3. Save **and reinstall** the app on each portal so the new scope + provider take effect.

On (re)install the app calls `messageservice.sender.list` → if the code
`wa_b24_sms_<member_id>` is missing it calls `messageservice.sender.add` (idempotent; if the
code already exists it calls `sender.update` instead so the handler URL always tracks
`APP_BASE_URL`). On uninstall it calls `messageservice.sender.delete` (best-effort).

Provider registration is **non-fatal**: if it fails, install still succeeds and the error is
logged (check `src/logs/combined.log` for `bitrix24-message-provider`).

---

## 3. Configuration

Resolution order — **per-tenant override wins over the `.env` default**:

| Key (Setting / env) | Description |
|---|---|
| `sms_provider` / `SMS_PROVIDER` | `msg91` or `generic` (default `generic`) |
| `sms_api_url` / `SMS_API_URL` | Gateway endpoint (MSG91 default is built-in, but set it explicitly to be safe) |
| `sms_api_key` / `SMS_API_KEY` | Secret — stored `isSecret`, never echoed back (shown as `********`) |
| `sms_sender_id` / `SMS_SENDER_ID` | e.g. `MYAPP` |
| `sms_route` / `SMS_ROUTE` | e.g. `4` (MSG91) |
| `sms_template_id` / `SMS_TEMPLATE_ID` | DLT template id (MSG91) |
| `sms_webhook_secret` / `SMS_WEBHOOK_SECRET` | Shared secret for the DLR webhook (secret) |

**Per-tenant UI:** Dashboard → **SMS Gateway** (`/api/sms/config` GET/PUT, `/api/sms/test`
POST with `action: connection|send`). Saving an empty or `********` value removes the override
(falls back to env). The API URL/API key/secret are **never** echoed in raw form.

`POST /api/sms/test` with `{ action: "send", to: "+919999999999" }` sends a real test SMS
through the tenant's gateway.

---

## 4. Endpoints

| Method / Path | Auth | Purpose |
|---|---|---|
| `POST /api/bitrix24/sms` | none (provider code) | Bitrix24 SMS provider handler (persist + send + report) |
| `POST /webhooks/sms` | optional secret / HMAC | SMS gateway delivery report → Bitrix24 status |
| `GET /api/sms/config` | dashboard JWT (app-wide permissive `authenticate`) | Masked config + `configured` flag |
| `PUT /api/sms/config` | dashboard JWT | Save tenant overrides |
| `POST /api/sms/test` | dashboard JWT | Connection test / real test send |

### Delivery webhook (`POST /webhooks/sms`)

Accepted bodies are parsed as JSON **or** `application/x-www-form-urlencoded`:

- `messageId` / `message_id` / `msgid` → id of the **provider** message (not Bitrix24's).
- `status` → provider DLR state (e.g. `DELIVRD`, `failed`, `expired`…). Unknown states map
  to `FAILED` so a message can never silently hang.

Optional verification (config `sms_webhook_secret` / env `SMS_WEBHOOK_SECRET`):
`?secret=<value>`, body `secret`, header `x-sms-secret`, or an HMAC-SHA256 signature header
`x-sms-signature` computed over the raw body with the secret.

Status flow: `queued → sent → delivered / undelivered / failed`. `delivered` can move to
`FAILED`/`UNDELIVERED` on a later carrier report; it can never go backwards to `sent`.

---

## 5. MSG91 specifics

- Default endpoint: `https://api.msg91.com/api/sendhttp.php`
- Query params: `authkey` (api key), `mobiles` (recipient), `message`, `sender`,
  `route`, `dlttemplateid`, `country` (`91`).
- Delivery callbacks: configure MSG91 to POST DLRs to `APP_BASE_URL/webhooks/sms`; the
  report carries `msgid` and a `status` string (e.g. `DELIVRD`).

### Generic provider

`generic` POSTs JSON `{ to, message }` to `sms_api_url` and interprets the response as
`{ providerMessageId?, ok?, error? }` (an HTTP 2xx with a body counts as accepted).

---

## 6. Deployment notes

- `APP_BASE_URL` must be a **public HTTPS** URL reachable from both Bitrix24 and the SMS
  gateway (this builds the handler URL registered on install).
- The delivery webhook secret must be **given to the SMS provider** separately; it never
  travels over the wire to Bitrix24.
- Retries: the background retry job also handles `provider=SMS` messages that are still
  `PENDING`/`FAILED` (see `src/jobs/retryOutgoingMessages.job.js`).

---

## 7. Honest limitations (by design / platform constraints)

- **Bitrix24 SMS message visibility:** the `messageservice` API does **not** return message
  content or sender info to the middleware — we only ever see the **request to send**
  (`message_to`, `message_body` from the handler) and can **report status back**. Bitrix24
  keeps its own message records; the middleware's `Message` rows are the audit trail.
- **No `read` status** exists for SMS; the status vocabulary ends at `delivered`.
- **Marketing broadcasts:** SMS availability in the Bitrix24 **Marketing** tool is gated by
  Bitrix24's own provider selection and entitlement; the middleware cannot force it. The
  provider works in CRM, Automation rules and Workflows.
- **Same shared handler for every portal** (`/api/bitrix24/sms`): the `code` field routes the
  request to the right tenant. Unknown codes return HTTP 400.

---

## 8. Verification checklist

1. Reinstall the app (scope `messageservice` present) → `src/logs/combined.log` shows
   `message provider registered`.
2. Dashboard → SMS Gateway → fill credentials → **Test Connection** → **Send Test SMS**.
3. In Bitrix24 open a contact with a phone → **SMS/WhatsApp** → pick **My SMS Gateway** → send.
4. `Message Logs` shows the outgoing SMS; the CRM card shows `sent` → `delivered`.
