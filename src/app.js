const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { env, isProduction } = require('./config');
const requestLogger = require('./middlewares/requestLogger');
const limiter = require('./middlewares/rateLimiter');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const routes = require('./routes');
const webhookRoutes = require('./routes/webhook.route');
const bitrix24WebhookRoutes = require('./routes/bitrix24Webhook.route');
const smsWebhookRoutes = require('./routes/smsWebhook.route');
const bitrix24AppRoutes = require('./routes/bitrix24App.route');
const healthRoute = require('./routes/health.route');

/**
 * Express application factory.
 */
function createApp() {
  const app = express();

  if (env.TRUST_PROXY || isProduction) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  
  // Configure Helmet allowing inline styles & Google Fonts for Dashboard UI.
  // frameguard is disabled because Bitrix24 embeds the app handler in its
  // own iframe; X-Frame-Options: SAMEORIGIN would block it ("refused to
  // connect").
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
    })
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    })
  );

  app.use(requestLogger);

  // Serve static public assets (Admin Dashboard UI)
  app.use(express.static(path.join(__dirname, '../public')));

  app.use(
    '/api',
    express.json({ limit: '5mb' }),
    express.urlencoded({ extended: true, limit: '1mb' }),
    limiter,
    routes
  );

  app.use('/webhooks', webhookRoutes);
  app.use('/webhooks', bitrix24WebhookRoutes);
  app.use('/webhooks', smsWebhookRoutes);

  // Bitrix24 marketplace app lifecycle (public).
  app.use('/', bitrix24AppRoutes);

  // Public /health
  app.use('/health', healthRoute);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
