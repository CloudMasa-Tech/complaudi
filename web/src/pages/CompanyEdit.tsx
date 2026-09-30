import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, forceDownload, patch, post, put, upload, view, resolveApiUrl } from '../api/client';
import { useResource } from '../api/useResource';
import { useCompanies } from '../auth/CompanyContext';
import type { BusinessType, Company, Director, EntityType, GstMasterRecord, GstSessionResult, GstVerificationResult, PanMasterRecord, PanVerificationResult, SyncResult, UdyamMasterRecord, UdyamSessionResult, UdyamVerificationResult } from '../api/types';
import { BUSINESS_TYPE_LABEL, Card, ErrorNote, Field, Loading, ServiceLink, Spinner, fmtDate, fmtINR, inc20aNote, officersFor } from '../components/ui';
import { REGISTRATION_FIELD_LINKS } from '../lib/registrationLinks';
import { GSTIN_REGEX, PAN_REGEX } from '../lib/india';
import { compareLegalNames, validateGstForCompany, type GstCompanyValidationSummary } from '../lib/gstValidation';
import { UDYAM_REGEX, validateUdyamForCompany, type UdyamCompanyValidationSummary } from '../lib/udyamValidation';

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
    <div className="doc-slot">
      <div className="doc-slot-head">
        <span className="doc-slot-title">{title}</span>
        {note && <span className="tiny dim">{note}</span>}
        {existingDoc && <span className="badge badge-COMPLETED">Filed</span>}
      </div>
      <div className="doc-slot-body">
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
                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>
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
            {/* The row heading names the document; repeating it here just made
                every empty row read as a paragraph. */}
            <span className="tiny dim">Not uploaded yet.</span>
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
    </div>
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

  /*
   * One card, one row per document — not a card each.
   *
   * Every slot used to be a full Card with its own heading and the same
   * "Persistent document management" subtitle, so a company page showed the
   * identical upload block three to seven times over. Nothing was duplicated
   * by then; it simply read as repetition, and made a short list of documents
   * take a screen and a half.
   */
  // The same match the rows use — a slot is filled when a document carries its
  // docType as a label. Counting it any other way would let the summary and the
  // rows disagree.
  const filed = filteredSlots.filter((s) =>
    docs.some((d) => (d.label || '').toLowerCase() === s.docType.toLowerCase()),
  ).length;

  return (
    <Card
      title={filterType ? filteredSlots[0]?.title ?? 'Document' : 'Documents'}
      note={filteredSlots.length > 1 ? `${filed} of ${filteredSlots.length} filed` : undefined}
    >
      <div className="card-body doc-slots">
        {filteredSlots.map((s) => (
          <DocumentSlotCard
            key={s.docType}
            companyId={companyId}
            docType={s.docType}
            // A single-slot card already names the document in its heading.
            title={s.title}
            documents={docs}
            onReload={reload}
          />
        ))}
      </div>
    </Card>
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
  const [verifyingPan, setVerifyingPan] = useState(false);
  const [panError, setPanError] = useState<string | null>(null);
  const [verifiedPanResult, setVerifiedPanResult] = useState<PanMasterRecord | null>(null);
  const [verifiedForPan, setVerifiedForPan] = useState<string | null>(null);

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

  const handleVerifyPan = async () => {
    if (!form || !company) return;
    const cleanPan = (form.pan || '').trim().toUpperCase();

    if (!cleanPan) {
      setErrors((prev) => ({ ...prev, pan: 'Enter a valid PAN.' }));
      return;
    }

    if (!PAN_REGEX.test(cleanPan)) {
      setErrors((prev) => ({ ...prev, pan: 'Enter a valid PAN.' }));
      return;
    }

    setErrors((prev) => {
      const next = { ...prev };
      delete next.pan;
      return next;
    });
    setPanError(null);
    setVerifyingPan(true);

    try {
      const res = await post<PanVerificationResult>('/pan/verify', {
        companyId: company.id,
        pan: cleanPan,
      });

      if (res && res.success && res.data) {
        setVerifiedPanResult(res.data);
        setVerifiedForPan(cleanPan);
      } else {
        setPanError(res?.error?.message || 'PAN verification failed. Please try again.');
      }
    } catch (err: any) {
      setPanError(err?.message || 'Error connecting to PAN verification service.');
    } finally {
      setVerifyingPan(false);
    }
  };

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
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      value={form.pan}
                      onChange={(e) => {
                        const nextPan = e.target.value.toUpperCase();
                        set('pan', nextPan);
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.pan;
                          return next;
                        });
                        if (verifiedPanResult && nextPan.trim() !== verifiedForPan) {
                          setVerifiedPanResult(null);
                          setVerifiedForPan(null);
                        }
                      }}
                      placeholder="e.g. AAACT1234A"
                    />
                    <button
                      type="button"
                      className="btn-sm"
                      style={{ whiteSpace: 'nowrap' }}
                      disabled={verifyingPan || !form.pan.trim()}
                      onClick={handleVerifyPan}
                    >
                      {verifyingPan
                        ? 'Verifying...'
                        : verifiedPanResult && form.pan.trim() === verifiedForPan
                        ? '✓ Verified'
                        : panError
                        ? 'Try Again'
                        : 'Verify PAN'}
                    </button>
                  </div>

                  {panError && (
                    <div style={{ color: 'var(--color-danger, #e53935)', fontSize: '12px', marginTop: '4px' }}>
                      {panError}
                    </div>
                  )}

                  {verifiedPanResult && form.pan.trim() === verifiedForPan && (
                    <div style={{ marginTop: '8px', padding: '10px 12px', background: 'var(--bg-subtle, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: '6px', fontSize: '12px' }}>
                      {verifiedPanResult.verificationLevel === 'GST_CROSS_REFERENCE' ? (
                        <>
                          <div style={{ fontWeight: 600, color: 'var(--color-success, #2e7d32)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                            ✓ PAN Verified &nbsp;•&nbsp; ✓ GST Cross-Reference Found
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px', marginBottom: '8px' }}>
                            <div><span className="dim">PAN Status:</span> <strong style={{ color: 'var(--color-success, #2e7d32)' }}>{verifiedPanResult.panStatus ? verifiedPanResult.panStatus.charAt(0).toUpperCase() + verifiedPanResult.panStatus.slice(1).toLowerCase() : 'Active'}</strong></div>
                            <div><span className="dim">Company Type:</span> <strong>{ENTITY_TYPES.find((t) => t.value === form.entityType)?.label || form.entityType}</strong></div>
                            <div><span className="dim">PAN Structure:</span> <strong>Valid</strong></div>
                            <div><span className="dim">Verification Level:</span> <strong>GST Cross-Reference</strong></div>
                            <div><span className="dim">Linked GSTIN:</span> <strong>{verifiedPanResult.linkedGstins[0] || '—'}</strong></div>
                            <div><span className="dim">GST Status:</span> <strong>{verifiedPanResult.gst?.status || 'Active'}</strong></div>
                            <div><span className="dim">GST Legal Name:</span> <strong>{verifiedPanResult.gst?.legalName || '—'}</strong></div>
                            <div><span className="dim">GST Trade Name:</span> <strong>{verifiedPanResult.gst?.tradeName || '—'}</strong></div>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #64748b)', paddingTop: '4px', borderTop: '1px dashed var(--border, #e2e8f0)' }}>
                            Verification Source: GST Portal &nbsp;|&nbsp; Verification Level: GST Cross-Reference
                          </div>
                          {verifiedPanResult.gst?.legalName && (
                            <div style={{ marginTop: '6px', fontSize: '11px' }}>
                              {compareLegalNames(form.legalName, verifiedPanResult.gst.legalName).match ? (
                                <span style={{ color: 'var(--color-success, #2e7d32)' }}>✓ Legal name matches company name</span>
                              ) : (
                                <span style={{ color: 'var(--color-warn, #ed6c02)' }}>
                                  ⚠ Legal name mismatch (Company: "{form.legalName}" vs GST: "{verifiedPanResult.gst.legalName}")
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, color: 'var(--color-success, #2e7d32)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                            ✓ PAN Verified
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px', marginBottom: '8px' }}>
                            <div><span className="dim">PAN Status:</span> <strong style={{ color: 'var(--color-success, #2e7d32)' }}>{verifiedPanResult.panStatus ? verifiedPanResult.panStatus.charAt(0).toUpperCase() + verifiedPanResult.panStatus.slice(1).toLowerCase() : 'Active'}</strong></div>
                            <div><span className="dim">Company Type:</span> <strong>{ENTITY_TYPES.find((t) => t.value === form.entityType)?.label || form.entityType}</strong></div>
                            <div><span className="dim">PAN Structure:</span> <strong>Valid</strong></div>
                            <div><span className="dim">Verification Level:</span> <strong>Local PAN Validation</strong></div>
                          </div>
                          <div style={{ color: 'var(--text-muted, #475569)', fontSize: '11px', lineHeight: '1.4', paddingTop: '4px', borderTop: '1px dashed var(--border, #e2e8f0)' }}>
                            <div>PAN format and entity structure are valid.</div>
                            {verifiedPanResult.linkedGstins.length === 0 && (
                              <div style={{ marginTop: '2px' }}>No linked GST registration was found through the available GST cross-reference.</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
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

      {tab === 'incometax' && (
        <CompanyDocumentSlotsManager companyId={company.id} filterType="pan" />
      )}

      {/* Specific Certificate Managers per tab */}
      {showTab('gst') && (
        <>
          <Registrations company={company} busy={busy} errors={errors} run={run} showOnly="gst" />
          {tab === 'gst' && <CompanyDocumentSlotsManager companyId={company.id} filterType="gst" />}
        </>
      )}

      {showTab('msme') && (
        <>
          <Registrations company={company} busy={busy} errors={errors} run={run} showOnly="msme" />
          {tab === 'msme' && <CompanyDocumentSlotsManager companyId={company.id} filterType="msme" />}
        </>
      )}

      {tab === 'dpiit' && (
        <CompanyDocumentSlotsManager companyId={company.id} filterType="dpiit" />
      )}

      {tab === 'dsc' && (
        <CompanyDocumentSlotsManager companyId={company.id} filterType="dsc" />
      )}

      {/*
        * Only on its own tab, never in the combined view.
        *
        * showTab('documents') is already true when tab === 'all', so this card
        * used to render all seven slots alongside the per-tab cards that had
        * just rendered five of them — every certificate appeared twice, and
        * Master Data and the MCA report three times, since the import section
        * below adds those two as well. The per-tab cards sit beside the
        * registration they evidence, which is the more useful placement, so
        * they are the ones kept.
        */}
      {/*
        * In the combined view every document lives in this one card.
        *
        * The per-tab cards above are scoped to their own tab now. Left showing
        * in 'all' as well, they produced seven separate upload cards down the
        * page — PAN, GST, MSME, Startup, DSC, Master Data, MCA Report — each
        * with its own heading and the same empty state, which reads as the same
        * thing asked over and over. One card, one row each.
        */}
      {(tab === 'documents' || tab === 'all') && (
        <CompanyDocumentSlotsManager companyId={company.id} />
      )}

      {showTab('directors') && (
        <Registrations company={company} busy={busy} errors={errors} run={run} showOnly="directors" />
      )}

      {(showTab('import') || showTab('all')) && (
        <McaImport company={company} busy={busy} run={run} />
      )}

      {tab === 'import' && (
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

function GstValidationSummaryBox({
  summary,
}: {
  summary: GstCompanyValidationSummary;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, marginBottom: 16 }}>
      <div className="tiny" style={{ fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', color: '#64748b' }}>
        Company Data Validation Summary
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        <div>
          {summary.formatValid && summary.checksumValid
            ? '✓ GSTIN format & checksum valid'
            : '⚠ GSTIN format or checksum mismatch'}
        </div>
        <div>
          {summary.isActiveStatus
            ? '✓ GST status: Active'
            : `⚠ ${summary.statusDetails}`}
        </div>
        <div>
          {summary.stateCheck.match
            ? `✓ ${summary.stateCheck.details}`
            : `⚠ ${summary.stateCheck.details}`}
        </div>
        <div>
          {summary.legalNameCheck.match
            ? `✓ ${summary.legalNameCheck.details}`
            : `⚠ ${summary.legalNameCheck.details}`}
        </div>
        <div>
          {summary.constitutionCheck.match
            ? `✓ ${summary.constitutionCheck.details}`
            : `⚠ ${summary.constitutionCheck.details}`}
        </div>
        {summary.registrationDateCheck && summary.registrationDateCheck.details && (
          <div>
            {summary.registrationDateCheck.valid
              ? `✓ ${summary.registrationDateCheck.details}`
              : `⚠ ${summary.registrationDateCheck.details}`}
          </div>
        )}
      </div>
    </div>
  );
}

function GstRegistrationSection({
  company,
  busy,
  errors,
  run,
  local,
  setLocalError,
}: {
  company: Company;
  busy: boolean;
  errors: Record<string, string>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  local: Record<string, string>;
  setLocalError: (key: string, message: string | null) => void;
}) {
  const [gstinInput, setGstinInput] = useState('');
  const [gstFilingFrequency, setGstFilingFrequency] = useState<'MONTHLY' | 'QRMP' | 'COMPOSITION'>('MONTHLY');
  const [gstSession, setGstSession] = useState<GstSessionResult | null>(null);
  const [captchaInput, setCaptchaInput] = useState('');
  const [verifiedGst, setVerifiedGst] = useState<GstMasterRecord | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [gstError, setGstError] = useState<string | null>(null);

  const cleanGstin = gstinInput.trim().toUpperCase();

  const handleStartSession = async () => {
    if (!cleanGstin) {
      setLocalError('gstin', 'Please enter a 15-character GSTIN.');
      return;
    }
    if (!GSTIN_REGEX.test(cleanGstin)) {
      setLocalError('gstin', 'A GSTIN must be 15 characters, e.g. 33AAACN4321B1ZA.');
      return;
    }

    setLocalError('gstin', null);
    setGstError(null);
    setVerifying(true);
    try {
      const res = await post<GstSessionResult>('/gst/session', {
        companyId: company.id,
        gstin: cleanGstin,
      });

      if (res && res.success && res.sessionId) {
        setGstSession(res);
        setCaptchaInput('');
      } else {
        setGstError(res?.error?.message || 'Failed to initiate GST verification session.');
      }
    } catch (err: any) {
      setGstError(err?.message || 'Error connecting to GST verification service.');
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyCaptcha = async () => {
    if (!captchaInput.trim()) {
      setGstError('CAPTCHA code is required.');
      return;
    }
    if (!gstSession || !gstSession.sessionId) {
      setGstError('Session expired. Please fetch a new CAPTCHA.');
      return;
    }

    setGstError(null);
    setVerifying(true);
    try {
      const res = await post<GstVerificationResult>('/gst/verify', {
        companyId: company.id,
        sessionId: gstSession.sessionId,
        gstin: cleanGstin,
        captcha: captchaInput.trim(),
      });

      if (res && res.success && res.gst) {
        setVerifiedGst(res.gst);
        setGstSession(null);
      } else {
        setGstError(res?.error?.message || 'Invalid CAPTCHA code entered. Please try again.');
      }
    } catch (err: any) {
      setGstError(err?.message || 'Failed to verify CAPTCHA with GST Portal.');
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveVerified = async () => {
    if (!verifiedGst) return;
    setGstError(null);
    await run(async () => {
      await post(`/companies/${company.id}/gst-registrations`, {
        gstin: verifiedGst.gstin,
        stateCode: verifiedGst.stateCode || verifiedGst.gstin.slice(0, 2),
        legalName: verifiedGst.legalName,
        tradeName: verifiedGst.tradeName,
        constitution: verifiedGst.constitution,
        registeredOn: verifiedGst.registrationDate,
        filingFrequency: gstFilingFrequency,
        isActive: verifiedGst.status.toUpperCase() === 'ACTIVE',
      });
      setVerifiedGst(null);
      setGstinInput('');
      setGstSession(null);
    });
  };

  const handleDirectAdd = async () => {
    if (cleanGstin.length !== 15) {
      setLocalError('gstin', 'A GSTIN is 15 characters, e.g. 33AAACN4321B1ZA.');
      return;
    }
    if (!GSTIN_REGEX.test(cleanGstin)) {
      setLocalError('gstin', 'A GSTIN must be 15 characters, e.g. 33AAACN4321B1ZA.');
      return;
    }

    setLocalError('gstin', null);
    await run(async () => {
      await post(`/companies/${company.id}/gst-registrations`, {
        gstin: cleanGstin,
        stateCode: cleanGstin.slice(0, 2),
        filingFrequency: gstFilingFrequency,
      });
      setGstinInput('');
    });
  };

  const activeSummary = verifiedGst ? validateGstForCompany(verifiedGst, company) : null;

  return (
    <Card title="GST Registrations" note="One set of returns is generated per GSTIN">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Stored Verified Registrations */}
        {company.gstRegistrations.map((g) => {
          const storedMaster: GstMasterRecord = {
            gstin: g.gstin,
            legalName: g.legalName || company.legalName || 'N/A',
            tradeName: g.tradeName || null,
            registrationDate: g.registeredOn || null,
            status: g.isActive ? 'Active' : 'Inactive',
            taxpayerType: null,
            constitution: g.constitution || null,
            state: null,
            stateCode: g.stateCode,
            panEmbedded: g.gstin.length === 15 ? g.gstin.slice(2, 12) : null,
            principalPlaceOfBusiness: null,
            natureOfBusiness: [],
            jurisdiction: null,
            einvoiceStatus: null,
          };
          const summary = validateGstForCompany(storedMaster, company);

          return (
            <div key={g.id} style={{ background: 'var(--bg-subtle, #f8fafc)', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong style={{ fontSize: 15 }} className="mono">{g.gstin}</strong>
                  <div className="tiny" style={{ color: '#16a34a', fontWeight: 500 }}>
                    ✓ Verified GST Registration &nbsp;•&nbsp; {g.stateCode}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-sm btn-ghost btn-danger"
                  disabled={busy}
                  onClick={() => run(() => del(`/companies/${company.id}/gst-registrations/${g.id}`))}
                >
                  Remove
                </button>
              </div>

              {/* Persisted Company Data Validation Summary */}
              <GstValidationSummaryBox summary={summary} />

              <div className="grid grid-2" style={{ gap: 10, fontSize: 13, marginBottom: 12 }}>
                <div><strong>GSTIN:</strong> <span className="mono">{g.gstin}</span></div>
                <div><strong>Legal Name:</strong> {g.legalName || 'N/A'}</div>
                <div><strong>Trade Name:</strong> {g.tradeName || 'N/A'}</div>
                <div><strong>Status:</strong> {g.isActive ? 'Active' : 'Inactive'}</div>
                <div><strong>Constitution:</strong> {g.constitution || 'N/A'}</div>
                <div><strong>State Code:</strong> {g.stateCode}</div>
                <div><strong>Registered On:</strong> {g.registeredOn || 'N/A'}</div>
                <div><strong>Filing Frequency:</strong> {g.filingFrequency}</div>
              </div>

              <div className="grid grid-2" style={{ alignItems: 'end', borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                <Field label="Filing Frequency">
                  <select
                    value={g.filingFrequency}
                    disabled={busy}
                    onChange={(e) => run(() => patch(`/companies/${company.id}/gst-registrations/${g.id}`, { filingFrequency: e.target.value }))}
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QRMP">QRMP (quarterly)</option>
                    <option value="COMPOSITION">Composition</option>
                  </select>
                </Field>
              </div>
            </div>
          );
        })}

        {company.gstRegistrations.length === 0 && <span className="tiny dim">None on record.</span>}

        {gstError && <ErrorNote error={gstError} />}

        {/* GST Verification / Add Form */}
        {!gstSession && !verifiedGst && (
          <div className="grid grid-3" style={{ alignItems: 'end', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <Field label="GSTIN" error={local.gstin ?? errors[`gstin:${cleanGstin}`]}>
              <input
                value={gstinInput}
                placeholder="33AAACN4321B1ZA"
                onChange={(e) => {
                  setGstinInput(e.target.value.toUpperCase());
                  setLocalError('gstin', null);
                  setGstError(null);
                }}
              />
            </Field>

            <Field label="Filing frequency">
              <select value={gstFilingFrequency} onChange={(e) => setGstFilingFrequency(e.target.value as any)}>
                <option value="MONTHLY">Monthly</option>
                <option value="QRMP">QRMP (quarterly)</option>
                <option value="COMPOSITION">Composition</option>
              </select>
            </Field>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || verifying}
                onClick={handleStartSession}
              >
                {verifying ? <Spinner /> : 'Verify & Fetch Details'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || verifying}
                onClick={handleDirectAdd}
                title="Add GSTIN without live verification"
              >
                Add Directly
              </button>
            </div>
          </div>
        )}

        {/* CAPTCHA Modal / Panel */}
        {gstSession && !verifiedGst && (
          <div style={{ background: 'var(--bg-subtle, #f9fafb)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 6 }}>
            <div className="stack" style={{ gap: 4, marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>GST Portal Verification - Human CAPTCHA Entry</strong>
              <span className="tiny dim">Enter the visible characters shown below to fetch official GST master data.</span>
            </div>

            <div className="row" style={{ alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
              {gstSession.captchaImage ? (
                <div style={{ background: '#fff', padding: 6, border: '1px solid #ccc', borderRadius: 4 }}>
                  <img src={gstSession.captchaImage} alt="GST CAPTCHA Challenge" style={{ height: 46, display: 'block' }} />
                </div>
              ) : (
                <span className="tiny error">CAPTCHA image unavailable</span>
              )}

              <button
                type="button"
                className="btn-sm btn-ghost"
                disabled={verifying}
                onClick={handleStartSession}
              >
                Refresh CAPTCHA
              </button>
            </div>

            <div className="grid grid-2" style={{ alignItems: 'end' }}>
              <Field label="Enter CAPTCHA Code">
                <input
                  value={captchaInput}
                  placeholder="Type visible characters"
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyCaptcha(); }}
                />
              </Field>

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={verifying || !captchaInput.trim()}
                  onClick={handleVerifyCaptcha}
                >
                  {verifying ? <Spinner /> : 'Verify CAPTCHA'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={verifying}
                  onClick={() => setGstSession(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Verified GST Master Data & Immediate Validation Summary Panel */}
        {verifiedGst && activeSummary && (
          <div style={{ background: 'var(--bg-subtle, #f8fafc)', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16, marginTop: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <strong style={{ fontSize: 15 }}>Verified GST Details</strong>
                <div className="tiny" style={{ color: '#16a34a', fontWeight: 500 }}>✓ Verified via BizVerify / GST Portal</div>
              </div>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setVerifiedGst(null)}>Clear</button>
            </div>

            {/* Immediate Validation Summary */}
            <GstValidationSummaryBox summary={activeSummary} />

            {/* Key-Value Details Grid */}
            <div className="grid grid-2" style={{ gap: 10, fontSize: 13, marginBottom: 16 }}>
              <div><strong>GSTIN:</strong> <span className="mono">{verifiedGst.gstin}</span></div>
              <div><strong>Legal Name:</strong> {verifiedGst.legalName}</div>
              <div><strong>Trade Name:</strong> {verifiedGst.tradeName || 'N/A'}</div>
              <div><strong>Status:</strong> {verifiedGst.status}</div>
              <div><strong>Registration Date:</strong> {verifiedGst.registrationDate || 'N/A'}</div>
              <div><strong>Taxpayer Type:</strong> {verifiedGst.taxpayerType || 'N/A'}</div>
              <div><strong>Constitution:</strong> {verifiedGst.constitution || 'N/A'}</div>
              <div><strong>State / Code:</strong> {verifiedGst.state || 'N/A'} ({verifiedGst.stateCode})</div>
              <div><strong>Embedded PAN:</strong> <span className="mono">{verifiedGst.panEmbedded || 'N/A'}</span></div>
              <div><strong>e-Invoice Status:</strong> {verifiedGst.einvoiceStatus || 'N/A'}</div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong>Principal Place of Business:</strong> {verifiedGst.principalPlaceOfBusiness?.address || 'N/A'}
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong>Nature of Business:</strong> {verifiedGst.natureOfBusiness.join(', ') || 'N/A'}
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong>Jurisdiction:</strong> State: {verifiedGst.jurisdiction?.stateJurisdiction || 'N/A'} · Central: {verifiedGst.jurisdiction?.centralJurisdiction || 'N/A'}
              </div>
            </div>

            {/* Confirmation & Save */}
            <div className="grid grid-2" style={{ alignItems: 'end', borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
              <Field label="Select Filing Frequency">
                <select value={gstFilingFrequency} onChange={(e) => setGstFilingFrequency(e.target.value as any)}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QRMP">QRMP (quarterly)</option>
                  <option value="COMPOSITION">Composition</option>
                </select>
              </Field>

              <button type="button" className="btn-primary" disabled={busy} onClick={handleSaveVerified}>
                Confirm & Save GST Registration
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function UdyamValidationSummaryBox({
  summary,
}: {
  summary: UdyamCompanyValidationSummary;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, marginBottom: 16 }}>
      <div className="tiny" style={{ fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', color: '#64748b' }}>
        Company Udyam Data Validation Summary
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        {summary.passedChecks.map((check, i) => (
          <div key={`pass-${i}`} style={{ color: 'var(--color-success, #2e7d32)' }}>
            ✓ {check}
          </div>
        ))}
        {summary.failedChecks.map((check, i) => (
          <div key={`fail-${i}`} style={{ color: 'var(--color-danger, #e53935)' }}>
            ⚠ {check}
          </div>
        ))}
        {summary.warnings.map((warn, i) => (
          <div key={`warn-${i}`} style={{ color: 'var(--color-warn, #ed6c02)' }}>
            ⚠ {warn}
          </div>
        ))}
      </div>
    </div>
  );
}

function UdyamRegistrationSection({
  company,
  busy,
  errors,
  run,
  local,
  setLocalError,
}: {
  company: Company;
  busy: boolean;
  errors: Record<string, string>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  local: Record<string, string>;
  setLocalError: (key: string, message: string | null) => void;
}) {
  const [udyamInput, setUdyamInput] = useState(company.msmeRegistration?.udyamNumber ?? '');
  const [categoryInput, setCategoryInput] = useState<string>(company.msmeRegistration?.category ?? 'MICRO');
  const [udyamSession, setUdyamSession] = useState<UdyamSessionResult | null>(null);
  const [captchaInput, setCaptchaInput] = useState('');
  const [verifiedUdyam, setVerifiedUdyam] = useState<UdyamMasterRecord | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [udyamError, setUdyamError] = useState<string | null>(null);

  const cleanUdyam = udyamInput.trim().toUpperCase();

  const handleStartSession = async () => {
    if (!cleanUdyam) {
      setLocalError('udyam', 'Please enter a valid Udyam Registration Number.');
      return;
    }
    if (!UDYAM_REGEX.test(cleanUdyam)) {
      setLocalError('udyam', 'A Udyam number looks like UDYAM-TN-28-0008330.');
      return;
    }

    setLocalError('udyam', null);
    setUdyamError(null);
    setVerifying(true);
    try {
      const res = await post<UdyamSessionResult>('/udyam/session', {
        companyId: company.id,
        udyam_number: cleanUdyam,
      });

      if (res && res.success && res.sessionId) {
        setUdyamSession(res);
        setCaptchaInput('');
      } else {
        const msg = res?.error?.message || 'Failed to initiate Udyam verification session.';
        setUdyamError(msg);
      }
    } catch (err: any) {
      setUdyamError(err?.message || 'Udyam verification service is temporarily unavailable. Please try again later.');
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyCaptcha = async () => {
    if (!captchaInput.trim()) {
      setUdyamError('Invalid CAPTCHA. Please try again.');
      return;
    }
    if (!udyamSession || !udyamSession.sessionId) {
      setUdyamError('Verification session expired. Please get a new CAPTCHA.');
      return;
    }

    setUdyamError(null);
    setVerifying(true);
    try {
      const res = await post<UdyamVerificationResult>('/udyam/verify', {
        companyId: company.id,
        sessionId: udyamSession.sessionId,
        udyam_number: cleanUdyam,
        captcha: captchaInput.trim(),
      });

      const master = res?.registration || res?.data;
      if (res && res.success && master) {
        setVerifiedUdyam(master);
        if (master.category) {
          setCategoryInput(master.category.toUpperCase());
        }
        setUdyamSession(null);
      } else {
        const errMsg = res?.error?.message || 'Invalid CAPTCHA. Please try again.';
        setUdyamError(errMsg);
      }
    } catch (err: any) {
      setUdyamError(err?.message || 'Udyam verification service is temporarily unavailable. Please try again later.');
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveVerified = async () => {
    const recordToSave = verifiedUdyam;
    const finalUdyamNo = recordToSave?.udyamNumber || cleanUdyam;
    const finalCategory = (recordToSave?.category || categoryInput).toUpperCase();
    const registeredOn = recordToSave?.dateOfRegistration || null;

    setUdyamError(null);
    await run(async () => {
      await put(`/companies/${company.id}/msme-registration`, {
        udyamNumber: finalUdyamNo,
        category: finalCategory,
        registeredOn,
      });
      setVerifiedUdyam(null);
      setUdyamSession(null);
    });
  };

  const handleDirectSave = async () => {
    if (!UDYAM_REGEX.test(cleanUdyam)) {
      setLocalError('udyam', 'A Udyam number looks like UDYAM-TN-28-0008330.');
      return;
    }

    setLocalError('udyam', null);
    await run(async () => {
      await put(`/companies/${company.id}/msme-registration`, {
        udyamNumber: cleanUdyam,
        category: categoryInput.toUpperCase(),
      });
    });
  };

  const activeSummary = verifiedUdyam ? validateUdyamForCompany(verifiedUdyam, company) : null;

  return (
    <Card title="Udyam (MSME) Registration">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Persisted MSME Registration */}
        {company.msmeRegistration && !verifiedUdyam && !udyamSession && (
          <div style={{ background: 'var(--bg-subtle, #f8fafc)', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <strong style={{ fontSize: 15 }} className="mono">{company.msmeRegistration.udyamNumber}</strong>
                <div className="tiny" style={{ color: '#16a34a', fontWeight: 500 }}>
                  ✓ Saved Udyam Registration &nbsp;•&nbsp; {company.msmeRegistration.category}
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-ghost btn-danger"
                disabled={busy}
                onClick={() => run(async () => {
                  await del(`/companies/${company.id}/msme-registration`);
                  setUdyamInput('');
                  setCategoryInput('MICRO');
                })}
              >
                Remove
              </button>
            </div>

            <div className="grid grid-2" style={{ gap: 10, fontSize: 13 }}>
              <div><strong>Udyam Number:</strong> <span className="mono">{company.msmeRegistration.udyamNumber}</span></div>
              <div><strong>Category:</strong> {company.msmeRegistration.category}</div>
              {company.msmeRegistration.registeredOn && (
                <div><strong>Registered On:</strong> {company.msmeRegistration.registeredOn}</div>
              )}
            </div>
          </div>
        )}

        {udyamError && <ErrorNote error={udyamError} />}

        {/* Verification / Entry Form */}
        {!udyamSession && !verifiedUdyam && (
          <div className="grid grid-3" style={{ alignItems: 'end', paddingTop: company.msmeRegistration ? 10 : 0, borderTop: company.msmeRegistration ? '1px solid var(--border)' : 'none' }}>
            <Field label="Udyam Number" error={local.udyam ?? errors['udyamNumber']}>
              <input
                value={udyamInput}
                placeholder="UDYAM-TN-28-0008330"
                onChange={(e) => {
                  setUdyamInput(e.target.value.toUpperCase());
                  setLocalError('udyam', null);
                  setUdyamError(null);
                }}
              />
            </Field>

            <Field label="Category">
              <select value={categoryInput} onChange={(e) => setCategoryInput(e.target.value)}>
                <option value="MICRO">Micro</option>
                <option value="SMALL">Small</option>
                <option value="MEDIUM">Medium</option>
              </select>
            </Field>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || verifying}
                onClick={handleStartSession}
              >
                {verifying ? <Spinner /> : 'Get CAPTCHA'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || verifying}
                onClick={handleDirectSave}
                title="Save Udyam number directly without live CAPTCHA"
              >
                Save Directly
              </button>
            </div>
          </div>
        )}

        {/* CAPTCHA Session Panel */}
        {udyamSession && !verifiedUdyam && (
          <div style={{ background: 'var(--bg-subtle, #f9fafb)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 6 }}>
            <div className="stack" style={{ gap: 4, marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>Official Udyam Portal Verification - Enter CAPTCHA</strong>
              <span className="tiny dim">Enter the visual CAPTCHA from official portal to verify enterprise details.</span>
            </div>

            <div className="row" style={{ alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
              {udyamSession.captchaImage ? (
                <div style={{ background: '#fff', padding: 6, border: '1px solid #ccc', borderRadius: 4 }}>
                  <img src={udyamSession.captchaImage} alt="Udyam CAPTCHA Challenge" style={{ height: 46, display: 'block' }} />
                </div>
              ) : (
                <span className="tiny error">CAPTCHA image unavailable</span>
              )}

              <button
                type="button"
                className="btn-sm btn-ghost"
                disabled={verifying}
                onClick={handleStartSession}
              >
                Refresh CAPTCHA
              </button>
            </div>

            <div className="grid grid-2" style={{ alignItems: 'end' }}>
              <Field label="Enter CAPTCHA Code">
                <input
                  value={captchaInput}
                  placeholder="Type visible characters"
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyCaptcha(); }}
                />
              </Field>

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={verifying || !captchaInput.trim()}
                  onClick={handleVerifyCaptcha}
                >
                  {verifying ? <Spinner /> : 'Verify Udyam'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={verifying}
                  onClick={() => setUdyamSession(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Verified Udyam Record & Company Validation Summary */}
        {verifiedUdyam && activeSummary && (
          <div style={{ background: 'var(--bg-subtle, #f8fafc)', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16, marginTop: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <strong style={{ fontSize: 15 }}>Verified Udyam Details</strong>
                <div className="tiny" style={{ color: '#16a34a', fontWeight: 500 }}>✓ Verified via BizVerify / Official Udyam Portal</div>
              </div>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setVerifiedUdyam(null)}>Clear</button>
            </div>

            {/* Validation Summary */}
            <UdyamValidationSummaryBox summary={activeSummary} />

            {/* Key-Value Details Grid */}
            <div className="grid grid-2" style={{ gap: 10, fontSize: 13, marginBottom: 16 }}>
              <div><strong>Udyam Number:</strong> <span className="mono">{verifiedUdyam.udyamNumber}</span></div>
              <div><strong>Enterprise Name:</strong> {verifiedUdyam.enterpriseName}</div>
              <div><strong>Owner / Entrepreneur Name:</strong> {verifiedUdyam.ownerName || 'N/A'}</div>
              <div><strong>Category:</strong> {verifiedUdyam.category}</div>
              <div><strong>Major Activity:</strong> {verifiedUdyam.activityType}</div>
              <div><strong>Status:</strong> {verifiedUdyam.status}</div>
              <div><strong>Registration Date:</strong> {verifiedUdyam.dateOfRegistration || 'N/A'}</div>
              <div><strong>Commencement Date:</strong> {verifiedUdyam.dateOfCommencement || 'N/A'}</div>
              <div><strong>PAN:</strong> <span className="mono">{verifiedUdyam.pan || 'N/A'}</span></div>
              <div><strong>GSTIN:</strong> <span className="mono">{verifiedUdyam.gstin || 'N/A'}</span></div>
              <div><strong>Social Category:</strong> {verifiedUdyam.socialCategory || 'N/A'}</div>
              <div><strong>Location:</strong> {verifiedUdyam.district ? `${verifiedUdyam.district}, ` : ''}{verifiedUdyam.state || 'N/A'}</div>
              <div><strong>Employees:</strong> Total: {verifiedUdyam.employees?.total ?? 0} (M: {verifiedUdyam.employees?.male ?? 0}, F: {verifiedUdyam.employees?.female ?? 0})</div>
              <div><strong>NIC Code:</strong> {verifiedUdyam.nicCode || 'N/A'} - {verifiedUdyam.nicDescription || ''}</div>
              {verifiedUdyam.turnoverInr !== null && (
                <div><strong>Turnover:</strong> {fmtINR(verifiedUdyam.turnoverInr)}</div>
              )}
              {verifiedUdyam.investmentInPlantMachineryInr !== null && (
                <div><strong>Investment in Plant & Machinery:</strong> {fmtINR(verifiedUdyam.investmentInPlantMachineryInr)}</div>
              )}
            </div>

            {/* Confirm & Save */}
            <div className="row" style={{ justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
              <button type="button" className="btn-primary" disabled={busy} onClick={handleSaveVerified}>
                Confirm & Save Udyam Registration
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
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
        <GstRegistrationSection
          company={company}
          busy={busy}
          errors={errors}
          run={run}
          local={local}
          setLocalError={setLocalError}
        />
      )}

      {(!showOnly || showOnly === 'msme') && (
        <UdyamRegistrationSection
          company={company}
          busy={busy}
          errors={errors}
          run={run}
          local={local}
          setLocalError={setLocalError}
        />
      )}
    </>
  );
}
