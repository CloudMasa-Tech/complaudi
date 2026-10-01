import { describe, expect, it } from 'vitest';
import type { UserRole } from '@prisma/client';
import { INVITER_ROLES, INVITE_TARGET_ROLES, canInviteAs } from '../src/modules/companies/company-invite';

/** What the invite form will offer someone with this standing on a company. */
const offered = (inviter: UserRole) => INVITE_TARGET_ROLES.filter((r) => canInviteAs(inviter, r));

describe('who may invite, and as what', () => {
  it('lets a company owner build the team, administrators included', () => {
    expect(offered('COMPANY_OWNER')).toEqual(['ADMIN', 'COMPANY_OWNER', 'CA', 'VIEWER']);
  });

  it('lets a practitioner onboard a client, a peer or a viewer — but not an admin', () => {
    // Handing a client their own login is the ordinary way a practice onboards
    // one, so a CA may grant COMPANY_OWNER. ADMIN is a standing above their
    // own and stays out of reach.
    expect(offered('CA')).toEqual(['COMPANY_OWNER', 'CA', 'VIEWER']);
    expect(canInviteAs('CA', 'ADMIN')).toBe(false);
  });

  it('gives a viewer nothing to grant', () => {
    expect(INVITER_ROLES).not.toContain('VIEWER');
    expect(offered('VIEWER')).toEqual([]);
  });

  it('never grants the organisation-wide role', () => {
    // SUPER_ADMIN spans the whole organisation, not one company, so it is not
    // a company-scoped grant whoever is asking.
    for (const inviter of INVITER_ROLES) {
      expect(canInviteAs(inviter, 'SUPER_ADMIN')).toBe(false);
    }
  });

  it('offers exactly the three roles the invite form shows a practitioner', () => {
    // What the screenshot asked for: CA, Viewer and Business owner.
    expect(offered('CA').sort()).toEqual(['CA', 'COMPANY_OWNER', 'VIEWER']);
  });

  it('offers nothing that the invite itself would then refuse', () => {
    // The whole point of asking the server what to show: every role in the
    // dropdown must survive the same check the POST runs.
    for (const inviter of INVITER_ROLES) {
      for (const target of offered(inviter)) {
        expect(canInviteAs(inviter, target)).toBe(true);
      }
    }
  });
});

describe('the Node and edge copies agree', () => {
  it('apply the same matrix', async () => {
    // Two runtimes authorise the same invitations and deploy separately. They
    // had already drifted once: the edge authorised on a capability instead of
    // this matrix and accepted COMPANY_OWNER as a target, which would have
    // created a second owner of a company.
    const edge = await import('../supabase/functions/_shared/company-invite');
    expect(edge.INVITE_TARGET_ROLES).toEqual(INVITE_TARGET_ROLES);
    expect(edge.INVITER_ROLES).toEqual(INVITER_ROLES);

    const ALL = ['SUPER_ADMIN', 'ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER'] as const;
    for (const inviter of ALL) {
      for (const target of ALL) {
        expect(edge.canInviteAs(inviter, target)).toBe(canInviteAs(inviter, target));
      }
      expect(edge.grantableRoles(inviter)).toEqual(offered(inviter));
    }
  });
});
