/**
 * The regulatory watch itself.
 *
 * Two passes, for the reasons set out in lib/claude.ts:
 *
 *   1. Research — Claude reads mca.gov.in and the other statutory sites and
 *      writes up what it found, in prose, with links.
 *   2. Extraction — that write-up is turned into rows, against a fixed schema
 *      and the engine's own predicate vocabulary.
 *
 * What the model is *not* allowed to do is the important part. It cannot write
 * code, it cannot name a predicate that does not exist, it cannot cite a source
 * outside the allow-list, and nothing it produces reaches a company's calendar
 * without a human approving it. Its job is to read a great deal of dull
 * government prose carefully and hand a reviewer a short, sourced list.
 */
import { allRules } from '../../engine/catalog';
import { describePredicates } from '../../engine/predicates';
import { env } from '../../config/env';
import { ALLOWED_DOMAINS, extract, research, type ClaudeUsage } from '../../lib/claude';
import { logger } from '../../lib/logger';
import type { ComplianceRule } from '../../engine/types';
import {
  FINDINGS_JSON_SCHEMA,
  modelFindingsSchema,
  type ModelFindings,
} from './regulatory.schemas';

/**
 * The company dimensions the engine can actually reason about.
 *
 * Handed to the model so it knows which changes are worth surfacing: a circular
 * that turns on something the toolkit does not model is noise, however
 * important it is in the abstract.
 */
const TRACKED_DIMENSIONS = `
- Constitution: private limited, public limited, OPC, LLP, partnership, proprietorship, Section 8, unregistered
- Annual turnover (INR) and paid-up share capital (INR)
- Employee headcount — the 10 and 20 thresholds that drive ESI and EPF matter most
- GST: whether registered, how many GSTINs, filing scheme (monthly / QRMP / composition), TDS deductor, e-commerce operator
- MSME: Udyam registration and category (micro / small / medium), and whether the company buys from MSME suppliers
- DPIIT: Startup India recognition number and the date of recognition
- Labour enrolments: EPFO establishment code (PF), ESIC employer code (ESI), professional tax, shops and establishments
- Income tax: TAN, tax-audit threshold, transfer pricing exposure
- Other: date of incorporation, state code, listed status, acceptance of deposits, AGM date
`.trim();

/** A compact index of the catalog, so proposals name real rule codes. */
function catalogIndex(rules: ComplianceRule[]): string {
  return rules
    .map((r) => {
      const form = r.form ? ` [${r.form}]` : '';
      return `${r.code} | ${r.authority} | ${r.periodKind}${form} | ${r.title} | ${r.legalReference}`;
    })
    .join('\n');
}

/**
 * The research system prompt.
 *
 * Stable across runs and therefore cached — the lookback window and the date go
 * in the user message, never here.
 */
const RESEARCH_SYSTEM = `
You track Indian statutory compliance for a toolkit that maintains filing calendars for Indian entities — private limited companies above all, and also LLPs, OPCs, Section 8 companies and unregistered businesses.

Your job each run is to find what the statutory authorities have actually published in a given window, and report it. You are a reader of primary sources, not a commentator.

Rules you work under:

1. Primary sources only. Use web_search and web_fetch, and cite only these domains: ${ALLOWED_DOMAINS.join(', ')}. A summary on a consultancy or news site is not a source, however confident it sounds. If you cannot find the document itself on an official domain, say so and move on.
2. Report what the document says, not what it is reported to say. Where a due date, threshold or applicability changes, quote the operative sentence.
3. Distinguish carefully between: an extension (the deadline moves), a waiver (the filing is not required), a threshold change (who it applies to moves), and a new form or rule. These have different consequences and are routinely confused in secondary reporting.
4. Say when you are unsure. An honest "the circular is ambiguous about whether this covers OPCs" is far more useful than a confident guess — a wrong deadline in a compliance calendar is worse than a missing one.
5. Do not pad. If nothing relevant was published in the window, say that plainly. A quiet fortnight at the MCA is the normal case, not a failure of the search.

The toolkit models these company attributes, and only these. A change that turns on something not in this list cannot be applied, so note it as out of scope rather than working it up:

${TRACKED_DIMENSIONS}
`.trim();

function researchPrompt(opts: { since: string; until: string; authorities: string[] }): string {
  return `
Find every circular, notification, amendment rule, order or press release issued between ${opts.since} and ${opts.until} by: ${opts.authorities.join(', ')}.

Work through the authorities in turn. For the MCA, check the circulars and notifications listings rather than relying on search alone — the listings are authoritative and dated.

Report only documents that change a statutory obligation for one of the entity types above: a due date, a threshold, who must file, what evidence is required, a penalty, or a form. Skip appointments, tenders, speeches and internal administrative orders.

For each document you report, give:
- the issuing authority and the document's own reference number
- its title, its date, and a direct link on the issuing authority's domain
- what it changes, quoting the operative sentence
- which entities it reaches, in terms of the attributes listed above
- anything ambiguous or conditional about it

If nothing qualifying was published in the window, say so and stop. Do not lower the bar to fill the report.
`.trim();
}

