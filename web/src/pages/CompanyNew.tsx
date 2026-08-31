import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, get, post, upload } from '../api/client';
import { useCompanies } from '../auth/CompanyContext';
import type { Company, EntityType, SyncResult } from '../api/types';
import { Card, ErrorNote, Field, Spinner, inc20aNote, officersFor } from '../components/ui';

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

interface DirectorDraft {
  name: string; din: string; email: string; designation: string; appointedOn: string;
  isResident: boolean; dscExpiresOn: string;
}
interface GstDraft { gstin: string; filingFrequency: 'MONTHLY' | 'QRMP' | 'COMPOSITION'; isTdsDeductor: boolean; isEcommerceOperator: boolean }

const blankDirector = (designation = 'Director'): DirectorDraft => ({
  name: '', din: '', email: '', designation, appointedOn: '', isResident: true, dscExpiresOn: '',
});

/** A row someone has started filling in — never discarded behind their back. */
const isStarted = (d: DirectorDraft) => Boolean(d.name.trim() || d.din.trim() || d.email.trim());
const blankGst = (): GstDraft => ({ gstin: '', filingFrequency: 'MONTHLY', isTdsDeductor: false, isEcommerceOperator: false });

/** Turns the API's zod issue list into per-field messages. */
function fieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    if (d && typeof d === 'object' && 'field' in d && 'message' in d) {
      out[String(d.field)] = String(d.message);
    }
    // GST failures come back as { gstin, problems: [] }
    if (d && typeof d === 'object' && 'gstin' in d && 'problems' in d) {
      out[`gstin:${String(d.gstin)}`] = (d.problems as string[]).join(' ');
    }
  }
  return out;
}

interface ImportPreview {
  source: 'csv' | 'pdf';
  fileName: string;
  record: {
    cin: string | null; llpin: string | null; pan: string | null; name: string | null;
    incorporatedOn: string | null; paidUpCapital: number | null; authorisedCapital: number | null;
    stateCode: string | null; entityType: EntityType | null; industry: string | null; status: string | null;
  } | null;
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  rowsInFile: number;
  note: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  cin: 'CIN', llpin: 'LLPIN', pan: 'PAN', legalName: 'Legal name',
  incorporationDate: 'Incorporation date', paidUpCapital: 'Paid-up capital',
  stateCode: 'State', entityType: 'Entity type', industry: 'Industry',
};

/**
 * Fills the form from a document you already hold.
 *
 * It reads the file and offers what it found — it does not submit anything.
 * A profile decides which statutory obligations exist, so what a file changed
 * is listed field by field rather than left to be discovered later.
 *
 * Nothing is fetched from MCA or any registry; this reads the file you give it.
 */
