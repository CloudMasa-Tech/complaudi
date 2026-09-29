import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';

/**
 * A password input with the two affordances people actually need to type a
 * password correctly on the first try.
 *
 * Reveal: masked input is the leading cause of failed sign-ins, and hiding the
 * characters protects nothing against anyone who is not standing behind you —
 * which is the one threat the user, not the software, is placed to judge. So
 * the control is theirs, and it starts masked.
 *
 * Caps Lock: the classic silent failure. `getModifierState` is read from the
 * key event rather than tracked, so it is correct even when the key was pressed
 * before the field was focused.
 */
export function PasswordField({
  value,
  onChange,
  id,
  autoComplete = 'current-password',
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCapsLock = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  return (
    <>
      <div className="password-input">
        <input
          {...rest}
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          // Password managers and the browser's own generator rely on these.
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="button"
          className="password-reveal"
          onClick={() => setRevealed((r) => !r)}
          // The control is not in the tab order: it sits between the password
          // field and the submit button, and stopping there on the way to
          // signing in helps nobody.
          tabIndex={-1}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          title={revealed ? 'Hide password' : 'Show password'}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {capsLock && (
        <p className="caps-warning" role="status">
          <LockIcon /> Caps Lock is on
        </p>
      )}
    </>
  );
}

const Eye = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOff = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.2 6.2A17.6 17.6 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.2-.9" />
    <path d="m2 2 20 20" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
