import type { Actor } from '../../lib/access';
import { companyScope, seesEveryCompany } from '../../lib/access';
import { env } from '../../config/env';
import { addDays, financialYearOf, monthName, utcDate } from '../../lib/dates';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  assertRazorpayMode,
  clientVerificationHmac,
  planCurrency,
  razorpayClient,
  simulatedBillingAllowed,
  verifyRzpSignature,
  webhookVerificationHmac,
} from './razorpay';
import { DEFAULT_PLAN_KEY, PLANS, findPlan, inrLabel, planView } from './plans';
import { webhookEventSchema } from './billing.schemas';

/** Everyone with a working login except VIEWER, which is read-only by
 *  definition. The subscription belongs to the organisation, so any member who
 *  can change anything can also pay for it. Kept in step with the same set in
 *  supabase/functions/billing-api. */
const PURCHASER_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'CA', 'COMPANY_OWNER']);


// ---------------------------------------------------------- workspace view

/** Everything the Company Owner's billing page needs, org-scoped like every
 *  other query in the app. Returns plan, subscription status and this
 *  organisation's own payment history — never another tenant's. */
export async function getBillingView(actor: Actor) {
  const now = new Date();

  const org = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { id: true, name: true, trialEndsAt: true, trialSignedUpAt: true },
  });
  if (!org) throw new NotFoundError('Organisation');

  const payments = await prisma.payment.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      companyId: true,
      company: { select: { legalName: true } },
      rzxOrderId: true,
      rzxPaymentId: true,
      amountPaise: true,
      currency: true,
      planName: true,
      planKey: true,
      baseAmountPaise: true,
      taxPercent: true,
      taxAmountPaise: true,
      periodDays: true,
      status: true,
      method: true,
      paidAt: true,
      validUntil: true,
      createdAt: true,
    },
  });

  const latestValid = payments.find((p) => p.status === 'SUCCESS' && p.validUntil && p.validUntil.getTime() > now.getTime());
  const trialEndsAt = org.trialEndsAt;
  const inTrial = trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();

  return {
    // The whole catalog, priced and labelled here. The page renders these
    // numbers; it never computes one, so what is shown cannot disagree with
    // what is charged.
    plans: PLANS.map(planView),
    currency: planCurrency(),
    subscription: {
      // An expired trial never reaches this endpoint (auth refuses it), so a
      // trial still running or a cleared trial / full account are the states.
      status: inTrial ? 'TRIAL' : 'PAID',
      trialEndsAt,
      trialDaysLeft: trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : null,
      validUntil: latestValid?.validUntil ?? null,
      /** What they are currently on, so the picker can mark it and offer the
       *  other term as an upgrade rather than a duplicate purchase. */
      currentPlanKey: latestValid?.planKey ?? null,
      currentPlanName: latestValid?.planName ?? null,
      paymentCount: payments.filter((p) => p.status === 'SUCCESS').length,
    },
    payments: payments.map((p) => ({
      id: p.id,
      company: p.company ? p.company.legalName : null,
      rzxOrderId: p.rzxOrderId,
      amountPaise: p.amountPaise,
      amountLabel: inrLabel(p.amountPaise),
      // The invoice split, as charged. Legacy rows predate the tax columns and
      // carry a zero tax line, which is what actually happened to them.
      baseAmountPaise: p.baseAmountPaise,
      baseLabel: inrLabel(p.baseAmountPaise),
      taxPercent: p.taxPercent,
      taxAmountPaise: p.taxAmountPaise,
      taxLabel: inrLabel(p.taxAmountPaise),
      currency: p.currency,
      planName: p.planName,
      planKey: p.planKey,
      status: p.status,
      method: p.method,
      paidAt: p.paidAt,
      validUntil: p.validUntil,
      createdAt: p.createdAt,
    })),
    canPurchase: PURCHASER_ROLES.has(actor.role),
  };
}

// ------------------------------------------------------------ purchase flow

/** The company being upgraded must be one this actor actually holds — same
 *  tenant isolation as every other company query. */
async function resolveAttributedCompany(actor: Actor, companyId: string | undefined): Promise<string | null> {
  if (!companyId) return null;
  const company = await prisma.company.findFirst({
    where: companyScope(actor, companyId),
    select: { id: true },
  });
  if (!company) throw new NotFoundError('Company');
  return company.id;
}

