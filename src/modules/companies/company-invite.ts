import type { UserRole } from '@prisma/client';

/**
 * Pure authorization rules for company-scoped invitations.
 *
 * Kept dependency-free so they are unit-testable without a database or env.
 */

/** Roles a company owner/administrator may invite into their own company. */
export const INVITE_TARGET_ROLES: UserRole[] = ['ADMIN', 'CA', 'VIEWER'];

/** Which effective roles on a company are entitled to invite others into it. */
export const INVITER_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_OWNER', 'CA'];

/**
 * A practitioner (CA) may not promote someone past their own standing: they can
 * onboard peers and read-only viewers, but not a company administrator. A
 * COMPANY_OWNER or ADMIN runs the entity, so they can grant administrator too.
 * Nobody may grant the organisation-wide SUPER_ADMIN, or a second owner.
 */
export function canInviteAs(inviterRole: UserRole, targetRole: UserRole): boolean {
  if (!INVITE_TARGET_ROLES.includes(targetRole)) return false;
  if (!INVITER_ROLES.includes(inviterRole)) return false;
  if (inviterRole === 'SUPER_ADMIN' || inviterRole === 'ADMIN' || inviterRole === 'COMPANY_OWNER') {
    return true;
  }
  // CA inviters cannot grant ADMIN.
  return targetRole === 'CA' || targetRole === 'VIEWER';
}
