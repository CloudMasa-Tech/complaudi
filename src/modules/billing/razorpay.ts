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

/** The configured single product, straight from env: display and charge share
 *  this one source, so the price shown can never disagree with the order. */
export function planConfig() {
  return {
    name: env.RAZORPAY_PLAN_NAME,
    amountPaise: env.RAZORPAY_PLAN_AMOUNT_PAISE,
    currency: env.RAZORPAY_CURRENCY,
    periodDays: env.RAZORPAY_PLAN_PERIOD_DAYS,
    /** "Yearly" — what the UI prints under the price. */
    periodLabel: 'Yearly',
  };
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