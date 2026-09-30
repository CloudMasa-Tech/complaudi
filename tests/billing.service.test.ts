import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/lib/dates';
import type { Actor } from '../src/lib/access';

/**
 * End-to-end behaviour of the billing flows, with Prisma and the Razorpay SDK
 * both mocked. Everything that touches the outside world is faked here; what is
 * left real is the actual service decision-making — who may buy, what the HMAC
 * handshake demands, what a webhook is allowed to do, and how analytics
 * aggregates real rows for the SUPER_ADMIN.
 */

const SECRET_KEY = 'test_key_secret';
const TEST_KEY_ID = 'rzp_test_abc123';

const actor = (role: Actor['role']): Actor => ({ userId: 'user-1', organizationId: 'org-1', role });

let mockEnv: Record<string, unknown>;
let mockPrisma: Record<string, any>;
let mockOrdersCreate: ReturnType<typeof vi.fn>;
let mockPaymentsFetch: ReturnType<typeof vi.fn>;

function configureMocks() {
  vi.doMock('../src/config/env', () => ({ env: mockEnv }));
  vi.doMock('../src/lib/logger', () => ({
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  }));
  vi.doMock('../src/lib/prisma', () => ({ prisma: mockPrisma, serialiseBigInt: (v: unknown) => v }));
  vi.doMock('razorpay', () => {
    class MockRazorpay {
      orders = { create: mockOrdersCreate };
      payments = { fetch: mockPaymentsFetch };
    }
    return { default: MockRazorpay };
  });
}

function configuredEnv(overrides: Record<string, unknown> = {}) {
  return {
    RAZORPAY_KEY_ID: TEST_KEY_ID,
    RAZORPAY_KEY_SECRET: SECRET_KEY,
    RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
    RAZORPAY_TEST_MODE: true,
    RAZORPAY_CURRENCY: 'INR',
    razorpayEnabled: true,
    razorpayKeyEnv: 'test',
    ...overrides,
  };
}

function defaultPrisma() {
  return {
    payment: {
      findMany: vi.fn(() => Promise.resolve([])),
      findUnique: vi.fn(() => Promise.resolve(null)),
      findUniqueOrThrow: vi.fn(() => Promise.reject(new Error('not mocked'))),
      findFirst: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'pmt-1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    organization: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve({})),
    },
    company: {
      findFirst: vi.fn(() => Promise.resolve(null)),
    },
    $transaction: vi.fn(() => Promise.resolve([])),
  };
}

beforeEach(() => {
  mockEnv = configuredEnv();
  mockPrisma = defaultPrisma();
  mockOrdersCreate = vi.fn();
  mockPaymentsFetch = vi.fn();
  configureMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../src/config/env');
  vi.doUnmock('../src/lib/logger');
  vi.doUnmock('../src/lib/prisma');
  vi.doUnmock('razorpay');
  vi.restoreAllMocks();
});

