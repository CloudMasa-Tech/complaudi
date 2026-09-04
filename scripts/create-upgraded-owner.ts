/**
 * One-off local test helper: create ONE Organisation + ONE COMPANY_OWNER + ONE
 * Company + ONE CompanyMembership (role = COMPANY_OWNER), all already "upgraded"
 * (trialEndsAt = null, so there is no trial banner and invite is unlocked).
 *
 * Mirrors real onboarding (registerTrial in auth.service.ts) so relations,
 * password hashing and grants line up. Runs the rules engine (syncCompany) so
 * the company has tasks to invite/assign from.
 *
 * Safe to re-run: everything is an upsert keyed on slug/email/legalName.
 *
 * IMPORTANT: role is COMPANY_OWNER — NOT SUPER_ADMIN. There is exactly one
 * SUPER_ADMIN on the platform (info@cloudmasa.com); this script creates a
 * normal client owner only.
 *
 * Usage (from the repo root):
 *   npx tsx scripts/create-upgraded-owner.ts
 */
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env';
import { parseDate } from '../src/lib/dates';
import { prisma } from '../src/lib/prisma';
import { syncCompany } from '../src/modules/compliance/compliance.service';

const CRORE = 10_000_000;
const LAKH = 100_000;

// ── Configurable (change these to taste) ────────────────────────────────────
const ORG_NAME = 'Test Upgraded Co';
const ORG_SLUG = 'test-upgraded-co';               // unique org-wide
const OWNER_EMAIL = 'owner@upgraded.test';         // the COMPANY_OWNER to log in as
const OWNER_NAME = 'Upgraded Owner';
const OWNER_PASSWORD = 'OwnerPass123!';            // >=8 chars, digit + letter
const COMPANY_NAME = 'Test Upgraded Co Pvt Ltd';
const COMPANY_CIN = 'U15100KA2020PTC411223';       // valid-format sample CIN
const COMPANY_PAN = 'AABCT0000Z';
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, env.BCRYPT_ROUNDS);

  // 1. Organisation — trialEndsAt null = already upgraded / full account.
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { name: ORG_NAME, slug: ORG_SLUG, trialEndsAt: null },
  });

  // 2. User — role MUST be COMPANY_OWNER (never SUPER_ADMIN).
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { organizationId: org.id },
    create: {
      organizationId: org.id,
      email: OWNER_EMAIL,
      name: OWNER_NAME,
      passwordHash,
      role: 'COMPANY_OWNER',
    },
  });
  if (owner.role !== 'COMPANY_OWNER') {
    throw new Error(`Refusing to proceed: owner role is ${owner.role}, expected COMPANY_OWNER.`);
  }

  // 3. Company under that organisation.
  const company = await prisma.company.upsert({
    where: { organizationId_legalName: { organizationId: org.id, legalName: COMPANY_NAME } },
    update: {},
    create: {
      organizationId: org.id,
      legalName: COMPANY_NAME,
      brandName: COMPANY_NAME,
      entityType: 'PRIVATE_LIMITED',
      cin: COMPANY_CIN,
      pan: COMPANY_PAN,
      incorporationDate: parseDate('2020-03-02'),
      stateCode: 'KA',
      industry: 'Manufacturing',
      employeeCount: 80,
      annualTurnover: BigInt(25 * CRORE),
      paidUpCapital: BigInt(100 * LAKH),
      cashTransactionRatioBelow5Pct: true,
      hasForeignTransactions: false,
      acceptsDeposits: false,
      isListed: false,
      buysFromMsmeSuppliers: true,
      // 4. The membership that grants the owner the company (role = COMPANY_OWNER).
      memberships: { create: [{ userId: owner.id, role: 'COMPANY_OWNER', grantedById: owner.id }] },
    },
  });

  // 5. Build the compliance calendar so there are tasks to invite/assign from.
  try {
    await syncCompany(
      { userId: owner.id, organizationId: org.id, role: owner.role },
      company.id,
    );
    console.log('  Engine sync OK — calendar built for', COMPANY_NAME);
  } catch (e) {
    console.warn('  (Engine sync failed — company still exists, but has no tasks yet.)', e instanceof Error ? e.message : e);
  }

  console.log('------------------------------------------');
  console.log('Created / found:');
  console.log('  Organisation :', org.name, `(${ORG_SLUG})`, 'trialEndsAt =', org.trialEndsAt, '(upgraded)');
  console.log('  User         :', OWNER_EMAIL, 'role =', owner.role);
  console.log('  Company      :', company.legalName, '->', company.id);
  console.log('------------------------------------------');
  console.log('Log in at the web URL you use (http://localhost:3000 in dev) as:');
  console.log('  ', OWNER_EMAIL, '/', OWNER_PASSWORD);
  console.log('This COMPANY_OWNER can invite a CA/Admin (upgraded -> invite unlocked).');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
