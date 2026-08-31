import { Prisma } from '@prisma/client';
import type { Authority, ComplianceItem, ItemStatus, Severity } from '@prisma/client';
import { addDays, today } from '../../lib/dates';
import { NotFoundError, UnprocessableError } from '../../lib/errors';
import { assertCan, companyScope, type Actor } from '../../lib/access';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { evaluateAll, evaluateRule } from '../../engine/evaluator';
import { evaluateGate } from '../../engine/gate';
import { generateCalendar, type GeneratedItem } from '../../engine/generator';
import { getRule } from '../../engine/catalog';
import type { ComplianceContext } from '../../engine/types';
import { getCompanyOrThrow, type CompanyWithProfile } from '../companies/companies.service';

/** How far back and forward the calendar is materialised on each sync. */
export const LOOKBACK_DAYS = 400;
export const LOOKAHEAD_DAYS = 550;

/**
 * Projects a persisted company onto the plain shape the rules engine consumes.
 * The engine never touches Prisma types, so rules stay unit-testable without a
 * database and the storage layer can change without rewriting the catalog.
 */
export function buildContext(company: CompanyWithProfile): ComplianceContext {
  return {
    company: {
      id: company.id,
      legalName: company.legalName,
      entityType: company.entityType,
      cin: company.cin,
      llpin: company.llpin,
      pan: company.pan,
      tan: company.tan,
      incorporationDate: company.incorporationDate,
      stateCode: company.stateCode,
      industry: company.industry,
      employeeCount: company.employeeCount,
      annualTurnover: Number(company.annualTurnover),
      paidUpCapital: Number(company.paidUpCapital),
      cashTransactionRatioBelow5Pct: company.cashTransactionRatioBelow5Pct,
      hasForeignTransactions: company.hasForeignTransactions,
      acceptsDeposits: company.acceptsDeposits,
      isListed: company.isListed,
      buysFromMsmeSuppliers: company.buysFromMsmeSuppliers,
      agmDate: company.agmDate,
    },
    directors: company.directors.map((dir) => ({
      id: dir.id,
      name: dir.name,
      din: dir.din,
      designation: dir.designation,
      appointedOn: dir.appointedOn,
      resignedOn: dir.resignedOn,
    })),
    gstRegistrations: company.gstRegistrations.map((reg) => ({
      id: reg.id,
      gstin: reg.gstin,
      stateCode: reg.stateCode,
      filingFrequency: reg.filingFrequency,
      isTdsDeductor: reg.isTdsDeductor,
      isEcommerceOperator: reg.isEcommerceOperator,
      isActive: reg.isActive,
    })),
    msme: company.msmeRegistration
      ? {
          udyamNumber: company.msmeRegistration.udyamNumber,
          category: company.msmeRegistration.category,
          registeredOn: company.msmeRegistration.registeredOn,
        }
      : null,
  };
}

export interface SyncResult {
  companyId: string;
  /** Set when the profile is too incomplete to build a calendar. */
  blockedBy?: string;
  applicableRules: number;
  inapplicableRules: number;
  created: number;
  updated: number;
  removed: number;
  windowStart: Date;
  windowEnd: Date;
}

const itemKey = (ruleCode: string, periodKey: string) => `${ruleCode}::${periodKey}`;

/**
 * Order-insensitive JSON, for comparing stored metadata with freshly generated
 * metadata.
 *
 * Postgres `jsonb` normalises key order, so a round trip turns
 * `{quarter, gstin, stateCode}` into `{gstin, quarter, stateCode}`. A plain
 * `JSON.stringify` comparison therefore reports a difference that is not one,
 * and every sync rewrites the same rows forever.
 */
function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checklistFor(evidenceRequired: string[]): Prisma.InputJsonValue {
  return evidenceRequired.map((label, index) => ({ id: `e${index + 1}`, label, done: false }));
}

