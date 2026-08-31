/**
 * Who can see what, and do what to it.
 *
 * Two independent questions, deliberately kept apart:
 *
 *   *Scope*      — which companies exist for this user at all. Enforced in the
 *                  query, never by filtering after the fact, so a company a user
 *                  has no grant for cannot be reached even by guessing its id.
 *   *Capability* — what they may do with one they can see.
 *
 * Tenant isolation by organisation sits underneath both and is never crossed:
 * a SUPER_ADMIN is the top of *their* firm, not of the installation.
 */
import type { Prisma, UserRole } from '@prisma/client';
import { ForbiddenError } from './errors';
import { prisma } from './prisma';

export interface Actor {
  userId: string;
  organizationId: string;
  role: UserRole;
}

/**
 * Only the super admin sees the whole organisation without a grant.
 *
 * Admins are powerful but still scoped: they are onboarded onto designated
 * companies like everyone else, and see nothing outside them.
 */
export const seesEveryCompany = (role: UserRole): boolean => role === 'SUPER_ADMIN';

/**
 * The company filter for this actor.
 *
 * With no `companyId` this is the list they may browse — active companies only.
 * With one, it resolves that company *if they hold it*, which is what makes an
 * unauthorised id return 404 rather than leak its existence with a 403.
 */
export function companyScope(actor: Actor, companyId?: string | null): Prisma.CompanyWhereInput {
  const base: Prisma.CompanyWhereInput = companyId
    ? { organizationId: actor.organizationId, id: companyId }
    : { organizationId: actor.organizationId, isActive: true };

  if (seesEveryCompany(actor.role)) return base;
  return { ...base, memberships: { some: { userId: actor.userId } } };
}

// ---------------------------------------------------------------- capabilities

export type Capability =
  | 'company.create'
  | 'company.edit'
  | 'company.archive'
  | 'company.delete'
  | 'company.sync'
  /** Move tasks, complete and waive obligations. */
  | 'work.write'
  | 'evidence.write'
  | 'users.manage'
  | 'audit.read'
  /** The rule engine itself — the platform team's, not the firm's. */
  | 'rules.read';

/**
 * What each role may do, on a company it holds.
 *
 * A client's own login runs its own entity: it enrols the company, maintains
 * the profile the rules are computed from, works the filings and files the
 * evidence. What stays with the practitioner is everything that reaches past a
 * single company — archiving and deleting, the audit log, and who may see what.
 */
const CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  SUPER_ADMIN: [
    'company.create', 'company.edit', 'company.archive', 'company.delete',
    'company.sync', 'work.write', 'evidence.write', 'users.manage', 'audit.read',
    'rules.read',
  ],
  // Everything on the companies they hold. The audit log stays with the super
  // admin: it spans the whole organisation, so a scoped role reading it would
  // see past its own grants.
  ADMIN: ['company.create', 'company.edit', 'company.archive', 'company.sync', 'work.write', 'evidence.write'],
  // Onboarding is not a privilege over anyone else's work: whoever creates a
  // company is granted it and holds nothing more than they held before. A
  // practitioner brings their own client in; a client enrols their own entity.
  //
  // Archiving is reversible and scoped — it retires a client's calendar from the
  // org-wide views while keeping its filing history, evidence and score, and
  // reaches only companies they hold. Permanent deletion is the one that cannot
  // be undone, and that stays with the super admin.
  CA: ['company.create', 'company.edit', 'company.archive', 'company.sync', 'work.write', 'evidence.write'],
  // Scope is what holds a client in: `company.edit` reaches only the companies
  // they were granted, which is their own entity and nothing else. Turnover and
  // headcount move real statutory thresholds, so this is the client keeping
  // their own facts current rather than being able to touch anyone else's.
  //
  // `company.sync` travels with `company.create` and is not optional: onboarding
  // builds the calendar as its last step, and a role that could create but not
  // run the engine left a company standing with no obligations at all.
  //
  // Archiving and deleting stay off — losing a client's calendar is not a
  // decision that should rest with one signed-in client.
  COMPANY_OWNER: ['company.create', 'company.edit', 'company.sync', 'work.write', 'evidence.write'],
  VIEWER: [],
};

export const can = (role: UserRole, capability: Capability): boolean =>
  CAPABILITIES[role].includes(capability);

export const capabilitiesOf = (role: UserRole): Capability[] => [...CAPABILITIES[role]];

/** Readable in a refusal — "cannot work write" is not a sentence. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'company.create': 'onboard companies',
  'company.edit': 'edit this company',
  'company.archive': 'archive this company',
  'company.delete': 'delete this company',
  'company.sync': 're-run the engine',
  'work.write': 'work on filings here',
  'evidence.write': 'upload or remove evidence here',
  'users.manage': 'manage people and access',
  'audit.read': 'read the audit log',
  'rules.read': 'read the rule engine',
};

/** Ranked for comparison in the UI, not used for authorisation. */
export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  CA: 'Chartered accountant',
  COMPANY_OWNER: 'Company owner',
  VIEWER: 'Viewer',
};

/** Roles a super admin may hand out as someone's base role. */
export const ASSIGNABLE_ROLES: UserRole[] = ['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER'];

/**
 * Roles a *per-company grant* may carry — everything except SUPER_ADMIN, which
 * is organisation-wide and therefore not something you grant on one company.
 */
export const GRANTABLE_ROLES: UserRole[] = ['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER'];

// ---------------------------------------------------------- effective role

/**
 * What this actor is *on this company*.
 *
 * The grant is authoritative. A practitioner may be a CA on one client and a
 * viewer on another, and their base role is only a default for new grants —
 * it does not decide what they may do once a grant exists.
 *
 * Returns null when they hold no grant, which is the same as not being able to
 * see the company at all.
 */
export async function effectiveRole(actor: Actor, companyId: string): Promise<UserRole | null> {
  // The super admin holds no grants and needs none.
  if (seesEveryCompany(actor.role)) return actor.role;

  const membership = await prisma.companyMembership.findFirst({
    where: { userId: actor.userId, companyId, company: { organizationId: actor.organizationId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/**
 * Authorisation for a company-scoped action, checked where the company is
 * known rather than at the route.
 *
 * A route-level guard reads the base role before the company is in hand, which
 * would refuse a viewer-by-default who holds a CA grant on the company they are
 * actually working on.
 */
export async function assertCan(actor: Actor, companyId: string, capability: Capability): Promise<UserRole> {
  const role = await effectiveRole(actor, companyId);
  // Same shape as "no such company": never confirm a company exists to someone
  // who cannot see it.
  if (!role) throw new ForbiddenError('You do not have access to this company.');
  if (!can(role, capability)) {
    throw new ForbiddenError(
      `A ${ROLE_LABEL[role].toLowerCase()} cannot ${CAPABILITY_LABEL[capability]}.`,
    );
  }
  return role;
}

/** Every company this actor holds, with the capabilities the grant carries. */
export async function accessSummary(
  actor: Actor,
): Promise<Map<string, { role: UserRole; capabilities: Capability[] }>> {
  if (seesEveryCompany(actor.role)) return new Map();

  const memberships = await prisma.companyMembership.findMany({
    where: { userId: actor.userId, company: { organizationId: actor.organizationId } },
    select: { companyId: true, role: true },
  });
  return new Map(memberships.map((m) => [m.companyId, { role: m.role, capabilities: capabilitiesOf(m.role) }]));
}
