// supabase/functions/_shared/response.ts
import { corsHeaders } from './cors.ts';
import { AppError } from './errors.ts';

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return jsonResponse(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.statusCode,
    );
  }

  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  console.error('[Unhandled Error]:', err);

  return jsonResponse(
    { error: { code: 'INTERNAL_ERROR', message } },
    500,
  );
}
