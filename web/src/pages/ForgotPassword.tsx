import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post } from '../api/client';
import { BRAND_TAGLINE } from '../components/Layout';
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
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <img src="/logo.png" alt="Complaudi" style={{ height: 80, objectFit: 'contain' }} />
          <span className="brand-tagline wide" style={{ marginTop: 8 }}>{BRAND_TAGLINE}</span>
          <p className="tiny dim" style={{ marginTop: 6 }}>MCA · GST · Income Tax · MSME · Labour</p>
        </div>

        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {sent ? (
              <>
                <div className="alert alert-success" style={{ background: 'var(--good-soft)', borderColor: 'transparent', color: 'var(--good)' }}>
                  <strong style={{ display: 'block', marginBottom: 2 }}>Check your inbox</strong>
                  <span className="tiny">If an account exists for {sent}, a password reset link is on its way. Give it a few minutes — and a glance at spam.</span>
                </div>
                <button className="btn-primary" type="button" style={{ justifyContent: 'center' }}
                        onClick={() => { setSent(null); setEmail(''); }}>
                  Send again
                </button>
              </>
            ) : (
              <>
                <Field label="Email">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                         autoComplete="username" placeholder="you@company.com" autoFocus required />
                </Field>

                {error && <div className="alert alert-error">{error}</div>}

                <button className="btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
                  {busy ? <><Spinner /> Sending…</> : 'Send reset link'}
                </button>
              </>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontWeight: 600 }}>
          Remembered it? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}