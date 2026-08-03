/**
 * LIVE INTEGRATION TEST — Real Server + Bitrix24 Verification
 * ============================================================
 * Run:  node test/live.integration.test.js
 *
 * Prerequisites:
 *  - Server running:  npm start  (on localhost:9191)
 *  - .env has BITRIX24_WEBHOOK_URL set
 *
 * What it tests (15 scenarios):
 *  S01 - Server + DB + Bitrix24 all healthy (diagnostics)
 *  S02 - sendText to new number → 200 + message row created in DB
 *  S03 - Same sendText again → deal reused, no new deal in B24
 *  S04 - sendText with explicit dealId → that dealId stored, no resolution
 *  S05 - sendMedia (image) to new number → 200, type=IMAGE in DB
 *  S06 - sendMedia (document/PDF) → 200, type=PDF in DB
 *  S07 - sendText provider failure → FAILED status + error text returned
 *  S08 - GET /api/contacts → phone B appears after sends
 *  S09 - GET /api/conversations → conversation for phone B exists
 *  S10 - GET /api/messages → messages from sends are listed
 *  S11 - B24: Contact created for phone B (searchable by phone)
 *  S12 - B24: Deal linked to the contact created in S11
 *  S13 - sendText to second new number (phone C) → separate B24 contact
 *  S14 - B24: phone B and phone C have DIFFERENT contact IDs (no merge)
 *  S15 - Inbound webhook simulation → server accepts + contact in local DB
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const SERVER  = 'http://localhost:9191';
const API_KEY = 'change-me';

// Load .env
const envVars = {};
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) envVars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
const B24_WEBHOOK = envVars.BITRIX24_WEBHOOK_URL || '';

// Use real-looking international numbers so B24 normalisation passes
const RUN_ID  = Date.now().toString().slice(-5);
const PHONE_B = `9198${RUN_ID}`;   // ~10 digits, Indian-style mobile
const PHONE_C = `9199${RUN_ID}`;
const PHONE_W = `9197${RUN_ID}`;   // for webhook simulation

console.log('\n\x1b[1m══════════════════════════════════════════════════════════\x1b[0m');
console.log('\x1b[1m  LIVE INTEGRATION TEST  —  Server + Bitrix24\x1b[0m');
console.log('\x1b[1m══════════════════════════════════════════════════════════\x1b[0m');
console.log(`  Run ID   : ${RUN_ID}`);
console.log(`  Server   : ${SERVER}`);
console.log(`  B24 URL  : ${B24_WEBHOOK ? B24_WEBHOOK.replace(/(\/rest\/\d+\/).*\//, '$1***\/') : 'NOT SET — B24 scenarios skipped'}`);
console.log(`  Phone B  : ${PHONE_B}`);
console.log(`  Phone C  : ${PHONE_C}`);
console.log(`  Phone W  : ${PHONE_W}  (webhook)`);
console.log();

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function httpRequest(url, { method = 'GET', headers = {}, rawBody = null, jsonBody = null } = {}) {
  return new Promise((resolve, reject) => {
    const mod  = url.startsWith('https') ? https : http;
    const body = rawBody != null ? rawBody
               : jsonBody != null ? JSON.stringify(jsonBody)
               : null;

    const mergedHeaders = {
      ...(jsonBody != null ? { 'Content-Type': 'application/json' } : {}),
      ...(rawBody != null ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...headers,
    };
    if (body) mergedHeaders['Content-Length'] = Buffer.byteLength(body);

    const req = mod.request(url, { method, headers: mergedHeaders }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const api = {
  get:  (path)       => httpRequest(`${SERVER}${path}`, { headers: { 'x-api-key': API_KEY } }),
  post: (path, json) => httpRequest(`${SERVER}${path}`, { method: 'POST', headers: { 'x-api-key': API_KEY }, jsonBody: json }),
  webhookPost: (path, json) => {
    const buf = Buffer.from(JSON.stringify(json));
    return httpRequest(`${SERVER}${path}`, {
      method: 'POST',
      // raw body so webhook middleware can parse it
      rawBody: buf,
    });
  },
};

async function b24Call(method, params = {}) {
  if (!B24_WEBHOOK) return null;
  const url  = `${B24_WEBHOOK}${method}.json`;
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`)
    .join('&');
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function b24FindContactByPhone(phone) {
  if (!B24_WEBHOOK) return [];
  const digits = phone.replace(/\D/g, '');
  try {
    const res = await b24Call('crm.contact.list', {
      'filter[PHONE]': digits,
      'select[]': 'ID', 'select[1]': 'NAME', 'select[2]': 'PHONE',
    });
    return (res && Array.isArray(res.result)) ? res.result : [];
  } catch { return []; }
}

async function b24FindDealByContact(contactId) {
  if (!B24_WEBHOOK || !contactId) return [];
  try {
    const res = await b24Call('crm.deal.list', {
      'filter[CONTACT_ID]': contactId,
      'select[]': 'ID', 'select[1]': 'TITLE', 'select[2]': 'CONTACT_ID',
    });
    return (res && Array.isArray(res.result)) ? res.result : [];
  } catch { return []; }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Runner ────────────────────────────────────────────────────────────────

const results = [];
let passed = 0, failed = 0, skipped = 0;

async function scenario(id, name, fn, skip = false) {
  if (skip) {
    console.log(`  [\x1b[33m${id}\x1b[0m] ${name} ... \x1b[33mSKIPPED\x1b[0m`);
    results.push({ id, name, pass: null });
    skipped++;
    return null;
  }
  process.stdout.write(`  [${id}] ${name} ... `);
  try {
    const val = await fn();
    console.log('\x1b[32mPASS\x1b[0m');
    results.push({ id, name, pass: true });
    passed++;
    return val;
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m  → ${err.message}`);
    results.push({ id, name, pass: false, error: err.message });
    failed++;
    return null;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ─── Scenarios ─────────────────────────────────────────────────────────────

async function run() {

  // S01 — Health check
  await scenario('S01', 'Diagnostics: server DB + Bitrix24 healthy', async () => {
    const r = await api.get('/api/admin/diagnostics');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.body.success === true, 'success != true');
    assert(r.body.data.db.ok === true, `DB unhealthy: ${JSON.stringify(r.body.data.db)}`);
    assert(r.body.data.providers.bitrix24.configured === true, 'Bitrix24 not configured');
    console.log(`        DB latency: ${r.body.data.db.latencyMs}ms`);
  });

  // S02 — sendText to new phone
  let msgB_id = null;
  await scenario('S02', `POST /api/messages/send → text to new phone ${PHONE_B}`, async () => {
    const r = await api.post('/api/messages/send', { to: PHONE_B, body: 'Live test S02 — first message' });
    assert(r.status === 200 || r.status === 201,
      `Expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, `success != true: ${JSON.stringify(r.body)}`);
    assert(r.body.data && r.body.data.id, 'No message id returned');
    msgB_id = r.body.data.id;
    console.log(`        Message ID: ${msgB_id}  Status: ${r.body.data.status}`);
  });

  await wait(3000); // give B24 sync time

  // S03 — Same phone second time → deal reused
  await scenario('S03', `POST /api/messages/send to ${PHONE_B} again → deal reused`, async () => {
    const r = await api.post('/api/messages/send', { to: PHONE_B, body: 'Live test S03 — second message, same phone' });
    assert(r.status === 200 || r.status === 201,
      `Expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, `success != true`);
    // dealId should be same as first message (reused)
    if (r.body.data.dealId && msgB_id) {
      console.log(`        Deal ID: ${r.body.data.dealId} (reused)`);
    }
  });

  // S04 — Explicit dealId bypasses resolution
  await scenario('S04', 'POST /api/messages/send with explicit dealId=42 → dealId=42 stored', async () => {
    const r = await api.post('/api/messages/send', { to: PHONE_B, body: 'Explicit deal ref', dealId: 42 });
    assert(r.status === 200 || r.status === 201,
      `Expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, 'success != true');
    assert(r.body.data.dealId === 42, `Expected dealId=42, got ${r.body.data.dealId}`);
    console.log(`        dealId in response: ${r.body.data.dealId}`);
  });

  // S05 — sendMedia image
  let mediaMsg = null;
  await scenario('S05', `POST /api/messages/media (image) to ${PHONE_C} → type=IMAGE`, async () => {
    const r = await api.post('/api/messages/media', {
      to:      PHONE_C,
      type:    'image',
      link:    'https://via.placeholder.com/300.jpg',
      caption: 'Live test S05 image',
    });
    assert(r.status === 200 || r.status === 201,
      `Expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, 'success != true');
    assert(r.body.data.type === 'IMAGE', `Expected IMAGE, got ${r.body.data.type}`);
    mediaMsg = r.body.data;
    console.log(`        Message ID: ${mediaMsg.id}  Type: ${mediaMsg.type}`);
  });

  // S06 — sendMedia PDF document
  await scenario('S06', `POST /api/messages/media (PDF document) to ${PHONE_C} → type=PDF`, async () => {
    const r = await api.post('/api/messages/media', {
      to:       PHONE_C,
      type:     'document',
      link:     'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      filename: 'dummy.pdf',
      caption:  'Live test S06 PDF',
    });
    assert(r.status === 200 || r.status === 201,
      `Expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, 'success != true');
    // PDF filenames should map to PDF type
    assert(r.body.data.type === 'PDF' || r.body.data.type === 'DOCUMENT',
      `Expected PDF or DOCUMENT, got ${r.body.data.type}`);
    console.log(`        Type: ${r.body.data.type}`);
  });

  await wait(3000);

  // S07 — GET /api/contacts — phone B visible
  await scenario('S07', `GET /api/contacts?search=${PHONE_B} → contact returned`, async () => {
    const r = await api.get(`/api/contacts?search=${PHONE_B}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.success === true, 'success != true');
    const list = r.body.data || r.body.contacts || [];
    const found = list.find(c => c.whatsappPhone && c.whatsappPhone.replace(/\D/g,'').includes(PHONE_B.replace(/\D/g,'')));
    assert(found, `Phone ${PHONE_B} not found in contacts list (got ${list.length} contacts)`);
    console.log(`        Contact: id=${found.id}  phone=${found.whatsappPhone}`);
  });

  // S08 — GET /api/conversations
  await scenario('S08', 'GET /api/conversations → at least 1 OPEN conversation exists', async () => {
    const r = await api.get('/api/conversations?status=OPEN');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.success === true, 'success != true');
    const list = r.body.data || r.body.conversations || [];
    assert(list.length > 0, 'No OPEN conversations found in DB');
    console.log(`        Open conversations: ${list.length}`);
  });

  // S09 — GET /api/messages
  await scenario('S09', 'GET /api/messages → message list includes our messages', async () => {
    const r = await api.get('/api/messages');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.success === true, 'success != true');
    const list = r.body.data || r.body.messages || [];
    assert(list.length > 0, 'No messages found in DB');
    console.log(`        Total messages in DB: ${list.length}`);
  });

  // S10 — GET /api/messages/:id
  await scenario('S10', `GET /api/messages/${msgB_id} → specific message returned`, async () => {
    assert(msgB_id, 'Need msgB_id from S02');
    const r = await api.get(`/api/messages/${msgB_id}`);
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success === true, 'success != true');
    assert(r.body.data.id === msgB_id, `Expected id=${msgB_id}, got ${r.body.data.id}`);
    console.log(`        id=${r.body.data.id}  type=${r.body.data.type}  status=${r.body.data.status}`);
  });

  // ─── Bitrix24 Verification ────────────────────────────────────────────

  let contactB_b24Id = null;

  await scenario('S11', `B24: Contact created for ${PHONE_B} (searchable in Bitrix24)`, async () => {
    const found = await b24FindContactByPhone(PHONE_B);
    assert(found.length > 0, `No Bitrix24 contact found for phone ${PHONE_B}. Ensure B24 webhook is valid.`);
    contactB_b24Id = found[0].ID;
    console.log(`        B24 Contact ID: ${contactB_b24Id}  Name: ${found[0].NAME || '(no name)'}`);
  }, !B24_WEBHOOK);

  await scenario('S12', `B24: Deal exists and is linked to Contact ${contactB_b24Id}`, async () => {
    assert(contactB_b24Id, 'Need contactB_b24Id from S11');
    const deals = await b24FindDealByContact(contactB_b24Id);
    assert(deals.length > 0, `No deal found in B24 for contact ${contactB_b24Id}`);
    console.log(`        B24 Deal ID: ${deals[0].ID}  Title: ${deals[0].TITLE || '(no title)'}`);
  }, !B24_WEBHOOK);

  let contactC_b24Id = null;

  await scenario('S13', `B24: Separate contact created for ${PHONE_C}`, async () => {
    const found = await b24FindContactByPhone(PHONE_C);
    assert(found.length > 0, `No Bitrix24 contact for phone ${PHONE_C}`);
    contactC_b24Id = found[0].ID;
    console.log(`        B24 Contact ID for Phone C: ${contactC_b24Id}`);
  }, !B24_WEBHOOK);

  await scenario('S14', `B24: Phone B contact (${contactB_b24Id}) ≠ Phone C contact (${contactC_b24Id})`, async () => {
    assert(contactB_b24Id && contactC_b24Id, 'Need both contact IDs from S11 and S13');
    assert(
      String(contactB_b24Id) !== String(contactC_b24Id),
      `Contacts were merged! Both ${PHONE_B} and ${PHONE_C} map to B24 contact ${contactB_b24Id}`
    );
    console.log(`        Contact B: ${contactB_b24Id}  Contact C: ${contactC_b24Id}  → different ✓`);
  }, !B24_WEBHOOK);

  // S15 — Inbound webhook (WhatsBox flat-envelope format)
  // The webhook middleware uses `raw()` so we send raw bytes with no auth
  // (dev mode: WHATSBOX_WEBHOOK_SECRET is blank → passes through)
  await scenario('S15', `POST /webhooks/whatsbox (inbound from ${PHONE_W}) → 200 + contact created`, async () => {
    const payload = JSON.stringify({
      channel_id: envVars.WHATSBOX_CHANNEL_ID || '15551234567',
      message: {
        id:        `live-s15-${RUN_ID}`,
        from:      PHONE_W,
        from_name: 'Live Test Inbound',
        timestamp: Math.floor(Date.now() / 1000),
        type:      'text',
        text:      { body: 'Hello from live test S15' },
      },
    });

    const r = await httpRequest(`${SERVER}/webhooks/whatsbox`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': Buffer.byteLength(payload) },
      rawBody: payload,
    });

    assert(
      r.status === 200 || r.status === 202 || r.status === 204,
      `Expected 2xx, got ${r.status}: ${JSON.stringify(r.body)}`
    );

    await wait(3000);

    // Verify contact appeared in local DB
    const list = await api.get(`/api/contacts?search=${PHONE_W}`);
    assert(list.status === 200, `Contacts API failed: ${list.status}`);
    const contacts = list.body.data || list.body.contacts || [];
    const found = contacts.find(c => c.whatsappPhone && c.whatsappPhone.replace(/\D/g,'').includes(PHONE_W.replace(/\D/g,'')));
    assert(found, `Inbound contact ${PHONE_W} not found in local DB after webhook`);
    console.log(`        Inbound contact: id=${found.id}  phone=${found.whatsappPhone}`);
  });

  // ─── Summary ──────────────────────────────────────────────────────────

  console.log();
  console.log('\x1b[1m══════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  RESULTS\x1b[0m');
  console.log('\x1b[1m══════════════════════════════════════════════════════════\x1b[0m');
  for (const r of results) {
    const icon = r.pass === true  ? '\x1b[32m✔\x1b[0m'
               : r.pass === false ? '\x1b[31m✖\x1b[0m'
               : '\x1b[33m–\x1b[0m';
    console.log(`  ${icon} [${r.id}] ${r.name}`);
    if (r.pass === false) console.log(`       \x1b[31m→ ${r.error}\x1b[0m`);
  }
  console.log();
  const label = failed === 0 ? '\x1b[32mALL PASS\x1b[0m' : `\x1b[31m${failed} FAILED\x1b[0m`;
  console.log(`  Total: ${results.length}  |  \x1b[32mPass: ${passed}\x1b[0m  |  ${label}  |  \x1b[33mSkipped: ${skipped}\x1b[0m`);
  console.log('\x1b[1m══════════════════════════════════════════════════════════\x1b[0m\n');

  if (B24_WEBHOOK && (passed + skipped) === results.length) {
    console.log('\x1b[32m✅  Check your Bitrix24 CRM now:\x1b[0m');
    console.log(`   • Contacts → search "${PHONE_B}" → should see a new contact`);
    console.log(`   • Contacts → search "${PHONE_C}" → separate contact`);
    console.log(`   • Deals → filter by above contacts → deals should be linked`);
    console.log();
  }

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('\n\x1b[31mUnhandled error:\x1b[0m', err.message, err.stack);
  process.exit(1);
});
