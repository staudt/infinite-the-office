// On-disk store of everything the LLM wrote, so nothing is paid for twice.
//   sessions/<series id>/series.json   the series as created (state before episode 1, with the season-1 bible)
//   sessions/<series id>/ep-001.json   each written episode (a season's first one carries its bible)
//   sessions/failures/*.json           raw tool input that needed repairs (for prompt tuning)
//   library/<series id>/...            curated series committed to the repo (same layout)
// An episode is keyed by (series, episode number), which fully determines the state it
// was written against, so a stored episode can always be replayed safely.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Episode } from '../src/schema/episode.ts';
import { type LibraryEntry, slugId, type Series } from '../src/world/state.ts';

// Read lazily so tests (and callers that load .env late) can point them elsewhere.
const sessionsDir = () => process.env.SESSIONS_DIR || 'sessions';
const libraryDir = () => process.env.LIBRARY_DIR || 'library';
/** Where stored series are read from; new material is always written to sessions. */
const roots = () => [sessionsDir(), libraryDir()];
const pad = (n: number) => String(n).padStart(3, '0');

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, data: unknown): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[sessions] could not write ${path}: ${(err as Error).message}`);
  }
}

/** Series folders: a slug like "the-office" or "the-office-2". */
export const SERIES_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Read a stored file for a series, from sessions first, then the committed library. */
export function readStored(id: string, file: string): unknown {
  if (!SERIES_ID.test(id) || !/^(series|ep-\d{3})\.json$/.test(file)) return null;
  for (const root of roots()) {
    const v = readJson<unknown>(join(root, id, file));
    if (v) return v;
  }
  return null;
}

/** A free id for a new series, from its name: "my-office", or "my-office-2" if that one is taken. */
export function newSeriesId(name: string, seed: number): string {
  const base = slugId(name) || String(seed >>> 0);
  const taken = (id: string) => roots().some((root) => existsSync(join(root, id)));
  let id = base;
  for (let i = 2; taken(id); i++) id = `${base}-${i}`;
  return id;
}

export const saveSeries = (s: Series) => writeJson(join(sessionsDir(), s.id, 'series.json'), s);
export const loadSeries = (id: string) => readStored(id, 'series.json') as Series | null;
export const saveEpisode = (s: Series, n: number, ep: Episode) => writeJson(join(sessionsDir(), s.id, `ep-${pad(n)}.json`), ep);
export const loadEpisode = (s: Pick<Series, 'id'>, n: number) => readStored(s.id, `ep-${pad(n)}.json`) as Episode | null;

/** Stored episodes for a series: the length of the unbroken run from episode 1. */
function episodeCount(id: string): number {
  let n = 0;
  while (readStored(id, `ep-${pad(n + 1)}.json`)) n++;
  return n;
}

/** Every stored series, newest first (one in both places is listed once, as library). */
export function listLibrary(): LibraryEntry[] {
  const out = new Map<string, LibraryEntry>();
  for (const root of roots()) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const s = SERIES_ID.test(dir) ? readJson<Series>(join(root, dir, 'series.json')) : null;
      if (s?.version !== 1) continue;
      const prev = out.get(dir);
      out.set(dir, {
        id: dir, seed: s.seed, name: s.name, direction: s.direction, episodes: episodeCount(dir),
        source: prev?.source === 'library' || root === libraryDir() ? 'library' : 'sessions',
        updated: Math.max(statSync(join(root, dir)).mtimeMs, prev?.updated ?? 0),
      });
    }
  }
  return [...out.values()].sort((a, b) => b.updated - a.updated);
}

export function saveFailure(tool: string, input: unknown, problems: string[]): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJson(join(sessionsDir(), 'failures', `${stamp}-${tool}.json`), { problems, input });
}

export const dirs = () => ({ sessions: sessionsDir(), library: libraryDir() });

/** The committed library as static files (for the GitHub Pages build): index.json + each series' files. */
export function exportLibrary(): { path: string; content: string }[] {
  const lib = libraryDir();
  if (!existsSync(lib)) return [{ path: 'library/index.json', content: '[]' }];
  const files: { path: string; content: string }[] = [];
  const entries: LibraryEntry[] = [];
  for (const dir of readdirSync(lib)) {
    const s = SERIES_ID.test(dir) ? readJson<Series>(join(lib, dir, 'series.json')) : null;
    if (s?.version !== 1) continue;
    const eps = readdirSync(join(lib, dir)).filter((f) => /^ep-\d{3}\.json$/.test(f)).sort();
    for (const f of ['series.json', ...eps]) files.push({ path: `library/${dir}/${f}`, content: readFileSync(join(lib, dir, f), 'utf8') });
    entries.push({ id: dir, seed: s.seed, source: 'library', name: s.name, direction: s.direction, episodes: eps.length, updated: statSync(join(lib, dir)).mtimeMs });
  }
  files.push({ path: 'library/index.json', content: JSON.stringify(entries) });
  return files;
}
