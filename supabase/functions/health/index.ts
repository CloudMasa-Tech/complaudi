import { handleCors } from '../_shared/cors.ts';
import { getAdminSupabase } from '../_shared/database.ts';
import { jsonResponse } from '../_shared/response.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path.endsWith('/ready')) {
    try {
      const admin = getAdminSupabase();
      const { data, error } = await admin.from('organizations').select('id').limit(1);
      if (error) throw error;
      return jsonResponse({ status: 'ok', database: 'connected' });
    } catch (err: any) {
      return jsonResponse({ status: 'unhealthy', database: err.message }, 503);
    }
  }

  return jsonResponse({ status: 'ok', service: 'supabase-edge-functions', timestamp: new Date().toISOString() });
});
