// The series state: everything the writer needs to continue the show. It is a pure
// value: `applyEpisode` (apply.ts) returns the next one, so stored episodes replay it.
import type { SeasonBible } from '../schema/season.ts';

export interface SeriesExtra {
  id: string;
  name: string;
  title: string;
  voice: string;
  /** Assigned once when the character is invented, so they look the same forever. */
  glyph: string;
  color: string;
  since: number;
}

export interface Relationship { a: string; b: string; status: string }
export interface HistoryEntry { episode: number; title: string; logline: string; sceneRecaps: string[] }

export interface Series {
  version: 1;
  /** Storage id (folder name, ?show= link), slug of the name. */
  id: string;
  seed: number;
  name: string;
  /** The viewer's free-text steer for the whole run. */
  direction: string;
  /** Season of the next episode to write. */
  season: number;
  /** Number of the last episode applied (0 = fresh series). */
  episode: number;
  /** Character ids active this season (they sit at their desks in the background). */
  roster: string[];
  /** Character id -> spot name, when someone sits somewhere other than their usual desk. */
  deskOverrides: Record<string, string>;
  extras: SeriesExtra[];
  relationships: Relationship[];
  gags: string[];
  notes: { episode: number; text: string }[];
  /** Arc name -> where it stands now. */
  arcProgress: Record<string, string>;
  storySoFar: string;
  history: HistoryEntry[];
  /** Loglines of recent episodes, fed back to avoid repeating plots. */
  recentPlots: string[];
  /** The bible of `bibleSeason` (null until the first one is written). */
  bible: SeasonBible | null;
  bibleSeason: number;
}

export const HISTORY_LIMIT = 60;
export const NOTES_LIMIT = 20;
export const GAGS_LIMIT = 12;
export const PLOTS_LIMIT = 10;

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

/** "Mid-South Office" -> "mid-south-office": safe for folders, ids and URLs. */
export function slugId(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function newSeries(name: string, direction: string, seed: number, id = slugId(name) || String(seed)): Series {
  return {
    version: 1, id, seed, name: name || 'The Office', direction, season: 1, episode: 0,
    roster: [], deskOverrides: {}, extras: [], relationships: [], gags: [], notes: [], arcProgress: {},
    storySoFar: '', history: [], recentPlots: [], bible: null, bibleSeason: 0,
  };
}

const KEY = 'infinite-office.series';
export function loadSeriesFromStorage(): Series | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s?.version === 1 ? s : null;
  } catch {
    return null;
  }
}
export function saveSeriesToStorage(s: Series): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or unavailable: the show still plays, it just won't resume
  }
}
