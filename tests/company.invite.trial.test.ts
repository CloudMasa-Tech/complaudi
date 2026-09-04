import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenError } from '../src/lib/errors';

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    companyMembership: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../src/lib/mailer', () => ({
  sendMail: vi.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { sendMail } from '../src/lib/mailer';
import { inviteToCompany, listCompanyMembers } from '../src/modules/companies/companies.service';

const ownerActor = {
  userId: 'u-owner',
  organizationId: 'org-1',
  role: 'COMPANY_OWNER' as const,
};

const company = {
  id: 'company-1',
  legalName: 'Acme Pvt Ltd',
};

beforeEach(() => {
  vi.clearAllMocks();
  // An owner holds a COMPANY_OWNER grant on their own company, so the inviter
  // role check passes and the tests exercise the trial / role logic itself.
  vi.mocked(prisma.companyMembership.findFirst).mockResolvedValue({ role: 'COMPANY_OWNER' } as never);
});

describe('company invite — trial gating', () => {
  it('blocks invitation while the organisation is still on trial', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: company.id, legalName: company.legalName } as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ trialEndsAt: new Date(Date.now() + 86400000 * 5) } as never);

    await expect(
      inviteToCompany(ownerActor, company.id, { email: 'new@acme.com', name: 'New Person', role: 'CA' }),
    ).rejects.toThrow(ForbiddenError);

    // Nothing was created and no email was sent.
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('allows invitation once the organisation is on a full (non-trial) account', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: company.id, legalName: company.legalName } as never);
    // trialEndsAt null === upgraded / full account.
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ trialEndsAt: null } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'u-new', name: 'New Person', email: 'new@acme.com', role: 'CA',
    } as never);

    const result = await inviteToCompany(ownerActor, company.id, { email: 'new@acme.com', name: 'New Person', role: 'CA' });

    expect(result.user.email).toBe('new@acme.com');
    expect(prisma.user.create).toHaveBeenCalled();
    // The invite email goes out of band; the response never carries a password.
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('password');
  });
});

describe('company invite — role constraints', () => {
  it('never allows COMPANY_OWNER or SUPER_ADMIN to be granted', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: company.id, legalName: company.legalName } as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ trialEndsAt: null } as never);

    await expect(
      inviteToCompany(ownerActor, company.id, { email: 'x@acme.com', name: 'X', role: 'COMPANY_OWNER' }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      inviteToCompany(ownerActor, company.id, { email: 'x@acme.com', name: 'X', role: 'SUPER_ADMIN' }),
    ).rejects.toThrow(ForbiddenError);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('company invite — team appears in the members list and is assignable', () => {
  it('lists the invited member in the company team', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: company.id, legalName: company.legalName } as never);
    vi.mocked(prisma.companyMembership.findMany).mockResolvedValue([
      {
        role: 'CA',
        createdAt: new Date(),
        user: { id: 'u-new', name: 'New Person', email: 'new@acme.com', isActive: true },
        grantedBy: { id: 'u-owner', name: 'Owner' },
      },
    ] as never);

    const members = await listCompanyMembers(ownerActor, company.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.member.email).toBe('new@acme.com');
    expect(members[0]!.role).toBe('CA');
  });
});
