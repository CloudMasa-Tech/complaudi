// supabase/functions/_shared/env.ts

declare const Deno: any;

export const env = {
  get SUPABASE_URL(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') || Deno.env.get('SUPABASE_ANON_URL') : '') || '';
  },
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : '') || '';
  },
  get SUPABASE_ANON_KEY(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_ANON_KEY') : '') || '';
  },
  get JWT_ACCESS_SECRET(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('JWT_ACCESS_SECRET') : '') || 'default-jwt-secret-min-16-chars-long';
  },
  get JWT_REFRESH_SECRET(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('JWT_REFRESH_SECRET') : '') || 'default-jwt-refresh-secret-min-16-chars';
  },
  /** Web origin the password-reset email redirects back to (the SPA's /reset-password route). */
  get APP_BASE_URL(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('APP_BASE_URL') : '') || 'http://localhost:5173';
  },
  get RAZORPAY_KEY_ID(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_KEY_ID') : '') || 'rzp_test_mockkey12345';
  },
  get RAZORPAY_KEY_SECRET(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_KEY_SECRET') : '') || 'mock_secret_12345';
  },
  get RAZORPAY_WEBHOOK_SECRET(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_WEBHOOK_SECRET') : '') || '';
  },
  /**
   * Whether this function holds usable Razorpay credentials.
   *
   * RAZORPAY_KEY_ID falls back to a mock literal above, so its mere presence
   * proves nothing — this checks for a key that is not that placeholder.
   */
  get razorpayConfigured(): boolean {
    const id = typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_KEY_ID') : '';
    const secret = typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_KEY_SECRET') : '';
    return Boolean(id && secret && !id.startsWith('rzp_test_mock'));
  },
  /**
   * Whether this function may mark a payment paid without one being made.
   *
   * Opt-in and default-deny. A deployed edge function has no NODE_ENV to read,
   * so "not production" cannot be inferred — it has to be stated, and stating
   * it on a real deployment is then a visible act rather than an accident.
   * Never derived from anything in a request.
   */
  get allowSimulatedBilling(): boolean {
    if (this.razorpayConfigured) return false;
    return (typeof Deno !== 'undefined' ? Deno.env.get('ALLOW_SIMULATED_BILLING') : '') === 'true';
  },
  get RAZORPAY_TEST_MODE(): boolean {
    return typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_TEST_MODE') === 'true' : false;
  },
  get RAZORPAY_PLAN_NAME(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_PLAN_NAME') : '') || 'Compliance Platform Annual';
  },
  get RAZORPAY_PLAN_AMOUNT_PAISE(): number {
    const val = typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_PLAN_AMOUNT_PAISE') : null;
    return val ? parseInt(val, 10) : 69900;
  },
  get RAZORPAY_CURRENCY(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_CURRENCY') : '') || 'INR';
  },
  get RAZORPAY_PLAN_PERIOD_DAYS(): number {
    const val = typeof Deno !== 'undefined' ? Deno.env.get('RAZORPAY_PLAN_PERIOD_DAYS') : null;
    return val ? parseInt(val, 10) : 365;
  },
  get JOB_TRIGGER_SECRET(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('JOB_TRIGGER_SECRET') : '') || '';
  },
  get RESEND_API_KEY(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('RESEND_API_KEY') : '') || '';
  },
  get MAIL_FROM(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('MAIL_FROM') : '') || 'Compliance Toolkit <no-reply@example.com>';
  },
  get BIZVERIFY_BASE_URL(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('BIZVERIFY_BASE_URL') : '') || 'http://localhost:8000';
  },
  get BIZVERIFY_SERVICE_TOKEN(): string {
    return (typeof Deno !== 'undefined' ? Deno.env.get('BIZVERIFY_SERVICE_TOKEN') : '') || 'dev-bizverify-service-token';
  },
};

