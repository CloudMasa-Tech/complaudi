import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthFormBrand, AuthShell, ShieldIcon } from '../components/AuthShell';
import { PasswordField } from '../components/PasswordField';
import { Field, Spinner } from '../components/ui';

/**
 * How long to hold someone out after the server rate-limits them.
 *
 * The server's own window is the authority — this is only what the UI counts
 * down so the page says "try again in 4:12" instead of repeating an error the
 * user can do nothing about. Clearing it early gains nothing: the next attempt
 * would simply be refused again.
 */
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;

export function Login() {
  const { login, verifyTwoFactor, displacedReason, clearDisplaced } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (lockedFor <= 0) return;
    timer.current = window.setInterval(() => setLockedFor((s) => Math.max(0, s - 1)), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [lockedFor > 0]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || lockedFor > 0) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await login(email, password);
      if (outcome.status === 'two-factor') {
        setChallenge(outcome.challenge);
        setPassword('');
      }
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setLockedFor(DEFAULT_LOCKOUT_SECONDS);
        setError(null);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
      // Never leave a rejected password sitting in the field: it is the most
      // common thing to be shoulder-read, and re-typing is the intended action.
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (busy || !challenge) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTwoFactor(challenge, code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify that code. Try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const mins = Math.floor(lockedFor / 60);
  const secs = String(lockedFor % 60).padStart(2, '0');

  return (
    <AuthShell>
        {challenge ? (
          <form className="auth-form" onSubmit={submitCode} noValidate>
            <AuthFormBrand />

            <header className="auth-form-head">
              <h2>Two-step verification</h2>
              <p>Enter the 6-digit code from your authenticator app.</p>
            </header>

            <Field label="Verification code">
              <input
                id="totp"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="otp-input"
                inputMode="numeric"
                // Lets iOS and Android offer the code straight from the SMS/
                // authenticator autofill rather than making people switch apps.
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={14}
                autoFocus
                required
              />
            </Field>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button className="btn-primary auth-submit" type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? <><Spinner /> Verifying…</> : 'Verify and sign in'}
            </button>

            <p className="auth-switch">
              Lost your device? Enter one of your recovery codes above.
            </p>
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => { setChallenge(null); setCode(''); setError(null); }}
            >
              ← Back to sign in
            </button>
          </form>
        ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <AuthFormBrand />

          <header className="auth-form-head">
            <h2>Sign in</h2>
            <p>Welcome back. Enter your details to continue.</p>
          </header>

          {/* Why this device was signed out, when it was not the user's doing. */}
          {displacedReason && (
            <div className="alert alert-warn" role="alert">
              <strong>You were signed out</strong>
              <span>{displacedReason}</span>
            </div>
          )}

          <Field label="Work email">
            <input
              id="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (displacedReason) clearDisplaced(); }}
              autoComplete="username webauthn"
              placeholder="you@company.com"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoFocus
              required
            />
          </Field>

          <Field label="Password">
            <PasswordField
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password webauthn"
              required
            />
          </Field>

          <Link to="/forgot-password" className="auth-forgot">Forgot password?</Link>

          {lockedFor > 0 && (
            <div className="alert alert-warn" role="alert">
              <strong>Too many sign-in attempts.</strong>
              <span>For your security this account is paused. Try again in {mins}:{secs}.</span>
            </div>
          )}

          {/* Deliberately whatever the server said, which never distinguishes a
              wrong password from an unknown address. */}
          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <button className="btn-primary auth-submit" type="submit" disabled={busy || lockedFor > 0}>
            {busy ? <><Spinner /> Signing in…</> : lockedFor > 0 ? `Locked — ${mins}:${secs}` : 'Sign in'}
          </button>

          <p className="auth-switch">
            New here? <Link to="/register">Enrol your company</Link> — free for 14 days.
          </p>

          <p className="auth-secure">
            <ShieldIcon />
            Encrypted in transit · One active session per account
          </p>
        </form>
        )}
    </AuthShell>
  );
}