function ImportPanel({ busy, onApply }: {
  busy: boolean;
  onApply: (preview: ImportPreview) => string[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ preview: ImportPreview; applied: string[] } | null>(null);

  async function read(file: File) {
    setReading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const preview = await upload<ImportPreview>('/companies/import-preview', form);
      setResult({ preview, applied: onApply(preview) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That file could not be read.');
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void read(file);
  };

  return (
    <Card
      title="Start from a document"
      note="Optional — everything below can be typed in by hand instead"
    >
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="tiny muted">
          Reads an <strong>MCA master-data CSV</strong> or a <strong>PDF</strong> such as the certificate of
          incorporation, and fills in the CIN, legal name, date of incorporation, state, entity type, industry
          and capital below. Column names differ between MCA vintages, so they are matched by meaning rather
          than position. Nothing is fetched from any registry — this reads the file you give it, and fills in
          the form for you to check before anything is saved.
        </span>

        <div
          className={`dropzone${over ? ' over' : ''}${reading ? ' busy' : ''}`}
          onClick={() => !reading && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          {reading ? (
            <span className="dropzone-title"><Spinner /> Reading the file…</span>
          ) : (
            <>
              <div className="dropzone-title">Drop a file here, or choose one</div>
              <div className="dropzone-sub">A scanned image carries no text to read, so it cannot be used.</div>
              <div className="dropzone-formats">
                <span className="format-chip">CSV</span>
                <span className="format-chip">PDF</span>
              </div>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            style={{ display: 'none' }}
            disabled={busy || reading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
          />
        </div>

        {error && <ErrorNote error={error} />}

        {result && (
          <>
            {result.applied.length > 0 ? (
              <div className="alert alert-info">
                <strong>Filled {result.applied.length} field{result.applied.length === 1 ? '' : 's'}</strong> from{' '}
                {result.preview.fileName}. Check them below — nothing is saved until you onboard.
              </div>
            ) : (
              <div className="alert alert-warn">
                Nothing in {result.preview.fileName} could be used. {result.preview.note ?? ''}
              </div>
            )}

            {result.preview.note && result.applied.length > 0 && (
              <span className="tiny dim">{result.preview.note}</span>
            )}

            {result.applied.length > 0 && (
              <div>
                {result.applied.map((f) => {
                  const value = f === 'legalName' ? result.preview.record?.name
                    : f === 'incorporationDate' ? result.preview.record?.incorporatedOn
                      : f === 'paidUpCapital' ? String(result.preview.record?.paidUpCapital ?? '')
                        : (result.preview.record as Record<string, unknown> | null)?.[f];
                  return (
                    <div key={f} className="import-row">
                      <span className="import-field">{FIELD_LABEL[f] ?? f}</span>
                      <span className="import-value">{String(value ?? '')}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {result.preview.source === 'csv' && result.preview.unrecognisedColumns.length > 0 && (
              <span className="tiny dim">
                Ignored {result.preview.unrecognisedColumns.length} column
                {result.preview.unrecognisedColumns.length === 1 ? '' : 's'} this form has no home for:{' '}
                {result.preview.unrecognisedColumns.slice(0, 8).join(', ')}
                {result.preview.unrecognisedColumns.length > 8 ? '…' : ''}
              </span>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export function CompanyNew() {
  const navigate = useNavigate();
  const { reload, select } = useCompanies();

  const [form, setForm] = useState({
    legalName: '', brandName: '', entityType: 'PRIVATE_LIMITED' as EntityType,
    cin: '', llpin: '', pan: '', tan: '', incorporationDate: '', agmDate: '',
    stateCode: 'TN', industry: '', employeeCount: 0,
    annualTurnover: 0, paidUpCapital: 0,
    cashTransactionRatioBelow5Pct: true, hasForeignTransactions: false,
    acceptsDeposits: false, isListed: false, buysFromMsmeSuppliers: true,
    dpiitRecognitionNumber: '', dpiitRecognisedOn: '', epfoCode: '', esicCode: '',
  });
  const [directors, setDirectors] = useState<DirectorDraft[]>(() => {
    const spec = officersFor('PRIVATE_LIMITED');
    return Array.from({ length: spec.min }, () => blankDirector(spec.designation));
  });
  const [gsts, setGsts] = useState<GstDraft[]>([blankGst()]);
  const [msme, setMsme] = useState({ enabled: false, udyamNumber: '', category: 'MICRO', registeredOn: '' });

  const [derived, setDerived] = useState<string[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const isCompaniesAct = ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8'].includes(form.entityType);
  const officers = officersFor(form.entityType);
  const namedOfficers = directors.filter((d) => d.name.trim()).length;
  const atOfficerCap = officers.max !== undefined && directors.length >= officers.max;

  /**
   * A CIN is a structured identifier, so entity type, state, listing status and
   * a broad industry can be read straight out of it. Nothing is fetched from
   * MCA — the legal name and the exact incorporation date are not encoded in
   * the CIN and are left for the user to enter.
   *
   * Fields the identifier actually settles are overwritten; the industry is a
   * broad guess, so it only fills a blank.
   */
  async function lookupCin(cin: string) {
    const value = cin.toUpperCase().trim();
    if (value.length !== 21) return;

    setLooking(true);
    try {
      const result = await get<{
        suggested: {
          entityType: EntityType | null; stateCode: string | null;
          isListed: boolean; industry: string | null; incorporationYear: number;
        };
      }>(`/lookup/cin/${value}`);

      const s = result.suggested;

      // Built outside the state updater: React runs updaters twice under
      // StrictMode, so anything with a side effect in there fires twice.
      const filled: string[] = [];
      const patch: Partial<typeof form> = { isListed: s.isListed };

      if (s.entityType) {
        patch.entityType = s.entityType;
        filled.push(`entity type (${s.entityType.replace(/_/g, ' ').toLowerCase()})`);
      }
      if (s.stateCode && STATES.includes(s.stateCode)) {
        patch.stateCode = s.stateCode;
        filled.push(`state (${s.stateCode})`);
      }
      filled.push(s.isListed ? 'listed company' : 'unlisted company');
      // The industry is a broad division, so it only fills a blank.
      if (s.industry && !form.industry) {
        patch.industry = s.industry;
        filled.push(`industry (${s.industry.toLowerCase()})`);
      }
      filled.push(`incorporated in ${s.incorporationYear}`);

      setForm((f) => ({ ...f, ...patch }));
      // The CIN can change the entity type too, so the rows follow it here as
      // well — otherwise a looked-up LLP kept a company's director rows.
      if (patch.entityType) fitOfficers(patch.entityType);
      setDerived(filled);
    } catch {
      // A malformed CIN is already reported by the field's own validation.
      setDerived(null);
    } finally {
      setLooking(false);
    }
  }

  /**
   * Puts a parsed document into the form.
   *
   * Only empty fields are filled, so a second import cannot quietly overwrite
   * something already typed; the caller is told exactly which fields moved.
   */
  function applyImport(preview: ImportPreview): string[] {
    const r = preview.record;
    if (!r) return [];

    const filled: string[] = [];
    const patch: Record<string, unknown> = {};
    const take = (field: string, value: string | null | undefined, current: string | number) => {
      if (!value || (typeof current === 'string' ? current.trim() : current)) return;
      patch[field] = value;
      filled.push(field);
    };

    take('cin', r.cin, form.cin);
    take('llpin', r.llpin, form.llpin);
    take('pan', r.pan, form.pan);
    take('legalName', r.name, form.legalName);
    take('incorporationDate', r.incorporatedOn ? r.incorporatedOn.slice(0, 10) : null, form.incorporationDate);
    take('industry', r.industry, form.industry);

    // These two have defaults rather than blanks, so "untouched" is the default
    // itself — TN is the form's opening state, and zero capital is no capital.
    if (r.stateCode && STATES.includes(r.stateCode) && form.stateCode === 'TN') {
      patch.stateCode = r.stateCode;
      filled.push('stateCode');
    }
    if (r.entityType) {
      patch.entityType = r.entityType;
      filled.push('entityType');
    }
    if (r.paidUpCapital && !form.paidUpCapital) {
      patch.paidUpCapital = r.paidUpCapital;
      filled.push('paidUpCapital');
    }

    setForm((f) => ({ ...f, ...patch }));
    if (patch.entityType) fitOfficers(patch.entityType as EntityType);
    return filled;
  }

  /**
   * Changing the entity type re-opens the right rows.
   *
   * Only blanks are added or removed: a row with anything typed in it survives
   * the change, even when the new type allows fewer, because silently dropping
   * a director someone just keyed in is worse than showing the count is wrong.
   */
  function fitOfficers(entityType: EntityType) {
    const spec = officersFor(entityType);
    setDirectors((rows) => {
      const started = rows.filter(isStarted);
      const out = [...started];
      while (out.length < spec.min && (spec.max === undefined || out.length < spec.max)) {
        out.push(blankDirector(spec.designation));
      }
      return out.length ? out : [blankDirector(spec.designation)];
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});

    const body: Record<string, unknown> = {
      legalName: form.legalName,
      entityType: form.entityType,
      stateCode: form.stateCode,
      employeeCount: Number(form.employeeCount),
      annualTurnover: Math.round(Number(form.annualTurnover)),
      paidUpCapital: Math.round(Number(form.paidUpCapital)),
      cashTransactionRatioBelow5Pct: form.cashTransactionRatioBelow5Pct,
      hasForeignTransactions: form.hasForeignTransactions,
      acceptsDeposits: form.acceptsDeposits,
      isListed: form.isListed,
      buysFromMsmeSuppliers: form.buysFromMsmeSuppliers,
      directors: directors
        .filter((d) => d.name.trim())
        .map((d) => ({
          name: d.name.trim(),
          designation: d.designation || officers.designation,
          isResident: d.isResident,
          ...(d.din ? { din: d.din.trim() } : {}),
          ...(d.email ? { email: d.email.trim() } : {}),
          ...(d.appointedOn ? { appointedOn: d.appointedOn } : {}),
          ...(d.dscExpiresOn ? { dscExpiresOn: d.dscExpiresOn } : {}),
        })),
      gstRegistrations: gsts
        .filter((g) => g.gstin.trim())
        .map((g) => ({
          gstin: g.gstin.trim().toUpperCase(),
          filingFrequency: g.filingFrequency,
          isTdsDeductor: g.isTdsDeductor,
          isEcommerceOperator: g.isEcommerceOperator,
        })),
    };

    // Optional fields must be omitted, not sent empty — the schema validates format.
    for (const k of ['brandName', 'cin', 'llpin', 'pan', 'tan', 'incorporationDate', 'agmDate', 'industry',
                     'dpiitRecognitionNumber', 'dpiitRecognisedOn', 'epfoCode', 'esicCode'] as const) {
      if (form[k]) body[k] = form[k];
    }
    if (msme.enabled && msme.udyamNumber) {
      body.msmeRegistration = {
        udyamNumber: msme.udyamNumber.toUpperCase(),
        category: msme.category,
        ...(msme.registeredOn ? { registeredOn: msme.registeredOn } : {}),
      };
    }

    try {
      const result = await post<{ company: Company; sync: SyncResult }>('/companies', body);
      reload();
      select(result.company.id);
      navigate('/calendar');
    } catch (err) {
      if (err instanceof ApiError) {
        const byField = fieldErrors(err.details);
        setErrors(byField);
        // The banner is for errors that belong to no particular field; anything
        // the server named a field for is shown against that field instead.
        setError(Object.keys(byField).length === 0 ? err.message : null);
      } else {
        setError('Could not reach the server');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && <ErrorNote error={error} />}

      <ImportPanel busy={busy} onApply={applyImport} />

      {derived && (
        <div className="alert alert-info">
          <strong>Read from the CIN:</strong> {derived.join(' · ')}.{' '}
          <span className="dim">
            The legal name and the exact incorporation date are not encoded in a CIN and no MCA service is
            contacted, so those are yours to fill in.
          </span>
        </div>
      )}

      <Card title="Entity" note="These fields decide which rules apply">
        <div className="card-body grid grid-3">
          <Field label="Legal name" error={errors.legalName}>
            <input required value={form.legalName} onChange={(e) => set('legalName', e.target.value)}
                   placeholder="Northwind Technologies Private Limited" />
          </Field>
          <Field label="Brand name" hint="Optional">
            <input value={form.brandName} onChange={(e) => set('brandName', e.target.value)} />
          </Field>
          <Field label="Entity type">
            <select
              value={form.entityType}
              onChange={(e) => {
                const next = e.target.value as EntityType;
                set('entityType', next);
                fitOfficers(next);
              }}
            >
              {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          {isCompaniesAct ? (
            <Field
              label="CIN"
              hint={looking ? 'Reading the CIN…' : '21 characters — entity type, state and year are read from it'}
              error={errors.cin}
            >
              <input
                required
                value={form.cin}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  set('cin', v);
                  if (v.length === 21) void lookupCin(v);
                  else setDerived(null);
                }}
                onBlur={(e) => void lookupCin(e.target.value)}
                placeholder="U72900TN2020PTC138472"
              />
            </Field>
          ) : form.entityType === 'LLP' ? (
            <Field label="LLPIN" hint="e.g. AAB-7743" error={errors.llpin}>
              <input required value={form.llpin} onChange={(e) => set('llpin', e.target.value.toUpperCase())} placeholder="AAB-7743" />
            </Field>
          ) : (
            <Field label="Registration" hint="Not required for this entity type">
              <input disabled placeholder="—" />
            </Field>
          )}

          <Field label="PAN" error={errors.pan}>
            <input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="AAACN4321B" />
          </Field>
          <Field label="TAN" hint="Needed for TDS obligations" error={errors.tan}>
            <input value={form.tan} onChange={(e) => set('tan', e.target.value.toUpperCase())} placeholder="CHEN12345B" />
          </Field>

          <Field label="State" hint="Drives professional tax and ESI thresholds">
            <select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Industry" hint="Optional">
            <input value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Software products" />
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

      <Card title="Profile" note="Thresholds the engine tests against">
        <div className="card-body grid grid-3">
          <Field label="Annual turnover (₹)" hint="₹2 cr → GSTR-9 · ₹5 cr → GSTR-9C and e-invoicing">
            <input type="number" min={0} value={form.annualTurnover}
                   onChange={(e) => set('annualTurnover', Number(e.target.value))} />
          </Field>
          <Field label="Paid-up capital / contribution (₹)" hint="Above ₹4 cr a company is no longer 'small'">
            <input type="number" min={0} value={form.paidUpCapital}
                   onChange={(e) => set('paidUpCapital', Number(e.target.value))} />
          </Field>
          <Field label="Employees" hint="10 → ESI and POSH · 20 → provident fund">
            <input type="number" min={0} value={form.employeeCount}
                   onChange={(e) => set('employeeCount', Number(e.target.value))} />
          </Field>

          <Field label="AGM date" hint="Moves AOC-4 (+30d), MGT-7 (+60d), ADT-1 (+15d)">
            <input type="date" value={form.agmDate} onChange={(e) => set('agmDate', e.target.value)} />
          </Field>

          <div className="field" style={{ gridColumn: 'span 2', gap: 9 }}>
            <label>Flags</label>
            <label className="check">
              <input type="checkbox" checked={form.cashTransactionRatioBelow5Pct}
                     onChange={(e) => set('cashTransactionRatioBelow5Pct', e.target.checked)} />
              Cash receipts and payments stay within 5% — raises the tax-audit threshold from ₹1 cr to ₹10 cr
            </label>
            <label className="check">
              <input type="checkbox" checked={form.hasForeignTransactions}
                     onChange={(e) => set('hasForeignTransactions', e.target.checked)} />
              Has international or specified domestic transactions — adds Form 3CEB, moves the ITR to 30 Nov
            </label>
            <label className="check">
              <input type="checkbox" checked={form.acceptsDeposits}
                     onChange={(e) => set('acceptsDeposits', e.target.checked)} />
              Has outstanding loans or money not treated as deposits — adds DPT-3
            </label>
            <label className="check">
              <input type="checkbox" checked={form.buysFromMsmeSuppliers}
                     onChange={(e) => set('buysFromMsmeSuppliers', e.target.checked)} />
              Buys from MSME-registered suppliers — adds MSME-1 and the 45-day payment rule
            </label>
            <label className="check">
              <input type="checkbox" checked={form.isListed} onChange={(e) => set('isListed', e.target.checked)} />
              Listed company
            </label>
          </div>
        </div>
      </Card>

      <Card
        title={officers.plural}
        note={`${officers.note} A DIN or DPIN on record adds the annual DIR-3 KYC.`}
        action={
          <button
            type="button"
            className="btn-sm"
            disabled={atOfficerCap}
            title={atOfficerCap ? officers.note : undefined}
            onClick={() => setDirectors((d) => [...d, blankDirector(officers.designation)])}
          >
            Add {officers.singular}
          </button>
        }
      >
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {/* The statutory minimum is opened for you; this says where you are
              against it rather than letting the count be a surprise at submit. */}
          <span className={`tiny ${namedOfficers < officers.min ? '' : 'dim'}`}
                style={namedOfficers < officers.min ? { color: 'var(--high)' } : undefined}>
            {namedOfficers} of {officers.min} named
            {namedOfficers < officers.min
              ? ` — ${officers.min - namedOfficers} more to meet the minimum`
              : ' · add more as needed'}
          </span>

          {directors.map((d, i) => {
            const edit = (patch: Partial<DirectorDraft>) =>
              setDirectors((ds) => ds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="grid grid-3"
                   style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, paddingTop: i > 0 ? 12 : 0 }}>
                <Field label={`${officers.singular[0]!.toUpperCase()}${officers.singular.slice(1)} name`}>
                  <input value={d.name} placeholder="Priya Ramanathan" onChange={(e) => edit({ name: e.target.value })} />
                </Field>
                <Field label="DIN / DPIN" hint="8 digits — this is what adds DIR-3 KYC">
                  <input value={d.din} placeholder="08123456" onChange={(e) => edit({ din: e.target.value })} />
                </Field>
                <Field label="Designation">
                  <input value={d.designation} onChange={(e) => edit({ designation: e.target.value })} />
                </Field>
                <Field label="Email" hint="Optional">
                  <input type="email" value={d.email} placeholder="name@company.com"
                         onChange={(e) => edit({ email: e.target.value })} />
                </Field>
                <Field label="Appointed on">
                  <input type="date" value={d.appointedOn} onChange={(e) => edit({ appointedOn: e.target.value })} />
                </Field>
                <Field label="DSC expires on" hint="Optional — sets the DSC standing on the dashboard">
                  <input type="date" value={d.dscExpiresOn} onChange={(e) => edit({ dscExpiresOn: e.target.value })} />
                </Field>
                <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
                  <label className="check" style={{ flex: 1 }}>
                    <input type="checkbox" checked={d.isResident} onChange={(e) => edit({ isResident: e.target.checked })} />
                    Resident in India
                  </label>
                  {directors.length > 1 && (
                    <button type="button" className="btn-ghost btn-danger btn-sm"
                            onClick={() => setDirectors((ds) => ds.filter((_, j) => j !== i))}>Remove</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="GST registrations"
        note="One set of returns is generated per GSTIN"
        action={<button type="button" className="btn-sm" onClick={() => setGsts((g) => [...g, blankGst()])}>Add</button>}
      >
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {gsts.map((g, i) => (
            <div key={i} className="grid grid-3" style={{ alignItems: 'end' }}>
              <Field
                label="GSTIN"
                hint="Check digit and embedded PAN are verified"
                error={errors[`gstin:${g.gstin.trim().toUpperCase()}`]}
              >
                <input value={g.gstin} placeholder="33AAACN4321B1ZA"
                       onChange={(e) => setGsts((gs) => gs.map((x, j) => (j === i ? { ...x, gstin: e.target.value.toUpperCase() } : x)))} />
              </Field>
              <Field label="Filing frequency" hint="QRMP shifts GSTR-3B to the 22nd or 24th">
                <select value={g.filingFrequency}
                        onChange={(e) => setGsts((gs) => gs.map((x, j) => (j === i ? { ...x, filingFrequency: e.target.value as GstDraft['filingFrequency'] } : x)))}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QRMP">QRMP (quarterly)</option>
                  <option value="COMPOSITION">Composition</option>
                </select>
              </Field>
              <div className="field" style={{ gap: 7 }}>
                <label>Also registered as</label>
                <label className="check">
                  <input type="checkbox" checked={g.isTdsDeductor}
                         onChange={(e) => setGsts((gs) => gs.map((x, j) => (j === i ? { ...x, isTdsDeductor: e.target.checked } : x)))} />
                  TDS deductor (GSTR-7)
                </label>
                <div className="row">
                  <label className="check">
                    <input type="checkbox" checked={g.isEcommerceOperator}
                           onChange={(e) => setGsts((gs) => gs.map((x, j) => (j === i ? { ...x, isEcommerceOperator: e.target.checked } : x)))} />
                    E-commerce operator (GSTR-8)
                  </label>
                  {gsts.length > 1 && (
                    <button type="button" className="btn-ghost btn-danger btn-sm" style={{ marginLeft: 'auto' }}
                            onClick={() => setGsts((gs) => gs.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Other registrations held"
        note="None of these changes which rules apply — they are what the dashboard reports"
      >
        <div className="card-body grid grid-2">
          <Field label="DPIIT recognition" hint="Startup India recognition number, e.g. DIPP12345"
                 error={errors.dpiitRecognitionNumber}>
            <input value={form.dpiitRecognitionNumber}
                   onChange={(e) => set('dpiitRecognitionNumber', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Recognised on" hint="Optional">
            <input type="date" value={form.dpiitRecognisedOn}
                   onChange={(e) => set('dpiitRecognisedOn', e.target.value)} />
          </Field>
          <Field label="PF · EPFO establishment code" hint="As issued — formats differ by office"
                 error={errors.epfoCode}>
            <input value={form.epfoCode} onChange={(e) => set('epfoCode', e.target.value.toUpperCase())} />
          </Field>
          <Field label="ESI · ESIC employer code" hint="17 digits on most certificates" error={errors.esicCode}>
            <input value={form.esicCode} onChange={(e) => set('esicCode', e.target.value.toUpperCase())} />
          </Field>
        </div>
      </Card>

      <Card title="Udyam (MSME) registration">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="check">
            <input type="checkbox" checked={msme.enabled} onChange={(e) => setMsme((m) => ({ ...m, enabled: e.target.checked }))} />
            This entity holds a Udyam registration
          </label>
          {msme.enabled && (
            <div className="grid grid-3">
              <Field label="Udyam number" hint="UDYAM-KA-03-0114562" error={errors['msmeRegistration.udyamNumber']}>
                <input value={msme.udyamNumber} placeholder="UDYAM-KA-03-0114562"
                       onChange={(e) => setMsme((m) => ({ ...m, udyamNumber: e.target.value.toUpperCase() }))} />
              </Field>
              <Field label="Category">
                <select value={msme.category} onChange={(e) => setMsme((m) => ({ ...m, category: e.target.value }))}>
                  <option value="MICRO">Micro</option>
                  <option value="SMALL">Small</option>
                  <option value="MEDIUM">Medium</option>
                </select>
              </Field>
              <Field label="Registered on">
                <input type="date" value={msme.registeredOn} onChange={(e) => setMsme((m) => ({ ...m, registeredOn: e.target.value }))} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <div className="row">
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? <><Spinner /> Building the calendar…</> : 'Onboard and build calendar'}
        </button>
        <button type="button" onClick={() => navigate('/companies')}>Cancel</button>
        <span className="tiny dim" style={{ marginLeft: 'auto' }}>
          The engine runs immediately and generates roughly 13 months of history plus 18 months ahead.
        </span>
      </div>
    </form>
  );
}
