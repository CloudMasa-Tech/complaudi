// web/src/lib/panValidation.ts
import { PAN_REGEX, decodePan } from './india';

export interface PanValidationCheck {
  formatValid: boolean;
  holderType: string | null;
  holderCode: string | null;
  isCompany: boolean;
}

export function validatePanInput(pan: string): PanValidationCheck {
  const clean = (pan || '').trim().toUpperCase();
  const formatValid = PAN_REGEX.test(clean);
  if (!formatValid) {
    return { formatValid: false, holderType: null, holderCode: null, isCompany: false };
  }
  const decoded = decodePan(clean);
  return {
    formatValid: true,
    holderType: decoded?.holderType ?? null,
    holderCode: decoded?.holderCode ?? null,
    isCompany: decoded?.holderCode === 'C',
  };
}
