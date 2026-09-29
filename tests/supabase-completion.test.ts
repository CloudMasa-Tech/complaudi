import { describe, expect, it } from 'vitest';
import {
  applyItemStatusChange,
  derivedStatusFor,
  evaluateItemCompletion,
  isLeavingDone,
  reopenItemForTask,
  type CompletionDb,
  type GateItem,
} from '../supabase/functions/_shared/completion';
import { evaluateGate as nodeEvaluateGate } from '../src/engine/gate';
import { allRules } from '../src/engine/catalog';
import { allRules as edgeAllRules, getRule } from '../supabase/functions/_shared/engine/catalog';
import { UnprocessableError } from '../supabase/functions/_shared/errors';

/** A rule that wants evidence, and no human signature. */
const RULE = 'GST_GSTR1_MONTHLY';
/** A rule that wants a declaration *and* a named signatory. */
const ATTEST_RULE = 'LABOUR_POSH_IC';

const NOW = new Date('2026-04-15T10:30:00.000Z');
const ACTOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ITEM_ID = 'cccccccc-2222-4222-8222-cccccccccccc';
const TASK_ID = 'dddddddd-3333-4333-8333-dddddddddddd';

const checklist = (done: number, total = 3) =>
  Array.from({ length: total }, (_, i) => ({ id: `c${i}`, label: `Step ${i + 1}`, done: i < done }));

/** An obligation that is one tick away from filable. */
function item(over: Partial<GateItem> = {}): GateItem {
  return {
    id: ITEM_ID,
    companyId: 'company-1',
    ruleCode: RULE,
    title: 'File GSTR-1',
    dueDate: '2026-04-10',
    status: 'DUE',
    evidenceLevel: 'REQUIRED',
    evidenceRequired: ['GSTR-1 filed acknowledgement'],
    signatoryName: null,
    completedAt: null,
    waivedReason: null,
    attestationText: null,
    attestedById: null,
    attestedAt: null,
    task: { id: TASK_ID, status: 'DONE', assigneeId: 'u-1', checklist: checklist(3), completedAt: null },
    documents: [{ hasDigitalSignature: false }],
    ...over,
  };
}

interface Write { table: string; op: string; payload: any }

/**
 * A stand-in for the Supabase client. Every builder method returns the same
 * thenable, so the fluent chain the handlers use resolves exactly as the real
 * client does. It records every write and can be told to fail the audit log so
 * the rollback path can be exercised.
 */
