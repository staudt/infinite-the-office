// Import a hand-written season (no API): a bible plus episode drafts, run through the same
// review and state replay as the LLM path, saved as a stored series.
//   npm run import -- --dir <drafts> [--out library]
// <drafts>/bible.json is { "name", "direction", "seed"?, "bible": SeasonBible }; episodes are
// ep-01.json, ep-02.json... in the write_episode shape (flat `beats` with scene markers).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyEpisode, applySeasonStart } from '../world/apply';
import { newSeries, randomSeed, slugId } from '../world/state';
import { loadSets } from '../writer/prompt';
import { reviewBible, reviewEpisode } from '../writer/validate';
import { arg } from './args';

const dir = arg('dir');
if (!dir || !existsSync(join(dir, 'bible.json'))) {
  console.error('usage: npm run import -- --dir <drafts with bible.json and ep-NN.json> [--out library|sessions]');
  process.exit(1);
}
const sets = loadSets();
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const head = read('bible.json');
const blank = newSeries(head.name, head.direction ?? '', head.seed ?? randomSeed(), slugId(head.name));
const b = reviewBible(blank, head.bible, sets);
for (const p of b.problems) console.error(`[import] bible: ${p}`);
if (!b.bible) process.exit(1);

let series = applySeasonStart(blank, { season: 1, bible: b.bible });
const out = join(arg('out') ?? 'library', series.id);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'series.json'), JSON.stringify(series, null, 2));

const files = readdirSync(dir).filter((f) => /^ep-\d+\.json$/.test(f)).sort();
for (const f of files) {
  const n = series.episode + 1;
  const r = reviewEpisode(series, read(f), sets);
  for (const p of r.problems) console.error(`[import] ${f}: ${p}`);
  if (!r.episode) {
    console.error(`[import] ${f} is unplayable, stopping`);
    break;
  }
  writeFileSync(join(out, `ep-${String(n).padStart(3, '0')}.json`), JSON.stringify(r.episode, null, 2));
  series = applyEpisode(series, r.episode);
  const beats = r.episode.scenes.reduce((k, s) => k + s.beats.length, 0);
  console.error(`[import] ep ${n} "${r.episode.title}": ${r.episode.scenes.length} scenes, ${beats} beats`);
}
console.error(`[import] wrote ${series.episode} episodes to ${out}/`);
