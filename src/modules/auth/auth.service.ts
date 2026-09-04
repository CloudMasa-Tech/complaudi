import bcrypt from 'bcryptjs';
import type { User, UserRole } from '@prisma/client';
import { env } from '../../config/env';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../../lib/errors';
import { GRANTABLE_ROLES, capabilitiesOf, seesEveryCompany, type Actor } from '../../lib/access';
import {
  generateTemporaryPassword,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/jwt';
import { prisma } from '../../lib/prisma';
import { addDays, parseDate } from '../../lib/dates';
import { decodeCin, normalisePhone } from '../../lib/india';
import { syncCompany } from '../compliance/compliance.service';
import type { InviteInput, LoginInput, RegisterInput, TrialSignupInput } from './auth.schemas';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string; organizationId: string };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'org';
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const exists = await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${root}-${Date.now()}`;
}

async function issueTokens(user: User): Promise<AuthResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    org: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
  });
  const refreshToken = signRefreshToken(user.id);
  const decoded = verifyRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(decoded.exp * 1000),
    },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    },
  };
}

/** Creates the organization and its first user, who becomes the OWNER. */
export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new ConflictError('An account with this email already exists');

  const slug = await uniqueSlug(slugify(input.organizationName));
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.organizationName, slug } });
    return tx.user.create({
      data: {
        organizationId: org.id,
        email: input.email,
        name: input.name,
        passwordHash,
        // The first account in a new organisation runs it.
        role: 'SUPER_ADMIN',
      },
    });
  });

  return issueTokens(user);
}

/** How long a self-service trial lasts. */
export const TRIAL_DAYS = 14;

/**
 * Self-service enrolment.
 *
 * Creates the organisation, the person, their company and the compliance
 * calendar in one step, so the first screen they see has their own obligations
 * on it rather than an empty state.
 *
 * They are a VIEWER on their own company: the trial is for seeing what applies
 * to them, not for running the filings. Everything is kept on upgrade — the
 * role widens, nothing is rebuilt.
 */
export async function registerTrial(input: TrialSignupInput): Promise<AuthResult & { trialEndsAt: Date }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new ConflictError('An account with this email already exists');

  const phone = normalisePhone(input.phone);
  if (!phone) throw new BadRequestError('Enter a 10-digit Indian mobile number.');

  // A CIN settles these, so it overrides whatever the form defaulted to.
  const decoded = input.cin ? decodeCin(input.cin) : null;
  const entityType = (decoded?.entityType as TrialSignupInput['entityType']) ?? input.entityType;
  const stateCode = decoded?.stateCode ?? input.stateCode!.toUpperCase();

  const slug = await uniqueSlug(slugify(input.companyName));
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const trialEndsAt = addDays(new Date(), TRIAL_DAYS);

  const { user, companyId } = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.companyName, slug, trialEndsAt },
    });

    const created = await tx.user.create({
      data: {
        organizationId: org.id,
        email: input.email,
        name: input.name,
        phone,
        passwordHash,
        // A self-service signup owns the entity they just described, so they
        // arrive as its COMPANY_OWNER: they can complete the profile, run the
        // engine and attach evidence, plus invite their CA/ADMIN into their own
        // company. (Previously ADMIN.) A viewer could do none of that, which
        // left a trial showing an empty company and no way to fill it in — and
        // the profile is what the entire calendar is computed from.
        role: 'COMPANY_OWNER',
      },
    });

    const company = await tx.company.create({
      data: {
        organizationId: org.id,
        legalName: input.companyName,
        entityType,
        stateCode,
        cin: decoded?.cin ?? null,
        incorporationDate: parseDate(input.incorporationDate),
        isListed: decoded?.listed ?? false,
        industry: decoded?.industry ?? null,
        memberships: { create: [{ userId: created.id, role: 'COMPANY_OWNER', grantedById: created.id }] },
      },
      select: { id: true },
    });

    return { user: created, companyId: company.id };
  });

  // Their own grant carries company.sync now, so the first calendar is built as
  // them rather than as a borrowed super admin.
  await syncCompany({ userId: user.id, organizationId: user.organizationId, role: user.role }, companyId);

  return { ...(await issueTokens(user)), trialEndsAt };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Compare against a dummy hash when the user is unknown so response timing
  // does not reveal whether the email exists.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = await bcrypt.compare(input.password, hash);

  if (!user || !ok) throw new UnauthorizedError('Email or password is incorrect');
  if (!user.isActive) throw new UnauthorizedError('This account has been deactivated');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueTokens(user);
}

/** Rotates the refresh token: the presented one is revoked as the new pair is issued. */
export async function refresh(token: string): Promise<AuthResult> {
  const decoded = verifyRefreshToken(token);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token is no longer valid');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) throw new UnauthorizedError('Account is unavailable');

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return issueTokens(user);
}

export async function logout(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function logoutEverywhere(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Creates a user and, in the same transaction, the grants that decide what they
 * can see. A practitioner created without grants sees an empty application,
 * which is the safe default but rarely what was meant — so the grants are part
 * of the same call rather than a step someone can forget.
 */
export async function inviteUser(actor: Actor, input: InviteInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new ConflictError('An account with this email already exists');

  // An organisation-wide role sees everything, so grants would be noise.
  const wanted = seesEveryCompany(input.role) ? [] : input.companyIds;

  // Only companies in the actor's own organisation may be granted.
  const companies = wanted.length
    ? await prisma.company.findMany({
        where: { id: { in: wanted }, organizationId: actor.organizationId },
        select: { id: true },
      })
    : [];
  if (companies.length !== wanted.length) {
    throw new BadRequestError('One or more companies do not belong to this organization');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  return prisma.user.create({
    data: {
      organizationId: actor.organizationId,
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      memberships: {
        create: companies.map((c) => ({ companyId: c.id, role: input.role, grantedById: actor.userId })),
      },
    },
    select: {
      id: true, name: true, email: true, role: true, createdAt: true,
      memberships: { select: { companyId: true, role: true } },
    },
  });
}

export async function listUsers(actor: Actor) {
  const users = await prisma.user.findMany({
    where: { organizationId: actor.organizationId },
    select: {
      id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true,
      memberships: {
        select: { companyId: true, role: true, company: { select: { legalName: true, isActive: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return users.map((u) => ({
    ...u,
    // Organisation-wide roles hold no grants; saying "all companies" is truer
    // than reporting zero.
    seesEveryCompany: seesEveryCompany(u.role),
    companies: u.memberships.map((m) => ({
      companyId: m.companyId,
      role: m.role,
      legalName: m.company.legalName,
      isActive: m.company.isActive,
    })),
    memberships: undefined,
  }));
}

/** Replaces a user's grants wholesale — the shape the access screen edits. */
export async function setCompanyAccess(
  actor: Actor,
  userId: string,
  grants: Array<{ companyId: string; role: UserRole }>,
) {
  const target = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { id: true, role: true, name: true },
  });
  if (!target) throw new NotFoundError('User');

  if (seesEveryCompany(target.role)) {
    throw new BadRequestError(
      `${target.name} is a ${target.role === 'SUPER_ADMIN' ? 'super admin' : 'admin'} and already sees every company. ` +
        'Change their role first if you want to restrict them.',
    );
  }

  const orgWide = grants.filter((g) => !GRANTABLE_ROLES.includes(g.role));
  if (orgWide.length) {
    throw new BadRequestError(
      'A grant cannot carry an organisation-wide role. Admins and super admins already see every company — ' +
        'set that on the person instead.',
    );
  }

  const ids = grants.map((g) => g.companyId);
  const companies = ids.length
    ? await prisma.company.findMany({
        where: { id: { in: ids }, organizationId: actor.organizationId },
        select: { id: true },
      })
    : [];
  if (companies.length !== new Set(ids).size) {
    throw new BadRequestError('One or more companies do not belong to this organization');
  }

  const keep = ids.length ? ids : ['-'];

  await prisma.$transaction([
    prisma.companyMembership.deleteMany({ where: { userId, companyId: { notIn: keep } } }),
    ...grants.map((g) =>
      prisma.companyMembership.upsert({
        where: { userId_companyId: { userId, companyId: g.companyId } },
        create: { userId, companyId: g.companyId, role: g.role, grantedById: actor.userId },
        update: { role: g.role, grantedById: actor.userId },
      }),
    ),
    // Revoking access has to release the work too. Otherwise a filing stays
    // assigned to someone who can no longer open it — it shows up in their
    // name on the workload panel and nobody picks it up.
    prisma.task.updateMany({
      where: { assigneeId: userId, companyId: { notIn: keep }, status: { notIn: ['DONE', 'CANCELLED'] } },
      data: { assigneeId: null },
    }),
  ]);

  // The People list reports one role per person. Grants that unanimously carry a
  // different one have to move it, or the list keeps naming a role the person
  // holds nowhere. Mixed grants leave it alone — there is no single role to
  // report, and the list says so instead of picking one.
  const roles = new Set(grants.map((g) => g.role));
  if (roles.size === 1 && !roles.has(target.role)) {
    const [role] = [...roles];
    await prisma.user.update({ where: { id: userId }, data: { role } });
    // A viewer is read-only, so they cannot stay on the hook for open work.
    if (role === 'VIEWER') {
      await prisma.task.updateMany({
        where: { assigneeId: userId, status: { notIn: ['DONE', 'CANCELLED'] } },
        data: { assigneeId: null },
      });
    }
  }

  return prisma.companyMembership.findMany({
    where: { userId },
    select: { companyId: true, role: true, company: { select: { legalName: true } } },
  });
}

export async function updateUser(
  actor: Actor,
  userId: string,
  input: { name?: string; email?: string; role?: UserRole; isActive?: boolean },
) {
  const target = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { id: true, role: true },
  });
  if (!target) throw new NotFoundError('User');

  // Losing the last super admin would leave the organisation with nobody able
  // to grant access again.
  const losingSuperAdmin =
    target.role === 'SUPER_ADMIN' && (input.role !== undefined ? input.role !== 'SUPER_ADMIN' : input.isActive === false);
  if (losingSuperAdmin) {
    const others = await prisma.user.count({
      where: { organizationId: actor.organizationId, role: 'SUPER_ADMIN', isActive: true, id: { not: userId } },
    });
    if (others === 0) throw new BadRequestError('This is the only active super admin — promote someone else first.');
  }

  // Email is the login identifier, so a clash has to be caught before the write
  // rather than surfacing as an opaque constraint violation.
  if (input.email) {
    const clash = await prisma.user.findFirst({
      where: { email: input.email, id: { not: userId } },
      select: { id: true },
    });
    if (clash) throw new ConflictError('Another account already uses that email address');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  // A super admin's grants are ignored for as long as they are one — every scope
  // and capability check short-circuits on `seesEveryCompany` — so promotion
  // leaves them where they are. Deleting them made the promotion one-way: demote
  // the person afterwards and they held nothing, with no record of what they had.
  if (input.role && !seesEveryCompany(input.role) && !seesEveryCompany(target.role)) {
    // The grant decides what someone may do on a company, so a role set here has
    // to reach the grants. Left behind, they kept overriding it: the role saved,
    // the list showed the new one, and the person's access never moved.
    //
    // Demotion from an organisation-wide role is the exception guarded above:
    // those grants were dormant rather than overridden, so they come back
    // carrying the roles they were given, not flattened to this one.
    await prisma.companyMembership.updateMany({ where: { userId }, data: { role: input.role } });
  }

  // A super admin administers rather than works, and a viewer is read-only, so
  // neither may hold open work once they become one.
  if ((input.role && ['SUPER_ADMIN', 'VIEWER'].includes(input.role)) || input.isActive === false) {
    await prisma.task.updateMany({
      where: { assigneeId: userId, status: { notIn: ['DONE', 'CANCELLED'] } },
      data: { assigneeId: null },
    });
  }

  return updated;
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      organization: { select: { id: true, name: true, slug: true, trialEndsAt: true } },
      _count: { select: { memberships: true } },
    },
  });
  if (!user) return null;

  // The UI gates on capabilities rather than re-deriving them from the role, so
  // the two can never disagree about what a role may do.
  const trialEndsAt = user.organization.trialEndsAt;
  return {
    ...user,
    trialEndsAt,
    trialDaysLeft: trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null,
    capabilities: capabilitiesOf(user.role),
    seesEveryCompany: seesEveryCompany(user.role),
    companyCount: user._count.memberships,
  };
}

/** Applied to a chosen password; a generated one satisfies these by construction. */
function assertPasswordPolicy(password: string): void {
  const failures: string[] = [];
  if (password.length < 10) failures.push('at least 10 characters');
  if (!/[a-z]/.test(password)) failures.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('an uppercase letter');
  if (!/[0-9]/.test(password)) failures.push('a digit');
  if (failures.length) throw new BadRequestError(`The password needs ${failures.join(', ')}.`);
}

/**
 * A super admin sets a new password for someone who cannot get in.
 *
 * The password is returned once, to be handed over out of band. It is never
 * stored in the clear and never written to the audit log — the log records that
 * a reset happened and who did it, which is the part that matters later.
 *
 * Every live session ends: refresh tokens are revoked, and `passwordChangedAt`
 * makes access tokens minted beforehand invalid on their next request. A reset
 * that leaves the old session working is not a reset.
 */
export async function resetPassword(actor: Actor, userId: string, chosen?: string) {
  const target = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { id: true, name: true, email: true },
  });
  if (!target) throw new NotFoundError('User');

  const password = chosen?.trim() || generateTemporaryPassword();
  if (chosen) assertPasswordPolicy(password);

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const changedAt = new Date();

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: changedAt } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: changedAt } }),
  ]);

  return { user: { id: target.id, name: target.name, email: target.email }, password, generated: !chosen };
}

/** Changing your own password requires proving you know the current one. */
export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, passwordHash: true } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new UnauthorizedError('Your current password is not correct');
  }

  assertPasswordPolicy(newPassword);
  const changedAt = new Date();
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: changedAt } }),
    // Other devices are signed out; this one gets a fresh pair below.
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: changedAt } }),
  ]);

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return issueTokens(fresh);
}
