import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { companyScope, type Actor } from '../src/lib/access';

const actor = (role: Actor['role']): Actor => ({
  userId: 'user-1',
  organizationId: 'org-1',
  role,
});

/**
 * Scope is a pure function: it turns an actor into a Prisma where-clause, so it
 * can be pinned down without a database. That is where the SUPER_ADMIN
 * cross-tenant change lives — the query builders in every module all route
 * through it — so testing it here is testing exactly what changed.
 */
describe('companyScope', () => {
  it('lets the platform SUPER_ADMIN see every company, across all organisations', () => {
    const where = companyScope(actor('SUPER_ADMIN'));
    expect(where.organizationId).toBeUndefined();
    expect(where).toEqual(expect.objectContaining({ isActive: true }));
    // No per-company row requirement: membership is irrelevant for this role.
    expect(where.memberships).toBeUndefined();
  });

  it('resolves a specific company for the SUPER_ADMIN by id only, across tenants', () => {
    const where = companyScope(actor('SUPER_ADMIN'), 'company-9');
    expect(where).toEqual({ id: 'company-9' });
    expect(where.organizationId).toBeUndefined();
  });

  it('keeps every other role strictly org-scoped', () => {
    for (const role of ['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER'] as const) {
      const list = companyScope(actor(role));
      expect(list.organizationId).toBe('org-1');
      expect(list.memberships).toEqual({ some: { userId: 'user-1' } });
    }
  });

  it('resolves a company for a scoped role only inside their own organisation', () => {
    const where = companyScope(actor('CA'), 'company-5');
    expect(where).toEqual({
      organizationId: 'org-1',
      id: 'company-5',
      memberships: { some: { userId: 'user-1' } },
    });
  });
});

/**
 * The SUPER_ADMIN onboarding overview is a slim projection on purpose: it must
 * expose only who/when/org, and nothing of a company's private profile. The
 * `select` passed to Prisma is that contract, so pin it down without a DB.
 */
describe('listSuperAdminCompanies — slim projection (no private data leaks)', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let captured: { select?: Record<string, unknown> } | undefined;

  beforeEach(() => {
    captured = undefined;
    findMany = vi.fn().mockImplementation((args: unknown) => {
      captured = args as { select?: Record<string, unknown> } | undefined;
      return Promise.resolve([]);
    });

    vi.doMock('../src/config/env', () => ({
      env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        SUPABASE_STORAGE_BUCKET: 'compliance-evidence',
        LOCAL_STORAGE_DIR: './storage',
        BCRYPT_ROUNDS: 12,
      },
    }));
    vi.doMock('../src/lib/logger', () => ({
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    }));
    vi.doMock('../src/lib/prisma', () => ({
      prisma: { company: { findMany, findFirst: () => Promise.resolve(null) } },
      serialiseBigInt: (v: unknown) => v,
    }));

    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../src/config/env');
    vi.doUnmock('../src/lib/logger');
    vi.doUnmock('../src/lib/prisma');
    vi.restoreAllMocks();
  });

  it('selects only onboarding metadata — never GSTIN/PAN/CIN/directors/evidence', async () => {
    const { listSuperAdminCompanies } = await import('../src/modules/companies/companies.service');
    await listSuperAdminCompanies(actor('SUPER_ADMIN'));

    const top = captured?.select ?? {};
    const allowed = new Set(['id', 'legalName', 'entityType', 'isActive', 'createdAt', 'organization', 'memberships']);
    expect(Object.keys(top).every((k) => allowed.has(k))).toBe(true);

    const leaked = ['gstRegistrations', 'msmeRegistration', 'directors', 'cin', 'pan', 'tan', 'llpin', 'documents'];
    for (const k of leaked) expect(top[k]).toBeUndefined();
  });
});
