import type { Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError, UnprocessableError } from '../../lib/errors';
import { inspectUpload } from '../../lib/fileInspection';
import { prisma } from '../../lib/prisma';
import { buildStorageKey, sha256, storage } from '../../lib/storage';
import { getCompanyOrThrow } from '../companies/companies.service';
import { assertCan, companyScope, type Actor } from '../../lib/access';

export interface UploadInput {
  actor: Actor;
  companyId: string;
  uploadedById: string;
  complianceItemId?: string | null;
  taskId?: string | null;
  label?: string | null;
  file: { originalname: string; mimetype: string; buffer: Buffer; size: number };
}

const documentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  label: true,
  storageDriver: true,
  detectedType: true,
  pdfPages: true,
  hasDigitalSignature: true,
  signers: true,
  signedAt: true,
  createdAt: true,
  companyId: true,
  complianceItemId: true,
  taskId: true,
  uploadedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DocumentSelect;

export async function uploadDocument(input: UploadInput) {
  const company = await getCompanyOrThrow(input.actor, input.companyId);
  await assertCan(input.actor, company.id, 'evidence.write');

  // A document may be filed against an item, a task, or neither — but whatever
  // it names must belong to this company.
  if (input.complianceItemId) {
    const item = await prisma.complianceItem.findFirst({
      where: { id: input.complianceItemId, companyId: company.id },
      select: { id: true },
    });
    if (!item) throw new BadRequestError('The compliance item does not belong to this company');
  }
  if (input.taskId) {
    const task = await prisma.task.findFirst({ where: { id: input.taskId, companyId: company.id }, select: { id: true } });
    if (!task) throw new BadRequestError('The task does not belong to this company');
  }

  // Inspect before anything is stored: a stub, a renamed poster or a corrupt
  // PDF must never become the evidence that closes out a statutory filing.
  const inspection = await inspectUpload(input.file.buffer, input.file.mimetype, input.file.originalname);
  if (!inspection.ok) {
    throw new UnprocessableError(
      inspection.problems.length === 1 ? inspection.problems[0]! : 'This file cannot be accepted as evidence.',
      { problems: inspection.problems, detectedType: inspection.detectedType, sizeBytes: inspection.sizeBytes },
    );
  }

  const digest = sha256(input.file.buffer);
  const duplicate = await prisma.document.findFirst({
    where: { companyId: company.id, sha256: digest, complianceItemId: input.complianceItemId ?? null },
    select: documentSelect,
  });
  if (duplicate) return { document: duplicate, deduplicated: true };

  const key = buildStorageKey({
    organizationId: input.actor.organizationId,
    companyId: company.id,
    itemId: input.complianceItemId,
    fileName: input.file.originalname,
  });

  await storage.upload(key, input.file.buffer, input.file.mimetype);

  try {
    const document = await prisma.document.create({
      data: {
        companyId: company.id,
        complianceItemId: input.complianceItemId ?? null,
        taskId: input.taskId ?? null,
        fileName: input.file.originalname,
        storageKey: key,
        storageDriver: storage.name,
        mimeType: input.file.mimetype,
        sizeBytes: input.file.size,
        sha256: digest,
        label: input.label ?? null,
        uploadedById: input.uploadedById,
        detectedType: inspection.detectedType,
        pdfPages: inspection.pdf?.pages ?? null,
        hasDigitalSignature: inspection.pdf?.hasDigitalSignature ?? false,
        signers: inspection.pdf?.signers ?? [],
        signedAt: inspection.pdf?.signedAt ? new Date(inspection.pdf.signedAt) : null,
      },
      select: documentSelect,
    });
    return { document, deduplicated: false };
  } catch (err) {
    // Do not leave an orphaned object behind if the metadata write fails.
    await storage.remove(key).catch(() => undefined);
    throw err;
  }
}

export async function listDocuments(
  actor: Actor,
  q: { companyId?: string; complianceItemId?: string; taskId?: string; search?: string; page: number; pageSize: number },
) {
  const where: Prisma.DocumentWhereInput = {
    company: companyScope(actor, q.companyId),
    ...(q.complianceItemId ? { complianceItemId: q.complianceItemId } : {}),
    ...(q.taskId ? { taskId: q.taskId } : {}),
    ...(q.search
      ? {
          OR: [
            { fileName: { contains: q.search, mode: 'insensitive' } },
            { label: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: documentSelect,
    }),
  ]);

  return { total, page: q.page, pageSize: q.pageSize, rows };
}

async function getDocumentOrThrow(actor: Actor, documentId: string) {
  const doc = await prisma.document.findFirst({ where: { id: documentId, company: companyScope(actor) } });
  if (!doc) throw new NotFoundError('Document');
  return doc;
}

/**
 * Supabase can hand out a short-lived signed URL so the file never transits the
 * API; the local driver cannot, so the bytes are streamed instead.
 */
export async function getDownload(actor: Actor, documentId: string) {
  const doc = await getDocumentOrThrow(actor, documentId);
  const url = await storage.signedUrl(doc.storageKey, 300);
  if (url) return { kind: 'redirect' as const, url, document: doc };
  return { kind: 'stream' as const, buffer: await storage.download(doc.storageKey), document: doc };
}

export async function deleteDocument(actor: Actor, documentId: string) {
  const doc = await getDocumentOrThrow(actor, documentId);
  await assertCan(actor, doc.companyId, 'evidence.write');
  await prisma.document.delete({ where: { id: doc.id } });
  await storage.remove(doc.storageKey).catch(() => undefined);
  return doc;
}

/** Which required evidence is present and which is still missing, per item. */
export async function evidenceCoverage(actor: Actor, companyId: string) {
  const items = await prisma.complianceItem.findMany({
    where: { companyId, company: companyScope(actor, companyId) },
    select: {
      id: true,
      title: true,
      ruleCode: true,
      status: true,
      dueDate: true,
      evidenceRequired: true,
      _count: { select: { documents: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const withRequirements = items.filter((i) => i.evidenceRequired.length > 0);
  const complete = withRequirements.filter((i) => i._count.documents > 0);

  return {
    totalItems: items.length,
    itemsRequiringEvidence: withRequirements.length,
    itemsWithEvidence: complete.length,
    coveragePct: withRequirements.length === 0 ? 100 : Math.round((complete.length / withRequirements.length) * 100),
    missing: withRequirements
      .filter((i) => i._count.documents === 0 && (i.status === 'COMPLETED' || i.status === 'OVERDUE'))
      .map((i) => ({ id: i.id, title: i.title, ruleCode: i.ruleCode, status: i.status, dueDate: i.dueDate, expected: i.evidenceRequired })),
  };
}
