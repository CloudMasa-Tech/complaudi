import type { Prisma, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  accessSummary,
  assertCan,
  capabilitiesOf,
  companyScope,
  effectiveRole,
  seesEveryCompany,
  type Actor,
} from '../../lib/access';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { parseDate } from '../../lib/dates';
import { stateCodeFromGstin, validateGstin } from '../../lib/india';
import { parseMcaMasterData } from '../../lib/mcaMasterData';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { env } from '../../config/env';
import { generateTemporaryPassword } from '../../lib/jwt';
import { sendMail } from '../../lib/mailer';
import { inviteHtml, inviteSubject, inviteText } from '../notifications/templates';
import { canInviteAs, INVITER_ROLES } from './company-invite';
import type { CreateCompanyInput, UpdateCompanyInput } from './companies.schemas';

const d = (v?: string | null): Date | null => (v ? parseDate(v) : null);

/** Everything the compliance engine and the UI need in one shape. */
export const companyInclude = {
  directors: { orderBy: { createdAt: 'asc' } },
  gstRegistrations: { orderBy: { createdAt: 'asc' } },
  msmeRegistration: true,
} satisfies Prisma.CompanyInclude;

export type CompanyWithProfile = Prisma.CompanyGetPayload<{ include: typeof companyInclude }>;

/**
 * Every read is scoped by organization id, not just company id — an id guessed
 * or leaked from another tenant must not resolve.
 */
export async function getCompanyOrThrow(actor: Actor, companyId: string): Promise<CompanyWithProfile> {
  const company = await prisma.company.findFirst({
    where: companyScope(actor, companyId),
    include: companyInclude,
  });
  if (!company) throw new NotFoundError('Company');
  return company;
}

function assertGstinsAreConsistent(
  gstRegistrations: CreateCompanyInput['gstRegistrations'],
  pan: string | null | undefined,
): void {
  const errors: Array<{ gstin: string; problems: string[] }> = [];
  const seen = new Set<string>();

  for (const reg of gstRegistrations) {
    const result = validateGstin(reg.gstin, pan);
    const problems = [...result.errors];
    if (seen.has(reg.gstin)) problems.push('This GSTIN is listed more than once');
    seen.add(reg.gstin);
    if (problems.length) errors.push({ gstin: reg.gstin, problems });
  }

  if (errors.length) throw new BadRequestError('One or more GST registrations are invalid', errors);
}

export async function createCompany(actor: Actor, input: CreateCompanyInput): Promise<CompanyWithProfile> {
  assertGstinsAreConsistent(input.gstRegistrations, input.pan);

  // A scoped user who onboards a company must hold it, or they would create
  // something they cannot then open.
  const grantToCreator = seesEveryCompany(actor.role)
    ? {}
    : { memberships: { create: [{ userId: actor.userId, role: actor.role, grantedById: actor.userId }] } };

  return prisma.company.create({
    data: {
      organizationId: actor.organizationId,
      legalName: input.legalName,
      brandName: input.brandName ?? null,
      entityType: input.entityType,
      cin: input.cin ?? null,
      llpin: input.llpin ?? null,
      pan: input.pan ?? null,
      tan: input.tan ?? null,
      incorporationDate: d(input.incorporationDate),
      stateCode: input.stateCode,
      industry: input.industry ?? null,
      employeeCount: input.employeeCount,
      annualTurnover: input.annualTurnover,
      paidUpCapital: input.paidUpCapital,
      cashTransactionRatioBelow5Pct: input.cashTransactionRatioBelow5Pct,
      hasForeignTransactions: input.hasForeignTransactions,
      acceptsDeposits: input.acceptsDeposits,
      isListed: input.isListed,
      buysFromMsmeSuppliers: input.buysFromMsmeSuppliers,
      agmDate: d(input.agmDate),
      dpiitRecognitionNumber: input.dpiitRecognitionNumber ?? null,
      dpiitRecognisedOn: d(input.dpiitRecognisedOn),
      epfoCode: input.epfoCode ?? null,
      esicCode: input.esicCode ?? null,
      ...grantToCreator,
      directors: {
        create: input.directors.map((dir) => ({
          name: dir.name,
          din: dir.din ?? null,
          email: dir.email ?? null,
          designation: dir.designation,
          appointedOn: d(dir.appointedOn),
          resignedOn: d(dir.resignedOn),
          isResident: dir.isResident,
          dscExpiresOn: d(dir.dscExpiresOn),
        })),
      },
      gstRegistrations: {
        create: input.gstRegistrations.map((reg) => ({
          gstin: reg.gstin,
          // Derive the state from the GSTIN itself when the caller did not say.
          stateCode: reg.stateCode ?? stateCodeFromGstin(reg.gstin) ?? input.stateCode,
          legalName: reg.legalName ?? null,
          filingFrequency: reg.filingFrequency,
          isTdsDeductor: reg.isTdsDeductor,
          isEcommerceOperator: reg.isEcommerceOperator,
          registeredOn: d(reg.registeredOn),
          isActive: reg.isActive,
        })),
      },
      ...(input.msmeRegistration
        ? {
            msmeRegistration: {
              create: {
                udyamNumber: input.msmeRegistration.udyamNumber,
                category: input.msmeRegistration.category,
                registeredOn: d(input.msmeRegistration.registeredOn),
              },
            },
          }
        : {}),
    },
    include: companyInclude,
  });
}

