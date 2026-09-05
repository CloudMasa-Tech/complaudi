import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../lib/async';
import { BadRequestError, ForbiddenError } from '../../lib/errors';
import { previewCompanyImport } from '../../lib/companyDocumentImport';
import { serialiseBigInt } from '../../lib/prisma';
import { auth, requireAuth, requireCapability } from '../../middleware/auth';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { seesEveryCompany } from '../../lib/access';
import { recordAudit } from '../audit/audit.service';
import { syncCompany } from '../compliance/compliance.service';
import {
  createCompanySchema,
  directorSchema,
  gstRegistrationSchema,
  idParamSchema,
  listCompaniesQuerySchema,
  msmeRegistrationSchema,
  nestedIdParamSchema,
  updateCompanySchema,
} from './companies.schemas';
import * as service from './companies.service';

// Company-scoped routes carry no capability guard here: the base role is not
// the authority once a grant exists, and the company is not known until the
// service resolves it. Authorisation happens there, via assertCan().
/** MCA extracts are plain CSV; a few megabytes covers a whole state. */
const mcaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

/**
 * Reads a CSV or PDF and hands back what it found. Writes nothing.
 *
 * Onboarding has no company to import into yet, so the file is parsed and the
 * values are offered to the form for review. Guarded by the same capability as
 * creating a company, because that is the only thing this leads to.
 *
 * Declared before the `/:id` routes so that "import-preview" is never read as
 * a company id.
 */
companiesRouter.post(
  '/import-preview',
  requireCapability('company.create'),
  mcaUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError('Attach the file under the "file" field of a multipart request.');
    res.json({
      ...(await previewCompanyImport(req.file.buffer)),
      fileName: req.file.originalname,
    });
  }),
);

companiesRouter.get(
  '/',
  validateQuery(listCompaniesQuerySchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const rows = await service.listCompanies(me, req.query as never);
    res.json(serialiseBigInt(await service.withMyAccess(me, rows)));
  }),
);

/**
 * Onboarding in one call: company, directors, GST registrations and MSME
 * details, followed immediately by a first calendar build so the user lands on
 * a populated dashboard rather than an empty one.
 */
companiesRouter.post(
  '/',
  requireCapability('company.create'),
  validateBody(createCompanySchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const company = await service.createCompany(me, req.body);
    const sync = await syncCompany(me, company.id);

    await recordAudit({
      organizationId: me.organizationId,
      action: 'company.create',
      entityType: 'Company',
      entityId: company.id,
      after: { legalName: company.legalName, entityType: company.entityType },
      req,
    });

    res.status(201).json(serialiseBigInt({ company, sync }));
  }),
);

/**
 * Platform-wide onboarding view for the SUPER_ADMIN.
 *
 * Deliberately slim: only who onboarded each company, when, and which
 * organisation it landed in. It exposes none of a company's private profile
 * (GSTIN, PAN, CIN, directors, evidence) and no per-company membership rows are
 * created — access for this role is role-based, so nothing can duplicate on
 * re-run. Declared before the `/:id` routes so "onboarded-overview" is never
 * read as a company id.
 */
companiesRouter.get(
  '/onboarded-overview',
  asyncHandler(async (req, res) => {
    const me = auth(req);
    if (!seesEveryCompany(me.role)) {
      throw new ForbiddenError('Only the platform super admin can browse every onboarded company.');
    }
    res.json(serialiseBigInt(await service.listSuperAdminCompanies(me)));
  }),
);

companiesRouter.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const company = await service.getCompanyOrThrow(me, req.params.id!);
    res.json(serialiseBigInt((await service.withMyAccess(me, [company]))[0]));
  }),
);

/**
 * A profile change can change what applies — turnover crossing ₹5 crore adds
 * GSTR-9C and e-invoicing — so the calendar is rebuilt on every update.
 */
companiesRouter.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateCompanySchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const before = await service.getCompanyOrThrow(me, req.params.id!);
    const company = await service.updateCompany(me, req.params.id!, req.body);
    const sync = await syncCompany(me, company.id);

    await recordAudit({
      organizationId: me.organizationId,
      action: 'company.update',
      entityType: 'Company',
      entityId: company.id,
      before: { annualTurnover: before.annualTurnover, employeeCount: before.employeeCount, agmDate: before.agmDate },
      after: { annualTurnover: company.annualTurnover, employeeCount: company.employeeCount, agmDate: company.agmDate },
      req,
    });

    res.json(serialiseBigInt({ company, sync }));
  }),
);

