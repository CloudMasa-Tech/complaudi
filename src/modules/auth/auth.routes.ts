import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/async';
import { auth, requireAuth, requireCapability } from '../../middleware/auth';
import { z } from 'zod';
import { validateBody, validateParams } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import { inviteSchema, loginSchema, refreshSchema, registerSchema, trialSignupSchema } from './auth.schemas';
import * as service from './auth.service';

/** Credential endpoints get a tighter limit than the rest of the API. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } },
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await service.register(req.body);
    await recordAudit({
      organizationId: result.user.organizationId,
      actorId: result.user.id,
      actorEmail: result.user.email,
      action: 'auth.register',
      entityType: 'Organization',
      entityId: result.user.organizationId,
      req,
    });
    res.status(201).json(result);
  }),
);

/** Public self-service enrolment: organisation, person, company and calendar. */
authRouter.post(
  '/register-trial',
  authLimiter,
  validateBody(trialSignupSchema),
  asyncHandler(async (req, res) => {
    const result = await service.registerTrial(req.body);
    await recordAudit({
      organizationId: result.user.organizationId,
      actorId: result.user.id,
      actorEmail: result.user.email,
      action: 'auth.register_trial',
      entityType: 'Organization',
      entityId: result.user.organizationId,
      after: { company: req.body.companyName, trialEndsAt: result.trialEndsAt, cin: req.body.cin ?? null },
      req,
    });
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await service.login(req.body);
    await recordAudit({
      organizationId: result.user.organizationId,
      actorId: result.user.id,
      actorEmail: result.user.email,
      action: 'auth.login',
      entityType: 'User',
      entityId: result.user.id,
      req,
    });
    res.json(result);
  }),
);

authRouter.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.refresh(req.body.refreshToken));
  }),
);

authRouter.post(
  '/logout',
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    await service.logout(req.body.refreshToken);
    res.status(204).send();
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await service.logoutEverywhere(auth(req).userId);
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.getProfile(auth(req).userId));
  }),
);

authRouter.get(
  '/users',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.listUsers(auth(req)));
  }),
);

authRouter.post(
  '/users',
  requireAuth,
  requireCapability('users.manage'),
  validateBody(inviteSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const user = await service.inviteUser(me, req.body);
    await recordAudit({
      organizationId: me.organizationId,
      action: 'user.invite',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, role: user.role, grantedCompanies: user.memberships.length },
      req,
    });
    res.status(201).json(user);
  }),
);

/** Change a user's role, or deactivate them. */
authRouter.patch(
  '/users/:id',
  requireAuth,
  requireCapability('users.manage'),
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(
    z.object({
      name: z.string().min(2).max(120).optional(),
      email: z.string().email().toLowerCase().optional(),
      role: z.enum(['SUPER_ADMIN', 'ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER']).optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const user = await service.updateUser(me, req.params.id!, req.body);
    await recordAudit({
      organizationId: me.organizationId,
      action: 'user.update',
      entityType: 'User',
      entityId: user.id,
      after: { name: user.name, email: user.email, role: user.role, isActive: user.isActive },
      req,
    });
    res.json(user);
  }),
);

/** Sets a new password for someone. Returns it once, to be handed over. */
authRouter.post(
  '/users/:id/reset-password',
  requireAuth,
  requireCapability('users.manage'),
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(z.object({ password: z.string().max(128).optional() })),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const result = await service.resetPassword(me, req.params.id!, req.body.password);
    await recordAudit({
      organizationId: me.organizationId,
      action: 'user.password_reset',
      entityType: 'User',
      entityId: result.user.id,
      // Deliberately not the password itself.
      after: { email: result.user.email, generated: result.generated, sessionsRevoked: true },
      req,
    });
    res.json(result);
  }),
);

/** Changing your own password, proving you know the current one. */
authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(z.object({ currentPassword: z.string().min(1), newPassword: z.string().max(128) })),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const tokens = await service.changeOwnPassword(me.userId, req.body.currentPassword, req.body.newPassword);
    await recordAudit({
      organizationId: me.organizationId,
      action: 'user.password_changed',
      entityType: 'User',
      entityId: me.userId,
      req,
    });
    res.json(tokens);
  }),
);

/**
 * Replaces which companies a user may see, wholesale. Sending an empty list
 * revokes everything, which is how you cut off access without deleting anyone.
 */
authRouter.put(
  '/users/:id/access',
  requireAuth,
  requireCapability('users.manage'),
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(
    z.object({
      grants: z
        .array(
          z.object({
            companyId: z.string().uuid(),
            // Everything but SUPER_ADMIN, which is organisation-wide.
            role: z.enum(['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER']).default('CA'),
          }),
        )
        .max(500),
    }),
  ),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const grants = await service.setCompanyAccess(me, req.params.id!, req.body.grants);
    await recordAudit({
      organizationId: me.organizationId,
      action: 'user.access_set',
      entityType: 'User',
      entityId: req.params.id!,
      after: { companies: grants.map((g) => g.company.legalName) },
      req,
    });
    res.json(grants);
  }),
);
