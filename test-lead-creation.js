/**
 * Test script: Simulate an incoming WhatsApp message from 9876543210
 * and verify a Bitrix24 lead is created.
 *
 * Run with:  node test-lead-creation.js
 */

const http = require('http');

const PHONE   = '9876543210';
const NAME    = 'Test Customer';
const BODY    = 'Hello, I am interested in your product!';
const HOST    = 'localhost';
const PORT    = 9191;

// Flat WhatsBox webhook payload (the normalizer handles this format)
const payload = JSON.stringify({
  event: 'message',
  channel_id: '919000000000',
  message: {
    id:        `test_msg_${Date.now()}`,
    from:       PHONE,
    from_name:  NAME,
    type:       'text',
    body:       BODY,
    timestamp:  Math.floor(Date.now() / 1000),
    to:         '919000000000',
  },
});

function post(path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port:     PORT,
      path,
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch  { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  WhatsApp → Bitrix24 Lead Creation Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`📱  Simulating WhatsApp message FROM: +${PHONE}`);
  console.log(`📝  Message: "${BODY}"\n`);

  let res;
  try {
    res = await post('/webhooks/whatsbox', payload);
  } catch (err) {
    console.error('❌  Could not reach server. Is it running on port 9191?');
    console.error(`    Error: ${err.message}`);
    process.exit(1);
  }

  console.log(`🔁  Webhook response: HTTP ${res.status}`);
  console.log(JSON.stringify(res.body, null, 2));
  console.log('');

  if (res.status !== 200) {
    console.error('❌  Webhook returned a non-200 status. See output above.');
    process.exit(1);
  }

  const processed = res.body?.data?.processed || [];
  const event     = processed[0];

  if (!event) {
    console.warn('⚠️  No events in processed array.');
    process.exit(0);
  }

  if (!event.ok) {
    console.error(`❌  Event processing FAILED: ${event.error}`);
    process.exit(1);
  }

  const result = event.result || {};

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅  RESULT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Contact ID      : ${result.contactId      ?? '(not returned)'}`);
  console.log(`  Conversation ID : ${result.conversationId ?? '(not returned)'}`);
  console.log(`  Message ID      : ${result.messageId      ?? '(not returned)'}`);

  if (result.leadId) {
    console.log(`\n  🎯  Bitrix24 Lead ID : #${result.leadId}`);
    console.log('  ✅  Lead was CREATED in Bitrix24!\n');
  } else {
    console.log('\n  ⚠️   leadId is null in the response.');
    console.log('      This can happen when:');
    console.log('      1. The Bitrix24 webhook URL is not configured (set BITRIX24_WEBHOOK_URL in .env)');
    console.log('      2. The contact is not yet synced to Bitrix24 (bitrix24ContactId is null)');
    console.log('      3. Bitrix24 is unreachable from this machine\n');
    console.log('  Check the server logs (npm start terminal) for details.\n');
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
