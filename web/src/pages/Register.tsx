import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, post, tokens } from '../api/client';
import type { BusinessType, EntityType } from '../api/types';
import { BRAND_TAGLINE } from '../components/Layout';
import { BUSINESS_TYPE_LABEL, Field, Spinner } from '../components/ui';


const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'PRIVATE_LIMITED', label: 'Private Limited Company' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited Company' },
  { value: 'OPC', label: 'One Person Company' },
  { value: 'LLP', label: 'Limited Liability Partnership' },
  { value: 'PARTNERSHIP', label: 'Partnership Firm' },
  { value: 'PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'SECTION_8', label: 'Section 8 Company' },
  { value: 'UNREGISTERED', label: 'Individual / Shop / Freelancer' },
];

const BUSINESS_TYPES: BusinessType[] = ['SHOP_RETAIL', 'FREELANCER', 'PROFESSIONAL', 'FOOD_RESTAURANT', 'OTHER'];

const STATES = [
  'AN','AP','AR','AS','BR','CG','CH','DL','DNDD','GA','GJ','HP','HR','JH','JK','KA','KL','LA','LD',
  'MH','ML','MN','MP','MZ','NL','OD','OT','PB','PY','RJ','SK','TG','TN','TR','UK','UP','WB',
];

const CIN_SHAPE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

function fieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    if (d && typeof d === 'object' && 'field' in d && 'message' in d) out[String(d.field)] = String(d.message);
  }
  return out;
}

export function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    companyName: '', incorporationDate: '', entityType: 'PRIVATE_LIMITED' as EntityType,
    businessType: '' as BusinessType | '',
    stateCode: 'TN', cin: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  // A well-formed CIN carries the entity type and state, so the form stops
  // asking for them. The server does the actual decoding — this only decides
  // what to show.
  const cinCarriesTheRest = CIN_SHAPE.test(form.cin.trim().toUpperCase());
  const isIndividual = form.entityType === 'UNREGISTERED';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        companyName: form.companyName.trim(),
        incorporationDate: form.incorporationDate,
        entityType: form.entityType,
      };
      if (form.businessType) body.businessType = form.businessType;
      if (!isIndividual && form.cin.trim()) body.cin = form.cin.trim().toUpperCase();
      if (!cinCarriesTheRest) body.stateCode = form.stateCode;

      const result = await post<{ accessToken: string; refreshToken: string }>('/auth/register-trial', body);
      tokens.set(result.accessToken, result.refreshToken);
      // A full reload lets the auth context pick the session up from storage.
      window.location.assign('/');
    } catch (err) {
      if (err instanceof ApiError) {
        const byField = fieldErrors(err.details);
        setErrors(byField);
        setError(Object.keys(byField).length === 0 ? err.message : null);
      } else setError('Could not reach the server');
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" style={{ maxWidth: 620 }} onSubmit={submit}>
        <div className="login-head">
          <img src="/logo.png" alt="Complaudi" style={{ height: 80, objectFit: 'contain' }} />
          <span className="brand-tagline wide" style={{ marginTop: 6 }}>{BRAND_TAGLINE}</span>
          <h1 style={{ marginTop: 4 }}>See what your company has to file</h1>
          <p className="muted tiny">
            Free for 14 days. Tell us about the entity and we will build its compliance calendar —
            MCA, GST, Income Tax, MSME and labour — before you finish reading this page.
          </p>
        </div>

        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span className="tiny dim">About you</span>
            <div className="grid grid-2">
              <Field label="Your name" error={errors.name}>
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Work email" error={errors.email}>
                <input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
              </Field>
              <Field label="Mobile number" hint="10 digits — we use it only to reach you about the account" error={errors.phone}>
                <input required value={form.phone} placeholder="98765 43210"
                       onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
              </Field>
              <Field label="Password" hint="At least 10 characters, with an uppercase letter and a digit" error={errors.password}>
                <input required type="password" value={form.password}
                       onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              </Field>
            </div>

            <span className="tiny dim" style={{ marginTop: 4 }}>About the entity</span>
            <div className="grid grid-2">
              <Field label={isIndividual ? 'Business / shop name' : 'Company name'} error={errors.companyName}>
                <input required value={form.companyName}
                       placeholder={isIndividual ? 'E.G. SRI BALAJI TEA STALL' : 'NORTHWIND TECHNOLOGIES PRIVATE LIMITED'}
                       style={{ textTransform: 'uppercase' }}
                       onChange={(e) => set('companyName', e.target.value.toUpperCase())} />
              </Field>
              <Field label={isIndividual ? 'Started on' : 'Date of incorporation'}
                     hint={isIndividual ? 'When the business began — the calendar is built from it' : 'From the certificate — the calendar is built from it'}
                     error={errors.incorporationDate}>
                <input required type="date" value={form.incorporationDate}
                       onChange={(e) => set('incorporationDate', e.target.value)} />
              </Field>
              {isIndividual ? (
                <Field label="Registration" hint="Not required for this entity type">
                  <input disabled placeholder="—" />
                </Field>
              ) : (
                <Field
                  label="CIN"
                  hint={cinCarriesTheRest
                    ? 'Entity type and state will be read from this'
                    : 'Optional — if you have it, we read the entity type and state from it'}
                  error={errors.cin}
                >
                  <input value={form.cin} placeholder="U72900TN2020PTC138472"
                         onChange={(e) => set('cin', e.target.value.toUpperCase())} />
                  {!form.cin.trim() && (
                    <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, display: 'block' }}>
                      Don't have a CIN yet?{' '}
                      <a
                        href="https://www.mca.gov.in/content/mca/global/en/mca/fo-llp-filing/spice-plus.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}
                      >
                        Register your company on MCA →
                      </a>
                    </span>
                  )}
                </Field>
              )}

              {!cinCarriesTheRest && (
                <>
                  <Field
                    label="Entity type"
                    hint={isIndividual
                      ? 'For shops (tea stall, grocery, retail), freelancers, doctors, lawyers and consultants — anything not registered under the Companies Act. GST, MSME, PF/ESI and income-tax rules still apply to you, based on turnover and employees.'
                      : undefined}
                  >
                    <select value={form.entityType} onChange={(e) => set('entityType', e.target.value as EntityType)}>
                      {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  {isIndividual && (
                    <Field label="What best describes you?" hint="Used only to label your profile — no rules change">
                      <select value={form.businessType}
                              onChange={(e) => set('businessType', e.target.value as BusinessType)}>
                        <option value="">— Select —</option>
                        {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{BUSINESS_TYPE_LABEL[bt]}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="State" hint="Drives professional tax and ESI thresholds" error={errors.stateCode}>
                    <select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
                      {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                </>
              )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="alert">
              Your trial is <strong>read-only</strong>: you will see every obligation that applies, when each is
              due and what it costs to miss — but filings are closed out only on a full account.
            </div>

            <button className="btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? <><Spinner /> Building your calendar…</> : 'Start the 14-day trial'}
            </button>
          </div>
        </div>

        <p className="tiny dim" style={{ textAlign: 'center' }}>
          Already have an account? <Link to="/login" onClick={() => navigate('/login')}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
