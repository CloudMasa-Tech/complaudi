import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The billing handshake is HMAC-SHA256 throughout, and it is the only thing
 * standing between a forged "success" callout and a free year of the product.
 * These pin the cryptography down exactly so a refactor cannot quietly weaken
 * it — wrong input lengths, empty strings and tampered bodies all fail closed.
 */

const SECRET_KEY = 'test_key_secret';
const WEBHOOK_SECRET = 'webhook_secret';
const TEST_KEY_ID = 'rzp_test_abc123';

/* The env module is mocked so the HMACs sign against *known* secrets. */
let mockEnv: Record<string, unknown>;

function configuredEnv(overrides: Record<string, unknown> = {}) {
  return {
    RAZORPAY_KEY_ID: TEST_KEY_ID,
    RAZORPAY_KEY_SECRET: SECRET_KEY,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_TEST_MODE: true,
    RAZORPAY_CURRENCY: 'INR',
    razorpayEnabled: true,
    razorpayKeyEnv: 'test',
    ...overrides,
  };
}

beforeEach(() => {
  mockEnv = configuredEnv();
  vi.doMock('../src/config/env', () => ({ env: mockEnv }));
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../src/config/env');
  vi.restoreAllMocks();
});

describe('billing signatures — razorpay.ts crypto', () => {
  it('clientVerificationHmac signs `order_id|payment_id` with the key secret', async () => {
    const { clientVerificationHmac } = await import('../src/modules/billing/razorpay');
    const expected = crypto
      .createHmac('sha256', SECRET_KEY)
      .update('order_test|pay_123')
      .digest('hex');
    expect(clientVerificationHmac('order_test', 'pay_123')).toBe(expected);
  });

  it('webhookVerificationHmac signs the raw body with the webhook secret', async () => {
    const { webhookVerificationHmac } = await import('../src/modules/billing/razorpay');
    const body = Buffer.from('{"event":"payment.captured"}');
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    expect(webhookVerificationHmac(body)).toBe(expected);
  });

  it('verifyRzpSignature accepts the genuine signature for a body', async () => {
    const { verifyRzpSignature, webhookVerificationHmac } = await import('../src/modules/billing/razorpay');
    const body = Buffer.from('{"event":"payment.captured","amount":69900}');
    const sig = webhookVerificationHmac(body);
    expect(verifyRzpSignature(sig, sig)).toBe(true);
  });

  it('rejects a tampered signature (same length, different bytes)', async () => {
    const { verifyRzpSignature, webhookVerificationHmac } = await import('../src/modules/billing/razorpay');
    const body = Buffer.from('{"event":"payment.captured","amount":69900}');
    const sig = webhookVerificationHmac(body);
    const tampered = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(tampered).not.toBe(sig);
    expect(verifyRzpSignature(sig, tampered)).toBe(false);
  });

  it('rejects signatures of the wrong length without a timing oracle', async () => {
    const { verifyRzpSignature, clientVerificationHmac } = await import('../src/modules/billing/razorpay');
    const sig = clientVerificationHmac('order_test', 'pay_123');
    expect(verifyRzpSignature(sig, `00${sig}`)).toBe(false); // longer
    expect(verifyRzpSignature(sig, 'abc')).toBe(false); // shorter
  });

  it('fails closed on empty or missing inputs', async () => {
    const { verifyRzpSignature, clientVerificationHmac } = await import('../src/modules/billing/razorpay');
    const sig = clientVerificationHmac('order_test', 'pay_123');
    expect(verifyRzpSignature('', sig)).toBe(false);
    expect(verifyRzpSignature(sig, '')).toBe(false);
    expect(verifyRzpSignature(sig, undefined)).toBe(false);
    expect(verifyRzpSignature(sig, null)).toBe(false);
  });

  it('assertRazorpayMode stays quiet on test keys in test mode', async () => {
    const { assertRazorpayMode } = await import('../src/modules/billing/razorpay');
    expect(() => assertRazorpayMode()).not.toThrow();
  });
});

describe('billing mode guard — live keys must never run in test mode', () => {
  it('assertRazorpayMode refuses a live key while RAZORPAY_TEST_MODE=true', async () => {
    mockEnv = configuredEnv({ RAZORPAY_KEY_ID: 'rzp_live_zzz', razorpayKeyEnv: 'live' });
    vi.resetModules();
    const { assertRazorpayMode } = await import('../src/modules/billing/razorpay');
    expect(() => assertRazorpayMode()).toThrow(/refusing to charge/i);
  });

  it('razorpayClient refuses to build when billing is not configured (503 BILLING_NOT_CONFIGURED)', async () => {
    mockEnv = configuredEnv({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', razorpayEnabled: false });
    vi.resetModules();
    const { razorpayClient } = await import('../src/modules/billing/razorpay');
    let error: unknown;
    try {
      razorpayClient();
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ statusCode: 503, code: 'BILLING_NOT_CONFIGURED' });
  });
});