export async function listCompanies(
  actor: Actor,
  filters: { search?: string; entityType?: CreateCompanyInput['entityType']; includeInactive: boolean },
) {
  return prisma.company.findMany({
    where: {
      ...companyScope(actor),
      // `includeInactive` only widens what an admin may browse; it can never
      // reach past the grants a scoped user actually holds.
      ...(filters.includeInactive && seesEveryCompany(actor.role) ? { isActive: undefined } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.search
        ? {
            OR: [
              { legalName: { contains: filters.search, mode: 'insensitive' as const } },
              { brandName: { contains: filters.search, mode: 'insensitive' as const } },
              { cin: { contains: filters.search.toUpperCase() } },
              { pan: { contains: filters.search.toUpperCase() } },
            ],
          }
        : {}),
    },
    include: companyInclude,
    orderBy: { legalName: 'asc' },
  });
}

/**
 * Platform-wide onboarding view for the SUPER_ADMIN.
 *
 * The SUPER_ADMIN owns the installation, not one firm, so this lists every
 * self-onboarded company across every organisation without any tenant filter.
 * It is a pure read: access for this role is role-based, never row-based, so
 * no membership rows are created and nothing here can duplicate on re-run.
 *
 * `onboardedBy` is derived, not stored: the first user to grant themselves on
 * the company is the one who enrolled it. `onboardedAt` is the company's own
 * creation timestamp and `status` its `isActive` flag.
 */
