import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { allRules, getRule, rulesByAuthority } from '../../engine/catalog';
import { NotFoundError } from '../../lib/errors';
import { auth, requireAuth, requireCapability } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { ask, searchKnowledgeBase } from './copilot.service';

export const copilotRouter = Router();
copilotRouter.use(requireAuth);

const askLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

copilotRouter.post(
  '/ask',
  askLimiter,
  validateBody(
    z.object({
      question: z.string().min(3).max(1000),
      companyId: z.string().uuid().optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await ask(auth(req), req.body.question, req.body.companyId));
  }),
);

/** Search the regulatory knowledge base directly. */
copilotRouter.get(
  '/search',
  validateQuery(z.object({ q: z.string().min(2).max(200), limit: z.coerce.number().int().min(1).max(50).default(20) })),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.query as unknown as { q: string; limit: number };
    res.json(searchKnowledgeBase(q, limit));
  }),
);

export const rulesRouter = Router();
rulesRouter.use(requireAuth);
// The catalog is the compliance platform team's to maintain, not a firm's to
// read — an admin runs their own companies and has no business in here.
rulesRouter.use(requireCapability('rules.read'));

/** The full catalog — useful for building filters and reference pages. */
rulesRouter.get(
  '/',
  validateQuery(z.object({ authority: z.enum(['MCA', 'GST', 'INCOME_TAX', 'MSME', 'LABOUR']).optional() })),
  asyncHandler(async (req, res) => {
    const { authority } = req.query as { authority?: 'MCA' };
    const rules = authority ? rulesByAuthority(authority) : allRules;
    res.json(
      rules.map((r) => ({
        code: r.code,
        title: r.title,
        authority: r.authority,
        category: r.category,
        form: r.form ?? null,
        legalReference: r.legalReference,
        description: r.description,
        severity: r.severity,
        penalty: r.penalty,
        evidenceRequired: r.evidenceRequired,
        evidenceLevel: r.evidenceLevel,
        signatoryRequired: Boolean(r.signatoryRequired),
        periodKind: r.periodKind,
        conditions: r.applicableWhen.map((c) => c.label),
        exemptions: (r.excludeWhen ?? []).map((c) => c.label),
      })),
    );
  }),
);

rulesRouter.get(
  '/:code',
  validateParams(z.object({ code: z.string().max(60) })),
  asyncHandler(async (req, res) => {
    const rule = getRule(req.params.code!.toUpperCase());
    if (!rule) throw new NotFoundError(`Rule ${req.params.code}`);
    res.json({
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
      conditions: rule.applicableWhen.map((c) => c.label),
      exemptions: (rule.excludeWhen ?? []).map((c) => c.label),
    });
  }),
);
