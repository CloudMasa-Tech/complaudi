// supabase/functions/_shared/validation.ts
// @ts-ignore
import { z, ZodSchema } from 'https://esm.sh/zod@3.23.8';
import { BadRequestError } from './errors.ts';

export async function parseJsonBody<T = any>(req: Request, schema: any): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (_e) {
    throw new BadRequestError('Invalid JSON request body');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), message: i.message }));
    throw new BadRequestError('Request validation failed', details);
  }

  return parsed.data;
}

export function parseQueryParams<T = any>(url: string, schema: any): T {
  const parsedUrl = new URL(url);
  const obj: Record<string, string> = {};
  parsedUrl.searchParams.forEach((v, k) => {
    obj[k] = v;
  });

  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), message: i.message }));
    throw new BadRequestError('Query parameter validation failed', details);
  }

  return parsed.data;
}
