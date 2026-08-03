const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { env } = require('./config');
const requestLogger = require('./middlewares/requestLogger');
const limiter = require('./middlewares/rateLimiter');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const routes = require('./routes');
const webhookRoutes = require('./routes/webhook.route');
const metaWebhookRoutes = require('./routes/metaWebhook.route');
const bitrix24WebhookRoutes = require('./routes/bitrix24Webhook.route');
const bitrix24AppRoutes = require('./routes/bitrix24App.route');
const healthRoute = require('./routes/health.route');

/**
 * Express application factory. Middleware order is intentional.
 *
 * NOTE: body parsing is per-mount. The /api mount uses express.json;
 * the /webhooks mount uses express.raw so webhook signatures can be
 * verified against the exact bytes received.
 *
 *  1. security headers (helmet)
 *  2. CORS
 *  3. request logging
 *  4. /api    -> json/urlencoded parsing -> rate limit -> routes
 *     /webhooks -> raw parsing -> webhook rate limit -> verification -> controller
 *  5. 404
 *  6. centralized error handler
 */
function createApp() {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    })
  );

  app.use(requestLogger);

  app.use(
    '/api',
    express.json({ limit: '5mb' }),
    express.urlencoded({ extended: true, limit: '1mb' }),
    limiter,
    routes
  );

  app.use('/webhooks', webhookRoutes);
  app.use('/webhooks', metaWebhookRoutes);
  app.use('/webhooks', bitrix24WebhookRoutes);

  // Bitrix24 marketplace app lifecycle (public).
  app.use('/', bitrix24AppRoutes);

  // Public /health (spec requires it at the root, in addition to
  // /api/health for the API-key-protected surface).
  app.use('/health', healthRoute);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
