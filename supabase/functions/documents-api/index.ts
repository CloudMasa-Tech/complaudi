// supabase/functions/documents-api/index.ts
<<<<<<< HEAD
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
=======
import { handleCors } from '../_shared/cors.ts';
import { computeCoverage } from '../_shared/coverage.ts';
>>>>>>> origin/main_cloudmasa
import { assertCan, getAuthContext, seesEveryCompany } from '../_shared/auth.ts';
import { getSupabaseAdminClient } from '../_shared/database.ts';
import { AppError, BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { parseJsonBody, parseQueryParams } from '../_shared/validation.ts';
// @ts-ignore
import { z } from 'https://esm.sh/zod@3.23.8';

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = (url.pathname
    .replace(/^\/functions\/v1\/[^\/]+/, '')
    .replace(/^\/api\/v1\/[^\/]+/, '')
    .replace(/^\/[^\/]+-api/, '')
    .replace(/^\/documents/, '') || '/');
  const supabase = getSupabaseAdminClient();
  const authCtx = await getAuthContext(req);

  // GET /documents
  if (req.method === 'GET' && (path === '' || path === '/')) {
    const schema = z.object({
      companyId: z.string().uuid().optional(),
      complianceItemId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
    });
    const q = parseQueryParams(req.url, schema);

    
    let query = supabase.from('documents').select('*, uploadedBy:users(id, name, email)');

    if (q.companyId) {
      await assertCan(authCtx, q.companyId, 'documents.view');
      query = query.eq('companyId', q.companyId);
    } else if (!seesEveryCompany(authCtx.role)) {
      const { data: userGrants } = await supabase.from('company_memberships').select('companyId').eq('userId', authCtx.userId);
      const companyIds = (userGrants || []).map((g) => g.companyId);
      query = query.in('companyId', companyIds);
    }

    if (q.complianceItemId) query = query.eq('complianceItemId', q.complianceItemId);
    if (q.taskId) query = query.eq('taskId', q.taskId);

    const { data: docs, error } = await query.order('createdAt', { ascending: false });
    if (error) throw new AppError(error.message, 400);

    const rows = docs || [];
    return jsonResponse({
      rows,
      total: rows.length,
      page: 1,
      pageSize: 100,
    });
  }

  // POST /documents (Upload Document)
  if (req.method === 'POST' && (path === '' || path === '/')) {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const companyId = formData.get('companyId') as string | null;
    const label = formData.get('label') as string | null;
    const complianceItemId = formData.get('complianceItemId') as string | null;

    if (!file || !companyId) {
      throw new BadRequestError('File and companyId are required');
    }

    await assertCan(authCtx, companyId, 'documents.upload');

    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const mimeType = file.type || 'application/pdf';
    const sizeBytes = fileBuffer.byteLength;
    const ext = fileName.includes('.') ? fileName.split('.').pop() : 'pdf';
    const storageKey = `orgs/${authCtx.organizationId}/companies/${companyId}/documents/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('compliance-evidence')
      .upload(storageKey, fileBuffer, { contentType: mimeType, upsert: true });

    if (uploadError) throw new AppError(uploadError.message, 500);

    const sha256Buffer = await crypto.subtle.digest('SHA-256', fileBuffer);
    const sha256Hex = Array.from(new Uint8Array(sha256Buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const docId = crypto.randomUUID();
    const { data: document, error: dbError } = await supabase
      .from('documents')
      .insert({
        id: docId,
        companyId,
        complianceItemId: complianceItemId || null,
        fileName,
        storageKey,
        storageDriver: 'supabase',
        mimeType,
        sizeBytes,
        sha256: sha256Hex,
        label: label || fileName,
        uploadedById: authCtx.userId,
        createdAt: new Date().toISOString(),
      })
      .select('*, uploadedBy:users(id, name, email)')
      .single();

    if (dbError) {
      // Storage Rollback: Delete uploaded file if DB record insertion fails
      await supabase.storage.from('compliance-evidence').remove([storageKey]);
      throw new AppError(dbError.message, 400);
    }

    return jsonResponse({ document, deduplicated: false }, 201);
  }

  // GET /documents/coverage/:companyId
  const coverageMatch = path.match(/^\/coverage\/([a-f0-9-]+)$/);
  if (req.method === 'GET' && coverageMatch) {
    const companyId = coverageMatch[1];
    await assertCan(authCtx, companyId, 'documents.view');

    const { data: items } = await supabase
      .from('compliance_items')
      .select('id, title, ruleCode, status, dueDate, evidenceLevel, attestationText')
      .eq('companyId', companyId);

    const itemsList = items || [];
    const itemsRequiringEvidence = itemsList.length;
    const itemsWithEvidence = itemsList.filter((i) => i.evidenceLevel !== 'NONE' || i.attestationText).length;
    const coveragePct = itemsRequiringEvidence > 0 ? Math.round((itemsWithEvidence / itemsRequiringEvidence) * 100) : 100;
    const missing = itemsList
      .filter((i) => i.evidenceLevel === 'NONE' && !i.attestationText)
      .slice(0, 10)
      .map((i) => ({ id: i.id, title: i.title, ruleCode: i.ruleCode, status: i.status, dueDate: i.dueDate, expected: ['Proof document'] }));

    return jsonResponse({
      totalItems: itemsList.length,
      itemsRequiringEvidence,
      itemsWithEvidence,
      coveragePct,
      missing,
    });
  }

  // GET /documents/:id/download -> Returns 5-minute Signed Download URL
  const downloadMatch = path.match(/^\/([a-f0-9-]+)\/download$/);
  if (req.method === 'GET' && downloadMatch) {
    const docId = downloadMatch[1];
    const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (!doc) throw new NotFoundError('Document not found');

    await assertCan(authCtx, doc.companyId, 'documents.view');

    const { data: signedData, error } = await supabase.storage
      .from('compliance-evidence')
      .createSignedUrl(doc.storageKey, 300);

    if (error || !signedData) {
      throw new AppError(`Failed to generate signed download URL: ${error?.message}`, 502);
    }

    return jsonResponse({ kind: 'redirect', url: signedData.signedUrl, document: doc });
  }

  // DELETE /documents/:id
  const docIdMatch = path.match(/^\/([a-f0-9-]+)$/);
  if (req.method === 'DELETE' && docIdMatch) {
    const docId = docIdMatch[1];
    const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (!doc) throw new NotFoundError('Document not found');

    await assertCan(authCtx, doc.companyId, 'documents.delete');

    // 1. Remove file from Supabase Storage
    await supabase.storage.from('compliance-evidence').remove([doc.storageKey]);

    // 2. Delete DB metadata record
    await supabase.from('documents').delete().eq('id', docId);

    return new Response(null, { status: 204 });
  }

  throw new BadRequestError(`No route matches ${req.method} ${path}`);
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  let res: Response;
  try {
<<<<<<< HEAD
    res = await handleRequest(req);
=======
    const url = new URL(req.url);
    const path = (url.pathname
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/^\/documents/, '') || '/');
    const supabase = getSupabaseAdminClient();
    const authCtx = await getAuthContext(req);

    // GET /documents
    if (req.method === 'GET' && (path === '' || path === '/')) {
      const schema = z.object({
        companyId: z.string().uuid().optional(),
        complianceItemId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
      });
      const q = parseQueryParams(req.url, schema);

      let query = supabase.from('documents').select('*, uploadedBy:users(id, name, email)');

      if (q.companyId) {
        await assertCan(authCtx, q.companyId, 'documents.view');
        query = query.eq('companyId', q.companyId);
      } else if (!seesEveryCompany(authCtx.role)) {
        const { data: userGrants } = await supabase.from('company_memberships').select('companyId').eq('userId', authCtx.userId);
        const companyIds = (userGrants || []).map((g) => g.companyId);
        query = query.in('companyId', companyIds);
      }

      if (q.complianceItemId) query = query.eq('complianceItemId', q.complianceItemId);
      if (q.taskId) query = query.eq('taskId', q.taskId);

      const { data: docs, error } = await query.order('createdAt', { ascending: false });
      if (error) throw new AppError(error.message, 400);

      const rows = docs || [];
      return jsonResponse({
        rows,
        total: rows.length,
        page: 1,
        pageSize: 100,
      });
    }

    // POST /documents (Upload Document)
    if (req.method === 'POST' && (path === '' || path === '/')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const companyId = formData.get('companyId') as string | null;
      const label = formData.get('label') as string | null;
      const complianceItemId = formData.get('complianceItemId') as string | null;

      if (!file || !companyId) {
        throw new BadRequestError('File and companyId are required');
      }

      await assertCan(authCtx, companyId, 'documents.upload');

      const fileBuffer = await file.arrayBuffer();
      const fileName = file.name;
      const mimeType = file.type || 'application/pdf';
      const sizeBytes = fileBuffer.byteLength;
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'pdf';
      const storageKey = `orgs/${authCtx.organizationId}/companies/${companyId}/documents/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('compliance-evidence')
        .upload(storageKey, fileBuffer, { contentType: mimeType, upsert: true });

      if (uploadError) throw new AppError(uploadError.message, 500);

      const sha256Buffer = await crypto.subtle.digest('SHA-256', fileBuffer);
      const sha256Hex = Array.from(new Uint8Array(sha256Buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const docId = crypto.randomUUID();
      const { data: document, error: dbError } = await supabase
        .from('documents')
        .insert({
          id: docId,
          companyId,
          complianceItemId: complianceItemId || null,
          fileName,
          storageKey,
          storageDriver: 'supabase',
          mimeType,
          sizeBytes,
          sha256: sha256Hex,
          label: label || fileName,
          uploadedById: authCtx.userId,
          createdAt: new Date().toISOString(),
        })
        .select('*, uploadedBy:users(id, name, email)')
        .single();

      if (dbError) {
        // Storage Rollback: Delete uploaded file if DB record insertion fails
        await supabase.storage.from('compliance-evidence').remove([storageKey]);
        throw new AppError(dbError.message, 400);
      }

      return jsonResponse({ document, deduplicated: false }, 201);
    }

    // GET /documents/coverage/:companyId
    const coverageMatch = path.match(/^\/coverage\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && coverageMatch) {
      const companyId = coverageMatch[1];
      await assertCan(authCtx, companyId, 'documents.view');

      /**
       * Coverage is documents actually filed against obligations that ask for
       * one — the Udyam certificate, the GST return acknowledgement, the DIR-3
       * KYC receipt and so on.
       *
       * This counted neither. It divided by every obligation, and it read
       * "this rule requires evidence" as "this obligation has evidence", which
       * is the opposite of what it means — so a company with no documents at
       * all reported 60%, and the ten obligations it listed as missing evidence
       * were the ten that need none. Rewritten to match the Express
       * implementation in src/modules/documents/documents.service.ts.
       */
      const { data: items } = await supabase
        .from('compliance_items')
        .select('id, title, ruleCode, status, dueDate, evidenceRequired')
        .eq('companyId', companyId)
        .order('dueDate', { ascending: true });

      // Which obligations actually have a file attached. Counted from the
      // documents themselves rather than inferred from the rule.
      const { data: docs } = await supabase
        .from('documents')
        .select('complianceItemId')
        .eq('companyId', companyId)
        .not('complianceItemId', 'is', null);

      const documented = new Set(
        (docs || []).map((d: { complianceItemId: string }) => d.complianceItemId),
      );
      return jsonResponse(computeCoverage((items || []) as any, documented));
    }

    // GET /documents/:id/download -> Returns 5-minute Signed Download URL
    const downloadMatch = path.match(/^\/([a-f0-9-]+)\/download$/);
    if (req.method === 'GET' && downloadMatch) {
      const docId = downloadMatch[1];
      const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
      if (!doc) throw new NotFoundError('Document not found');

      await assertCan(authCtx, doc.companyId, 'documents.view');

      const { data: signedData, error } = await supabase.storage
        .from('compliance-evidence')
        .createSignedUrl(doc.storageKey, 300);

      if (error || !signedData) {
        throw new AppError(`Failed to generate signed download URL: ${error?.message}`, 502);
      }

      return jsonResponse({ kind: 'redirect', url: signedData.signedUrl, document: doc });
    }

    // DELETE /documents/:id
    const docIdMatch = path.match(/^\/([a-f0-9-]+)$/);
    if (req.method === 'DELETE' && docIdMatch) {
      const docId = docIdMatch[1];
      const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
      if (!doc) throw new NotFoundError('Document not found');

      await assertCan(authCtx, doc.companyId, 'documents.delete');

      // 1. Remove file from Supabase Storage
      await supabase.storage.from('compliance-evidence').remove([doc.storageKey]);

      // 2. Delete DB metadata record
      await supabase.from('documents').delete().eq('id', docId);

      return new Response(null, { status: 204 });
    }

    throw new BadRequestError(`No route matches ${req.method} ${path}`);
>>>>>>> origin/main_cloudmasa
  } catch (err) {
    res = errorResponse(err);
  }

  const origin = req.headers.get('origin');
  const dynamicCors = getCorsHeaders(origin);
  for (const [k, v] of Object.entries(dynamicCors)) {
    res.headers.set(k, v);
  }
  return res;
});
