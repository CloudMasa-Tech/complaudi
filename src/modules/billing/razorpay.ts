import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env';
import { AppError, ForbiddenError } from '../../lib/errors';

/**
 * Server-side Razorpay handle.
 *
 * The key secret lives only in server memory, constructed here from env and
 * never exposed. The only thing the frontend ever sees is the public key id,
 * handed back by create-order.
 */

let client: Razorpay | null = null;

/** The currency every plan is charged in. Prices themselves live in plans.ts. */
export function planCurrency(): string {
  return env.RAZORPAY_CURRENCY;
}

/**
 * Whether this server may credit a payment that nobody actually made.
 *
 * Simulated billing exists so the app can be developed and demonstrated with no
 * Razorpay credentials. Whether it is on is decided entirely by this server's
 * own configuration — no request body, header, order id or signature can reach
 * it.
 *
 * That distinction is the whole point. The previous implementation decided it
 * from the request: `rzpSignature === 'rzp_mock_signature'` (or an id starting
 * `pay_mock_`) marked a payment as simulated and credited it. Those strings
 * come from the browser, so any signed-in user could post them against their
 * own pending order and receive a paid subscription without paying. Both the
 * Express service and the edge function carried it.
 *
 * Production is excluded outright even when Razorpay is unconfigured: there,
 * missing credentials are an outage to be fixed, never a reason to give the
 * product away.
 */
export function simulatedBillingAllowed(): boolean {
  return !env.isProd && !env.razorpayEnabled;
}

export function razorpayEnabled(): boolean {
  return env.razorpayEnabled;
}

/**
 * Hard safety switch, checked at request time as well as at boot: in test mode
 * a live key is a misconfiguration that must never charge a real customer.
 * Boot already refuses (see config/env.ts); this is the belt against a coding
 * error slipping one past it.
 */
export function assertRazorpayMode(): void {
  if (env.razorpayKeyEnv === 'live' && env.RAZORPAY_TEST_MODE) {
    throw new ForbiddenError('Razorpay is in test mode but configured with live keys — refusing to charge.');
  }
}

export function razorpayClient(): Razorpay {
  if (!env.razorpayEnabled) {
    throw new AppError('Razorpay billing is not configured on this server.', 503, 'BILLING_NOT_CONFIGURED');
  }
  client ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID!, key_secret: env.RAZORPAY_KEY_SECRET! });
  return client;
}

/**
 * Constant-time comparison of two hex HMACs. The injected body length must
 * match ours or the comparison is rejected outright (no timing oracle).
 */
export function verifyRzpSignature(expectedHmac: string, givenSignature: string | undefined | null): boolean {
  if (!expectedHmac || !givenSignature) return false;
  const expected = Buffer.from(expectedHmac, 'hex');
  const given = Buffer.from(givenSignature, 'hex');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

/** The client-side verify flow signs `order_id|payment_id` with the key secret. */
export function clientVerificationHmac(orderId: string, rzpPaymentId: string): string {
  return crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${rzpPaymentId}`).digest('hex');
}

/** The webhook signs the raw JSON body with the webhook secret. */
export function webhookVerificationHmac(rawBody: Buffer): string {
  return crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
}