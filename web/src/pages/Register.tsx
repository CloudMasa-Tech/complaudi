import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post, tokens } from '../api/client';
import type { BusinessType, EntityType } from '../api/types';
import { AuthFormBrand, AuthShell } from '../components/AuthShell';
import { BUSINESS_TYPE_LABEL, Field, SEGMENTS_PROSE, Spinner } from '../components/ui';
import { validateCompanyMasterData } from '../lib/companyValidation';

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

function fieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    if (d && typeof d === 'object' && 'field' in d && 'message' in d) out[String(d.field)] = String(d.message);
  }
  return out;
}

export function Register() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    companyName: '', incorporationDate: '', entityType: 'PRIVATE_LIMITED' as EntityType,
    businessType: '' as BusinessType | '',
    stateCode: 'TN', cin: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [verifyingCin, setVerifyingCin] = useState(false);
  const [verifiedBadge, setVerifiedBadge] = useState<{
    legalName?: string;
    status?: string;
    incorporationDate?: string;
    roc?: string;
    verifiedBy?: string | null;
  } | null>(null);

  async function performLiveValidation(cinToTest: string, currentForm = form) {
    const rawCin = cinToTest.trim().toUpperCase();
    if (rawCin.length !== 21) return;

    setVerifyingCin(true);
    try {
      const res = await post<{
        valid: boolean;
        errors: Array<{ field: string; message: string }>;
        masterRecord: any;
        verifiedBy: string | null;
        serviceUnavailable?: boolean;
      }>('/lookup/validate-company', {
        cin: rawCin,
        companyName: currentForm.companyName || undefined,
        entityType: currentForm.entityType || undefined,
        incorporationDate: currentForm.incorporationDate || undefined,
        stateCode: currentForm.stateCode || undefined,
      });

      if (res.masterRecord) {
        setVerifiedBadge({
          legalName: res.masterRecord.legalName,
          status: res.masterRecord.status,
          incorporationDate: res.masterRecord.incorporationDate,
          roc: res.masterRecord.roc,
          verifiedBy: res.verifiedBy || 'BizVerify',
        });

        const targetStateCode = res.masterRecord.stateCode || currentForm.stateCode;
        const targetEntityType = (res.masterRecord.entityType as EntityType) || currentForm.entityType;
        const targetCompanyName = currentForm.companyName || res.masterRecord.legalName || currentForm.companyName;
        const targetIncDate = currentForm.incorporationDate || res.masterRecord.incorporationDate || currentForm.incorporationDate;

        const nextForm = {
          ...currentForm,
          companyName: targetCompanyName,
          entityType: targetEntityType,
          stateCode: targetStateCode,
          incorporationDate: targetIncDate,
        };

        setForm(nextForm);

        // Re-evaluate validation using updated form and authoritative master record
        const valRes = validateCompanyMasterData({
          cin: rawCin,
          companyName: nextForm.companyName,
          entityType: nextForm.entityType,
          incorporationDate: nextForm.incorporationDate,
          stateCode: nextForm.stateCode,
          masterRecord: res.masterRecord,
        });

        const errMap: Record<string, string> = {};
        if (!valRes.valid) {
          for (const issue of valRes.errors) errMap[issue.field] = issue.message;
        }

        setErrors((prev) => {
          const next = { ...prev, ...errMap };
          if (!errMap.stateCode) delete next.stateCode;
          if (!errMap.companyName) delete next.companyName;
          if (!errMap.entityType) delete next.entityType;
          if (!errMap.incorporationDate) delete next.incorporationDate;
          if (!errMap.cin) delete next.cin;
          return next;
        });
      } else if (!res.valid && res.errors.length > 0) {
        const errMap: Record<string, string> = {};
        for (const issue of res.errors) errMap[issue.field] = issue.message;
        setErrors((prev) => ({ ...prev, ...errMap }));
      }
    } catch {
      // Ignore network errors on live preview
    } finally {
      setVerifyingCin(false);
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    const updated = { ...form, [k]: v };

    if (k === 'cin') {
      setVerifiedBadge(null);
      setErrors((e) => {
        const copy = { ...e };
        delete copy.cin;
        delete copy.companyName;
        delete copy.entityType;
        delete copy.stateCode;
        delete copy.incorporationDate;
        return copy;
      });
    } else {
      setErrors((e) => ({ ...e, [k]: '' }));
    }

    // Run client-side validation when CIN or company fields change
    if (updated.cin.trim()) {
      let val = validateCompanyMasterData({
        cin: updated.cin.trim(),
        companyName: updated.companyName,
        entityType: updated.entityType,
        incorporationDate: updated.incorporationDate,
        stateCode: updated.stateCode,
        masterRecord: verifiedBadge ? {
          cin: updated.cin.trim(),
          legalName: verifiedBadge.legalName,
          status: verifiedBadge.status,
          incorporationDate: verifiedBadge.incorporationDate,
          roc: verifiedBadge.roc,
        } : null,
      });

      // Auto-fill matching master fields when user enters a valid CIN and field is currently empty
      if (val.masterRecord && k === 'cin') {
        if (!updated.companyName && val.masterRecord.legalName) {
          updated.companyName = val.masterRecord.legalName;
        }
        if (val.masterRecord.entityType) {
          updated.entityType = val.masterRecord.entityType as EntityType;
        }
        if (val.masterRecord.stateCode) {
          updated.stateCode = val.masterRecord.stateCode;
        }
        if (val.masterRecord.incorporationDate && !updated.incorporationDate) {
          updated.incorporationDate = val.masterRecord.incorporationDate;
        }

        // Re-run validation on the auto-filled form values
        val = validateCompanyMasterData({
          cin: updated.cin.trim(),
          companyName: updated.companyName,
          entityType: updated.entityType,
          incorporationDate: updated.incorporationDate,
          stateCode: updated.stateCode,
        });
      }

      setForm(updated);

      const newErrors: Record<string, string> = {};
      if (!val.valid) {
        for (const issue of val.errors) {
          newErrors[issue.field] = issue.message;
        }
      }

      setErrors((prev) => {
        const next = { ...prev, ...newErrors };
        if (!newErrors.stateCode) delete next.stateCode;
        if (!newErrors.companyName) delete next.companyName;
        if (!newErrors.entityType) delete next.entityType;
        if (!newErrors.incorporationDate) delete next.incorporationDate;
        if (!newErrors.cin) delete next.cin;
        return next;
      });

      if (k === 'cin' && updated.cin.trim().length === 21) {
        void performLiveValidation(updated.cin, updated);
      }
    } else {
      setForm(updated);
      setVerifiedBadge(null);
    }
  };

  const isIndividual = form.entityType === 'UNREGISTERED';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // 1. Enforce client-side validation first
    if (form.cin.trim()) {
      const val = validateCompanyMasterData({
        cin: form.cin.trim(),
        companyName: form.companyName,
        entityType: form.entityType,
        incorporationDate: form.incorporationDate,
        stateCode: form.stateCode,
      });

      if (!val.valid) {
        const fieldErrs: Record<string, string> = {};
        for (const issue of val.errors) {
          fieldErrs[issue.field] = issue.message;
        }
        setErrors(fieldErrs);
        setError('Please fix the company validation errors before proceeding.');
        setBusy(false);
        return;
      }
    }

    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        companyName: form.companyName.trim(),
        incorporationDate: form.incorporationDate,
        entityType: form.entityType,
        stateCode: form.stateCode,
      };
      if (form.businessType) body.businessType = form.businessType;
      if (!isIndividual && form.cin.trim()) body.cin = form.cin.trim().toUpperCase();

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
    <AuthShell wide cta="signin">
      <form className="auth-form wide" onSubmit={submit} noValidate>
        <AuthFormBrand />

        <header className="auth-form-head">
          <h2>See what your company has to file</h2>
          <p>
            Free for 14 days. Tell us about the entity and we will build its compliance calendar —
            {' '}{SEGMENTS_PROSE} — before you finish reading this page.
          </p>
        </header>

        <div className="auth-form-body">
            <h3 className="auth-section">About you</h3>
            <div className="grid grid-2">
              <Field label="Your name" error={errors.name}>
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Work email" error={errors.email}>
                <input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
              </Field>
              <Field label="Mobile number" hint="10 digits — we use it only to reach you about the account" error={errors.phone}>
                <input required value={form.phone} placeholder="6364562818"
                       inputMode="numeric" maxLength={14}
                       onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
              </Field>
              <Field label="Password" hint="At least 10 characters, with an uppercase letter and a digit" error={errors.password}>
                <input required type="password" value={form.password}
                       onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              </Field>
            </div>

            <h3 className="auth-section">About the entity</h3>
            <div className="grid grid-2">
              <Field label={isIndividual ? 'Business / shop name' : 'Company name'} error={errors.companyName}>
                <input required value={form.companyName}
                       placeholder={isIndividual ? 'Sri Balaji Tea Stall' : 'Acme Industries Pvt Ltd'}
                       onChange={(e) => set('companyName', e.target.value.toUpperCase())} />
              </Field>
              <Field label={isIndividual ? 'Started on' : 'Date of incorporation'}
                     hint={isIndividual ? 'When the business began — the calendar is built from it' : 'From the certificate — the calendar is built from it'}
                     error={errors.incorporationDate}>
                <input required type="date" value={form.incorporationDate}
                       onChange={(e) => set('incorporationDate', e.target.value)} />
              </Field>
              <Field
                label="Entity type"
                hint={isIndividual
                  ? 'For shops (tea stall, grocery, retail), freelancers, doctors, lawyers and consultants — anything not registered under the Companies Act. GST, MSME, PF/ESI and income-tax rules still apply to you, based on turnover and employees.'
                  : undefined}
                error={errors.entityType}
              >
                <select value={form.entityType} onChange={(e) => set('entityType', e.target.value as EntityType)}>
                  {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="State" hint="Drives professional tax and ESI thresholds" error={errors.stateCode}>
                <select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
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
              {!isIndividual && (
                <div className="span-2">
                  <Field
                    label="CIN"
                  hint={verifyingCin ? 'Verifying CIN via BizVerify…' : 'Optional — if provided, company details are validated against MCA master data'}
                  error={errors.cin}
                >
                  <input value={form.cin} placeholder="U72900TN2020PTC138472"
                         onChange={(e) => set('cin', e.target.value.toUpperCase())}
                         onBlur={(e) => void performLiveValidation(e.target.value)} />
                  {verifyingCin && (
                    <span style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Spinner /> Contacting BizVerify live MCA service…
                    </span>
                  )}
                  {verifiedBadge && !verifyingCin && (
                    <div className="alert alert-info" style={{ marginTop: 6, padding: '8px 10px', fontSize: 12, borderRadius: 6 }}>
                      <strong>✓ Verified via {verifiedBadge.verifiedBy}:</strong>{' '}
                      {verifiedBadge.legalName || 'Official Record'} ({verifiedBadge.status || 'ACTIVE'})
                      {verifiedBadge.incorporationDate ? ` · Inc. ${verifiedBadge.incorporationDate}` : ''}
                      {verifiedBadge.roc ? ` · ${verifiedBadge.roc}` : ''}
                    </div>
                  )}
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
                </div>
              )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="alert">
              Your trial is <strong>read-only</strong>: you will see every obligation that applies, when each is
              due and what it costs to miss — but filings are closed out only on a full account.
            </div>

          <button className="btn-primary auth-submit" type="submit" disabled={busy}>
            {busy ? <><Spinner /> Building your calendar…</> : 'Start the 14-day trial'}
          </button>
        </div>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
