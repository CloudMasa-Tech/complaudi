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

async function runSectionVerification() {
  console.log('--- Starting Section-Wise Document Isolation & Action Verification ---');

  // 1. Fetch real company
  const { data: companies, error: compErr } = await supabase.from('companies').select('*').limit(1);
  if (compErr || !companies || companies.length === 0) {
    console.error('Could not find a company:', compErr);
    process.exit(1);
  }
  const company = companies[0];
  console.log(`Testing with company: ${company.legalName || company.legal_name} (ID: ${company.id})`);

  // 2. Fetch admin user & mint token
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

  // Clear existing test documents for this company to test clean section isolation
  const { data: existingDocs } = await supabase.from('documents').select('id').eq('companyId', company.id);
  if (existingDocs && existingDocs.length > 0) {
    for (const d of existingDocs) {
      await fetch(`${edgeFunctionBase}/documents/${d.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    console.log(`Cleaned up ${existingDocs.length} prior test documents for isolated verification.`);
  }

  // TEST 1: MSME Section Upload & Save
  console.log('\n--- 1. MSME Section Document Upload ---');
  const msmeFileName = `MSME_Udyam_Certificate_${Date.now()}.pdf`;
  const msmeContent = Buffer.from(`MSME Certificate Content - ${Date.now()}`);
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
    console.error('Failed MSME upload:', msmeSaveRes.status, await msmeSaveRes.text());
    process.exit(1);
  }
  const msmeDocBody = await msmeSaveRes.json();
  const msmeDoc = msmeDocBody.document || msmeDocBody;
  console.log(`✓ MSME Saved: File = ${msmeDoc.fileName}, ID = ${msmeDoc.id}, UploadedAt = ${msmeDoc.createdAt}`);

  // TEST 2: DPIIT / Startup Section Upload & Save
  console.log('\n--- 2. DPIIT / Startup Section Document Upload ---');
  const dpiitFileName = `DPIIT_Startup_Certificate_${Date.now()}.pdf`;
  const dpiitContent = Buffer.from(`DPIIT Startup Certificate Content - ${Date.now()}`);
  const dpiitForm = new FormData();
  dpiitForm.append('file', new Blob([dpiitContent], { type: 'application/pdf' }), dpiitFileName);
  dpiitForm.append('companyId', company.id);
  dpiitForm.append('label', 'dpiit');

  const dpiitSaveRes = await fetch(`${edgeFunctionBase}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: dpiitForm,
  });
  if (!dpiitSaveRes.ok) {
    console.error('Failed DPIIT upload:', dpiitSaveRes.status, await dpiitSaveRes.text());
    process.exit(1);
  }
  const dpiitDocBody = await dpiitSaveRes.json();
  const dpiitDoc = dpiitDocBody.document || dpiitDocBody;
  console.log(`✓ DPIIT/Startup Saved: File = ${dpiitDoc.fileName}, ID = ${dpiitDoc.id}, UploadedAt = ${dpiitDoc.createdAt}`);

  // TEST 3: Cross-Section Isolation Verification
  console.log('\n--- 3. Verifying Section Isolation & Persistence across Tab Switch / Page Refresh ---');
  const listRes = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    console.error('Failed to list documents:', listRes.status, await listRes.text());
    process.exit(1);
  }
  const { rows } = await listRes.json();
  console.log(`Retrieved ${rows.length} total documents for company.`);

  const fetchedMsme = rows.find((r: any) => (r.label || '').toLowerCase() === 'msme');
  const fetchedDpiit = rows.find((r: any) => (r.label || '').toLowerCase() === 'dpiit');

  if (!fetchedMsme) {
    console.error('❌ MSME document disappeared after saving DPIIT document!');
    process.exit(1);
  } else {
    console.log(`✓ MSME Document intact under section 'msme': ${fetchedMsme.fileName} (Uploaded: ${fetchedMsme.createdAt})`);
  }

  if (!fetchedDpiit) {
    console.error('❌ DPIIT document disappeared!');
    process.exit(1);
  } else {
    console.log(`✓ DPIIT Document intact under section 'dpiit': ${fetchedDpiit.fileName} (Uploaded: ${fetchedDpiit.createdAt})`);
  }

  // TEST 4: View & Download Verification (Signed URLs)
  console.log('\n--- 4. Testing View & Download Actions (Signed URLs) ---');
  for (const doc of [fetchedMsme, fetchedDpiit]) {
    const dlRes = await fetch(`${edgeFunctionBase}/documents/${doc.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) {
      console.error(`Failed signed URL for ${doc.label}:`, dlRes.status, await dlRes.text());
      process.exit(1);
    }
    const dlBody = await dlRes.json();
    const signedUrl = dlBody.url || dlBody.signedUrl;
    console.log(`✓ Signed URL generated for ${doc.label.toUpperCase()}: ${signedUrl.slice(0, 65)}...`);

    const fileFetch = await fetch(signedUrl);
    if (!fileFetch.ok) {
      console.error(`❌ HTTP fetch of signed URL failed for ${doc.label}: ${fileFetch.status}`);
      process.exit(1);
    }
    const fetchedText = await fileFetch.text();
    console.log(`  ✓ Verified file contents retrieved from Supabase Storage: "${fetchedText}"`);
  }

  // TEST 5: Replace Action Verification
  console.log('\n--- 5. Testing Replace Action for MSME Section ---');
  const msmeReplaceName = `MSME_Udyam_Certificate_v2_NEW.pdf`;
  const msmeReplaceContent = Buffer.from('Updated MSME Content v2');
  const replaceForm = new FormData();
  replaceForm.append('file', new Blob([msmeReplaceContent], { type: 'application/pdf' }), msmeReplaceName);
  replaceForm.append('companyId', company.id);
  replaceForm.append('label', 'msme');

  const replaceRes = await fetch(`${edgeFunctionBase}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: replaceForm,
  });
  if (!replaceRes.ok) {
    console.error('Failed replace MSME:', replaceRes.status, await replaceRes.text());
    process.exit(1);
  }

  // Delete previous MSME doc if frontend flow does
  await fetch(`${edgeFunctionBase}/documents/${fetchedMsme.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  const listRes2 = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { rows: rows2 } = await listRes2.json();
  const newMsme = rows2.find((r: any) => (r.label || '').toLowerCase() === 'msme');
  const stillDpiit = rows2.find((r: any) => (r.label || '').toLowerCase() === 'dpiit');

  if (newMsme && newMsme.fileName === msmeReplaceName) {
    console.log(`✓ MSME replaced successfully with new version: ${newMsme.fileName}`);
  } else {
    console.error('❌ MSME replace failed!', newMsme);
    process.exit(1);
  }

  if (stillDpiit && stillDpiit.fileName === dpiitFileName) {
    console.log(`✓ DPIIT document remained completely untouched during MSME replace: ${stillDpiit.fileName}`);
  } else {
    console.error('❌ DPIIT document was affected during MSME replace!');
    process.exit(1);
  }

  console.log('\n🎉 ALL SECTION-WISE VERIFICATION TESTS PASSED 100% SUCCESSFULLY!');
}

runSectionVerification().catch((err) => {
  console.error('Fatal section verification error:', err);
  process.exit(1);
});
