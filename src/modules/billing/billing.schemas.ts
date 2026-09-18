import { z } from 'zod';

/** Only the ids Razorpay hands back — never an amount, currency or method.
 *  All of those are read server-side from the order/payment we hold. */
export const createOrderSchema = z.object({
  /** The company the owner is upgrading. Optional: an owner may also upgrade
   *  without pinning it to one company. */
  companyId: z.string().uuid().optional(),
});

export const verifyPaymentSchema = z.object({
  orderId: z.string().min(1, 'Razorpay order id is required'),
  /** The payment id from Razorpay's success callback. Trusted only after the
   *  HMAC below passes — never on its own. */
  rzpPaymentId: z.string().min(1, 'Razorpay payment id is required'),
  rzpSignature: z.string().min(1, 'Razorpay signature is required'),
});

export const webhookEventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({ entity: z.record(z.string(), z.unknown()) }).optional(),
  }),
});