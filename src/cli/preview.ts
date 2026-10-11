// Headless preview of a stored episode: prints the transcript the viewer would see.
//   npm run preview -- --show <id> --ep 3 [--quiet]
// The transcript is also written to sessions/<id>/ep-NNN.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirs } from '../../server/sessions';
import { Director } from '../choreo/director';
import { Stage, TICK } from '../engine/stage';
import { CAST } from '../world/cast';
import { episodeInSeason, episodeLabel, seasonOf } from '../world/season';
import { applyEpisode } from '../world/apply';
import { clock, transcriptLine } from '../view/transcript';
import { replayStored } from './replay';

const args = process.argv.slice(2);
const arg = (f: string) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = arg('show');
const n = Number(arg('ep') ?? 1);
if (!id) {
  console.error('usage: npm run preview -- --show <id> --ep N');
  process.exit(1);
}
const stored = replayStored(id, n);
if (!stored || stored.series.episode < n) {
  console.error(`episode ${n} of "${id}" is not stored`);
  process.exit(1);
}
const ep = stored.episodes[n - 1];
const after = stored.series;
const before = replayStored(id, n - 1)!.series;

const stage = new Stage(after.seed + n, CAST, ep, after.roster, after);
const lines: string[] = [];
stage.on((e) => {
  const l = transcriptLine(stage, e);
  if (l === null) return;
  lines.push(l);
  if (!args.includes('--quiet')) console.log(l);
});
const task = stage.spawn(new Director(stage, ep, after.roster, episodeLabel(after, n)).play());
while (!task.done && stage.time < 3600) stage.update(TICK);

const beats = ep.scenes.flatMap((s) => s.beats);
const count = (t: string) => beats.filter((b) => b.type === t).length;
console.error(`\n[preview] "${ep.title}" — ${ep.logline}`);
console.error(`[preview] S${seasonOf(n)}E${episodeInSeason(n)}: ${ep.scenes.length} scenes, ${beats.length} beats (${count('say')} lines, ${count('talking_head')} talking heads, ${count('react')} reactions, ${count('move') + count('enter') + count('exit') + count('gather')} blocking), ran ${clock(stage.time)} of show time (finished: ${task.done})`);
console.error(`[preview] extras: ${after.extras.map((x) => `${x.name} (${x.glyph})`).join(', ') || 'none'}; state after: ${applyEpisode(before, ep).episode === after.episode ? 'consistent' : 'MISMATCH'}`);
mkdirSync(join(dirs().sessions, id), { recursive: true });
writeFileSync(join(dirs().sessions, id, `ep-${String(n).padStart(3, '0')}.md`), lines.join('\n') + '\n');
