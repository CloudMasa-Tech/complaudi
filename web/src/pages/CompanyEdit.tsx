import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, patch, post, put, upload } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { Company, Director, EntityType, SyncResult } from '../api/types';
import { Card, ErrorNote, Field, Loading, Spinner, fmtDate, fmtINR, inc20aNote, officersFor } from '../components/ui';

/** Shared with the onboarding form so create and edit read identically. */
const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'PRIVATE_LIMITED', label: 'Private Limited Company' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited Company' },
  { value: 'OPC', label: 'One Person Company' },
  { value: 'LLP', label: 'Limited Liability Partnership' },
  { value: 'PARTNERSHIP', label: 'Partnership Firm' },
  { value: 'PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'SECTION_8', label: 'Section 8 Company' },
];

const STATES = [
  'AN','AP','AR','AS','BR','CG','CH','DL','DNDD','GA','GJ','HP','HR','JH','JK','KA','KL','LA','LD',
  'MH','ML','MN','MP','MZ','NL','OD','OT','PB','PY','RJ','SK','TG','TN','TR','UK','UP','WB',
];

/** Only the fields the API accepts on PATCH — identity and profile. */
interface ProfileForm {
  legalName: string; brandName: string; entityType: EntityType;
  cin: string; llpin: string; pan: string; tan: string;
  incorporationDate: string; agmDate: string; stateCode: string; industry: string;
  employeeCount: number; annualTurnover: number; paidUpCapital: number;
  cashTransactionRatioBelow5Pct: boolean; hasForeignTransactions: boolean;
  acceptsDeposits: boolean; isListed: boolean; buysFromMsmeSuppliers: boolean;
  dpiitRecognitionNumber: string; dpiitRecognisedOn: string; epfoCode: string; esicCode: string;
}

const toForm = (c: Company): ProfileForm => ({
  legalName: c.legalName, brandName: c.brandName ?? '', entityType: c.entityType,
  cin: c.cin ?? '', llpin: c.llpin ?? '', pan: c.pan ?? '', tan: c.tan ?? '',
  incorporationDate: c.incorporationDate?.slice(0, 10) ?? '',
  agmDate: c.agmDate?.slice(0, 10) ?? '',
  stateCode: c.stateCode, industry: c.industry ?? '',
  employeeCount: c.employeeCount,
  annualTurnover: Number(c.annualTurnover), paidUpCapital: Number(c.paidUpCapital),
  cashTransactionRatioBelow5Pct: c.cashTransactionRatioBelow5Pct,
  hasForeignTransactions: c.hasForeignTransactions,
  acceptsDeposits: c.acceptsDeposits, isListed: c.isListed,
  buysFromMsmeSuppliers: c.buysFromMsmeSuppliers,
  dpiitRecognitionNumber: c.dpiitRecognitionNumber ?? '',
  dpiitRecognisedOn: c.dpiitRecognisedOn?.slice(0, 10) ?? '',
  epfoCode: c.epfoCode ?? '', esicCode: c.esicCode ?? '',
});

function fieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    if (d && typeof d === 'object' && 'field' in d) out[String(d.field)] = String(d.message);
    if (d && typeof d === 'object' && 'gstin' in d && 'problems' in d) {
      out[`gstin:${String(d.gstin)}`] = (d.problems as string[]).join(' ');
    }
  }
  return out;
}

