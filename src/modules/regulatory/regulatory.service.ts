/**
 * Persistence and review flow for the regulatory watch.
 *
 * The one thing to hold on to while reading this file: the rule engine reads
 * exactly one of these tables, `rule_overlays`, and only through
 * `refreshOverlays()`. Updates and proposals are a paper trail. Nothing a model
 * wrote changes a company's calendar until a human with `rules.amend` has
 * approved it and that refresh has run.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Authority, OverlayStatus, ProposalStatus, RuleOverlay as RuleOverlayRow } from '@prisma/client';
import { env } from '../../config/env';
import { allRules, getRule } from '../../engine/catalog';
import { setRuleOverlays, type RuleOverlay } from '../../engine/overlay';
import { addDays, today } from '../../lib/dates';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import type { Actor } from '../../lib/access';
import { regenerateCompanySystem } from '../compliance/compliance.service';
import {
  overlayPatchSchema,
  type ModelProposal,
  type ModelUpdate,
  type OverlayPatchInput,
} from './regulatory.schemas';
import { runWatch } from './watcher';

const ALL_AUTHORITIES: Authority[] = ['MCA', 'GST', 'INCOME_TAX', 'MSME', 'LABOUR', 'DPIIT'];

/**
 * The dedupe key.
 *
 * Built from the issuing reference where there is one, because that is what
 * actually identifies a circular — the same document is reachable at several
 * URLs and its title gets transcribed inconsistently. Only when there is no
 * reference does the URL carry the identity.
 */
export function fingerprintUpdate(update: Pick<ModelUpdate, 'authority' | 'referenceNo' | 'title' | 'url'>): string {
  const identity = update.referenceNo?.trim()
    ? `${update.authority}::${update.referenceNo.trim().toLowerCase()}`
    : `${update.authority}::${update.url.trim().toLowerCase()}::${update.title.trim().toLowerCase()}`;
  return createHash('sha256').update(identity).digest('hex');
}

const toDate = (iso: string | null | undefined): Date | null =>
  iso ? new Date(`${iso}T00:00:00.000Z`) : null;

// ------------------------------------------------------------ engine refresh

/**
 * Load the active overlays and push them into the engine.
 *
 * Called at boot, after every approval or revocation, and once per daily job —
 * the last so a long-lived process picks up an overlay whose effective window
 * opened overnight.
 *
 * Creation order is the application order: a later circular amending an earlier
 * one must win, so the sort is not incidental.
 */
export async function refreshOverlays(): Promise<{ active: number; skipped: number }> {
  const rows = await prisma.ruleOverlay.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  const overlays: RuleOverlay[] = [];
  let skipped = 0;

  for (const row of rows) {
    // A row can rot: its rule may have been renamed out of the catalog, or its
    // patch may name a predicate a later release removed. Dropping one bad
    // overlay is right; letting it throw would take the whole engine down.
    if (!getRule(row.ruleCode)) {
      logger.warn({ overlayId: row.id, ruleCode: row.ruleCode }, 'overlay references an unknown rule — skipping');
      skipped += 1;
      continue;
    }

    const parsed = overlayPatchSchema.safeParse(row.patch);
    if (!parsed.success) {
      logger.error(
        { overlayId: row.id, ruleCode: row.ruleCode, issues: parsed.error.issues },
        'overlay patch is no longer valid against the engine — skipping',
      );
      skipped += 1;
      continue;
    }

    overlays.push({
      id: row.id,
      ruleCode: row.ruleCode,
      patch: parsed.data,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      note: row.note,
    });
  }

  setRuleOverlays(overlays);
  logger.info({ active: overlays.length, skipped }, 'rule overlays refreshed');
  return { active: overlays.length, skipped };
}

/**
 * Push an amended rule out to the calendars that already exist.
 *
 * `refreshOverlays()` changes what the *engine* says; it does not touch the
 * `compliance_items` rows that were materialised from the old answer. Without
 * this step an approved extension is invisible: the rule reads "due 29
 * November", every company's calendar still says 30 October, and the reminder
 * job keeps mailing the old date. Regeneration is the same idempotent diff
 * `syncCompany` runs, so completed work, evidence and history are preserved.
 *
 * Scope is the companies that have ever been evaluated against the rule, not
 * every company: an overlay on a GST rule has no bearing on a company with no
 * GSTIN, and regenerating it would be wasted work.
 */
