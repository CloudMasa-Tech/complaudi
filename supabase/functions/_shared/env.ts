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

