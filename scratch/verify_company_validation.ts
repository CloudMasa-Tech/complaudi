import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { validateCompanyMasterData } from '../src/lib/companyValidation';

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

async function runValidationTests() {
  console.log('===========================================================');
  console.log('--- TESTING SELF-ONBOARDING / ENROLLMENT VALIDATIONS ---');
  console.log('===========================================================\n');

  // Test 1: Valid CIN + Matching Details
  console.log('🔹 Test 1: Valid CIN + Matching Details');
  const res1 = validateCompanyMasterData({
    cin: 'U72900TN2020PTC138472',
    companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    entityType: 'PRIVATE_LIMITED',
    incorporationDate: '2020-07-14',
    stateCode: 'TN',
  });
  if (res1.valid) {
    console.log('  ✅ PASSED: Valid company details accepted cleanly.\n');
  } else {
    console.error('  ❌ FAILED: Unexpected validation errors:', res1.errors);
    process.exit(1);
  }

  // Test 2: Invalid / Non-existing CIN Format
  console.log('🔹 Test 2: Invalid / Non-existing CIN Format');
  const res2 = validateCompanyMasterData({
    cin: 'INVALIDCIN12345',
    companyName: 'ANY COMPANY NAME',
  });
  const cinErr2 = res2.errors.find((e) => e.field === 'cin');
  if (!res2.valid && cinErr2) {
    console.log(`  ✅ PASSED: Correctly caught invalid CIN: "${cinErr2.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected invalid CIN format.');
    process.exit(1);
  }

  // Test 3: CIN + Wrong Company Name
  console.log('🔹 Test 3: CIN + Wrong Company Name');
  const res3 = validateCompanyMasterData({
    cin: 'U72900TN2020PTC138472',
    companyName: 'SOUTHWIND SOLUTIONS PRIVATE LIMITED', // Incorrect name
    masterRecord: {
      cin: 'U72900TN2020PTC138472',
      legalName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    },
    entityType: 'PRIVATE_LIMITED',
    stateCode: 'TN',
  });
  const nameErr3 = res3.errors.find((e) => e.field === 'companyName');
  if (!res3.valid && nameErr3) {
    console.log(`  ✅ PASSED: Correctly caught company name mismatch: "${nameErr3.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected mismatched company name.');
    process.exit(1);
  }

  // Test 4: CIN + Wrong Entity Type
  console.log('🔹 Test 4: CIN + Wrong Entity Type');
  const res4 = validateCompanyMasterData({
    cin: 'U72900TN2020PTC138472',
    companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    entityType: 'PUBLIC_LIMITED', // CIN specifies PTC (Private Limited)
    stateCode: 'TN',
  });
  const entityErr4 = res4.errors.find((e) => e.field === 'entityType');
  if (!res4.valid && entityErr4) {
    console.log(`  ✅ PASSED: Correctly caught entity type mismatch: "${entityErr4.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected mismatched entity type.');
    process.exit(1);
  }

  // Test 5: CIN + Wrong Incorporation Date
  console.log('🔹 Test 5: CIN + Wrong Incorporation Date');
  const res5 = validateCompanyMasterData({
    cin: 'U72900TN2020PTC138472',
    companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    entityType: 'PRIVATE_LIMITED',
    incorporationDate: '2025-01-01', // Incorrect date (CIN year is 2020)
    stateCode: 'TN',
  });
  const dateErr5 = res5.errors.find((e) => e.field === 'incorporationDate');
  if (!res5.valid && dateErr5) {
    console.log(`  ✅ PASSED: Correctly caught incorporation date mismatch: "${dateErr5.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected mismatched incorporation date.');
    process.exit(1);
  }

  // Test 6: CIN + Wrong State
  console.log('🔹 Test 6: CIN + Wrong State');
  const res6 = validateCompanyMasterData({
    cin: 'U72900TN2020PTC138472',
    companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    entityType: 'PRIVATE_LIMITED',
    stateCode: 'AP', // Andhra Pradesh selected, but CIN is registered in TN
  });
  const stateErr6 = res6.errors.find((e) => e.field === 'stateCode');
  if (!res6.valid && stateErr6) {
    console.log(`  ✅ PASSED: Correctly caught state mismatch: "${stateErr6.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected mismatched state.');
    process.exit(1);
  }

  // Test 7: Invalid Company Status (STRIKE_OFF)
  console.log('🔹 Test 7: Invalid Company Status (STRIKE_OFF)');
  const res7 = validateCompanyMasterData({
    cin: 'U99999MH2010PTC999999',
    companyName: 'DEFUNCT SOLUTIONS PRIVATE LIMITED',
    status: 'STRIKE_OFF',
  });
  const statusErr7 = res7.errors.find((e) => e.field === 'cin');
  if (!res7.valid && statusErr7) {
    console.log(`  ✅ PASSED: Correctly caught ineligible company status: "${statusErr7.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected company with STRIKE_OFF status.');
    process.exit(1);
  }

  // Test 8: Duplicate CIN Check
  console.log('🔹 Test 8: Duplicate CIN Check');
  const res8 = validateCompanyMasterData({
    cin: 'U72900TN2020PTC138472',
    companyName: 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED',
    existingCinsInDb: ['U72900TN2020PTC138472'],
  });
  const dupErr8 = res8.errors.find((e) => e.field === 'cin');
  if (!res8.valid && dupErr8) {
    console.log(`  ✅ PASSED: Correctly caught duplicate CIN: "${dupErr8.message}"\n`);
  } else {
    console.error('  ❌ FAILED: Should have rejected duplicate CIN.');
    process.exit(1);
  }

  // Test 9: End-to-End Trial Registration via Supabase Edge Function
  console.log('🔹 Test 9: End-to-End Trial Registration with Valid Details');
  const testEmail = `test_onboarding_${Date.now()}@test.com`;
  const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/auth-api/register-trial`;

  const regRes = await fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: 'TestPassword123!',
      name: 'Onboarding Test User',
      phone: '9876543210',
      companyName: 'CLOUDMASA INNOVATION LAB PRIVATE LIMITED',
      entityType: 'PRIVATE_LIMITED',
      stateCode: 'DL',
      cin: 'U72200DL2018PTC234567',
      incorporationDate: '2018-05-10',
    }),
  });

  if (regRes.ok) {
    const regData = await regRes.json();
    console.log(`  ✅ PASSED: End-to-end trial registration succeeded! Access token received (Sub: ${regData.accessToken ? 'OK' : 'MISSING'}).\n`);
  } else {
    const errorText = await regRes.text();
    console.error(`  ❌ FAILED: Trial registration failed: ${regRes.status} ${errorText}`);
    process.exit(1);
  }

  console.log('🎉 ALL 9 COMPANY VALIDATION TEST SCENARIOS PASSED PERFECTLY!');
}

runValidationTests().catch((err) => {
  console.error('Error running validation tests:', err);
  process.exit(1);
});
