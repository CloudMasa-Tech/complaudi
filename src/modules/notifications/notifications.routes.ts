import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { boolish } from '../../lib/boolish';
import { paginationSchema } from '../../lib/pagination';
import { auth, requireAuth, requireCapability } from '../../middleware/auth';
import { validateBody, validateQuery } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import * as service from './notifications.service';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  validateQuery(paginationSchema.extend({ unreadOnly: boolish(false) })),
  asyncHandler(async (req, res) => {
    res.json(await service.listNotifications(auth(req).userId, req.query as never));
  }),
);

notificationsRouter.post(
  '/read',
  validateBody(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })),
  asyncHandler(async (req, res) => {
    res.json(await service.markRead(auth(req).userId, req.body.ids));
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    res.json(await service.markAllRead(auth(req).userId));
  }),
);

/** Triggers the reminder sweep on demand — the nightly job calls the same code. */
notificationsRouter.post(
  '/sweep',
  requireCapability('audit.read'),
  asyncHandler(async (req, res) => {
    const { organizationId } = auth(req);
    const result = await service.runReminderSweep({ organizationId });
    await recordAudit({ organizationId, action: 'notifications.sweep', entityType: 'Notification', after: result, req });
    res.json(result);
  }),
);