describe('createOrder — who may start a purchase', () => {
  it('refuses a read-only member', async () => {
    // VIEWER is the only role that cannot buy. The subscription belongs to the
    // organisation, so any member who can change something can also pay for it
    // — a CA who runs a client's filings should not have to find an owner to
    // click the button.
    mockOrdersCreate.mockResolvedValue({ id: 'order_test' });
    vi.resetModules();
    const { createOrder } = await import('../src/modules/billing/billing.service');

    await expect(createOrder(actor('VIEWER'), {})).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(mockOrdersCreate).not.toHaveBeenCalled();
  });

  it('lets every role that can change something buy', async () => {
    mockOrdersCreate.mockResolvedValue({ id: 'order_test' });
    vi.resetModules();
    const { createOrder } = await import('../src/modules/billing/billing.service');

    for (const role of ['SUPER_ADMIN', 'ADMIN', 'CA', 'COMPANY_OWNER'] as const) {
      await expect(createOrder(actor(role), {})).resolves.toMatchObject({ orderId: 'order_test' });
    }
  });

  it('creates the Razorpay order, records the CREATED row, and returns only the public key id', async () => {
    mockOrdersCreate.mockResolvedValue({ id: 'order_test' });
    vi.resetModules();
    const { createOrder } = await import('../src/modules/billing/billing.service');

    const result = await createOrder(actor('COMPANY_OWNER'), {});

    // The default plan, priced from the catalog rather than from env.
    expect(mockOrdersCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 235_882, currency: 'INR' }));
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          createdByUserId: 'user-1',
          rzxOrderId: 'order_test',
          amountPaise: 235_882,
          baseAmountPaise: 199_900,
          taxPercent: 18,
          taxAmountPaise: 35_982,
          planKey: 'ANNUAL',
          periodDays: 365,
          status: 'CREATED',
        }),
      }),
    );

    expect(result.orderId).toBe('order_test');
    expect(result.amountPaise).toBe(235_882);
    expect(result.amountLabel).toBe('₹2,358.82');
    expect(result.keyId).toBe(TEST_KEY_ID);
    // The key secret is server-only: it must appear nowhere in the response.
    expect(JSON.stringify(result)).not.toContain(SECRET_KEY);
  });

  it('attributes the order to a company the actor actually holds', async () => {
    mockOrdersCreate.mockResolvedValue({ id: 'order_test' });
    mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-9' });
    vi.resetModules();
    const { createOrder } = await import('../src/modules/billing/billing.service');

    await createOrder(actor('COMPANY_OWNER'), { companyId: 'company-9' });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-9' }) }),
    );
  });

  it('404s on a company that is not held by this actor — same tenant isolation as every query', async () => {
    mockOrdersCreate.mockResolvedValue({ id: 'order_test' });
    vi.resetModules();
    const { createOrder } = await import('../src/modules/billing/billing.service');

    await expect(createOrder(actor('COMPANY_OWNER'), { companyId: 'company-not-held' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockOrdersCreate).not.toHaveBeenCalled();
  });
});

