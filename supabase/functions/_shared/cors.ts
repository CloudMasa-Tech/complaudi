// supabase/functions/_shared/cors.ts

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-job-secret, x-razorpay-signature',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://complaudi.regibiz.in'];

export function getCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const origin = (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) ? reqOrigin : ALLOWED_ORIGINS[0];
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: getCorsHeaders(req.headers.get('origin')) });
  }
  return null;
}
