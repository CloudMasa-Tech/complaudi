import { z } from 'zod';
import { boolish } from '../../lib/boolish';
import {
  CIN_REGEX,
  DIN_REGEX,
  GSTIN_REGEX,
  LLPIN_REGEX,
  PAN_REGEX,
  STATE_CODES,
  TAN_REGEX,
  UDYAM_REGEX,
} from '../../lib/india';

const upper = (s: string) => s.toUpperCase().trim();

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date');

/** Turnover and capital can exceed 2^53 in paise-free rupees only in theory, but BigInt columns need string input. */
const rupees = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n, 'Amount cannot be negative');

export const entityTypeSchema = z.enum([
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'OPC',
  'LLP',
  'PARTNERSHIP',
  'PROPRIETORSHIP',
  'SECTION_8',
]);

export const stateCodeSchema = z
  .string()
  .transform(upper)
  .refine((v) => STATE_CODES.includes(v), (v) => ({ message: `"${v}" is not a recognised state code` }));

export const directorSchema = z.object({
  name: z.string().min(2).max(120),
  din: z.string().transform(upper).refine((v) => DIN_REGEX.test(v), 'DIN/DPIN must be 8 digits').optional().nullable(),
  email: z.string().email().toLowerCase().optional().nullable(),
  designation: z.string().max(60).default('Director'),
  appointedOn: dateString.optional().nullable(),
  resignedOn: dateString.optional().nullable(),
  isResident: z.boolean().default(true),
  /** Expiry, not the certificate — a filing cannot be signed on a lapsed one. */
  dscExpiresOn: dateString.optional().nullable(),
});

export const gstRegistrationSchema = z.object({
  gstin: z.string().transform(upper).refine((v) => GSTIN_REGEX.test(v), 'GSTIN must be 15 characters, e.g. 33AAACT1234A1Z8'),
  stateCode: stateCodeSchema.optional(),
  legalName: z.string().max(200).optional().nullable(),
  filingFrequency: z.enum(['MONTHLY', 'QRMP', 'COMPOSITION']).default('MONTHLY'),
  isTdsDeductor: z.boolean().default(false),
  isEcommerceOperator: z.boolean().default(false),
  registeredOn: dateString.optional().nullable(),
  isActive: z.boolean().default(true),
});

export const msmeRegistrationSchema = z.object({
  udyamNumber: z
    .string()
    .transform(upper)
    .refine((v) => UDYAM_REGEX.test(v), 'Udyam number must look like UDYAM-TN-01-1234567'),
  category: z.enum(['MICRO', 'SMALL', 'MEDIUM']),
  registeredOn: dateString.optional().nullable(),
});

/** Recorded as issued; an empty field means the entity does not hold one. */
const heldNumber = z
  .string()
  .max(40)
  .transform((v) => upper(v) || null)
  .optional()
  .nullable();

const companyCore = {
  legalName: z.string().min(2).max(200),
  brandName: z.string().max(200).optional().nullable(),
  entityType: entityTypeSchema,
  cin: z.string().transform(upper).refine((v) => CIN_REGEX.test(v), 'CIN must be 21 characters, e.g. U72900TN2020PTC123456').optional().nullable(),
  llpin: z.string().transform(upper).refine((v) => LLPIN_REGEX.test(v), 'LLPIN must look like AAB-1234').optional().nullable(),
  pan: z.string().transform(upper).refine((v) => PAN_REGEX.test(v), 'PAN must be 10 characters, e.g. AAACT1234A').optional().nullable(),
  tan: z.string().transform(upper).refine((v) => TAN_REGEX.test(v), 'TAN must be 10 characters, e.g. CHET12345A').optional().nullable(),
  // Required: the engine cannot tell an obligation the entity owes from one
  // that fell due before it existed without this.
  incorporationDate: dateString,
  stateCode: stateCodeSchema,
  industry: z.string().max(120).optional().nullable(),
  employeeCount: z.number().int().min(0).max(1_000_000).default(0),
  annualTurnover: rupees.default(0),
  paidUpCapital: rupees.default(0),
  cashTransactionRatioBelow5Pct: z.boolean().default(true),
  hasForeignTransactions: z.boolean().default(false),
  acceptsDeposits: z.boolean().default(false),
  isListed: z.boolean().default(false),
  buysFromMsmeSuppliers: z.boolean().default(true),
  agmDate: dateString.optional().nullable(),

  // Registrations the entity holds rather than obligations it owes. The shapes
  // differ by issuing office — an EPFO code from Chennai does not look like one
  // from Pune — so these are recorded as given rather than validated into a
  // format that would reject half the real ones. Blank means "not held".
  dpiitRecognitionNumber: heldNumber,
  dpiitRecognisedOn: dateString.optional().nullable(),
  epfoCode: heldNumber,
  esicCode: heldNumber,
};

/**
 * A single call that creates the company and everything the engine needs to
 * evaluate it — this is the "Company onboarding" step of the MVP flow.
 */
export const createCompanySchema = z
  .object({
    ...companyCore,
    directors: z.array(directorSchema).max(50).default([]),
    gstRegistrations: z.array(gstRegistrationSchema).max(40).default([]),
    msmeRegistration: msmeRegistrationSchema.optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const companiesActEntity = ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OPC', 'SECTION_8'].includes(data.entityType);
    if (companiesActEntity && !data.cin) {
      ctx.addIssue({ code: 'custom', path: ['cin'], message: 'A CIN is required for a company registered under the Companies Act' });
    }
    if (data.entityType === 'LLP' && !data.llpin) {
      ctx.addIssue({ code: 'custom', path: ['llpin'], message: 'An LLPIN is required for an LLP' });
    }
    if (data.entityType === 'OPC' && data.directors.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['directors'], message: 'A One Person Company has a single director on record' });
    }
  });

export const updateCompanySchema = z.object(companyCore).partial();

export const listCompaniesQuerySchema = z.object({
  search: z.string().max(120).optional(),
  entityType: entityTypeSchema.optional(),
  includeInactive: boolish(false),
});

export const idParamSchema = z.object({ id: z.string().uuid('Not a valid id') });
export const nestedIdParamSchema = z.object({ id: z.string().uuid(), childId: z.string().uuid() });

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
