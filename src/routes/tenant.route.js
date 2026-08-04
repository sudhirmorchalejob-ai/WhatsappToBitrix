const { Router } = require('express');
const { defaultController: tenantController } = require('../controllers/tenant.controller');
const { authenticate, requireAuth, requireRole } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');

const router = Router();

router.use(authenticate, tenantContext);

// Tenant Admin Setup & Integration Settings
router.get('/setup-status', requireAuth, tenantController.getSetupStatus);
router.post('/setup', requireAuth, tenantController.saveSetup);
router.post('/test-connection', requireAuth, tenantController.testConnection);
router.post('/sync', requireAuth, tenantController.syncNow);

// Tenant Onboarding & Management
router.post('/create', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), tenantController.createTenant);
router.get('/list', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), tenantController.listTenants);

module.exports = router;