describe('verifyPayment — the popup callback alone is never trusted', () => {
  const ownedOrder = {
    id: 'pmt-1',
    organizationId: 'org-1',
    rzxSignature: null as string | null,
    status: 'CREATED',
    planName: '1 Year',
    planKey: 'ANNUAL',
    periodDays: 365,
    validUntil: null as Date | null,
  };

  it('rejects a payment whose HMAC does not match the order|payment pair', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(ownedOrder);
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');

    await expect(
      verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: 'deadbeef' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // The bad signature must be rejected before Razorpay is ever asked.
    expect(mockPaymentsFetch).not.toHaveBeenCalled();
  });

  it('404s on another organisation’s order id without confirming an order exists', async () => {
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, organizationId: 'org-other' });

    await expect(
      verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('short-circuits a payment a verified webhook already credited', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, status: 'SUCCESS', validUntil: addDays(new Date(), 30) });
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');

    const result = await verifyPayment(actor('COMPANY_OWNER'), {
      orderId: 'order_test',
      rzpPaymentId: 'pay_123',
      rzpSignature: 'anything',
    });
    expect(result).toMatchObject({ status: 'SUCCESS', alreadyProcessed: true });
    expect(mockPaymentsFetch).not.toHaveBeenCalled();
  });

  /**
   * The bypass these cover:
   *
   * verifyPayment used to decide a payment was "simulated" from the request
   * body — an id beginning "pay_mock_", or the literal signature string
   * "rzp_mock_signature" — and credit it. Both come from the browser, so any
   * signed-in user could post them against their own CREATED order and receive
   * a paid subscription having paid nothing. A second path credited on any
   * error thrown while confirming with Razorpay.
   *
   * With credentials configured there is now exactly one way to be credited:
   * a valid HMAC, and Razorpay itself reporting the payment captured against
   * this order.
   */
  it('refuses the signature string that used to wave a payment through', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, rzxSignature: null });
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');

    await expect(
      verifyPayment(actor('COMPANY_OWNER'), {
        orderId: 'order_test',
        rzpPaymentId: 'pay_mock_999',
        rzpSignature: 'rzp_mock_signature',
      }),
    ).rejects.toThrow(/signature could not be verified/i);

    expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('does not credit when Razorpay cannot be reached', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, rzxSignature: null });
    mockPaymentsFetch.mockRejectedValue(new Error('ECONNRESET'));
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');
    const { clientVerificationHmac } = await import('../src/modules/billing/razorpay');

    const sig = clientVerificationHmac('order_test', 'pay_123');
    await expect(
      verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: sig }),
    ).rejects.toThrow('ECONNRESET');

    // The old catch credited the entitlement here.
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('refuses a signature replayed from another order', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, rzxSignature: null });
    mockPaymentsFetch.mockResolvedValue({ id: 'pay_123', order_id: 'order_somebody_else', status: 'captured', method: 'card' });
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');
    const { clientVerificationHmac } = await import('../src/modules/billing/razorpay');

    const sig = clientVerificationHmac('order_test', 'pay_123');
    await expect(
      verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: sig }),
    ).rejects.toThrow(/different order/i);
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it('honours the term that was bought, not a configured default', async () => {
    // A three-year purchase must credit three years. The window used to come
    // from RAZORPAY_PLAN_PERIOD_DAYS, which would have given it one.
    mockPrisma.payment.findUnique.mockResolvedValue({
      ...ownedOrder, rzxSignature: null, planKey: 'TRIENNIAL', planName: '3 Years', periodDays: 1095,
    });
    mockPaymentsFetch.mockResolvedValue({ id: 'pay_123', order_id: 'order_test', status: 'captured', method: 'card' });
    mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pmt-1', validUntil: new Date(), planName: '3 Years' });
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');
    const { clientVerificationHmac } = await import('../src/modules/billing/razorpay');

    const sig = clientVerificationHmac('order_test', 'pay_123');
    await verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: sig });

    const call = mockPrisma.payment.update.mock.calls.at(-1)![0];
    const days = Math.round((call.data.validUntil.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(1095);
  });

  it('credits only a payment Razorpay reports as captured, and clears the trial marker', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, rzxSignature: null });
    mockPaymentsFetch.mockResolvedValue({ id: 'pay_123', order_id: 'order_test', status: 'captured', method: 'card' });
    const nextValidUntil = addDays(new Date(), 365);
    mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pmt-1', validUntil: nextValidUntil, planName: '1 Year' });
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');
    const { clientVerificationHmac } = await import('../src/modules/billing/razorpay');

    const sig = clientVerificationHmac('order_test', 'pay_123');
    const result = await verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: sig });

    expect(result.status).toBe('SUCCESS');
    expect(result.validUntil).toEqual(nextValidUntil);
    // The entitlement window and the trial both move inside one transaction.
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS', rzxPaymentId: 'pay_123' }) }),
    );
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trialEndsAt: null }) }),
    );
  });

  it('rejects an authorised-but-not-captured payment without upgrading', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({ ...ownedOrder, rzxSignature: null });
    mockPaymentsFetch.mockResolvedValue({ id: 'pay_123', status: 'authorized', method: 'upi' });
    vi.resetModules();
    const { verifyPayment } = await import('../src/modules/billing/billing.service');
    const { clientVerificationHmac } = await import('../src/modules/billing/razorpay');

    const sig = clientVerificationHmac('order_test', 'pay_123');
    await expect(
      verifyPayment(actor('COMPANY_OWNER'), { orderId: 'order_test', rzpPaymentId: 'pay_123', rzpSignature: sig }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });
});

