const { Router } = require('express');
const { defaultController: dashboardController } = require('../controllers/dashboard.controller');
const { authenticate, requireAuth } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');

const router = Router();

router.use(authenticate, requireAuth, tenantContext);

router.get('/stats', dashboardController.getStats);
router.get('/trends', dashboardController.getTrends);
router.get('/activities', dashboardController.getActivities);
router.get('/history', dashboardController.getHistory);

module.exports = router;
