import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post, tokens } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BRAND_TAGLINE } from '../components/Layout';
import { Field, Spinner } from '../components/ui';

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

  function validate(): string | null {
    if (!password) return 'Enter a new password.';
    if (password.length < 10) return 'The password needs at least 10 characters.';
    if (!/[a-z]/.test(password)) return 'The password needs a lowercase letter.';
    if (!/[A-Z]/.test(password)) return 'The password needs an uppercase letter.';
    if (!/[0-9]/.test(password)) return 'The password needs a digit.';
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
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <img src="/logo.png" alt="Complaudi" style={{ height: 80, objectFit: 'contain' }} />
          <span className="brand-tagline wide" style={{ marginTop: 8 }}>{BRAND_TAGLINE}</span>
          <p className="tiny dim" style={{ marginTop: 6 }}>MCA · GST · Income Tax · MSME · Labour</p>
        </div>

        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {done ? (
              <>
                <div className="alert alert-success" style={{ background: 'var(--good-soft)', borderColor: 'transparent', color: 'var(--good)' }}>
                  <strong style={{ display: 'block', marginBottom: 2 }}>Password updated</strong>
                  <span className="tiny">Sign back in with your new password.</span>
                </div>
                <Link className="btn btn-primary" to="/login" style={{ justifyContent: 'center' }}>
                  Go to Login
                </Link>
              </>
            ) : missingLink ? (
              <>
                <div className="alert alert-error">
                  This reset link is invalid or has expired. Please request a new one.
                </div>
                <Link className="btn btn-primary" to="/forgot-password" style={{ justifyContent: 'center' }}>
                  Request a new link
                </Link>
              </>
            ) : (
              <>
                <Field label="New password" hint="At least 10 characters, with an uppercase letter and a digit">
                  <input type="password" required autoFocus value={password}
                         onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </Field>
                <Field label="Confirm new password">
                  <input type="password" required value={confirm}
                         onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                </Field>

                {error && <div className="alert alert-error">{error}</div>}

                <button className="btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
                  {busy ? <><Spinner /> Updating…</> : 'Update password'}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}