const { Router } = require('express');
const { defaultController: authController } = require('../controllers/auth.controller');
const { authenticate, requireAuth } = require('../middlewares/authMiddleware');

const router = Router();

router.post('/login', authController.login);
router.get('/me', authenticate, requireAuth, authController.me);
router.post('/logout', authenticate, requireAuth, authController.logout);

module.exports = router;
