// The season calendar: 12-episode seasons (data/writer/tentpoles.json), global episode
// numbers (1, 2, 3...) mapped onto it.
import tentpoles from '../../data/writer/tentpoles.json';
import type { SeasonBible } from '../schema/season';
import type { Series } from './state';

export const SEASON_LENGTH: number = tentpoles.seasonLength;
export const TENTPOLES = tentpoles.tentpoles as { id: string; name: string; hint: string }[];

/** Season number (1-based) of global episode `n`. */
export const seasonOf = (n: number) => Math.floor((n - 1) / SEASON_LENGTH) + 1;
/** Position of global episode `n` within its season (1..SEASON_LENGTH). */
export const episodeInSeason = (n: number) => ((n - 1) % SEASON_LENGTH) + 1;
export const isFinale = (n: number) => episodeInSeason(n) === SEASON_LENGTH;
export const isSeasonStart = (n: number) => episodeInSeason(n) === 1;

/** Does airing the next episode need a new season bible first? */
export const needsBible = (s: Pick<Series, 'episode' | 'bibleSeason'>) => s.bibleSeason < seasonOf(s.episode + 1);

/** The tentpole the bible schedules for global episode `n`, if any. */
export function tentpoleFor(bible: SeasonBible | null, n: number) {
  const t = bible?.tentpoles.find((x) => x.episode === episodeInSeason(n));
  return t ? { ...t, name: TENTPOLES.find((x) => x.id === t.id)?.name ?? t.id } : null;
}

/** "Season 2 · Episode 4 — The Dundies" (finale and tentpole names when there is one). */
export function episodeLabel(s: Pick<Series, 'bible' | 'bibleSeason'>, n: number): string {
  const t = s.bibleSeason === seasonOf(n) ? tentpoleFor(s.bible, n) : null;
  const special = isFinale(n) ? 'Finale' : t?.name;
  return `Season ${seasonOf(n)} · Episode ${episodeInSeason(n)}${special ? ` — ${special}` : ''}`;
}
