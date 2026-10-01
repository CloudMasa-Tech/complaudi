import { describe, expect, it } from 'vitest';

/** The reduction of the modal's success path, which is where the crash was. */
function readInvite(result: any, typed: { name: string; email: string; role: string }) {
  const invited = result.user ?? result.member;
  return {
    email: invited?.email ?? typed.email,
    name: invited?.name ?? typed.name,
    role: result.user?.role ?? result.role ?? typed.role,
    password: result.temporaryPassword ?? null,
  };
}

const typed = { name: 'Keerthana', email: 'keerthana.r@cloudmasa.com', role: 'CA' };

describe('reading whatever the invite answered with', () => {
  it('reads the Express shape', () => {
    const r = readInvite(
      { user: { id: 'u1', name: 'Keerthana', email: 'keerthana.r@cloudmasa.com', role: 'CA' },
        companies: ['c1'], temporaryPassword: 'aB3dEfGh7Jk2' }, typed);
    expect(r).toEqual({ email: 'keerthana.r@cloudmasa.com', name: 'Keerthana', role: 'CA', password: 'aB3dEfGh7Jk2' });
  });

  it('reads the member shape that used to crash it', () => {
    // Exactly what the deployed edge answers. result.user.role threw
    // "Cannot read properties of undefined (reading 'role')" on this.
    const r = readInvite(
      { role: 'CA', since: '2026-10-01T00:00:00Z',
        member: { id: 'u1', name: 'Keerthana', email: 'keerthana.r@cloudmasa.com', isActive: true },
        invitedBy: { id: 'u0', name: 'Arun' }, invitationStatus: 'ACTIVE' }, typed);
    expect(r.email).toBe('keerthana.r@cloudmasa.com');
    expect(r.role).toBe('CA');
    expect(r.password).toBeNull();
  });

  it('survives an empty body rather than throwing', () => {
    // The invite has already happened by the time this runs. Nothing here is
    // worth failing a succeeded request over.
    expect(() => readInvite({}, typed)).not.toThrow();
    expect(readInvite({}, typed).email).toBe('keerthana.r@cloudmasa.com');
  });
});
