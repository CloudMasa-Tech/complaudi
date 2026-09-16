import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { signAccessToken } from '../src/lib/jwt';
import { prisma, serialiseBigInt } from '../src/lib/prisma';
import { allRules } from '../src/engine/catalog';
import { REGISTRATION_RULE_CODES } from '../src/engine/catalog';

const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const FRESH = process.env.FIXTURE === 'fresh';
const incorporationDate = FRESH ? '2026-09-10' : '2020-06-15';

function hr(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

async function api(base: string, path: string, method: string, token: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------- test fixtures
  const actor = { userId: 'e2e-unknown', organizationId: 'e2e-unknown', role: 'SUPER_ADMIN' as const };

  const org = await prisma.organization.create({
    data: { name: `E2E Registration Probe ${stamp}`, slug: `e2e-reg-${stamp}` },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `e2e-reg-${stamp}@example.com`,
      passwordHash: 'e2e-dummy-not-a-real-hash',
      name: 'E2E Registration Probe',
      role: 'SUPER_ADMIN',
    },
  });
  actor.userId = user.id;
  actor.organizationId = org.id;

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : env.PORT}`;
  const token = signAccessToken({
    sub: user.id,
    org: org.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  let companyId = '';
  try {
    // ------------------------------------------------ STEP 1: create company
    hr('STEP 1 — Create test company (turnover ¥40L, 20 staff, no registrations)');
    const create = await api(base, '/api/v1/companies', 'POST', token, {
      legalName: `E2E Registration Probe ${stamp}`,
      entityType: 'PRIVATE_LIMITED',
      cin: 'U74999KA2020PTC123456',
      pan: 'AABCT1332L',
      incorporationDate,
      stateCode: 'KA',
      industry: 'Software services',
      employeeCount: 20,
      annualTurnover: '4000000',
      paidUpCapital: '1000000',
      cashTransactionRatioBelow5Pct: true,
      hasForeignTransactions: false,
      acceptsDeposits: false,
      isListed: false,
      buysFromMsmeSuppliers: false,
      directors: [{ name: 'Probe Director', designation: 'Director', isResident: true }],
      gstRegistrations: [],
    });
    console.log(`POST /api/v1/companies -> ${create.status}`);
    console.log(JSON.stringify(create.json, null, 2).slice(0, 1400));
    if (!create.ok) throw new Error('Company create failed');
    companyId = (create.json as { company: { id: string } }).company.id;

    const stored = await prisma.company.findUnique({ where: { id: companyId } });
    console.log('\nStored row (annualTurnover BigInt as string):', serialiseBigInt(stored));

    // ------------------------------------------------ STEP 2: run sync show items
    hr('STEP 2 — Run syncCompany() and show generated items');
    const sync = await api(base, `/api/v1/compliance/companies/${companyId}/sync`, 'POST', token);
    console.log(`POST /api/v1/compliance/companies/${companyId}/sync -> ${sync.status}`);
    console.log(JSON.stringify(sync.json, null, 2));

    const registrations = await prisma.complianceItem.findMany({
      where: { companyId, ruleCode: { in: REGISTRATION_RULE_CODES } },
      orderBy: { ruleCode: 'asc' },
      select: { ruleCode: true, title: true, severity: true, periodKey: true, dueDate: true, status: true },
    });
    const overdue = registrations.filter((r) => r.status === 'OVERDUE');
    console.log('\n[DB] registration-reminder items:');
    console.log(serialiseBigInt(registrations));
    console.log(`\n[CHECK] all 4 reminders present: ${REGISTRATION_RULE_CODES.every((c) => registrations.some((r) => r.ruleCode === c))}`);
    console.log(`[CHECK] any OVERDUE: ${overdue.length > 0} (count=${overdue.length})`);
    for (const r of registrations) {
      const days = Math.round((new Date(r.dueDate).getTime() - Date.now()) / 86_400_000);
      console.log(`  ${r.ruleCode.padEnd(24)} status=${r.status.padEnd(9)} due=today+${days <= 0 ? days-0 : days}  (${r.dueDate.toISOString().slice(0,10)})`);
    }

    const all = await prisma.complianceItem.count({ where: { companyId } });
    console.log(`[CHECK] total generated items for company: ${all}`);
    const gstFilersBefore = await prisma.complianceItem.count({ where: { companyId, ruleCode: { startsWith: 'GST_' } } });
    console.log(`[CHECK] GST filing rules present BEFORE registration: ${gstFilersBefore}`);

    // ------------------------------------------------ STEP 3: statuses not overdue
    hr('STEP 3 — Status of each reminder (must not be OVERDUE)');
    console.log('Full rows as stored:');
    console.log(serialiseBigInt(registrations));

    // ------------------------------------------------ STEP 4: dashboard overview
    hr('STEP 4 — GET /api/v1/dashboard/overview?companyId= (RAW JSON)');
    const overview = await api(base, `/api/v1/dashboard/overview?companyId=${companyId}`, 'GET', token);
    console.log(`status ${overview.status}`);
    console.log(JSON.stringify(overview.json, null, 2));
    const ov = overview.json as { registrations?: Array<{ ruleCode: string; title: string; status: string; dueDate: string }>; score?: { score: number } };
    const ovCodes = (ov.registrations ?? []).map((r) => r.ruleCode);
    console.log(`\n[CHECK] registrations array present: ${Array.isArray(ov.registrations)}`);
    console.log(`[CHECK] registrations codes: ${JSON.stringify(ovCodes)}`);
    console.log(`[CHECK] includes GST_REGISTER/PF_REGISTER/ESI_REGISTER/MSME_UDYAM_REGISTRATION: ` +
      `GST_REGISTER=${ovCodes.includes('GST_REGISTER')} PF_REGISTER=${ovCodes.includes('PF_REGISTER')} ` +
      `ESI_REGISTER=${ovCodes.includes('ESI_REGISTER')} MSME_UDYAM_REGISTRATION=${ovCodes.includes('MSME_UDYAM_REGISTRATION')}`);

    // STEP 7a (before): score + authority breakdown
    hr('STEP 7a — Score BEFORE registration (after first sync)');
    const scoreBefore = await api(base, `/api/v1/dashboard/score?companyId=${companyId}`, 'GET', token);
    console.log(JSON.stringify(scoreBefore.json, null, 2));
    const scoreBeforeBody = scoreBefore.json as { score: number; byAuthority: Array<{ authority: string; possible: number }> };
    const authBefore = scoreBeforeBody.byAuthority.map((r) => r.authority);
    console.log(`\n[CHECK] GST absent from score byAuthority BEFORE registration: ${!authBefore.includes('GST')}`);
    console.log(`[CHECK] authorities BEFORE: ${JSON.stringify(authBefore)}`);

    // ------------------------------------------------ STEP 5: register the company
    hr('STEP 5 — Update company: add GSTIN + EPFO code');
    console.log('5a. Attempt the LITERAL GSTIN the request suggested (29AABCT1332L1ZZ) — check digit is invalid, app must reject:');
    const badGst = await api(base, `/api/v1/companies/${companyId}/gst-registrations`, 'POST', token, {
      gstin: '29AABCT1332L1ZZ',
      filingFrequency: 'MONTHLY',
      registeredOn: today,
      isActive: true,
    });
    console.log(`POST .../gst-registrations (bad gstin) -> ${badGst.status}`);
    console.log(JSON.stringify(badGst.json));

    console.log('\n5b. Add checksum-valid GSTIN 29AABCT1332L1ZA (PAN AABCT1332L, KA):');
    const validGst = await api(base, `/api/v1/companies/${companyId}/gst-registrations`, 'POST', token, {
      gstin: '29AABCT1332L1ZA',
      filingFrequency: 'MONTHLY',
      registeredOn: today,
      isActive: true,
    });
    console.log(`POST .../gst-registrations (valid gstin) -> ${validGst.status}`);
    console.log(JSON.stringify(Object.keys(validGst.json as object).includes('registration') && validGst.json ? validGst.json : validGst.json).slice(0, 600));

    console.log('\n5c. Set epfoCode on the company (PATCH runs syncCompany):');
    const patch = await api(base, `/api/v1/companies/${companyId}`, 'PATCH', token, { epfoCode: 'TNBNL0001234000' });
    console.log(`PATCH /api/v1/companies/${companyId} -> ${patch.status}`);
    const patchJ = patch.json as { company: { epfoCode: string | null; esicCode: string | null } | undefined; sync: unknown };
    console.log(`  epfoCode=${patchJ.company?.epfoCode} esicCode=${patchJ.company?.esicCode}`);

    // ------------------------------------------------ STEP 6: re-run sync, show retirement
    hr('STEP 6 — Re-run syncCompany(); show self-retirement + GSTR-1/GSTR-3B');
    const sync2 = await api(base, `/api/v1/compliance/companies/${companyId}/sync`, 'POST', token);
    console.log(JSON.stringify(sync2.json, null, 2));

    const regsAfter = await prisma.complianceItem.findMany({
      where: { companyId, ruleCode: { in: REGISTRATION_RULE_CODES } },
      select: { ruleCode: true, status: true, dueDate: true },
      orderBy: { ruleCode: 'asc' },
    });
    console.log('\n[DB] registration-reminder items remaining after registering:');
    console.log(serialiseBigInt(regsAfter));
    console.log(`\n[CHECK] GST_REGISTER gone: ${!regsAfter.some((r) => r.ruleCode === 'GST_REGISTER')}`);
    console.log(`[CHECK] PF_REGISTER gone: ${!regsAfter.some((r) => r.ruleCode === 'PF_REGISTER')}`);
    console.log(`[CHECK] ESI_REGISTER remains (esicCode was NOT set): ${regsAfter.some((r) => r.ruleCode === 'ESI_REGISTER')}`);

    const gstItems = await prisma.complianceItem.findMany({
      where: { companyId, ruleCode: { startsWith: 'GST_' } },
      select: { ruleCode: true, title: true, status: true, dueDate: true },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });
    console.log('\n[DB] GST filing rules present AFTER registration:');
    console.log(serialiseBigInt(gstItems));
    const gstCodes = gstItems.map((r) => r.ruleCode);
    console.log(`\n[CHECK] GSTR-1 present: ${gstCodes.filter((c) => c.startsWith('GST_GSTR1_')).length} item(s)`);
    console.log(`[CHECK] GSTR-3B present: ${gstCodes.filter((c) => c.startsWith('GST_GSTR3B_')).length} item(s)`);

    // ------------------------------------------------ STEP 7b: score after + byAuthority
    hr('STEP 7 — Score/by-authority AFTER registration + resync');
    const scoreAfter = await api(base, `/api/v1/dashboard/score?companyId=${companyId}`, 'GET', token);
    console.log(JSON.stringify(scoreAfter.json, null, 2));
    const scoreAfterBody = scoreAfter.json as {
      score: number;
      windowStart: string;
      windowEnd: string;
      byAuthority: Array<{ authority: string; possible: number; earned: number; missed: number; onTime: number; late: number }>;
    };
    console.log(`\nheadline score BEFORE=${scoreBeforeBody.score} AFTER=${scoreAfterBody.score} ` +
      `(saturates at 0 while anything is overdue — expected engine behaviour, so the assertions below use the byAuthority breakdown)`);

    const gstRow = scoreAfterBody.byAuthority.find((r) => r.authority === 'GST');
    const gstOverdueAll = await prisma.complianceItem.count({
      where: { companyId, ruleCode: { startsWith: 'GST_' }, status: 'OVERDUE' },
    });
    // The score only counts items that fell due within its 365-day lookback
    // window (windowStart..windowEnd) and are neither completed nor waived —
    // matching engine/score.ts. Raw OVERDUE status alone overcounts by items
    // due before the window, so the comparison uses this count.
    const ws = new Date(scoreAfterBody.windowStart);
    const we = new Date(scoreAfterBody.windowEnd);
    const gstScoredItems = await prisma.complianceItem.count({
      where: {
        companyId,
        ruleCode: { startsWith: 'GST_' },
        completedAt: null,
        status: { notIn: ['WAIVED'] },
        dueDate: { gte: ws, lte: we },
      },
    });
    const msg = (ok: boolean) => (ok ? 'PASS' : 'FAIL');

    console.log(`\n[CHECK] GST authority present AFTER registration: ${scoreAfterBody.byAuthority.some((r) => r.authority === 'GST')}`);
    if (gstRow) {
      console.log(`[CHECK] (PASS expected) — GST row: ${JSON.stringify(gstRow)}`);
      console.log(`[CHECK] GST possible>earned (nothing filed on time): ${msg(gstRow.possible > gstRow.earned)} ` +
        `(possible=${gstRow.possible} earned=${gstRow.earned})`);
      console.log(`[CHECK] GST missed matches the score's own window (due within windowStart..windowEnd, not completed/waived): ${msg(gstRow.missed === gstScoredItems)} ` +
        `(score missed=${gstRow.missed}, stored GST items in window=${gstScoredItems})`);
    } else {
      const upcomingGst = await prisma.complianceItem.count({ where: { companyId, ruleCode: { startsWith: 'GST_' }, status: 'UPCOMING' } });
      console.log(`[CHECK] GST not in scored breakdown because NO GST filing has fallen due yet: ${msg(gstScoredItems === 0 && upcomingGst > 0)} ` +
        `(stored GST items: ${upcomingGst} UPCOMING, 0 due within window) — correct: the score only counts items already due`);
    }
    console.log(`[INFO]  raw OVERDUE GST items in DB=${gstOverdueAll} (the ${gstOverdueAll - gstScoredItems} outside the window are due < windowStart=${scoreAfterBody.windowStart}, so the engine excludes them by design)`);

    const scoredAuth = scoreAfterBody.byAuthority.map((r) => r.authority);
    console.log(`[CHECK] authorities AFTER: ${JSON.stringify(scoredAuth)}`);

    // Reminders are scored exactly like filings — the catch is the score only
    // counts items whose due date has passed. Future-dated reminders sit in
    // `upcoming` until they fall due, so assert on the ones that HAVE aged into
    // the 365-day scored window (e.g. the MSME FY2026-27 row on a long-lived
    // company) rather than on the headline number.
    const overdueRegs = await prisma.complianceItem.findMany({
      where: { companyId, ruleCode: { in: REGISTRATION_RULE_CODES }, status: 'OVERDUE' },
      select: { ruleCode: true },
    });
    if (overdueRegs.length === 0) {
      console.log(`[CHECK] registration reminders all future-dated (${await prisma.complianceItem.count({ where: { companyId, ruleCode: { in: REGISTRATION_RULE_CODES }, status: 'UPCOMING' } })} UPCOMING, 0 OVERDUE) — correctly excluded from the scored set, which only counts items already due`);
    } else {
      const legend: Record<string, string> = { GST_REGISTER: 'GST', MSME_UDYAM_REGISTRATION: 'MSME', PF_REGISTER: 'LABOUR', ESI_REGISTER: 'LABOUR' };
      const auths = [...new Set(overdueRegs.map((r) => legend[r.ruleCode]))];
      const allScored = auths.every((a) => scoredAuth.includes(a) && (scoreAfterBody.byAuthority.find((r) => r.authority === a)?.missed ?? 0) > 0);
      console.log(`[CHECK] ${overdueRegs.length} overdue registration reminder(s) (${overdueRegs.map((r) => r.ruleCode).join(', ')}) are scored in the byAuthority breakdown: ${msg(allScored)}`);
    }

    // ------------------------------------------------ STEP 8: catalogue check
    hr('STEP 8 — GET /api/v1/rules — registration rules present, category "Registration"');
    const rules = await api(base, '/api/v1/rules', 'GET', token);
    console.log(`GET /api/v1/rules -> ${rules.status}, ${Array.isArray(rules.json) ? rules.json.length : '?'} rules`);
    const list = (rules.json as Array<{ code: string; title: string; category: string; severity: string }>).filter((r) =>
      REGISTRATION_RULE_CODES.includes(r.code),
    );
    console.log(JSON.stringify(list, null, 2));
    console.log(`\n[CHECK] all 4 present: ${list.length === REGISTRATION_RULE_CODES.length}`);
    console.log(`[CHECK] all category === "Registration": ${list.every((r) => r.category === 'Registration')}`);
    console.log(`[CHECK] MSME retitled: ${list.find((r) => r.code === 'MSME_UDYAM_REGISTRATION')?.title}`);

    const catSum = (allRules.filter((r) => r.category === 'Registration')).map((r) => r.code);
    console.log(`\n[CHECK] catalog (in-memory) Registration category = ${JSON.stringify(catSum)}`);
  } finally {
    // --------------------------------------------------------------- cleanup
    hr('CLEANUP — remove the throwaway company, user, org and their rows');
    if (companyId) {
      const delItems = await prisma.complianceItem.deleteMany({ where: { companyId } });
      const delApp = await prisma.complianceApplicability.deleteMany({ where: { companyId } });
      const delTasks = await prisma.task.deleteMany({ where: { companyId } });
      const deletedCompany = await prisma.company.delete({ where: { id: companyId } });
      console.log(`deleted compliance items: ${delItems.count}, applicability rows: ${delApp.count}, tasks: ${delTasks.count}`);
      console.log(`deleted company: ${deletedCompany.legalName} (${deletedCompany.id})`);
    }
    const delUser = await prisma.user.delete({ where: { id: user.id } });
    const delOrg = await prisma.organization.delete({ where: { id: org.id } });
    console.log(`deleted user: ${delUser.email}`);
    console.log(`deleted org: ${delOrg.name}`);
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nE2E FAILED:');
  console.error(err);
  process.exit(1);
});