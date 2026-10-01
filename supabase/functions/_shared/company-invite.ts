/**
 * Who may invite whom into a company.
 *
 * A verbatim mirror of src/modules/companies/company-invite.ts, minus the
 * Prisma type import, so the Deno runtime needs no dependencies.
 * tests/company.invite.roles.test.ts compares the two and fails if they drift.
 *
 * They had drifted. The edge invite authorised on the 'company.edit'
 * capability and accepted COMPANY_OWNER as a target role, so it would create a
 * second owner of a company — which the Express API refuses outright, and
 * which no role is supposed to be able to grant.
 */
export type InviteRole = 'SUPER_ADMIN' | 'ADMIN' | 'CA' | 'COMPANY_OWNER' | 'VIEWER';

/** Roles that may be granted on a company, most capable first. */
export const INVITE_TARGET_ROLES: InviteRole[] = ['ADMIN', 'COMPANY_OWNER', 'CA', 'VIEWER'];

/** Which effective roles on a company are entitled to invite others into it. */
export const INVITER_ROLES: InviteRole[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_OWNER', 'CA'];

/**
 * A practitioner (CA) may onboard the people who work a company: a fellow
 * practitioner, a read-only viewer, and the client's own business owner —
 * which is the ordinary way a practice hands a client their login. What a CA
 * may not do is create a company ADMIN, a standing above their own.
 *
 * An owner or administrator runs the entity, so they can grant ADMIN too.
 * SUPER_ADMIN is organisation-wide rather than company-scoped and is never
 * granted here.
 *
 * Note what a business owner grant means: full control of that company. It is
 * offered because handing a client their own login is the point of the
 * product, not because it is a small permission.
 */
export function canInviteAs(inviterRole: InviteRole, targetRole: InviteRole): boolean {
  if (!INVITE_TARGET_ROLES.includes(targetRole)) return false;
  if (!INVITER_ROLES.includes(inviterRole)) return false;
  if (inviterRole === 'SUPER_ADMIN' || inviterRole === 'ADMIN' || inviterRole === 'COMPANY_OWNER') {
    return true;
  }
  // A CA may grant anything except ADMIN.
  return targetRole !== 'ADMIN';
}

/** What the invite form should offer someone with this standing. */
export function grantableRoles(inviterRole: InviteRole | null): InviteRole[] {
  if (!inviterRole) return [];
  return INVITE_TARGET_ROLES.filter((r) => canInviteAs(inviterRole, r));
}
