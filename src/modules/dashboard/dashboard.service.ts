import type { Authority, ItemStatus, Severity } from '@prisma/client';
import { addDays, today } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { computeComplianceScore, type ScorableItem, type ScoreResult } from '../../engine/score';
import { getCompanyOrThrow } from '../companies/companies.service';
import { assertCan, companyScope, type Actor } from '../../lib/access';

async function scorableItems(actor: Actor, companyId?: string): Promise<ScorableItem[]> {
  const rows = await prisma.complianceItem.findMany({
    where: { company: companyScope(actor, companyId) },
    select: {
      ruleCode: true,
      authority: true,
      severity: true,
      dueDate: true,
      status: true,
      completedAt: true,
      company: { select: { createdAt: true } },
    },
  });
  return rows.map((r) => ({
    ruleCode: r.ruleCode,
    authority: r.authority,
    severity: r.severity,
    dueDate: r.dueDate,
    status: r.status,
    completedAt: r.completedAt,
    onboardedAt: r.company.createdAt,
  }));
}

export async function computeScore(actor: Actor, companyId?: string): Promise<ScoreResult> {
  return computeComplianceScore(await scorableItems(actor, companyId));
}

export interface Overview {
  score: ScoreResult;
  companies: number;
  statusCounts: Record<ItemStatus, number>;
  severityCounts: Record<Severity, number>;
  byAuthority: Array<{ authority: Authority; total: number; overdue: number; completed: number; upcoming: number }>;
  overdue: unknown[];
  dueSoon: unknown[];
  taskCounts: Record<string, number>;
  evidence: { itemsRequiringEvidence: number; itemsWithEvidence: number; coveragePct: number };
  /** Only with one company in view — there is no single entity to describe otherwise. */
  profile: CompanyProfile | null;
}

/**
 * The entity's own particulars, as opposed to what it owes.
 *
 * A reviewer opens a company and asks the same questions first — what is the
 * CIN, who are the directors, is it a registered MSME, is the DSC still good.
 * Those answers live across four tables, so the dashboard assembles them once
 * rather than making the front end fetch the whole company profile to show ten
 * fields of it.
 */
