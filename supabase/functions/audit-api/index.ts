import { handleCors } from '../_shared/cors.ts';
import { getAuthContext, requireCapability } from '../_shared/auth.ts';
import { getClientSupabase } from '../_shared/database.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { NotFoundError } from '../_shared/errors.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authCtx = await getAuthContext(req);
    requireCapability(authCtx, 'audit.read');

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');

    const entityType = url.searchParams.get('entityType') || undefined;
    const entityId = url.searchParams.get('entityId') || undefined;
    const action = url.searchParams.get('action') || undefined;
    const actorId = url.searchParams.get('actorId') || undefined;
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;

    const client = getClientSupabase(req);
    let query = client
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('organizationId', authCtx.organizationId)
      .order('createdAt', { ascending: false });

    if (entityType) query = query.eq('entityType', entityType);
    if (entityId) query = query.eq('entityId', entityId);
    if (action) query = query.ilike('action', `%${action}%`);
    if (actorId) query = query.eq('actorId', actorId);
    if (from) query = query.gte('createdAt', from);
    if (to) query = query.lte('createdAt', to);

    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;
    query = query.range(fromIdx, toIdx);

    const { data, count, error } = await query;
    if (error) throw error;

    return jsonResponse({
      total: count || 0,
      page,
      pageSize,
      rows: data || [],
    });
  } catch (err: any) {
    return errorResponse(err);
  }
});
