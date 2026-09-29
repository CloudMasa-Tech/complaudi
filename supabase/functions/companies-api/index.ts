// supabase/functions/companies-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { assertCan, getAuthContext, requireCapability, seesEveryCompany } from '../_shared/auth.ts';
import { getSupabaseAdminClient, serialiseBigInt } from '../_shared/database.ts';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { parseJsonBody } from '../_shared/validation.ts';
// @ts-ignore
import { z } from 'https://esm.sh/zod@3.23.8';
import {
  decodeCsvBuffer,
  extractTextFromPdfBuffer,
  parseMcaMasterData,
  parseMcaMasterDataPdf,
  type McaParseResult,
} from '../_shared/mcaMasterData.ts';
import { extractGstInfo, extractUdyamInfo } from '../_shared/certificateExtractor.ts';
import { looksLikePdf, previewCompanyImport } from '../_shared/companyDocumentImport.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const path = (url.pathname
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/^\/companies/, '') || '/');
    const supabase = getSupabaseAdminClient();

    // ── Public Route: Logo ───────────────────────────────────────────────────
    const logoMatch = path.match(/^\/([a-f0-9-]+)\/logo$/);
    if (req.method === 'GET' && logoMatch) {
      const companyId = logoMatch[1];
      const { data: company } = await supabase.from('companies').select('logoStorageKey').eq('id', companyId).single();
      if (!company || !company.logoStorageKey) {
        return new Response('Not found', { status: 404 });
      }
      const { data: fileData, error } = await supabase.storage.from('compliance-evidence').download(company.logoStorageKey);
      if (error || !fileData) return new Response('Not found', { status: 404 });

      return new Response(fileData, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
      });
    }

    // ── Protected Routes ─────────────────────────────────────────────────────
    const authCtx = await getAuthContext(req);

    // POST /import-preview
    if (req.method === 'POST' && path === '/import-preview') {
      requireCapability(authCtx, 'company.create');
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) throw new BadRequestError('Attach the file under the "file" field of a multipart request.');
      const buffer = new Uint8Array(await file.arrayBuffer());
      const preview = previewCompanyImport(buffer);
      return jsonResponse({
        ...preview,
        fileName: file.name,
      });
    }

    // GET /companies
    if (req.method === 'GET' && (path === '' || path === '/')) {
      let query = supabase.from('companies').select('*, directors(*), gstRegistrations:gst_registrations(*), msmeRegistration:msme_registrations(*)');
      if (authCtx.role === 'SUPER_ADMIN') {
        // Super Admin sees all companies across the database
      } else if (authCtx.organizationId) {
        query = query.eq('organizationId', authCtx.organizationId);
      } else {
        const { data: userGrants } = await supabase.from('company_memberships').select('companyId').eq('userId', authCtx.userId);
        const companyIds = (userGrants || []).map((g) => g.companyId);
        query = query.in('id', companyIds);
      }

      const { data: companies, error } = await query.order('createdAt', { ascending: false });
      if (error) throw new AppError(error.message, 400);

      const userCapabilities = authCtx.role === 'SUPER_ADMIN' || authCtx.role === 'ADMIN'
        ? ['company.view', 'company.edit', 'company.archive', 'company.delete', 'company.sync', 'work.write', 'company.create']
        : authCtx.role === 'COMPANY_OWNER' || authCtx.role === 'CA'
        ? ['company.view', 'company.edit', 'company.sync', 'work.write']
        : ['company.view'];

      const result = (companies || []).map((c) => ({
        ...c,
        myCapabilities: userCapabilities,
      }));

      return jsonResponse(serialiseBigInt(result));
    }

    // POST /companies (Create Company)
    if (req.method === 'POST' && (path === '' || path === '/')) {
      requireCapability(authCtx, 'company.create');
      const schema = z.object({
        legalName: z.string().min(2).max(160),
        entityType: z.enum(['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'LLP', 'PARTNERSHIP', 'PROPRIETORSHIP', 'SECTION_8', 'UNREGISTERED']),
        stateCode: z.string().min(2).max(10),
        cin: z.string().max(21).optional().nullable(),
        pan: z.string().max(10).optional().nullable(),
        annualTurnover: z.coerce.number().default(0),
        employeeCount: z.coerce.number().default(0),
      });
      const body = await parseJsonBody(req, schema);

      const { data: newCompany, error } = await supabase
        .from('companies')
        .insert({
          organizationId: authCtx.organizationId,
          legalName: body.legalName,
          entityType: body.entityType,
          stateCode: body.stateCode,
          cin: body.cin || null,
          pan: body.pan || null,
          annualTurnover: body.annualTurnover,
          employeeCount: body.employeeCount,
          isActive: true,
        })
        .select()
        .single();

      if (error) throw new AppError(error.message, 400);

      // Auto-grant creator membership
      await supabase.from('company_memberships').insert({
        userId: authCtx.userId,
        companyId: newCompany.id,
        role: authCtx.role,
        grantedById: authCtx.userId,
      });

      return jsonResponse(serialiseBigInt({ company: newCompany }), 201);
    }

    // GET /companies/onboarded-overview
    if (req.method === 'GET' && path === '/onboarded-overview') {
      if (!seesEveryCompany(authCtx.role)) {
        throw new ForbiddenError('Only super admin can access onboarded overview');
      }
      const { data: rows } = await supabase
        .from('companies')
        .select('id, legalName, entityType, createdAt, organization:organizations(name)')
        .order('createdAt', { ascending: false });

      return jsonResponse(rows || []);
    }

    // Single Company operations
    const companyIdMatch = path.match(/^\/([a-f0-9-]+)$/);
    if (companyIdMatch) {
      const companyId = companyIdMatch[1];
      await assertCan(authCtx, companyId, 'company.view');

      // GET /companies/:id
      if (req.method === 'GET') {
        const { data: company, error } = await supabase
          .from('companies')
          .select('*, directors(*), gstRegistrations:gst_registrations(*), msmeRegistration:msme_registrations(*)')
          .eq('id', companyId)
          .single();

        if (error || !company) throw new NotFoundError('Company not found');

        const userCapabilities = authCtx.role === 'SUPER_ADMIN' || authCtx.role === 'ADMIN'
          ? ['company.view', 'company.edit', 'company.archive', 'company.delete', 'company.sync', 'work.write', 'company.create']
          : authCtx.role === 'COMPANY_OWNER' || authCtx.role === 'CA'
          ? ['company.view', 'company.edit', 'company.sync', 'work.write']
          : ['company.view'];

        const msmeRegistration = Array.isArray(company.msmeRegistration)
          ? (company.msmeRegistration[0] || null)
          : company.msmeRegistration;

        const fullCompany = {
          ...company,
          msmeRegistration,
          myCapabilities: userCapabilities,
        };

        return jsonResponse(serialiseBigInt(fullCompany));
      }

      // PATCH /companies/:id
      if (req.method === 'PATCH') {
        await assertCan(authCtx, companyId, 'company.edit');
        const schema = z.object({
          legalName: z.string().optional(),
          brandName: z.string().optional().nullable(),
          entityType: z.enum(['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'LLP', 'PARTNERSHIP', 'PROPRIETORSHIP', 'SECTION_8', 'UNREGISTERED']).optional(),
          businessType: z.enum(['SHOP_RETAIL', 'FREELANCER', 'PROFESSIONAL', 'FOOD_RESTAURANT', 'OTHER']).optional().nullable(),
          cin: z.string().optional().nullable(),
          llpin: z.string().optional().nullable(),
          pan: z.string().optional().nullable(),
          tan: z.string().optional().nullable(),
          incorporationDate: z.string().optional().nullable(),
          agmDate: z.string().optional().nullable(),
          stateCode: z.string().optional(),
          industry: z.string().optional().nullable(),
          employeeCount: z.coerce.number().optional(),
          annualTurnover: z.coerce.number().optional(),
          paidUpCapital: z.coerce.number().optional(),
          authorisedCapital: z.coerce.number().optional(),
          cashTransactionRatioBelow5Pct: z.boolean().optional(),
          hasForeignTransactions: z.boolean().optional(),
          acceptsDeposits: z.boolean().optional(),
          isListed: z.boolean().optional(),
          buysFromMsmeSuppliers: z.boolean().optional(),
          dpiitRecognitionNumber: z.string().optional().nullable(),
          dpiitRecognisedOn: z.string().optional().nullable(),
          epfoCode: z.string().optional().nullable(),
          esicCode: z.string().optional().nullable(),
          shopAndEstablishment: z.string().optional().nullable(),
          fssaiNumber: z.string().optional().nullable(),
          professionalTax: z.string().optional().nullable(),
          tradeLicense: z.string().optional().nullable(),
          registeredAddress: z.string().optional().nullable(),
          companyStatus: z.string().optional().nullable(),
          companyCategory: z.string().optional().nullable(),
          companySubCategory: z.string().optional().nullable(),
          companyClass: z.string().optional().nullable(),
        });
        const body = await parseJsonBody(req, schema);

        if (body.cin && typeof body.cin === 'string' && body.cin.trim()) {
          const cleanCin = body.cin.trim().toUpperCase();
          const { data: existingComp } = await supabase
            .from('companies')
            .select('id')
            .eq('cin', cleanCin)
            .neq('id', companyId)
            .maybeSingle();
          if (existingComp) {
            throw new BadRequestError(`CIN ${cleanCin} is already registered to another company in Complaudi.`);
          }
        }

        const { data: updated, error } = await supabase
          .from('companies')
          .update(body)
          .eq('id', companyId)
          .select('*, directors(*), gstRegistrations:gst_registrations(*), msmeRegistration:msme_registrations(*)')
          .single();

        if (error) throw new AppError(error.message, 400);

        const msmeRegistration = Array.isArray(updated.msmeRegistration)
          ? (updated.msmeRegistration[0] || null)
          : updated.msmeRegistration;

        return jsonResponse(serialiseBigInt({
          company: { ...updated, msmeRegistration },
          sync: { applicableRules: 0, inapplicableRules: 0, created: 0, updated: 0, removed: 0 }
        }));
      }

      // DELETE /companies/:id (Archive)
      if (req.method === 'DELETE') {
        await assertCan(authCtx, companyId, 'company.archive');
        const { data: archived, error } = await supabase
          .from('companies')
          .update({ isActive: false })
          .eq('id', companyId)
          .select()
          .single();

        if (error) throw new AppError(error.message, 400);
        return jsonResponse(serialiseBigInt(archived));
      }
    }

    // POST /companies/:id/restore
    const restoreMatch = path.match(/^\/([a-f0-9-]+)\/restore$/);
    if (req.method === 'POST' && restoreMatch) {
      const companyId = restoreMatch[1];
      await assertCan(authCtx, companyId, 'company.archive');
      const { data: restored, error } = await supabase
        .from('companies')
        .update({ isActive: true })
        .eq('id', companyId)
        .select()
        .single();

      if (error) throw new AppError(error.message, 400);
      return jsonResponse(serialiseBigInt(restored));
    }

    // GET /companies/:id/members
    const membersMatch = path.match(/^\/([a-f0-9-]+)\/members$/);
    if (req.method === 'GET' && membersMatch) {
      const companyId = membersMatch[1];
      await assertCan(authCtx, companyId, 'company.view');

      const { data: memberships } = await supabase
        .from('company_memberships')
        .select('*')
        .eq('companyId', companyId);

      if (!memberships || memberships.length === 0) {
        return jsonResponse([]);
      }

      const userIds = Array.from(new Set(memberships.map((m: any) => m.userId).concat(memberships.map((m: any) => m.grantedById).filter(Boolean))));
      const { data: userProfiles } = await supabase
        .from('users')
        .select('id, name, email, isActive')
        .in('id', userIds);

      const userMap = new Map<string, any>((userProfiles || []).map((u: any) => [u.id, u]));

      const rows = memberships.map((m: any) => {
        const u = userMap.get(m.userId);
        const g = userMap.get(m.grantedById);
        return {
          role: m.role,
          since: m.createdAt,
          member: {
            id: u?.id || m.userId,
            name: u?.name || 'Team Member',
            email: u?.email || '',
            isActive: u?.isActive ?? true,
          },
          invitedBy: {
            id: g?.id || m.grantedById || '',
            name: g?.name || 'Owner',
          },
          invitationStatus: u?.isActive ? 'ACTIVE' : 'PENDING',
        };
      });

      return jsonResponse(rows);
    }

    // POST /companies/:id/invite
    const inviteMatch = path.match(/^\/([a-f0-9-]+)\/invite$/);
    if (req.method === 'POST' && inviteMatch) {
      const companyId = inviteMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      const schema = z.object({
        name: z.string().min(2).max(120),
        email: z.string().email().toLowerCase(),
        role: z.enum(['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER']).default('CA'),
      });
      const body = await parseJsonBody(req, schema);

      let { data: targetUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', body.email)
        .maybeSingle();

      if (!targetUser) {
        const tempPassword = `Temp@${crypto.randomUUID().slice(0, 8)}`;
        const { data: newAuthUser, error: authErr } = await supabase.auth.admin.createUser({
          email: body.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { name: body.name },
        });

        if (authErr || !newAuthUser.user) {
          throw new AppError(`User invitation failed: ${authErr?.message || 'User creation error'}`, 400);
        }

        const { data: newUser, error: dbErr } = await supabase
          .from('users')
          .insert({
            id: newAuthUser.user.id,
            organizationId: authCtx.organizationId,
            email: body.email,
            passwordHash: 'SUPABASE_AUTH_MANAGED',
            name: body.name,
            role: body.role,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .select()
          .single();

        if (dbErr) throw new AppError(dbErr.message, 400);
        targetUser = newUser;
      }

      const { data: membership, error: memErr } = await supabase
        .from('company_memberships')
        .upsert({
          id: crypto.randomUUID(),
          userId: targetUser.id,
          companyId,
          role: body.role,
          grantedById: authCtx.userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, { onConflict: 'userId,companyId' })
        .select()
        .single();

      if (memErr) throw new AppError(memErr.message, 400);

      const result = {
        role: body.role,
        since: membership.createdAt || new Date().toISOString(),
        member: {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          isActive: targetUser.isActive,
        },
        invitedBy: {
          id: authCtx.userId,
          name: authCtx.name,
        },
        invitationStatus: targetUser.isActive ? 'ACTIVE' : 'PENDING',
      };

      return jsonResponse(result, 201);
    }

    // GET /companies/:id/deletion-impact
    const deletionImpactMatch = path.match(/^\/([a-f0-9-]+)\/deletion-impact$/);
    if (req.method === 'GET' && deletionImpactMatch) {
      const companyId = deletionImpactMatch[1];
      await assertCan(authCtx, companyId, 'company.view');

      const { data: comp, error: compErr } = await supabase
        .from('companies')
        .select('id, legalName, isActive')
        .eq('id', companyId)
        .single();

      if (compErr || !comp) throw new NotFoundError('Company not found');

      const [{ count: items }, { count: completed }, { count: documents }, { count: tasks }] = await Promise.all([
        supabase.from('compliance_items').select('*', { count: 'exact', head: true }).eq('companyId', companyId),
        supabase.from('compliance_items').select('*', { count: 'exact', head: true }).eq('companyId', companyId).eq('status', 'COMPLETED'),
        supabase.from('documents').select('*', { count: 'exact', head: true }).eq('companyId', companyId),
        supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('companyId', companyId),
      ]);

      return jsonResponse({
        company: { id: comp.id, legalName: comp.legalName, isActive: comp.isActive },
        items: items || 0,
        completed: completed || 0,
        documents: documents || 0,
        tasks: tasks || 0,
      });
    }

    // POST /companies/:id/permanent-delete
    const permDeleteMatch = path.match(/^\/([a-f0-9-]+)\/permanent-delete$/);
    if (req.method === 'POST' && permDeleteMatch) {
      const companyId = permDeleteMatch[1];
      await assertCan(authCtx, companyId, 'company.archive');
      const schema = z.object({ confirmation: z.string().min(1) });
      const body = await parseJsonBody(req, schema);

      const { data: rpcResult, error } = await supabase.rpc('fn_delete_company_permanently', {
        p_company_id: companyId,
        p_confirmation_name: body.confirmation,
      });

      if (error) throw new AppError(error.message, 400);
      return jsonResponse({ deleted: true, impact: rpcResult });
    }

    // POST /companies/:id/import-mca
    const importMcaMatch = path.match(/^\/([a-f0-9-]+)\/import-mca$/);
    if (req.method === 'POST' && importMcaMatch) {
      const companyId = importMcaMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) throw new BadRequestError('Attach the file under the "file" field of a multipart request.');
      const buffer = new Uint8Array(await file.arrayBuffer());

      let parsed: McaParseResult;
      if (looksLikePdf(buffer)) {
        const text = extractTextFromPdfBuffer(buffer);
        parsed = parseMcaMasterDataPdf(text);
      } else {
        const csv = decodeCsvBuffer(buffer);
        parsed = parseMcaMasterData(csv);
      }

      if (parsed.records.length === 0) {
        const message = parsed.unrecognisedColumns.length > 0
          ? `No data could be extracted from this file (saw headers: ${parsed.unrecognisedColumns.join(', ')}). Nothing was changed.`
          : 'No data could be extracted from this file — nothing was changed.';

        return jsonResponse(serialiseBigInt({
          matchedBy: 'none',
          applied: [],
          skipped: [],
          warnings: [message],
          recognisedColumns: parsed.recognisedColumns || [],
          unrecognisedColumns: parsed.unrecognisedColumns || [],
          rowsInFile: parsed.rowCount || 0,
          sync: { applicableRules: 0, inapplicableRules: 0, created: 0, updated: 0, removed: 0 },
        }));
      }

      const { data: company, error: getErr } = await supabase.from('companies').select('*').eq('id', companyId).single();
      if (getErr || !company) throw new NotFoundError('Company not found');

      const byCin = company.cin ? parsed.records.find((r) => r.cin === company.cin) : undefined;
      const record = byCin ?? (parsed.records.length === 1 ? parsed.records[0]! : parsed.records[0]!);

      const warnings: string[] = [];
      if (!record.cin) {
        warnings.push('No CIN found in file — existing company CIN in database was left unchanged.');
      }

      const applied: Array<{ field: string; from: string | null; to: string }> = [];
      const skipped: Array<{ field: string; why: string }> = [];
      const updatePayload: Record<string, unknown> = {};

      const take = <T>(
        field: string,
        incoming: T | null,
        current: unknown,
        write: (v: T) => void,
        show: (v: T) => string = (v) => String(v)
      ) => {
        if (incoming === null || incoming === undefined || incoming === '') {
          skipped.push({ field, why: 'not present in the file' });
          return;
        }
        const before = current === null || current === undefined ? null : show(current as T);
        const after = show(incoming);
        if (before === after) return;
        write(incoming);
        applied.push({ field, from: before, to: after });
      };

      // EXPLICIT TIER 3 RULE: Only assign cin if non-empty; never overwrite DB CIN with null/blank
      take('cin', record.cin, company.cin, (v) => {
        if (v && typeof v === 'string' && v.trim().length > 0) {
          updatePayload.cin = v.trim().toUpperCase();
        }
      });
      take('legalName', record.name, company.legalName, (v) => { updatePayload.legalName = v; });
      take(
        'incorporationDate',
        record.incorporatedOn ? record.incorporatedOn.toISOString().slice(0, 10) : null,
        company.incorporationDate ? String(company.incorporationDate).slice(0, 10) : null,
        (v) => { updatePayload.incorporationDate = v; }
      );
      take('stateCode', record.stateCode, company.stateCode, (v) => { updatePayload.stateCode = v; });
      take('entityType', record.entityType, company.entityType, (v) => { updatePayload.entityType = v; });
      take('industry', record.industry, company.industry, (v) => { updatePayload.industry = v; });
      take('paidUpCapital', record.paidUpCapital, company.paidUpCapital, (v) => { updatePayload.paidUpCapital = v; });
      take('authorisedCapital', record.authorisedCapital, company.authorisedCapital, (v) => { updatePayload.authorisedCapital = v; });
      take('registeredAddress', record.address, company.registeredAddress, (v) => { updatePayload.registeredAddress = v; });
      take('companyStatus', record.status, company.companyStatus, (v) => { updatePayload.companyStatus = v; });
      take('companyCategory', record.companyCategory, company.companyCategory, (v) => { updatePayload.companyCategory = v; });
      take('companySubCategory', record.companySubCategory, company.companySubCategory, (v) => { updatePayload.companySubCategory = v; });
      take('companyClass', record.companyClass, company.companyClass, (v) => { updatePayload.companyClass = v; });

      if (Object.keys(updatePayload).length > 0) {
        await supabase.from('companies').update(updatePayload).eq('id', companyId);
      }

      let directorsAdded = 0;
      if (record.directors && record.directors.length > 0) {
        const { data: existingDirs } = await supabase.from('directors').select('*').eq('companyId', companyId);
        for (const dir of record.directors) {
          if (!dir.name) continue;
          const match = dir.din
            ? (existingDirs || []).find((e: any) => e.din === dir.din)
            : (existingDirs || []).find((e: any) => e.name?.toLowerCase() === dir.name?.toLowerCase());

          const dirPayload = {
            name: dir.name,
            designation: dir.designation || 'Director',
            status: dir.status || null,
            ...(dir.din ? { din: dir.din } : {}),
            ...(dir.appointedOn ? { appointedOn: dir.appointedOn.toISOString().slice(0, 10) } : {}),
          };

          if (match) {
            await supabase.from('directors').update(dirPayload).eq('id', match.id);
          } else {
            await supabase.from('directors').insert({ id: crypto.randomUUID(), companyId, ...dirPayload });
            directorsAdded++;
          }
        }
        if (directorsAdded > 0) {
          applied.push({ field: 'directors', from: null, to: `Added ${directorsAdded} directors from Signatory Details` });
        }
      }

      return jsonResponse(serialiseBigInt({
        matchedBy: byCin ? 'cin' : 'selected-company',
        applied,
        skipped,
        warnings,
        recognisedColumns: parsed.recognisedColumns,
        unrecognisedColumns: parsed.unrecognisedColumns,
        rowsInFile: parsed.rowCount,
        sync: { applicableRules: 0, inapplicableRules: 0, created: 0, updated: 0, removed: 0 },
      }));
    }

    // POST /companies/:id/import-gst
    const importGstMatch = path.match(/^\/([a-f0-9-]+)\/import-gst$/);
    if (req.method === 'POST' && importGstMatch) {
      const companyId = importGstMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) throw new BadRequestError('Attach the PDF under the "file" field of a multipart request.');
      const buffer = new Uint8Array(await file.arrayBuffer());

      const text = extractTextFromPdfBuffer(buffer);
      const info = extractGstInfo(text);

      const storageKey = `${authCtx.organizationId || 'default'}/${companyId}/gst-${file.name}`;
      await supabase.storage.from('compliance-evidence').upload(storageKey, buffer, { upsert: true, contentType: file.type || 'application/pdf' });

      if (info.gstin) {
        const { data: existing } = await supabase.from('gst_registrations').select('id').eq('companyId', companyId).eq('gstin', info.gstin).maybeSingle();
        if (existing) {
          await supabase.from('gst_registrations').update({
            certificateKey: storageKey,
            legalName: info.legalName || null,
            tradeName: info.tradeName || null,
            constitution: info.constitution || null,
            registeredOn: info.registeredOn || null,
          }).eq('id', existing.id);
        } else {
          await supabase.from('gst_registrations').insert({
            id: crypto.randomUUID(),
            companyId,
            gstin: info.gstin,
            stateCode: info.stateCode || info.gstin.slice(0, 2),
            legalName: info.legalName || null,
            tradeName: info.tradeName || null,
            constitution: info.constitution || null,
            registeredOn: info.registeredOn || null,
            certificateKey: storageKey,
            filingFrequency: 'MONTHLY',
            isActive: true,
          });
        }
      }

      return jsonResponse({ extracted: info, sync: { applicableRules: 0 } });
    }

    // POST /companies/:id/import-udyam
    const importUdyamMatch = path.match(/^\/([a-f0-9-]+)\/import-udyam$/);
    if (req.method === 'POST' && importUdyamMatch) {
      const companyId = importUdyamMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) throw new BadRequestError('Attach the PDF under the "file" field of a multipart request.');
      const buffer = new Uint8Array(await file.arrayBuffer());

      const text = extractTextFromPdfBuffer(buffer);
      const info = extractUdyamInfo(text);

      const storageKey = `${authCtx.organizationId || 'default'}/${companyId}/udyam-${file.name}`;
      await supabase.storage.from('compliance-evidence').upload(storageKey, buffer, { upsert: true, contentType: file.type || 'application/pdf' });

      if (info.udyamNumber) {
        const { data: existing } = await supabase.from('msme_registrations').select('id').eq('companyId', companyId).maybeSingle();
        const categoryVal = (info.organisationType as any) || 'MICRO';
        if (existing) {
          await supabase.from('msme_registrations').update({
            certificateKey: storageKey,
            udyamNumber: info.udyamNumber,
            category: categoryVal,
            enterpriseName: info.enterpriseName || null,
            majorActivity: info.majorActivity || null,
            socialCategory: info.socialCategory || null,
            registeredOn: info.registeredOn || null,
          }).eq('id', existing.id);
        } else {
          await supabase.from('msme_registrations').insert({
            id: crypto.randomUUID(),
            companyId,
            udyamNumber: info.udyamNumber,
            category: categoryVal,
            enterpriseName: info.enterpriseName || null,
            majorActivity: info.majorActivity || null,
            socialCategory: info.socialCategory || null,
            registeredOn: info.registeredOn || null,
            certificateKey: storageKey,
          });
        }
      }

      return jsonResponse({ extracted: info, sync: { applicableRules: 0 } });
    }

    // POST & DELETE /companies/:id/logo
    const logoActionMatch = path.match(/^\/([a-f0-9-]+)\/logo$/);
    if (logoActionMatch && req.method !== 'GET') {
      const companyId = logoActionMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      if (req.method === 'POST') {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) throw new BadRequestError('Attach the logo under the "file" field.');
        const buffer = new Uint8Array(await file.arrayBuffer());

        const { data: company } = await supabase.from('companies').select('organizationId, logoStorageKey').eq('id', companyId).single();
        if (!company) throw new NotFoundError('Company not found');

        const storageKey = `${company.organizationId || 'default'}/${companyId}/logo-${file.name}`;
        await supabase.storage.from('compliance-evidence').upload(storageKey, buffer, { upsert: true, contentType: file.type || 'image/png' });

        await supabase.from('companies').update({ logoStorageKey: storageKey }).eq('id', companyId);
        return jsonResponse({ url: `/functions/v1/companies-api/companies/${companyId}/logo` });
      }

      if (req.method === 'DELETE') {
        const { data: company } = await supabase.from('companies').select('logoStorageKey').eq('id', companyId).single();
        if (company && company.logoStorageKey) {
          try {
            await supabase.storage.from('compliance-evidence').remove([company.logoStorageKey]);
          } catch (_e) {}
          await supabase.from('companies').update({ logoStorageKey: null }).eq('id', companyId);
        }
        return new Response(null, { status: 204 });
      }
    }

    // POST /companies/:id/directors
    const directorMatch = path.match(/^\/([a-f0-9-]+)\/directors$/);
    if (req.method === 'POST' && directorMatch) {
      const companyId = directorMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');
      const schema = z.object({
        name: z.string().min(2),
        din: z.string().optional().nullable(),
        designation: z.string().default('Director'),
      });
      const body = await parseJsonBody(req, schema);

      const { data: director, error } = await supabase
        .from('directors')
        .insert({ companyId, name: body.name, din: body.din || null, designation: body.designation })
        .select()
        .single();

      if (error) throw new AppError(error.message, 400);
      return jsonResponse(director, 201);
    }

    // PATCH & DELETE /companies/:id/directors/:childId
    const directorChildMatch = path.match(/^\/([a-f0-9-]+)\/directors\/([a-f0-9-]+)$/);
    if (directorChildMatch) {
      const companyId = directorChildMatch[1];
      const directorId = directorChildMatch[2];
      await assertCan(authCtx, companyId, 'company.edit');

      if (req.method === 'PATCH') {
        const body = await parseJsonBody(req, z.object({
          name: z.string().optional(),
          din: z.string().optional().nullable(),
          designation: z.string().optional(),
          dscExpiresOn: z.string().optional().nullable(),
          resignedOn: z.string().optional().nullable(),
        }));
        const { data: updated, error } = await supabase.from('directors').update(body).eq('id', directorId).select().single();
        if (error) throw new AppError(error.message, 400);
        return jsonResponse(serialiseBigInt(updated));
      }

      if (req.method === 'DELETE') {
        await supabase.from('directors').delete().eq('id', directorId);
        return jsonResponse({ deleted: true });
      }
    }

    // PUT & DELETE /companies/:id/msme-registration
    const msmeMatch = path.match(/^\/([a-f0-9-]+)\/msme-registration$/);
    if (msmeMatch) {
      const companyId = msmeMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      if (req.method === 'PUT') {
        const schema = z.object({
          udyamNumber: z.string().min(1),
          category: z.enum(['MICRO', 'SMALL', 'MEDIUM']).default('MICRO'),
          registeredOn: z.string().optional().nullable(),
        });
        const body = await parseJsonBody(req, schema);

        const { data: existing } = await supabase.from('msme_registrations').select('id').eq('companyId', companyId).maybeSingle();

        let msmeRow;
        if (existing) {
          const { data, error } = await supabase.from('msme_registrations')
            .update({ udyamNumber: body.udyamNumber, category: body.category, registeredOn: body.registeredOn || null })
            .eq('id', existing.id).select().single();
          if (error) throw new AppError(error.message, 400);
          msmeRow = data;
        } else {
          const { data, error } = await supabase.from('msme_registrations')
            .insert({ id: crypto.randomUUID(), companyId, udyamNumber: body.udyamNumber, category: body.category, registeredOn: body.registeredOn || null })
            .select().single();
          if (error) throw new AppError(error.message, 400);
          msmeRow = data;
        }

        return jsonResponse(serialiseBigInt({ registration: msmeRow }));
      }

      if (req.method === 'DELETE') {
        await supabase.from('msme_registrations').delete().eq('companyId', companyId);
        return jsonResponse({ deleted: true });
      }
    }

    // POST /companies/:id/gst-registrations
    const gstListMatch = path.match(/^\/([a-f0-9-]+)\/gst-registrations$/);
    if (req.method === 'POST' && gstListMatch) {
      const companyId = gstListMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');
      const schema = z.object({
        gstin: z.string().length(15),
        stateCode: z.string().min(2),
        filingFrequency: z.enum(['MONTHLY', 'QRMP', 'COMPOSITION', 'QUARTERLY']).default('MONTHLY'),
        legalName: z.string().optional().nullable(),
        tradeName: z.string().optional().nullable(),
        constitution: z.string().optional().nullable(),
        registeredOn: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
      });
      const body = await parseJsonBody(req, schema);

      const { data: reg, error } = await supabase.from('gst_registrations')
        .insert({
          id: crypto.randomUUID(),
          companyId,
          gstin: body.gstin,
          stateCode: body.stateCode,
          legalName: body.legalName || null,
          tradeName: body.tradeName || null,
          constitution: body.constitution || null,
          registeredOn: body.registeredOn || null,
          filingFrequency: body.filingFrequency,
          isActive: body.isActive ?? true,
        })
        .select().single();

      if (error) throw new AppError(error.message, 400);
      return jsonResponse(serialiseBigInt({ registration: reg }), 201);
    }

    // PATCH & DELETE /companies/:id/gst-registrations/:childId
    const gstChildMatch = path.match(/^\/([a-f0-9-]+)\/gst-registrations\/([a-f0-9-]+)$/);
    if (gstChildMatch) {
      const companyId = gstChildMatch[1];
      const gstId = gstChildMatch[2];
      await assertCan(authCtx, companyId, 'company.edit');

      if (req.method === 'PATCH') {
        const body = await parseJsonBody(req, z.object({
          filingFrequency: z.enum(['MONTHLY', 'QUARTERLY']).optional(),
          isActive: z.boolean().optional(),
        }));
        const { data: updated, error } = await supabase.from('gst_registrations').update(body).eq('id', gstId).select().single();
        if (error) throw new AppError(error.message, 400);
        return jsonResponse(serialiseBigInt({ registration: updated }));
      }

      if (req.method === 'DELETE') {
        await supabase.from('gst_registrations').delete().eq('id', gstId);
        return jsonResponse({ deleted: true });
      }
    }

    // GET & POST /companies/:id/events
    const eventsMatch = path.match(/^\/([a-f0-9-]+)\/events$/);
    if (eventsMatch) {
      const companyId = eventsMatch[1];
      await assertCan(authCtx, companyId, 'company.view');

      if (req.method === 'GET') {
        const { data: events } = await supabase.from('company_events').select('*').eq('companyId', companyId).order('eventDate', { ascending: false });
        return jsonResponse(events || []);
      }

      if (req.method === 'POST') {
        await assertCan(authCtx, companyId, 'company.edit');
        const schema = z.object({
          eventType: z.string(),
          eventDate: z.string(),
          metadata: z.record(z.unknown()).optional(),
        });
        const body = await parseJsonBody(req, schema);
        const { data: event, error } = await supabase.from('company_events')
          .insert({ id: crypto.randomUUID(), companyId, eventType: body.eventType, eventDate: body.eventDate, metadata: body.metadata || {} })
          .select().single();
        if (error) throw new AppError(error.message, 400);
        return jsonResponse({ event }, 201);
      }
    }

    throw new BadRequestError(`No route matches ${req.method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
});