export function CompanyEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { reload: reloadCompanies } = useCompanies();
  const { data: company, initial, error, reload } = useResource<Company>(id ? `/companies/${id}` : null);

  const [form, setForm] = useState<ProfileForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sync, setSync] = useState<SyncResult | null>(null);

  // Load the server's copy into the form once, then leave the user's edits alone.
  useEffect(() => {
    if (company && !form) setForm(toForm(company));
  }, [company, form]);

  if (error) return <ErrorNote error={error} />;
  if (initial || !company || !form) return <Loading label="Loading the company" />;

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const isCompaniesAct = ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8'].includes(form.entityType);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setSaveError(null);
    setErrors({});
    try {
      await fn();
      reload();
      reloadCompanies();
    } catch (err) {
      if (err instanceof ApiError) {
        const byField = fieldErrors(err.details);
        setErrors(byField);
        // Showing it inline *and* in a banner says the same thing twice; the
        // banner is for errors that belong to no particular field.
        if (Object.keys(byField).length === 0) setSaveError(err.message);
      } else setSaveError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const body: Record<string, unknown> = {
        legalName: form!.legalName,
        entityType: form!.entityType,
        stateCode: form!.stateCode,
        employeeCount: Number(form!.employeeCount),
        annualTurnover: Math.round(Number(form!.annualTurnover)),
        paidUpCapital: Math.round(Number(form!.paidUpCapital)),
        cashTransactionRatioBelow5Pct: form!.cashTransactionRatioBelow5Pct,
        hasForeignTransactions: form!.hasForeignTransactions,
        acceptsDeposits: form!.acceptsDeposits,
        isListed: form!.isListed,
        buysFromMsmeSuppliers: form!.buysFromMsmeSuppliers,
      };
      // An empty optional must be sent as null to clear it, not as "".
      for (const k of ['brandName', 'cin', 'llpin', 'pan', 'tan', 'incorporationDate', 'agmDate', 'industry',
                       'dpiitRecognitionNumber', 'dpiitRecognisedOn', 'epfoCode', 'esicCode'] as const) {
        body[k] = form![k] ? form![k] : null;
      }
      const result = await patch<{ company: Company; sync: SyncResult }>(`/companies/${id}`, body);
      setSync(result.sync);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {saveError && <ErrorNote error={saveError} />}
      {sync && (
        <div className="alert alert-info">
          <strong>Saved, and the engine re-ran.</strong> {sync.applicableRules} rules apply, {sync.inapplicableRules} do
          not · {sync.created} new obligations, {sync.updated} updated, {sync.removed} withdrawn.
        </div>
      )}

      <form id="company-profile" onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Identity">
          <div className="card-body grid grid-3">
            <Field label="Legal name" error={errors.legalName}>
              <input required value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
            </Field>
            <Field label="Brand name" hint="Optional">
              <input value={form.brandName} onChange={(e) => set('brandName', e.target.value)} />
            </Field>
            <Field label="Entity type" hint="Changing this changes which rules apply">
              <select value={form.entityType} onChange={(e) => set('entityType', e.target.value as EntityType)}>
                {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>

            {isCompaniesAct ? (
              <Field label="CIN" error={errors.cin}>
                <input value={form.cin} onChange={(e) => set('cin', e.target.value.toUpperCase())} />
              </Field>
            ) : form.entityType === 'LLP' ? (
              <Field label="LLPIN" error={errors.llpin}>
                <input value={form.llpin} onChange={(e) => set('llpin', e.target.value.toUpperCase())} />
              </Field>
            ) : (
              <Field label="Registration" hint="Not required for this entity type"><input disabled placeholder="—" /></Field>
            )}

            <Field label="PAN" error={errors.pan}>
              <input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} />
            </Field>
            <Field label="TAN" hint="Needed for TDS obligations" error={errors.tan}>
              <input value={form.tan} onChange={(e) => set('tan', e.target.value.toUpperCase())} />
            </Field>
            <Field label="State" hint="Drives professional tax and ESI thresholds">
              <select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Industry" hint="Optional">
              <input value={form.industry} onChange={(e) => set('industry', e.target.value)} />
            </Field>
            <Field
              label="Incorporation date"
              hint={inc20aNote(form.entityType, Number(form.paidUpCapital), form.incorporationDate)}
              error={errors.incorporationDate}
            >
              <input required type="date" value={form.incorporationDate}
                     onChange={(e) => set('incorporationDate', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Registrations held" note="Shown on the dashboard — none of these changes which rules apply">
          <div className="card-body grid grid-2">
            <Field label="DPIIT recognition" hint="Startup India recognition number, e.g. DIPP12345">
              <input value={form.dpiitRecognitionNumber}
                     onChange={(e) => set('dpiitRecognitionNumber', e.target.value)} />
            </Field>
            <Field label="Recognised on" hint="Optional">
              <input type="date" value={form.dpiitRecognisedOn}
                     onChange={(e) => set('dpiitRecognisedOn', e.target.value)} />
            </Field>
            <Field label="PF · EPFO establishment code" hint="As issued — formats differ by office">
              <input value={form.epfoCode} onChange={(e) => set('epfoCode', e.target.value)} />
            </Field>
            <Field label="ESI · ESIC employer code" hint="17 digits on most certificates">
              <input value={form.esicCode} onChange={(e) => set('esicCode', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Profile" note="Thresholds the engine tests against">
          <div className="card-body grid grid-3">
            <Field label="Annual turnover (₹)" hint={fmtINR(form.annualTurnover)}>
              <input type="number" min={0} value={form.annualTurnover} onChange={(e) => set('annualTurnover', Number(e.target.value))} />
            </Field>
            <Field label="Paid-up capital (₹)" hint={fmtINR(form.paidUpCapital)}>
              <input type="number" min={0} value={form.paidUpCapital} onChange={(e) => set('paidUpCapital', Number(e.target.value))} />
            </Field>
            <Field label="Employees" hint="10 → ESI and POSH · 20 → provident fund">
              <input type="number" min={0} value={form.employeeCount} onChange={(e) => set('employeeCount', Number(e.target.value))} />
            </Field>
            <Field label="AGM date" hint="Moves AOC-4 (+30d), MGT-7 (+60d), ADT-1 (+15d)">
              <input type="date" value={form.agmDate} onChange={(e) => set('agmDate', e.target.value)} />
            </Field>
            <div className="field" style={{ gridColumn: 'span 2', gap: 9 }}>
              <label>Flags</label>
              {([
                ['cashTransactionRatioBelow5Pct', 'Cash dealings within 5% — raises the tax-audit threshold to ₹10 cr'],
                ['hasForeignTransactions', 'International or specified domestic transactions — adds Form 3CEB'],
                ['acceptsDeposits', 'Outstanding loans or money not treated as deposits — adds DPT-3'],
                ['buysFromMsmeSuppliers', 'Buys from MSME suppliers — adds MSME-1 and the 45-day rule'],
                ['isListed', 'Listed company'],
              ] as const).map(([key, label]) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </Card>

      </form>

      <McaImport company={company} busy={busy} run={run} />

      <Registrations company={company} busy={busy} errors={errors} run={run} />

      {/* The `form` attribute lets the submit button live outside the <form> it
          belongs to, so the actions sit at the foot of the whole page rather
          than stranded between sections. */}
      <div className="row" style={{ paddingTop: 4 }}>
        <button className="btn-primary" form="company-profile" type="submit" disabled={busy}>
          {busy ? <><Spinner /> Saving…</> : 'Save and re-run the engine'}
        </button>
        <button type="button" onClick={() => navigate('/companies')}>Back to companies</button>
        <span className="tiny dim" style={{ marginLeft: 'auto' }}>
          Directors, GSTINs and Udyam save on their own — this saves the identity and profile above.
        </span>
      </div>
    </div>
  );
}

interface McaResult {
  matchedBy: string;
  applied: { field: string; from: string | null; to: string }[];
  skipped: { field: string; why: string }[];
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  rowsInFile: number;
  sync: { created: number; removed: number; blockedBy?: string };
}

/**
 * Fill the profile from an MCA extract you downloaded.
 *
 * Nothing is fetched from MCA — this reads the CSV. The result is shown field by
 * field, because a bulk overwrite of a compliance profile should never be
 * something you have to reverse-engineer afterwards.
 */
function McaImport({ company, busy, run }: {
  company: Company; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<McaResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title="Import from MCA master data" note="CSV downloaded from MCA or data.gov.in">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="tiny muted">
          Fills the CIN, legal name, date of incorporation, state, entity type, industry and paid-up capital from
          an MCA company master-data extract. Column names differ between vintages, so they are matched by
          meaning rather than position. Nothing is fetched from MCA — this reads the file you give it.
        </span>

        {error && <ErrorNote error={error} />}

        {result && (
          <div className="alert alert-info">
            <strong>
              Matched {result.matchedBy === 'cin' ? 'on the CIN' : 'the only company in the file'} out of{' '}
              {result.rowsInFile} row{result.rowsInFile === 1 ? '' : 's'}.
            </strong>
            {result.applied.length === 0 ? (
              <div style={{ marginTop: 6 }}>Everything in the file already matched what was on record.</div>
            ) : (
              <div style={{ marginTop: 6 }}>
                {result.applied.map((a) => (
                  <div key={a.field}>
                    · <strong>{a.field}</strong>: {a.from ?? 'empty'} → {a.to}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 6 }} className="tiny">
              The engine re-ran: {result.sync.created} new obligations, {result.sync.removed} withdrawn.
              {result.sync.blockedBy ? ` ${result.sync.blockedBy}` : ''}
            </div>
            {result.unrecognisedColumns.length > 0 && (
              <div style={{ marginTop: 6 }} className="tiny dim">
                Columns ignored: {result.unrecognisedColumns.join(', ')}
              </div>
            )}
          </div>
        )}

        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden
               onChange={(e) => {
                 const file = e.target.files?.[0];
                 e.target.value = '';
                 if (!file) return;
                 setError(null);
                 void run(async () => {
                   const form = new FormData();
                   form.append('file', file);
                   try {
                     setResult(await upload<McaResult>(`/companies/${company.id}/import-mca`, form));
                   } catch (err) {
                     setError(err instanceof ApiError ? err.message : 'Could not read that file');
                     throw err;
                   }
                 });
               }} />
        <div className="dropzone" onClick={() => fileInput.current?.click()}>
          {busy ? 'Reading…' : 'Choose an MCA master-data CSV'}
        </div>
      </div>
    </Card>
  );
}

interface DirectorDraft {
  name: string; din: string; email: string; designation: string;
  appointedOn: string; resignedOn: string; isResident: boolean; dscExpiresOn: string;
}

const blankDirector = (): DirectorDraft => ({
  name: '', din: '', email: '', designation: 'Director', appointedOn: '', resignedOn: '',
  isResident: true, dscExpiresOn: '',
});

/**
 * One director, summarised until you open it.
 *
 * The resignation date matters beyond bookkeeping: a resigned director stops
 * counting towards DIR-3 KYC, so recording it changes what the engine
 * generates.
 */
function DirectorRow({ companyId, director, busy, run }: {
  companyId: string; director: Director; busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DirectorDraft>({
    name: director.name,
    din: director.din ?? '',
    email: director.email ?? '',
    designation: director.designation,
    appointedOn: director.appointedOn?.slice(0, 10) ?? '',
    resignedOn: director.resignedOn?.slice(0, 10) ?? '',
    isResident: director.isResident,
    dscExpiresOn: director.dscExpiresOn?.slice(0, 10) ?? '',
  });

  if (!open) {
    return (
      <div className="file-row">
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>
            {director.name}
            {director.resignedOn && <span className="dim" style={{ fontWeight: 400 }}> · resigned</span>}
          </span>
          <span className="tiny dim">
            {director.designation}
            {director.din ? ` · DIN ${director.din}` : ' · no DIN, so no DIR-3 KYC'}
            {director.appointedOn ? ` · from ${fmtDate(director.appointedOn)}` : ''}
          </span>
        </div>
        <button className="btn-sm" onClick={() => setOpen(true)}>Edit</button>
        <button className="btn-sm btn-ghost btn-danger" disabled={busy}
                onClick={() => run(() => del(`/companies/${companyId}/directors/${director.id}`))}>Remove</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="card-body grid grid-3">
        <Field label="Name" error={nameError ?? undefined}>
          <input value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setNameError(null); }} />
        </Field>
        <Field label="DIN / DPIN" hint="8 digits"><input value={draft.din} onChange={(e) => setDraft({ ...draft, din: e.target.value })} /></Field>
        <Field label="Designation"><input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
        <Field label="Appointed on"><input type="date" value={draft.appointedOn} onChange={(e) => setDraft({ ...draft, appointedOn: e.target.value })} /></Field>
        <Field label="DSC expires on" hint="Blank if no digital signature is recorded">
          <input type="date" value={draft.dscExpiresOn}
                 onChange={(e) => setDraft({ ...draft, dscExpiresOn: e.target.value })} />
        </Field>
        <Field label="Resigned on" hint="Once set, they stop counting for DIR-3 KYC">
          <input type="date" value={draft.resignedOn} onChange={(e) => setDraft({ ...draft, resignedOn: e.target.value })} />
        </Field>
        <div className="row" style={{ gridColumn: 'span 3' }}>
          <label className="check">
            <input type="checkbox" checked={draft.isResident} onChange={(e) => setDraft({ ...draft, isResident: e.target.checked })} />
            Resident in India
          </label>
          <span style={{ marginLeft: 'auto' }} className="row">
            <button className="btn-primary btn-sm" disabled={busy}
                    onClick={() => {
                      if (draft.name.trim().length < 2) {
                        setNameError("A director's name is required.");
                        return;
                      }
                      setNameError(null);
                      void run(async () => {
                      await patch(`/companies/${companyId}/directors/${director.id}`, {
                        name: draft.name.trim(),
                        designation: draft.designation || 'Director',
                        isResident: draft.isResident,
                        din: draft.din.trim() || null,
                        email: draft.email.trim() || null,
                        appointedOn: draft.appointedOn || null,
                        resignedOn: draft.resignedOn || null,
                        dscExpiresOn: draft.dscExpiresOn || null,
                      });
                      setOpen(false);
                      });
                    }}>Save director</button>
            <button className="btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Directors, GSTINs and Udyam — each has its own endpoint, so each saves on its own. */
function Registrations({
  company, busy, errors, run,
}: {
  company: Company; busy: boolean; errors: Record<string, string>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const officers = officersFor(company.entityType);
  const [director, setDirector] = useState(blankDirector());
  // Client-side validation messages, keyed by the field they belong to.
  const [local, setLocal] = useState<Record<string, string>>({});
  const setLocalError = (key: string, message: string | null) =>
    setLocal((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  const [gst, setGst] = useState({ gstin: '', filingFrequency: 'MONTHLY' });
  const [msme, setMsme] = useState({
    udyamNumber: company.msmeRegistration?.udyamNumber ?? '',
    category: company.msmeRegistration?.category ?? 'MICRO',
  });

  return (
    <>
      <Card title={officers.plural} note={`${officers.note} A DIN on record adds the annual DIR-3 KYC.`}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {company.directors.map((d) => (
            <DirectorRow key={d.id} companyId={company.id} director={d} busy={busy} run={run} />
          ))}
          {company.directors.length === 0 && <span className="tiny dim">None on record.</span>}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 2 }}>
            <span className="tiny dim">Add a {officers.singular}</span>
            <div className="grid grid-3" style={{ marginTop: 8 }}>
              <Field label="Name" error={local.directorName}>
                <input value={director.name} placeholder="Full name"
                       onChange={(e) => { setDirector({ ...director, name: e.target.value }); setLocalError('directorName', null); }} />
              </Field>
              <Field label="DIN / DPIN" hint="8 digits — this is what adds DIR-3 KYC">
                <input value={director.din} placeholder="08123456"
                       onChange={(e) => setDirector({ ...director, din: e.target.value })} />
              </Field>
              <Field label="Designation">
                <input value={director.designation}
                       onChange={(e) => setDirector({ ...director, designation: e.target.value })} />
              </Field>
              <Field label="Email" hint="Optional — used for reminders addressed to them">
                <input type="email" value={director.email} placeholder="name@company.com"
                       onChange={(e) => setDirector({ ...director, email: e.target.value })} />
              </Field>
              <Field label="Appointed on">
                <input type="date" value={director.appointedOn}
                       onChange={(e) => setDirector({ ...director, appointedOn: e.target.value })} />
              </Field>
              <Field label="DSC expires on" hint="Optional — drives the DSC status on the dashboard">
                <input type="date" value={director.dscExpiresOn}
                       onChange={(e) => setDirector({ ...director, dscExpiresOn: e.target.value })} />
              </Field>
              <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
                <label className="check" style={{ flex: 1 }}>
                  <input type="checkbox" checked={director.isResident}
                         onChange={(e) => setDirector({ ...director, isResident: e.target.checked })} />
                  Resident in India
                </label>
                <button type="button" disabled={busy}
                        onClick={() => {
                          // Validated on click rather than by disabling the button:
                          // a dead control tells you nothing about what it wants.
                          if (director.name.trim().length < 2) {
                            setLocalError('directorName', "A director's name is required.");
                            return;
                          }
                          setLocalError('directorName', null);
                          void run(async () => {
                          await post(`/companies/${company.id}/directors`, {
                            name: director.name.trim(),
                            designation: director.designation || officers.designation,
                            isResident: director.isResident,
                            ...(director.din ? { din: director.din.trim() } : {}),
                            ...(director.email ? { email: director.email.trim() } : {}),
                            ...(director.appointedOn ? { appointedOn: director.appointedOn } : {}),
                            ...(director.dscExpiresOn ? { dscExpiresOn: director.dscExpiresOn } : {}),
                          });
                          setDirector(blankDirector());
                          });
                        }}>Add {officers.singular}</button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="GST registrations" note="One set of returns is generated per GSTIN">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {company.gstRegistrations.map((g) => (
            <div key={g.id} className="file-row">
              <div className="stack" style={{ flex: 1 }}>
                <span className="mono" style={{ fontWeight: 500 }}>{g.gstin}</span>
                <span className="tiny dim">{g.stateCode} · {g.filingFrequency.toLowerCase()}{g.isActive ? '' : ' · inactive'}</span>
              </div>
              <select value={g.filingFrequency} disabled={busy} style={{ width: 150 }}
                      onChange={(e) => run(() => patch(`/companies/${company.id}/gst-registrations/${g.id}`, { filingFrequency: e.target.value }))}>
                <option value="MONTHLY">Monthly</option>
                <option value="QRMP">QRMP</option>
                <option value="COMPOSITION">Composition</option>
              </select>
              <button className="btn-sm btn-ghost btn-danger" disabled={busy}
                      onClick={() => run(() => del(`/companies/${company.id}/gst-registrations/${g.id}`))}>Remove</button>
            </div>
          ))}
          {company.gstRegistrations.length === 0 && <span className="tiny dim">None on record.</span>}

          <div className="grid grid-3" style={{ alignItems: 'end' }}>
            <Field
              label="GSTIN"
              hint="Check digit and embedded PAN are verified"
              error={local.gstin ?? errors[`gstin:${gst.gstin.trim().toUpperCase()}`]}
            >
              <input value={gst.gstin} placeholder="33AAACN4321B1ZA"
                     onChange={(e) => { setGst({ ...gst, gstin: e.target.value.toUpperCase() }); setLocalError('gstin', null); }} />
            </Field>
            <Field label="Filing frequency">
              <select value={gst.filingFrequency} onChange={(e) => setGst({ ...gst, filingFrequency: e.target.value })}>
                <option value="MONTHLY">Monthly</option>
                <option value="QRMP">QRMP (quarterly)</option>
                <option value="COMPOSITION">Composition</option>
              </select>
            </Field>
            <button type="button" disabled={busy}
                    onClick={() => {
                      if (gst.gstin.trim().length !== 15) {
                        setLocalError('gstin', 'A GSTIN is 15 characters, e.g. 33AAACN4321B1ZA.');
                        return;
                      }
                      setLocalError('gstin', null);
                      void run(async () => {
                      await post(`/companies/${company.id}/gst-registrations`, {
                        gstin: gst.gstin.trim().toUpperCase(), filingFrequency: gst.filingFrequency,
                      });
                      setGst({ gstin: '', filingFrequency: 'MONTHLY' });
                      });
                    }}>Add GSTIN</button>
          </div>
        </div>
      </Card>

      <Card title="Udyam (MSME) registration">
        <div className="card-body grid grid-3" style={{ alignItems: 'end' }}>
          <Field label="Udyam number" hint="UDYAM-KA-03-0114562" error={local.udyam ?? errors['udyamNumber']}>
            <input value={msme.udyamNumber}
                   onChange={(e) => { setMsme({ ...msme, udyamNumber: e.target.value.toUpperCase() }); setLocalError('udyam', null); }} />
          </Field>
          <Field label="Category">
            <select value={msme.category} onChange={(e) => setMsme({ ...msme, category: e.target.value })}>
              <option value="MICRO">Micro</option><option value="SMALL">Small</option><option value="MEDIUM">Medium</option>
            </select>
          </Field>
          <div className="row">
            <button type="button" disabled={busy}
                    onClick={() => {
                      if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(msme.udyamNumber.trim().toUpperCase())) {
                        setLocalError('udyam', 'A Udyam number looks like UDYAM-KA-03-0114562.');
                        return;
                      }
                      setLocalError('udyam', null);
                      void run(() => put(`/companies/${company.id}/msme-registration`, {
                        udyamNumber: msme.udyamNumber.trim().toUpperCase(), category: msme.category,
                      }));
                    }}>Save</button>
            {company.msmeRegistration && (
              <button type="button" className="btn-ghost btn-danger" disabled={busy}
                      onClick={() => run(async () => {
                        await del(`/companies/${company.id}/msme-registration`);
                        setMsme({ udyamNumber: '', category: 'MICRO' });
                      })}>Remove</button>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
