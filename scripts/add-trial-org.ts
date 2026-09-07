import bcrypt from 'bcryptjs';
import { env } from '../src/config/env';
import { parseDate } from '../src/lib/dates';
import { prisma } from '../src/lib/prisma';
import { syncCompany } from '../src/modules/compliance/compliance.service';
import { snapshotScore } from '../src/modules/dashboard/dashboard.service';

async function main() {
  const password = await bcrypt.hash('DemoPassword1', env.BCRYPT_ROUNDS);
  
  // Set trialEndsAt to 14 days from now
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const org = await prisma.organization.create({
    data: {
      name: 'Trial Advisory LLP',
      slug: 'trial-advisory',
      trialEndsAt
    }
  });

  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'owner@trial.test',
      name: 'Trial Admin',
      passwordHash: password,
      role: 'SUPER_ADMIN',
    },
  });

  const pvtLtd = await prisma.company.create({
    data: {
      organizationId: org.id,
      legalName: 'Trial Technologies Private Limited',
      entityType: 'PRIVATE_LIMITED',
      stateCode: 'TN',
      annualTurnover: BigInt(1000000),
      paidUpCapital: BigInt(100000),
      cashTransactionRatioBelow5Pct: true,
      hasForeignTransactions: false,
      acceptsDeposits: false,
      buysFromMsmeSuppliers: false,
      incorporationDate: parseDate('2024-01-01'),
      employeeCount: 10,
    }
  });

  const client = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'client@trial.test',
      name: 'Trial Client',
      passwordHash: password,
      role: 'COMPANY_OWNER',
    }
  });

  await prisma.companyMembership.create({
    data: { userId: client.id, companyId: pvtLtd.id, role: 'COMPANY_OWNER', grantedById: owner.id }
  });
  
  const superAdmin = { userId: owner.id, organizationId: org.id, role: 'SUPER_ADMIN' as const };
  
  await syncCompany(superAdmin, pvtLtd.id);
  await snapshotScore(superAdmin, pvtLtd.id);

  console.log('Trial org created!');
  console.log('Login as:');
  console.log('Super Admin: owner@trial.test / DemoPassword1');
  console.log('Company Owner: client@trial.test / DemoPassword1');
}

main().catch(console.error).finally(() => prisma.$disconnect());