function fakeDb(row: GateItem, opts: { auditFails?: boolean; taskRow?: any } = {}) {
  const state = { row, task: opts.taskRow ?? row.task, writes: [] as Write[] };

  const execute = (table: string, op: string, payload: any) => {
    if (op === 'insert') {
      state.writes.push({ table, op, payload });
      return { data: null, error: opts.auditFails ? { message: 'audit unavailable' } : null };
    }
    if (op === 'update') {
      state.writes.push({ table, op, payload });
      const base = table === 'compliance_items' ? state.row : state.task;
      const merged = { ...base, ...payload };
      if (table === 'compliance_items') state.row = merged as GateItem;
      else state.task = merged;
      return { data: merged, error: null };
    }
    const source = table === 'compliance_items' ? state.row : state.task;
    if (!source) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return {
      data: table === 'compliance_items' ? { ...source, task: state.task } : source,
      error: null,
    };
  };

  const db = {
    from(table: string) {
      let op = 'select';
      let payload: any;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () => chain,
        update: (values: unknown) => { op = 'update'; payload = values; return chain; },
        insert: (values: unknown) => { op = 'insert'; payload = values; return chain; },
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          try {
            resolve(execute(table, op, payload));
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    },
  } as unknown as CompletionDb;

  return { db, state, writes: state.writes };
}

const request = (over: Record<string, unknown> = {}) => ({
  itemId: ITEM_ID,
  status: 'COMPLETED' as const,
  actorId: ACTOR,
  email: 'ca@example.com',
  organizationId: 'org-1',
  now: NOW,
  ...over,
});

describe('the completion gate refuses a premature filing', () => {
  it('rejects an unowned obligation with 422, the blockers, and the evidence it wants', async () => {
    const { db, writes } = fakeDb(item({ task: { ...item().task!, assigneeId: null } }));

    const err = await applyItemStatusChange(db, request()).catch((e) => e);

    expect(err).toBeInstanceOf(UnprocessableError);
    expect(err.statusCode).toBe(422);
    const details = err.details as any;
    expect(details.blockers.map((b: any) => b.code)).toContain('UNASSIGNED');
    expect(details.expectedEvidence).toEqual(['GSTR-1 filed acknowledgement']);
    expect(details.obligation).toBe('File GSTR-1');
    expect(writes).toEqual([]);
  });

  it('names every outstanding reason at once', async () => {
    const { db } = fakeDb(item({
      task: { id: TASK_ID, status: 'TODO', assigneeId: null, checklist: checklist(1), completedAt: null },
      documents: [],
    }));

    const err = await applyItemStatusChange(db, request()).catch((e) => e);
    const codes = (err.details as any).blockers.map((b: any) => b.code);

    expect(codes).toEqual(expect.arrayContaining(['UNASSIGNED', 'CHECKLIST_INCOMPLETE', 'EVIDENCE_REQUIRED', 'TASK_NOT_DONE']));
    expect(err.message).toContain('4 things still stand in the way');
  });

  it('leaves the database untouched when the gate refuses', async () => {
    const row = item({ documents: [] });
    const { db, state, writes } = fakeDb(row);

    await applyItemStatusChange(db, request()).catch(() => {});

    expect(writes).toEqual([]);
    expect(state.row.status).toBe('DUE');
    expect(state.row.completedAt).toBeNull();
  });

  it('refuses a one-word declaration when there is no document to stand in for it', async () => {
    const { db } = fakeDb(item({ ruleCode: ATTEST_RULE, evidenceLevel: 'ATTEST', documents: [] }));

    const err = await applyItemStatusChange(
      db,
      request({ attestation: 'done', signatoryName: 'Anita Sharma' }),
    ).catch((e) => e);

    expect((err.details as any).blockers.map((b: any) => b.code)).toContain('ATTESTATION_TOO_SHORT');
  });

  it('refuses an undeclared, unevidenced obligation', async () => {
    const { db } = fakeDb(item({ ruleCode: ATTEST_RULE, evidenceLevel: 'ATTEST', documents: [] }));

    const err = await applyItemStatusChange(db, request({ signatoryName: 'Anita Sharma' })).catch((e) => e);

    expect((err.details as any).blockers.map((b: any) => b.code)).toContain('ATTESTATION_REQUIRED');
  });

  it('lets a declaration stand in for the missing document', async () => {
    const { db, state } = fakeDb(item({ ruleCode: ATTEST_RULE, evidenceLevel: 'ATTEST', documents: [] }));

    await applyItemStatusChange(
      db,
      request({ attestation: 'The Internal Committee was constituted as required.', signatoryName: 'Anita Sharma' }),
    );

    expect(state.row.status).toBe('COMPLETED');
  });

  it('refuses a signature that is only an initial', async () => {
    const { db } = fakeDb(item({ ruleCode: ATTEST_RULE, evidenceLevel: 'ATTEST' }));

    const err = await applyItemStatusChange(
      db,
      request({ attestation: 'The IC was constituted as required by law.', signatoryName: 'AS' }),
    ).catch((e) => e);

    expect((err.details as any).blockers.map((b: any) => b.code)).toContain('SIGNATORY_REQUIRED');
  });
});

describe('a completion that clears the gate is filed', () => {
  it('marks the obligation complete, closes the task and writes the audit entry', async () => {
    const { db, state, writes } = fakeDb(item());

    const result = await applyItemStatusChange(db, request());

    expect(result.blockers).toBeNull();
    expect(state.row.status).toBe('COMPLETED');
    expect(state.row.completedAt).toBe(NOW.toISOString());

    const taskWrite = writes.find((w) => w.table === 'tasks');
    expect(taskWrite?.payload).toEqual({ status: 'DONE', completedAt: NOW.toISOString() });

    const audit = writes.find((w) => w.table === 'audit_logs');
    expect(audit?.payload.action).toBe('item.completed');
    expect(audit?.payload.actorId).toBe(ACTOR);
    expect(audit?.payload.after.status).toBe('COMPLETED');
  });
});

describe('a declaration is kept against the person who made it', () => {
  it('records the actor and the moment alongside the words', async () => {
    const { db, state } = fakeDb(item({ ruleCode: ATTEST_RULE, evidenceLevel: 'ATTEST' }));

    await applyItemStatusChange(
      db,
      request({ attestation: 'The Internal Committee was constituted with an external member.', signatoryName: 'Anita Sharma' }),
    );

    expect(state.row.attestationText).toBe('The Internal Committee was constituted with an external member.');
    expect(state.row.attestedById).toBe(ACTOR);
    expect(state.row.attestedAt).toBe(NOW.toISOString());
  });

  it('leaves the fields empty when no declaration was made', async () => {
    const { db, state } = fakeDb(item());

    await applyItemStatusChange(db, request());

    expect(state.row.attestationText).toBeNull();
    expect(state.row.attestedById).toBeNull();
    expect(state.row.attestedAt).toBeNull();
  });

  it('clears a stale declaration when the obligation is reopened', async () => {
    const signed = item({
      completedAt: '2026-01-01T00:00:00.000Z',
      status: 'COMPLETED',
      attestationText: 'Previously attested by someone who has since left.',
      attestedById: 'someone-else',
      attestedAt: '2026-01-01T00:00:00.000Z',
      task: { ...item().task!, status: 'IN_PROGRESS' },
    });
    const { db, state } = fakeDb(signed);

    await applyItemStatusChange(db, request({ status: 'DUE' }));

    expect(state.row.attestationText).toBeNull();
    expect(state.row.attestedById).toBeNull();
    expect(state.row.attestedAt).toBeNull();
  });
});

describe('the task and the obligation move together', () => {
  it('cancels the task when the obligation is waived, without asking the gate', async () => {
    const { db, state, writes } = fakeDb(item({ task: { ...item().task!, status: 'TODO' } }));

    await applyItemStatusChange(db, request({ status: 'WAIVED', waivedReason: 'Below threshold' }));

    expect(state.row.status).toBe('WAIVED');
    expect(state.row.waivedReason).toBe('Below threshold');
    expect(state.row.completedAt).toBeNull();
    expect(writes.find((w) => w.table === 'tasks')?.payload).toEqual({ status: 'CANCELLED', completedAt: null });
  });

  it('reopens the task when the obligation goes back on the calendar', async () => {
    const done = item({ status: 'COMPLETED', completedAt: '2026-01-01T00:00:00.000Z' });
    const { db, state, writes } = fakeDb(done);

    await applyItemStatusChange(db, request({ status: 'UPCOMING' }));

    expect(state.row.status).toBe('UPCOMING');
    expect(writes.find((w) => w.table === 'tasks')?.payload).toEqual({ status: 'TODO', completedAt: null });
  });
});

describe('reopening the work reopens the filing', () => {
  const completed = () => ({
    id: ITEM_ID,
    dueDate: '2026-04-10',
    status: 'COMPLETED',
    completedAt: '2026-04-01T00:00:00.000Z',
    attestationText: 'Filed on time.',
    attestedById: ACTOR,
    attestedAt: '2026-04-01T00:00:00.000Z',
    signatoryName: 'Anita Sharma',
  });

  it('pulls the obligation back to DUE and wipes the claim', async () => {
    const { db, state } = fakeDb(item({ ...completed(), dueDate: '2026-04-15' } as any));

    const result = await reopenItemForTask(db, { complianceItemId: ITEM_ID, status: 'DONE' }, 'IN_PROGRESS', new Date('2026-04-12T00:00:00.000Z'));

    expect(result.reopened).toBe(true);
    expect(state.row.status).toBe('DUE');
    expect(state.row.completedAt).toBeNull();
    expect(state.row.attestationText).toBeNull();
    expect(state.row.attestedById).toBeNull();
    expect(state.row.attestedAt).toBeNull();
    expect(state.row.signatoryName).toBeNull();
  });

  it('marks a long-overdue filing OVERDUE rather than merely DUE', async () => {
    const { db, state } = fakeDb(item(completed() as any));

    const result = await reopenItemForTask(db, { complianceItemId: ITEM_ID, status: 'DONE' }, 'TODO', new Date('2026-05-02T00:00:00.000Z'));

    expect(result.status).toBe('OVERDUE');
    expect(state.row.status).toBe('OVERDUE');
  });

  it('leaves a filing that is not complete alone', async () => {
    const { db, writes } = fakeDb(item({ status: 'DUE' } as any));

    const result = await reopenItemForTask(db, { complianceItemId: ITEM_ID, status: 'DONE' }, 'TODO', NOW);

    expect(result.reopened).toBe(false);
    expect(writes).toEqual([]);
  });

  it('does nothing when the task was not done to begin with', () => {
    expect(isLeavingDone('DONE', 'TODO')).toBe(true);
    expect(isLeavingDone('DONE', undefined)).toBe(false);
    expect(isLeavingDone('DONE', 'DONE')).toBe(false);
    expect(isLeavingDone('IN_PROGRESS', 'TODO')).toBe(false);
  });

  it('raises rather than silently leaving a completed filing behind an open task', async () => {
    // The item row refuses to be written, so the caller must be told rather than
    // handed a task that is open with an obligation still marked COMPLETED.
    const broken: any = {
      from(table: string) {
        if (table === 'compliance_items') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            single: () => chain,
            update: () => ({
              eq: () => ({ then: (r: any) => r({ data: null, error: { message: 'write refused' } }) }),
            }),
            then: (r: any) => r({ data: { id: ITEM_ID, dueDate: '2026-04-10', status: 'COMPLETED' }, error: null }),
          };
          return chain;
        }
        return { update: () => ({ eq: () => Promise.resolve({ error: { message: 'write refused' } }) }) };
      },
    };

    await expect(
      reopenItemForTask(broken, { complianceItemId: ITEM_ID, status: 'DONE' }, 'TODO', NOW),
    ).rejects.toThrow(/write refused/);
  });

  it('reads the same due-date thresholds as the backend', () => {
    const due = new Date('2026-04-30T00:00:00.000Z');
    expect(derivedStatusFor(due, new Date('2026-04-01T00:00:00.000Z'))).toBe('UPCOMING');
    expect(derivedStatusFor(due, new Date('2026-04-25T00:00:00.000Z'))).toBe('DUE');
    expect(derivedStatusFor(due, new Date('2026-04-30T00:00:00.000Z'))).toBe('DUE');
    expect(derivedStatusFor(due, new Date('2026-05-01T00:00:00.000Z'))).toBe('OVERDUE');
  });
});

