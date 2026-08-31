/**
 * Identifier lookup.
 *
 * Today this *derives* facts from the structure of the identifier itself — no
 * MCA, GSTN or Income Tax service is contacted, so anything not encoded in the
 * characters (a legal name, an exact incorporation date, the directors) is
 * reported as unavailable rather than guessed.
 *
 * It is a server endpoint rather than client-side parsing so that the day a
 * real data source is wired in — a GSP for GSTIN, an MCA feed for CIN — the
 * response can be enriched without the front end changing shape.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { UnprocessableError } from '../../lib/errors';
import { decodeCin, decodePan, validateGstin } from '../../lib/india';
import { requireAuth } from '../../middleware/auth';
import { validateParams, validateQuery } from '../../middleware/validate';

export const lookupRouter = Router();
lookupRouter.use(requireAuth);

const DERIVED_FROM = 'Derived from the identifier itself — no government service was contacted.';

lookupRouter.get(
  '/cin/:cin',
  validateParams(z.object({ cin: z.string().min(21).max(21) })),
  asyncHandler(async (req, res) => {
    const decoded = decodeCin(req.params.cin!);
    if (!decoded) {
      throw new UnprocessableError(
        'That is not a valid CIN. It should be 21 characters, e.g. U72900TN2020PTC138472.',
      );
    }

    res.json({
      decoded,
      // Only what the identifier actually settles. A government company's
      // ownership class does not fix the entity type, so it comes back null.
      suggested: {
        entityType: decoded.entityType,
        stateCode: decoded.stateCode,
        isListed: decoded.listed,
        industry: decoded.industry,
        incorporationYear: decoded.incorporationYear,
      },
      derivedFrom: DERIVED_FROM,
      notAvailable: [
        { field: 'legalName', why: 'Held by MCA, not encoded in the CIN.' },
        { field: 'incorporationDate', why: 'The CIN carries the year only, not the day or month.' },
        { field: 'pan', why: 'Not encoded in the CIN. It is encoded in a GSTIN.' },
        { field: 'directors', why: 'Held by MCA against the DIN register.' },
        { field: 'paidUpCapital', why: 'Held by MCA and changes with every allotment.' },
      ],
    });
  }),
);

lookupRouter.get(
  '/pan/:pan',
  validateParams(z.object({ pan: z.string().min(10).max(10) })),
  asyncHandler(async (req, res) => {
    const decoded = decodePan(req.params.pan!);
    if (!decoded) throw new UnprocessableError('That is not a valid PAN. It should look like AAACT1234A.');
    res.json({ decoded, derivedFrom: DERIVED_FROM });
  }),
);

lookupRouter.get(
  '/gstin/:gstin',
  validateParams(z.object({ gstin: z.string().min(15).max(15) })),
  validateQuery(z.object({ pan: z.string().max(10).optional() })),
  asyncHandler(async (req, res) => {
    const { pan } = req.query as { pan?: string };
    const result = validateGstin(req.params.gstin!, pan ?? null);
    res.json({
      valid: result.valid,
      errors: result.errors,
      suggested: { stateCode: result.stateCode ?? null, pan: result.pan ?? null },
      derivedFrom: `${DERIVED_FROM} The check digit is verified; whether the registration is active is not.`,
    });
  }),
);
