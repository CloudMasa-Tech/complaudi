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

/** Roles a company owner/administrator may invite into their own company. */
export const INVITE_TARGET_ROLES: InviteRole[] = ['ADMIN', 'CA', 'VIEWER'];

/** Which effective roles on a company are entitled to invite others into it. */
export const INVITER_ROLES: InviteRole[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_OWNER', 'CA'];

/**
 * A practitioner (CA) may not promote someone past their own standing: they can
 * onboard peers and read-only viewers, but not a company administrator. A
 * COMPANY_OWNER or ADMIN runs the entity, so they can grant administrator too.
 * Nobody may grant the organisation-wide SUPER_ADMIN, or a second owner.
 */
export function canInviteAs(inviterRole: InviteRole, targetRole: InviteRole): boolean {
  if (!INVITE_TARGET_ROLES.includes(targetRole)) return false;
  if (!INVITER_ROLES.includes(inviterRole)) return false;
  if (inviterRole === 'SUPER_ADMIN' || inviterRole === 'ADMIN' || inviterRole === 'COMPANY_OWNER') {
    return true;
  }
  // CA inviters cannot grant ADMIN.
  return targetRole === 'CA' || targetRole === 'VIEWER';
}

/** What the invite form should offer someone with this standing. */
export function grantableRoles(inviterRole: InviteRole | null): InviteRole[] {
  if (!inviterRole) return [];
  return INVITE_TARGET_ROLES.filter((r) => canInviteAs(inviterRole, r));
}