/** Archive: reversible, keeps the history, hides it from every org-wide view. */
companiesRouter.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const company = await service.archiveCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'company.archive', entityType: 'Company', entityId: company.id, req });
    res.json(serialiseBigInt(company));
  }),
);

companiesRouter.post(
  '/:id/restore',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const company = await service.restoreCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'company.restore', entityType: 'Company', entityId: company.id, req });
    res.json(serialiseBigInt(company));
  }),
);

/**
 * Company-scoped invite: brings a new person into this one company only.
 *
 * Deliberately separate from the org-wide users.manage path — a COMPANY_OWNER
 * may grow their own company's team (a CA or an admin) but never touch anyone
 * outside it, even if they are later added to a shared organisation.
 */
companiesRouter.post(
  '/:id/invite',
  validateParams(idParamSchema),
  validateBody(
    z.object({
      email: z.string().email().toLowerCase(),
      name: z.string().min(2).max(120),
      role: z.enum(['ADMIN', 'CA', 'VIEWER']).default('CA'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const result = await service.inviteToCompany(me, req.params.id!, {
      email: req.body.email,
      name: req.body.name,
      role: req.body.role,
    });
    await recordAudit({
      organizationId: me.organizationId,
      actorId: me.userId,
      action: 'company.invite',
      entityType: 'Company',
      entityId: req.params.id!,
      after: { email: result.user.email, role: result.user.role, company: req.params.id },
      req,
    });
    res.status(201).json(result);
  }),
);

/** The team already inside a company, for the inviter's own company view. */
companiesRouter.get(
  '/:id/members',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.listCompanyMembers(auth(req), req.params.id!));
  }),
);

/** What a permanent delete would destroy, so the confirmation is informed. */
companiesRouter.get(
  '/:id/deletion-impact',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.deletionImpact(auth(req), req.params.id!));
  }),
);

/**
 * Irreversible, and restricted to the OWNER. The request must echo the legal
 * name — a compliance history is not something to lose to a stray click.
 */
companiesRouter.post(
  '/:id/permanent-delete',
  validateParams(idParamSchema),
  validateBody(z.object({ confirmation: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const before = await service.getCompanyOrThrow(me, req.params.id!);
    const snapshot = { legalName: before.legalName, cin: before.cin, entityType: before.entityType };

    let result;
    try {
      result = await service.deleteCompanyPermanently(me, req.params.id!, req.body.confirmation);
    } catch (err) {
      // A rejected attempt is worth recording in its own right — somebody tried
      // to destroy a compliance history. Logging it as `permanent_delete` would
      // make the trail claim a deletion that never happened.
      await recordAudit({
        organizationId: me.organizationId,
        action: 'company.permanent_delete_rejected',
        entityType: 'Company',
        entityId: before.id,
        before: snapshot,
        req,
      });
      throw err;
    }

    // Written after the fact, from the snapshot taken before: the company row is
    // gone, but AuditLog hangs off the organization, so the record survives it.
    await recordAudit({
      organizationId: me.organizationId,
      action: 'company.permanent_delete',
      entityType: 'Company',
      entityId: before.id,
      before: snapshot,
      after: result,
      req,
    });

    res.json({ deleted: true, legalName: before.legalName, ...result });
  }),
);

/**
 * Fill the profile from an MCA master-data extract.
 *
 * Nothing here contacts MCA — this reads a CSV you downloaded from them
 * (data.gov.in, or the state-wise extracts on the MCA portal).
 */
companiesRouter.post(
  '/:id/import-mca',
  validateParams(idParamSchema),
  mcaUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError('Attach the CSV under the "file" field of a multipart request.');

    const me = auth(req);
    const result = await service.importMcaMasterData(me, req.params.id!, req.file.buffer.toString('utf8'));
    const sync = await syncCompany(me, req.params.id!);

    await recordAudit({
      organizationId: me.organizationId,
      action: 'company.import_mca',
      entityType: 'Company',
      entityId: req.params.id!,
      after: { applied: result.applied, matchedBy: result.matchedBy, file: req.file.originalname },
      req,
    });

    res.json({ ...result, sync });
  }),
);

