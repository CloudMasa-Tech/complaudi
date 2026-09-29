/**
 * The review surface for the regulatory watch.
 *
 * Reading is open to anyone who may read the rule engine; deciding is not.
 * Approving an overlay changes what every company in the installation owes, so
 * it sits behind `rules.amend`, which only the super admin holds.
 */
import { Router } from 'express';
import { z } from 'zod';
import { describePredicates, predicateNames } from '../../engine/predicates';
import { asyncHandler } from '../../lib/async';
import { actor, requireAuth, requireCapability } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import {
  approveProposalSchema,
  createOverlaySchema,
  listProposalsQuerySchema,
  listUpdatesQuerySchema,
  rejectProposalSchema,
  revokeOverlaySchema,
  runWatchSchema,
} from './regulatory.schemas';
import {
  approveProposal,
  createOverlay,
  listOverlays,
  listProposals,
  listUpdates,
  refreshOverlays,
  rejectProposal,
  revokeOverlay,
  runRegulatorySweep,
  watchStatus,
} from './regulatory.service';

const idParam = z.object({ id: z.string().uuid() });

export const regulatoryRouter = Router();

regulatoryRouter.use(requireAuth);

// ------------------------------------------------------------------- reading

regulatoryRouter.get(
  '/status',
  requireCapability('rules.read'),
  asyncHandler(async (_req, res) => {
    res.json(await watchStatus());
  }),
);

/**
 * The vocabulary an overlay may use. Served rather than documented, so the
 * review UI and anyone writing an overlay by hand always see what this build
 * actually supports rather than what the README said last quarter.
 */
regulatoryRouter.get(
  '/vocabulary',
  requireCapability('rules.read'),
  asyncHandler(async (_req, res) => {
    res.json({ predicates: predicateNames(), reference: describePredicates() });
  }),
);

regulatoryRouter.get(
  '/updates',
  requireCapability('rules.read'),
  validateQuery(listUpdatesQuerySchema),
  asyncHandler(async (req, res) => {
    const { authority, limit, cursor } = req.query as unknown as z.infer<typeof listUpdatesQuerySchema>;
    const updates = await listUpdates({ authority, limit, cursor });
    res.json({ updates, nextCursor: updates.length === limit ? updates[updates.length - 1]!.id : null });
  }),
);

regulatoryRouter.get(
  '/proposals',
  requireCapability('rules.read'),
  validateQuery(listProposalsQuerySchema),
  asyncHandler(async (req, res) => {
    const { status, ruleCode, limit, cursor } = req.query as unknown as z.infer<typeof listProposalsQuerySchema>;
    const proposals = await listProposals({ status, ruleCode, limit, cursor });
    res.json({ proposals, nextCursor: proposals.length === limit ? proposals[proposals.length - 1]!.id : null });
  }),
);

regulatoryRouter.get(
  '/overlays',
  requireCapability('rules.read'),
  validateQuery(z.object({ status: z.enum(['ACTIVE', 'REVOKED']).optional() })),
  asyncHandler(async (req, res) => {
    res.json({ overlays: await listOverlays({ status: req.query.status as 'ACTIVE' | 'REVOKED' | undefined }) });
  }),
);

// ------------------------------------------------------------------ deciding

regulatoryRouter.post(
  '/proposals/:id/approve',
  requireCapability('rules.amend'),
  validateParams(idParam),
  validateBody(approveProposalSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await approveProposal(actor(req), req.params.id!, req.body));
  }),
);

regulatoryRouter.post(
  '/proposals/:id/reject',
  requireCapability('rules.amend'),
  validateParams(idParam),
  validateBody(rejectProposalSchema),
  asyncHandler(async (req, res) => {
    res.json({ proposal: await rejectProposal(actor(req), req.params.id!, req.body) });
  }),
);

/** An overlay with no proposal behind it — an amendment someone read themselves. */
regulatoryRouter.post(
  '/overlays',
  requireCapability('rules.amend'),
  validateBody(createOverlaySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createOverlay(actor(req), req.body));
  }),
);

regulatoryRouter.post(
  '/overlays/:id/revoke',
  requireCapability('rules.amend'),
  validateParams(idParam),
  validateBody(revokeOverlaySchema),
  asyncHandler(async (req, res) => {
    res.json(await revokeOverlay(actor(req), req.params.id!, req.body.reason));
  }),
);

/**
 * Re-apply what is in the database.
 *
 * Only needed after a direct database edit, or on a replica that missed an
 * approval — every approval and revocation already refreshes in-process.
 */
regulatoryRouter.post(
  '/overlays/refresh',
  requireCapability('rules.amend'),
  asyncHandler(async (_req, res) => {
    res.json(await refreshOverlays());
  }),
);

/**
 * Run a sweep now.
 *
 * Synchronous and slow — a research pass across six authorities takes minutes
 * and costs real money. It is here for chasing a circular someone already knows
 * about; the scheduled job is the normal path.
 */
regulatoryRouter.post(
  '/sweep',
  requireCapability('rules.amend'),
  validateBody(runWatchSchema),
  asyncHandler(async (req, res) => {
    const result = await runRegulatorySweep({
      authorities: req.body.authorities,
      lookbackDays: req.body.lookbackDays,
    });
    res.json(result);
  }),
);
