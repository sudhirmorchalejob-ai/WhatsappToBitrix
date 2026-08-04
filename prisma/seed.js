const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Create Default Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default-tenant' },
    update: {
      isConfigured: true,
    },
    create: {
      name: 'Demo Organization',
      slug: 'default-tenant',
      status: 'ACTIVE',
      isConfigured: true,
    },
  });
  console.log(`✅ Default tenant: ${tenant.name} (id: ${tenant.id})`);

  // 2. Create Primary Admin User
  const adminPassword = await bcrypt.hash('Admin@123456', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@system.com' },
    update: {
      passwordHash: adminPassword,
      role: 'ADMIN',
      tenantId: tenant.id,
    },
    create: {
      email: 'admin@system.com',
      passwordHash: adminPassword,
      name: 'System Admin',
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });
  console.log(`✅ Admin created: ${adminUser.email}`);

  // 3. Create Additional Tenant Admin User
  const tenantAdminPassword = await bcrypt.hash('Tenant@123456', 10);
  const tenantAdmin = await prisma.user.upsert({
    where: { email: 'tenant@demo.com' },
    update: {
      tenantId: tenant.id,
      passwordHash: tenantAdminPassword,
      role: 'ADMIN',
    },
    create: {
      tenantId: tenant.id,
      email: 'tenant@demo.com',
      passwordHash: tenantAdminPassword,
      name: 'Demo Admin',
      role: 'ADMIN',
    },
  });
  console.log(`✅ Tenant Admin created: ${tenantAdmin.email}`);

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
