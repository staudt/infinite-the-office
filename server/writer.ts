// The AI writer: Sonnet writes a season bible per season, Haiku writes each episode from
// it. Every result is reviewed (repaired or retried once), stored on disk, and returned.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { EpisodeDraft, type Episode } from '../src/schema/episode';
import { SeasonBible, type SeasonStart } from '../src/schema/season';
import { bibleSystemPrompt, bibleUserPrompt, episodeSystemPrompt, episodeUserPrompt, loadSets } from '../src/writer/prompt';
import { reviewBible, reviewEpisode } from '../src/writer/validate';
import { applySeasonStart } from '../src/world/apply';
import { needsBible, seasonOf } from '../src/world/season';
import { newSeries, type Series } from '../src/world/state';
import { loadEpisode, newSeriesId, saveEpisode, saveFailure, saveSeries } from './sessions';

// Read lazily: callers may load .env after importing this module.
export const model = () => process.env.WRITER_MODEL || 'claude-haiku-5-5';
/** The long-term calls (season bibles) are few and benefit from a stronger model. */
export const planModel = () => process.env.WRITER_PLAN_MODEL || 'claude-sonnet-5-5';

export type Source = 'llm' | 'cache';
/** Why nothing could be produced: no LLM configured, or the LLM failed. */
export interface Unavailable { reason: 'no-llm' | 'error'; message: string }
export type Written = { episode: Episode; source: Source; problems: string[] } | ({ episode: null } & Unavailable);
export type Created = { series: Series; source: Source; problems: string[] } | ({ series: null } & Unavailable);

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: 300_000 });
  return client;
}

// $ per million tokens (input, output) for the usage log; cache reads cost a tenth of input.
const PRICES: [RegExp, number, number][] = [[/haiku-5-5/, 0.1, 0.5], [/sonnet-5/, 2, 10], [/haiku/, 1, 5], [/opus/, 5, 25]];
/** Running totals for this process (the CLI prints them at the end). */
export const usage = { calls: 0, input: 0, output: 0, cost: 0 };

function track(m: string, u: Anthropic.Usage): number {
  const [, pin, pout] = PRICES.find(([re]) => re.test(m)) ?? [0, 1, 5];
  const cost = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * pin + u.output_tokens * pout) / 1e6;
  usage.calls++;
  usage.input += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  usage.output += u.output_tokens;
  usage.cost += cost;
  return cost;
}

interface ToolSpec {
  name: string;
  description: string;
  schema: z.ZodType;
  system: () => string;
  /** Model override (defaults to WRITER_MODEL). */
  model?: () => string;
}

/** A plain (non-strict) tool: the schema is guidance, and Zod + our reviewers validate. */
function toolFor(spec: ToolSpec): Anthropic.Tool {
  // io: 'input' marks defaulted fields optional, matching what the lenient parser accepts.
  const { $schema: _drop, ...schema } = z.toJSONSchema(spec.schema, { io: 'input' }) as Record<string, unknown>;
  return { name: spec.name, description: spec.description, input_schema: schema as Anthropic.Tool.InputSchema };
}

async function callTool(spec: ToolSpec, messages: Anthropic.MessageParam[]) {
  const m = (spec.model ?? model)();
  // Streaming, so big outputs don't hit HTTP timeouts. Both writer models think by default
  // and the current ones reject forced tool_choice, so the prompt asks for the tool
  // (tool_choice auto) and a missing call gets one retry.
  const res = await getClient().messages.stream({
    model: m,
    // Thinking takes most of the budget (30-45k tokens per episode on Haiku); both models allow 128k when streaming.
    max_tokens: 128000,
    output_config: { effort: 'medium' },
    // Tools render before the system prompt, so this breakpoint caches schema + instructions.
    system: [{ type: 'text', text: spec.system(), cache_control: { type: 'ephemeral' } }],
    tools: [toolFor(spec)],
    // One call per response: Haiku otherwise splits a long episode across parallel calls.
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages,
  }).finalMessage();
  const u = res.usage;
  console.error(`[writer] ${m} ${spec.name}: in=${u.input_tokens} cache_write=${u.cache_creation_input_tokens ?? 0} ` +
    `cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens} stop=${res.stop_reason} ~$${track(m, u).toFixed(4)}`);
  if (res.stop_reason === 'max_tokens') throw new Error('output was cut off (max_tokens)');
  if (res.stop_reason === 'refusal') throw new Error('model refused');
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === spec.name);
  const toolUseIds = res.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
  return { input: block?.input ?? null, content: res.content, toolUseIds };
}

/**
 * Call and review. Problems the reviewer could repair are accepted as-is (logged for
 * prompt tuning); only an unplayable result pays for one retry, with the problems sent
 * back as a tool error.
 */