export interface CreateOrderInput {
  companyId?: string;
  planKey?: string;
}

/** Creates the Razorpay order server-side and records the CREATED row. Only
 *  the public key id ever leaves this function; the secret stays on the server. */
export async function createOrder(actor: Actor, input: CreateOrderInput) {
  if (!PURCHASER_ROLES.has(actor.role)) {
    throw new ForbiddenError('Read-only members cannot purchase a subscription.');
  }
  // The live-keys-in-test-mode guard. Its own comment said it was checked at
  // request time as well as at boot, but nothing had ever called it — the
  // import was dead. Boot alone cannot catch a key rotated under a running
  // process, which is exactly the case it exists for.
  assertRazorpayMode();

  const plan = findPlan(input.planKey ?? DEFAULT_PLAN_KEY);
  if (!plan) throw new BadRequestError('Unknown plan.');
  const currency = planCurrency();
  const companyId = await resolveAttributedCompany(actor, input.companyId);

  // Three outcomes, and no path from one to another. Previously a thrown
  // Razorpay error fell through to a mock order, which verify would then credit
  // for free — so a few seconds of API trouble gave the product away.
  let orderId: string;
  let isMockOrder = false;

  if (env.razorpayEnabled) {
    const order = await razorpayClient().orders.create({
      amount: plan.amountPaise,
      currency,
      receipt: `org_${actor.organizationId}`.slice(0, 40),
      notes: {
        organizationId: actor.organizationId,
        companyId: companyId ?? '',
        planKey: plan.key,
      },
    });
    orderId = order.id;
  } else if (simulatedBillingAllowed()) {
    isMockOrder = true;
    orderId = `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  } else {
    throw new AppError('Razorpay billing is not configured on this server.', 503, 'BILLING_NOT_CONFIGURED');
  }

  const payment = await prisma.payment.create({
    data: {
      organizationId: actor.organizationId,
      companyId,
      createdByUserId: actor.userId,
      rzxOrderId: orderId,
      amountPaise: plan.amountPaise,
      currency,
      planName: plan.name,
      planKey: plan.key,
      baseAmountPaise: plan.baseAmountPaise,
      taxPercent: plan.taxPercent,
      taxAmountPaise: plan.taxAmountPaise,
      periodDays: plan.periodDays,
      status: 'CREATED',
    },
    select: { id: true },
  });

  return {
    orderId,
    ...planView(plan),
    currency,
    planName: plan.name,
    // Public key id only — the secret never leaves this process.
    keyId: env.RAZORPAY_KEY_ID ?? null,
    paymentId: payment.id,
    isMockOrder,
  };
}

export interface VerifyPaymentInput {
  orderId: string;
  rzpPaymentId: string;
  rzpSignature: string;
}

/** Confirms a payment from the frontend only after the HMAC over
 *  `order_id|payment_id` passes *and* Razorpay itself reports it captured.
 *  The popup's success callback alone is never trusted. */
export async function verifyPayment(actor: Actor, input: VerifyPaymentInput) {
  const payment = await prisma.payment.findUnique({ where: { rzxOrderId: input.orderId } });
  if (!payment || payment.organizationId !== actor.organizationId) throw new NotFoundError('Order');

  if (payment.status === 'SUCCESS' || payment.status === 'AUTHORIZED') {
    return { status: 'SUCCESS', validUntil: payment.validUntil, planName: payment.planName, alreadyProcessed: true };
  }

  // Whether a payment counts is decided here, from this server's configuration
  // and Razorpay's own answer. Nothing in `input` can steer it.
  //
  // What this replaced treated `rzpPaymentId` starting "pay_mock_" or
  // `rzpSignature` equal to "rzp_mock_signature" as proof of a simulated
  // payment and credited it. Both values come from the request body, so any
  // signed-in user could post them against their own CREATED order and receive
  // a paid subscription having paid nothing. The real branch was no safer: its
  // catch credited the payment on *any* non-BadRequest error, so a failed
  // lookup at Razorpay also granted the entitlement.
  if (env.razorpayEnabled) {
    const expected = clientVerificationHmac(input.orderId, input.rzpPaymentId);
    if (!verifyRzpSignature(expected, input.rzpSignature)) {
      throw new BadRequestError('Payment signature could not be verified.');
    }

    // The signature proves the ids were paired by someone holding the key
    // secret. It does not prove money moved, so the capture is confirmed with
    // Razorpay directly. A failure here is an error, never a credit.
    const rzpPayment = await razorpayClient().payments.fetch(input.rzpPaymentId);

    if (rzpPayment.order_id !== input.orderId) {
      // Defence against replaying a signature from a different order.
      throw new BadRequestError('That payment belongs to a different order.');
    }
    if (rzpPayment.status !== 'captured') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          rzxPaymentId: rzpPayment.id,
          rzxSignature: input.rzpSignature,
          method: typeof rzpPayment.method === 'string' ? rzpPayment.method : null,
        },
      });
      throw new BadRequestError('The payment has not been captured yet. Please try again.');
    }

    await creditCapturedPayment(payment, rzpPayment.id, rzpPayment.method, input.rzpSignature);
  } else if (simulatedBillingAllowed()) {
    logger.warn(
      { paymentId: payment.id, organizationId: payment.organizationId },
      'crediting a simulated payment — Razorpay is unconfigured and this is not production',
    );
    await creditCapturedPayment(payment, `pay_sim_${payment.id}`, 'simulated', null);
  } else {
    throw new AppError('Razorpay billing is not configured on this server.', 503, 'BILLING_NOT_CONFIGURED');
  }

  const credited = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return { status: 'SUCCESS', validUntil: credited.validUntil, planName: credited.planName };
}

/** Shared by /verify and the captured webhook: set the payment row, extend the
 *  entitlement window and clear the trial marker in one transaction. */
async function creditCapturedPayment(
  paymentRow: { id: string; organizationId: string; rzxSignature: string | null; periodDays: number },
  rzpPaymentId: string,
  method: string | null,
  signature: string | null,
) {
  const now = new Date();

  // Renewing early extends from the current window instead of stacking a fresh
  // year mid-term; re-subscribing after expiry starts the year from today.
  const current = await prisma.payment.findFirst({
    where: {
      organizationId: paymentRow.organizationId,
      id: { not: paymentRow.id },
      status: 'SUCCESS',
      validUntil: { not: null },
    },
    orderBy: { validUntil: 'desc' },
    select: { validUntil: true },
  });
  const base = current?.validUntil && current.validUntil.getTime() > now.getTime() ? current.validUntil : now;
  const nextValidUntil = addDays(base, paymentRow.periodDays);

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentRow.id },
      data: {
        rzxPaymentId: rzpPaymentId,
        rzxSignature: signature ?? paymentRow.rzxSignature,
        method: method ?? null,
        status: 'SUCCESS',
        paidAt: now,
        validUntil: nextValidUntil,
      },
    }),
    prisma.organization.update({
      where: { id: paymentRow.organizationId },
      data: { trialEndsAt: null },
    }),
  ]);
}

// ------------------------------------------------------------- webhook path

/** Backup verification path: Razorpay delivers `payment.*` events signed over
 *  the raw body with the webhook secret. Nothing in here is trusted until that
 *  signature passes, and unknown orders are acked (200) so Razorpay never
 *  retries a webhook we will never resolve. */
export async function handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new BadRequestError('Webhook verification is not configured on this server.');
  }
  if (!rawBody) throw new BadRequestError('Webhook requires the raw JSON payload.');

  const expected = webhookVerificationHmac(rawBody);
  if (!verifyRzpSignature(expected, signature)) {
    logger.warn({ event: 'billing.webhook' }, 'rejected webhook: signature verification failed');
    throw new BadRequestError('Webhook signature could not be verified.');
  }

  let parsed: { event: string; payload: { payment?: { entity: Record<string, unknown> } } };
  try {
    parsed = webhookEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
  } catch {
    logger.warn({ event: 'billing.webhook' }, 'rejected webhook: unparseable payload');
    return { received: true, ignored: 'unparseable' };
  }

  const entity = parsed.payload.payment?.entity;
  if (!entity || !parsed.event.startsWith('payment.')) {
    // Anything outside payment.* is not ours to act on — ack so Razorpay moves on.
    return { received: true, ignored: parsed.event };
  }

  const orderId = entity.order_id as string | undefined;
  const rzpPaymentId = entity.id as string | undefined;
  if (!orderId || !rzpPaymentId) return { received: true, ignored: 'no order reference' };

  const payment = await prisma.payment.findUnique({ where: { rzxOrderId: orderId } });
  if (!payment) {
    logger.warn({ event: 'billing.webhook', orderId }, 'webhook for an order we do not hold');
    return { received: true, ignored: 'unknown order' };
  }

  // The webhook's amount must match the order we issued. Log a mismatch loudly —
  // it smells of tampering even behind a valid signature — but never overwrite
  // the amount we charged off our own order.
  const webhookAmount = Number(entity.amount);
  if (Number.isFinite(webhookAmount) && webhookAmount !== payment.amountPaise) {
    logger.error(
      { event: 'billing.webhook', orderId, recorded: payment.amountPaise, claimed: webhookAmount },
      'webhook amount does not match the order issued',
    );
  }

  const method = typeof entity.method === 'string' ? entity.method : null;

  switch (parsed.event) {
    case 'payment.captured':
      await creditCapturedPayment(payment, rzpPaymentId, method, null);
      break;
    case 'payment.authorized':
      await prisma.payment.update({
        where: { id: payment.id },
        data: { rzxPaymentId: rzpPaymentId, method, status: 'AUTHORIZED' },
      });
      break;
    case 'payment.failed':
      await prisma.payment.update({
        where: { id: payment.id },
        data: { rzxPaymentId: rzpPaymentId, method, status: 'FAILED' },
      });
      break;
    case 'payment.refunded':
      await prisma.payment.update({
        where: { id: payment.id },
        data: { rzxPaymentId: rzpPaymentId, method, status: 'REFUNDED' },
      });
      break;
    default:
      return { received: true, ignored: parsed.event };
  }

  return { received: true };
}

// --------------------------------------------------------- platform analytics

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${monthName(m ?? 1)} ${y}`;
};

/** Platform-wide, SUPER_ADMIN-only. Every number here is aggregated from real
 *  Payment/Organisation rows — no placeholders, no hardcoded figures. A regular
 *  workspace user is refused at the first line, whatever they guessed. */
export async function platformAnalytics(actor: Actor) {
  if (!seesEveryCompany(actor.role)) {
    throw new ForbiddenError('Only the platform super admin can view platform analytics.');
  }

  const now = new Date();
  const thisMonthStart = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const thisYearStart = utcDate(now.getUTCFullYear(), 1, 1);
  const fiscalStart = financialYearOf(now).start;
  const renewalWindow = addDays(now, 30);
  const expiryWindow = addDays(now, 60);

  const [successes, orgs, failedRecent, history] = await Promise.all([
    prisma.payment.findMany({
      where: { status: 'SUCCESS' },
      select: { id: true, organizationId: true, companyId: true, amountPaise: true, paidAt: true, validUntil: true },
    }),
    prisma.organization.findMany({
      select: { id: true, name: true, trialEndsAt: true, trialSignedUpAt: true },
    }),
    prisma.payment.findMany({
      where: { status: { in: ['FAILED', 'REFUNDED'] }, createdAt: { gte: addDays(now, -30) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, organizationId: true, amountPaise: true, status: true, createdAt: true, method: true, rzxOrderId: true },
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        amountPaise: true,
        currency: true,
        planName: true,
        status: true,
        method: true,
        paidAt: true,
        validUntil: true,
        createdAt: true,
        rzxOrderId: true,
        organization: { select: { name: true } },
        company: { select: { legalName: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  // ---- revenue -------------------------------------------------------------
  const sum = (rows: typeof successes, from?: Date) =>
    rows.reduce((acc, p) => (from && (!p.paidAt || p.paidAt < from) ? acc : acc + p.amountPaise), 0);
  const revenueAllTime = sum(successes);
  const revenue = {
    allTime: revenueAllTime,
    thisMonth: sum(successes, thisMonthStart),
    thisYear: sum(successes, thisYearStart),
    fiscalYear: sum(successes, fiscalStart),
  };

  // ---- per-org liveness ------------------------------------------------------
  const everPaidOrgIds = new Set<string>();
  const latestValidUntil = new Map<string, Date>();
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  for (const p of successes) {
    everPaidOrgIds.add(p.organizationId);
    const seen = latestValidUntil.get(p.organizationId);
    if (!seen || (p.validUntil && p.validUntil.getTime() > seen.getTime())) latestValidUntil.set(p.organizationId, p.validUntil!);
  }

  const payingNow = [...latestValidUntil.entries()].filter(([, v]) => v && v.getTime() > now.getTime()).length;
  const churned = [...latestValidUntil.entries()].filter(([, v]) => !v || v.getTime() <= now.getTime()).length;
  const onTrial = orgs.filter((o) => o.trialEndsAt && o.trialEndsAt.getTime() > now.getTime()).length;
  const trialExpired = orgs.filter((o) => o.trialEndsAt && o.trialEndsAt.getTime() <= now.getTime() && !everPaidOrgIds.has(o.id)).length;
  const fullUnbilled = orgs.filter((o) => o.trialEndsAt === null && !everPaidOrgIds.has(o.id)).length;
  const trialSignups = orgs.filter((o) => o.trialSignedUpAt !== null).length;
  const conversionRate = trialSignups > 0 ? everPaidOrgIds.size / trialSignups : 0;
  const churnRate = everPaidOrgIds.size > 0 ? churned / everPaidOrgIds.size : 0;

  // ---- upcoming renewals (active subs expiring in 30 / 60 days) --------------
  const upcomingRenewals = [...latestValidUntil.entries()]
    .filter(([, v]) => v && v.getTime() > now.getTime())
    .map(([orgId, v]) => ({ organizationId: orgId, organizationName: orgById.get(orgId)?.name ?? null, validUntil: v }))
    .sort((a, b) => a.validUntil!.getTime() - b.validUntil!.getTime())
    .map((r) => ({ ...r, dueInDays: Math.ceil((r.validUntil!.getTime() - now.getTime()) / 86_400_000) }));

  const renewalsNext30 = upcomingRenewals.filter((r) => r.dueInDays <= 30);
  const renewalsNext30to60 = upcomingRenewals.filter((r) => r.dueInDays > 30 && r.dueInDays <= 60);

  // ---- revenue trend ---------------------------------------------------------
  const trendMap = new Map<string, number>();
  for (const p of successes) {
    if (!p.paidAt) continue;
    const key = monthKey(p.paidAt);
    trendMap.set(key, (trendMap.get(key) ?? 0) + p.amountPaise);
  }
  const trend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, amountPaise]) => ({ key, label: monthLabel(key), amountPaise, amountLabel: inrLabel(amountPaise) }));

  // ---- failed / refunded queue ------------------------------------------------
  const failedList = failedRecent.map((p) => ({
    id: p.id,
    organizationName: orgById.get(p.organizationId)?.name ?? null,
    rzxOrderId: p.rzxOrderId,
    amountPaise: p.amountPaise,
    amountLabel: inrLabel(p.amountPaise),
    status: p.status,
    method: p.method,
    createdAt: p.createdAt,
  }));

  // ---- full payment history, all companies -------------------------------------
  const paymentHistory = history.map((p) => ({
    id: p.id,
    organizationName: p.organization?.name ?? null,
    companyName: p.company?.legalName ?? null,
    paidBy: p.createdBy ? { name: p.createdBy.name, email: p.createdBy.email } : null,
    rzxOrderId: p.rzxOrderId,
    amountPaise: p.amountPaise,
    amountLabel: inrLabel(p.amountPaise),
    currency: p.currency,
    planName: p.planName,
    status: p.status,
    method: p.method,
    paidAt: p.paidAt,
    validUntil: p.validUntil,
    createdAt: p.createdAt,
  }));

  return {
    revenue,
    revenueLabels: { allTime: inrLabel(revenue.allTime), thisMonth: inrLabel(revenue.thisMonth), thisYear: inrLabel(revenue.thisYear), fiscalYear: inrLabel(revenue.fiscalYear) },
    organisations: {
      total: orgs.length,
      onTrial,
      trialExpired,
      payingNow,
      fullUnbilled,
      churned,
    },
    conversion: {
      trialSignups,
      converted: everPaidOrgIds.size,
      rate: conversionRate,
      displayRate: `${Math.round(conversionRate * 100)}%`,
    },
    churn: { everConverted: everPaidOrgIds.size, churned, rate: churnRate, displayRate: `${Math.round(churnRate * 100)}%` },
    renewals: { next30Days: renewalsNext30, next30to60Days: renewalsNext30to60, list: upcomingRenewals },
    trend,
    failedPayments: failedList,
    paymentHistory,
  };
}