import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { auth, requireAuth } from '../../middleware/auth';
import { validateParams, validateQuery } from '../../middleware/validate';
import * as service from './dashboard.service';

// Company-scoped routes carry no capability guard here: the base role is not
// the authority once a grant exists, and the company is not known until the
// service resolves it. Authorisation happens there, via assertCan().
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });

/** Org-wide, or scoped to one company with ?companyId=. */
dashboardRouter.get(
  '/overview',
  validateQuery(z.object({ companyId: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const { companyId } = req.query as { companyId?: string };
    res.json(await service.getOverview(auth(req), companyId));
  }),
);

dashboardRouter.get(
  '/score',
  validateQuery(z.object({ companyId: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const { companyId } = req.query as { companyId?: string };
    res.json(await service.computeScore(auth(req), companyId));
  }),
);

dashboardRouter.get(
  '/score/:id/history',
  validateParams(idParam),
  validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(365).default(90) })),
  asyncHandler(async (req, res) => {
    const { limit } = req.query as unknown as { limit: number };
    res.json(await service.scoreHistory(auth(req), req.params.id!, limit));
  }),
);

dashboardRouter.post(
  '/score/:id/snapshot',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.snapshotScore(auth(req), req.params.id!));
  }),
);
