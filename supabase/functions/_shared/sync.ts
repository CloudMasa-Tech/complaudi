// supabase/functions/_shared/sync.ts
/**
 * Regenerate a company's compliance calendar.
 *
 * Lifted out of compliance-api so that the endpoints which *change* what a
 * company is can call it too. Adding a Udyam number, a GSTIN, a director or a
 * TAN changes which rules apply — but until now only an explicit
 * POST /compliance/companies/:id/sync rebuilt the calendar, so the row landed
 * in the table and the obligations it unlocks never appeared. A registration
 * saved through the UI looked accepted and changed nothing downstream.
 *
 * The Node API has never had this gap: companies.service.ts awaits
 * syncCompany() after every mutation of this kind. This brings the edge API
 * into line.
 *
 * Idempotent. Completed and waived items keep their status; everything else
 * has its status and due date refreshed from the engine.
 */
import { generateCalendar, deriveStatus, evaluateAll } from './engine/index.ts';
import { addDays, parseDate, today } from './dates.ts';

export interface SyncOutcome {
  synced: boolean;
  generatedItems: number;
  created: number;
  updated: number;
  /** What the UI reports after a save — previously hardcoded to zero. */
  applicableRules: number;
  inapplicableRules: number;
}

/** How far either side of today the calendar is materialised. */
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 365;

/**
 * Project a stored company onto the shape the engine consumes.
 *
 * Kept here rather than at each call site so the two callers cannot drift on
 * something as consequential as whether logged events are loaded.
 */
export function buildContextFromRow(company: any) {
  return {
    company: {
      ...company,
      annualTurnover: Number(company.annualTurnover || 0),
      paidUpCapital: Number(company.paidUpCapital || 0),
      incorporationDate: company.incorporationDate ? parseDate(company.incorporationDate) : null,
      agmDate: company.agmDate ? parseDate(company.agmDate) : null,
      // Logged compliance events drive the MCA event-based rules (DIR-11,
      // DIR-12, CHG-1, CHG-4, INC-22, MGT-14, PAS-3, SH-7). Node loads the
      // CompanyEvent table the same way in syncCompany().
      events: (company.company_events || [])
        .filter((e: any) => e && e.eventDate)
        .map((e: any) => ({
          eventType: e.eventType,
          eventDate: parseDate(e.eventDate)!,
          metadata: (e.metadata as Record<string, unknown>) || {},
        })),
    },
    directors: (company.directors || []).map((d: any) => ({
      ...d,
      appointedOn: d.appointedOn ? parseDate(d.appointedOn) : null,
      resignedOn: d.resignedOn ? parseDate(d.resignedOn) : null,
    })),
    gstRegistrations: company.gstRegistrations || [],
    msme: company.msme
      ? { ...company.msme, registeredOn: company.msme.registeredOn ? parseDate(company.msme.registeredOn) : null }
      : null,
  };
}

/** Everything the engine needs, in one query. */
export const COMPANY_WITH_PROFILE =
  '*, directors(*), gstRegistrations:gst_registrations(*), msme:msme_registrations(*), company_events:company_events(*)';

export async function syncCompanyCalendar(supabase: any, companyId: string): Promise<SyncOutcome> {
  const { data: company, error } = await supabase
    .from('companies')
    .select(COMPANY_WITH_PROFILE)
    .eq('id', companyId)
    .single();

  if (error || !company) throw new Error(`Company ${companyId} not found`);

  const ctx = buildContextFromRow(company);
  const evaluations = evaluateAll(ctx as any);
  const now = today();
  const generated = generateCalendar(ctx, {
    from: addDays(now, -LOOKBACK_DAYS),
    to: addDays(now, LOOKAHEAD_DAYS),
  });

  let created = 0;
  let updated = 0;

  for (const item of generated.items) {
    const derived = deriveStatus(item.dueDate, null);

    const { data: existing } = await supabase
      .from('compliance_items')
      .select('id, status, completedAt')
      .eq('companyId', companyId)
      .eq('ruleCode', item.ruleCode)
      .eq('periodKey', item.periodKey)
      .maybeSingle();

    if (existing) {
      // Work somebody already finished is never reopened by a regeneration.
      const status =
        existing.status === 'COMPLETED' || existing.status === 'WAIVED' ? existing.status : derived;
      await supabase
        .from('compliance_items')
        .update({ status, dueDate: item.dueDate })
        .eq('id', existing.id);
      updated += 1;
    } else {
      await supabase.from('compliance_items').insert({
        companyId,
        ruleCode: item.ruleCode,
        title: item.title,
        authority: item.authority,
        category: item.category,
        form: item.form,
        legalReference: item.legalReference,
        severity: item.severity,
        periodKey: item.periodKey,
        periodLabel: item.periodLabel,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        dueDate: item.dueDate,
        status: derived,
        penaltyNote: item.penaltyNote,
        evidenceRequired: item.evidenceRequired,
        evidenceLevel: item.evidenceLevel,
      });
      created += 1;
    }
  }

  return {
    synced: true,
    generatedItems: generated.items.length,
    created,
    updated,
    applicableRules: evaluations.filter((e: any) => e.applicable).length,
    inapplicableRules: evaluations.filter((e: any) => !e.applicable).length,
  };
}

/**
 * Regenerate after a profile change, without letting a sync failure fail the
 * write that triggered it.
 *
 * The registration itself is saved by the time this runs; if regeneration
 * fails, the right outcome is a saved registration and a stale calendar that
 * the next explicit sync or nightly job repairs — not a 500 that makes the user
 * think their Udyam number was rejected.
 */
export async function resyncAfterProfileChange(supabase: any, companyId: string): Promise<SyncOutcome | null> {
  try {
    return await syncCompanyCalendar(supabase, companyId);
  } catch (err) {
    console.error('[sync] could not regenerate the calendar after a profile change', companyId, err);
    return null;
  }
}
