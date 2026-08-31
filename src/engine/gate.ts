/**
 * The completion gate.
 *
 * Nothing here reaches MCA, GSTN or the Income Tax Department, so "completed"
 * is a claim. This decides what has to be true before that claim is accepted:
 * the work is owned, the checklist is actually worked through, the evidence
 * exists, and — where a human signs the document — that human is named.
 *
 * Pure, so the policy is exhaustively testable without a database, and reused
 * by both completion paths (the obligation and its task) so neither can become
 * the soft way around the other.
 */
import type { EvidenceLevel } from './types';

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
  /** Whether the linked task has an owner. */
  taskAssigned: boolean;
  /**
   * The linked task's status. Finishing the *work* and filing the *obligation*
   * are two acts: the task reaching DONE is a precondition for completion, not
   * completion itself.
   */
  taskStatus: string | null;
  checklistTotal: number;
  checklistDone: number;
  /** The rule expects a named human signatory on the document. */
  signatoryRequired: boolean;
  /** True when at least one attached PDF carries a digital signature. */
  hasSignedDocument: boolean;
  attestation?: string | null;
  signatoryName?: string | null;
  evidenceRequired: string[];
}

export type GateResult =
  | { allowed: true; attestation: string | null; signatoryName: string | null }
  | { allowed: false; blockers: GateBlocker[]; expected: string[] };

/**
 * Collects *every* blocker rather than failing on the first.
 *
 * Someone closing out a filing should be told all of what is missing in one
 * pass — assign it, tick the checklist, attach the challan — not discover the
 * next requirement each time they retry.
 */
export function evaluateGate(input: GateInput): GateResult {
  const blockers: GateBlocker[] = [];
  const attestation = input.attestation?.trim() || null;
  const signatoryName = input.signatoryName?.trim() || null;
  const gated = input.evidenceLevel !== 'NONE';

  // ── ownership ─────────────────────────────────────────────────────────────
  if (gated && !input.taskAssigned) {
    blockers.push({
      code: 'UNASSIGNED',
      message: 'Assign this to someone first — a filing nobody owns is a filing nobody makes.',
    });
  }

  // ── the checklist is the work, not decoration ─────────────────────────────
  if (gated && input.checklistTotal > 0 && input.checklistDone < input.checklistTotal) {
    const outstanding = input.checklistTotal - input.checklistDone;
    blockers.push({
      code: 'CHECKLIST_INCOMPLETE',
      message: `${outstanding} of ${input.checklistTotal} checklist item${input.checklistTotal === 1 ? '' : 's'} still outstanding.`,
    });
  }

  // ── evidence ──────────────────────────────────────────────────────────────
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

  // ── the work is finished ──────────────────────────────────────────────────
  //
  // Deliberately checked after evidence, because that is the order the work
  // happens in: assign it, work the checklist, attach what it produced, then
  // mark the task done and only then file the obligation.
  if (gated && input.taskStatus !== 'DONE') {
    const readable = (input.taskStatus ?? 'TODO').replace(/_/g, ' ').toLowerCase();
    blockers.push({
      code: 'TASK_NOT_DONE',
      message: `The task is still ${readable}. Move it to Done once the work is finished — completing the obligation is the separate, final step.`,
    });
  }

  // ── accountability for a signed document ──────────────────────────────────
  //
  // A scanned wet-ink signature cannot be verified by software. Where a rule's
  // evidence is a signed document, the control is therefore a *named* person on
  // the record rather than a cryptographic check. When the PDF does carry a
  // digital signature we read and store it, but a DSC is not assumed — most
  // minutes are signed on paper.
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