export async function callWithRetry<T>(
  spec: ToolSpec,
  prompt: string,
  review: (input: unknown) => { value: T | null; problems: string[] },
): Promise<{ value: T | null; problems: string[] }> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const first = await callTool(spec, messages);
  let result = review(first.input);
  if (!first.input) result = { value: null, problems: [`you must call the ${spec.name} tool`] };
  if (result.problems.length) saveFailure(spec.name, first.input, result.problems);
  if (result.value) {
    if (result.problems.length) console.error(`[writer] repaired ${result.problems.length} problem(s) in ${spec.name}, no retry needed`);
    return result;
  }

  console.error(`[writer] retrying ${spec.name}; problems: ${result.problems.join(' | ')}`);
  messages.push({ role: 'assistant', content: first.content });
  const fix = `That has problems:\n${result.problems.map((p) => `- ${p}`).join('\n')}\nCall ${spec.name} again with the corrected, complete result.`;
  // Every tool_use in the reply needs its tool_result, or the API rejects the retry.
  messages.push({
    role: 'user',
    content: first.toolUseIds.length
      ? first.toolUseIds.map((id) => ({ type: 'tool_result' as const, tool_use_id: id, is_error: true, content: fix }))
      : fix,
  });
  const retry = await callTool(spec, messages);
  const second = review(retry.input);
  if (second.problems.length) saveFailure(`${spec.name}-retry`, retry.input, second.problems);
  // Keep whichever attempt is playable, preferring the retry.
  return second.value || !result.value ? second : result;
}

/** A short, viewer-safe description of an API failure. */
function errorText(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionError) return "can't reach the API";
  if (err instanceof Anthropic.AuthenticationError) return 'API key rejected';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited';
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ''}`.trim();
  return (err as Error).message;
}

function logError(what: string, err: unknown): void {
  if (err instanceof Anthropic.APIConnectionError) console.error(`[writer] ${what}: can't reach the API (${err.message})`);
  else if (err instanceof Anthropic.AuthenticationError) console.error(`[writer] ${what}: authentication failed, check ANTHROPIC_API_KEY`);
  else if (err instanceof Anthropic.RateLimitError) console.error(`[writer] ${what}: rate limited`);
  else if (err instanceof Anthropic.APIError) console.error(`[writer] ${what}: API error ${err.status}: ${err.message}`);
  else console.error(`[writer] ${what}: ${(err as Error).message}`);
}

const EPISODE_TOOL: ToolSpec = {
  name: 'write_episode',
  description: 'Submit the complete episode as one ordered list of beats, with a "scene" marker beat starting each scene.',
  schema: EpisodeDraft,
  system: episodeSystemPrompt,
};

const BIBLE_TOOL: ToolSpec = {
  name: 'plan_season',
  description: 'Submit the season bible: theme, era, cast, arcs, new characters, gags, tentpoles and the finale plan.',
  schema: SeasonBible,
  system: bibleSystemPrompt,
  model: planModel,
};

/** Write the bible for the season the series is about to enter. */
async function writeBible(series: Series): Promise<{ start: SeasonStart | null; problems: string[] }> {
  const season = seasonOf(series.episode + 1);
  const r = await callWithRetry(BIBLE_TOOL, bibleUserPrompt(series), (i) => {
    const rv = reviewBible(series, i, loadSets());
    return { value: rv.bible, problems: rv.problems };
  });
  return { start: r.value ? { season, bible: r.value } : null, problems: r.problems };
}

/**
 * Write the next episode: reuse the stored one for this series and episode number, else
 * ask the LLM (and store the result). A season's first episode first gets a new bible,
 * which is stored inside the episode so replay needs no extra file.
 */
export async function writeEpisode(series: Series): Promise<Written> {
  const number = series.episode + 1;
  const stored = loadEpisode(series, number);
  if (stored) {
    const rv = reviewEpisode(series, stored, loadSets());
    if (rv.episode) return { episode: rv.episode, source: 'cache', problems: [] };
  }
  if (!llmAvailable()) return { episode: null, reason: 'no-llm', message: 'no API key on the writer server' };
  try {
    let base = series;
    let seasonStart: SeasonStart | null = null;
    if (needsBible(series)) {
      const b = await writeBible(series);
      if (!b.start) {
        console.error(`[writer] unusable season bible: ${b.problems.join(' | ')}`);
        return { episode: null, reason: 'error', message: 'the writer produced an unusable season bible' };
      }
      seasonStart = b.start;
      base = applySeasonStart(series, seasonStart);
    }
    const r = await callWithRetry(EPISODE_TOOL, episodeUserPrompt(base), (input) => {
      const rv = reviewEpisode(base, input, loadSets());
      return { value: rv.episode, problems: rv.problems };
    });
    if (!r.value) {
      console.error(`[writer] unusable episode: ${r.problems.join(' | ')}`);
      return { episode: null, reason: 'error', message: 'the writer wrote an unusable episode' };
    }
    const episode = seasonStart ? { ...r.value, seasonStart } : r.value;
    saveEpisode(series, number, episode);
    return { episode, source: 'llm', problems: r.problems };
  } catch (err) {
    logError('write_episode', err);
    return { episode: null, reason: 'error', message: errorText(err) };
  }
}

/** Create a new series: its season-1 bible is written now and the series is saved. */
export async function createSeries(direction: string, seed: number, name = ''): Promise<Created> {
  if (!llmAvailable()) return { series: null, reason: 'no-llm', message: 'no API key on the writer server' };
  try {
    const blank = newSeries(name.trim().slice(0, 60) || 'The Office', direction, seed);
    blank.id = newSeriesId(blank.name, seed);
    const b = await writeBible(blank);
    if (!b.start) {
      console.error(`[writer] unusable season bible: ${b.problems.join(' | ')}`);
      return { series: null, reason: 'error', message: 'the writer produced an unusable season bible' };
    }
    const series = applySeasonStart(blank, b.start);
    saveSeries(series);
    return { series, source: 'llm', problems: b.problems };
  } catch (err) {
    logError('plan_season', err);
    return { series: null, reason: 'error', message: errorText(err) };
  }
}
