/**
 * Validation for everything the regulatory watch writes or is asked to write.
 *
 * Two audiences, one schema set. Claude's output and an admin's request body go
 * through the same `overlayPatchSchema`, because a patch is dangerous in
 * proportion to what it says, not to who said it. Structured output guarantees
 * a shape; this is what decides whether the shape is *allowed*.
 */
import { z } from 'zod';
import { PREDICATES, predicateNames } from '../../engine/predicates';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

/**
 * A predicate reference, checked against the engine's registry — both that the
 * name exists and that the arguments fit it. An unknown predicate is the single
 * most likely thing for a model to invent, so it is rejected here with a
 * message that names what *was* available.
 */
export const predicateRefSchema = z
  .object({
    predicate: z.string().min(1),
    args: z.unknown().optional(),
  })
  .superRefine((ref, ctx) => {
    const spec = PREDICATES[ref.predicate];
    if (!spec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown predicate "${ref.predicate}". Available: ${predicateNames().join(', ')}`,
        path: ['predicate'],
      });
      return;
    }

    const parsed = spec.args.safeParse(ref.args);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid arguments for "${ref.predicate}": ${issue.message}`,
          path: ['args', ...issue.path],
        });
      }
    }
  });

const SEVERITY = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const EVIDENCE_LEVEL = z.enum(['REQUIRED', 'ATTEST', 'NONE']);

/**
 * The full surface an overlay may touch. Mirrors RuleOverlayPatch in
 * src/engine/overlay.ts; the two must be changed together, and the test suite
 * asserts they have not drifted.
 */
export const overlayPatchSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().min(10).max(2000).optional(),
    penalty: z.string().min(3).max(1000).optional(),
    legalReference: z.string().min(3).max(300).optional(),
    category: z.string().min(2).max(100).optional(),
    form: z.string().min(1).max(60).optional(),
    severity: SEVERITY.optional(),

    evidenceLevel: EVIDENCE_LEVEL.optional(),
    evidenceRequired: z.array(z.string().min(2).max(200)).max(20).optional(),
    signatoryRequired: z.boolean().optional(),

    // A shift beyond a year is almost certainly a misread date rather than a
    // real extension, and it would move deadlines into the next financial year.
    dueDateShiftDays: z.number().int().min(-365).max(365).optional(),
    dueDateOverrides: z.record(z.string().min(1), ISO_DATE).optional(),
    suspendedFrom: ISO_DATE.optional(),
    suspendedTo: ISO_DATE.optional(),

    addApplicableWhen: z.array(predicateRefSchema).max(10).optional(),
    addExcludeWhen: z.array(predicateRefSchema).max(10).optional(),
    removeConditionLabels: z.array(z.string().min(1).max(300)).max(10).optional(),

    withdrawn: z.boolean().optional(),
    withdrawnReason: z.string().min(5).max(500).optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    if (Object.keys(patch).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'An overlay patch cannot be empty.' });
    }
    if (patch.suspendedFrom && patch.suspendedTo && patch.suspendedTo < patch.suspendedFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'suspendedTo must not precede suspendedFrom.',
        path: ['suspendedTo'],
      });
    }
    // A shift and an override on the same patch is not wrong, but a suspension
    // silently swallowing a shift is: say what you mean.
    if (patch.withdrawn && (patch.dueDateShiftDays || patch.suspendedFrom)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A withdrawn rule produces no obligations — do not also shift or suspend it.',
      });
    }
  });

export type OverlayPatchInput = z.infer<typeof overlayPatchSchema>;

export const CHANGE_KINDS = [
  'DUE_DATE_SHIFT',
  'DUE_DATE_OVERRIDE',
  'THRESHOLD_CHANGE',
  'APPLICABILITY_CHANGE',
  'EVIDENCE_CHANGE',
  'PENALTY_CHANGE',
  'TEXT_UPDATE',
  'SUSPENSION',
  'WITHDRAWAL',
  'NEW_RULE',
] as const;

export const AUTHORITIES = ['MCA', 'GST', 'INCOME_TAX', 'MSME', 'LABOUR', 'DPIIT'] as const;

// ------------------------------------------------------ what the model returns

/**
 * The extraction contract.
 *
 * `patch` is deliberately typed loosely here and validated separately by
 * `overlayPatchSchema`: a proposal whose patch is malformed is still worth
 * keeping as a CODE_CHANGE_REQUIRED row with the reasoning intact, rather than
 * throwing away the whole batch because one field was wrong.
 */
export const modelProposalSchema = z.object({
  ruleCode: z.string().max(60).nullable(),
  changeKind: z.enum(CHANGE_KINDS),
  title: z.string().min(5).max(200),
  rationale: z.string().min(20).max(4000),
  appliesToNote: z.string().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  patch: z.record(z.string(), z.unknown()).nullable(),
  /** The model's own verdict on whether this fits the overlay vocabulary. */
  expressibleAsOverlay: z.boolean(),
});

export const modelUpdateSchema = z.object({
  authority: z.enum(AUTHORITIES),
  referenceNo: z.string().max(120).nullable(),
  title: z.string().min(5).max(400),
  summary: z.string().min(20).max(3000),
  url: z.string().url().max(1000),
  publishedOn: ISO_DATE.nullable(),
  documentType: z.string().max(60).nullable(),
  impactSummary: z.string().max(2000).nullable(),
  proposals: z.array(modelProposalSchema).max(10),
});