describe('handleWebhook — the backup verification path', () => {
  const paidEvent = Buffer.from(
    JSON.stringify({
      entity: 'event',
      account_id: 'acc_1',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_123', order_id: 'order_test', amount: 69900, method: 'card' },
        },
      },
    }),
  );

  it('refuses to run at all when no webhook secret is configured', async () => {
    mockEnv = configuredEnv({ RAZORPAY_WEBHOOK_SECRET: '' });
    vi.resetModules();
    const { handleWebhook } = await import('../src/modules/billing/billing.service');
    await expect(handleWebhook(paidEvent, 'x'.repeat(64))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a webhook whose signature does not cover the raw body', async () => {
    vi.resetModules();
    const { handleWebhook } = await import('../src/modules/billing/billing.service');
    await expect(handleWebhook(paidEvent, 'x'.repeat(64))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('acks an unparseable payload rather than forcing Razorpay to retry forever', async () => {
    vi.resetModules();
    const { handleWebhook } = await import('../src/modules/billing/billing.service');
    const { webhookVerificationHmac } = await import('../src/modules/billing/razorpay');

    const body = Buffer.from('this is not json');
    const result = await handleWebhook(body, webhookVerificationHmac(body));
    expect(result).toEqual({ received: true, ignored: 'unparseable' });
  });

  it('acks events outside payment.* — they are not ours to act on', async () => {
    vi.resetModules();
    const { handleWebhook } = await import('../src/modules/billing/billing.service');
    const { webhookVerificationHmac } = await import('../src/modules/billing/razorpay');

    const body = Buffer.from(JSON.stringify({ event: 'order.paid', payload: {} }));
    const result = await handleWebhook(body, webhookVerificationHmac(body));
    expect(result).toEqual({ received: true, ignored: 'order.paid' });
  });

  it('acks an order we do not hold so Razorpay stops retrying', async () => {
    vi.resetModules();
    const { handleWebhook } = await import('../src/modules/billing/billing.service');
    const { webhookVerificationHmac } = await import('../src/modules/billing/razorpay');

    const result = await handleWebhook(paidEvent, webhookVerificationHmac(paidEvent));
    expect(result).toEqual({ received: true, ignored: 'unknown order' });
  });

  it('credits a captured payment and clears the trial marker', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'pmt-1',
      organizationId: 'org-1',
      rzxSignature: null,
      status: 'CREATED',
      planName: 'Annual plan',
      validUntil: null,
    });
    vi.resetModules();
    const { handleWebhook } = await import('../src/modules/billing/billing.service');
    const { webhookVerificationHmac } = await import('../src/modules/billing/razorpay');

    const result = await handleWebhook(paidEvent, webhookVerificationHmac(paidEvent));
    expect(result).toEqual({ received: true });
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS', rzxPaymentId: 'pay_123' }) }),
    );
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trialEndsAt: null }) }),
    );
  });
});

