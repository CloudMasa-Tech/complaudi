import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Comma-separated enum lists in query strings, e.g. `?status=DUE,OVERDUE`. */
export const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

export const dateQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((v) => {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  })
  .optional();
