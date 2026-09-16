export interface RegistrationServiceLink {
  label: string;
  url: string;
  /** 'register' reads "Don't have this yet? Register via …"; 'file' reads "File via …". */
  kind?: 'register' | 'file';
}

/**
 * Every regibiz.in service in one place. The maps below (rule codes, CompanyEdit
 * field keys, partner footer) all reference these URLs, so there is exactly one
 * copy of each link.
 */
const urls = {
  gstRegistration: 'https://regibiz.in/services/gst-registration',
  msmeRegistration: 'https://regibiz.in/services/msme-registration',
  shopEstablishment: 'https://regibiz.in/services/shop-establishment-license',
  fssai: 'https://regibiz.in/services/fssai-license',
  companyRegistration: 'https://regibiz.in/services/company-registration',
  dsc: 'https://regibiz.in/services/dsc-registration',
  startupIndia: 'https://regibiz.in/services/startup-india',
  rocSelection: 'https://regibiz.in/services/roc-selection',
  inc20a: 'https://regibiz.in/services/inc-20a-filing',
  dir3Kyc: 'https://regibiz.in/services/dir-3-kyc-filing',
  mgt7: 'https://regibiz.in/services/mgt-7-filing',
  inc22a: 'https://regibiz.in/services/inc-22a-filing',
  tradeLicense: 'https://regibiz.in/services/trade-license',
  websiteDevelopment: 'https://regibiz.in/services/website-development',
} as const;

/**
 * Rule code -> external registration or filing service. Shared by the Dashboard
 * "register first" band and the Rules page (rows show a "Get help" link when a
 * service exists). Codes missing from this map intentionally render no link —
 * PF_REGISTER and ESI_REGISTER have no regibiz.in service, and regular filing
 * rules (GSTR-3B, AOC-4, …) have nothing here either.
 */
export const REGISTRATION_SERVICE_LINKS: Record<string, RegistrationServiceLink> = {
  GST_REGISTER: { label: 'GST registration', url: urls.gstRegistration, kind: 'register' },
  MSME_UDYAM_REGISTRATION: { label: 'MSME / Udyam registration', url: urls.msmeRegistration, kind: 'register' },
  LABOUR_SHOPS_ESTABLISHMENT: { label: 'Shops & Establishments registration', url: urls.shopEstablishment, kind: 'register' },
  MCA_INC20A: { label: 'INC-20A filing', url: urls.inc20a, kind: 'file' },
  MCA_DIR3KYC: { label: 'DIR-3 KYC filing', url: urls.dir3Kyc, kind: 'file' },
  MCA_MGT7: { label: 'MGT-7 filing', url: urls.mgt7, kind: 'file' },
  MCA_INC22: { label: 'INC-22 office-change filing', url: urls.inc22a, kind: 'file' },
};

/**
 * CompanyEdit field key -> matching service link, rendered as sub-text under
 * the control. Fields with no matching regibiz.in service (PAN, TAN, EPFO,
 * ESIC, LLPIN, …) are deliberately absent and show nothing.
 */
export const REGISTRATION_FIELD_LINKS: Record<string, RegistrationServiceLink> = {
  cin: { label: 'Company registration', url: urls.companyRegistration, kind: 'register' },
  cinRoc: { label: 'ROC selection', url: urls.rocSelection, kind: 'register' },
  gstin: { label: 'GST registration', url: urls.gstRegistration, kind: 'register' },
  udyam: { label: 'MSME / Udyam registration', url: urls.msmeRegistration, kind: 'register' },
  dpiit: { label: 'Startup India recognition', url: urls.startupIndia, kind: 'register' },
  din: { label: 'DIR-3 KYC', url: urls.dir3Kyc, kind: 'file' },
  dsc: { label: 'DSC registration', url: urls.dsc, kind: 'register' },
  incorporationDate: { label: 'INC-20A', url: urls.inc20a, kind: 'file' },
};

/**
 * Partner services that have no rule or form field to attach to yet. Surfaced
 * as a plainly-labelled directory line on the Rules page — never as compliance
 * obligations, which the engine has no data to justify.
 */
export const OTHER_REGISTRATION_SERVICES: RegistrationServiceLink[] = [
  { label: 'FSSAI license', url: urls.fssai },
  { label: 'Trade license', url: urls.tradeLicense },
  { label: 'Website development', url: urls.websiteDevelopment },
];