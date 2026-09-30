import { describe, expect, it } from 'vitest';
import type { UserRole } from '@prisma/client';
import { INVITER_ROLES, INVITE_TARGET_ROLES, canInviteAs } from '../src/modules/companies/company-invite';

/** What the invite form will offer someone with this standing on a company. */
const offered = (inviter: UserRole) => INVITE_TARGET_ROLES.filter((r) => canInviteAs(inviter, r));

describe('who may invite, and as what', () => {
  it('lets a company owner build the team, administrators included', () => {
    expect(offered('COMPANY_OWNER')).toEqual(['ADMIN', 'CA', 'VIEWER']);
  });

  it('lets a practitioner bring in peers and viewers, but not an administrator', () => {
    // A CA runs the filings; handing out control of the company is not theirs
    // to do. The form offers only what the server will accept, so this is also
    // what the dropdown contains.
    expect(offered('CA')).toEqual(['CA', 'VIEWER']);
    expect(canInviteAs('CA', 'ADMIN')).toBe(false);
  });

  it('gives a viewer nothing to grant', () => {
    expect(INVITER_ROLES).not.toContain('VIEWER');
    expect(offered('VIEWER')).toEqual([]);
  });

  it('never grants the organisation-wide role or a second owner', () => {
    // SUPER_ADMIN spans the whole organisation and COMPANY_OWNER is the entity
    // itself — neither is a company-scoped grant, whoever is asking.
    for (const inviter of INVITER_ROLES) {
      expect(canInviteAs(inviter, 'SUPER_ADMIN')).toBe(false);
      expect(canInviteAs(inviter, 'COMPANY_OWNER')).toBe(false);
    }
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