/** The extraction system prompt — large, identical every run, and cached. */
function extractionSystem(): string {
  return `
You convert a research write-up about Indian statutory changes into structured change proposals against an existing rule engine.

You are not researching. Use only what the write-up contains; if it does not establish something, do not supply it.

## The rule catalog

Each line is: CODE | AUTHORITY | PERIOD | [FORM] | TITLE | LEGAL REFERENCE.
Every proposal must name one of these codes, except a NEW_RULE proposal, which names none.

${catalogIndex(allRules)}

## How a change is expressed

The engine's rules are code and cannot be rewritten from here. A change is expressed as an overlay *patch* — data only — with these fields, all optional:

Narrative: title, description, penalty, legalReference, category, form, severity (CRITICAL|HIGH|MEDIUM|LOW)
Evidence: evidenceLevel (REQUIRED|ATTEST|NONE), evidenceRequired (array of strings), signatoryRequired (boolean)
Scheduling:
  - dueDateShiftDays (integer, -365..365) — moves every due date. The ordinary shape of an extension.
  - dueDateOverrides ({ "periodKey": "YYYY-MM-DD" }) — replaces named periods outright. Use when a circular names one year.
  - suspendedFrom / suspendedTo ("YYYY-MM-DD") — waives obligations falling due in the window. A waiver, not an extension.
Applicability:
  - addApplicableWhen: [{ predicate, args }] — extra conditions that must all hold
  - addExcludeWhen: [{ predicate, args }] — carve-outs; any one holding switches the rule off
  - removeConditionLabels: ["exact existing label"] — drops a condition
Lifecycle: withdrawn (boolean), withdrawnReason (string)

A threshold change is a removal plus an addition: drop the old condition by its exact label, add the new one with the new figure.

## The predicate vocabulary

These are the only predicates that exist. Naming one that is not here is the most common way to produce an unusable proposal.

${describePredicates()}

Arguments are passed as \`args\`: a bare value for single-argument predicates (\`{"predicate":"turnoverAtLeast","args":50000000}\`), an array for variadic ones (\`{"predicate":"entityIs","args":["PRIVATE_LIMITED"]}\`), an object where named (\`{"predicate":"turnoverBetween","args":{"min":10000000,"max":50000000}}\`), and omitted for predicates taking none.

Rupee amounts are whole rupees: ₹5 crore is 50000000, ₹20 lakh is 2000000.

## Setting expressibleAsOverlay

Set it false — and leave patch null — when the change needs anything the vocabulary above cannot say: a new rule, a new filing frequency or schedule shape, a predicate that does not exist, or a condition that depends on data the toolkit does not hold. This is not a failure. A correctly flagged CODE_CHANGE_REQUIRED proposal is worth more than a patch that approximates the change and quietly gets it wrong.

## Confidence

Report your actual confidence. Use above 0.8 only when the write-up quotes the operative sentence and the mapping to a rule code is unambiguous. Use below 0.5 when you are inferring the affected rule, the effective date, or the scope. A reviewer reads this number to decide how hard to look; inflating it makes it useless.

Return only documents that change an obligation. An informational document may be returned with an empty proposals array if it is worth a reviewer's attention; otherwise omit it.
`.trim();
}

export interface WatchRunInput {
  since: Date;
  until: Date;
  authorities: string[];
}

export interface WatchRunOutput {
  findings: ModelFindings;
  researchText: string;
  sources: string[];
  usage: { research: ClaudeUsage; extraction: ClaudeUsage };
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Run both passes. Throws if Claude is not configured — callers gate on
 * `env.regulatoryWatchEnabled` first.
 */
export async function runWatch(input: WatchRunInput): Promise<WatchRunOutput> {
  const since = iso(input.since);
  const until = iso(input.until);

  logger.info({ since, until, authorities: input.authorities }, 'regulatory watch: research pass starting');

  const researched = await research({
    system: RESEARCH_SYSTEM,
    prompt: researchPrompt({ since, until, authorities: input.authorities }),
    maxSearches: 4 * input.authorities.length,
    maxFetches: 4 * input.authorities.length,
  });

  if (!researched.text) {
    logger.warn('regulatory watch: research pass returned no text');
    return {
      findings: { updates: [] },
      researchText: '',
      sources: researched.sources,
      usage: { research: researched.usage, extraction: emptyUsage() },
    };
  }

  const extracted = await extract<unknown>({
    system: extractionSystem(),
    prompt: `Research write-up covering ${since} to ${until}:\n\n${researched.text}`,
    schema: FINDINGS_JSON_SCHEMA,
  });

  // Structured output fixes the shape; this decides whether the contents are
  // acceptable. A schema-valid object with a 3.0 confidence still gets rejected.
  const parsed = modelFindingsSchema.safeParse(extracted.data);
  if (!parsed.success) {
    throw new Error(
      `Regulatory extraction did not match the expected contract: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  logger.info(
    { updates: parsed.data.updates.length, model: env.ANTHROPIC_MODEL },
    'regulatory watch: extraction pass complete',
  );

  return {
    findings: parsed.data,
    researchText: researched.text,
    sources: researched.sources,
    usage: { research: researched.usage, extraction: extracted.usage },
  };
}

const emptyUsage = (): ClaudeUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});
