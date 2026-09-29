import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post, tokens } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthFormBrand, AuthShell, ShieldIcon } from '../components/AuthShell';
import { PasswordField } from '../components/PasswordField';
import { Field, Spinner } from '../components/ui';

/** The rules the server also enforces; checked here to save a round trip. */
const RULES: Array<{ label: string; met: (v: string) => boolean }> = [
  { label: 'At least 10 characters', met: (v) => v.length >= 10 },
  { label: 'A lowercase letter', met: (v) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', met: (v) => /[A-Z]/.test(v) },
  { label: 'A digit', met: (v) => /[0-9]/.test(v) },
];

/**
 * Completes a password reset. Supabase Auth delivers the recovery link with the
 * tokens in the URL — either an OTP `token_hash` (default flow) or a full
 * `access_token`/`refresh_token` pair (implicit flow). Whichever shape arrives,
 * the page forwards it to the edge only, so the browser never sets its own
 * password: the change happens inside Supabase Auth.
 */
export function ResetPassword() {
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Read the recovery tokens once, then scrub them from the address bar so a
  // shared screen or a stale bookmark does not carry a live session token.
  const recovery = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const search = new URLSearchParams(window.location.search);
    const get = (k: string) => hash.get(k) ?? search.get(k);
    return {
      tokenHash: get('token_hash') ?? null,
      accessToken: get('access_token') ?? null,
      type: get('type') ?? null,
    };
  }, []);

  useEffect(() => {
    if (recovery.tokenHash || recovery.accessToken) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    tokens.clear();
    // A signed-in user who followed the emailed link is now mid-reset, so no
    // session should survive — /login must render the fresh login screen.
    logout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missingLink = !recovery.tokenHash && !recovery.accessToken;
  const unmet = RULES.filter((r) => !r.met(password));
  const mismatch = confirm.length > 0 && confirm !== password;

  function validate(): string | null {
    if (!password) return 'Enter a new password.';
    if (unmet.length) return `The password still needs: ${unmet[0]!.label.toLowerCase()}.`;
    if (confirm !== password) return 'The two new passwords do not match.';
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/auth/reset-password', {
        password,
        tokenHash: recovery.tokenHash || undefined,
        accessToken: recovery.accessToken || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthFormBrand />

        {done ? (
          <>
            <header className="auth-form-head">
              <h2>Password updated</h2>
              <p>Sign back in with your new password.</p>
            </header>
            <Link className="btn btn-primary auth-submit" to="/login">Go to sign in</Link>
          </>
        ) : missingLink ? (
          <>
            <header className="auth-form-head">
              <h2>This link has expired</h2>
              <p>Reset links are single-use and time-limited. Request a fresh one and it will arrive in a moment.</p>
            </header>
            <Link className="btn btn-primary auth-submit" to="/forgot-password">Request a new link</Link>
            <p className="auth-switch">
              <Link to="/login">← Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <header className="auth-form-head">
              <h2>Set a new password</h2>
              <p>Choose something you haven't used here before.</p>
            </header>

            <Field label="New password">
              <PasswordField
                id="new-password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                autoFocus
                required
              />
            </Field>

            {/* The requirements tick off as they're met, so nobody discovers a
                rule only by being rejected on submit. */}
            <ul className="pw-rules">
              {RULES.map((rule) => {
                const met = rule.met(password);
                return (
                  <li key={rule.label} className={met ? 'met' : undefined}>
                    <span aria-hidden="true">{met ? '✓' : '○'}</span>
                    {rule.label}
                  </li>
                );
              })}
            </ul>

            <Field label="Confirm new password" error={mismatch ? 'The two passwords do not match.' : undefined}>
              <PasswordField
                id="confirm-password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                required
              />
            </Field>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button
              className="btn-primary auth-submit"
              type="submit"
              disabled={busy || unmet.length > 0 || confirm !== password}
            >
              {busy ? <><Spinner /> Updating…</> : 'Update password'}
            </button>

            <p className="auth-secure">
              <ShieldIcon />
              Updating your password signs out every other device
            </p>
          </>
        )}
      </form>
    </AuthShell>
  );
}
