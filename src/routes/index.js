const { Router } = require('express');
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const healthRoute = require('./health.route');
const messageRoute = require('./message.route');
const contactRoute = require('./contact.route');
const conversationRoute = require('./conversation.route');
const settingRoute = require('./setting.route');
const adminRoute = require('./admin.route');
const agentRoute = require('./agent.route');
const templateRoute = require('./template.route');

const router = Router();

// Health is public (load balancers / uptime checks); everything after it
// requires a valid API key.
router.use('/health', healthRoute);
router.use(apiKeyAuth);
router.use('/messages', messageRoute);
router.use('/contacts', contactRoute);
router.use('/conversations', conversationRoute);
router.use('/settings', settingRoute);
router.use('/admin', adminRoute);
router.use('/agents', agentRoute);
router.use('/templates', templateRoute);

module.exports = router;