export async function propagateRuleChange(ruleCode: string): Promise<{
  companiesResynced: number;
  itemsChanged: number;
  failed: number;
}> {
  const rows = await prisma.complianceApplicability.findMany({
    where: { ruleCode },
    select: { companyId: true },
    distinct: ['companyId'],
  });

  let itemsChanged = 0;
  let failed = 0;

  for (const { companyId } of rows) {
    try {
      const result = await regenerateCompanySystem(companyId);
      itemsChanged += result.created + result.updated + result.removed;
    } catch (err) {
      // One unregeneratable company — an archived row, a profile that has since
      // lost its incorporation date — must not strand the amendment for
      // everyone else. The nightly sync picks it up again.
      failed += 1;
      logger.error({ err, companyId, ruleCode }, 'could not regenerate a company after a rule change');
    }
  }

  logger.info({ ruleCode, companies: rows.length, itemsChanged, failed }, 'rule change propagated to calendars');
  return { companiesResynced: rows.length - failed, itemsChanged, failed };
}

// ------------------------------------------------------------------ the sweep

export interface SweepOptions {
  authorities?: Authority[];
  lookbackDays?: number;
  jobRunId?: string;
}

export interface SweepResult {
  ran: boolean;
  reason?: string;
  updatesFound: number;
  updatesStored: number;
  proposalsStored: number;
  needsCodeChange: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * One regulatory sweep: research, extract, store.
 *
 * Idempotent by fingerprint. Re-running after a failure, or with an overlapping
 * lookback window, re-reads the same circulars and stores nothing new.
 */
export async function runRegulatorySweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const empty: SweepResult = {
    ran: false,
    updatesFound: 0,
    updatesStored: 0,
    proposalsStored: 0,
    needsCodeChange: 0,
    tokensIn: 0,
    tokensOut: 0,
  };

  if (!env.regulatoryWatchEnabled) {
    const reason = env.claudeEnabled
      ? 'REGULATORY_WATCH_ENABLED is off'
      : 'ANTHROPIC_API_KEY is not set';
    logger.info({ reason }, 'regulatory sweep skipped');
    return { ...empty, reason };
  }

  const authorities = opts.authorities?.length ? opts.authorities : ALL_AUTHORITIES;
  const lookbackDays = opts.lookbackDays ?? env.REGULATORY_WATCH_LOOKBACK_DAYS;
  const until = today();
  const since = addDays(until, -lookbackDays);

  const { findings, researchText, sources, usage } = await runWatch({ since, until, authorities });

  const capped = findings.updates.slice(0, env.REGULATORY_WATCH_MAX_UPDATES);
  if (capped.length < findings.updates.length) {
    logger.warn(
      { found: findings.updates.length, cap: env.REGULATORY_WATCH_MAX_UPDATES },
      'regulatory sweep truncated to the per-run cap',
    );
  }

  let updatesStored = 0;
  let proposalsStored = 0;
  let needsCodeChange = 0;

  for (const update of capped) {
    const stored = await storeUpdate(update, {
      jobRunId: opts.jobRunId,
      researchText,
      sources,
    });
    if (!stored) continue;

    updatesStored += 1;
    proposalsStored += stored.proposals;
    needsCodeChange += stored.codeChanges;
  }

  const tokensIn = usage.research.inputTokens + usage.extraction.inputTokens;
  const tokensOut = usage.research.outputTokens + usage.extraction.outputTokens;

  logger.info(
    { updatesFound: capped.length, updatesStored, proposalsStored, needsCodeChange, tokensIn, tokensOut },
    'regulatory sweep complete',
  );

  return {
    ran: true,
    updatesFound: capped.length,
    updatesStored,
    proposalsStored,
    needsCodeChange,
    tokensIn,
    tokensOut,
  };
}

/**
 * Store one update and its proposals, skipping anything already seen.
 *
 * Returns null when the fingerprint is already known — the ordinary outcome on
 * a re-run, and not worth logging at info level.
 */
