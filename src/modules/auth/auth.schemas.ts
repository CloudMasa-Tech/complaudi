import { z } from 'zod';
import { decodeCin, isValidStateCode, normalisePhone } from '../../lib/india';
import { entityTypeSchema } from '../companies/companies.schemas';

export const registerSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a digit'),
});

/**
 * Self-service enrolment. The company is created alongside the account, because
 * a compliance calendar with no entity behind it is an empty screen.
 *
 * The CIN is optional — many people signing up will not have it to hand — but
 * when it is given it settles the entity type, state and listing status, so the
 * form need not ask twice.
 */
export const trialSignupSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email().toLowerCase(),
    phone: z.string().min(6).max(24),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .max(128)
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[0-9]/, 'Password must contain a digit'),

    companyName: z.string().min(2).max(200),
    /// Required: no calendar can be built without it.
    incorporationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
      .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(), 'That date is in the future'),
    entityType: entityTypeSchema.default('PRIVATE_LIMITED'),
    /// Optional when a CIN is supplied, which carries the state itself.
    stateCode: z.string().min(2).max(6).optional().nullable(),
    cin: z.string().max(21).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.cin && !decodeCin(data.cin)) {
      ctx.addIssue({ code: 'custom', path: ['cin'], message: 'That is not a valid CIN — 21 characters, e.g. U72900TN2020PTC138472.' });
    }
    // The CIN supplies the state; only ask for it when there is no CIN.
    const decodedState = data.cin ? decodeCin(data.cin)?.stateCode : null;
    if (!decodedState && !(data.stateCode && isValidStateCode(data.stateCode))) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateCode'],
        message: 'Pick the state the entity is registered in, or give the CIN and we will read it from there.',
      });
    }
    if (!normalisePhone(data.phone)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a 10-digit Indian mobile number.' });
    }
  });

export type TrialSignupInput = z.infer<typeof trialSignupSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const inviteSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(10).max(128),
  role: z.enum(['ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER']).default('VIEWER'),
  /** Companies to grant on creation. A user with none sees nothing. */
  companyIds: z.array(z.string().uuid()).max(200).default([]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
