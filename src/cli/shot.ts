// Still frames of a moment in an episode, for checking positioning, paths and sizing.
//
//   npm run shot -- --show <id|name> --ep 3 [--scene 2] [--at 4] [--every 2 --count 5] [--cam all] [--grid]
//   npm run shot -- --demo [--scene 1] ...
//   options: --at SEC (show time after the scene starts, or after the episode starts; default 3)
//            --every SEC --count K (K frames SEC apart, starting at --at)  --format horizontal|vertical
//            --cam all (frame the whole set)  --grid (logic-grid overlay)  --out shots
// The show is stepped in 1/30 s frames like the video render, so a frame is exactly what the MP4 shows.
// Prints the absolute path of every PNG written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listLibrary } from '../../server/sessions';
import { findShow } from '../world/state';
import { arg, has } from './args';
import { failer, FORMATS, type FormatName, openRender, startSession } from './browser';

const fail: (msg: string) => never = failer('shot');
const num = (f: string, d: number) => (arg(f) === undefined ? d : Number(arg(f)));

const formatName = (arg('format') ?? 'horizontal') as FormatName;
if (!FORMATS[formatName]) fail('--format is horizontal or vertical');
const outDir = arg('out') ?? 'shots';
const scene = num('scene', 0);
const at = num('at', 3), every = num('every', 0), count = every ? num('count', 1) : 1;
if (![at, every, count, scene].every(Number.isFinite) || at < 0 || count < 1) fail('--at, --every, --count and --scene must be numbers');

const params = new URLSearchParams();
let base: string;
if (has('demo')) {
  params.set('demo', '1');
  base = 'demo';
} else {
  const showArg = arg('show') ?? fail('missing --show <id | name> (or --demo)');
  const show = findShow(listLibrary(), showArg) ?? fail(`no stored show matches "${showArg}"`);
  const ep = num('ep', 0);
  if (!(ep >= 1 && ep <= show.episodes)) fail(`pass --ep 1..${show.episodes} ("${show.name}")`);
  params.set('show', show.id);
  params.set('ep', String(ep));
  base = `${show.id}-e${String(ep).padStart(2, '0')}`;
}
if (scene) params.set('scene', String(scene));
if (arg('cam')) params.set('cam', arg('cam')!);
if (has('grid')) params.set('grid', '1');
base += scene ? `-s${scene}` : '';

mkdirSync(outDir, { recursive: true });
const session = await startSession('shot');
try {
  const rp = await openRender(session, 'shot', formatName, params);
  let t = 0; // seconds advanced since the start point
  for (let i = 0; i < count; i++) {
    const want = at + i * every;
    if (want > t) await rp.call((r, s) => r.advance(s), want - t);
    else await rp.call((r) => r.step(1 / 30)); // draw the first frame (nothing has rendered yet)
    t = want;
    const file = resolve(join(outDir, `${base}-t${want.toFixed(1).padStart(5, '0')}.png`));
    writeFileSync(file, await rp.capture('png'));
    console.log(file);
  }
  await rp.page.close();
} finally {
  await session.close();
}