async function storeUpdate(
  update: ModelUpdate,
  ctx: { jobRunId?: string; researchText: string; sources: string[] },
): Promise<{ proposals: number; codeChanges: number } | null> {
  const fingerprint = fingerprintUpdate(update);

  const existing = await prisma.regulatoryUpdate.findUnique({ where: { fingerprint } });
  if (existing) return null;

  const prepared = update.proposals.map((p) => prepareProposal(p));
  const codeChanges = prepared.filter((p) => p.status === 'CODE_CHANGE_REQUIRED').length;

  try {
    await prisma.regulatoryUpdate.create({
      data: {
        authority: update.authority,
        referenceNo: update.referenceNo,
        title: update.title,
        summary: update.summary,
        url: update.url,
        publishedOn: toDate(update.publishedOn),
        documentType: update.documentType,
        fingerprint,
        impactSummary: update.impactSummary,
        raw: {
          // The write-up is kept once per update rather than deduplicated:
          // storage is cheap, and a reviewer reading a proposal a month later
          // needs the reasoning that produced it, not a dangling reference.
          researchText: ctx.researchText,
          sources: ctx.sources,
        } as Prisma.InputJsonValue,
        jobRunId: ctx.jobRunId ?? null,
        proposals: {
          create: prepared.map((p) => ({
            ruleCode: p.ruleCode,
            changeKind: p.changeKind,
            status: p.status,
            title: p.title,
            rationale: p.rationale,
            patch: (p.patch ?? {}) as Prisma.InputJsonValue,
            confidence: p.confidence,
            citations: [update.url, ...ctx.sources.slice(0, 10)] as Prisma.InputJsonValue,
            appliesToNote: p.appliesToNote,
          })),
        },
      },
    });
  } catch (err) {
    // Two replicas sweeping at once both pass the findUnique above. The unique
    // index is the real guard; losing the race is expected, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }

  await supersedeOlderProposals(prepared.map((p) => p.ruleCode).filter((c): c is string => Boolean(c)));

  return { proposals: prepared.length, codeChanges };
}

interface PreparedProposal {
  ruleCode: string | null;
  changeKind: ModelProposal['changeKind'];
  status: ProposalStatus;
  title: string;
  rationale: string;
  patch: OverlayPatchInput | null;
  confidence: number;
  appliesToNote: string | null;
}

/**
 * Decide what a drafted proposal is actually worth before it is stored.
 *
 * Three ways it lands as CODE_CHANGE_REQUIRED rather than PENDING: the model
 * said so itself, it names a rule that does not exist, or its patch fails
 * validation. In all three the rationale is kept — a proposal an engineer has
 * to implement by hand is still a useful finding, and silently dropping it
 * would mean the circular goes unnoticed.
 */
function prepareProposal(proposal: ModelProposal): PreparedProposal {
  const base = {
    ruleCode: proposal.ruleCode,
    changeKind: proposal.changeKind,
    title: proposal.title,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    appliesToNote: proposal.appliesToNote,
  };

  const parked = (why: string): PreparedProposal => ({
    ...base,
    status: 'CODE_CHANGE_REQUIRED',
    patch: null,
    rationale: `${proposal.rationale}\n\n[Not applicable as a data overlay: ${why}]`,
  });

  if (proposal.changeKind === 'NEW_RULE' || !proposal.expressibleAsOverlay) {
    return parked('the change needs a catalog edit, not an overlay');
  }
  if (!proposal.ruleCode) {
    return parked('no rule code was given');
  }
  if (!getRule(proposal.ruleCode)) {
    return parked(`rule code "${proposal.ruleCode}" is not in the catalog`);
  }

  const parsed = overlayPatchSchema.safeParse(proposal.patch ?? {});
  if (!parsed.success) {
    return parked(
      `the drafted patch is invalid — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  return { ...base, status: 'PENDING', patch: parsed.data };
}

/**
 * An older pending proposal for the same rule is stale once a newer circular
 * has been read. Marking it superseded keeps the queue honest — a reviewer
 * should not approve a due-date shift that a later notification already
 * replaced.
 */
async function supersedeOlderProposals(ruleCodes: string[]): Promise<void> {
  if (ruleCodes.length === 0) return;

  const codes = [...new Set(ruleCodes)];
  const newest = await prisma.ruleChangeProposal.findMany({
    where: { ruleCode: { in: codes }, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ruleCode: true },
  });

  const keep = new Set<string>();
  const supersede: string[] = [];
  for (const row of newest) {
    if (!row.ruleCode) continue;
    if (keep.has(row.ruleCode)) supersede.push(row.id);
    else keep.add(row.ruleCode);
  }

  if (supersede.length === 0) return;
  await prisma.ruleChangeProposal.updateMany({
    where: { id: { in: supersede } },
    data: { status: 'SUPERSEDED' },
  });
}

// ------------------------------------------------------------------- reading

export async function listUpdates(opts: { authority?: Authority; limit: number; cursor?: string }) {
  return prisma.regulatoryUpdate.findMany({
    where: opts.authority ? { authority: opts.authority } : undefined,
    orderBy: [{ publishedOn: 'desc' }, { discoveredAt: 'desc' }],
    take: opts.limit,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      proposals: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, ruleCode: true, changeKind: true, status: true, title: true, confidence: true },
      },
    },
  });
}

export async function listProposals(opts: {
  status?: ProposalStatus;
  ruleCode?: string;
  limit: number;
  cursor?: string;
}) {
  const rows = await prisma.ruleChangeProposal.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.ruleCode ? { ruleCode: opts.ruleCode } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: opts.limit,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      update: {
        select: { id: true, authority: true, referenceNo: true, title: true, url: true, publishedOn: true },
      },
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  // The rule as it stands today, so a reviewer can see what the patch would
  // change without opening a second screen.
  return rows.map((row) => {
    const rule = row.ruleCode ? getRule(row.ruleCode) : undefined;
    return {
      ...row,
      currentRule: rule
        ? {
            code: rule.code,
            title: rule.title,
            authority: rule.authority,
            form: rule.form ?? null,
            legalReference: rule.legalReference,
            severity: rule.severity,
            evidenceLevel: rule.evidenceLevel,
            applicableWhen: rule.applicableWhen.map((c) => c.label),
            excludeWhen: (rule.excludeWhen ?? []).map((c) => c.label),
          }
        : null,
    };
  });
}

export async function listOverlays(opts: { status?: OverlayStatus } = {}) {
  return prisma.ruleOverlay.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      revokedBy: { select: { id: true, name: true, email: true } },
      proposal: { select: { id: true, title: true, updateId: true } },
    },
  });
}

/** Everything a reviewer or the engineering team needs to see the queue's shape. */
export async function watchStatus() {
  const [pending, codeChange, activeOverlays, latestUpdate] = await Promise.all([
    prisma.ruleChangeProposal.count({ where: { status: 'PENDING' } }),
    prisma.ruleChangeProposal.count({ where: { status: 'CODE_CHANGE_REQUIRED' } }),
    prisma.ruleOverlay.count({ where: { status: 'ACTIVE' } }),
    prisma.regulatoryUpdate.findFirst({ orderBy: { discoveredAt: 'desc' }, select: { discoveredAt: true } }),
  ]);

  return {
    enabled: env.regulatoryWatchEnabled,
    claudeConfigured: env.claudeEnabled,
    model: env.claudeEnabled ? env.ANTHROPIC_MODEL : null,
    lookbackDays: env.REGULATORY_WATCH_LOOKBACK_DAYS,
    staticRules: allRules.length,
    pendingProposals: pending,
    proposalsNeedingCode: codeChange,
    activeOverlays,
    lastSweepAt: latestUpdate?.discoveredAt ?? null,
  };
}

// ------------------------------------------------------------------- deciding

export interface ApproveInput {
  patch?: OverlayPatchInput;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  note: string;
  reviewNote?: string;
}

/**
 * Approve a proposal: create the overlay, link it, and refresh the engine.
 *
 * The reviewer's patch wins over the drafted one where supplied. Everything
 * happens in a transaction so a proposal can never be marked approved without
 * the overlay that is supposed to back it.
 */
export interface AmendmentResult {
  overlay: RuleOverlayRow;
  propagation: { companiesResynced: number; itemsChanged: number; failed: number };
}

export async function approveProposal(
  actor: Actor,
  proposalId: string,
  input: ApproveInput,
): Promise<AmendmentResult> {
  const proposal = await prisma.ruleChangeProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new NotFoundError('Proposal not found');

  if (proposal.status === 'APPROVED') throw new ConflictError('This proposal has already been approved.');
  if (proposal.status === 'CODE_CHANGE_REQUIRED') {
    throw new BadRequestError(
      'This proposal cannot be applied as a data overlay — it needs a change to the rule catalog.',
    );
  }
  if (!proposal.ruleCode) throw new BadRequestError('This proposal names no rule and cannot become an overlay.');
  if (!getRule(proposal.ruleCode)) {
    throw new BadRequestError(`Rule ${proposal.ruleCode} is no longer in the catalog.`);
  }

  // Re-validate even the stored patch: the catalog may have moved since the
  // proposal was drafted, and approval is the last point at which that is cheap
  // to catch.
  const candidate = input.patch ?? proposal.patch;
  const parsed = overlayPatchSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BadRequestError(
      'The patch is not valid against the current engine.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  const overlay = await prisma.$transaction(async (tx) => {
    const created = await tx.ruleOverlay.create({
      data: {
        ruleCode: proposal.ruleCode!,
        patch: parsed.data as Prisma.InputJsonValue,
        effectiveFrom: toDate(input.effectiveFrom),
        effectiveTo: toDate(input.effectiveTo),
        note: input.note,
        createdById: actor.userId,
      },
    });

    await tx.ruleChangeProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPROVED',
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
        overlayId: created.id,
        // Store what was actually approved, not what was drafted.
        patch: parsed.data as Prisma.InputJsonValue,
      },
    });

    return created;
  });

  await refreshOverlays();
  const propagation = await propagateRuleChange(overlay.ruleCode);
  logger.info(
    { overlayId: overlay.id, ruleCode: overlay.ruleCode, proposalId, by: actor.userId, ...propagation },
    'rule overlay approved and applied',
  );

  return { overlay, propagation };
}

export async function rejectProposal(
  actor: Actor,
  proposalId: string,
  input: { reviewNote: string; needsCodeChange: boolean },
) {
  const proposal = await prisma.ruleChangeProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new NotFoundError('Proposal not found');
  if (proposal.status === 'APPROVED') {
    throw new ConflictError('This proposal is already approved — revoke its overlay instead.');
  }

  return prisma.ruleChangeProposal.update({
    where: { id: proposalId },
    data: {
      status: input.needsCodeChange ? 'CODE_CHANGE_REQUIRED' : 'REJECTED',
      reviewedById: actor.userId,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote,
    },
  });
}

export async function createOverlay(
  actor: Actor,
  input: { ruleCode: string; patch: OverlayPatchInput; effectiveFrom?: string | null; effectiveTo?: string | null; note: string },
): Promise<AmendmentResult> {
  if (!getRule(input.ruleCode)) throw new BadRequestError(`Rule ${input.ruleCode} is not in the catalog.`);

  const overlay = await prisma.ruleOverlay.create({
    data: {
      ruleCode: input.ruleCode,
      patch: input.patch as Prisma.InputJsonValue,
      effectiveFrom: toDate(input.effectiveFrom),
      effectiveTo: toDate(input.effectiveTo),
      note: input.note,
      createdById: actor.userId,
    },
  });

  await refreshOverlays();
  const propagation = await propagateRuleChange(overlay.ruleCode);
  logger.info(
    { overlayId: overlay.id, ruleCode: overlay.ruleCode, by: actor.userId, ...propagation },
    'rule overlay created by hand',
  );
  return { overlay, propagation };
}

/**
 * Revoke an overlay. The committed catalog behaviour returns on refresh.
 *
 * The row is kept rather than deleted: a company that filed against an extended
 * deadline needs the extension to remain explicable afterwards.
 */
export async function revokeOverlay(actor: Actor, overlayId: string, reason: string): Promise<AmendmentResult> {
  const overlay = await prisma.ruleOverlay.findUnique({ where: { id: overlayId } });
  if (!overlay) throw new NotFoundError('Overlay not found');
  if (overlay.status === 'REVOKED') throw new ConflictError('This overlay is already revoked.');

  const updated = await prisma.ruleOverlay.update({
    where: { id: overlayId },
    data: {
      status: 'REVOKED',
      revokedById: actor.userId,
      revokedAt: new Date(),
      revokeReason: reason,
    },
  });

  await refreshOverlays();
  // Revocation restores the committed catalog behaviour, which is just as much
  // a change to every calendar as the approval was.
  const propagation = await propagateRuleChange(overlay.ruleCode);
  logger.info({ overlayId, ruleCode: overlay.ruleCode, by: actor.userId, ...propagation }, 'rule overlay revoked');
  return { overlay: updated, propagation };
}
