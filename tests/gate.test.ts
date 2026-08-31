import { describe, expect, it } from 'vitest';
import { evaluateGate, MIN_ATTESTATION_LENGTH, type BlockerCode, type GateInput } from '../src/engine/gate';
import { allRules } from '../src/engine/catalog';

/** A fully satisfied REQUIRED obligation; each test breaks one thing. */
const gate = (over: Partial<GateInput> = {}) =>
  evaluateGate({
    evidenceLevel: 'REQUIRED',
    documentCount: 1,
    taskAssigned: true,
    taskStatus: 'DONE',
    checklistTotal: 3,
    checklistDone: 3,
    signatoryRequired: false,
    hasSignedDocument: false,
    attestation: null,
    signatoryName: null,
    evidenceRequired: ['SRN challan'],
    ...over,
  });

const codes = (r: ReturnType<typeof evaluateGate>): BlockerCode[] =>
  r.allowed ? [] : r.blockers.map((b) => b.code);

describe('ownership and checklist', () => {
  it('refuses an unassigned obligation', () => {
    expect(codes(gate({ taskAssigned: false }))).toContain('UNASSIGNED');
  });

  it('refuses while checklist items are outstanding', () => {
    const result = gate({ checklistDone: 1 });
    expect(codes(result)).toContain('CHECKLIST_INCOMPLETE');
    expect(!result.allowed && result.blockers[0]!.message).toContain('2 of 3');
  });

  it('allows an empty checklist — some rules have nothing to tick', () => {
    expect(gate({ checklistTotal: 0, checklistDone: 0 }).allowed).toBe(true);
  });

  it('does not police ownership or checklists on ungated reminders', () => {
    expect(
      gate({ evidenceLevel: 'NONE', taskAssigned: false, taskStatus: 'TODO', checklistDone: 0, documentCount: 0 }).allowed,
    ).toBe(true);
  });
});

describe('the task is the work, the obligation is the filing', () => {
  it('refuses while the task is still open', () => {
    expect(codes(gate({ taskStatus: 'TODO' }))).toEqual(['TASK_NOT_DONE']);
  });

  it('names the status it is waiting on', () => {
    const result = gate({ taskStatus: 'IN_PROGRESS' });
    expect(!result.allowed && result.blockers[0]!.message).toContain('still in progress');
  });

  it('treats a task with no status as not done', () => {
    expect(codes(gate({ taskStatus: null }))).toEqual(['TASK_NOT_DONE']);
  });

  it('allows once the work is marked done', () => {
    expect(gate({ taskStatus: 'DONE' }).allowed).toBe(true);
  });

  it('does not police task state on ungated reminders', () => {
    expect(gate({ evidenceLevel: 'NONE', taskStatus: 'TODO', documentCount: 0 }).allowed).toBe(true);
  });
});

describe('reporting', () => {
  it('reports every blocker at once, not one at a time', () => {
    const result = gate({ taskAssigned: false, taskStatus: 'TODO', checklistDone: 0, documentCount: 0 });
    expect(codes(result).sort()).toEqual([
      'CHECKLIST_INCOMPLETE',
      'EVIDENCE_REQUIRED',
      'TASK_NOT_DONE',
      'UNASSIGNED',
    ]);
  });

  it('lists them in the order the work actually happens', () => {
    const result = gate({ taskAssigned: false, taskStatus: 'TODO', checklistDone: 0, documentCount: 0 });
    // assign it -> work the checklist -> attach what it produced -> mark the
    // task done -> file the obligation.
    expect(codes(result)).toEqual(['UNASSIGNED', 'CHECKLIST_INCOMPLETE', 'EVIDENCE_REQUIRED', 'TASK_NOT_DONE']);
  });
});

describe('REQUIRED — a document, or nothing', () => {
  it('refuses with no document attached', () => {
    expect(codes(gate({ documentCount: 0 }))).toEqual(['EVIDENCE_REQUIRED']);
  });

  it('cannot be talked around with a declaration', () => {
    expect(codes(gate({ documentCount: 0, attestation: 'I filed it, honestly.' }))).toContain('EVIDENCE_REQUIRED');
  });

  it('allows once a document is attached', () => {
    expect(gate().allowed).toBe(true);
  });
});

describe('ATTEST — a document, or a declaration on the record', () => {
  const attest = (over: Partial<GateInput> = {}) => gate({ evidenceLevel: 'ATTEST', documentCount: 0, ...over });

  it('refuses a bare completion', () => {
    expect(codes(attest())).toEqual(['ATTESTATION_REQUIRED']);
  });

  it('rejects a token declaration', () => {
    expect(codes(attest({ attestation: 'done' }))).toEqual(['ATTESTATION_TOO_SHORT']);
  });

  it('accepts a declaration of substance, trimmed', () => {
    const result = attest({ attestation: '  Board met 12 June; minutes circulated.  ' });
    expect(result).toEqual({ allowed: true, attestation: 'Board met 12 June; minutes circulated.', signatoryName: null });
  });

  it('accepts a document instead — evidence outranks a declaration', () => {
    expect(attest({ documentCount: 1 }).allowed).toBe(true);
  });

  it('names the minimum length in the refusal', () => {
    const result = attest({ attestation: 'x' });
    expect(!result.allowed && result.blockers[0]!.message).toContain(String(MIN_ATTESTATION_LENGTH));
  });
});

describe('signatory', () => {
  it('requires a named signatory once a signed document is attached', () => {
    expect(codes(gate({ signatoryRequired: true }))).toEqual(['SIGNATORY_REQUIRED']);
  });

  it('accepts the filing once the signatory is named', () => {
    const result = gate({ signatoryRequired: true, signatoryName: 'Priya Ramanathan' });
    expect(result).toMatchObject({ allowed: true, signatoryName: 'Priya Ramanathan' });
  });

  it('rejects an initial standing in for a name', () => {
    expect(codes(gate({ signatoryRequired: true, signatoryName: 'PR' }))).toEqual(['SIGNATORY_REQUIRED']);
  });

  it('does not ask for a signatory before there is a document to sign', () => {
    // ATTEST with no document is closed by declaration; there is nothing signed yet.
    expect(codes(gate({ evidenceLevel: 'ATTEST', documentCount: 0, signatoryRequired: true, attestation: 'Meeting held on 12 June 2026.' }))).toEqual([]);
  });
});

describe('the catalog itself', () => {
  it('assigns an evidence level to every rule', () => {
    expect(allRules.filter((r) => !['REQUIRED', 'ATTEST', 'NONE'].includes(r.evidenceLevel)).map((r) => r.code)).toEqual([]);
  });

  it('only leaves a form-producing filing ungated where it is genuinely optional', () => {
    expect(allRules.filter((r) => r.form && r.evidenceLevel === 'NONE').map((r) => r.code)).toEqual(['GST_IFF']);
  });

  it('never marks a rule REQUIRED without saying what evidence it expects', () => {
    expect(allRules.filter((r) => r.evidenceLevel === 'REQUIRED' && r.evidenceRequired.length === 0).map((r) => r.code)).toEqual([]);
  });

  it('never asks for a signatory on a rule that needs no evidence at all', () => {
    expect(allRules.filter((r) => r.signatoryRequired && r.evidenceLevel === 'NONE').map((r) => r.code)).toEqual([]);
  });
});
