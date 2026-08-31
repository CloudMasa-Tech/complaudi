import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { BadRequestError } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

/**
 * Validates and *replaces* the request segment with the parsed value, so
 * handlers receive coerced, defaulted, correctly typed data.
 */
export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new BadRequestError(`Invalid request ${source}`, formatZodError(result.error)));
      return;
    }
    // req.query and req.params are getter-only in Express 5; assigning to a
    // local copy keeps this working across both major versions.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
}

export const validateBody = (schema: ZodSchema) => validate(schema, 'body');
export const validateQuery = (schema: ZodSchema) => validate(schema, 'query');
export const validateParams = (schema: ZodSchema) => validate(schema, 'params');
