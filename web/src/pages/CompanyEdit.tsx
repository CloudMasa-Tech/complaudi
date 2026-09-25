import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, forceDownload, patch, post, put, upload, view, resolveApiUrl } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { BusinessType, Company, Director, EntityType, SyncResult } from '../api/types';
import { BUSINESS_TYPE_LABEL, Card, ErrorNote, Field, Loading, ServiceLink, Spinner, fmtDate, fmtINR, inc20aNote, officersFor } from '../components/ui';
import { REGISTRATION_FIELD_LINKS } from '../lib/registrationLinks';

/** Shared with the onboarding form so create and edit read identically. */
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

const TABS = [
  { id: 'all', label: 'All Sections' },
  { id: 'basic', label: 'Basic Details' },
  { id: 'gst', label: 'GST' },
  { id: 'msme', label: 'MSME / Udyam' },
  { id: 'dpiit', label: 'DPIIT / Startup' },
  { id: 'dsc', label: 'DSC' },
  { id: 'incometax', label: 'Income Tax' },
  { id: 'pf', label: 'PF' },
  { id: 'esi', label: 'ESI' },
  { id: 'documents', label: 'Master Documents' },
  { id: 'directors', label: 'Directors' },
  { id: 'import', label: 'MCA Import' },
] as const;

type TabId = typeof TABS[number]['id'];

/** Only the fields the API accepts on PATCH — identity and profile. */
interface ProfileForm {
  legalName: string; brandName: string; entityType: EntityType; businessType: BusinessType | null;
  cin: string; llpin: string; pan: string; tan: string;
  incorporationDate: string; agmDate: string; stateCode: string; industry: string;
  employeeCount: number; annualTurnover: number; paidUpCapital: number;
  cashTransactionRatioBelow5Pct: boolean; hasForeignTransactions: boolean;
  acceptsDeposits: boolean; isListed: boolean; buysFromMsmeSuppliers: boolean;
  dpiitRecognitionNumber: string; dpiitRecognisedOn: string; epfoCode: string; esicCode: string;
  shopAndEstablishment: string; fssaiNumber: string; professionalTax: string; tradeLicense: string;
  registeredAddress: string; companyStatus: string; companyCategory: string; companySubCategory: string; companyClass: string;
  authorisedCapital: number;
}

const toForm = (c: Company): ProfileForm => ({
  legalName: c.legalName, brandName: c.brandName ?? '', entityType: c.entityType,
  businessType: c.businessType,
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
  shopAndEstablishment: c.shopAndEstablishment ?? '', fssaiNumber: c.fssaiNumber ?? '',
  professionalTax: c.professionalTax ?? '', tradeLicense: c.tradeLicense ?? '',
  registeredAddress: c.registeredAddress ?? '', companyStatus: c.companyStatus ?? '',
  companyCategory: c.companyCategory ?? '', companySubCategory: c.companySubCategory ?? '',
  companyClass: c.companyClass ?? '',
  authorisedCapital: Number(c.authorisedCapital),
});

/** The matching partner-service link for a CompanyEdit field key, when one exists. */
function FieldService({ field }: { field: string }) {
  const service = REGISTRATION_FIELD_LINKS[field];
  return service ? <ServiceLink service={service} /> : null;
}

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

interface DocumentItem {
  id: string;
  companyId: string;
  fileName: string;
  storageKey: string;
  label: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy?: { id: string; name: string; email: string };
}

interface DocumentSlotCardProps {
  companyId: string;
  docType: 'pan' | 'gst' | 'msme' | 'dpiit' | 'dsc' | 'master_data' | 'mca_report';
  title: string;
  note?: string;
  documents: DocumentItem[];
  onReload: () => void;
}

