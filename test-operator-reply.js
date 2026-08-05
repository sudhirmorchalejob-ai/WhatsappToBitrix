/**
 * Test script: Simulate an operator replying from Bitrix24 to a WhatsApp customer
 * to verify 2-way connection.
 *
 * Run with: node test-operator-reply.js
 */

const http = require('http');

const HOST = 'localhost';
const PORT = 9191;
const EXTERNAL_CHAT_ID = 'wa_17'; // Chat ID for conversation 17 (9041800275)
const OPERATOR_MESSAGE = 'Hello! Thank you for contacting us. How can I help you today?';

const payload = JSON.stringify({
  event: 'ONIMCONNECTORMESSAGEADD',
  ts: Math.floor(Date.now() / 1000),
  auth: {
    member_id: 'default',
    domain: 'crm.cupidpower.in',
  },
  data: {
    CONNECTOR: 'wa_whatsapp',
    LINE: '1',
    MESSAGES: [
      {
        im: {
          chat_id: '101',
          message_id: `b24_op_msg_${Date.now()}`,
        },
        message: {
          user_id: '1',
          text: OPERATOR_MESSAGE,
        },
        chat: {
          id: EXTERNAL_CHAT_ID,
        },
      },
    ],
  },
});

function post(path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Bitrix24 Operator Reply → WhatsApp 2-Way Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`💬 Operator Reply text: "${OPERATOR_MESSAGE}"`);
  console.log(`🔗 Linked Chat ID     : ${EXTERNAL_CHAT_ID}\n`);

  let res;
  try {
    res = await post('/webhooks/bitrix24', payload);
  } catch (err) {
    console.error('❌ Could not reach server:', err.message);
    process.exit(1);
  }

  console.log(`🔁 Webhook HTTP Status: ${res.status}`);
  console.log(JSON.stringify(res.body, null, 2));

  if (res.status === 200 && res.body?.data?.processed?.[0]?.ok) {
    console.log('\n✅ 2-Way Communication Test PASSED!');
    console.log('   The operator reply from Bitrix24 was received & delivered to WhatsApp!\n');
  } else {
    console.log('\n⚠️ Operator reply test response received.');
  }
}

main().catch(console.error);
