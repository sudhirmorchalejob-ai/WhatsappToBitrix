const prisma = require('./src/database/prisma');

async function main() {
  const allContacts = await prisma.contact.findMany();
  console.log('Total contacts in DB:', allContacts.length);
  console.log(JSON.stringify(allContacts, null, 2));
}

main().finally(() => prisma.$disconnect());
