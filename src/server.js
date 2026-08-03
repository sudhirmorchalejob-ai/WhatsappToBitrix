const createApp = require('./app');
const { env } = require('./config');
const prisma = require('./database/prisma');
const logger = require('./utils/logger');
const { createJobs, startJobs, stopJobs } = require('./jobs');

const log = logger.childFor('server');

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  log.info(`${env.APP_NAME} listening on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
});

// Background workers (webhook retry, CRM resync). Started after listen
// so a crash here cannot take the API down.
const jobs = createJobs();
if (env.RETRY_ENABLED) {
  const started = startJobs(jobs);
  log.info('background jobs started', { jobs: started });
}

/**
 * Graceful shutdown: stop accepting requests, close DB, then exit.
 */
async function shutdown(signal) {
  log.info(`Received ${signal}, shutting down gracefully...`);
  stopJobs(jobs);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      log.info('Database connection closed. Bye.');
      process.exit(0);
    } catch (err) {
      log.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  setTimeout(() => {
    log.warn('Forced shutdown after 10s');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.stack : reason });
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { stack: err.stack });
});