export async function listSuperAdminCompanies(actor: Actor) {
  if (!seesEveryCompany(actor.role)) {
    throw new ForbiddenError('Only the platform super admin can browse every onboarded company.');
  }

  const companies = await prisma.company.findMany({
    select: {
      id: true,
      legalName: true,
      entityType: true,
      isActive: true,
      createdAt: true,
      organization: { select: { id: true, name: true, slug: true } },
      memberships: {
        // The earliest self-grant identifies who onboarded the company.
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          createdAt: true,
          grantedBy: { select: { id: true, name: true, email: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return companies.map((c) => {
    const first = c.memberships[0];
    const onboardedBy = first?.grantedBy ?? first?.user ?? null;
    return {
      id: c.id,
      legalName: c.legalName,
      entityType: c.entityType,
      status: c.isActive ? 'ACTIVE' : 'ARCHIVED',
      onboardedAt: c.createdAt,
      organization: c.organization,
      onboardedBy: onboardedBy
        ? { id: onboardedBy.id, name: onboardedBy.name, email: onboardedBy.email }
        : null,
    };
  });
}

/**
 * Invite someone into a single company.
 *
 * Strictly company-scoped: the inviter must already hold the company (via the
 * same scope every other company read uses), the invitee lands in the inviter's
 * organisation with a grant on that one company alone, and the target role can
 * never exceed what the inviter is entitled to grant. This deliberately does not
 * reach the org-wide `users.manage` path — a COMPANY_OWNER added to a shared
 * organisation later will still only shape their own company's team.
 */
export async function inviteToCompany(
  actor: Actor,
  companyId: string,
  input: { email: string; name: string; role: UserRole },
): Promise<{
  user: { id: string; name: string; email: string; role: string };
  companies: string[];
}> {
  // Resolves only a company the inviter can see — org + membership scoped.
  const company = await getCompanyOrThrow(actor, companyId);

  // Inviting a team is a full-account feature. The organisation's trial status
  // is authoritative — while a self-service trial is running there is no room
  // to grow the team, so refuse before any user is created.
  const organization = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { trialEndsAt: true },
  });
  const trialEndsAt = organization?.trialEndsAt ?? null;
  if (trialEndsAt && trialEndsAt.getTime() > Date.now()) {
    throw new ForbiddenError('Inviting team members is available after upgrading from the trial.');
  }

  const inviterRole = await effectiveRole(actor, companyId);
  if (!inviterRole || !INVITER_ROLES.includes(inviterRole)) {
    throw new ForbiddenError('You do not have permission to invite people into this company.');
  }
  if (!canInviteAs(inviterRole, input.role)) {
    throw new ForbiddenError(
      `A ${inviterRole} cannot grant the ${input.role} role in this company.`,
    );
  }

  const existing = await prisma.user.findFirst({
    where: { email: input.email.toLowerCase(), organizationId: actor.organizationId },
    select: { id: true },
  });
  if (existing) throw new ConflictError('An account with this email already exists in your organisation.');

  const password = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  const created = await prisma.user.create({
    data: {
      organizationId: actor.organizationId,
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash,
      role: input.role,
      memberships: {
        // Unique (userId, companyId), so re-inviting the same person/company can
        // never create a duplicate grant.
        create: [{ companyId: company.id, role: input.role, grantedById: actor.userId }],
      },
    },
    select: { id: true, name: true, email: true, role: true },
  });

  // Deliver the invite out of band: email the signup link rather than printing
  // the temporary password on any screen. The password itself is never shown.
  const inviter = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true },
  });
  const signupUrl = `${env.APP_BASE_URL}/register?invite=${encodeURIComponent(created.email)}`;
  const inviteData = {
    inviterName: inviter?.name || 'A colleague',
    companyName: company.legalName,
    role: created.role,
    signupUrl,
  };
  try {
    await sendMail({
      to: created.email,
      subject: inviteSubject(created.name, company.legalName),
      text: inviteText(created.name, inviteData),
      html: inviteHtml(created.name, inviteData),
    });
  } catch (err) {
    // The member is created but delivery failed — do not fail the whole request,
    // but log it so an operator can resend. The UI confirms the invite regardless.
    logger.error({ err, invitationEmail: created.email }, 'failed to send company invite email');
  }

  return { user: created, companies: [company.id] };
}

/** People already inside a company — the inviter's own team views. */
export async function listCompanyMembers(actor: Actor, companyId: string) {
  const company = await getCompanyOrThrow(actor, companyId);
  const members = await prisma.companyMembership.findMany({
    where: { companyId: company.id },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, isActive: true } },
      grantedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return members.map((m) => ({
    role: m.role,
    since: m.createdAt,
    member: m.user,
    invitedBy: m.grantedBy,
  }));
}

export async function updateCompany(
  actor: Actor,
  companyId: string,
  input: UpdateCompanyInput,
): Promise<CompanyWithProfile> {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');

  const data: Prisma.CompanyUpdateInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'incorporationDate' || key === 'agmDate' || key === 'dpiitRecognisedOn') {
      (data as Record<string, unknown>)[key] = d(value as string | null);
    } else {
      (data as Record<string, unknown>)[key] = value;
    }
  }

  // User has now reviewed and confirmed their profile data
  data.profileConfirmedAt = new Date();

  return prisma.company.update({ where: { id: companyId }, data, include: companyInclude });
}

