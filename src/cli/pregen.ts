// Pre-generate a series: create it (or pick up a stored one) and write episodes ahead of
// time without airing them. Everything is saved under sessions/, so the series shows up
// in the start screen's "Stored shows" and plays back for free.
//   npm run pregen -- --direction "…" --name "…" --episodes 12     (or --seasons 1)
//   npm run pregen -- --show <id> --episodes 5                     extend a stored series
import { createSeries, llmAvailable, usage, writeEpisode } from '../../server/writer';
import { applyEpisode } from '../world/apply';
import { episodeLabel, SEASON_LENGTH } from '../world/season';
import { randomSeed, type Series } from '../world/state';
import { arg } from './args';
import { replayStored } from './replay';

try {
  process.loadEnvFile();
} catch {
  // no .env file
}


if (!llmAvailable()) {
  console.error('pregen needs ANTHROPIC_API_KEY.');
  process.exit(1);
}

let series: Series;
const showArg = arg('show');
if (showArg) {
  const stored = replayStored(showArg);
  if (!stored) {
    console.error(`no stored series "${showArg}" (see npm run library)`);
    process.exit(1);
  }
  series = stored.series;
  console.error(`[pregen] "${series.name}" (${series.id}): ${series.episode} stored episodes`);
} else {
  const created = await createSeries(arg('direction') ?? '', randomSeed(), arg('name'));
  if (!created.series) {
    console.error(`[pregen] couldn't create a series: ${created.message}`);
    process.exit(1);
  }
  series = created.series;
  console.error(`[pregen] created "${series.name}" (id ${series.id}); season 1: ${series.bible?.theme}`);
}

const count = arg('episodes') ? Number(arg('episodes')) : Number(arg('seasons') ?? 1) * SEASON_LENGTH;
for (let i = 0; i < count; i++) {
  const t0 = Date.now();
  const written = await writeEpisode(series);
  if (!written.episode) {
    console.error(`[pregen] stopping: ${written.message}`);
    break;
  }
  series = applyEpisode(series, written.episode);
  console.error(`[pregen] ${episodeLabel(series, series.episode)}: "${written.episode.title}" (${written.source}, ${Math.round((Date.now() - t0) / 1000)}s)`);
}
console.error(`[pregen] done: "${series.name}" has ${series.episode} stored episodes (id ${series.id})`);
console.error(`[pregen] usage this run: ${usage.calls} calls, ${usage.input} input + ${usage.output} output tokens, about $${usage.cost.toFixed(4)}`);