describe('a completion that cannot be audited is undone', () => {
  it('rolls the obligation and the task back to where they were', async () => {
    // The gate passes, the writes land, then the audit log refuses. Nothing may survive.
    const before = item({ status: 'DUE' });
    const { db, state, writes } = fakeDb(before, { auditFails: true });

    const err = await applyItemStatusChange(db, request()).catch((e) => e);

    expect(err.statusCode).toBe(500);
    expect(state.row.status).toBe('DUE');
    expect(state.row.completedAt).toBeNull();
    // The task was moved to DONE and then put back the way it was found.
    expect(writes.filter((w) => w.table === 'tasks')).toHaveLength(2);
    expect(state.task.status).toBe('DONE');
    expect(state.task.completedAt).toBeNull();
  });
});

describe('the edge function and the backend agree on every refusal', () => {
  // The edge derives signatoryRequired from its own catalog, so each case names
  // a rule whose real metadata matches the case — otherwise the two are being
  // asked different questions.
  const cases: Record<string, any>[] = [
    { over: { taskAssigned: false } },
    { over: { checklistDone: 1, checklistTotal: 3 } },
    { over: { documentCount: 0 } },
    { over: { taskStatus: 'IN_PROGRESS' } },
    { over: { taskStatus: null } },
    { over: { evidenceLevel: 'NONE' as const, documentCount: 0, taskStatus: 'TODO' as const, taskAssigned: false, checklistDone: 0 } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, attestation: 'short' } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, signatoryName: null } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, signatoryName: 'AS' } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, signatoryName: 'Anita Sharma' } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, documentCount: 0, attestation: null } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, documentCount: 0, attestation: 'short' } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, documentCount: 0, signatoryName: null } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, documentCount: 0, attestation: 'A declaration long enough to stand.', signatoryName: 'Anita Sharma' } },
    { ruleCode: ATTEST_RULE, over: { evidenceLevel: 'ATTEST' as const, attestation: 'A'.repeat(1001) } },
    { over: {} },
  ];

  it.each(cases)('agrees on %j', ({ ruleCode, over }) => {
    const shared = {
      evidenceLevel: 'REQUIRED' as const,
      documentCount: 1,
      taskAssigned: true,
      taskStatus: 'DONE' as string | null,
      checklistTotal: 3,
      checklistDone: 3,
      signatoryRequired: false,
      hasSignedDocument: false,
      attestation: null as string | null,
      signatoryName: null as string | null,
      evidenceRequired: ['ack'],
      ...over,
    };
    // Feed the backend the metadata the edge will look up for itself.
    const nodeInput = { ...shared, signatoryRequired: Boolean(getRule(ruleCode ?? RULE)?.signatoryRequired) };

    const node = nodeEvaluateGate(nodeInput);
    const edge = evaluateItemCompletion(
      item({
        ruleCode: ruleCode ?? RULE,
        evidenceLevel: nodeInput.evidenceLevel,
        evidenceRequired: nodeInput.evidenceRequired,
        signatoryName: nodeInput.signatoryName,
        task: {
          id: TASK_ID,
          status: nodeInput.taskStatus,
          assigneeId: nodeInput.taskAssigned ? 'u-1' : null,
          checklist: checklist(nodeInput.checklistDone, nodeInput.checklistTotal),
          completedAt: null,
        },
        documents: Array.from({ length: nodeInput.documentCount }, () => ({ hasDigitalSignature: false })),
      }),
      { attestation: nodeInput.attestation },
    );

    if (node.allowed === true) {
      expect(edge.allowed).toBe(true);
      expect((edge as any).proof.attestation).toBe(node.attestation);
      return;
    }
    expect(edge.allowed).toBe(false);
    expect((edge as any).blockers.map((b: any) => b.code)).toEqual(node.blockers.map((b) => b.code));
    expect((edge as any).expectedEvidence).toEqual(node.expected);
  });
});

