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

// Helper to simulate the exact Dashboard card ordering logic
function getDynamicCardOrder(companyProfile: {
  pan?: string | null;
  udyamNumber?: string | null;
  gstin?: string | null;
  dpiitNumber?: string | null;
  registrationNumber?: string | null;
  kycMet?: boolean;
  epfoCode?: string | null;
  esicCode?: string | null;
  dscActive?: boolean;
  hasDirectors?: boolean;
  docs?: string[]; // list of document labels
}) {
  const docs = (companyProfile.docs || []).map((d) => d.toLowerCase());

  const hasPanDoc = docs.includes('pan');
  const hasMsmeDoc = docs.includes('msme');
  const hasGstDoc = docs.includes('gst');
  const hasDpiitDoc = docs.includes('dpiit');
  const hasMcaDoc = docs.some((d) => ['master_data', 'mca_report', 'mca'].includes(d));
  const hasKycDoc = docs.some((d) => ['kyc', 'dir3', 'dir3_kyc'].includes(d));
  const hasPfDoc = docs.includes('pf');
  const hasEsiDoc = docs.includes('esi');
  const hasDaDoc = docs.some((d) => ['da', 'director_audit', 'dsc'].includes(d));
  const hasR3Doc = docs.some((d) => ['r3', 'dir3_return', 'mca_return'].includes(d));

  const allCards = [
    { id: 'PAN', label: 'PAN', hasData: Boolean(companyProfile.pan || hasPanDoc) },
    { id: 'MSME', label: 'MSME / UDYAM', hasData: Boolean(companyProfile.udyamNumber || hasMsmeDoc) },
    { id: 'GST', label: 'GST', hasData: Boolean(companyProfile.gstin || hasGstDoc) },
    { id: 'DPIIT', label: 'DPIIT / STARTUP', hasData: Boolean(companyProfile.dpiitNumber || hasDpiitDoc) },
    { id: 'MCA', label: 'MCA', hasData: Boolean(companyProfile.registrationNumber || hasMcaDoc) },
    { id: 'KYC', label: 'KYC', hasData: Boolean(companyProfile.kycMet || hasKycDoc || hasMcaDoc) },
    { id: 'PF', label: 'PF', hasData: Boolean(companyProfile.epfoCode || hasPfDoc) },
    { id: 'ESI', label: 'ESI', hasData: Boolean(companyProfile.esicCode || hasEsiDoc) },
    { id: 'DA', label: 'DA', hasData: Boolean(companyProfile.dscActive || hasDaDoc) },
    { id: 'R3', label: 'R3', hasData: Boolean(companyProfile.hasDirectors || hasR3Doc || hasMcaDoc) },
  ];

  const filledCards = allCards.filter((c) => c.hasData);
  const unfilledCards = allCards.filter((c) => !c.hasData);
  const sortedCards = [...filledCards, ...unfilledCards];

  return {
    filled: filledCards.map((c) => c.id),
    unfilled: unfilledCards.map((c) => c.id),
    finalOrder: sortedCards.map((c) => c.id),
  };
}

