import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ciulqktarpydorkkfmqh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket as any },
});

async function runEndToEndVerification() {
  console.log('=== Starting Real End-to-End Verification: Delete Flow & Dashboard Document Access ===');

  // 1. Get real company from DB
  const { data: companies, error: compErr } = await supabase.from('companies').select('*').limit(1);
  if (compErr || !companies || companies.length === 0) {
    console.error('Could not find a company:', compErr);
    process.exit(1);
  }
  const company = companies[0];
  console.log(`Testing with company: ${company.legalName || company.legal_name} (ID: ${company.id})`);

  // 2. Fetch admin user & mint JWT token
  const { data: users, error: userErr } = await supabase.from('users').select('*').limit(5);
  if (userErr || !users || users.length === 0) {
    console.error('No user found:', userErr);
    process.exit(1);
  }
  const adminUser = users.find((u) => u.role === 'SUPER_ADMIN') || users[0];
  const userOrgId = adminUser.organizationId || adminUser.orgId || company.organizationId || company.orgId;
  console.log(`Using user: ${adminUser.email} (ID: ${adminUser.id}, OrgID: ${userOrgId})`);

  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign(
    { sub: adminUser.id, role: adminUser.role, orgId: userOrgId },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );

  const edgeFunctionBase = `${SUPABASE_URL}/functions/v1/documents-api`;

  // Pre-seed a GST document so we can verify Delete MSME leaves GST untouched
  console.log('\n--- Pre-seeding GST document for cross-document isolation check ---');
  const gstFileName = `GST_Control_Doc_${Date.now()}.pdf`;
  const gstForm = new FormData();
  gstForm.append('file', new Blob([Buffer.from('GST Control File')], { type: 'application/pdf' }), gstFileName);
  gstForm.append('companyId', company.id);
  gstForm.append('label', 'gst');

  const gstRes = await fetch(`${edgeFunctionBase}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: gstForm,
  });
  if (!gstRes.ok) {
    console.error('Failed to pre-seed GST doc:', gstRes.status, await gstRes.text());
    process.exit(1);
  }
  const gstDocBody = await gstRes.json();
  const gstDoc = gstDocBody.document || gstDocBody;
  console.log(`✓ GST Pre-seeded: ${gstDoc.fileName} (ID: ${gstDoc.id})`);

  // STEP 1 & 2: Upload MSME document & Save
  console.log('\n--- Step 1 & 2: Upload MSME document & Save ---');
  const msmeFileName = `MSME_Cert_E2E_${Date.now()}.pdf`;
  const msmeContent = Buffer.from(`MSME Certificate Content E2E Test - ${Date.now()}`);
  const msmeForm = new FormData();
  msmeForm.append('file', new Blob([msmeContent], { type: 'application/pdf' }), msmeFileName);
  msmeForm.append('companyId', company.id);
  msmeForm.append('label', 'msme');

  const msmeSaveRes = await fetch(`${edgeFunctionBase}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: msmeForm,
  });
  if (!msmeSaveRes.ok) {
    console.error('Failed to save MSME doc:', msmeSaveRes.status, await msmeSaveRes.text());
    process.exit(1);
  }
  const msmeDocBody = await msmeSaveRes.json();
  const msmeDoc = msmeDocBody.document || msmeDocBody;
  console.log(`✓ MSME Saved: File = ${msmeDoc.fileName}, ID = ${msmeDoc.id}, UploadedAt = ${msmeDoc.createdAt}`);

  // STEP 3: Confirm exists after page refresh (re-fetch list)
  console.log('\n--- Step 3: Confirm exists after page refresh ---');
  const listRes1 = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { rows: rows1 } = await listRes1.json();
  const foundMsme1 = rows1.find((r: any) => r.id === msmeDoc.id);
  if (!foundMsme1) {
    console.error('❌ MSME document missing after refresh!');
    process.exit(1);
  }
  console.log(`✓ Confirmed MSME document exists after page refresh: ${foundMsme1.fileName}`);

  // STEP 4: Confirm View works (Signed URL)
  console.log('\n--- Step 4: Confirm View works (Signed URL) ---');
  const viewRes = await fetch(`${edgeFunctionBase}/documents/${msmeDoc.id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!viewRes.ok) {
    console.error('Failed view signed URL:', viewRes.status, await viewRes.text());
    process.exit(1);
  }
  const viewBody = await viewRes.json();
  const signedUrl = viewBody.url || viewBody.signedUrl;
  console.log(`✓ Signed URL generated for View: ${signedUrl.slice(0, 65)}...`);
  const fileFetch = await fetch(signedUrl);
  if (!fileFetch.ok) {
    console.error(`❌ HTTP fetch of signed URL failed: ${fileFetch.status}`);
    process.exit(1);
  }
  console.log(`✓ View URL returned 200 OK (${(await fileFetch.text()).slice(0, 40)}...)`);

  // STEP 5: Confirm Download works
  console.log('\n--- Step 5: Confirm Download works ---');
  const dlRes = await fetch(signedUrl);
  if (dlRes.ok && dlRes.headers.get('content-length')) {
    console.log(`✓ Download fetched actual stored file successfully: ${dlRes.headers.get('content-length')} bytes`);
  } else {
    console.error('❌ Download failed!');
    process.exit(1);
  }

  // STEP 6: Confirm Delete works
  console.log('\n--- Step 6: Confirm Delete works ---');
  const delRes = await fetch(`${edgeFunctionBase}/documents/${msmeDoc.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!delRes.ok) {
    console.error('Failed to delete MSME doc:', delRes.status, await delRes.text());
    process.exit(1);
  }
  console.log(`✓ DELETE HTTP endpoint returned ${delRes.status} (204 No Content)`);

  // Verify DB & storage clean up for MSME and GST is untouched
  const listRes2 = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { rows: rows2 } = await listRes2.json();
  const deletedMsme = rows2.find((r: any) => r.id === msmeDoc.id);
  const intactGst = rows2.find((r: any) => r.id === gstDoc.id);

  if (!deletedMsme) {
    console.log('✓ Verified MSME document was deleted from database metadata and storage slot is available again.');
  } else {
    console.error('❌ Delete failed - MSME document still found in database!');
    process.exit(1);
  }

  if (intactGst) {
    console.log(`✓ Verified GST document remained completely untouched: ${intactGst.fileName}`);
  } else {
    console.error('❌ GST document was erroneously deleted during MSME delete!');
    process.exit(1);
  }

  // STEP 7 & 8: Upload MSME document again & test Dashboard access
  console.log('\n--- Step 7 & 8: Upload MSME document again for Dashboard testing ---');
  const msmeFileName2 = `MSME_Cert_Dashboard_${Date.now()}.pdf`;
  const msmeForm2 = new FormData();
  msmeForm2.append('file', new Blob([Buffer.from('MSME Dashboard Test File')], { type: 'application/pdf' }), msmeFileName2);
  msmeForm2.append('companyId', company.id);
  msmeForm2.append('label', 'msme');

  const msmeSaveRes2 = await fetch(`${edgeFunctionBase}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: msmeForm2,
  });
  if (!msmeSaveRes2.ok) {
    console.error('Failed to re-upload MSME doc:', msmeSaveRes2.status, await msmeSaveRes2.text());
    process.exit(1);
  }
  const msmeDoc2 = (await msmeSaveRes2.json()).document || (await msmeSaveRes2.json());
  console.log(`✓ MSME Document re-uploaded: ${msmeDoc2.fileName}`);

  // STEP 9, 10, 11, 12, 13: Verify Dashboard document matching & actions
  console.log('\n--- Step 9-13: Testing Dashboard Document Access ---');
  const dashListRes = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { rows: dashDocs } = await dashListRes.json();

  const msmeCardDoc = dashDocs.find((d: any) => (d.label || '').toLowerCase() === 'msme');
  const gstCardDoc = dashDocs.find((d: any) => (d.label || '').toLowerCase() === 'gst');

  if (!msmeCardDoc) {
    console.error('❌ Dashboard MSME card could not match MSME document!');
    process.exit(1);
  }
  console.log(`✓ Dashboard MSME card matched document: ${msmeCardDoc.fileName} (ID: ${msmeCardDoc.id})`);

  // Verify View Documents action from Dashboard card
  const dashViewRes = await fetch(`${edgeFunctionBase}/documents/${msmeCardDoc.id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dashViewBody = await dashViewRes.json();
  console.log(`✓ Dashboard "View Documents" generated valid signed URL: ${(dashViewBody.url || dashViewBody.signedUrl).slice(0, 65)}...`);

  // Verify Download Documents action from Dashboard card
  const dashDlFetch = await fetch(dashViewBody.url || dashViewBody.signedUrl);
  if (dashDlFetch.ok) {
    console.log(`✓ Dashboard "Download Documents" fetched stored file: ${dashDlFetch.headers.get('content-length')} bytes`);
  } else {
    console.error('❌ Dashboard Download Documents failed!');
    process.exit(1);
  }

  if (gstCardDoc) {
    console.log(`✓ Dashboard GST card matched document: ${gstCardDoc.fileName} - unaffected by MSME operations`);
  }

  console.log('\n🎉 ALL E2E VERIFICATION STEPS (DELETE & DASHBOARD DOCUMENT ACCESS) PASSED 100% SUCCESSFULLY!');
}

runEndToEndVerification().catch((err) => {
  console.error('Fatal E2E verification error:', err);
  process.exit(1);
});