export const modelFindingsSchema = z.object({
  updates: z.array(modelUpdateSchema).max(60),
});

export type ModelProposal = z.infer<typeof modelProposalSchema>;
export type ModelUpdate = z.infer<typeof modelUpdateSchema>;
export type ModelFindings = z.infer<typeof modelFindingsSchema>;

/**
 * The JSON Schema handed to `output_config.format`.
 *
 * Kept by hand rather than generated from the zod schema above: the project is
 * on zod 3 and the SDK's generator wants zod 4, and a hand-written schema is
 * also where the field-level guidance for the model lives. The zod schema
 * remains the enforcing one — this only constrains the shape.
 */
export const FINDINGS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['updates'],
  properties: {
    updates: {
      type: 'array',
      description: 'One entry per distinct statutory document. Empty if nothing relevant was published.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'authority',
          'referenceNo',
          'title',
          'summary',
          'url',
          'publishedOn',
          'documentType',
          'impactSummary',
          'proposals',
        ],
        properties: {
          authority: { type: 'string', enum: [...AUTHORITIES] },
          referenceNo: {
            type: ['string', 'null'],
            description: 'Issuing reference, e.g. "General Circular 09/2026". Null if the document carries none.',
          },
          title: { type: 'string' },
          summary: { type: 'string', description: 'What the document says, in two or three sentences.' },
          url: { type: 'string', description: 'Direct link on the issuing authority’s own domain.' },
          publishedOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null if the document is undated.' },
          documentType: {
            type: ['string', 'null'],
            description: 'Circular, Notification, Amendment Rules, Order, or Press Release.',
          },
          impactSummary: {
            type: ['string', 'null'],
            description: 'Which obligations this moves and for whom. Null if relevant but not tied to a specific rule.',
          },
          proposals: {
            type: 'array',
            description: 'Empty when the document is informational and changes no obligation.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'ruleCode',
                'changeKind',
                'title',
                'rationale',
                'appliesToNote',
                'confidence',
                'patch',
                'expressibleAsOverlay',
              ],
              properties: {
                ruleCode: {
                  type: ['string', 'null'],
                  description: 'An existing rule code from the catalog index. Null only when changeKind is NEW_RULE.',
                },
                changeKind: { type: 'string', enum: [...CHANGE_KINDS] },
                title: { type: 'string', description: 'One line an admin can scan in a review queue.' },
                rationale: {
                  type: 'string',
                  description:
                    'Why this change follows from the document. Quote the operative sentence. State any assumption you had to make.',
                },
                appliesToNote: {
                  type: ['string', 'null'],
                  description: 'Which companies this touches, in plain English, e.g. "Pvt Ltd with turnover over ₹5 crore".',
                },
                confidence: {
                  type: 'number',
                  description:
                    '0-1. Below 0.5 means you are inferring rather than reading. Do not inflate it.',
                },
                patch: {
                  type: ['object', 'null'],
                  description:
                    'A RuleOverlayPatch using only the documented fields and the predicate vocabulary. Null when expressibleAsOverlay is false.',
                  additionalProperties: true,
                },
                expressibleAsOverlay: {
                  type: 'boolean',
                  description:
                    'False when the change needs logic the overlay vocabulary cannot express — a new schedule shape, a predicate that does not exist, or an entirely new rule.',
                },
              },
            },
          },
        },
      },
    },
  },
};

// ------------------------------------------------------------- API request DTOs

export const listUpdatesQuerySchema = z.object({
  authority: z.enum(AUTHORITIES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export const listProposalsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CODE_CHANGE_REQUIRED', 'SUPERSEDED']).optional(),
  ruleCode: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

/**
 * Approving a proposal.
 *
 * The reviewer may replace the drafted patch outright — the common case being a
 * proposal that read the circular correctly but reached for the wrong threshold.
 * Whatever is approved is what gets stored, so the overlay always reflects the
 * human's decision rather than the model's draft.
 */
export const approveProposalSchema = z.object({
  patch: overlayPatchSchema.optional(),
  effectiveFrom: ISO_DATE.nullable().optional(),
  effectiveTo: ISO_DATE.nullable().optional(),
  note: z.string().min(5).max(500),
  reviewNote: z.string().max(2000).optional(),
});

export const rejectProposalSchema = z.object({
  reviewNote: z.string().min(3).max(2000),
  /** Real but not expressible as data — parks it for an engineer instead of discarding it. */
  needsCodeChange: z.boolean().default(false),
});

/** Creating an overlay by hand, without a proposal behind it. */
export const createOverlaySchema = z.object({
  ruleCode: z.string().min(2).max(60),
  patch: overlayPatchSchema,
  effectiveFrom: ISO_DATE.nullable().optional(),
  effectiveTo: ISO_DATE.nullable().optional(),
  note: z.string().min(5).max(500),
});

export const revokeOverlaySchema = z.object({
  reason: z.string().min(3).max(500),
});

export const runWatchSchema = z.object({
  /** Narrow a manual run to one authority — useful when chasing a known circular. */
  authorities: z.array(z.enum(AUTHORITIES)).min(1).optional(),
  lookbackDays: z.coerce.number().int().min(1).max(365).optional(),
});
