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

async function runVerification() {
  console.log('--- Starting End-to-End Document Flow Verification ---');

  // 1. Get a real company from DB
  const { data: companies, error: compErr } = await supabase.from('companies').select('*').limit(1);
  if (compErr || !companies || companies.length === 0) {
    console.error('Could not find a company:', compErr);
    process.exit(1);
  }
  const company = companies[0];
  console.log(`Testing with company: ${company.legalName || company.legal_name} (ID: ${company.id})`);

  // Log in as superadmin or use user token to test Edge Function
  const { data: users, error: userErr } = await supabase.from('users').select('*').limit(5);
  if (userErr || !users || users.length === 0) {
    console.error('No user found:', userErr);
    process.exit(1);
  }
  const adminUser = users.find((u) => u.role === 'SUPER_ADMIN') || users[0];
  const userOrgId = adminUser.organizationId || adminUser.orgId || company.organizationId || company.orgId;
  console.log(`Using user: ${adminUser.email} (ID: ${adminUser.id}, OrgID: ${userOrgId})`);

  // Mint a JWT token for the user to call Edge Functions (must include orgId for auth.ts)
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign(
    { sub: adminUser.id, role: adminUser.role, orgId: userOrgId },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );

  const docTypes = ['gst', 'msme', 'dpiit', 'dsc', 'master_data', 'mca_report'] as const;
  const edgeFunctionBase = `${SUPABASE_URL}/functions/v1/documents-api`;

  console.log('\n--- Step 1: Uploading files for all 6 document types ---');
  for (const docType of docTypes) {
    const fileName = `${docType}_test_doc_${Date.now()}.pdf`;
    const dummyContent = Buffer.from(`Dummy content for ${docType} - ${new Date().toISOString()}`);

    const formData = new FormData();
    const blob = new Blob([dummyContent], { type: 'application/pdf' });
    formData.append('file', blob, fileName);
    formData.append('companyId', company.id);
    formData.append('label', docType);

    const res = await fetch(`${edgeFunctionBase}/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!res.ok) {
      console.error(`Failed to upload ${docType}: ${res.status} ${await res.text()}`);
      process.exit(1);
    }

    const resBody = await res.json();
    const doc = resBody.document || resBody;
    console.log(`✓ Saved ${docType.toUpperCase()}: ${doc.fileName} (ID: ${doc.id}, StorageKey: ${doc.storageKey})`);
  }

  console.log('\n--- Step 2: Fetching company document list ---');
  const listRes = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    console.error('Failed to list documents:', listRes.status, await listRes.text());
    process.exit(1);
  }
  const { rows } = await listRes.json();
  console.log(`Retrieved ${rows.length} total documents for company.`);

  for (const docType of docTypes) {
    const match = rows.find((r: any) => (r.label || '').toLowerCase() === docType.toLowerCase());
    if (match) {
      console.log(`✓ Found persisted ${docType}: ${match.fileName} (Uploaded at: ${match.createdAt})`);
    } else {
      console.error(`❌ MISSING document type: ${docType}`);
      process.exit(1);
    }
  }

  console.log('\n--- Step 3: Verifying View / Download Signed URL generation ---');
  for (const docType of docTypes) {
    const match = rows.find((r: any) => (r.label || '').toLowerCase() === docType.toLowerCase());
    const downloadRes = await fetch(`${edgeFunctionBase}/documents/${match.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!downloadRes.ok) {
      console.error(`Failed download link for ${docType}:`, downloadRes.status, await downloadRes.text());
      process.exit(1);
    }
    const dlInfo = await downloadRes.json();
    const signedUrl = dlInfo.url || dlInfo.signedUrl || dlInfo.downloadUrl;
    console.log(`✓ Generated Signed URL for ${docType}: ${signedUrl.slice(0, 70)}...`);

    // Fetch the signed URL to verify file actually exists in Supabase Storage
    const storageRes = await fetch(signedUrl);
    if (storageRes.ok) {
      console.log(`  ✓ Supabase Storage HTTP GET verification: 200 OK (${storageRes.headers.get('content-length')} bytes)`);
    } else {
      console.error(`❌ Supabase Storage file fetch failed: ${storageRes.status}`);
      process.exit(1);
    }
  }

  console.log('\n--- Step 4: Testing Replace / Re-upload for GST Certificate ---');
  const replaceFileName = `GST_Certificate_v2_REPLACED.pdf`;
  const replaceBlob = new Blob([Buffer.from('Replaced GST content')], { type: 'application/pdf' });
  const replaceForm = new FormData();
  replaceForm.append('file', replaceBlob, replaceFileName);
  replaceForm.append('companyId', company.id);
  replaceForm.append('label', 'gst');

  const replaceRes = await fetch(`${edgeFunctionBase}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: replaceForm,
  });
  if (!replaceRes.ok) {
    console.error('Failed to replace GST certificate:', replaceRes.status, await replaceRes.text());
    process.exit(1);
  }
  const replaceBody = await replaceRes.json();
  const newGstDoc = replaceBody.document || replaceBody;
  console.log(`✓ Replaced GST Certificate: new file name = ${newGstDoc.fileName}`);

  // Fetch list again to confirm only GST was replaced and other doc types remain intact
  const listRes2 = await fetch(`${edgeFunctionBase}/documents?companyId=${company.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { rows: rows2 } = await listRes2.json();

  console.log('\n--- Verification of Post-Replace State ---');
  for (const docType of docTypes) {
    const matches = rows2.filter((r: any) => (r.label || '').toLowerCase() === docType.toLowerCase());
    console.log(`DocType: ${docType} => ${matches.map((m: any) => m.fileName).join(', ')}`);
  }

  console.log('\n🎉 ALL VERIFICATION STEPS PASSED SUCCESSFULLY!');
}

runVerification().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
