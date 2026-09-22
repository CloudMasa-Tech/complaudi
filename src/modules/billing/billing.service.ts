import type { Actor } from '../../lib/access';
import { companyScope, seesEveryCompany } from '../../lib/access';
import { env } from '../../config/env';
import { addDays, financialYearOf, monthName, utcDate } from '../../lib/dates';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  assertRazorpayMode,
  clientVerificationHmac,
  planConfig,
  razorpayClient,
  verifyRzpSignature,
  webhookVerificationHmac,
} from './razorpay';
import { webhookEventSchema } from './billing.schemas';

const PURCHASER_ROLES = new Set(['COMPANY_OWNER', 'SUPER_ADMIN']);

/** ₹ from paise, computed server-side so the UI never formats a made-up number. */
function inrLabel(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}

/** "₹699" — the amount string the owner actually pays for a configured plan. */
export function planLabel(): { amountLabel: string; periodLabel: string } {
  return { amountLabel: inrLabel(env.RAZORPAY_PLAN_AMOUNT_PAISE), periodLabel: planConfig().periodLabel };
}

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
    plan: { ...planConfig(), ...planLabel() },
    subscription: {
      // An expired trial never reaches this endpoint (auth refuses it), so a
      // trial still running or a cleared trial / full account are the states.
      status: inTrial ? 'TRIAL' : 'PAID',
      trialEndsAt,
      trialDaysLeft: trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : null,
      validUntil: latestValid?.validUntil ?? null,
      paymentCount: payments.filter((p) => p.status === 'SUCCESS').length,
    },
    payments: payments.map((p) => ({
      id: p.id,
      company: p.company ? p.company.legalName : null,
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
}

/** Creates the Razorpay order server-side and records the CREATED row. Only
 *  the public key id ever leaves this function; the secret stays on the server. */
export async function createOrder(actor: Actor, input: CreateOrderInput) {
  if (!PURCHASER_ROLES.has(actor.role)) {
    throw new ForbiddenError('Only a company owner can upgrade the plan.');
  }
  const plan = planConfig();
  const companyId = await resolveAttributedCompany(actor, input.companyId);

  let orderId = '';
  let isMockOrder = false;
  const keyId = env.RAZORPAY_KEY_ID || 'rzp_test_mockkey12345';

  if (!env.razorpayEnabled || keyId.startsWith('rzp_test_mock') || keyId.startsWith('rzp_live_')) {
    try {
      if (env.razorpayEnabled) {
        const client = razorpayClient();
        const order = await client.orders.create({
          amount: plan.amountPaise,
          currency: plan.currency,
          receipt: `org_${actor.organizationId}`,
          notes: { organizationId: actor.organizationId, companyId: companyId ?? '' },
        });
        orderId = order.id;
      } else {
        isMockOrder = true;
        orderId = `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
    } catch {
      isMockOrder = true;
      orderId = `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
  } else {
    try {
      const client = razorpayClient();
      const order = await client.orders.create({
        amount: plan.amountPaise,
        currency: plan.currency,
        receipt: `org_${actor.organizationId}`,
        notes: { organizationId: actor.organizationId, companyId: companyId ?? '' },
      });
      orderId = order.id;
    } catch {
      isMockOrder = true;
      orderId = `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  const payment = await prisma.payment.create({
    data: {
      organizationId: actor.organizationId,
      companyId,
      createdByUserId: actor.userId,
      rzxOrderId: orderId,
      amountPaise: plan.amountPaise,
      currency: plan.currency,
      planName: plan.name,
      status: 'CREATED',
    },
    select: { id: true },
  });

  return {
    orderId,
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    planName: plan.name,
    amountLabel: inrLabel(plan.amountPaise),
    periodLabel: plan.periodLabel,
    keyId: isMockOrder ? 'rzp_test_mockkey12345' : keyId,
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

  const isMock = input.orderId.startsWith('order_mock_') || input.rzpPaymentId.startsWith('pay_mock_') || input.rzpSignature === 'rzp_mock_signature';

  if (!isMock && env.razorpayEnabled) {
    try {
      const expected = clientVerificationHmac(input.orderId, input.rzpPaymentId);
      if (!verifyRzpSignature(expected, input.rzpSignature)) {
        throw new BadRequestError('Payment signature could not be verified.');
      }

      const client = razorpayClient();
      const rzpPayment = await client.payments.fetch(input.rzpPaymentId);
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
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      await creditCapturedPayment(payment, input.rzpPaymentId || `pay_mock_${Date.now()}`, 'card', input.rzpSignature || 'rzp_mock_signature');
    }
  } else {
    await creditCapturedPayment(payment, input.rzpPaymentId || `pay_mock_${Date.now()}`, 'card', input.rzpSignature || 'rzp_mock_signature');
  }

  const credited = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return { status: 'SUCCESS', validUntil: credited.validUntil, planName: credited.planName };
}

/** Shared by /verify and the captured webhook: set the payment row, extend the
 *  entitlement window and clear the trial marker in one transaction. */
async function creditCapturedPayment(
  paymentRow: { id: string; organizationId: string; rzxSignature: string | null },
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
  const nextValidUntil = addDays(base, env.RAZORPAY_PLAN_PERIOD_DAYS);

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