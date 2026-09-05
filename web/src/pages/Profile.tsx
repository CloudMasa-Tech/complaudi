import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../auth/ThemeContext';
import { ApiError, post, tokens } from '../api/client';
import { Card, Drawer, ErrorNote, Field, Spinner, initials, Badge } from '../components/ui';
import { ROLE_LABEL } from '../api/types';

/** Anyone can change their own password, which is what a temporary one is for. */
function ChangePasswordDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await post<{ accessToken: string; refreshToken: string }>('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      tokens.set(next.accessToken, next.refreshToken);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer onClose={onClose}>
      <header className="drawer-head">
        <div className="stack" style={{ flex: 1, gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>Change your password</h2>
          <span className="tiny dim">Your other devices will be signed out.</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </header>

      <form className="drawer-body" onSubmit={submit}>
        {error && <ErrorNote error={error} />}
        <Field label="Current password">
          <input type="password" required autoFocus value={form.currentPassword}
                 onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" hint="At least 10 characters, with an uppercase letter and a digit">
          <input type="password" required value={form.newPassword}
                 onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" required value={form.confirm}
                 onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <div className="row">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? <><Spinner /> Changing…</> : 'Change password'}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Drawer>
  );
}

export function Profile() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [changingPassword, setChangingPassword] = useState(false);

  if (!user) return null;

  return (
    <>
      <div className="grid grid-2" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          {/* Profile Card */}
          <Card>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 16px 24px' }}>
              <div className="avatar" style={{ width: 80, height: 80, fontSize: 32, marginBottom: 16 }}>{initials(user.name)}</div>
              <h2 style={{ margin: 0, fontSize: 20 }}>{user.name}</h2>
              <span className="dim" style={{ marginBottom: 16 }}>{user.email}</span>
              <Badge value={user.role === 'SUPER_ADMIN' ? 'critical' : 'info'}>{ROLE_LABEL[user.role]}</Badge>
              {user.phone && <span className="dim" style={{ marginTop: 12, fontSize: 13 }}>📞 {user.phone}</span>}
            </div>
          </Card>

          {/* Account Details Card */}
          <Card title="Account Details">
            <div className="card-body">
              <div className="grid grid-2" style={{ gap: 20, fontSize: 14 }}>
                <div>
                  <div className="label">Workspace</div>
                  <div style={{ fontWeight: 500 }}>{user.organization?.name || '—'}</div>
                </div>
                <div>
                  <div className="label">Access Level</div>
                  <div>{user.seesEveryCompany ? 'Full Access' : `${user.companyCount} Companies`}</div>
                </div>
                <div>
                  <div className="label">Onboarded</div>
                  <div>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(user.createdAt))}</div>
                </div>
                <div>
                  <div className="label">Onboarding Type</div>
                  <div>{user.trialEndsAt ? 'Self onboarding' : 'Superadmin Provisioned'}</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 24 }}>
          {user.role !== 'SUPER_ADMIN' && (
            <Card title="Billing & Plan">
              <div className="card-body">
                <div className="stack" style={{ gap: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="stack" style={{ gap: 4 }}>
                      <span style={{ fontWeight: 500, fontSize: 15 }}>Current Plan</span>
                      <span className="dim tiny">{user.trialEndsAt ? 'Evaluation Period' : 'Premium Subscription'}</span>
                    </div>
                    <Badge value={user.trialEndsAt ? 'warning' : 'success'}>
                      {user.trialEndsAt ? 'Free Trial' : 'Upgraded Version'}
                    </Badge>
                  </div>
                  
                  {user.trialEndsAt && (
                    <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>⏳</span>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 2 }}>
                          {user.trialDaysLeft === 0 ? 'Your trial ends today.' : `${user.trialDaysLeft} days left in your trial.`}
                        </strong>
                        <span className="tiny">Upgrade to a paid plan to keep access to premium features.</span>
                      </div>
                    </div>
                  )}
                  
                  {!user.trialEndsAt && (
                    <div className="alert alert-success" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>✨</span>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 2 }}>You are on the Upgraded Version!</strong>
                        <span className="tiny">You have full access to all features with no expiry.</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Settings Card */}
          <Card title="Settings & Security">
            <div className="card-body">
              <div className="stack" style={{ gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>App Theme</span>
                    <span className="dim tiny">Toggle between light and dark modes</span>
                  </div>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  >
                    {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                  </button>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0', height: 1 }}></div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>Password</span>
                    <span className="dim tiny">Update your login credentials</span>
                  </div>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => setChangingPassword(true)}
                  >
                    Change password
                  </button>
                </div>
                
                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0', height: 1 }}></div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--critical)' }}>Sign Out</span>
                    <span className="dim tiny">End your current session</span>
                  </div>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={logout}
                    style={{ color: 'var(--critical)' }}
                  >
                    Sign out ➔
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {changingPassword && (
        <ChangePasswordDrawer
          onClose={() => setChangingPassword(false)}
          onDone={() => setChangingPassword(false)}
        />
      )}
    </>
  );
}
