/**
 * Claude access for the toolkit.
 *
 * One client, constructed lazily, so a deployment without `ANTHROPIC_API_KEY`
 * boots and runs exactly as it did before — the SDK is never touched and the
 * process never holds a connection it has no key for.
 *
 * Two shapes are exposed, because the regulatory watcher needs both and they
 * have opposite requirements:
 *
 *   research()  — server-side web search and fetch, restricted to the domains
 *                 in ALLOWED_DOMAINS. Streams, because a run that reads a dozen
 *                 circulars is measured in minutes and a buffered request would
 *                 hit the HTTP timeout.
 *   extract()   — no tools, a strict JSON schema, and a stable cached prefix.
 *                 Turns the research prose into rows this codebase can store.
 *
 * Splitting them is what keeps the expensive half cheap: the extraction prompt
 * carries the whole predicate vocabulary and rule index, which is large,
 * identical on every run, and therefore cached.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Where the watcher is allowed to look. Statutory sources only — a compliance
 * calendar must not be moved by a summary on a consultancy blog, however
 * confident it sounds.
 *
 * Order is fixed: this list is rendered into the cached prompt prefix, and
 * reordering it would invalidate the cache on every run.
 */
export const ALLOWED_DOMAINS: string[] = [
  'mca.gov.in',
  'egazette.gov.in',
  'incometax.gov.in',
  'incometaxindia.gov.in',
  'cbic.gov.in',
  'cbic-gst.gov.in',
  'gst.gov.in',
  'msme.gov.in',
  'udyamregistration.gov.in',
  'startupindia.gov.in',
  'dpiit.gov.in',
  'epfindia.gov.in',
  'esic.gov.in',
  'labour.gov.in',
  'pib.gov.in',
];

export class ClaudeUnavailableError extends Error {
  constructor() {
    super('Claude is not configured. Set ANTHROPIC_API_KEY to enable the regulatory watch.');
    this.name = 'ClaudeUnavailableError';
  }
}

let client: Anthropic | null = null;

export function claudeAvailable(): boolean {
  return env.claudeEnabled;
}

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new ClaudeUnavailableError();
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
  return client;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const readUsage = (usage: Anthropic.Usage): ClaudeUsage => ({
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
});

/** Concatenate the text blocks of a response, ignoring thinking and tool blocks. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * A refusal or a truncation is not a usable answer, and treating either as one
 * is how a half-read circular ends up as a proposal. Both fail loudly instead.
 */
function assertUsable(message: Anthropic.Message, phase: string): void {
  if (message.stop_reason === 'refusal') {
    const detail = message.stop_details?.explanation ?? message.stop_details?.category ?? 'no explanation given';
    throw new Error(`Claude declined the ${phase} request: ${detail}`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`Claude hit max_tokens during the ${phase} request — the response is truncated and unusable.`);
  }
}

export interface ResearchOptions {
  system: string;
  prompt: string;
  /** Ceiling on server-side searches. Each one costs money and time. */
  maxSearches?: number;
  maxFetches?: number;
  maxTokens?: number;
}

export interface ResearchResult {
  text: string;
  usage: ClaudeUsage;
  /** Every URL the model actually fetched or hit in search, for the audit trail. */
  sources: string[];
}

/**
 * The research pass: let Claude read the statutory sites and report what it
 * found, in prose. Deliberately unstructured — forcing a schema here would make
 * the model commit to a shape while it is still reading.
 */
export async function research(opts: ResearchOptions): Promise<ResearchResult> {
  const anthropic = getClient();

  const stream = anthropic.messages.stream({
    model: env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 32_000,
    thinking: { type: 'adaptive' },
    output_config: { effort: env.ANTHROPIC_EFFORT },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: opts.maxSearches ?? 12,
        allowed_domains: ALLOWED_DOMAINS,
      },
      {
        type: 'web_fetch_20260209',
        name: 'web_fetch',
        max_uses: opts.maxFetches ?? 12,
        allowed_domains: ALLOWED_DOMAINS,
        max_content_tokens: 20_000,
      },
    ],
    messages: [{ role: 'user', content: opts.prompt }],
  });

  const message = await stream.finalMessage();
  assertUsable(message, 'research');

  const usage = readUsage(message.usage);
  logger.info({ ...usage, model: env.ANTHROPIC_MODEL }, 'regulatory research pass complete');

  return { text: textOf(message), usage, sources: collectSources(message) };
}

/**
 * Pull the URLs out of the server-tool result blocks.
 *
 * Server tools return their errors as *content*, not as thrown exceptions — a
 * blocked domain or an exhausted `max_uses` arrives as an object where a list
 * was expected. Hence the shape check before iterating.
 */
function collectSources(message: Anthropic.Message): string[] {
  const urls = new Set<string>();

  for (const block of message.content) {
    if (block.type === 'web_search_tool_result') {
      const content = block.content as unknown;
      if (!Array.isArray(content)) continue;
      for (const result of content) {
        const url = (result as { url?: unknown }).url;
        if (typeof url === 'string') urls.add(url);
      }
    } else if (block.type === 'web_fetch_tool_result') {
      const content = block.content as { url?: unknown } | unknown;
      const url = (content as { url?: unknown })?.url;
      if (typeof url === 'string') urls.add(url);
    }
  }

  return [...urls];
}

export interface ExtractOptions {
  /** Stable across runs — it is the cached prefix. Put volatile content in `prompt`. */
  system: string;
  prompt: string;
  /** JSON Schema. Must be an object schema with `additionalProperties: false`. */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface ExtractResult<T> {
  data: T;
  usage: ClaudeUsage;
}

/**
 * The extraction pass: no tools, a fixed output schema, low effort.
 *
 * The result is returned as parsed JSON and nothing more — the caller validates
 * it against a zod schema before it goes anywhere near the database. Structured
 * output guarantees the *shape*, never the truth of what is in it.
 */
export async function extract<T = unknown>(opts: ExtractOptions): Promise<ExtractResult<T>> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 16_000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: opts.schema },
    },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.prompt }],
  });

  assertUsable(message, 'extraction');

  const text = textOf(message);
  const usage = readUsage(message.usage);

  if (usage.cacheReadTokens === 0 && usage.cacheCreationTokens === 0) {
    // Not fatal, but the extraction prefix is large and identical every run, so
    // a persistent miss means something volatile crept into it.
    logger.debug('regulatory extraction prompt did not cache — check the system prefix for volatile content');
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`Claude returned unparseable JSON during extraction: ${text.slice(0, 500)}`);
  }

  logger.info({ ...usage }, 'regulatory extraction pass complete');
  return { data, usage };
}
