import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post } from '../api/client';
import { AuthFormBrand, AuthShell, ShieldIcon } from '../components/AuthShell';
import { Field, Spinner } from '../components/ui';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Forgotten-password request. The server always answers success whether or not
 * the address has an account, so this screen never hints at which emails exist.
 * A checked email or a queued spam prompt is the only signal the user gets.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/auth/forgot-password', { email: email.trim() });
      setSent(email.trim());
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

        {sent ? (
          <>
            <header className="auth-form-head">
              <h2>Check your inbox</h2>
              {/* Phrased as a conditional on purpose: confirming that this
                  address has an account would turn the form into a way of
                  testing which of a firm's clients are customers. */}
              <p>
                If an account exists for <strong>{sent}</strong>, a password reset link is on
                its way. Give it a few minutes — and a glance at spam.
              </p>
            </header>

            <button
              className="btn-primary auth-submit"
              type="button"
              onClick={() => { setSent(null); setEmail(''); }}
            >
              Use a different address
            </button>

            <p className="auth-switch">
              <Link to="/login">← Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <header className="auth-form-head">
              <h2>Reset your password</h2>
              <p>Enter your work email and we'll send you a link to set a new one.</p>
            </header>

            <Field label="Work email">
              <input
                id="email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@company.com"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
                required
              />
            </Field>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button className="btn-primary auth-submit" type="submit" disabled={busy}>
              {busy ? <><Spinner /> Sending…</> : 'Send reset link'}
            </button>

            <p className="auth-switch">
              Remembered it? <Link to="/login">Sign in</Link>
            </p>

            <p className="auth-secure">
              <ShieldIcon />
              Reset links expire after one use
            </p>
          </>
        )}
      </form>
    </AuthShell>
  );
}
