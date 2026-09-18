import { Router } from 'express';
import { asyncHandler } from '../../lib/async';
import { auth, requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import * as service from './billing.service';
import { createOrderSchema, verifyPaymentSchema } from './billing.schemas';

export const billingRouter = Router();

/** The Company Owner's billing page: plan, subscription status and this
 *  organisation's payment history. Org-scoped exactly like every other query. */
billingRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.getBillingView(auth(req)));
  }),
);

/** Server-side order creation. Returns the public key id — the secret stays
 *  on the server and is never part of any response. */
billingRouter.post(
  '/create-order',
  requireAuth,
  validateBody(createOrderSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.createOrder(auth(req), req.body));
  }),
);

/** Signature-verified confirmation. The frontend's success callback alone
 *  never counts — the HMAC over order_id|payment_id must pass server-side. */
billingRouter.post(
  '/verify',
  requireAuth,
  validateBody(verifyPaymentSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.verifyPayment(auth(req), req.body));
  }),
);

/** Backup verification path, called by Razorpay — deliberately NOT
 *  auth-gated. Trust is the webhook signature over the raw body. */
billingRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    res.json(await service.handleWebhook(req.rawBody, req.header('x-razorpay-signature')));
  }),
);

/** Platform-wide analytics. SUPER_ADMIN only, same access pattern as
 *  /companies/onboarded-overview — anyone else is refused before any query. */
billingRouter.get(
  '/analytics',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.platformAnalytics(auth(req)));
  }),
);