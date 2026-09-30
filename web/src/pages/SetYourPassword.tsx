import { useState, type FormEvent } from 'react';
import { ApiError, post, tokens } from '../api/client';
import { ErrorNote, Field, Spinner } from '../components/ui';
import { PasswordField } from '../components/PasswordField';

/**
 * The gate an invited account lands on.
 *
 * An invite creates the account with a password the inviter generated and read
 * out, so that password is known to at least two people and possibly to
 * whatever channel carried it. The API refuses everything but /me, /logout and
 * /change-password until it is replaced; this is the screen that replaces it.
 *
 * Full screen rather than a dismissible prompt, because there is nothing else
 * the account can usefully do — and a prompt that can be closed teaches people
 * to close it.
 */
export function SetYourPassword({ email, onDone, onSignOut }: {
  email: string;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await post<{ accessToken: string; refreshToken: string }>('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      // The server issues a fresh pair and clears the requirement; without
      // taking them the next request would still carry a token minted before
      // the change.
      tokens.set(next.accessToken, next.refreshToken);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Set your own password</h1>
          <p className="dim" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            You signed in to <strong>{email}</strong> with a password somebody else created. Choose
            your own before you continue — the temporary one stops working.
          </p>
        </div>

        {error && <ErrorNote error={error} />}

        <Field label="Temporary password">
          <PasswordField
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            placeholder="The one you were given"
          />
        </Field>
        <Field label="New password">
          <PasswordField
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </Field>
        <Field label="Confirm new password">
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            placeholder="Type it again"
          />
        </Field>

        <button
          className="btn-primary"
          type="submit"
          disabled={busy || newPassword.length < 8 || !currentPassword}
        >
          {busy ? <><Spinner /> Saving…</> : 'Set password and continue'}
        </button>

        <button type="button" className="auth-link-btn" onClick={onSignOut}>
          Sign out instead
        </button>
      </form>
    </div>
  );
}
