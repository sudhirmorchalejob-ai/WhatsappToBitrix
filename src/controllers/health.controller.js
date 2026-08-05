const { sendSuccess } = require('../utils/ApiResponse');
const { env, isProduction } = require('../config');
const prismaClient = require('../database/prisma');
const pkg = require('../../package.json');

async function getHealth(req, res) {
  const started = Date.now();
  let dbStatus = { connected: false, latencyMs: 0, error: null };

  try {
    await prismaClient.$queryRawUnsafe('SELECT 1');
    dbStatus = {
      connected: true,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    dbStatus = {
      connected: false,
      latencyMs: Date.now() - started,
      error: err.message,
    };
  }

  const bitrixConfigured = Boolean(env.BITRIX24_WEBHOOK_URL);
  const whatsappConfigured = Boolean(env.WHATSAPP_WEBHOOK_URL || env.WHATSBOX_API_URL);

  const overallStatus = dbStatus.connected && bitrixConfigured ? 'ok' : 'degraded';

  const memoryUsage = process.memoryUsage();

  const payload = {
    status: overallStatus,
    app: env.APP_NAME,
    version: pkg.version,
    environment: env.NODE_ENV,
    isProduction,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: {
      database: dbStatus,
      services: {
        bitrix24: {
          configured: bitrixConfigured,
          webhookUrl: env.BITRIX24_WEBHOOK_URL ? 'CONFIGURED' : 'NOT_SET',
        },
        whatsapp: {
          configured: whatsappConfigured,
          channelId: env.WHATSBOX_CHANNEL_ID || 'DEFAULT',
        },
      },
      system: {
        memoryUsageMB: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        },
      },
    },
  };

  const httpStatus = overallStatus === 'ok' ? 200 : 503;
  return res.status(httpStatus).json({
    success: overallStatus === 'ok',
    data: payload,
  });
}

module.exports = { getHealth };
