const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('whatsapp-b24-integration'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(9191),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required. See .env.example'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_FILE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  API_KEYS: z.string().default(''),
  CORS_ORIGIN: z.string().default('*'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  RETRY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  OUTGOING_MAX_RETRIES: z.coerce.number().int().positive().max(10).default(3),

  WHATSBOX_API_URL: z.string().url().default('https://api.whatsbox.io'),
  WHATSBOX_API_KEY: z.string().default(''),
  WHATSBOX_CHANNEL_ID: z.string().default(''),
  WHATSBOX_WEBHOOK_SECRET: z.string().default(''),
  // Default WhatsApp webhook URL used for a tenant when none is saved.
  WHATSAPP_WEBHOOK_URL: z.string().default(''),

  META_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_ACCESS_TOKEN: z.string().default(''),
  META_PHONE_NUMBER_ID: z.string().default(''),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default(''),

  BITRIX24_WEBHOOK_URL: z.string().default(''),
  BITRIX24_WEBHOOK_SECRET: z.string().default(''),

  // Marketplace app / OAuth. `BITRIX24_MEMBER_ID` pins the middleware to
  // a single portal in dev; leave empty to use the most recent install.
  BITRIX24_CLIENT_ID: z.string().default(''),
  BITRIX24_CLIENT_SECRET: z.string().default(''),
  BITRIX24_MEMBER_ID: z.string().default(''),
  BITRIX24_OAUTH_TOKEN_URL: z.string().url().default('https://oauth.bitrix.info/oauth/token/'),

  // Public URL of this app (used to build event-handler URLs for B24).
  APP_BASE_URL: z.string().default(''),

  // Open Channels connector id registered on every portal (must match
  // Bitrix24's rules: lowercase, no dots, underscore separator, e.g.
  // wa_whatsapp). The connector name/icon come from the connector service.
  BITRIX24_CONNECTOR_ID: z
    .string()
    .default('wa_whatsapp')
    .transform((v) => String(v).trim()),

  // Optional: open line (LINE) id for automatic activation. When set, the
  // connector is activated + bound to this line on install; otherwise the
  // operator activates it from the Contact Center placement page
  // (GET /app/connector) and the line id is stored on the install row.
  BITRIX24_OPENLINE_ID: z.coerce.number().int().nonnegative().default(0),

  // Operator routing (Phase 6): how incoming chats are auto-assigned.
  // ROUTING_STRATEGY: least-loaded (fewest open chats first) or
  // round-robin (longest-waiting agent first, LRU).
  ROUTING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ROUTING_STRATEGY: z.enum(['least-loaded', 'round-robin']).default('least-loaded'),
  ROUTING_MAX_ACTIVE_PER_AGENT: z.coerce.number().int().positive().max(1000).default(100),
  ROUTING_EXCLUDE_SUPERVISORS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Open Lines Connector Module feature flag (default: false)
  ENABLE_OPENLINES_CONNECTOR: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n[CONFIG ERROR] Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('Fix your .env file (see .env.example) and restart.\n');
  process.exit(1);
}

const env = parsed.data;

module.exports = {
  env,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',

  apiKeys: env.API_KEYS.split(',')
    .map((key) => key.trim())
    .filter(Boolean),
};
