import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { BadRequestError } from '../../lib/errors';
import { paginationSchema } from '../../lib/pagination';
import { auth, requireAuth } from '../../middleware/auth';
import { validateParams, validateQuery } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import * as service from './documents.service';

/** Evidence is typically a PDF challan or acknowledgement; images and sheets happen too. */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'text/plain',
  'application/zip',
  'application/xml',
  'text/xml',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new BadRequestError(`Files of type ${file.mimetype} are not accepted`));
      return;
    }
    cb(null, true);
  },
});

// Company-scoped routes carry no capability guard here: the base role is not
// the authority once a grant exists, and the company is not known until the
// service resolves it. Authorisation happens there, via assertCan().
export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });

documentsRouter.get(
  '/',
  validateQuery(
    paginationSchema.extend({
      companyId: z.string().uuid().optional(),
      complianceItemId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
      search: z.string().max(120).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await service.listDocuments(auth(req), req.query as never));
  }),
);

const uploadBodySchema = z.object({
  companyId: z.string().uuid('companyId is required'),
  complianceItemId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  label: z.string().max(200).optional(),
});

documentsRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError('Attach the file under the "file" field of a multipart/form-data request');

    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        'Invalid upload metadata',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }

    const me = auth(req);
    const { document, deduplicated } = await service.uploadDocument({
      actor: me,
      uploadedById: me.userId,
      companyId: parsed.data.companyId,
      complianceItemId: parsed.data.complianceItemId ?? null,
      taskId: parsed.data.taskId ?? null,
      label: parsed.data.label ?? null,
      file: req.file,
    });

    if (!deduplicated) {
      await recordAudit({
        organizationId: me.organizationId,
        action: 'document.upload',
        entityType: 'Document',
        entityId: document.id,
        after: { fileName: document.fileName, sizeBytes: document.sizeBytes, complianceItemId: document.complianceItemId },
        req,
      });
    }

    res.status(deduplicated ? 200 : 201).json({ document, deduplicated });
  }),
);

documentsRouter.get(
  '/:id/download',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const result = await service.getDownload(auth(req), req.params.id!);

    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }

    res.setHeader('Content-Type', result.document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.document.fileName)}"`);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.send(result.buffer);
  }),
);

documentsRouter.delete(
  '/:id',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const doc = await service.deleteDocument(me, req.params.id!);
    await recordAudit({
      organizationId: me.organizationId,
      action: 'document.delete',
      entityType: 'Document',
      entityId: doc.id,
      before: { fileName: doc.fileName, storageKey: doc.storageKey },
      req,
    });
    res.status(204).send();
  }),
);

/** Which obligations still have no evidence attached. */
documentsRouter.get(
  '/coverage/:id',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json(await service.evidenceCoverage(auth(req), req.params.id!));
  }),
);
