const { sendSuccess } = require('../utils/ApiResponse');
const { env, isProduction } = require('../config');
const pkg = require('../../package.json');

function getHealth(req, res) {
  const payload = {
    status: 'ok',
    app: env.APP_NAME,
    version: pkg.version,
    environment: env.NODE_ENV,
    isProduction,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  return sendSuccess(res, payload);
}

module.exports = { getHealth };
