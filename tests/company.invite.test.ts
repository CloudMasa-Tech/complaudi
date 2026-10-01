import { describe, expect, it } from 'vitest';
import { canInviteAs, INVITE_TARGET_ROLES, INVITER_ROLES } from '../src/modules/companies/company-invite';
import { capabilitiesOf } from '../src/lib/access';

describe('company-scoped invite — who may grant which role', () => {
  it('lets a COMPANY_OWNER invite an ADMIN, CA and VIEWER into their company', () => {
    expect(canInviteAs('COMPANY_OWNER', 'ADMIN')).toBe(true);
    expect(canInviteAs('COMPANY_OWNER', 'CA')).toBe(true);
    expect(canInviteAs('COMPANY_OWNER', 'VIEWER')).toBe(true);
  });

  it('lets an ADMIN invite an ADMIN, CA and VIEWER', () => {
    expect(canInviteAs('ADMIN', 'ADMIN')).toBe(true);
    expect(canInviteAs('ADMIN', 'CA')).toBe(true);
    expect(canInviteAs('ADMIN', 'VIEWER')).toBe(true);
  });

  it('stops a CA from promoting someone to ADMIN (no privilege escalation)', () => {
    expect(canInviteAs('CA', 'ADMIN')).toBe(false);
    // ...but they may bring in a peer CA or a read-only viewer.
    expect(canInviteAs('CA', 'CA')).toBe(true);
    expect(canInviteAs('CA', 'VIEWER')).toBe(true);
  });

  it('never lets a VIEWER invite at all', () => {
    expect(INVITER_ROLES).not.toContain('VIEWER');
    for (const target of INVITE_TARGET_ROLES) {
      expect(canInviteAs('VIEWER', target)).toBe(false);
    }
  });

  it('never lets anyone grant SUPER_ADMIN', () => {
    // SUPER_ADMIN spans the organisation rather than one company, so it is not
    // something a company-scoped invite can hand out.
    expect(INVITE_TARGET_ROLES).not.toContain('SUPER_ADMIN');
    expect(canInviteAs('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canInviteAs('COMPANY_OWNER', 'SUPER_ADMIN')).toBe(false);
    expect(canInviteAs('CA', 'SUPER_ADMIN')).toBe(false);
  });

  it('does allow a business owner to be granted', () => {
    // Handing a client their own login is the ordinary way a practice onboards
    // one. It grants full control of that company, deliberately.
    expect(INVITE_TARGET_ROLES).toContain('COMPANY_OWNER');
    expect(canInviteAs('COMPANY_OWNER', 'COMPANY_OWNER')).toBe(true);
    expect(canInviteAs('CA', 'COMPANY_OWNER')).toBe(true);
  });
});

describe('COMPANY_OWNER scope', () => {
  it('has no org-wide users.manage capability (invites stay company-scoped)', () => {
    expect(capabilitiesOf('COMPANY_OWNER')).not.toContain('users.manage');
    expect(capabilitiesOf('COMPANY_OWNER')).not.toContain('audit.read');
    expect(capabilitiesOf('COMPANY_OWNER')).not.toContain('company.archive');
  });

  it('still holds the capabilities a self-onboarded owner needs to work', () => {
    const caps = capabilitiesOf('COMPANY_OWNER');
    expect(caps).toContain('company.edit');
    expect(caps).toContain('company.sync');
    expect(caps).toContain('work.write');
    expect(caps).toContain('evidence.write');
  });
});
