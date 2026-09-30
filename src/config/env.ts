import 'dotenv/config';
import { z } from 'zod';
import { boolish } from '../lib/boolish';

const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase pooled connection string)'),
  DIRECT_URL: z.string().optional(),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('compliance-evidence'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: boolish(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Compliance Toolkit <no-reply@example.com>'),

  // Razorpay billing. Both keys present ⇒ billing is enabled. The test-mode
  // switch is a hard safety guard: with RAZORPAY_TEST_MODE=true the process
  // refuses to boot against a *live* key id (rzp_live_*), so a test environment
  // can never accidentally charge a real customer. See the check below.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_TEST_MODE: boolish(false),
  /// Single product today: annual plan, price in paise. Not hardcoded anywhere
  /// in the app — served to the frontend from here and used to create orders.
  // Prices and terms live in src/modules/billing/plans.ts, not here: they must
  // match what the Supabase edge function charges, and two runtimes reading two
  // env files is how that drifts. RAZORPAY_PLAN_AMOUNT_PAISE, _NAME and
  // _PERIOD_DAYS were removed with the single-plan catalog.
  RAZORPAY_CURRENCY: z.string().min(3).default('INR'),

  // Defaults to OFF. In-process cron is a development convenience; every
  // replica would fire it, so production drives jobs from an external
  // scheduler instead. See DEPLOYMENT.md.
  /// Serve the built SPA from web/dist on the same origin as the API.
  /// Keeps production to one artifact; leave false if you host the front end
  /// separately (Vercel, Cloudflare Pages, S3+CloudFront).
  SERVE_WEB: boolish(false),
  WEB_DIST_DIR: z.string().default('./web/dist'),

  ENABLE_CRON: boolish(false),
  /// Shared secret for POST /internal/jobs/:name. Required to expose the trigger.
  JOB_TRIGGER_SECRET: z.string().min(24).optional(),
  REMINDER_CRON: z.string().default('0 8 * * *'),
  TIMEZONE: z.string().default('Asia/Kolkata'),
  REMINDER_OFFSET_DAYS: z.string().default('30,15,7,3,1,0'),

  // Claude / Anthropic. The key is optional: without it the regulatory watch
  // job is inert and every other feature behaves exactly as before. Approved
  // overlays already in the database keep applying — the engine never needs the
  // API to read what a human has already signed off.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  /// Effort spent on the research pass. `high` is the sensible floor for work
  /// whose output a human has to trust; drop to `medium` only to cut cost.
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),

  // Regulatory watch
  REGULATORY_WATCH_ENABLED: boolish(false),
  /// Weekly by default — MCA circulars do not land hourly, and every run costs
  /// money. Only consulted when in-process cron is on; production drives the
  /// job from an external scheduler like every other job here.
  REGULATORY_WATCH_CRON: z.string().default('0 7 * * 1'),
  /// How far back each sweep looks. Generous enough that a couple of missed
  /// runs do not open a gap, and dedupe on `fingerprint` absorbs the overlap.
  REGULATORY_WATCH_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(365).default(21),
  /// Ceiling on updates persisted per sweep — a runaway search cannot flood the
  /// review queue.
  REGULATORY_WATCH_MAX_UPDATES: z.coerce.number().int().min(1).max(100).default(25),

  // Government / MCA verification provider configuration (BizVerify)
  BIZVERIFY_BASE_URL: z.string().url().default('http://localhost:8000'),
  BIZVERIFY_SERVICE_TOKEN: z.string().default('dev-bizverify-service-token'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Fail loudly at boot rather than at the first request.
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

const raw = parsed.data;

// The safety switch: refuse to run test mode against live keys. A test
// environment forgetting to swap keys must fail at boot, not on the first real
// charge. (`raw` may be null here only if the schema above was removed; zod
// parsing already guarantees non-null by the time we reach this line.)
const KEY_PREFIX_RE = /^rzp_(live|test)_/;
const keyEnv = raw.RAZORPAY_KEY_ID?.match(KEY_PREFIX_RE)?.[1] ?? null;
if (raw.RAZORPAY_TEST_MODE && keyEnv === 'live') {
  throw new Error(
    'RAZORPAY_TEST_MODE is true but RAZORPAY_KEY_ID starts with rzp_live_ — refusing to start so test traffic can never hit live billing.',
  );
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: csv(raw.CORS_ORIGINS),
  reminderOffsetDays: csv(raw.REMINDER_OFFSET_DAYS).map(Number).filter((n) => Number.isFinite(n)),
  storageDriver: raw.SUPABASE_URL && raw.SUPABASE_SERVICE_ROLE_KEY ? ('supabase' as const) : ('local' as const),
  jobTriggerEnabled: Boolean(raw.JOB_TRIGGER_SECRET),
  mailDriver: raw.SMTP_HOST ? ('smtp' as const) : ('console' as const),
  /// Billing is a config-gated module: both Razorpay keys present switches it on.
  razorpayEnabled: Boolean(raw.RAZORPAY_KEY_ID && raw.RAZORPAY_KEY_SECRET),
  /// Which key environment the configured id belongs to, when billing is on.
  razorpayKeyEnv: (keyEnv ?? 'none') as 'live' | 'test' | 'none',
  /// Claude access is a config gate, like billing: no key, no watcher.
  claudeEnabled: Boolean(raw.ANTHROPIC_API_KEY),
  /// The watcher needs both the switch and the key. Checked at boot so an
  /// operator who set one without the other finds out immediately.
  regulatoryWatchEnabled: Boolean(raw.REGULATORY_WATCH_ENABLED && raw.ANTHROPIC_API_KEY),
};

export type Env = typeof env;
