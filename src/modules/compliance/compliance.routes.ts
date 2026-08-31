import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { addDays, today } from '../../lib/dates';
import { csvEnum, dateQuery, paginationSchema } from '../../lib/pagination';
import { auth, requireAuth } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import * as service from './compliance.service';

// Company-scoped routes carry no capability guard here: the base role is not
// the authority once a grant exists, and the company is not known until the
// service resolves it. Authorisation happens there, via assertCan().
export const complianceRouter = Router();
complianceRouter.use(requireAuth);

const calendarQuerySchema = paginationSchema.extend({
  companyId: z.string().uuid().optional(),
  authority: z.enum(['MCA', 'GST', 'INCOME_TAX', 'MSME', 'LABOUR']).optional(),
  status: csvEnum(['UPCOMING', 'DUE', 'OVERDUE', 'COMPLETED', 'WAIVED']),
  severity: csvEnum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  from: dateQuery,
  to: dateQuery,
  search: z.string().max(120).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

complianceRouter.get(
  '/calendar',
  validateQuery(calendarQuerySchema),
  asyncHandler(async (req, res) => {
    res.json(await service.listCalendar(auth(req), req.query as never));
  }),
);

complianceRouter.get(
  '/calendar/by-month',
  validateQuery(
    z.object({
      companyId: z.string().uuid(),
      from: dateQuery,
      to: dateQuery,
    }),
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { companyId: string; from?: Date; to?: Date };
    const from = q.from ?? addDays(today(), -30);
    const to = q.to ?? addDays(today(), 365);
    res.json(await service.calendarByMonth(auth(req), q.companyId, from, to));
  }),
);

complianceRouter.get(
  '/items/:id',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json(await service.getItemOrThrow(auth(req), req.params.id!));
  }),
);

complianceRouter.patch(
  '/items/:id/status',
  validateParams(idParam),
  validateBody(
    z.object({
      status: z.enum(['UPCOMING', 'DUE', 'OVERDUE', 'COMPLETED', 'WAIVED']),
      waivedReason: z.string().max(500).optional().nullable(),
      completedAt: z.string().datetime().optional(),
      /** Required to complete an ATTEST obligation that has no document attached. */
      attestation: z.string().max(1000).optional().nullable(),
      /** Required to complete a rule whose evidence carries a human signature. */
      signatoryName: z.string().max(160).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const item = await service.markItemStatus(me, req.params.id!, {
      status: req.body.status,
      waivedReason: req.body.waivedReason,
      completedAt: req.body.completedAt ? new Date(req.body.completedAt) : undefined,
      attestation: req.body.attestation,
      signatoryName: req.body.signatoryName,
      actorId: auth(req).userId,
    });
    await recordAudit({
      organizationId: me.organizationId,
      action: `item.${req.body.status.toLowerCase()}`,
      entityType: 'ComplianceItem',
      entityId: item.id,
      // The declaration itself goes into the audit trail, not just the fact of one.
      after: {
        status: item.status,
        waivedReason: item.waivedReason,
        attestation: item.attestationText,
        signatoryName: item.signatoryName,
      },
      req,
    });
    res.json(item);
  }),
);

/** Re-runs the engine for a company and reconciles the stored calendar. */
complianceRouter.post(
  '/companies/:id/sync',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const result = await service.syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'compliance.sync', entityType: 'Company', entityId: req.params.id!, after: result, req });
    res.json(result);
  }),
);

/** Every rule evaluated against this company, applicable or not, with reasons. */
complianceRouter.get(
  '/companies/:id/applicability',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json(await service.listApplicability(auth(req), req.params.id!));
  }),
);

/** "Why does this apply to me?" for one rule. */
complianceRouter.get(
  '/companies/:id/explain/:ruleCode',
  validateParams(z.object({ id: z.string().uuid(), ruleCode: z.string().max(60) })),
  asyncHandler(async (req, res) => {
    res.json(await service.explainForCompany(auth(req), req.params.id!, req.params.ruleCode!.toUpperCase()));
  }),
);

complianceRouter.post(
  '/refresh-statuses',
  asyncHandler(async (_req, res) => {
    res.json(await service.refreshStatuses());
  }),
);
