import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    companyMembership: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('../src/lib/mailer', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from '../src/lib/prisma';
import { inviteToCompany } from '../src/modules/companies/companies.service';

const company = { id: '11111111-1111-4111-8111-111111111111', legalName: 'Acme Pvt Ltd' };
const owner = { userId: 'u-owner', organizationId: 'org-1', role: 'COMPANY_OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.company.findFirst).mockResolvedValue(company as never);
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ trialEndsAt: null } as never);
  vi.mocked(prisma.companyMembership.findFirst).mockResolvedValue({ role: 'COMPANY_OWNER' } as never);
  vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Owner' } as never);
  vi.mocked(prisma.user.create).mockResolvedValue(
    { id: 'u-new', name: 'Priya', email: 'priya@acme.test', role: 'CA' } as never,
  );
});

describe('the password an invite creates', () => {
  it('hands the inviter a password to pass on', async () => {
    // Nobody could act on an invite before this: the account existed, the email
    // linked to /register, and registering with an address that already exists
    // conflicts. The inviter now has something to give.
    const res = await inviteToCompany(owner, company.id, {
      email: 'priya@acme.test', name: 'Priya', role: 'CA',
    });
    expect(res.temporaryPassword).toBeTruthy();
    expect(res.temporaryPassword.length).toBeGreaterThanOrEqual(10);
  });

  it('never stores it in the clear', async () => {
    const res = await inviteToCompany(owner, company.id, {
      email: 'priya@acme.test', name: 'Priya', role: 'CA',
    });
    const written = vi.mocked(prisma.user.create).mock.calls[0]![0].data as Record<string, unknown>;
    expect(written.passwordHash).toBeTruthy();
    expect(written.passwordHash).not.toBe(res.temporaryPassword);
    expect(JSON.stringify(written)).not.toContain(res.temporaryPassword);
  });

  it('marks the account as having to choose its own', async () => {
    // The generated password is known to the inviter and to whatever channel
    // carried it, so it may do exactly one thing: be replaced. The middleware
    // refuses everything else while this is set.
    await inviteToCompany(owner, company.id, { email: 'priya@acme.test', name: 'Priya', role: 'CA' });
    const written = vi.mocked(prisma.user.create).mock.calls[0]![0].data as Record<string, unknown>;
    expect(written.mustChangePassword).toBe(true);
  });

  it('generates a different password every time', async () => {
    const a = await inviteToCompany(owner, company.id, { email: 'a@acme.test', name: 'A', role: 'CA' });
    const b = await inviteToCompany(owner, company.id, { email: 'b@acme.test', name: 'B', role: 'CA' });
    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  });
});
