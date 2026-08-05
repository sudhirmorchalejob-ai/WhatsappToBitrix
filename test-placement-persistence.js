const prisma = require('./src/database/prisma');
const { ConnectorModuleController } = require('./src/controllers/connectorModule.controller');

async function testPlacementPersistence() {
  console.log('=== TESTING OPEN CHANNEL CONNECTOR PERSISTENCE & DISCONNECT ===');
  const controller = new ConnectorModuleController();

  const memberId = 'test_member_cupidpower_1';

  // 1. Simulate POST save_line to Line #6
  const reqPost = {
    method: 'POST',
    query: { member_id: memberId },
    body: { member_id: memberId, action: 'save_line', line_id: 6 },
  };

  const resPost = {
    status(code) { this.statusCode = code; return this; },
    type(t) { return this; },
    send(html) { this.html = html; return this; },
  };

  await controller.handlePlacement(reqPost, resPost);
  console.log('Connect POST Response Status:', resPost.statusCode);

  // 2. Query DB to verify persistent mapping
  const install = await prisma.install.findFirst({ where: { memberId } });
  const mapping = await prisma.connectorLineMapping.findFirst({ where: { memberId, lineId: 6 } });

  console.log('DB Install lineId:', install ? install.lineId : null);
  console.log('DB Mapping Status:', mapping ? mapping.status : null);

  // 3. Simulate GET Page Refresh
  const reqGet = {
    method: 'GET',
    query: { member_id: memberId },
    body: {},
  };

  const resGet = {
    status(code) { this.statusCode = code; return this; },
    type(t) { return this; },
    send(html) { this.html = html; return this; },
  };

  await controller.handlePlacement(reqGet, resGet);

  const isConnectedInUI = resGet.html.includes('✓ Connected (Line #6)');
  const hasDisconnectBtn = resGet.html.includes('Disconnect Connector');

  console.log('Page Refresh HTML shows Connected Badge:', isConnectedInUI);
  console.log('Page Refresh HTML shows Disconnect Button:', hasDisconnectBtn);

  if (install.lineId === 6 && mapping.status === 'ACTIVE' && isConnectedInUI && hasDisconnectBtn) {
    console.log('✅ PERSISTENCE SUCCESS: Open Channel connection persists across page refreshes!');
  } else {
    console.error('❌ PERSISTENCE FAIL: Connection state lost on refresh');
  }

  // 4. Simulate Disconnect Action
  const reqDisconnect = {
    method: 'POST',
    query: { member_id: memberId },
    body: { member_id: memberId, action: 'disconnect' },
  };

  const resDisconnect = {
    status(code) { this.statusCode = code; return this; },
    type(t) { return this; },
    send(html) { this.html = html; return this; },
  };

  await controller.handlePlacement(reqDisconnect, resDisconnect);

  const reqGetAfterDisconnect = { method: 'GET', query: { member_id: memberId }, body: {} };
  const resGetAfterDisconnect = { status(code) { return this; }, type(t) { return this; }, send(html) { this.html = html; return this; } };
  await controller.handlePlacement(reqGetAfterDisconnect, resGetAfterDisconnect);

  const isDisconnectedInUI = resGetAfterDisconnect.html.includes('Disconnected');
  console.log('Page Refresh HTML after Disconnect shows Disconnected:', isDisconnectedInUI);

  if (isDisconnectedInUI) {
    console.log('✅ DISCONNECT SUCCESS: Disconnect button successfully unlinks connector!');
  } else {
    console.error('❌ DISCONNECT FAIL');
  }
}

testPlacementPersistence().catch(console.error).finally(() => prisma.$disconnect());
