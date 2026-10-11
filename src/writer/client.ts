// How the page gets its show. Episodes come from, in order:
//   1. the library (stored episodes, served by the dev server or GitHub Pages; free),
//   2. the writer server (LLM; new episodes are saved, extending the stored series).
// When neither has the episode the show stops and says why.
import type { Episode } from '../schema/episode';
import { SETS } from '../sets/index.ts';
import { type Series } from '../world/state';
import { reviewEpisode } from './validate';

export type Source = 'llm' | 'stored';

/** Why an episode or series couldn't be produced. */
export interface Unavailable {
  /** offline: no writer server; no-llm: server without an API key; error: the LLM failed. */
  reason: 'offline' | 'no-llm' | 'error';
  message: string;
}

export interface Health { llm: boolean; model: string; planModel: string }

export interface LibraryEntry {
  id: string;
  seed: number;
  source: 'sessions' | 'library';
  name: string;
  direction: string;
  episodes: number;
  updated: number;
}

const sourceOf = (s: unknown): Source => (s === 'cache' ? 'stored' : 'llm');
const OFFLINE_REASON: Unavailable = { reason: 'offline', message: 'not connected to a writer server' };
const pad = (n: number) => String(n).padStart(3, '0');
/** Stored series live next to the page (dev server middleware, or static files on GitHub Pages). */
const LIBRARY = `${import.meta.env.BASE_URL}library`;
// A season premiere writes the season bible first (two calls).
const TIMEOUT_MS = 300_000;
/** Dev aid: `?offline=1` never calls the writer server (no API spend). */
const OFFLINE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('offline');

async function unavailable(res: Response): Promise<Unavailable> {
  const body = await res.json().catch(() => null);
  if (body?.error === 'no-llm') return { reason: 'no-llm', message: body.message ?? 'no API key on the writer server' };
  if (body?.error) return { reason: 'error', message: body.message ?? 'the writer failed' };
  return OFFLINE_REASON;
}

async function getJson<T>(url: string, timeout = 5000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Is the writer server up, and does it have an LLM? null = server unreachable. */
export async function fetchHealth(): Promise<Health | null> {
  if (OFFLINE) return null;
  return getJson<Health>('/api/health', 3000);
}

export async function fetchLibrary(): Promise<LibraryEntry[]> {
  return (await getJson<LibraryEntry[]>(`${LIBRARY}/index.json`)) ?? [];
}

export async function fetchStoredSeries(id: string): Promise<Series | null> {
  const s = await getJson<Series>(`${LIBRARY}/${encodeURIComponent(id)}/series.json`);
  return s?.version === 1 ? { ...s, id } : null;
}

/** One stored episode, as stored (callers review it against the series state it follows). */
export const fetchStoredEpisode = (id: string, n: number) => getJson<unknown>(`${LIBRARY}/${encodeURIComponent(id)}/ep-${pad(n)}.json`);

/** The next episode for this series state: stored first, then the LLM. */
export async function fetchEpisode(series: Series): Promise<{ episode: Episode; source: Source } | ({ episode: null } & Unavailable)> {
  // Re-check everything on the client: the page must never play what it can't stage.
  const stored = await fetchStoredEpisode(series.id, series.episode + 1);
  if (stored) {
    const review = reviewEpisode(series, stored, SETS);
    if (review.episode) return { episode: review.episode, source: 'stored' };
  }
  if (OFFLINE) return { episode: null, ...OFFLINE_REASON };
  try {
    const res = await fetch('/api/episode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ series }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { episode: null, ...(await unavailable(res)) };
    const body = await res.json();
    const review = reviewEpisode(series, body.episode, SETS);
    if (review.episode) return { episode: review.episode, source: sourceOf(body.source) };
    return { episode: null, reason: 'error', message: 'the writer sent an unplayable episode' };
  } catch {
    return { episode: null, ...OFFLINE_REASON };
  }
}

/** Ask the writer server to create a new series (needs the LLM; writes the season-1 bible). */
export async function fetchNewSeries(direction: string, seed: number, name = ''): Promise<{ series: Series } | ({ series: null } & Unavailable)> {
  if (OFFLINE) return { series: null, ...OFFLINE_REASON };
  try {
    const res = await fetch('/api/series', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction, seed, name }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { series: null, ...(await unavailable(res)) };
    const body = await res.json();
    if (body.series?.version === 1) return { series: body.series };
    return { series: null, reason: 'error', message: 'the writer sent an unusable series' };
  } catch {
    return { series: null, ...OFFLINE_REASON };
  }
}
