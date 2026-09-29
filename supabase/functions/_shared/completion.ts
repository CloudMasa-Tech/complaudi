// supabase/functions/_shared/completion.ts
//
// The completion gate, as the edge functions enforce it.
//
// The policy itself is NOT written here: it lives in engine/gate.ts and is
// shared with the Node backend, which is the point. This module is the plumbing
// — load what the gate needs, run it, and only then write. Mirrors
// src/modules/compliance/compliance.service.ts (assertCompletionAllowed and
// markItemStatus) and src/modules/tasks/tasks.service.ts (the reopen rule), so
// the two runtimes accept and refuse exactly the same completions.
//
// Nothing in here imports a remote module, so the whole file loads under vitest
// and can be tested against a fake database.
import { evaluateGate, type GateBlocker } from './engine/gate.ts';
import { getRule } from './engine/catalog/index.ts';
import { AppError, NotFoundError, UnprocessableError } from './errors.ts';

export type ItemStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'WAIVED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';

/**
 * The slice of the query builder used below. Structural on purpose: the real
 * Supabase client satisfies it, and a test can supply a fake without a network.
 * Returned builders stay `any` so the fluent chain is not re-typed per call.
 */
export interface CompletionDb {
  from(table: string): {
    select(columns?: string): any;
    insert(values: unknown): any;
    update(values: unknown): any;
  };
}

export interface ChecklistEntry { id?: string; label?: string; done?: boolean }

export interface GateItem {
  id: string;
  companyId: string;
  ruleCode: string;
  title: string;
  dueDate: string;
  status: string;
  evidenceLevel: string;
  evidenceRequired: string[] | null;
  signatoryName: string | null;
  /** Carried so a rolled-back write can restore the row exactly as it was. */
  completedAt: string | null;
  waivedReason: string | null;
  attestationText: string | null;
  attestedById: string | null;
  attestedAt: string | null;
  task: { id: string; status: string; assigneeId: string | null; checklist: unknown; completedAt: string | null } | null;
  documents: { hasDigitalSignature: boolean }[];
}

/** PostgREST returns an embedded reverse-relation as an array; take the first. */
function firstRelation(value: unknown): any {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toEntryList(value: unknown): ChecklistEntry[] {
  return Array.isArray(value) ? (value as ChecklistEntry[]) : [];
}

function isNoRows(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST116';
}

/**
 * Loads exactly what the gate reads, in one round trip. Returns null when the
 * item does not exist; a real query failure is raised rather than swallowed.
 */
export async function loadGateItem(db: CompletionDb, itemId: string): Promise<GateItem | null> {
  const { data, error } = await db
    .from('compliance_items')
    .select('*, task:tasks(*), documents(id, hasDigitalSignature)')
    .eq('id', itemId)
    .single();

  if (error) {
    if (isNoRows(error)) return null;
    throw new AppError(error.message, 400);
  }
  if (!data) return null;

  return {
    id: data.id,
    companyId: data.companyId,
    ruleCode: data.ruleCode,
    title: data.title,
    dueDate: data.dueDate,
    status: data.status,
    evidenceLevel: data.evidenceLevel,
    evidenceRequired: data.evidenceRequired ?? [],
    signatoryName: data.signatoryName ?? null,
    completedAt: data.completedAt ?? null,
    waivedReason: data.waivedReason ?? null,
    attestationText: data.attestationText ?? null,
    attestedById: data.attestedById ?? null,
    attestedAt: data.attestedAt ?? null,
    task: firstRelation(data.task),
    documents: (Array.isArray(data.documents) ? data.documents : []).map((d: any) => ({
      hasDigitalSignature: Boolean(d.hasDigitalSignature),
    })),
  };
}

export interface CompletionProof {
  attestation: string | null;
  signatoryName: string | null;
}

/**
 * The same mapping the Node service feeds evaluateGate, from a loaded item plus
 * what the caller supplied. A signatory already on file stands unless the caller
 * sends a new one, so a re-attempt does not lose a name it recorded earlier.
 */
export function evaluateItemCompletion(
  item: GateItem,
  proof: { attestation?: string | null; signatoryName?: string | null } = {},
): { allowed: true; proof: CompletionProof } | { allowed: false; blockers: GateBlocker[]; expectedEvidence: string[] } {
  const task = item.task;
  const checklist = toEntryList(task?.checklist);

  const result = evaluateGate({
    evidenceLevel: item.evidenceLevel as never,
    documentCount: item.documents.length,
    taskAssigned: Boolean(task?.assigneeId),
    taskStatus: task?.status ?? null,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => Boolean(c.done)).length,
    signatoryRequired: Boolean(getRule(item.ruleCode)?.signatoryRequired),
    hasSignedDocument: item.documents.some((d) => d.hasDigitalSignature),
    attestation: proof.attestation ?? null,
    signatoryName: proof.signatoryName ?? item.signatoryName,
    evidenceRequired: item.evidenceRequired ?? [],
  });

  if (result.allowed === true) {
    return { allowed: true, proof: { attestation: result.attestation, signatoryName: result.signatoryName } };
  }
  return { allowed: false, blockers: result.blockers, expectedEvidence: result.expected };
}