describe('platformAnalytics — SUPER_ADMIN-only, aggregated from real rows', () => {
  const now = new Date();

  /** Two SUCCESS payments for the intentionally short-lived org, plus one for
   *  the long-lived one — the buckets must follow the *rows*, not the fixture. */
  const successes = [
    { id: 'p-1', organizationId: 'org-paying', companyId: null, amountPaise: 69900, paidAt: now, validUntil: addDays(now, 10) },
    { id: 'p-2', organizationId: 'org-churned', companyId: null, amountPaise: 69900, paidAt: addDays(now, -400), validUntil: addDays(now, -20) },
    { id: 'p-3', organizationId: 'org-paying', companyId: null, amountPaise: 44000, paidAt: addDays(now, -350), validUntil: addDays(now, 45) },
  ];

  const orgs = [
    { id: 'org-trial', name: 'TrialCo', trialEndsAt: addDays(now, 10), trialSignedUpAt: addDays(now, -30) },
    { id: 'org-expired', name: 'ExpiredCo', trialEndsAt: addDays(now, -5), trialSignedUpAt: addDays(now, -40) },
    { id: 'org-full', name: 'FullCo', trialEndsAt: null, trialSignedUpAt: addDays(now, -30) },
    { id: 'org-paying', name: 'PayCo', trialEndsAt: null, trialSignedUpAt: null },
    { id: 'org-churned', name: 'ChurnedCo', trialEndsAt: null, trialSignedUpAt: addDays(now, -90) },
  ];

  function mockAnalyticsData() {
    mockPrisma.payment.findMany.mockImplementation(({ where }: { where: any }) => {
      if (where?.status === 'SUCCESS') return Promise.resolve(successes);
      if (where?.status?.in) {
        return Promise.resolve([
          { id: 'f-1', organizationId: 'org-trial', amountPaise: 69900, status: 'FAILED', createdAt: addDays(now, -5), method: 'card', rzxOrderId: 'order_f1' },
        ]);
      }
      return Promise.resolve([
        { id: 'h-1', organizationId: 'org-paying', organization: { name: 'PayCo' }, company: { legalName: 'PayCo Ltd' }, companyId: null, createdBy: { name: 'Ada', email: 'ada@co.in' }, rzxOrderId: 'order_test', amountPaise: 69900, currency: 'INR', planName: 'Annual plan', status: 'SUCCESS', method: 'card', paidAt: now, validUntil: addDays(now, 365), createdAt: now },
      ]);
    });
    mockPrisma.organization.findMany.mockResolvedValue(orgs);
  }

  it('refuses a regular workspace user at the first line', async () => {
    vi.resetModules();
    const { platformAnalytics } = await import('../src/modules/billing/billing.service');
    await expect(platformAnalytics(actor('COMPANY_OWNER'))).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('lets the SUPER_ADMIN through and aggregates the rows into every section', async () => {
    mockAnalyticsData();
    vi.resetModules();
    const { platformAnalytics } = await import('../src/modules/billing/billing.service');

    const result = await platformAnalytics(actor('SUPER_ADMIN'));

    // Revenue: all-time is every SUCCESS row; this month only the captured-now row.
    expect(result.revenue.allTime).toBe(69900 + 69900 + 44000);
    expect(result.revenue.thisMonth).toBe(69900);

    // Org buckets partition the five organisations by subscription state.
    expect(result.organisations).toEqual({
      total: 5,
      onTrial: 1,
      trialExpired: 1,
      payingNow: 1,
      fullUnbilled: 1,
      churned: 1,
    });

    // Four tried a trial, two of them paid: 50%. Two ever converted, one lapsed: 50%.
    expect(result.conversion).toMatchObject({ trialSignups: 4, converted: 2, displayRate: '50%' });
    expect(result.churn).toMatchObject({ everConverted: 2, churned: 1, displayRate: '50%' });

    // One active sub expires in ~45 days (31–60 window): latest validUntil wins.
    expect(result.renewals.next30Days).toHaveLength(0);
    expect(result.renewals.next30to60Days).toHaveLength(1);
    expect(result.renewals.list[0]).toMatchObject({ organizationId: 'org-paying', dueInDays: 45 });
    // The lapsed sub never appears as an upcoming renewal.
    expect(result.renewals.list.some((r) => r.organizationId === 'org-churned')).toBe(false);

    // Trend is keyed by captured month, oldest first.
    expect(result.trend).toHaveLength(3);
    expect(result.trend[0]!.amountPaise).toBe(69900); // p-2, the oldest month
    expect(result.trend[1]!.amountPaise).toBe(44000); // p-3
    expect(result.trend[2]!.amountPaise).toBe(69900); // p-1, the current month

    // The failed queue only carries FAILED/REFUNDED from the last 30 days.
    expect(result.failedPayments).toHaveLength(1);
    expect(result.failedPayments[0]).toMatchObject({ organizationName: 'TrialCo', status: 'FAILED' });

    // History rows carry who paid, via the relationships — never a raw id.
    expect(result.paymentHistory[0]).toMatchObject({
      organizationName: 'PayCo',
      companyName: 'PayCo Ltd',
      paidBy: { name: 'Ada', email: 'ada@co.in' },
      rzxOrderId: 'order_test',
      amountLabel: '₹699',
    });

    // Labels are currency-formatted server-side; amounts never reach the UI as paise.
    expect(result.revenueLabels).toEqual(
      expect.objectContaining({ allTime: '₹1,838', thisMonth: '₹699' }),
    );
  });
});