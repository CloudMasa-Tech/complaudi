import type { Authority, EntityType } from '../types';

export type RegStatus = 'REGISTERED' | 'ELIGIBLE' | 'MANDATORY' | 'PENDING_APPLICATION' | 'EXPIRED_RENEWAL_DUE';

export interface EvaluatedRegistration {
  id: string;
  title: string;
  status: RegStatus;
  reason: string;
  ctaUrl?: string;
  authority: Authority;
}

export interface RegistrationRule {
  id: string;
  title: string;
  authority: Authority;
  isEligible: (profile: any) => boolean;
  evaluate: (profile: any) => EvaluatedRegistration;
}

const hasVal = (v: unknown): boolean => typeof v === 'string' ? v.trim().length > 0 : Boolean(v);

export const registrationCatalog: RegistrationRule[] = [
  {
    id: 'mca_cin',
    title: 'MCA Incorporation (CIN)',
    authority: 'MCA',
    isEligible: (profile) => ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8'].includes(profile.entityType),
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.registrationNumber);
      return {
        id: 'mca_cin',
        title: 'MCA Incorporation (CIN)',
        authority: 'MCA',
        status: isCompleted ? 'REGISTERED' : 'MANDATORY',
        reason: isCompleted ? `Incorporated with CIN ${profile.registrationNumber}` : 'Mandatory for companies to incorporate via MCA.',
      };
    },
  },
  {
    id: 'mca_llpin',
    title: 'LLP Incorporation (LLPIN)',
    authority: 'MCA',
    isEligible: (profile) => profile.entityType === 'LLP',
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.registrationNumber);
      return {
        id: 'mca_llpin',
        title: 'LLP Incorporation (LLPIN)',
        authority: 'MCA',
        status: isCompleted ? 'REGISTERED' : 'MANDATORY',
        reason: isCompleted ? `Incorporated with LLPIN ${profile.registrationNumber}` : 'Mandatory for LLPs to incorporate via MCA.',
      };
    },
  },
  {
    id: 'gst',
    title: 'GST Registration',
    authority: 'GST',
    isEligible: () => true, // All entities are eligible for GST
    evaluate: (profile) => {
      const activeGstins = (profile.gstins || []).filter((g: any) => hasVal(g?.gstin) && g.isActive !== false);
      const isCompleted = activeGstins.length > 0;
      const turnover = profile.annualTurnover ?? 0;
      const isRequired = turnover >= 20_00_000;
      return {
        id: 'gst',
        title: 'GST Registration',
        authority: 'GST',
        status: isCompleted ? 'REGISTERED' : isRequired ? 'MANDATORY' : 'ELIGIBLE',
        reason: isCompleted
          ? `Completed with ${activeGstins.length} active GSTINs`
          : isRequired
            ? `Required: your turnover (₹${(turnover/100000).toFixed(1)}L) crosses the ₹20 lakh GST threshold`
            : `Eligible / Not Mandatory Currently (Turnover is ₹${(turnover/100000).toFixed(1)}L). Optional / Register when required.`,
        ctaUrl: 'https://regibiz.in/gst-registration',
      };
    },
  },
  {
    id: 'msme',
    title: 'MSME / Udyam',
    authority: 'MSME',
    isEligible: () => true, // All entities are eligible for MSME
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.msme?.udyamNumber);
      return {
        id: 'msme',
        title: 'MSME / Udyam',
        authority: 'MSME',
        status: isCompleted ? 'REGISTERED' : 'ELIGIBLE',
        reason: isCompleted
          ? `Completed with Udyam number ${profile.msme?.udyamNumber}`
          : `Eligible / Optional: MSME registration is not legally mandatory (but provides benefits)`,
        ctaUrl: 'https://regibiz.in/msme-registration',
      };
    },
  },
  {
    id: 'pf',
    title: 'PF (EPFO)',
    authority: 'LABOUR',
    isEligible: () => true, // All entities can hire employees
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.epfoCode);
      const empCount = profile.employeeCount ?? 0;
      const isRequired = empCount >= 20;
      return {
        id: 'pf',
        title: 'PF (EPFO)',
        authority: 'LABOUR',
        status: isCompleted ? 'REGISTERED' : isRequired ? 'MANDATORY' : 'ELIGIBLE',
        reason: isCompleted
          ? `Completed with EPFO code ${profile.epfoCode}`
          : isRequired
            ? `Required: your employee count (${empCount}) crosses the 20-employee PF threshold`
            : `Eligible / Not Mandatory Currently: your employee count (${empCount}) is below the 20-employee PF threshold`,
        ctaUrl: 'https://regibiz.in/epf-registration',
      };
    },
  },
  {
    id: 'esi',
    title: 'ESI (ESIC)',
    authority: 'LABOUR',
    isEligible: () => true,
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.esicCode);
      const empCount = profile.employeeCount ?? 0;
      const threshold = (profile.stateCode === 'MH' || profile.stateCode === 'CH') ? 20 : 10;
      const isRequired = empCount >= threshold;
      return {
        id: 'esi',
        title: 'ESI (ESIC)',
        authority: 'LABOUR',
        status: isCompleted ? 'REGISTERED' : isRequired ? 'MANDATORY' : 'ELIGIBLE',
        reason: isCompleted
          ? `Completed with ESIC code ${profile.esicCode}`
          : isRequired
            ? `Required: your employee count (${empCount}) crosses the ${threshold}-employee ESI threshold for your state`
            : `Eligible / Not Mandatory Currently: your employee count (${empCount}) is below the ${threshold}-employee ESI threshold for your state`,
        ctaUrl: 'https://regibiz.in/esi-registration',
      };
    },
  },
  {
    id: 'dpiit',
    title: 'Startup India (DPIIT)',
    authority: 'DPIIT',
    isEligible: (profile) => ['PRIVATE_LIMITED', 'LLP', 'PARTNERSHIP'].includes(profile.entityType), // DPIIT is strictly for these 3 types
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.dpiit?.number);
      return {
        id: 'dpiit',
        title: 'Startup India (DPIIT)',
        authority: 'DPIIT',
        status: isCompleted ? 'REGISTERED' : 'ELIGIBLE',
        reason: isCompleted
          ? `Recognised by DPIIT with number ${profile.dpiit?.number}`
          : `Eligible / Optional: DPIIT recognition provides startup benefits, but is not mandatory`,
        ctaUrl: 'https://regibiz.in/startup-india',
      };
    },
  },
  {
    id: 'shop_est',
    title: 'Shop & Establishment',
    authority: 'LABOUR',
    isEligible: (profile) => hasVal(profile.shopAndEstablishment) || profile.businessType === 'SHOP_RETAIL' || profile.businessType === 'FOOD_RESTAURANT' ||
                         (!!profile.industry && /(retail|shop|restaurant|cafe|clinic|hospital|gym|manufacturing|factory|warehouse|logistics)/i.test(profile.industry)),
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.shopAndEstablishment);
      return {
        id: 'shop_est',
        title: 'Shop & Establishment',
        authority: 'LABOUR',
        status: isCompleted ? 'REGISTERED' : 'MANDATORY',
        reason: isCompleted
          ? `Completed with registration number ${profile.shopAndEstablishment}`
          : `Required for physical commercial premises (inferred from your profile).`,
        ctaUrl: 'https://regibiz.in/shop-establishment',
      };
    },
  },
  {
    id: 'fssai',
    title: 'FSSAI License',
    authority: 'LABOUR', // TODO: add FSSAI authority later if needed
    isEligible: (profile) => hasVal(profile.fssai) || profile.businessType === 'FOOD_RESTAURANT',
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.fssai);
      return {
        id: 'fssai',
        title: 'FSSAI License',
        authority: 'LABOUR',
        status: isCompleted ? 'REGISTERED' : 'MANDATORY',
        reason: isCompleted
          ? `Completed with FSSAI number ${profile.fssai}`
          : `Required: Your business type is listed as Food/Restaurant.`,
        ctaUrl: 'https://regibiz.in/fssai',
      };
    },
  },
  {
    id: 'pt',
    title: 'Professional Tax (PT)',
    authority: 'INCOME_TAX', // Using INCOME_TAX as closest match
    isEligible: (profile) => {
      const PT_STATES = ['AP', 'AS', 'BR', 'CG', 'GJ', 'JH', 'KA', 'KL', 'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'PY', 'SK', 'TN', 'TG', 'TR', 'WB'];
      return hasVal(profile.professionalTax) || PT_STATES.includes(profile.stateCode ?? '');
    },
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.professionalTax);
      return {
        id: 'pt',
        title: 'Professional Tax (PT)',
        authority: 'INCOME_TAX',
        status: isCompleted ? 'REGISTERED' : 'MANDATORY',
        reason: isCompleted
          ? `Completed with PT number ${profile.professionalTax}`
          : `Required: Your state (${profile.stateCode}) levies Professional Tax.`,
        ctaUrl: 'https://regibiz.in/professional-tax',
      };
    },
  },
  {
    id: 'trade_license',
    title: 'Trade License',
    authority: 'LABOUR',
    isEligible: (profile) => hasVal(profile.tradeLicense) || profile.businessType === 'SHOP_RETAIL' || profile.businessType === 'FOOD_RESTAURANT' ||
                         (!!profile.industry && /(retail|shop|restaurant|cafe|clinic|hospital|gym|manufacturing|factory|warehouse|logistics)/i.test(profile.industry)),
    evaluate: (profile) => {
      const isCompleted = hasVal(profile.tradeLicense);
      return {
        id: 'trade_license',
        title: 'Trade License',
        authority: 'LABOUR',
        status: isCompleted ? 'REGISTERED' : 'MANDATORY',
        reason: isCompleted
          ? `Completed with License number ${profile.tradeLicense}`
          : `Required by local municipal authorities for physical commercial operations.`,
        ctaUrl: 'https://regibiz.in/trade-license',
      };
    },
  }
];

export function evaluateRegistrations(profile: any): EvaluatedRegistration[] {
  return registrationCatalog
    .filter(r => r.isEligible(profile))
    .map(r => r.evaluate(profile));
}
