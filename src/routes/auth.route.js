const { Router } = require('express');
const { validate } = require('../validators');
const { forgotPasswordSchema, resetPasswordSchema } = require('../validators');
const { defaultController: authController } = require('../controllers/auth.controller');
const { authenticate, requireAuth } = require('../middlewares/authMiddleware');

const router = Router();

router.post('/login', authController.login);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.get('/me', authenticate, requireAuth, authController.me);
router.post('/logout', authenticate, requireAuth, authController.logout);

module.exports = router;
