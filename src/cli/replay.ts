// Shared by the CLI tools: rebuild a stored series' state from its files (free, no API).
import { loadEpisode, loadSeries } from '../../server/sessions';
import type { Episode } from '../schema/episode';
import { applyEpisode } from '../world/apply';
import type { Series } from '../world/state';
import { loadSets } from '../writer/prompt';
import { reviewEpisode } from '../writer/validate';

/** The stored series with its stored episodes applied, up to and including episode `upTo` (default: all). */
export function replayStored(id: string, upTo = Infinity): { series: Series; episodes: Episode[] } | null {
  let series = loadSeries(id);
  if (!series) return null;
  const episodes: Episode[] = [];
  while (series.episode < upTo) {
    const raw = loadEpisode(series, series.episode + 1);
    const ep = raw ? reviewEpisode(series, raw, loadSets()).episode : null;
    if (!ep) break;
    episodes.push(ep);
    series = applyEpisode(series, ep);
  }
  return { series, episodes };
}
