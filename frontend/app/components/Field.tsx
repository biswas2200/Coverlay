import type { HTMLInputTypeAttribute } from 'react';

interface Props {
  id: string;
  label: string;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
}

/** A labelled text input with an optional hint and a live error line (the form pattern of every auth screen). */
export function Field({ id, label, type = 'text', autoComplete, value, onChange, error, hint }: Props) {
  const described = [hint ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`input${error ? ' is-invalid' : ''}`}
        type={type}
        autoComplete={autoComplete}
        value={value}
        aria-describedby={described}
        aria-invalid={error ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
      <p id={`${id}-error`} className="field-error">{error ?? ''}</p>
    </div>
  );
}