/** The 422 the caller sees, worded and shaped like the Node backend's. */
export function gateRejection(
  item: GateItem,
  blockers: GateBlocker[],
  expectedEvidence: string[],
): UnprocessableError {
  return new UnprocessableError(
    blockers.length === 1
      ? blockers[0]!.message
      : `${blockers.length} things still stand in the way of closing this out.`,
    {
      blockers,
      evidenceLevel: item.evidenceLevel,
      obligation: item.title,
      expectedEvidence,
    },
  );
}

/**
 * The columns to write, matching markItemStatus. A declaration is stored against
 * the person who made it and the moment they made it — the two columns the
 * evidence column added later and nothing here wrote.
 *
 * Reopening clears the claim: a stale attestation must never outlive the
 * completion it was made for.
 */
export function buildItemUpdate(
  item: GateItem,
  status: ItemStatus,
  proof: CompletionProof,
  actorId: string,
  now: Date,
  waivedReason?: string | null,
): Record<string, unknown> {
  const completing = status === 'COMPLETED';
  const attested = completing && Boolean(proof.attestation);

  return {
    status,
    completedAt: completing ? now.toISOString() : null,
    waivedReason: status === 'WAIVED' ? waivedReason ?? null : null,
    attestationText: completing ? proof.attestation : null,
    attestedById: attested ? actorId : null,
    attestedAt: attested ? now.toISOString() : null,
    signatoryName: completing ? proof.signatoryName : null,
  };
}

/** The task and the obligation are one thing from two angles, so they move together. */
export function taskStatusFor(status: ItemStatus): TaskStatus {
  if (status === 'COMPLETED') return 'DONE';
  if (status === 'WAIVED') return 'CANCELLED';
  return 'TODO';
}

export function buildTaskSync(itemStatus: ItemStatus, completedAt: string | null): Record<string, unknown> {
  const status = taskStatusFor(itemStatus);
  return { status, completedAt: status === 'DONE' ? completedAt : null };
}

/** Pulling the work back open is what reopens the filing — see tasks.service.ts. */
export function isLeavingDone(currentStatus: string, nextStatus?: string | null): boolean {
  return nextStatus !== undefined && nextStatus !== null && nextStatus !== 'DONE' && currentStatus === 'DONE';
}

/** Overdue / due soon / upcoming, from the due date — the same thresholds as the Node reopen. */
export function derivedStatusFor(dueDate: string | Date, now: Date): 'OVERDUE' | 'DUE' | 'UPCOMING' {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return 'OVERDUE';
  if (days <= 7) return 'DUE';
  return 'UPCOMING';
}

export function buildItemReopen(dueDate: string | Date, now: Date): Record<string, unknown> {
  return {
    status: derivedStatusFor(dueDate, now),
    completedAt: null,
    attestationText: null,
    attestedById: null,
    attestedAt: null,
    signatoryName: null,
  };
}

export interface StatusChangeRequest {
  itemId: string;
  status: ItemStatus;
  waivedReason?: string | null;
  attestation?: string | null;
  signatoryName?: string | null;
  actorId: string;
  email?: string;
  organizationId?: string;
  now?: Date;
}

export interface StatusChangeResult {
  item: Record<string, unknown>;
  /** Blockers that stopped the change, or null when it was allowed. */
  blockers: GateBlocker[] | null;
}

/**
 * The whole write path, gate included.
 *
 * The gate runs to completion before the first write, so a refused completion
 * leaves the database exactly as it was — no partial status, no task nudged
 * along, no audit entry claiming something happened.
 */
