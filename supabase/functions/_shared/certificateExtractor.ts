// supabase/functions/_shared/certificateExtractor.ts

export interface GstExtractionResult {
  gstin: string | null;
  legalName: string | null;
  tradeName: string | null;
  registeredOn: string | null;
  stateCode: string | null;
  constitution: string | null;
}

export function extractGstInfo(text: string): GstExtractionResult {
  const gstinMatch = text.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);
  const gstin = gstinMatch ? gstinMatch[0] : null;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let legalName: string | null = null;
  let tradeName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.toLowerCase().includes('legal name')) {
      if (i + 1 < lines.length && !lines[i + 1]!.toLowerCase().includes('trade name')) {
        legalName = lines[i + 1]!;
      }
    }
    if (line.toLowerCase().includes('trade name')) {
      if (i + 1 < lines.length && !lines[i + 1]!.toLowerCase().includes('constitution of business')) {
        tradeName = lines[i + 1]!;
      }
    }
  }

  const dateMatch = text.match(/Date of Liability\s+(\d{2}[/-]\d{2}[/-]\d{4})/i);
  const registeredOn = dateMatch ? dateMatch[1]! : null;

  const stateMatch = text.match(/State\s+.*?Jurisdiction\s+([A-Za-z\s]+?)\s+(?:Ward|Circle|Sector)/i);
  const stateCode = stateMatch ? stateMatch[1]!.trim() : null;

  const constMatch = text.match(/Constitution of Business\s+([A-Za-z\s]+?)\s+Address of Principal/i);
  const constitution = constMatch ? constMatch[1]!.trim() : null;

  return { gstin, legalName, tradeName, registeredOn, stateCode, constitution };
}

export interface UdyamExtractionResult {
  udyamNumber: string | null;
  enterpriseName: string | null;
  registeredOn: string | null;
  organisationType: string | null;
  majorActivity: string | null;
  socialCategory: string | null;
}

export function extractUdyamInfo(text: string): UdyamExtractionResult {
  const udyamMatch = text.match(/UDYAM-[A-Z]{2}-\d{2}-\d{7}/i);
  const udyamNumber = udyamMatch ? udyamMatch[0].toUpperCase() : null;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let enterpriseName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.toLowerCase().includes('name of enterprise')) {
      if (i + 1 < lines.length) {
        enterpriseName = lines[i + 1]!;
      }
    }
  }

  const dateMatch = text.match(/DATE OF UDYAM REGISTRATION\s+(\d{2}[/-]\d{2}[/-]\d{4})/i);
  const registeredOn = dateMatch ? dateMatch[1]! : null;

  const typeMatch = text.match(/TYPE OF ENTERPRISE\s+(MICRO|SMALL|MEDIUM)/i);
  const organisationType = typeMatch ? typeMatch[1]!.toUpperCase() : null;

  const catMatch = text.match(/SOCIAL CATEGORY OF ENTREPRENEUR\s+(GENERAL|SC|ST|OBC)/i);
  const socialCategory = catMatch ? catMatch[1]!.toUpperCase() : null;

  const activityMatch = text.match(/MAJOR ACTIVITY\s+(MANUFACTURING|SERVICES)/i);
  const majorActivity = activityMatch ? activityMatch[1]!.toUpperCase() : null;

  return { udyamNumber, enterpriseName, registeredOn, organisationType, socialCategory, majorActivity };
}
