import type { AuthResponse } from '@rideshare/types';
import {
  confirmPasswordResetSchema,
  loginSchema,
  refreshTokenSchema,
  registerDriverSchema,
  registerPassengerSchema,
  requestPasswordResetSchema,
} from '@rideshare/validation';
import { Router, type Request } from 'express';
import { requireAuth } from '../middleware/auth';
import { loginLimiter, passwordResetLimiter, registerLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { sendSuccess } from '../lib/respond';
import { UnauthorizedError } from '../lib/errors';
import * as authService from '../services/authService';

export const authRouter = Router();

function requestContext(req: Request): authService.RequestContext {
  return {
    userAgent: req.header('user-agent'),
    ipAddress: req.ip,
  };
}

authRouter.post(
  '/auth/passengers/register',
  registerLimiter,
  validateBody(registerPassengerSchema),
  async (req, res) => {
    const result: AuthResponse = await authService.registerPassenger(req.body, requestContext(req));
    sendSuccess(req, res, result, 201);
  },
);

authRouter.post(
  '/auth/drivers/register',
  registerLimiter,
  validateBody(registerDriverSchema),
  async (req, res) => {
    const result: AuthResponse = await authService.registerDriver(req.body, requestContext(req));
    sendSuccess(req, res, result, 201);
  },
);

authRouter.post('/auth/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const result: AuthResponse = await authService.login(req.body, requestContext(req));
  sendSuccess(req, res, result);
});

authRouter.post('/auth/refresh', validateBody(refreshTokenSchema), async (req, res) => {
  const result: AuthResponse = await authService.refresh(
    req.body.refreshToken,
    requestContext(req),
  );
  sendSuccess(req, res, result);
});

authRouter.post('/auth/logout', validateBody(refreshTokenSchema), async (req, res) => {
  await authService.logout(req.body.refreshToken);
  sendSuccess(req, res, { loggedOut: true });
});

authRouter.post(
  '/auth/password-reset/request',
  passwordResetLimiter,
  validateBody(requestPasswordResetSchema),
  async (req, res) => {
    const result = await authService.requestPasswordReset(req.body.email);
    // Always 200 with the same shape whether or not the account exists —
    // see authService.requestPasswordReset for why.
    sendSuccess(req, res, result);
  },
);

authRouter.post(
  '/auth/password-reset/confirm',
  passwordResetLimiter,
  validateBody(confirmPasswordResetSchema),
  async (req, res) => {
    await authService.confirmPasswordReset(req.body);
    sendSuccess(req, res, { passwordReset: true });
  },
);

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const user = await authService.getMe(req.auth.userId);
  sendSuccess(req, res, user);
});