function toCreateData(companyId: string, item: GeneratedItem): Prisma.ComplianceItemCreateManyInput {
  return {
    companyId,
    ruleCode: item.ruleCode,
    title: item.title,
    authority: item.authority as Authority,
    category: item.category,
    form: item.form,
    legalReference: item.legalReference,
    severity: item.severity as Severity,
    periodKey: item.periodKey,
    periodLabel: item.periodLabel,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    dueDate: item.dueDate,
    status: deriveStatusValue(item.dueDate, null),
    penaltyNote: item.penaltyNote,
    evidenceRequired: item.evidenceRequired,
    evidenceLevel: item.evidenceLevel,
    metadata: (item.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

function deriveStatusValue(dueDate: Date, completedAt: Date | null, asOf: Date = today()): ItemStatus {
  if (completedAt) return 'COMPLETED';
  const days = Math.round((dueDate.getTime() - asOf.getTime()) / 86_400_000);
  if (days < 0) return 'OVERDUE';
  if (days <= 7) return 'DUE';
  return 'UPCOMING';
}

/**
 * Re-runs the engine for a company and reconciles the calendar with the result.
 *
 * Reconciliation rules, in order of importance:
 *   1. Anything already completed or waived is never touched.
 *   2. Anything in the past is never deleted — it is the compliance history.
 *   3. Future obligations that no longer apply (turnover changed, a GSTIN was
 *      removed) are withdrawn, unless evidence has already been attached.
 */
export async function syncCompany(actor: Actor, companyId: string): Promise<SyncResult> {
  const company = await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.sync');
  const ctx = buildContext(company);
  const now = today();
  const windowStart = addDays(now, -LOOKBACK_DAYS);
  const windowEnd = addDays(now, LOOKAHEAD_DAYS);

  const evaluations = evaluateAll(ctx);
  const { items, blockedBy } = generateCalendar(ctx, { from: windowStart, to: windowEnd });

  // 1. Persist the applicability trace so "why does this apply?" is answerable
  //    without re-running the engine.
  await prisma.$transaction(
    evaluations.map((e) =>
      prisma.complianceApplicability.upsert({
        where: { companyId_ruleCode: { companyId, ruleCode: e.rule.code } },
        create: {
          companyId,
          ruleCode: e.rule.code,
          applicable: e.applicable,
          reasons: e.reasons as unknown as Prisma.InputJsonValue,
        },
        update: {
          applicable: e.applicable,
          reasons: e.reasons as unknown as Prisma.InputJsonValue,
          evaluatedAt: new Date(),
        },
      }),
    ),
  );

  // 2. Diff the generated calendar against what is already stored.
  const existing = await prisma.complianceItem.findMany({
    where: { companyId, dueDate: { gte: windowStart, lte: windowEnd } },
    include: { _count: { select: { documents: true } } },
  });
  const existingByKey = new Map(existing.map((row) => [itemKey(row.ruleCode, row.periodKey), row]));
  const generatedKeys = new Set(items.map((i) => itemKey(i.ruleCode, i.periodKey)));

  const toCreate: Prisma.ComplianceItemCreateManyInput[] = [];
  const toUpdate: Array<{ id: string; data: Prisma.ComplianceItemUpdateInput }> = [];

  for (const item of items) {
    const found = existingByKey.get(itemKey(item.ruleCode, item.periodKey));
    if (!found) {
      toCreate.push(toCreateData(companyId, item));
      continue;
    }

    // Refresh the descriptive fields and the due date (an AGM date entered later
    // moves AOC-4), but never overwrite the user's own progress.
    const dueDateChanged = found.dueDate.getTime() !== item.dueDate.getTime();
    // Metadata carries per-occurrence facts — the GSTIN a return belongs to, an
    // advance-tax instalment percentage, whether an AGM is the company's first —
    // so it has to move with the rest or the stored copy quietly goes stale.
    const metadataChanged = stableJson(found.metadata) !== stableJson(item.metadata);
    const changed =
      dueDateChanged ||
      metadataChanged ||
      found.title !== item.title ||
      found.severity !== item.severity ||
      found.legalReference !== item.legalReference ||
      found.penaltyNote !== item.penaltyNote ||
      found.evidenceLevel !== item.evidenceLevel;

    if (changed) {
      toUpdate.push({
        id: found.id,
        data: {
          title: item.title,
          severity: item.severity as Severity,
          legalReference: item.legalReference,
          penaltyNote: item.penaltyNote,
          evidenceRequired: item.evidenceRequired,
          evidenceLevel: item.evidenceLevel,
          metadata: (item.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
          dueDate: item.dueDate,
          ...(found.status === 'COMPLETED' || found.status === 'WAIVED'
            ? {}
            : { status: deriveStatusValue(item.dueDate, null, now) }),
        },
      });
    }
  }

  // 3. Withdraw obligations the engine no longer produces.
  //
  // Past items are normally kept — they are the compliance history. The one
  // exception is an obligation for a period that closed before the company
  // existed: that is not history, it is an entry that should never have been
  // generated, and leaving it there reports a company as overdue on filings it
  // could not possibly have owed.
  const withdrawable = existing.filter((row) => {
    if (generatedKeys.has(itemKey(row.ruleCode, row.periodKey))) return false;
    if (row.status === 'COMPLETED' || row.status === 'WAIVED') return false;
    if (row.completedAt !== null || row._count.documents > 0) return false;

    // A profile too incomplete to produce a calendar should not keep the one it
    // produced before: those rows were guesses, not history.
    if (blockedBy) return true;

    const predatesIncorporation =
      company.incorporationDate !== null && row.periodEnd < company.incorporationDate;
    return predatesIncorporation || row.dueDate >= now;
  });

  const [created] = await prisma.$transaction([
    prisma.complianceItem.createMany({ data: toCreate, skipDuplicates: true }),
    ...toUpdate.map((u) => prisma.complianceItem.update({ where: { id: u.id }, data: u.data })),
    prisma.complianceItem.deleteMany({ where: { id: { in: withdrawable.map((r) => r.id) } } }),
  ]);

  // 4. Every item carries exactly one task. Create the missing ones in bulk.
  await createMissingTasks(companyId);

  const result: SyncResult = {
    companyId,
    ...(blockedBy ? { blockedBy } : {}),
    applicableRules: evaluations.filter((e) => e.applicable).length,
    inapplicableRules: evaluations.filter((e) => !e.applicable).length,
    created: created.count,
    updated: toUpdate.length,
    removed: withdrawable.length,
    windowStart,
    windowEnd,
  };

  logger.info(result, 'compliance calendar synced');
  return result;
}

/** Items and tasks are 1:1; this backfills tasks for newly created items. */
async function createMissingTasks(companyId: string): Promise<number> {
  const orphans = await prisma.complianceItem.findMany({
    where: { companyId, task: { is: null } },
    select: { id: true, title: true, dueDate: true, evidenceRequired: true, legalReference: true, penaltyNote: true },
  });
  if (orphans.length === 0) return 0;

  const { count } = await prisma.task.createMany({
    data: orphans.map((item) => ({
      complianceItemId: item.id,
      companyId,
      title: item.title,
      description: `${item.legalReference}\n\nIf missed: ${item.penaltyNote ?? 'See the rule for consequences.'}`,
      dueDate: item.dueDate,
      checklist: checklistFor(item.evidenceRequired),
    })),
    skipDuplicates: true,
  });
  return count;
}

/** Moves UPCOMING → DUE → OVERDUE as time passes. Safe to run repeatedly. */
export async function refreshStatuses(companyId?: string): Promise<{ due: number; overdue: number; upcoming: number }> {
  const now = today();
  const soon = addDays(now, 7);
  const scope = companyId ? { companyId } : {};
  const open = { status: { in: ['UPCOMING', 'DUE', 'OVERDUE'] as ItemStatus[] }, completedAt: null };

  const [overdue, due, upcoming] = await prisma.$transaction([
    prisma.complianceItem.updateMany({ where: { ...scope, ...open, dueDate: { lt: now } }, data: { status: 'OVERDUE' } }),
    prisma.complianceItem.updateMany({
      where: { ...scope, ...open, dueDate: { gte: now, lte: soon } },
      data: { status: 'DUE' },
    }),
    prisma.complianceItem.updateMany({ where: { ...scope, ...open, dueDate: { gt: soon } }, data: { status: 'UPCOMING' } }),
  ]);

  return { due: due.count, overdue: overdue.count, upcoming: upcoming.count };
}

// ---------------------------------------------------------------- reads

export interface CalendarQuery {
  companyId?: string;
  authority?: Authority;
  status?: ItemStatus[];
  severity?: Severity[];
  from?: Date;
  to?: Date;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listCalendar(actor: Actor, q: CalendarQuery) {
  const where: Prisma.ComplianceItemWhereInput = {
    company: companyScope(actor, q.companyId),
    ...(q.authority ? { authority: q.authority } : {}),
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.severity?.length ? { severity: { in: q.severity } } : {}),
    ...(q.from || q.to ? { dueDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.search
      ? {
          OR: [
            { title: { contains: q.search, mode: 'insensitive' } },
            { form: { contains: q.search, mode: 'insensitive' } },
            { ruleCode: { contains: q.search.toUpperCase() } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.complianceItem.count({ where }),
    prisma.complianceItem.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { severity: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        company: { select: { id: true, legalName: true, entityType: true } },
        task: { select: { id: true, status: true, assigneeId: true } },
        _count: { select: { documents: true } },
      },
    }),
  ]);

  return { total, page: q.page, pageSize: q.pageSize, rows };
}

export async function getItemOrThrow(actor: Actor, itemId: string) {
  const item = await prisma.complianceItem.findFirst({
    where: { id: itemId, company: companyScope(actor) },
    include: {
      company: { select: { id: true, legalName: true, entityType: true } },
      // `task: true` returns scalar columns only. Without the relation the UI
      // cannot show who a task is assigned to, so the assignee picker reads back
      // as "Unassigned" however many times you assign it.
      task: { include: { assignee: { select: { id: true, name: true, email: true } } } },
      documents: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!item) throw new NotFoundError('Compliance item');
  return item;
}

/** Groups a company's calendar by month — the shape a calendar view wants. */
export async function calendarByMonth(actor: Actor, companyId: string, from: Date, to: Date) {
  const rows = await prisma.complianceItem.findMany({
    where: { companyId, company: companyScope(actor, companyId), dueDate: { gte: from, lte: to } },
    orderBy: { dueDate: 'asc' },
    include: { task: { select: { id: true, status: true } } },
  });

  const months = new Map<string, { month: string; items: typeof rows }>();
  for (const row of rows) {
    const month = row.dueDate.toISOString().slice(0, 7);
    if (!months.has(month)) months.set(month, { month, items: [] });
    months.get(month)!.items.push(row);
  }
  return [...months.values()];
}

/** The applicability trace for one rule against one company. */
export async function explainForCompany(actor: Actor, companyId: string, ruleCode: string) {
  const company = await getCompanyOrThrow(actor, companyId);
  const rule = getRule(ruleCode);
  if (!rule) throw new NotFoundError(`Rule ${ruleCode}`);

  const evaluation = evaluateRule(rule, buildContext(company));
  return {
    rule: {
      code: rule.code,
      title: rule.title,
      authority: rule.authority,
      category: rule.category,
      form: rule.form ?? null,
      legalReference: rule.legalReference,
      description: rule.description,
      severity: rule.severity,
      penalty: rule.penalty,
      evidenceRequired: rule.evidenceRequired,
      evidenceLevel: rule.evidenceLevel,
      signatoryRequired: Boolean(rule.signatoryRequired),
      periodKind: rule.periodKind,
    },
    applicable: evaluation.applicable,
    reasons: evaluation.reasons,
  };
}

export async function listApplicability(actor: Actor, companyId: string) {
  await getCompanyOrThrow(actor, companyId);
  const rows = await prisma.complianceApplicability.findMany({
    where: { companyId },
    orderBy: [{ applicable: 'desc' }, { ruleCode: 'asc' }],
  });

  return rows.map((row) => {
    const rule = getRule(row.ruleCode);
    return {
      ruleCode: row.ruleCode,
      applicable: row.applicable,
      reasons: row.reasons,
      evaluatedAt: row.evaluatedAt,
      title: rule?.title ?? row.ruleCode,
      authority: rule?.authority ?? null,
      category: rule?.category ?? null,
      severity: rule?.severity ?? null,
      form: rule?.form ?? null,
    };
  });
}

export interface CompletionProof {
  attestation?: string | null;
  /** Who signed the evidence, for rules that require a named signatory. */
  signatoryName?: string | null;
}

/**
 * The evidence gate, applied before anything is marked complete.
 *
 * Both routes to completion — closing the obligation directly, and marking its
 * task DONE — call this, so neither can become the soft path around the other.
 *
 * Read outside the write transaction: the check is a read, and a document
 * deleted in the microseconds between check and write is not a threat model
 * worth serialising every completion for.
 */
export async function assertCompletionAllowed(
  actor: Actor,
  itemId: string,
  proof: CompletionProof = {},
): Promise<{ attestation: string | null; signatoryName: string | null }> {
  const item = await prisma.complianceItem.findFirst({
    where: { id: itemId, company: companyScope(actor) },
    select: {
      title: true,
      ruleCode: true,
      evidenceLevel: true,
      evidenceRequired: true,
      signatoryName: true,
      task: { select: { assigneeId: true, status: true, checklist: true } },
      documents: { select: { hasDigitalSignature: true } },
    },
  });
  if (!item) throw new NotFoundError('Compliance item');

  const checklist = (item.task?.checklist as Array<{ done?: boolean }> | null) ?? [];
  const rule = getRule(item.ruleCode);

  const result = evaluateGate({
    evidenceLevel: item.evidenceLevel,
    documentCount: item.documents.length,
    taskAssigned: Boolean(item.task?.assigneeId),
    taskStatus: item.task?.status ?? null,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.done).length,
    signatoryRequired: Boolean(rule?.signatoryRequired),
    hasSignedDocument: item.documents.some((d) => d.hasDigitalSignature),
    attestation: proof.attestation,
    // A signatory already on file stands unless the caller supplies a new one.
    signatoryName: proof.signatoryName ?? item.signatoryName,
    evidenceRequired: item.evidenceRequired,
  });

  if (!result.allowed) {
    throw new UnprocessableError(
      result.blockers.length === 1
        ? result.blockers[0]!.message
        : `${result.blockers.length} things still stand in the way of closing this out.`,
      {
        blockers: result.blockers,
        evidenceLevel: item.evidenceLevel,
        obligation: item.title,
        expectedEvidence: result.expected,
      },
    );
  }

  return { attestation: result.attestation, signatoryName: result.signatoryName };
}

export async function markItemStatus(
  actor: Actor,
  itemId: string,
  update: {
    status: ItemStatus;
    waivedReason?: string | null;
    completedAt?: Date | null;
    attestation?: string | null;
    signatoryName?: string | null;
    actorId?: string | null;
  },
): Promise<ComplianceItem> {
  const target = await getItemOrThrow(actor, itemId);
  await assertCan(actor, target.company.id, 'work.write');

  const completing = update.status === 'COMPLETED';

  // Waiving is not gated: the user is asserting the obligation does not apply
  // this period, which the reason field already captures.
  const proof = completing
    ? await assertCompletionAllowed(actor, itemId, {
        attestation: update.attestation,
        signatoryName: update.signatoryName,
      })
    : { attestation: null, signatoryName: null };

  const completedAt = completing ? update.completedAt ?? new Date() : null;

  // The task and the obligation are one thing seen from two angles, so they
  // move together. Previously only task -> item was wired up, which let an
  // obligation read COMPLETED while its task still sat in Todo, unassigned.
  return prisma.$transaction(async (tx) => {
    const item = await tx.complianceItem.update({
      where: { id: itemId },
      data: {
        status: update.status,
        completedAt,
        waivedReason: update.status === 'WAIVED' ? update.waivedReason ?? null : null,
        // Cleared on reopen, so a stale claim never outlives the completion it
        // was made for.
        attestationText: completing ? proof.attestation : null,
        attestedById: completing && proof.attestation ? update.actorId ?? null : null,
        attestedAt: completing && proof.attestation ? new Date() : null,
        signatoryName: completing ? proof.signatoryName : null,
      },
    });

    await tx.task.updateMany({
      where: { complianceItemId: itemId },
      data:
        update.status === 'COMPLETED'
          ? { status: 'DONE', completedAt }
          : update.status === 'WAIVED'
            ? { status: 'CANCELLED', completedAt: null }
            : { status: 'TODO', completedAt: null },
    });

    return item;
  });
}
