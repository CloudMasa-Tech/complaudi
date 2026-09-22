import { handleCors } from '../_shared/cors.ts';
import { getAdminSupabase } from '../_shared/database.ts';
import { env } from '../_shared/env.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { BadRequestError } from '../_shared/errors.ts';
import { addDays } from '../_shared/dates.ts';

async function createHmacSha256(secret: string, body: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, body as unknown as BufferSource);
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
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new BadRequestError('Webhook verification is not configured on this server.');
    }

    const signature = req.headers.get('x-razorpay-signature');
    const rawBuffer = new Uint8Array(await req.arrayBuffer());

    const expected = await createHmacSha256(env.RAZORPAY_WEBHOOK_SECRET, rawBuffer);
    if (!signature || !timingSafeEqualHex(expected, signature)) {
      throw new BadRequestError('Webhook signature could not be verified.');
    }

    const payloadText = new TextDecoder().decode(rawBuffer);
    let parsed: any;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      return jsonResponse({ received: true, ignored: 'unparseable' });
    }

    const entity = parsed.payload?.payment?.entity;
    if (!entity || !parsed.event?.startsWith('payment.')) {
      return jsonResponse({ received: true, ignored: parsed.event });
    }

    const orderId = entity.order_id;
    const rzxPaymentId = entity.id;
    if (!orderId || !rzxPaymentId) return jsonResponse({ received: true, ignored: 'no order reference' });

    const admin = getAdminSupabase();
    const { data: payment } = await admin.from('payments').select('*').eq('rzxOrderId', orderId).single();
    if (!payment) {
      return jsonResponse({ received: true, ignored: 'unknown order' });
    }

    const method = typeof entity.method === 'string' ? entity.method : null;

    if (parsed.event === 'payment.captured') {
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
      const nextValidUntil = addDays(baseDate, env.RAZORPAY_PLAN_PERIOD_DAYS);

      await admin.from('payments').update({
        rzxPaymentId,
        rzxSignature: signature,
        method,
        status: 'SUCCESS',
        paidAt: now.toISOString(),
        validUntil: nextValidUntil.toISOString(),
      }).eq('id', payment.id);

      await admin.from('organizations').update({ trialEndsAt: null }).eq('id', payment.organizationId);
    } else if (parsed.event === 'payment.authorized') {
      await admin.from('payments').update({ rzxPaymentId, method, status: 'AUTHORIZED' }).eq('id', payment.id);
    } else if (parsed.event === 'payment.failed') {
      await admin.from('payments').update({ rzxPaymentId, method, status: 'FAILED' }).eq('id', payment.id);
    } else if (parsed.event === 'payment.refunded') {
      await admin.from('payments').update({ rzxPaymentId, method, status: 'REFUNDED' }).eq('id', payment.id);
    }

    return jsonResponse({ received: true });
  } catch (err: any) {
    return errorResponse(err);
  }
});