export interface CompanyProfile {
  id: string;
  legalName: string;
  entityType: string;
  /** CIN for a Companies Act entity, LLPIN for an LLP — whichever it has. */
  registrationLabel: 'CIN' | 'LLPIN' | 'PAN';
  registrationNumber: string | null;
  incorporationDate: string | null;
  /** Whole years since incorporation, for the reader who does not do the sum. */
  ageYears: number | null;
  pan: string | null;
  directors: Array<{
    id: string; name: string; din: string | null; designation: string;
    dscExpiresOn: string | null; dscStatus: 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED';
  }>;
  msme: { udyamNumber: string; category: string; registeredOn: string | null } | null;
  gstins: Array<{ gstin: string; stateCode: string; isActive: boolean }>;
  dpiit: { number: string; recognisedOn: string | null } | null;
  epfoCode: string | null;
  esicCode: string | null;
  /** Across serving directors: active while at least one certificate is good. */
  dsc: { status: 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED'; active: number; total: number; nextExpiry: string | null };
  /**
   * DIR-3 KYC is an obligation like any other, so its state is read from the
   * calendar rather than stored twice: met when the most recent one that has
   * fallen due was closed out.
   */
  mcaKyc: { status: 'MET' | 'NOT_MET' | 'NOT_DUE' | 'NOT_APPLICABLE'; dueDate: string | null; periodLabel: string | null };
}

const iso = (v: Date | null | undefined): string | null => (v ? v.toISOString().slice(0, 10) : null);

async function companyProfile(actor: Actor, companyId: string): Promise<CompanyProfile> {
  const company = await getCompanyOrThrow(actor, companyId);
  const now = today();

  // Every DIR-3 KYC the engine has generated for this company, newest first.
  const kycItems = await prisma.complianceItem.findMany({
    where: { companyId, ruleCode: 'MCA_DIR3KYC' },
    orderBy: { dueDate: 'desc' },
    select: { dueDate: true, status: true, periodLabel: true },
  });

  // Someone who has resigned is not a signatory and does not sit for KYC.
  const serving = company.directors.filter((dir) => !dir.resignedOn);
  const dscOf = (expiry: Date | null): 'ACTIVE' | 'EXPIRED' | 'NOT_RECORDED' =>
    !expiry ? 'NOT_RECORDED' : expiry >= now ? 'ACTIVE' : 'EXPIRED';

  const activeDsc = serving.filter((dir) => dscOf(dir.dscExpiresOn) === 'ACTIVE');
  const recorded = serving.filter((dir) => dir.dscExpiresOn);
  const nextExpiry = activeDsc
    .map((dir) => dir.dscExpiresOn!)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  // The most recent one that has actually fallen due — a KYC not yet due says
  // nothing about whether the last one was done.
  const landed = kycItems.find((i) => i.dueDate <= now);
  const mcaKyc: CompanyProfile['mcaKyc'] = kycItems.length === 0
    ? { status: 'NOT_APPLICABLE', dueDate: null, periodLabel: null }
    : !landed
      ? { status: 'NOT_DUE', dueDate: iso(kycItems[kycItems.length - 1]!.dueDate), periodLabel: kycItems[kycItems.length - 1]!.periodLabel }
      : {
          status: ['COMPLETED', 'WAIVED'].includes(landed.status) ? 'MET' : 'NOT_MET',
          dueDate: iso(landed.dueDate),
          periodLabel: landed.periodLabel,
        };

  // An LLP has an LLPIN, a Companies Act entity a CIN, and a firm or a
  // proprietorship neither — for those the PAN is the number people quote.
  const isLlp = company.entityType === 'LLP';
  const [registrationLabel, registrationNumber] = isLlp
    ? (['LLPIN', company.llpin] as const)
    : company.cin
      ? (['CIN', company.cin] as const)
      : (['PAN', company.pan] as const);

  return {
    id: company.id,
    legalName: company.legalName,
    entityType: company.entityType,
    registrationLabel,
    registrationNumber: registrationNumber ?? null,
    incorporationDate: iso(company.incorporationDate),
    ageYears: company.incorporationDate
      ? Math.floor((now.getTime() - company.incorporationDate.getTime()) / 31_557_600_000)
      : null,
    pan: company.pan ?? null,
    directors: serving.map((dir) => ({
      id: dir.id,
      name: dir.name,
      din: dir.din ?? null,
      designation: dir.designation,
      dscExpiresOn: iso(dir.dscExpiresOn),
      dscStatus: dscOf(dir.dscExpiresOn),
    })),
    msme: company.msmeRegistration
      ? {
          udyamNumber: company.msmeRegistration.udyamNumber,
          category: company.msmeRegistration.category,
          registeredOn: iso(company.msmeRegistration.registeredOn),
        }
      : null,
    gstins: company.gstRegistrations.map((reg) => ({
      gstin: reg.gstin, stateCode: reg.stateCode, isActive: reg.isActive,
    })),
    dpiit: company.dpiitRecognitionNumber
      ? { number: company.dpiitRecognitionNumber, recognisedOn: iso(company.dpiitRecognisedOn) }
      : null,
    epfoCode: company.epfoCode ?? null,
    esicCode: company.esicCode ?? null,
    dsc: {
      status: activeDsc.length > 0 ? 'ACTIVE' : recorded.length > 0 ? 'EXPIRED' : 'NOT_RECORDED',
      active: activeDsc.length,
      total: serving.length,
      nextExpiry: iso(nextExpiry),
    },
    mcaKyc,
  };
}

const ZERO_STATUS: Record<ItemStatus, number> = { UPCOMING: 0, DUE: 0, OVERDUE: 0, COMPLETED: 0, WAIVED: 0 };
const ZERO_SEVERITY: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

export async function getOverview(actor: Actor, companyId?: string): Promise<Overview> {
  if (companyId) await getCompanyOrThrow(actor, companyId);

  const now = today();
  const soon = addDays(now, 30);
  const scope = companyScope(actor, companyId);
  const itemScope = { company: scope };

  const [
    companies,
    statusGroups,
    severityGroups,
    authorityGroups,
    overdue,
    dueSoon,
    taskGroups,
    evidenceTotals,
    score,
    profile,
  ] = await Promise.all([
    prisma.company.count({ where: { ...scope, isActive: true } }),
    prisma.complianceItem.groupBy({ by: ['status'], where: itemScope, _count: { _all: true } }),
    prisma.complianceItem.groupBy({
      by: ['severity'],
      where: { ...itemScope, status: { in: ['UPCOMING', 'DUE', 'OVERDUE'] } },
      _count: { _all: true },
    }),
    prisma.complianceItem.groupBy({ by: ['authority', 'status'], where: itemScope, _count: { _all: true } }),
    prisma.complianceItem.findMany({
      where: { ...itemScope, status: 'OVERDUE' },
      orderBy: [{ severity: 'asc' }, { dueDate: 'asc' }],
      take: 20,
      include: {
        company: { select: { id: true, legalName: true } },
        task: { select: { id: true, status: true, assignee: { select: { id: true, name: true } } } },
      },
    }),
    prisma.complianceItem.findMany({
      where: { ...itemScope, status: { in: ['UPCOMING', 'DUE'] }, dueDate: { gte: now, lte: soon } },
      orderBy: { dueDate: 'asc' },
      take: 25,
      include: {
        company: { select: { id: true, legalName: true } },
        task: { select: { id: true, status: true, assignee: { select: { id: true, name: true } } } },
      },
    }),
    prisma.task.groupBy({ by: ['status'], where: { complianceItem: itemScope }, _count: { _all: true } }),
    prisma.complianceItem.findMany({
      where: itemScope,
      select: { evidenceRequired: true, _count: { select: { documents: true } } },
    }),
    computeScore(actor, companyId),
    companyId ? companyProfile(actor, companyId) : null,
  ]);

  const statusCounts = { ...ZERO_STATUS };
  for (const g of statusGroups) statusCounts[g.status] = g._count._all;

  const severityCounts = { ...ZERO_SEVERITY };
  for (const g of severityGroups) severityCounts[g.severity] = g._count._all;

  const authorityMap = new Map<Authority, { authority: Authority; total: number; overdue: number; completed: number; upcoming: number }>();
  for (const g of authorityGroups) {
    const row = authorityMap.get(g.authority) ?? { authority: g.authority, total: 0, overdue: 0, completed: 0, upcoming: 0 };
    row.total += g._count._all;
    if (g.status === 'OVERDUE') row.overdue += g._count._all;
    if (g.status === 'COMPLETED') row.completed += g._count._all;
    if (g.status === 'UPCOMING' || g.status === 'DUE') row.upcoming += g._count._all;
    authorityMap.set(g.authority, row);
  }

  const taskCounts: Record<string, number> = {};
  for (const g of taskGroups) taskCounts[g.status] = g._count._all;

  const requiring = evidenceTotals.filter((i) => i.evidenceRequired.length > 0);
  const withEvidence = requiring.filter((i) => i._count.documents > 0);

  return {
    score,
    companies,
    statusCounts,
    severityCounts,
    byAuthority: [...authorityMap.values()].sort((a, b) => b.overdue - a.overdue || a.authority.localeCompare(b.authority)),
    overdue,
    dueSoon,
    taskCounts,
    evidence: {
      itemsRequiringEvidence: requiring.length,
      itemsWithEvidence: withEvidence.length,
      coveragePct: requiring.length === 0 ? 100 : Math.round((withEvidence.length / requiring.length) * 100),
    },
    profile,
  };
}

/** Persists today's score so the trend line has history to draw. */
export async function snapshotScore(actor: Actor, companyId: string) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'work.write');
  const score = await computeScore(actor, companyId);

  return prisma.complianceScoreSnapshot.create({
    data: {
      companyId,
      score: score.score,
      band: score.band,
      breakdown: JSON.parse(JSON.stringify(score)),
    },
  });
}

export async function scoreHistory(actor: Actor, companyId: string, limit = 90) {
  await getCompanyOrThrow(actor, companyId);
  return prisma.complianceScoreSnapshot.findMany({
    where: { companyId },
    orderBy: { capturedAt: 'desc' },
    take: limit,
    select: { id: true, score: true, band: true, capturedAt: true },
  });
}

/** Snapshots every active company — driven by the nightly job. */
export async function snapshotAllScores(): Promise<number> {
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, organizationId: true },
  });

  let count = 0;
  for (const company of companies) {
    try {
      await snapshotScore({ userId: '', organizationId: company.organizationId, role: 'SUPER_ADMIN' }, company.id);
      count += 1;
    } catch {
      // A single failing company must not abort the nightly sweep.
    }
  }
  return count;
}
