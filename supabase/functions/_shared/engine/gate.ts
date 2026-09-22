import type { EvidenceLevel } from './types.ts';

export const MIN_ATTESTATION_LENGTH = 10;
export const MAX_ATTESTATION_LENGTH = 1000;
export const MIN_SIGNATORY_LENGTH = 3;

export type BlockerCode =
  | 'UNASSIGNED'
  | 'CHECKLIST_INCOMPLETE'
  | 'TASK_NOT_DONE'
  | 'EVIDENCE_REQUIRED'
  | 'ATTESTATION_REQUIRED'
  | 'ATTESTATION_TOO_SHORT'
  | 'ATTESTATION_TOO_LONG'
  | 'SIGNATORY_REQUIRED';

export interface GateBlocker {
  code: BlockerCode;
  message: string;
}

export interface GateInput {
  evidenceLevel: EvidenceLevel;
  documentCount: number;
  taskAssigned: boolean;
  taskStatus: string | null;
  checklistTotal: number;
  checklistDone: number;
  signatoryRequired: boolean;
  hasSignedDocument: boolean;
  attestation?: string | null;
  signatoryName?: string | null;
  evidenceRequired: string[];
}

export type GateResult =
  | { allowed: true; attestation: string | null; signatoryName: string | null }
  | { allowed: false; blockers: GateBlocker[]; expected: string[] };

export function evaluateGate(input: GateInput): GateResult {
  const blockers: GateBlocker[] = [];
  const attestation = input.attestation?.trim() || null;
  const signatoryName = input.signatoryName?.trim() || null;
  const gated = input.evidenceLevel !== 'NONE';

  if (gated && !input.taskAssigned) {
    blockers.push({
      code: 'UNASSIGNED',
      message: 'Assign this to someone first — a filing nobody owns is a filing nobody makes.',
    });
  }

  if (gated && input.checklistTotal > 0 && input.checklistDone < input.checklistTotal) {
    const outstanding = input.checklistTotal - input.checklistDone;
    blockers.push({
      code: 'CHECKLIST_INCOMPLETE',
      message: `${outstanding} of ${input.checklistTotal} checklist item${input.checklistTotal === 1 ? '' : 's'} still outstanding.`,
    });
  }

  if (input.evidenceLevel === 'REQUIRED' && input.documentCount === 0) {
    blockers.push({
      code: 'EVIDENCE_REQUIRED',
      message:
        'This filing produces a document — attach it before closing the obligation out. ' +
        'If it genuinely does not apply this period, waive it with a reason instead.',
    });
  }

  if (input.evidenceLevel === 'ATTEST' && input.documentCount === 0) {
    if (!attestation) {
      blockers.push({
        code: 'ATTESTATION_REQUIRED',
        message:
          'There is no external receipt for this obligation, so either attach supporting evidence ' +
          'or record a declaration of what was done. The declaration is stored against your name.',
      });
    } else if (attestation.length < MIN_ATTESTATION_LENGTH) {
      blockers.push({
        code: 'ATTESTATION_TOO_SHORT',
        message: `A declaration must be at least ${MIN_ATTESTATION_LENGTH} characters — say what was actually done.`,
      });
    }
  }

  if (attestation && attestation.length > MAX_ATTESTATION_LENGTH) {
    blockers.push({
      code: 'ATTESTATION_TOO_LONG',
      message: `A declaration must be at most ${MAX_ATTESTATION_LENGTH} characters.`,
    });
  }

  if (gated && input.taskStatus !== 'DONE') {
    const readable = (input.taskStatus ?? 'TODO').replace(/_/g, ' ').toLowerCase();
    blockers.push({
      code: 'TASK_NOT_DONE',
      message: `The task is still ${readable}. Move it to Done once the work is finished — completing the obligation is the separate, final step.`,
    });
  }

  if (input.signatoryRequired && input.documentCount > 0 && !signatoryName) {
    blockers.push({
      code: 'SIGNATORY_REQUIRED',
      message:
        'Name the person who signed this document. Their name is recorded against the filing and written to the audit trail.',
    });
  }
  if (signatoryName && signatoryName.length < MIN_SIGNATORY_LENGTH) {
    blockers.push({
      code: 'SIGNATORY_REQUIRED',
      message: `Give the signatory's full name (at least ${MIN_SIGNATORY_LENGTH} characters).`,
    });
  }

  if (blockers.length > 0) return { allowed: false, blockers, expected: input.evidenceRequired };
  return { allowed: true, attestation, signatoryName };
}
