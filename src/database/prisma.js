const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('query', (e) => {
  logger.debug(`[prisma] ${e.query} ${e.params} (${e.duration}ms)`, { module: 'database' });
});

prisma.$on('error', (e) => {
  logger.error(`[prisma] ${e.message}`, { module: 'database' });
});

prisma.$on('warn', (e) => {
  logger.warn(`[prisma] ${e.message}`, { module: 'database' });
});

module.exports = prisma;
