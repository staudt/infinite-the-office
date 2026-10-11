// Pure state transitions: a season bible starting, and an episode having aired.
import { distinctColor, farthestColor } from '../engine/colors';
import type { Episode, Extra } from '../schema/episode';
import type { SeasonStart } from '../schema/season';
import { CAST } from './cast';
import { seasonOf } from './season';
import { GAGS_LIMIT, HISTORY_LIMIT, NOTES_LIMIT, PLOTS_LIMIT, type Series, type SeriesExtra } from './state';

const ID = /^[a-z][a-z0-9_]*$/;

/** Give a new recurring character a map letter and color nobody else has. */
export function addExtra(s: Series, x: Extra, since: number): SeriesExtra | null {
  if (!ID.test(x.id) || CAST.some((c) => c.id === x.id) || s.extras.some((e) => e.id === x.id) || !x.name.trim()) return null;
  const taken = new Set([...CAST.map((c) => c.glyph), ...s.extras.map((e) => e.glyph)]);
  const letters = [...x.name.toUpperCase().replace(/[^A-Z]/g, ''), ...x.name.toLowerCase().replace(/[^a-z]/g, ''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];
  const glyph = letters.find((l) => !taken.has(l)) ?? '?';
  const used = [...CAST.filter((c) => s.roster.includes(c.id)).map((c) => c.color), ...s.extras.map((e) => e.color)];
  const color = used.length ? distinctColor(farthestColor(used), used) : '#cfcfcf';
  return { id: x.id, name: x.name.trim(), title: x.title || 'Guest', voice: x.voice, glyph, color, since };
}

const known = (s: Series, id: string) => CAST.some((c) => c.id === id) || s.extras.some((e) => e.id === id);
const upsertRel = (s: Series, a: string, b: string, status: string) => {
  const i = s.relationships.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  if (i >= 0) s.relationships[i] = { a, b, status };
  else s.relationships.push({ a, b, status });
};

/** A new season: the bible's cast, desks, relationships and gags replace last season's. */
export function applySeasonStart(series: Series, ss: SeasonStart): Series {
  const s = structuredClone(series);
  s.bible = ss.bible;
  s.bibleSeason = ss.season;
  s.roster = ss.bible.roster; // provisional: new extras pick colors that differ from the regulars
  for (const x of ss.bible.extras) {
    const e = addExtra(s, x, s.episode + 1);
    if (e) s.extras.push(e);
  }
  s.roster = [...new Set(ss.bible.roster)].filter((id) => known(s, id));
  // New recurring characters are regulars of the season they are created for.
  for (const e of s.extras) if (e.since === s.episode + 1 && !s.roster.includes(e.id)) s.roster.push(e.id);
  s.deskOverrides = Object.fromEntries(ss.bible.deskOverrides.filter((d) => known(s, d.id)).map((d) => [d.id, d.spot]));
  for (const r of ss.bible.relationships) if (known(s, r.a) && known(s, r.b) && r.a !== r.b) upsertRel(s, r.a, r.b, r.status);
  s.gags = [...new Set([...ss.bible.runningGags, ...s.gags])].slice(0, GAGS_LIMIT);
  s.arcProgress = {};
  s.season = seasonOf(s.episode + 1);
  return s;
}

/** The state after `ep` has aired (global episode number series.episode + 1). */
export function applyEpisode(series: Series, ep: Episode): Series {
  let s = ep.seasonStart ? applySeasonStart(series, ep.seasonStart) : structuredClone(series);
  const n = s.episode + 1;
  s.episode = n;
  s.season = seasonOf(n + 1);
  for (const x of ep.extras) {
    const e = addExtra(s, x, n);
    if (e) s.extras.push(e);
  }
  for (const c of ep.stateChanges) {
    if (c.type === 'relationship') {
      if (known(s, c.a) && known(s, c.b) && c.a !== c.b) upsertRel(s, c.a, c.b, c.status);
    } else if (c.type === 'note') s.notes.push({ episode: n, text: c.text });
    else if (c.type === 'gag') {
      if (!s.gags.includes(c.text)) s.gags.push(c.text);
    } else s.arcProgress[c.arc] = c.progress;
  }
  s.notes = s.notes.slice(-NOTES_LIMIT);
  s.gags = s.gags.slice(-GAGS_LIMIT);
  s.storySoFar = ep.storySoFar || s.storySoFar;
  s.history = [...s.history, { episode: n, title: ep.title, logline: ep.logline, sceneRecaps: ep.scenes.map((x) => x.recap).filter(Boolean) }].slice(-HISTORY_LIMIT);
  s.recentPlots = [...s.recentPlots, `${ep.title}: ${ep.logline}`].slice(-PLOTS_LIMIT);
  return s;
}
