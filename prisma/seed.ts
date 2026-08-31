/**
 * Seeds a demo organization with two entities — a Private Limited company and
 * an LLP — builds their calendars, then back-fills a plausible filing history
 * so the dashboard and the compliance score have something real to show.
 */
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env';
import { addDays, parseDate, today } from '../src/lib/dates';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';
import { syncCompany } from '../src/modules/compliance/compliance.service';
import { snapshotScore } from '../src/modules/dashboard/dashboard.service';

const CRORE = 10_000_000;
const LAKH = 100_000;

async function main(): Promise<void> {
  const password = await bcrypt.hash('DemoPassword1', env.BCRYPT_ROUNDS);

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-advisory' },
    update: {},
    create: { name: 'Demo Advisory LLP', slug: 'demo-advisory' },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.test' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'owner@demo.test',
      name: 'Priya Ramanathan',
      passwordHash: password,
      role: 'SUPER_ADMIN',
    },
  });

  const associate = await prisma.user.upsert({
    where: { email: 'associate@demo.test' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'associate@demo.test',
      name: 'Arun Verma',
      passwordHash: password,
      role: 'CA',
    },
  });

  // ---------------------------------------------------------- Private Limited
  const pvtLtd = await prisma.company.upsert({
    where: { organizationId_legalName: { organizationId: org.id, legalName: 'Northwind Technologies Private Limited' } },
    update: {},
    create: {
      organizationId: org.id,
      legalName: 'Northwind Technologies Private Limited',
      brandName: 'Northwind',
      entityType: 'PRIVATE_LIMITED',
      cin: 'U72900TN2020PTC138472',
      pan: 'AAACN4321B',
      tan: 'CHEN12345B',
      incorporationDate: parseDate('2020-07-14'),
      stateCode: 'TN',
      industry: 'Software products',
      employeeCount: 42,
      annualTurnover: BigInt(18 * CRORE),
      paidUpCapital: BigInt(25 * LAKH),
      cashTransactionRatioBelow5Pct: true,
      hasForeignTransactions: true,
      acceptsDeposits: true,
      buysFromMsmeSuppliers: true,
      directors: {
        create: [
          { name: 'Priya Ramanathan', din: '08123456', designation: 'Managing Director', appointedOn: parseDate('2020-07-14') },
          { name: 'Sanjay Mehta', din: '08123457', designation: 'Director', appointedOn: parseDate('2021-04-01') },
        ],
      },
      gstRegistrations: {
        create: [
          { gstin: '33AAACN4321B1ZA', stateCode: 'TN', filingFrequency: 'MONTHLY', registeredOn: parseDate('2020-08-01') },
          { gstin: '29AAACN4321B1ZZ', stateCode: 'KA', filingFrequency: 'MONTHLY', registeredOn: parseDate('2022-05-10') },
        ],
      },
    },
  });

  // ---------------------------------------------------------- LLP
  const llp = await prisma.company.upsert({
    where: { organizationId_legalName: { organizationId: org.id, legalName: 'Sundar Design LLP' } },
    update: {},
    create: {
      organizationId: org.id,
      legalName: 'Sundar Design LLP',
      entityType: 'LLP',
      llpin: 'AAB-7743',
      pan: 'AABFS9012C',
      incorporationDate: parseDate('2019-02-20'),
      stateCode: 'KA',
      industry: 'Design services',
      employeeCount: 8,
      annualTurnover: BigInt(120 * LAKH),
      paidUpCapital: BigInt(30 * LAKH),
      cashTransactionRatioBelow5Pct: true,
      buysFromMsmeSuppliers: false,
      msmeRegistration: {
        create: { udyamNumber: 'UDYAM-KA-03-0114562', category: 'MICRO', registeredOn: parseDate('2021-06-11') },
      },
      gstRegistrations: {
        create: [{ gstin: '29AABFS9012C1ZF', stateCode: 'KA', filingFrequency: 'QRMP', registeredOn: parseDate('2019-03-15') }],
      },
    },
  });

  // The seed acts as the organisation's super admin, which is what lets it
  // reach every company without holding an explicit grant.
  const superAdmin = { userId: owner.id, organizationId: org.id, role: 'SUPER_ADMIN' as const };

  for (const company of [pvtLtd, llp]) {
    const result = await syncCompany(superAdmin, company.id);
    logger.info({ company: company.legalName, ...result }, 'seeded calendar');
  }

  // ---------------------------------------------------------- filing history
  // Close out most of what has already fallen due, leave a few genuinely open,
  // so the score lands somewhere realistic instead of a flat 0 or 100.
  const now = today();
  const past = await prisma.complianceItem.findMany({
    where: { company: { organizationId: org.id }, dueDate: { lt: now } },
    orderBy: { dueDate: 'asc' },
    include: { task: true },
  });

  let index = 0;
  for (const item of past) {
    index += 1;
    const outcome = index % 9 === 0 ? 'missed' : index % 5 === 0 ? 'late' : 'onTime';
    if (outcome === 'missed') continue;

    const completedAt = outcome === 'late' ? addDays(item.dueDate, 11) : addDays(item.dueDate, -2);
    await prisma.complianceItem.update({
      where: { id: item.id },
      data: { status: 'COMPLETED', completedAt },
    });
    if (item.task) {
      await prisma.task.update({
        where: { id: item.task.id },
        data: { status: 'DONE', completedAt, assigneeId: index % 2 === 0 ? owner.id : associate.id },
      });
    }
  }

  // Spread the open work across the team so the workload view is not empty.
  const openTasks = await prisma.task.findMany({
    where: { complianceItem: { company: { organizationId: org.id } }, status: 'TODO' },
    orderBy: { dueDate: 'asc' },
    take: 24,
    select: { id: true },
  });
  await Promise.all(
    openTasks.map((task, i) =>
      prisma.task.update({
        where: { id: task.id },
        data: { assigneeId: i % 3 === 0 ? owner.id : i % 3 === 1 ? associate.id : null, status: i % 4 === 0 ? 'IN_PROGRESS' : 'TODO' },
      }),
    ),
  );

  for (const company of [pvtLtd, llp]) {
    const snapshot = await snapshotScore(superAdmin, company.id);
    logger.info({ company: company.legalName, score: snapshot.score, band: snapshot.band }, 'score snapshot');
  }

  // Arun is a practitioner: he sees only what he has been granted.
  for (const company of [pvtLtd, llp]) {
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: associate.id, companyId: company.id } },
      create: { userId: associate.id, companyId: company.id, role: 'CA', grantedById: owner.id },
      update: {},
    });
  }

  // A client's own login, which must see its entity and nothing else.
  const client = await prisma.user.upsert({
    where: { email: 'client@northwind.test' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'client@northwind.test',
      name: 'Sanjay Mehta',
      passwordHash: password,
      role: 'COMPANY_OWNER',
    },
  });
  await prisma.companyMembership.upsert({
    where: { userId_companyId: { userId: client.id, companyId: pvtLtd.id } },
    create: { userId: client.id, companyId: pvtLtd.id, role: 'COMPANY_OWNER', grantedById: owner.id },
    update: {},
  });

  const counts = {
    companies: await prisma.company.count({ where: { organizationId: org.id } }),
    items: await prisma.complianceItem.count({ where: { company: { organizationId: org.id } } }),
    tasks: await prisma.task.count({ where: { complianceItem: { company: { organizationId: org.id } } } }),
  };

  logger.info(counts, 'seed complete');
  console.log('\n  Sign in with:');
  console.log('    owner@demo.test        / DemoPassword1   super admin — every company');
  console.log('    associate@demo.test    / DemoPassword1   CA          — Northwind and Sundar only');
  console.log('    client@northwind.test  / DemoPassword1   company owner — Northwind only\n');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