export async function applyItemStatusChange(
  db: CompletionDb,
  request: StatusChangeRequest,
): Promise<StatusChangeResult> {
  const now = request.now ?? new Date();
  const item = await loadGateItem(db, request.itemId);
  if (!item) throw new NotFoundError('Compliance item not found');

  // Waiving is not gated: the caller is asserting the obligation does not apply
  // this period, which the reason field already captures. Same as the Node path.
  let proof: CompletionProof = { attestation: null, signatoryName: null };
  if (request.status === 'COMPLETED') {
    const verdict = evaluateItemCompletion(item, {
      attestation: request.attestation,
      signatoryName: request.signatoryName,
    });
    if (verdict.allowed === false) {
      throw gateRejection(item, verdict.blockers, verdict.expectedEvidence);
    }
    proof = verdict.proof;
  }

  const update = buildItemUpdate(item, request.status, proof, request.actorId, now, request.waivedReason);

  const { data: updatedItem, error: updateErr } = await db
    .from('compliance_items')
    .update(update)
    .eq('id', request.itemId)
    .select()
    .single();
  if (updateErr) throw new AppError(updateErr.message, 400);

  // Keep the task in step: DONE on completion, CANCELLED on a waiver, TODO when
  // the obligation goes back into the calendar.
  const { error: taskErr } = await db
    .from('tasks')
    .update(buildTaskSync(request.status, update.completedAt as string | null))
    .eq('complianceItemId', request.itemId);
  if (taskErr) throw new AppError(taskErr.message, 400);

  // The audit log is part of the change, not a courtesy: if it cannot be written
  // the completion is unaccountable, so it is rolled back rather than left bare.
  const before = {
    status: item.status,
    completedAt: item.completedAt,
    waivedReason: item.waivedReason,
    attestationText: item.attestationText,
    attestedById: item.attestedById,
    attestedAt: item.attestedAt,
    signatoryName: item.signatoryName,
  };
  // The rollback restores what was actually on the task, not what the mapping
  // would imply: work finished but not yet filed is a normal state, and undoing
  // a failed completion must not throw that work back into the queue.
  const taskBefore = item.task
    ? { status: item.task.status, completedAt: item.task.completedAt ?? null }
    : null;
  try {
    const { error: auditErr } = await db.from('audit_logs').insert({
      id: crypto.randomUUID(),
      organizationId: request.organizationId ?? null,
      actorId: request.actorId,
      actorEmail: request.email ?? null,
      action: `item.${request.status.toLowerCase()}`,
      entityType: 'ComplianceItem',
      entityId: request.itemId,
      before,
      after: {
        status: updatedItem.status,
        completedAt: updatedItem.completedAt ?? null,
        waivedReason: updatedItem.waivedReason ?? null,
        attestation: updatedItem.attestationText ?? null,
        attestedById: updatedItem.attestedById ?? null,
        attestedAt: updatedItem.attestedAt ?? null,
        signatoryName: updatedItem.signatoryName ?? null,
      },
    });
    if (auditErr) throw auditErr;
  } catch (stepErr: any) {
    await db.from('compliance_items').update(before).eq('id', request.itemId);
    if (taskBefore) await db.from('tasks').update(taskBefore).eq('complianceItemId', request.itemId);
    throw new AppError(
      `Multi-step transaction failed: ${stepErr?.message ?? stepErr}. Rolled back compliance item status.`,
      500,
    );
  }

  return { item: (updatedItem ?? {}) as Record<string, unknown>, blockers: null };
}

/**
 * The reopen half of the task rule, for tasks-api: a task dragged away from DONE
 * reopens the filing behind it, so an obligation can never read COMPLETED while
 * the work that justified it has been pulled back open.
 */
export async function reopenItemForTask(
  db: CompletionDb,
  task: { complianceItemId: string; status: string },
  nextStatus: string | undefined,
  now: Date,
): Promise<{ reopened: boolean; status?: string }> {
  if (!isLeavingDone(task.status, nextStatus)) return { reopened: false };

  const { data: item, error } = await db
    .from('compliance_items')
    .select('id, dueDate, status')
    .eq('id', task.complianceItemId)
    .single();
  if (error) {
    if (isNoRows(error)) return { reopened: false };
    throw new AppError(error.message, 400);
  }
  if (!item || item.status !== 'COMPLETED') return { reopened: false };

  const reopen = buildItemReopen(item.dueDate, now);
  const { error: updateErr } = await db.from('compliance_items').update(reopen).eq('id', item.id);
  if (updateErr) throw new AppError(updateErr.message, 400);

  return { reopened: true, status: reopen.status as string };
}