/**
 * Archiving is the default way to remove a company: it disappears from every
 * org-wide view but keeps its filing history, evidence and score intact, and
 * can be brought back.
 */
export async function archiveCompany(actor: Actor, companyId: string) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.archive');
  return prisma.company.update({ where: { id: companyId }, data: { isActive: false }, include: companyInclude });
}

export async function restoreCompany(actor: Actor, companyId: string) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.archive');
  return prisma.company.update({ where: { id: companyId }, data: { isActive: true }, include: companyInclude });
}

/** What a permanent delete would destroy — shown before it is confirmed. */
export async function deletionImpact(actor: Actor, companyId: string) {
  const company = await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.delete');
  const [items, completed, documents, tasks] = await Promise.all([
    prisma.complianceItem.count({ where: { companyId } }),
    prisma.complianceItem.count({ where: { companyId, status: 'COMPLETED' } }),
    prisma.document.count({ where: { companyId } }),
    prisma.task.count({ where: { companyId } }),
  ]);
  return { company: { id: company.id, legalName: company.legalName, isActive: company.isActive }, items, completed, documents, tasks };
}

/**
 * Irreversible. Everything cascades — obligations, tasks, evidence rows, score
 * history — so the stored files are removed first, otherwise the bucket keeps
 * objects nothing points at any more.
 *
 * The audit log is scoped to the organization rather than the company, so the
 * record that this happened, and who did it, survives the deletion.
 */
export async function deleteCompanyPermanently(
  actor: Actor,
  companyId: string,
  confirmation: string,
): Promise<{ deletedItems: number; deletedDocuments: number }> {
  const company = await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.delete');

  // Typing the name is the confirmation. Anything less is a misclick away from
  // destroying a company's entire compliance history.
  if (confirmation.trim() !== company.legalName) {
    throw new BadRequestError(
      'To delete permanently, type the company name exactly as it is recorded.',
      { expected: company.legalName },
    );
  }

  const documents = await prisma.document.findMany({ where: { companyId }, select: { storageKey: true } });
  const items = await prisma.complianceItem.count({ where: { companyId } });

  for (const doc of documents) {
    // A file that will not delete must not block the record from going.
    await storage.remove(doc.storageKey).catch((err) => logger.warn({ err, key: doc.storageKey }, 'orphaned storage object'));
  }

  await prisma.company.delete({ where: { id: companyId } });
  logger.warn({ companyId, legalName: company.legalName, items, documents: documents.length }, 'company permanently deleted');

  return { deletedItems: items, deletedDocuments: documents.length };
}

// ---------------------------------------------------------------- directors

export async function addDirector(actor: Actor, companyId: string, input: Record<string, unknown>) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  return prisma.director.create({
    data: {
      companyId,
      name: input.name as string,
      din: (input.din as string | null) ?? null,
      email: (input.email as string | null) ?? null,
      designation: (input.designation as string) ?? 'Director',
      appointedOn: d(input.appointedOn as string | null),
      resignedOn: d(input.resignedOn as string | null),
      isResident: (input.isResident as boolean) ?? true,
      dscExpiresOn: d(input.dscExpiresOn as string | null),
    },
  });
}

export async function updateDirector(
  actor: Actor,
  companyId: string,
  directorId: string,
  input: Record<string, unknown>,
) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  const existing = await prisma.director.findFirst({ where: { id: directorId, companyId } });
  if (!existing) throw new NotFoundError('Director');

  return prisma.director.update({
    where: { id: directorId },
    data: {
      ...(input.name !== undefined ? { name: input.name as string } : {}),
      ...(input.din !== undefined ? { din: input.din as string | null } : {}),
      ...(input.email !== undefined ? { email: input.email as string | null } : {}),
      ...(input.designation !== undefined ? { designation: input.designation as string } : {}),
      ...(input.appointedOn !== undefined ? { appointedOn: d(input.appointedOn as string | null) } : {}),
      ...(input.resignedOn !== undefined ? { resignedOn: d(input.resignedOn as string | null) } : {}),
      ...(input.isResident !== undefined ? { isResident: input.isResident as boolean } : {}),
      ...(input.dscExpiresOn !== undefined ? { dscExpiresOn: d(input.dscExpiresOn as string | null) } : {}),
    },
  });
}

