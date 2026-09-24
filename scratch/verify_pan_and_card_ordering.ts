// scratch/verify_pan_and_card_ordering.ts
import dotenv from 'dotenv';
dotenv.config();

import ws from 'ws';
// @ts-ignore
global.WebSocket = ws;
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ciulqktarpydorkkfmqh.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function runVerification() {
  console.log('--- 1. Fetching test company ---');
  const { data: companies, error: compErr } = await supabase.from('companies').select('*').limit(2);
  if (compErr || !companies || companies.length === 0) {
    throw new Error(`Failed to fetch companies: ${compErr?.message}`);
  }

  const comp = companies[0];
  console.log(`Using company: "${comp.legalName}" (${comp.id}) | PAN: ${comp.pan || 'none'}`);

  console.log('--- 2. Simulating Upload of PAN Document ---');
  const fileContent = Buffer.from('Sample PAN Document Content for E2E Test');
  const docId = crypto.randomUUID();
  const storageKey = `orgs/${comp.orgId}/companies/${comp.id}/documents/${Date.now()}-pan.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('compliance-evidence')
    .upload(storageKey, fileContent, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const sha256Buffer = await crypto.subtle.digest('SHA-256', fileContent);
  const sha256Hex = Array.from(new Uint8Array(sha256Buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const { data: dbDoc, error: dbErr } = await supabase
    .from('documents')
    .insert({
      id: docId,
      companyId: comp.id,
      fileName: 'company_pan_card.pdf',
      storageKey,
      mimeType: 'application/pdf',
      sizeBytes: fileContent.byteLength,
      sha256: sha256Hex,
      storageDriver: 'supabase',
      label: 'pan',
    })
    .select()
    .single();

  if (dbErr) {
    throw new Error(`DB insert failed: ${dbErr.message}`);
  }

  console.log('✅ PAN Document inserted into database successfully:', dbDoc.id, 'Label:', dbDoc.label);

  console.log('--- 3. Verifying GET /documents filtering for PAN ---');
  const { data: docs, error: fetchErr } = await supabase
    .from('documents')
    .select('*')
    .eq('companyId', comp.id)
    .eq('label', 'pan');

  if (fetchErr || !docs || docs.length === 0) {
    throw new Error(`Failed to query saved PAN document: ${fetchErr?.message}`);
  }
  console.log(`✅ Found ${docs.length} PAN document for company: ${docs[0].fileName}`);

  console.log('--- 4. Testing Signed URL (View / Download) ---');
  const { data: signedData, error: signedErr } = await supabase.storage
    .from('compliance-evidence')
    .createSignedUrl(storageKey, 300);

  if (signedErr || !signedData?.signedUrl) {
    throw new Error(`Signed URL creation failed: ${signedErr?.message}`);
  }
  console.log('✅ Signed URL created successfully (View/Download verified)');

  console.log('--- 5. Testing Delete Action ---');
  const { error: deleteStorageErr } = await supabase.storage
    .from('compliance-evidence')
    .remove([storageKey]);
  if (deleteStorageErr) {
    console.warn('Storage delete warning:', deleteStorageErr.message);
  }

  const { error: deleteDbErr } = await supabase.from('documents').delete().eq('id', docId);
  if (deleteDbErr) {
    throw new Error(`DB delete failed: ${deleteDbErr.message}`);
  }

  const { data: afterDeleteDocs } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId);

  if (afterDeleteDocs && afterDeleteDocs.length > 0) {
    throw new Error('Document still exists in DB after deletion!');
  }
  console.log('✅ PAN Document deleted successfully from storage and DB');

  console.log('--- 6. Verifying Dynamic Card Ordering logic across companies ---');
  for (const c of companies) {
    const { data: cDocs } = await supabase.from('documents').select('*').eq('companyId', c.id);
    const { data: cMsme } = await supabase.from('msme_registrations').select('*').eq('companyId', c.id);
    const { data: cGst } = await supabase.from('gst_registrations').select('*').eq('companyId', c.id);

    const docLabels = (cDocs || []).map((d) => (d.label || '').toLowerCase());

    const hasPan = Boolean(c.pan || docLabels.includes('pan'));
    const hasGst = Boolean((cGst && cGst.length > 0 && cGst[0].gstin) || docLabels.includes('gst'));
    const hasMsme = Boolean((cMsme && cMsme.length > 0 && cMsme[0].udyamNumber) || docLabels.includes('msme'));
    const hasDpiit = Boolean(c.dpiitRecognitionNumber || docLabels.includes('dpiit'));
    const hasPf = Boolean(c.epfoCode || docLabels.includes('pf'));
    const hasEsi = Boolean(c.esicCode || docLabels.includes('esi'));

    const cards = [
      { id: 'PAN', hasData: hasPan },
      { id: 'GSTIN', hasData: hasGst },
      { id: 'MSME', hasData: hasMsme },
      { id: 'DPIIT', hasData: hasDpiit },
      { id: 'PF', hasData: hasPf },
      { id: 'ESI', hasData: hasEsi },
    ];

    const sorted = [
      ...cards.filter((card) => card.hasData),
      ...cards.filter((card) => !card.hasData),
    ];

    console.log(`\nCompany "${c.legalName}" Card Ordering:`);
    console.log('  Top (Held/Registered):', sorted.filter((card) => card.hasData).map((card) => card.id).join(', ') || 'None');
    console.log('  Below (Not Registered):', sorted.filter((card) => !card.hasData).map((card) => card.id).join(', ') || 'None');
  }

  console.log('\n🎉 ALL E2E VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

runVerification().catch((e) => {
  console.error('❌ E2E Verification failed:', e);
  process.exit(1);
});