function DocumentSlotCard({ companyId, docType, title, note, documents, onReload }: DocumentSlotCardProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingDoc = documents.find((d) => (d.label || '').toLowerCase() === docType.toLowerCase());

  async function handleSave() {
    if (!selectedFile) return;
    setSaving(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('companyId', companyId);
      form.append('label', docType);
      await upload('/documents', form);

      if (existingDoc) {
        try {
          await del(`/documents/${existingDoc.id}`);
        } catch (_e) {
          // ignore non-fatal cleanup error
        }
      }

      setSelectedFile(null);
      onReload();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save document');
    } finally {
      setSaving(false);
    }
  }

  const [deleting, setDeleting] = useState(false);

  async function handleDelete(doc: DocumentItem) {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    setDeleting(true);
    setErr(null);
    try {
      await del(`/documents/${doc.id}`);
      onReload();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : 'Failed to delete document');
    } finally {
      setDeleting(false);
    }
  }

  async function handleView(doc: DocumentItem) {
    try {
      await view(doc.id);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : 'Could not view document');
    }
  }

  return (
    <Card title={title} note={note || `Persistent document management`}>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && <ErrorNote error={err} />}

        {selectedFile ? (
          <div style={{ padding: 12, borderRadius: 6, border: '1px dashed var(--accent)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong style={{ fontSize: '0.95rem' }}>📄 {selectedFile.name}</strong>
                <div className="tiny muted">{(selectedFile.size / 1024).toFixed(1)} KB · Ready to save</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn-sm btn-primary" disabled={saving} onClick={() => void handleSave()}>
                  {saving ? <><Spinner /> Saving…</> : 'Save Document'}
                </button>
                <button type="button" className="btn-sm btn-ghost" disabled={saving} onClick={() => setSelectedFile(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : existingDoc ? (
          <div style={{ padding: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--foreground)' }}>
                  📄 {existingDoc.fileName}
                </div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  Uploaded: {fmtDate(existingDoc.createdAt)} · {(existingDoc.sizeBytes / 1024).toFixed(1)} KB
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn-sm" disabled={deleting} onClick={() => void handleView(existingDoc)}>
                  View
                </button>
                <button type="button" className="btn-sm" disabled={deleting} onClick={() => void forceDownload(existingDoc.id, existingDoc.fileName)}>
                  Download
                </button>
                <button type="button" className="btn-sm btn-outline" disabled={deleting} onClick={() => fileInputRef.current?.click()}>
                  Replace
                </button>
                <button type="button" className="btn-sm btn-ghost btn-danger" disabled={deleting} onClick={() => void handleDelete(existingDoc)}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 6, border: '1px solid var(--border)' }}>
            <span className="tiny dim">No document uploaded yet for {title}.</span>
            <button type="button" className="btn-sm" onClick={() => fileInputRef.current?.click()}>
              Choose File
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setSelectedFile(file);
          }}
        />
      </div>
    </Card>
  );
}

function CompanyDocumentSlotsManager({ companyId, filterType }: { companyId: string; filterType?: 'pan' | 'gst' | 'msme' | 'dpiit' | 'dsc' | 'master_data' | 'mca_report' }) {
  const { data, initial, reload } = useResource<{ rows: DocumentItem[] }>(`/documents?companyId=${companyId}`, [companyId]);
  const docs = data?.rows || [];

  if (initial) return <Loading label="Loading document manager..." />;

  const slots = [
    { docType: 'pan' as const, title: 'PAN Certificate / Document' },
    { docType: 'gst' as const, title: 'GST Certificate' },
    { docType: 'msme' as const, title: 'MSME Certificate' },
    { docType: 'dpiit' as const, title: 'Startup Certificate' },
    { docType: 'dsc' as const, title: 'DSC Certificate' },
    { docType: 'master_data' as const, title: 'Master Data' },
    { docType: 'mca_report' as const, title: 'MCA Report' },
  ];

  const filteredSlots = filterType
    ? slots.filter((s) => s.docType === filterType)
    : slots;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {filteredSlots.map((s) => (
        <DocumentSlotCard
          key={s.docType}
          companyId={companyId}
          docType={s.docType}
          title={s.title}
          documents={docs}
          onReload={reload}
        />
      ))}
    </div>
  );
}

export function CompanyEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { reload: reloadCompanies } = useCompanies();
  const { data: company, initial, error, apiError, reload } = useResource<Company>(id ? `/companies/${id}` : null);

  const [form, setForm] = useState<ProfileForm | null>(null);
  const [tab, setTab] = useState<TabId>('all');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sync, setSync] = useState<SyncResult | null>(null);

  const [verifyingCin, setVerifyingCin] = useState(false);
  const [verifiedBadge, setVerifiedBadge] = useState<{
    legalName?: string;
    status?: string;
    incorporationDate?: string;
    roc?: string;
    stateCode?: string;
    verifiedBy?: string | null;
  } | null>(null);
  const [cinError, setCinError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [mismatches, setMismatches] = useState<string[]>([]);

  // Load the server's copy into the form once, then leave the user's edits alone.
  useEffect(() => {
    if (company && !form) setForm(toForm(company));
  }, [company, form]);

  if (error || apiError) {
    const status = apiError?.status;
    if (status === 404) {
      return (
        <Card title="Company Not Found" note={`Company ID: ${id ?? 'unknown'}`}>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="alert alert-error">
              The company record you requested could not be found or does not exist in the system.
            </div>
            <button type="button" className="btn-sm" style={{ width: 'fit-content' }} onClick={() => navigate('/companies')}>
              ← Back to Companies List
            </button>
          </div>
        </Card>
      );
    }
    if (status === 403) {
      return (
        <Card title="Access Denied" note={`Company ID: ${id ?? 'unknown'}`}>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="alert alert-error">
              You do not have permission or authorization to view or edit this company's details.
            </div>
            <button type="button" className="btn-sm" style={{ width: 'fit-content' }} onClick={() => navigate('/companies')}>
              ← Back to Companies List
            </button>
          </div>
        </Card>
      );
    }
    if (status === 401) {
      return (
        <Card title="Session Expired">
          <div className="card-body">
            <div className="alert alert-error">
              Your login session has expired. Please refresh the page or sign in again.
            </div>
          </div>
        </Card>
      );
    }
    return <ErrorNote error={error || apiError?.message || 'Failed to load company details'} />;
  }

  if (initial || !company || !form) return <Loading label="Loading company details..." />;

  async function verifyCin(cinToTest: string, currentForm: ProfileForm) {
    const rawCin = cinToTest.trim().toUpperCase();
    if (rawCin.length !== 21) {
      if (rawCin.length > 0 && !/^[A-Z]{3}[0-9]{4}$/i.test(rawCin)) {
        setCinError('Invalid CIN length or format. CIN must be 21 alphanumeric characters (e.g. U72900TN2020PTC138472) or 7-character LLPIN.');
      } else {
        setCinError(null);
      }
      setVerifiedBadge(null);
      setMismatches([]);
      return;
    }

    setVerifyingCin(true);
    setCinError(null);
    setServiceUnavailable(false);
    setMismatches([]);

    try {
      const res = await post<{
        valid: boolean;
        errors: Array<{ field: string; message: string }>;
        masterRecord: any;
        verifiedBy: string | null;
        serviceUnavailable?: boolean;
      }>('/lookup/validate-company', {
        cin: rawCin,
        companyName: currentForm.legalName || undefined,
        entityType: currentForm.entityType || undefined,
        incorporationDate: currentForm.incorporationDate || undefined,
        stateCode: currentForm.stateCode || undefined,
        currentCompanyId: id,
      });

      if (res.serviceUnavailable) {
        setServiceUnavailable(true);
        setCinError('MCA verification service is temporarily unavailable. Please try again.');
        return;
      }

      if (res.masterRecord) {
        const m = res.masterRecord;
        setVerifiedBadge({
          legalName: m.legalName,
          status: m.status,
          incorporationDate: m.incorporationDate,
          roc: m.roc,
          stateCode: m.stateCode,
          verifiedBy: res.verifiedBy || 'BizVerify',
        });

        // Mismatch detection against current company data
        const diffs: string[] = [];
        if (m.legalName && company && m.legalName.toUpperCase() !== company.legalName.toUpperCase()) {
          diffs.push(`Legal Name: Current "${company.legalName}" vs MCA "${m.legalName}"`);
        }
        if (m.stateCode && company && m.stateCode !== company.stateCode) {
          diffs.push(`State: Current "${company.stateCode}" vs MCA "${m.stateCode}"`);
        }
        if (m.entityType && company && m.entityType !== company.entityType) {
          diffs.push(`Entity Type: Current "${company.entityType}" vs MCA "${m.entityType}"`);
        }
        if (m.incorporationDate && company && company.incorporationDate && m.incorporationDate !== company.incorporationDate.slice(0, 10)) {
          diffs.push(`Incorporation Date: Current "${company.incorporationDate.slice(0, 10)}" vs MCA "${m.incorporationDate}"`);
        }
        setMismatches(diffs);

        // Update form fields with verified MCA values
        setForm((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            legalName: m.legalName || prev.legalName,
            entityType: (m.entityType as EntityType) || prev.entityType,
            stateCode: m.stateCode && STATES.includes(m.stateCode) ? m.stateCode : prev.stateCode,
            incorporationDate: m.incorporationDate || prev.incorporationDate,
            companyStatus: m.status || prev.companyStatus,
            registeredAddress: m.registeredAddress || prev.registeredAddress,
            companyCategory: m.companyCategory || prev.companyCategory,
            companySubCategory: m.companySubCategory || prev.companySubCategory,
            companyClass: m.companyClass || prev.companyClass,
            authorisedCapital: typeof m.authorisedCapital === 'number' ? m.authorisedCapital : prev.authorisedCapital,
          };
        });

        // Clear stale errors
        setErrors((prev) => {
          const next = { ...prev };
          delete next.cin;
          delete next.stateCode;
          delete next.legalName;
          delete next.entityType;
          delete next.incorporationDate;
          return next;
        });
      }

      if (!res.valid && res.errors.length > 0) {
        setCinError(res.errors[0]?.message || 'CIN verification failed.');
        const errMap: Record<string, string> = {};
        for (const issue of res.errors) errMap[issue.field] = issue.message;
        setErrors((prev) => ({ ...prev, ...errMap }));
      }
    } catch {
      setCinError('Unable to verify CIN right now. Please try again.');
    } finally {
      setVerifyingCin(false);
    }
  }

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setForm((f) => {
      if (!f) return f;
      const updated = { ...f, [k]: v };
      if (k === 'cin') {
        const valStr = String(v).toUpperCase().trim();
        setVerifiedBadge(null);
        setMismatches([]);
        setCinError(null);
        if (valStr.length === 21) {
          void verifyCin(valStr, updated);
        }
      }
      return updated;
    });
  };

  const isCompaniesAct = ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8'].includes(form.entityType);
  const isIndividual = form.entityType === 'UNREGISTERED';

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
        authorisedCapital: Math.round(Number(form!.authorisedCapital)),
      };
      // An empty optional must be sent as null to clear it, not as "".
      for (const k of ['brandName', 'businessType', 'cin', 'llpin', 'pan', 'tan', 'incorporationDate', 'agmDate', 'industry',
                       'dpiitRecognitionNumber', 'dpiitRecognisedOn', 'epfoCode', 'esicCode',
                       'shopAndEstablishment', 'fssaiNumber', 'professionalTax', 'tradeLicense',
                       'registeredAddress', 'companyStatus', 'companyCategory', 'companySubCategory', 'companyClass'] as const) {
        body[k] = form![k] ? form![k] : null;
      }
      const result = await patch<{ company: Company; sync: SyncResult }>(`/companies/${id}`, body);
      setSync(result.sync);
    });
  }

  const showTab = (t: TabId) => tab === 'all' || tab === t;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {saveError && <ErrorNote error={saveError} />}
      {sync && (
        <div className="alert alert-info">
          <strong>Saved, and the engine re-ran.</strong> {sync.applicableRules} rules apply, {sync.inapplicableRules} do
          not · {sync.created} new obligations, {sync.updated} updated, {sync.removed} withdrawn.
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="row row-wrap" style={{ gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form id="company-profile" onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {showTab('basic') && (
          <>
            <Card title="Brand Logo" note="Optional — displayed on the company profile">
              <div className="card-body row" style={{ gap: 24, alignItems: 'center' }}>
                <div style={{
                  width: 80, height: 80, borderRadius: 8, border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface-2)'
                }}>
                  {company.logoStorageKey ? (
                    <img src={resolveApiUrl(`/companies/${company.id}/logo`)} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="tiny dim">No logo</span>
                  )}
                </div>
                <div className="stack" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input type="file" accept="image/*" disabled={busy} onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const form = new FormData();
                        form.append('file', file);
                        await upload(`/companies/${company.id}/logo`, form);
                        reload();
                        reloadCompanies();
                      } catch (err) {
                        setSaveError(err instanceof ApiError ? err.message : 'Could not upload logo');
                      }
                    }} />
                    {company.logoStorageKey && (
                      <button type="button" className="btn btn-outline" disabled={busy} onClick={async () => {
                        try {
                          await del(`/companies/${company.id}/logo`);
                          reload();
                          reloadCompanies();
                        } catch (err) {
                          setSaveError(err instanceof ApiError ? err.message : 'Could not remove logo');
                        }
                      }}>Remove logo</button>
                    )}
                  </div>
                  <span className="tiny dim">JPEG, PNG, GIF or WebP up to 5MB.</span>
                </div>
              </div>
            </Card>

            <Card title="Basic Company Identity">
              <div className="card-body grid grid-3">
                <Field label={isIndividual ? 'Business / shop name' : 'Legal name'} error={errors.legalName}>
                  <input required value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
                </Field>
                <Field label={isIndividual ? 'Shop / trade name (optional)' : 'Brand name'} hint="Optional">
                  <input value={form.brandName} onChange={(e) => set('brandName', e.target.value)} />
                </Field>
                <Field
                  label="Entity type"
                  hint={isIndividual
                    ? 'For shops, freelancers, consultants. GST, MSME, PF/ESI and income-tax rules apply based on turnover and employees.'
                    : 'Changing this changes which rules apply'}
                >
                  <select value={form.entityType} onChange={(e) => set('entityType', e.target.value as EntityType)}>
                    {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>

                {isIndividual && (
                  <Field label="What best describes you?" hint="Used only to label your profile — no rules change">
                    <select value={form.businessType ?? ''}
                            onChange={(e) => set('businessType', e.target.value ? e.target.value as BusinessType : null)}>
                      <option value="">— Select —</option>
                      {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{BUSINESS_TYPE_LABEL[bt]}</option>)}
                    </select>
                  </Field>
                )}

                {isCompaniesAct ? (
                  <Field
                    label="CIN"
                    hint={verifyingCin ? 'Verifying CIN via BizVerify…' : <FieldService field="cin" />}
                    error={errors.cin || cinError || undefined}
                  >
                    <input
                      value={form.cin}
                      onChange={(e) => set('cin', e.target.value.toUpperCase())}
                      onBlur={(e) => void verifyCin(e.target.value, form)}
                    />
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
                    {serviceUnavailable && !verifyingCin && (
                      <div className="alert alert-warn" style={{ marginTop: 6, padding: '8px 10px', fontSize: 12, borderRadius: 6 }}>
                        <strong>MCA verification service is temporarily unavailable. Please try again.</strong>
                      </div>
                    )}
                    {mismatches.length > 0 && !verifyingCin && (
                      <div className="alert alert-warn" style={{ marginTop: 6, padding: '8px 10px', fontSize: 12, borderRadius: 6 }}>
                        <strong>MCA data differs from saved company record:</strong>
                        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                          {mismatches.map((m, idx) => (
                            <li key={idx}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    )}
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
                  <input value={form.industry || ''} onChange={(e) => set('industry', e.target.value)} />
                </Field>
                <Field
                  label={isIndividual ? 'Started on' : 'Incorporation date'}
                  hint={isIndividual
                    ? 'When the business began — the calendar is built from it'
                    : <><span>{inc20aNote(form.entityType, Number(form.paidUpCapital), form.incorporationDate)}</span>{' '}<FieldService field="incorporationDate" /></>}
                  error={errors.incorporationDate}
                >
                  <input required type="date" value={form.incorporationDate}
                         onChange={(e) => set('incorporationDate', e.target.value)} />
                </Field>
                {isCompaniesAct && (
                  <>
                    <Field label="Registered Address">
                      <input value={form.registeredAddress || ''} onChange={(e) => set('registeredAddress', e.target.value)} />
                    </Field>
                    <Field label="Company Status">
                      <input value={form.companyStatus || ''} onChange={(e) => set('companyStatus', e.target.value)} />
                    </Field>
                    <Field label="Category">
                      <input value={form.companyCategory || ''} onChange={(e) => set('companyCategory', e.target.value)} />
                    </Field>
                    <Field label="Sub Category">
                      <input value={form.companySubCategory || ''} onChange={(e) => set('companySubCategory', e.target.value)} />
                    </Field>
                    <Field label="Class">
                      <input value={form.companyClass || ''} onChange={(e) => set('companyClass', e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
            </Card>

            <Card title="Profile & Thresholds" note="Thresholds the engine tests against">
              <div className="card-body grid grid-3">
                <Field label="Annual turnover (₹)" hint={fmtINR(form.annualTurnover)}>
                  <input type="number" min={0} value={form.annualTurnover} onChange={(e) => set('annualTurnover', Number(e.target.value))} />
                </Field>
                <Field label="Paid-up capital (₹)" hint={fmtINR(form.paidUpCapital)}>
                  <input type="number" min={0} value={form.paidUpCapital} onChange={(e) => set('paidUpCapital', Number(e.target.value))} />
                </Field>
                <Field label="Authorised capital (₹)" hint={fmtINR(form.authorisedCapital)}>
                  <input type="number" min={0} value={form.authorisedCapital} onChange={(e) => set('authorisedCapital', Number(e.target.value))} />
                </Field>
                <Field label="Employees" hint="10 → ESI and POSH · 20 → provident fund">
                  <input type="number" min={0} value={form.employeeCount} onChange={(e) => set('employeeCount', Number(e.target.value))} />
                </Field>
                <Field label="AGM date" hint="Moves AOC-4 (+30d), MGT-7 (+60d), ADT-1 (+15d)">
                  <input type="date" value={form.agmDate} onChange={(e) => set('agmDate', e.target.value)} />
                </Field>
                <div className="field" style={{ gridColumn: 'span 2', gap: 9 }}>
                  <label>Compliance Flags</label>
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
          </>
        )}

        {showTab('dpiit') && (
          <Card title="DPIIT / Startup India Details">
            <div className="card-body grid grid-2">
              <Field label="DPIIT recognition number" hint={<><span>Startup India recognition number, e.g. DIPP12345</span>{' '}<FieldService field="dpiit" /></>}>
                <input value={form.dpiitRecognitionNumber} onChange={(e) => set('dpiitRecognitionNumber', e.target.value)} />
              </Field>
              <Field label="Recognised on" hint="Optional">
                <input type="date" value={form.dpiitRecognisedOn} onChange={(e) => set('dpiitRecognisedOn', e.target.value)} />
              </Field>
            </div>
          </Card>
        )}

        {showTab('pf') && (
          <Card title="Provident Fund (PF / EPFO) Details">
            <div className="card-body grid grid-2">
              <Field label="PF · EPFO establishment code" hint="As issued — formats differ by office">
                <input value={form.epfoCode} onChange={(e) => set('epfoCode', e.target.value)} />
              </Field>
            </div>
          </Card>
        )}

        {showTab('esi') && (
          <Card title="Employee State Insurance (ESI / ESIC) Details">
            <div className="card-body grid grid-2">
              <Field label="ESI · ESIC employer code" hint="17 digits on most certificates">
                <input value={form.esicCode} onChange={(e) => set('esicCode', e.target.value)} />
              </Field>
            </div>
          </Card>
        )}

        {showTab('incometax') && (
          <Card title="Income Tax & Registration Details">
            <div className="card-body grid grid-2">
              <Field label="PAN"><input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
              <Field label="TAN"><input value={form.tan} onChange={(e) => set('tan', e.target.value.toUpperCase())} /></Field>
              <Field label="Shop & Establishment"><input value={form.shopAndEstablishment} onChange={(e) => set('shopAndEstablishment', e.target.value)} /></Field>
              <Field label="FSSAI License"><input value={form.fssaiNumber} onChange={(e) => set('fssaiNumber', e.target.value)} /></Field>
              <Field label="Professional Tax (PT)"><input value={form.professionalTax} onChange={(e) => set('professionalTax', e.target.value)} /></Field>
              <Field label="Trade License"><input value={form.tradeLicense} onChange={(e) => set('tradeLicense', e.target.value)} /></Field>
            </div>
          </Card>
        )}
      </form>

      {showTab('incometax') && (
        <CompanyDocumentSlotsManager companyId={company.id} filterType="pan" />
      )}

      {/* Specific Certificate Managers per tab */}
      {showTab('gst') && (
        <>
          <Registrations company={company} busy={busy} errors={errors} run={run} showOnly="gst" />
          <CompanyDocumentSlotsManager companyId={company.id} filterType="gst" />
        </>
      )}

      {showTab('msme') && (
        <>
          <Registrations company={company} busy={busy} errors={errors} run={run} showOnly="msme" />
          <CompanyDocumentSlotsManager companyId={company.id} filterType="msme" />
        </>
      )}

      {showTab('dpiit') && (
        <CompanyDocumentSlotsManager companyId={company.id} filterType="dpiit" />
      )}

      {showTab('dsc') && (
        <CompanyDocumentSlotsManager companyId={company.id} filterType="dsc" />
      )}

      {(showTab('documents') || showTab('all')) && (
        <Card title="Company Documents Management">
          <div className="card-body">
            <CompanyDocumentSlotsManager companyId={company.id} />
          </div>
        </Card>
      )}

      {showTab('directors') && (
        <Registrations company={company} busy={busy} errors={errors} run={run} showOnly="directors" />
      )}

      {(showTab('import') || showTab('all')) && (
        <McaImport company={company} busy={busy} run={run} />
      )}

      {showTab('import') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          <CompanyDocumentSlotsManager companyId={company.id} filterType="master_data" />
          <CompanyDocumentSlotsManager companyId={company.id} filterType="mca_report" />
        </div>
      )}

      {/* Save Button */}
      <div className="row" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
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
  warnings?: string[];
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  rowsInFile: number;
  sync: { created: number; removed: number; blockedBy?: string };
}

function McaImport({ company, busy, run }: {
  company: Company; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<McaResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title="Import from MCA master data" note="CSV or PDF downloaded from MCA or data.gov.in">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="tiny muted">
          Fills the CIN, legal name, date of incorporation, state, entity type, industry, address, status, capital, and directors from
          an MCA company master-data and signatory details extract. Nothing is fetched from MCA — this reads the file you give it.
        </span>

        {error && <ErrorNote error={error} />}

        {result && (
          <div className="alert alert-info">
            {result.matchedBy === 'none' ? (
              <strong>File processed — no readable data extracted.</strong>
            ) : (
              <strong>
                Matched {result.matchedBy === 'cin' ? 'on the CIN' : 'the selected company'} out of{' '}
                {result.rowsInFile} row{result.rowsInFile === 1 ? '' : 's'}.
              </strong>
            )}

            {result.warnings && result.warnings.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {result.warnings.map((w, idx) => (
                  <div key={idx} style={{ color: 'var(--amber-11, #b45309)', fontWeight: 500 }}>ℹ️ {w}</div>
                ))}
              </div>
            )}

            {result.applied.length === 0 ? (
              <div style={{ marginTop: 6 }}>
                {result.matchedBy === 'none'
                  ? 'No fields were modified because no recognizable company data could be extracted.'
                  : 'Everything in the file already matched what was on record.'}
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                {result.applied.map((a) => (
                  <div key={a.field}>
                    · <strong>{a.field}</strong>: {a.from ?? 'empty'} → {a.to}
                  </div>
                ))}
              </div>
            )}

            {result.matchedBy !== 'none' && (
              <div style={{ marginTop: 6 }} className="tiny">
                The engine re-ran: {result.sync.created} new obligations, {result.sync.removed} withdrawn.
              </div>
            )}
          </div>
        )}

        <input ref={fileInput} type="file" accept=".csv,text/csv,application/pdf" hidden
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
          {busy ? 'Reading…' : 'Choose an MCA master-data CSV or PDF'}
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
            {director.dscExpiresOn ? ` · DSC exp ${fmtDate(director.dscExpiresOn)}` : ''}
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
        <Field label="DIN / DPIN" hint={<><span>8 digits</span> · <FieldService field="din" /></>}><input value={draft.din} onChange={(e) => setDraft({ ...draft, din: e.target.value })} /></Field>
        <Field label="Designation"><input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
        <Field label="Appointed on"><input type="date" value={draft.appointedOn} onChange={(e) => setDraft({ ...draft, appointedOn: e.target.value })} /></Field>
        <Field label="DSC expires on" hint={<><span>Blank if no digital signature is recorded</span> · <FieldService field="dsc" /></>}>
          <input type="date" value={draft.dscExpiresOn} onChange={(e) => setDraft({ ...draft, dscExpiresOn: e.target.value })} />
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

function Registrations({
  company, busy, errors, run, showOnly,
}: {
  company: Company; busy: boolean; errors: Record<string, string>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  showOnly?: 'gst' | 'msme' | 'directors';
}) {
  const officers = officersFor(company.entityType);
  const [director, setDirector] = useState(blankDirector());
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
      {(!showOnly || showOnly === 'directors') && (
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
                <Field label="DIN / DPIN" hint={<><span>8 digits — adds DIR-3 KYC</span> · <FieldService field="din" /></>}>
                  <input value={director.din} placeholder="08123456" onChange={(e) => setDirector({ ...director, din: e.target.value })} />
                </Field>
                <Field label="Designation">
                  <input value={director.designation} onChange={(e) => setDirector({ ...director, designation: e.target.value })} />
                </Field>
                <Field label="Email" hint="Optional">
                  <input type="email" value={director.email} placeholder="name@company.com" onChange={(e) => setDirector({ ...director, email: e.target.value })} />
                </Field>
                <Field label="Appointed on">
                  <input type="date" value={director.appointedOn} onChange={(e) => setDirector({ ...director, appointedOn: e.target.value })} />
                </Field>
                <Field label="DSC expires on">
                  <input type="date" value={director.dscExpiresOn} onChange={(e) => setDirector({ ...director, dscExpiresOn: e.target.value })} />
                </Field>
                <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
                  <label className="check" style={{ flex: 1 }}>
                    <input type="checkbox" checked={director.isResident} onChange={(e) => setDirector({ ...director, isResident: e.target.checked })} />
                    Resident in India
                  </label>
                  <button type="button" disabled={busy} onClick={() => {
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
      )}

      {(!showOnly || showOnly === 'gst') && (
        <Card title="GST Registrations" note="One set of returns is generated per GSTIN">
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
              <Field label="GSTIN" error={local.gstin ?? errors[`gstin:${gst.gstin.trim().toUpperCase()}`]}>
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
              <button type="button" disabled={busy} onClick={() => {
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
      )}

      {(!showOnly || showOnly === 'msme') && (
        <Card title="Udyam (MSME) Registration">
          <div className="card-body grid grid-3" style={{ alignItems: 'end' }}>
            <Field label="Udyam number" error={local.udyam ?? errors['udyamNumber']}>
              <input value={msme.udyamNumber}
                     onChange={(e) => { setMsme({ ...msme, udyamNumber: e.target.value.toUpperCase() }); setLocalError('udyam', null); }} />
            </Field>
            <Field label="Category">
              <select value={msme.category} onChange={(e) => setMsme({ ...msme, category: e.target.value })}>
                <option value="MICRO">Micro</option><option value="SMALL">Small</option><option value="MEDIUM">Medium</option>
              </select>
            </Field>
            <div className="row">
              <button type="button" disabled={busy} onClick={() => {
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
      )}
    </>
  );
}
