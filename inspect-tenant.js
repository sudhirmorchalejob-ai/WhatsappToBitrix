const prisma = require('./src/database/prisma');

async function main() {
  const users = await prisma.user.findMany({ include: { tenant: true } });
  const tenants = await prisma.tenant.findMany();
  console.log('USERS:', JSON.stringify(users, null, 2));
  console.log('TENANTS:', JSON.stringify(tenants, null, 2));
}

main().then(() => prisma.$disconnect());
