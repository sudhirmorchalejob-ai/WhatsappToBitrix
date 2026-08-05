const prisma = require('./src/database/prisma');
const { Bitrix24OAuth } = require('./src/services/bitrix24/oauth');

async function main() {
  console.log('=== RUNNING OAUTH RE-INSTALLATION TEST FOR crm.cupidpower.in ===');
  const oauth = new Bitrix24OAuth();

  const updatedInstall = await oauth.installFromParams({
    domain: 'crm.cupidpower.in',
    member_id: 'test_member_cupidpower_1',
    AUTH_ID: 'updated_access_token_999',
    REFRESH_ID: 'updated_refresh_token_000',
  });

  const count = await prisma.install.count({ where: { memberId: 'test_member_cupidpower_1' } });
  const dbInstall = await prisma.install.findFirst({
    where: { memberId: 'test_member_cupidpower_1' },
    include: { tenant: true },
  });

  console.log(`Total Install Rows for memberId: ${count}`);
  console.log('Updated DB Install Record:', JSON.stringify(dbInstall, null, 2));

  if (count === 1 && dbInstall.accessToken === 'updated_access_token_999') {
    console.log('✅ RE-INSTALLATION SUCCESS: Updated existing row without duplicates!');
  } else {
    console.error('❌ RE-INSTALLATION FAIL: Duplicate rows created or tokens not updated');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