// ---------------------------------------------------------------- directors

companiesRouter.post(
  '/:id/directors',
  validateParams(idParamSchema),
  validateBody(directorSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const director = await service.addDirector(me, req.params.id!, req.body);
    await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'director.add', entityType: 'Director', entityId: director.id, after: director, req });
    res.status(201).json(director);
  }),
);

companiesRouter.patch(
  '/:id/directors/:childId',
  validateParams(nestedIdParamSchema),
  validateBody(directorSchema.partial()),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const director = await service.updateDirector(me, req.params.id!, req.params.childId!, req.body);
    await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'director.update', entityType: 'Director', entityId: director.id, after: director, req });
    res.json(director);
  }),
);

companiesRouter.delete(
  '/:id/directors/:childId',
  validateParams(nestedIdParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    await service.removeDirector(me, req.params.id!, req.params.childId!);
    await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'director.remove', entityType: 'Director', entityId: req.params.childId!, req });
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------- GST

companiesRouter.post(
  '/:id/gst-registrations',
  validateParams(idParamSchema),
  validateBody(gstRegistrationSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const registration = await service.addGstRegistration(me, req.params.id!, req.body);
    const sync = await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'gst.add', entityType: 'GstRegistration', entityId: registration.id, after: registration, req });
    res.status(201).json({ registration, sync });
  }),
);

companiesRouter.patch(
  '/:id/gst-registrations/:childId',
  validateParams(nestedIdParamSchema),
  validateBody(gstRegistrationSchema.partial()),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const registration = await service.updateGstRegistration(me, req.params.id!, req.params.childId!, req.body);
    const sync = await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'gst.update', entityType: 'GstRegistration', entityId: registration.id, after: registration, req });
    res.json({ registration, sync });
  }),
);

companiesRouter.delete(
  '/:id/gst-registrations/:childId',
  validateParams(nestedIdParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    await service.removeGstRegistration(me, req.params.id!, req.params.childId!);
    const sync = await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'gst.remove', entityType: 'GstRegistration', entityId: req.params.childId!, req });
    res.json({ sync });
  }),
);

// ---------------------------------------------------------------- MSME

companiesRouter.put(
  '/:id/msme-registration',
  validateParams(idParamSchema),
  validateBody(msmeRegistrationSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const registration = await service.upsertMsmeRegistration(me, req.params.id!, req.body);
    const sync = await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'msme.upsert', entityType: 'MsmeRegistration', entityId: registration.id, after: registration, req });
    res.json({ registration, sync });
  }),
);

companiesRouter.delete(
  '/:id/msme-registration',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    await service.removeMsmeRegistration(me, req.params.id!);
    const sync = await syncCompany(me, req.params.id!);
    await recordAudit({ organizationId: me.organizationId, action: 'msme.remove', entityType: 'MsmeRegistration', entityId: req.params.id!, req });
    res.json({ sync });
  }),
);

/**
 * Event logging for compliance event-based rules.
 *
 * Log a triggering event (director change, share allotment, charge creation,
 * resolution passage). The deadline is computed as N days from this date
 * when the sync runs and the EVENT_BASED rules evaluate.
 *
 * @body eventType one of: DIR-12, PAS-3, CHG-1, MGT-14
 * @body eventDate ISO date string (the date of the triggering event)
 * @body metadata optional rule-specific data
 */
companiesRouter.post(
  '/:id/events',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const company = await service.logComplianceEvent(me, req.params.id!, req.body);
    const sync = await syncCompany(me, req.params.id!);
    res.json({ event: company.events![company.events!.length - 1], sync });
  }),

);

/**
 * List all logged compliance events for a company.
 * Useful for the UI "Events" tab to show what deadlines are active.
 */
companiesRouter.get(
  '/:id/events',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const events = await service.getComplianceEvents(me, req.params.id!);
    res.json(events);
  }),
);
// ---------------------------------------------------------------- directors
