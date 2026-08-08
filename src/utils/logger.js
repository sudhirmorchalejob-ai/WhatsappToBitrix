const path = require('path');
const winston = require('winston');
const { env, isProduction } = require('../config');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ timestamp, level, message, module, stack, ...meta }) => {
  const label = module ? ` [${module}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}${label}: ${stack || message}${metaStr}`;
});

const transports = [
  new winston.transports.Console({
    format: combine(colorize({ all: isProduction ? false : true }), timestamp(), logFormat),
  }),
];

if (env.LOG_FILE_ENABLED) {
  const logsDir = path.resolve(process.cwd(), 'src', 'logs');
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
      format: combine(timestamp(), logFormat),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
      format: combine(timestamp(), logFormat),
    })
  );
}

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: errors({ stack: true }),
  transports,
  exitOnError: false,
});

logger.childFor = (moduleName) => logger.child({ module: moduleName });

module.exports = logger;