export async function removeDirector(actor: Actor, companyId: string, directorId: string) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  const { count } = await prisma.director.deleteMany({ where: { id: directorId, companyId } });
  if (count === 0) throw new NotFoundError('Director');
}

// ---------------------------------------------------------------- GST

export async function addGstRegistration(actor: Actor, companyId: string, input: Record<string, unknown>) {
  const company = await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  const gstin = input.gstin as string;

  const result = validateGstin(gstin, company.pan);
  // Same detail shape as the bulk path, so the client can put the message
  // against the GSTIN field instead of falling back to a page-level banner.
  if (!result.valid) {
    throw new BadRequestError('GST registration is invalid', [{ gstin, problems: result.errors }]);
  }

  return prisma.gstRegistration.create({
    data: {
      companyId,
      gstin,
      stateCode: (input.stateCode as string) ?? result.stateCode ?? company.stateCode,
      legalName: (input.legalName as string | null) ?? null,
      filingFrequency: (input.filingFrequency as 'MONTHLY' | 'QRMP' | 'COMPOSITION') ?? 'MONTHLY',
      isTdsDeductor: (input.isTdsDeductor as boolean) ?? false,
      isEcommerceOperator: (input.isEcommerceOperator as boolean) ?? false,
      registeredOn: d(input.registeredOn as string | null),
      isActive: (input.isActive as boolean) ?? true,
    },
  });
}

export async function updateGstRegistration(
  actor: Actor,
  companyId: string,
  registrationId: string,
  input: Record<string, unknown>,
) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  const existing = await prisma.gstRegistration.findFirst({ where: { id: registrationId, companyId } });
  if (!existing) throw new NotFoundError('GST registration');

  return prisma.gstRegistration.update({
    where: { id: registrationId },
    data: {
      ...(input.filingFrequency !== undefined ? { filingFrequency: input.filingFrequency as 'MONTHLY' } : {}),
      ...(input.isTdsDeductor !== undefined ? { isTdsDeductor: input.isTdsDeductor as boolean } : {}),
      ...(input.isEcommerceOperator !== undefined ? { isEcommerceOperator: input.isEcommerceOperator as boolean } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName as string | null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive as boolean } : {}),
      ...(input.registeredOn !== undefined ? { registeredOn: d(input.registeredOn as string | null) } : {}),
    },
  });
}

export async function removeGstRegistration(actor: Actor, companyId: string, registrationId: string) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  const { count } = await prisma.gstRegistration.deleteMany({ where: { id: registrationId, companyId } });
  if (count === 0) throw new NotFoundError('GST registration');
}

// ---------------------------------------------------------------- MSME

export async function upsertMsmeRegistration(
  actor: Actor,
  companyId: string,
  input: { udyamNumber: string; category: 'MICRO' | 'SMALL' | 'MEDIUM'; registeredOn?: string | null },
) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  const data = {
    udyamNumber: input.udyamNumber,
    category: input.category,
    registeredOn: d(input.registeredOn),
  };
  return prisma.msmeRegistration.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });
}

export async function removeMsmeRegistration(actor: Actor, companyId: string) {
  await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');
  await prisma.msmeRegistration.deleteMany({ where: { companyId } });
}

/**
 * Tags each company with what *this* actor may do on it.
 *
 * The front end gates buttons per company rather than per session, because the
 * grant is authoritative: the same person may be a CA on one client and a
 * viewer on the next.
 */
