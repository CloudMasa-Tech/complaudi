import type { UserRole } from '@prisma/client';

/**
 * Pure authorization rules for company-scoped invitations.
 *
 * Kept dependency-free so they are unit-testable without a database or env.
 */

/** Roles that may be granted on a company, most capable first. */
export const INVITE_TARGET_ROLES: UserRole[] = ['ADMIN', 'COMPANY_OWNER', 'CA', 'VIEWER'];

/** Which effective roles on a company are entitled to invite others into it. */
export const INVITER_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_OWNER', 'CA'];

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
export function canInviteAs(inviterRole: UserRole, targetRole: UserRole): boolean {
  if (!INVITE_TARGET_ROLES.includes(targetRole)) return false;
  if (!INVITER_ROLES.includes(inviterRole)) return false;
  if (inviterRole === 'SUPER_ADMIN' || inviterRole === 'ADMIN' || inviterRole === 'COMPANY_OWNER') {
    return true;
  }
  // A CA may grant anything except ADMIN.
  return targetRole !== 'ADMIN';
}
