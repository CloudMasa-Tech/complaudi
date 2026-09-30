import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getAuthContext, requireCapability, isSuperAdmin } from '../_shared/auth.ts';
import { getAdminSupabase, getClientSupabase } from '../_shared/database.ts';
import { env } from '../_shared/env.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '../_shared/errors.ts';
import { DEFAULT_PLAN_KEY, PLANS, findPlan, inrLabel, planView } from '../_shared/plans.ts';
import { addDays, financialYearOf, monthName, utcDate } from '../_shared/dates.ts';
// @ts-ignore
import { z } from 'https://esm.sh/zod@3.23.8';

const PURCHASER_ROLES = new Set(['COMPANY_OWNER', 'SUPER_ADMIN']);

/** Prices come from ../_shared/plans.ts, a verbatim copy of the catalog the
 *  Express API charges from. tests/plans.test.ts fails if the two drift. */

async function createHmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authCtx = await getAuthContext(req);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const client = getClientSupabase(req);
    const admin = getAdminSupabase();

    // GET /billing-api/view or GET /billing-api
    if (req.method === 'GET' && (path.endsWith('/billing-api') || path.endsWith('/view') || path.endsWith('/billing-api/view'))) {
      const now = new Date();

      let org = null;
      if (authCtx.organizationId) {
        const { data: orgData } = await client
          .from('organizations')
          .select('id, name, trialEndsAt, trialSignedUpAt')
          .eq('id', authCtx.organizationId)
          .maybeSingle();
        org = orgData;
      }
      if (!org) {
        org = {
          id: authCtx.organizationId || 'default-org',
          name: 'Organization',
          trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
          trialSignedUpAt: new Date().toISOString(),
        };
      }

      let payments: any[] = [];
      if (authCtx.organizationId) {
        const { data: payData } = await client
          .from('payments')
          .select('id, companyId, company:companies(legalName), rzxOrderId, rzxPaymentId, amountPaise, baseAmountPaise, taxPercent, taxAmountPaise, periodDays, currency, planName, planKey, status, method, paidAt, validUntil, createdAt')
          .eq('organizationId', authCtx.organizationId)
          .order('createdAt', { ascending: false })
          .limit(100);
        payments = payData || [];
      }

      const latestValid = (payments || []).find(
        (p: any) => p.status === 'SUCCESS' && p.validUntil && new Date(p.validUntil).getTime() > now.getTime()
      );
      const trialEndsAt = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
      const inTrial = trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();

      return jsonResponse({
        plans: PLANS.map(planView),
        currency: env.RAZORPAY_CURRENCY,
        subscription: {
          status: inTrial ? 'TRIAL' : 'PAID',
          trialEndsAt: org.trialEndsAt,
          trialDaysLeft: trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : null,
          validUntil: latestValid?.validUntil ?? null,
          currentPlanKey: latestValid?.planKey ?? null,
          currentPlanName: latestValid?.planName ?? null,
          paymentCount: (payments || []).filter((p: any) => p.status === 'SUCCESS').length,
        },
        payments: (payments || []).map((p: any) => ({
          id: p.id,
          company: p.company ? (p.company as any).legalName : null,
          rzxOrderId: p.rzxOrderId,
          amountPaise: p.amountPaise,
          amountLabel: inrLabel(p.amountPaise),
          // Legacy rows predate the tax columns and carry a zero tax line,
          // which is what was actually charged on them.
          baseAmountPaise: p.baseAmountPaise ?? p.amountPaise,
          baseLabel: inrLabel(p.baseAmountPaise ?? p.amountPaise),
          taxPercent: p.taxPercent ?? 0,
          taxAmountPaise: p.taxAmountPaise ?? 0,
          taxLabel: inrLabel(p.taxAmountPaise ?? 0),
          currency: p.currency,
          planName: p.planName,
          planKey: p.planKey ?? 'ANNUAL',
          status: p.status,
          method: p.method,
          paidAt: p.paidAt,
          validUntil: p.validUntil,
          createdAt: p.createdAt,
        })),
        canPurchase: PURCHASER_ROLES.has(authCtx.role),
      });
    }

    // POST /billing-api/create-order
    if (req.method === 'POST' && path.endsWith('/create-order')) {
      if (!PURCHASER_ROLES.has(authCtx.role)) {
        throw new ForbiddenError('Only a company owner can upgrade the plan.');
      }

      const body = await req.json().catch(() => ({}));
      const companyId = body.companyId || null;

      if (companyId) {
        const { data: comp } = await client.from('companies').select('id').eq('id', companyId).single();
        if (!comp) throw new NotFoundError('Company');
      }

      const plan = findPlan(body.planKey ?? DEFAULT_PLAN_KEY);
      if (!plan) throw new BadRequestError('Unknown plan.');
      const currency = env.RAZORPAY_CURRENCY;

      // Three outcomes and no path between them. Previously any Razorpay error
      // fell through to a mock order, which verify then credited for free — so
      // a few seconds of API trouble handed out a subscription.
      let orderId: string;
      let isMockOrder = false;

      if (env.razorpayConfigured) {
        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`),
          },
          body: JSON.stringify({
            amount: plan.amountPaise,
            currency,
            receipt: `org_${authCtx.organizationId}`.slice(0, 40),
            notes: {
              organizationId: authCtx.organizationId,
              companyId: companyId ?? '',
              planKey: plan.key,
            },
          }),
        });
        if (!rzpRes.ok) {
          console.error('[billing] Razorpay order creation failed:', await rzpRes.text());
          throw new BadRequestError('Could not reach the payment provider. Please try again.');
        }
        orderId = (await rzpRes.json()).id;
      } else if (env.allowSimulatedBilling) {
        isMockOrder = true;
        orderId = `order_mock_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
      } else {
        throw new BadRequestError('Billing is not configured on this server.');
      }

      const { data: payment, error: pErr } = await admin
        .from('payments')
        .insert({
          organizationId: authCtx.organizationId,
          companyId,
          createdByUserId: authCtx.userId,
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
        })
        .select('id')
        .single();
      if (pErr) throw pErr;

      return jsonResponse({
        orderId,
        ...planView(plan),
        currency,
        planName: plan.name,
        keyId: isMockOrder ? null : env.RAZORPAY_KEY_ID,
        paymentId: payment.id,
        isMockOrder,
      });
    }

    // POST /billing-api/verify
    if (req.method === 'POST' && path.endsWith('/verify')) {
      const body = await req.json();
      const { orderId, rzpPaymentId, rzpSignature } = body;
      if (!orderId || !rzpPaymentId) {
        throw new BadRequestError('Missing required payment parameters.');
      }

      const { data: payment } = await admin.from('payments').select('*').eq('rzxOrderId', orderId).single();
      if (!payment || payment.organizationId !== authCtx.organizationId) {
        throw new NotFoundError('Order');
      }

      if (payment.status === 'SUCCESS' || payment.status === 'AUTHORIZED') {
        return jsonResponse({ status: 'SUCCESS', validUntil: payment.validUntil, planName: payment.planName, alreadyProcessed: true });
      }

      // Whether this payment counts is decided from this function's own
      // configuration and Razorpay's answer. Nothing in the request steers it.
      //
      // What this replaced accepted `rzpSignature === 'rzp_mock_signature'` (or
      // a "pay_mock_" id) as proof of a simulated payment, and — worse — fell
      // through to crediting whenever `rzpSignature` was simply absent, since
      // the verification sat inside `if (!isMock && rzpSignature)`. Either way
      // a signed-in user could post against their own CREATED order and be
      // credited a full subscription without paying.
      let method: string | null = null;

      if (env.razorpayConfigured) {
        if (!rzpSignature) throw new BadRequestError('Payment signature is required.');

        const expectedHmac = await createHmacSha256(env.RAZORPAY_KEY_SECRET!, `${orderId}|${rzpPaymentId}`);
        if (!timingSafeEqualHex(expectedHmac, rzpSignature)) {
          throw new BadRequestError('Payment signature could not be verified.');
        }

        // The signature proves the ids were paired by a holder of the key
        // secret; it does not prove money moved. A failure here is an error,
        // never a credit.
        const rzpFetch = await fetch(`https://api.razorpay.com/v1/payments/${rzpPaymentId}`, {
          headers: { 'Authorization': 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`) },
        });
        if (!rzpFetch.ok) {
          console.error('[billing] could not fetch payment from Razorpay:', await rzpFetch.text());
          throw new BadRequestError('Could not confirm the payment with the provider. Please try again.');
        }

        const rzpPayment = await rzpFetch.json();
        if (rzpPayment.order_id !== orderId) {
          throw new BadRequestError('That payment belongs to a different order.');
        }
        if (rzpPayment.status !== 'captured') {
          await admin
            .from('payments')
            .update({ rzxPaymentId: rzpPayment.id, rzxSignature: rzpSignature, method: rzpPayment.method || null })
            .eq('id', payment.id);
          throw new BadRequestError('The payment has not been captured yet. Please try again.');
        }
        // Method comes from Razorpay's payment object, never from the request.
        method = typeof rzpPayment.method === 'string' ? rzpPayment.method : null;
      } else if (env.allowSimulatedBilling) {
        console.warn('[billing] crediting a simulated payment — no Razorpay credentials and simulation is enabled', payment.id);
        method = 'simulated';
      } else {
        throw new BadRequestError('Billing is not configured on this server.');
      }

      const now = new Date();
      const { data: currentSuccess } = await admin
        .from('payments')
        .select('validUntil')
        .eq('organizationId', payment.organizationId)
        .neq('id', payment.id)
        .eq('status', 'SUCCESS')
        .not('validUntil', 'is', null)
        .order('validUntil', { ascending: false })
        .limit(1)
        .maybeSingle();

      const baseDate = currentSuccess?.validUntil && new Date(currentSuccess.validUntil).getTime() > now.getTime()
        ? new Date(currentSuccess.validUntil)
        : now;
      // The term comes from what was bought, not from config, so changing a
      // plan's length later cannot alter an entitlement already paid for.
      const nextValidUntil = addDays(baseDate, payment.periodDays ?? 365);

      await admin.from('payments').update({
        rzxPaymentId: method === 'simulated' ? `pay_sim_${payment.id}` : rzpPaymentId,
        rzxSignature: rzpSignature ?? null,
        method,
        status: 'SUCCESS',
        paidAt: now.toISOString(),
        validUntil: nextValidUntil.toISOString(),
      }).eq('id', payment.id);

      await admin.from('organizations').update({ trialEndsAt: null }).eq('id', payment.organizationId);

      const { data: credited } = await admin.from('payments').select('validUntil, planName').eq('id', payment.id).single();
      return jsonResponse({ status: 'SUCCESS', validUntil: credited.validUntil, planName: credited.planName });
    }

    // GET /billing-api/analytics
    if (req.method === 'GET' && path.endsWith('/analytics')) {
      if (!isSuperAdmin(authCtx.role)) {
        throw new ForbiddenError('Only the platform super admin can view platform analytics.');
      }

      const now = new Date();
      const thisMonthStart = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      const thisYearStart = utcDate(now.getUTCFullYear(), 1, 1);
      const fiscalStart = financialYearOf(now).start;

      const { data: successes } = await admin.from('payments').select('id, organizationId, companyId, amountPaise, paidAt, validUntil').eq('status', 'SUCCESS');
      const { data: orgs } = await admin.from('organizations').select('id, name, trialEndsAt, trialSignedUpAt');
      const { data: failedRecent } = await admin.from('payments').select('id, organizationId, amountPaise, status, createdAt, method, rzxOrderId').in('status', ['FAILED', 'REFUNDED']).gte('createdAt', addDays(now, -30).toISOString()).order('createdAt', { ascending: false }).limit(20);
      const { data: history } = await admin.from('payments').select('id, amountPaise, currency, planName, status, method, paidAt, validUntil, createdAt, rzxOrderId, organization:organizations(name), company:companies(legalName), createdBy:users(name, email)').order('createdAt', { ascending: false }).limit(200);

      const sum = (rows: any[], from?: Date) =>
        (rows || []).reduce((acc, p) => (from && (!p.paidAt || new Date(p.paidAt) < from) ? acc : acc + p.amountPaise), 0);

      const revenueAllTime = sum(successes || []);
      const revenue = {
        allTime: revenueAllTime,
        thisMonth: sum(successes || [], thisMonthStart),
        thisYear: sum(successes || [], thisYearStart),
        fiscalYear: sum(successes || [], fiscalStart),
      };

      const everPaidOrgIds = new Set<string>();
      const latestValidUntil = new Map<string, Date>();
      const orgById = new Map<string, any>((orgs || []).map((o: any) => [o.id, o]));

      for (const p of (successes || [])) {
        everPaidOrgIds.add(p.organizationId);
        const seen = latestValidUntil.get(p.organizationId);
        const pVal = p.validUntil ? new Date(p.validUntil) : null;
        if (pVal && (!seen || pVal.getTime() > seen.getTime())) {
          latestValidUntil.set(p.organizationId, pVal);
        }
      }

      const payingNow = [...latestValidUntil.entries()].filter(([, v]) => v && v.getTime() > now.getTime()).length;
      const churned = [...latestValidUntil.entries()].filter(([, v]) => !v || v.getTime() <= now.getTime()).length;
      const onTrial = (orgs || []).filter((o: any) => o.trialEndsAt && new Date(o.trialEndsAt).getTime() > now.getTime()).length;
      const trialExpired = (orgs || []).filter((o: any) => o.trialEndsAt && new Date(o.trialEndsAt).getTime() <= now.getTime() && !everPaidOrgIds.has(o.id)).length;
      const fullUnbilled = (orgs || []).filter((o: any) => o.trialEndsAt === null && !everPaidOrgIds.has(o.id)).length;
      const trialSignups = (orgs || []).filter((o: any) => o.trialSignedUpAt !== null).length;
      const conversionRate = trialSignups > 0 ? everPaidOrgIds.size / trialSignups : 0;
      const churnRate = everPaidOrgIds.size > 0 ? churned / everPaidOrgIds.size : 0;

      const upcomingRenewals = [...latestValidUntil.entries()]
        .filter(([, v]) => v && v.getTime() > now.getTime())
        .map(([orgId, v]) => ({ organizationId: orgId, organizationName: orgById.get(orgId)?.name ?? null, validUntil: v }))
        .sort((a, b) => a.validUntil!.getTime() - b.validUntil!.getTime())
        .map((r) => ({ ...r, dueInDays: Math.ceil((r.validUntil!.getTime() - now.getTime()) / 86_400_000) }));

      return jsonResponse({
        trend: [],
        revenue,
        revenueLabels: {
          allTime: inrLabel(revenue.allTime),
          thisMonth: inrLabel(revenue.thisMonth),
          thisYear: inrLabel(revenue.thisYear),
          fiscalYear: inrLabel(revenue.fiscalYear),
        },
        organisations: { total: (orgs || []).length, onTrial, trialExpired, payingNow, fullUnbilled, churned },
        conversion: { trialSignups, converted: everPaidOrgIds.size, rate: conversionRate, displayRate: `${Math.round(conversionRate * 100)}%` },
        churn: { everConverted: everPaidOrgIds.size, churned, rate: churnRate, displayRate: `${Math.round(churnRate * 100)}%` },
        renewals: {
          next30Days: upcomingRenewals.filter((r) => r.dueInDays <= 30),
          next30to60Days: upcomingRenewals.filter((r) => r.dueInDays > 30 && r.dueInDays <= 60),
          list: upcomingRenewals,
        },
        failedPayments: (failedRecent || []).map((p: any) => ({
          id: p.id,
          organizationName: orgById.get(p.organizationId)?.name ?? null,
          rzxOrderId: p.rzxOrderId,
          amountPaise: p.amountPaise,
          amountLabel: inrLabel(p.amountPaise),
          status: p.status,
          method: p.method,
          createdAt: p.createdAt,
        })),
        paymentHistory: (history || []).map((p: any) => ({
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
        })),
      });
    }

    throw new NotFoundError('Endpoint');
  } catch (err: any) {
    return errorResponse(err);
  }
});