export async function withMyAccess<T extends { id: string }>(actor: Actor, companies: T[]) {
  const summary = await accessSummary(actor);
  const everywhere = seesEveryCompany(actor.role);

  return companies.map((company) => {
    const grant = summary.get(company.id);
    const role = everywhere ? actor.role : grant?.role ?? null;
    return {
      ...company,
      myRole: role,
      myCapabilities: role ? capabilitiesOf(role) : [],
    };
  });
}

export interface McaImportResult {
  matchedBy: 'cin' | 'only-row';
  applied: Array<{ field: string; from: string | null; to: string }>;
  skipped: Array<{ field: string; why: string }>;
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  rowsInFile: number;
}

/**
 * Fills a company's profile from an MCA master-data extract.
 *
 * Applies only what the file actually carries, and reports every field it
 * changed and every one it left alone — a silent bulk overwrite of a compliance
 * profile is not something anyone should have to reverse-engineer afterwards.
 */
export async function importMcaMasterData(
  actor: Actor,
  companyId: string,
  csv: string,
): Promise<McaImportResult> {
  const company = await getCompanyOrThrow(actor, companyId);
  await assertCan(actor, companyId, 'company.edit');

  const parsed = parseMcaMasterData(csv);
  if (parsed.records.length === 0) {
    throw new BadRequestError(
      'No usable rows found. The file needs a column holding the CIN — MCA extracts call it ' +
        '"CORPORATE_IDENTIFICATION_NUMBER" — and at least one row with a valid one.',
      { recognisedColumns: parsed.recognisedColumns, rowsInFile: parsed.rowCount },
    );
  }

  // Match on the CIN we already hold; fall back to the single row in a
  // one-company extract, which is what someone downloading their own record gets.
  const byCin = company.cin ? parsed.records.find((r) => r.cin === company.cin) : undefined;
  const record = byCin ?? (parsed.records.length === 1 ? parsed.records[0]! : undefined);

  if (!record) {
    throw new BadRequestError(
      `The file holds ${parsed.records.length} companies and none of them carries this company's CIN. ` +
        'Record the CIN on the company first, or upload the extract for this entity alone.',
    );
  }

  const applied: McaImportResult['applied'] = [];
  const skipped: McaImportResult['skipped'] = [];
  const data: Prisma.CompanyUpdateInput = {};

  const take = <T>(
    field: string,
    incoming: T | null,
    current: unknown,
    write: (v: T) => void,
    show: (v: T) => string = (v) => String(v),
  ) => {
    if (incoming === null || incoming === undefined) {
      skipped.push({ field, why: 'not present in the file' });
      return;
    }
    const before = current === null || current === undefined ? null : show(current as T);
    const after = show(incoming);
    if (before === after) return;
    write(incoming);
    applied.push({ field, from: before, to: after });
  };

  take('cin', record.cin, company.cin, (v) => { data.cin = v; });
  take('legalName', record.name, company.legalName, (v) => { data.legalName = v; });
  take(
    'incorporationDate',
    record.incorporatedOn,
    company.incorporationDate,
    (v) => { data.incorporationDate = v; },
    (v) => (v as Date).toISOString().slice(0, 10),
  );
  take('stateCode', record.stateCode, company.stateCode, (v) => { data.stateCode = v; });
  take('entityType', record.entityType as CreateCompanyInput['entityType'] | null, company.entityType, (v) => { data.entityType = v; });
  take('industry', record.industry, company.industry, (v) => { data.industry = v; });
  take(
    'paidUpCapital',
    record.paidUpCapital,
    Number(company.paidUpCapital),
    (v) => { data.paidUpCapital = BigInt(v); },
    (v) => String(v),
  );

  if (Object.keys(data).length > 0) {
    await prisma.company.update({ where: { id: companyId }, data });
  }

  return {
    matchedBy: byCin ? 'cin' : 'only-row',
    applied,
    skipped,
    recognisedColumns: parsed.recognisedColumns,
    unrecognisedColumns: parsed.unrecognisedColumns,
    rowsInFile: parsed.rowCount,
  };
}