describe('the two rule catalogs have not drifted apart', () => {
  const edgeRules = edgeAllRules;
  const shared = edgeRules.filter((r) => allRules.some((n) => n.code === r.code));

  it('agrees on every rule the edge knows about', () => {
    for (const edge of shared) {
      const node = allRules.find((n) => n.code === edge.code)!;
      expect(`${edge.code}:${Boolean(edge.signatoryRequired)}:${edge.evidenceLevel}`).toBe(
        `${node.code}:${Boolean(node.signatoryRequired)}:${node.evidenceLevel}`,
      );
    }
  });

  it('has nothing the backend does not', () => {
    const nodeCodes = new Set(allRules.map((r) => r.code));
    expect(edgeRules.filter((r) => !nodeCodes.has(r.code))).toEqual([]);
  });

  // The four MCA rules that were previously missing from the edge catalog have
  // now been ported (MCA_DIR11, MCA_CHG4, MCA_SH7, MCA_INC22). Close the ticket:
  // the edge copy of the catalog must serve every rule the backend serves.
  it('serves every rule the backend serves — including the ported MCA event rules', () => {
    const edgeCodes = new Set(edgeRules.map((r) => r.code));
    const missing = allRules.map((r) => r.code).filter((c) => !edgeCodes.has(c)).sort();
    expect(missing).toEqual([]);
    for (const code of ['MCA_DIR11', 'MCA_CHG4', 'MCA_SH7', 'MCA_INC22']) {
      expect(edgeCodes.has(code)).toBe(true);
    }
  });
});
