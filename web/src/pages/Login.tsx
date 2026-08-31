import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BRAND, BRAND_TAGLINE } from '../components/Layout';
import { Field, Spinner } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
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
          <div className="brand-mark" style={{ width: 46, height: 46, fontSize: 20, borderRadius: 13 }}>C</div>
          <h1 className="brand-name" style={{ marginTop: 10, fontSize: 30 }}>{BRAND}</h1>
          <span className="brand-tagline wide" style={{ marginTop: 4 }}>{BRAND_TAGLINE}</span>
          <p className="tiny dim" style={{ marginTop: 6 }}>MCA · GST · Income Tax · MSME · Labour</p>
        </div>

        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     autoComplete="username" placeholder="you@company.com" autoFocus required />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>

            {error && <div className="alert alert-error">{error}</div>}

            <button className="btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? <><Spinner /> Signing in…</> : 'Sign in'}
            </button>
          </div>
        </div>

        <p style={{ textAlign: 'center', fontWeight: 600 }}>
          New here? <Link to="/register">Enrol your company</Link> — free for 14 days.
        </p>
      </form>
    </div>
  );
}
