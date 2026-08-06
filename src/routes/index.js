const { Router } = require('express');
const { authenticate } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');
const healthRoute = require('./health.route');
const authRoute = require('./auth.route');
const tenantRoute = require('./tenant.route');
const dashboardRoute = require('./dashboard.route');
const messageRoute = require('./message.route');
const contactRoute = require('./contact.route');
const conversationRoute = require('./conversation.route');
const settingRoute = require('./setting.route');
const adminRoute = require('./admin.route');
const agentRoute = require('./agent.route');
const templateRoute = require('./template.route');
const campaignRoute = require('./campaign.route');

const connectorRoute = require('./connector.route');

const router = Router();

// Health check is public
router.use('/health', healthRoute);

// Public Open Lines connector endpoints (Bitrix24 iframe & OAuth callbacks)
router.use('/connector', connectorRoute);

// Auth endpoints (login, me, logout)
router.use('/auth', authRoute);

// Tenant management & setup wizard endpoints
router.use('/tenant', tenantRoute);

// Dashboard analytics & activity metrics
router.use('/dashboard', dashboardRoute);

// Tenant-scoped API endpoints (support both JWT Auth and API Key Auth)
router.use(authenticate, tenantContext);

router.use('/messages', messageRoute);
router.use('/contacts', contactRoute);
router.use('/conversations', conversationRoute);
router.use('/settings', settingRoute);
router.use('/admin', adminRoute);
router.use('/agents', agentRoute);
router.use('/templates', templateRoute);
router.use('/campaigns', campaignRoute);

module.exports = router;
