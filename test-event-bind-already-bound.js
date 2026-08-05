const { Bitrix24Service } = require('./src/services/bitrix24/bitrix24.service');

async function testAlreadyBound() {
  console.log('=== TESTING EVENT.BIND "Handler already binded" NO-OP BEHAVIOR ===');
  const b24 = new Bitrix24Service();

  // Mock client that throws "Handler already binded"
  b24._ensureOAuthClient = async () => ({
    call: async (method, params) => {
      if (params.event === 'ONAPPUNINSTALL') {
        const err = new Error('Handler already binded');
        err.code = 'ERROR_CORE';
        throw err;
      }
      return { result: true };
    },
  });

  const results = await b24.bindEvents('test_member_1', [
    { event: 'ONIMCONNECTORMESSAGEADD', handler: 'https://example.com/webhook' },
  ]);

  console.log('bindEvents Results:', JSON.stringify(results, null, 2));

  const uninstallResult = results.find((r) => r.event === 'ONAPPUNINSTALL');
  const addResult = results.find((r) => r.event === 'ONIMCONNECTORMESSAGEADD');

  if (uninstallResult && uninstallResult.ok && uninstallResult.alreadyBound && addResult && addResult.ok) {
    console.log('✅ SUCCESS: "Handler already binded" treated as ok: true (alreadyBound: true)!');
  } else {
    console.error('❌ FAIL: "Handler already binded" not handled correctly');
  }
}

testAlreadyBound().catch(console.error);