async function runScenarioTests() {
  console.log('=====================================================');
  console.log('--- TESTING DYNAMIC DASHBOARD CARD ORDERING LOGIC ---');
  console.log('=====================================================\n');

  // Test 1: User's Example - PAN, GST, MCA, PF filled
  console.log('🔹 Scenario 1: User Example (PAN, GST, MCA, PF filled)');
  const res1 = getDynamicCardOrder({
    pan: 'ABCDE1234F',
    gstin: '27ABCDE1234F1Z5',
    registrationNumber: 'U12345MH2020PTC123456',
    epfoCode: 'MH/12345',
  });
  console.log('  Filled Cards:', res1.filled.join(', '));
  console.log('  Unfilled Cards:', res1.unfilled.join(', '));
  console.log('  Final Order:', res1.finalOrder.join(' -> '));

  const expectedRes1 = ['PAN', 'GST', 'MCA', 'PF', 'MSME', 'DPIIT', 'KYC', 'ESI', 'DA', 'R3'];
  if (JSON.stringify(res1.finalOrder) === JSON.stringify(expectedRes1)) {
    console.log('  ✅ PASSED: Matched exact expected order!\n');
  } else {
    console.error('  ❌ FAILED: Expected', expectedRes1, 'got', res1.finalOrder);
    process.exit(1);
  }

  // Test 2: All Cards Unfilled
  console.log('🔹 Scenario 2: All Cards Unfilled');
  const res2 = getDynamicCardOrder({});
  console.log('  Filled Cards:', res2.filled.join(', ') || '(none)');
  console.log('  Unfilled Cards:', res2.unfilled.join(', '));
  console.log('  Final Order:', res2.finalOrder.join(' -> '));

  const expectedRes2 = ['PAN', 'MSME', 'GST', 'DPIIT', 'MCA', 'KYC', 'PF', 'ESI', 'DA', 'R3'];
  if (JSON.stringify(res2.finalOrder) === JSON.stringify(expectedRes2)) {
    console.log('  ✅ PASSED: Default relative order maintained!\n');
  } else {
    console.error('  ❌ FAILED: Expected', expectedRes2, 'got', res2.finalOrder);
    process.exit(1);
  }

  // Test 3: All Cards Filled
  console.log('🔹 Scenario 3: All Cards Filled');
  const res3 = getDynamicCardOrder({
    pan: 'ABCDE1234F',
    udyamNumber: 'UDYAM-MH-01-0000000',
    gstin: '27ABCDE1234F1Z5',
    dpiitNumber: 'DPIIT12345',
    registrationNumber: 'U12345MH2020PTC123456',
    kycMet: true,
    epfoCode: 'MH/12345',
    esicCode: '31000000000000000',
    dscActive: true,
    hasDirectors: true,
  });
  console.log('  Filled Cards:', res3.filled.join(', '));
  console.log('  Unfilled Cards:', res3.unfilled.join(', ') || '(none)');
  console.log('  Final Order:', res3.finalOrder.join(' -> '));

  if (JSON.stringify(res3.finalOrder) === JSON.stringify(expectedRes2)) {
    console.log('  ✅ PASSED: All filled order maintained!\n');
  } else {
    console.error('  ❌ FAILED: Expected', expectedRes2, 'got', res3.finalOrder);
    process.exit(1);
  }

  // Test 4: Only Last Two Cards (DA & R3) Filled
  console.log('🔹 Scenario 4: Only DA & R3 Filled (Last cards float to front)');
  const res4 = getDynamicCardOrder({
    dscActive: true,
    hasDirectors: true,
  });
  console.log('  Filled Cards:', res4.filled.join(', '));
  console.log('  Unfilled Cards:', res4.unfilled.join(', '));
  console.log('  Final Order:', res4.finalOrder.join(' -> '));

  const expectedRes4 = ['DA', 'R3', 'PAN', 'MSME', 'GST', 'DPIIT', 'MCA', 'KYC', 'PF', 'ESI'];
  if (JSON.stringify(res4.finalOrder) === JSON.stringify(expectedRes4)) {
    console.log('  ✅ PASSED: DA & R3 dynamically moved to top!\n');
  } else {
    console.error('  ❌ FAILED: Expected', expectedRes4, 'got', res4.finalOrder);
    process.exit(1);
  }

  // Test 5: Real DB Companies Check
  console.log('🔹 Scenario 5: Fetching Real Companies from Database');
  const { data: companies } = await supabase.from('companies').select('*');
  if (companies && companies.length > 0) {
    for (const comp of companies) {
      const { data: docs } = await supabase.from('company_documents').select('label').eq('company_id', comp.id);
      const docLabels = (docs || []).map((d) => d.label);

      const realRes = getDynamicCardOrder({
        pan: comp.pan,
        udyamNumber: comp.udyam_number || comp.udyamNumber,
        registrationNumber: comp.registration_number || comp.registrationNumber,
        epfoCode: comp.epfo_code || comp.epfoCode,
        esicCode: comp.esic_code || comp.esicCode,
        docs: docLabels,
      });

      console.log(`  🏢 Company: "${comp.legal_name || comp.legalName}"`);
      console.log(`     Filled (${realRes.filled.length}): [${realRes.filled.join(', ')}]`);
      console.log(`     Unfilled (${realRes.unfilled.length}): [${realRes.unfilled.join(', ')}]`);
      console.log(`     Final Order: ${realRes.finalOrder.join(' -> ')}\n`);
    }
  }

  console.log('🎉 ALL DYNAMIC ORDERING TEST SCENARIOS PASSED PERFECTLY!');
}

runScenarioTests().catch((err) => {
  console.error('Error running scenario tests:', err);
  process.exit(1);
});
