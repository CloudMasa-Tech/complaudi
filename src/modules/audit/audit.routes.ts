import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { dateQuery, paginationSchema } from '../../lib/pagination';
import { auth, requireAuth, requireCapability } from '../../middleware/auth';
import { validateQuery } from '../../middleware/validate';
import { listAuditLogs, type AuditQuery } from './audit.service';

export const auditRouter = Router();
auditRouter.use(requireAuth, requireCapability('audit.read'));

auditRouter.get(
  '/',
  validateQuery(
    paginationSchema.extend({
      entityType: z.string().max(60).optional(),
      entityId: z.string().max(60).optional(),
      action: z.string().max(60).optional(),
      actorId: z.string().uuid().optional(),
      from: dateQuery,
      to: dateQuery,
    }),
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Omit<AuditQuery, 'organizationId'>;
    res.json(await listAuditLogs({ organizationId: auth(req).organizationId, ...q }));
  }),
);
