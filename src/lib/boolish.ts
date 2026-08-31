import { z } from 'zod';

const TRUTHY = new Set(['1', 'true', 't', 'yes', 'y', 'on']);
const FALSY = new Set(['0', 'false', 'f', 'no', 'n', 'off', '']);

/**
 * A boolean that survives arriving as a string.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, so every non-empty string is true —
 * including `"false"` and `"0"`. Environment variables and query parameters are
 * always strings, so that turns `ENABLE_CRON=false` into `true` and quietly
 * does the opposite of what the operator asked for.
 */
export function boolish(defaultValue?: boolean) {
  const base = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
    if (typeof value === 'boolean') return value;

    const normalised = value.trim().toLowerCase();
    if (TRUTHY.has(normalised)) return true;
    if (FALSY.has(normalised)) return false;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected a boolean such as true/false, got "${value}"`,
    });
    return z.NEVER;
  });

  return defaultValue === undefined ? base : base.default(defaultValue);
}
