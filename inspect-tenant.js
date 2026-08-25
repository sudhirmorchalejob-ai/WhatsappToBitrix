const prisma = require('./src/database/prisma');

async function main() {
  const users = await prisma.user.findMany({ include: { tenant: true } });
  const tenants = await prisma.tenant.findMany();
  const settings = await prisma.setting.findMany();
  console.log('USERS:', JSON.stringify(users, null, 2));
  console.log('TENANTS:', JSON.stringify(tenants, null, 2));
  console.log('SETTINGS:', JSON.stringify(settings, null, 2));
}

main().then(() => prisma.$disconnect());




