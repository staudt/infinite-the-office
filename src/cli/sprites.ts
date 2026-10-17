// Turn AI-generated art in art/raw/ into game-ready sprites in public/sprites/ (see art/sprites.json).
//   npm run sprites
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { type Img, anchorStrip, keyBorder, alphaBox, components, crop, fitMax, keyMagenta, mergeComps, readingOrder, removeSpecks, scaleBy, sharpen, trim } from './sprites/pixels';

interface Sheet {
  file: string; kind: 'props' | 'frames' | 'image' | 'character'; key?: boolean | 'border';
  names?: string[]; gap?: number;
  /** props: rects [x, y, w, h] (output px) to clear per prop, e.g. chairs baked into desk art; the size stays put. */
  erase?: Record<string, [number, number, number, number][]>; minArea?: number; scale?: number; maxWidth?: number; maxHeight?: number; name?: string; box?: [number, number, number, number]; height?: number;
  /** props: unsharp-mask amount for soft (generated) art, applied at the output size. */
  sharpen?: number;
}
const RAW = 'art/raw', OUT = 'public/sprites', DEV = 'art/out';
const sheets: Sheet[] = JSON.parse(readFileSync('art/sprites.json', 'utf8')).sheets;

const load = (f: string): Img => { const p = PNG.sync.read(readFileSync(join(RAW, f))); return { w: p.width, h: p.height, data: new Uint8Array(p.data) }; };
const save = (path: string, im: Img) => { const p = new PNG({ width: im.w, height: im.h }); p.data = Buffer.from(im.data); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, PNG.sync.write(p)); };
const stem = (f: string) => f.replace(/\.png$/, '');

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); mkdirSync(DEV, { recursive: true });
/** The frame order of a character sheet (art/templates/pam-sheet.png), row by row. */
const CHARACTER: [string, number][] = [
  ['walk_front', 5], ['walk_back', 5], ['walk_side', 5],
  ['sit_front', 1], ['sit_back', 1], ['sit_side', 1], ['type_side', 2], ['phone_side', 1],
  ['react_gasp', 1], ['react_laugh', 1], ['react_sad', 1], ['react_facepalm', 1], ['react_look', 1],
];
const index = { props: {} as Record<string, { src: string; w: number; h: number }>, anims: {} as Record<string, unknown>, images: {} as Record<string, unknown> };

for (const s of sheets) {
  const img = load(s.file);
  // key: true for magenta sheets; 'border' for any other flat background color.
  if (s.key) { if (s.key === 'border') keyBorder(img); else keyMagenta(img); removeSpecks(img, s.minArea ?? 150); }
  if (s.kind === 'image') {
    // `box` [x, y, w, h] crops every variant of a portrait to the same frame, so swapping faces never shifts it.
    const t = s.box ? crop(img, { x0: s.box[0], y0: s.box[1], x1: s.box[0] + s.box[2] - 1, y1: s.box[1] + s.box[3] - 1 }) : s.key || alphaBox(img, 0) ? trim(img) : img;
    const o = fitMax(t, s.maxWidth, s.maxHeight), name = s.name ?? stem(s.file);
    save(join(OUT, `${name}.png`), o);
    index.images[name] = { src: `${name}.png`, w: o.w, h: o.h };
    console.log(`image ${name} ${o.w}x${o.h}`);
    continue;
  }
  const { comps, labels } = components(img);
  const groups = readingOrder(mergeComps(comps.filter((c) => c.area >= (s.minArea ?? 150)), s.gap ?? 6));
  if (s.kind === 'character') {
    // A whole character sheet laid out like art/templates/pam-sheet.png: frames in reading order become
    // <name>_<anim>. Rows are told apart relative to frame size, since generated sheets come at any scale.
    const merged = mergeComps(comps.filter((c) => c.area >= (s.minArea ?? 150)), s.gap ?? 6);
    const hs = merged.map((g) => g.y1 - g.y0).sort((a, b) => a - b), med = hs[hs.length >> 1] ?? 1;
    const gs = readingOrder(merged, med * 0.4);
    const want = CHARACTER.reduce((n, [, k]) => n + k, 0);
    if (gs.length !== want) console.log(`  ! ${s.file}: found ${gs.length} frames, expected ${want} (frames touching, or a row out of order?)`);
    // The standing front frame ends up ~128 px tall like Pam's; `height` makes someone taller or shorter.
    // Seated frames keep the base scale, so the chair in them still matches the empty chairs.
    const sc = s.scale ?? 128 / (gs[0].y1 - gs[0].y0 + 1), tall = (s.height ?? 128) / 128;
    let k = 0;
    for (const [anim, n] of CHARACTER) {
      const part = gs.slice(k, (k += n));
      if (part.length < n) break;
      const seated = /^(sit|type|phone)_/.test(anim);
      const frames = part.map((g) => scaleBy(crop(img, g, (x, y) => g.labels.includes(labels[y * img.w + x])), seated ? sc : sc * tall));
      const { strip, cellW, cellH, anchorX, anchorY } = anchorStrip(frames), name = `${s.name}_${anim}`;
      save(join(OUT, `${name}.png`), strip);
      index.anims[name] = { src: `${name}.png`, frameW: cellW, frameH: cellH, frames: n, anchorX, anchorY };
    }
    console.log(`character ${s.name}: ${gs.length} frames, scale ${sc.toFixed(3)}`);
    continue;
  }
  if (s.kind === 'frames') {
    const frames = groups.map((g) => scaleBy(crop(img, g, (x, y) => g.labels.includes(labels[y * img.w + x])), s.scale ?? 1));
    const { strip, cellW, cellH, anchorX, anchorY } = anchorStrip(frames);
    const name = s.name ?? stem(s.file);
    save(join(OUT, `${name}.png`), strip);
    index.anims[name] = { src: `${name}.png`, frameW: cellW, frameH: cellH, frames: frames.length, anchorX, anchorY };
    console.log(`anim ${name} ${frames.length} frames, cell ${cellW}x${cellH}`);
    continue;
  }
  // props: keep each group's solid pixels plus translucent shadow pixels within a small pad
  const pad = 6, names: string[] = [];
  const contact = { ...img, data: new Uint8Array(img.data) };
  groups.forEach((g, n) => {
    const name = s.names?.[n] || `${stem(s.file)}_${String(n).padStart(2, '0')}`;
    const own = new Set(g.labels);
    const box = { x0: g.x0 - pad, y0: g.y0 - pad, x1: g.x1 + pad, y1: g.y1 + pad };
    let o = trim(scaleBy(crop(img, box, (x, y) => { const l = labels[y * img.w + x]; return l < 0 ? img.data[(y * img.w + x) * 4 + 3] > 0 : own.has(l); }), s.scale ?? 1));
    if (s.sharpen) o = sharpen(o, s.sharpen);
    for (const [ex, ey, ew, eh] of s.erase?.[name] ?? []) for (let y = ey; y < ey + eh; y++) for (let x = ex; x < ex + ew; x++) if (x < o.w && y < o.h) o.data[(y * o.w + x) * 4 + 3] = 0;
    save(join(OUT, 'props', `${name}.png`), o);
    index.props[name] = { src: `props/${name}.png`, w: o.w, h: o.h };
    names.push(`${n}:${name} ${o.w}x${o.h}`);
  });
  console.log(`props ${s.file}: ${groups.length}\n  ${names.join('\n  ')}`);
  // dev aid: keyed sheet on a dark bg with each prop's index drawn
  const bg = join(DEV, `${stem(s.file)}-keyed.png`), out = join(DEV, `${stem(s.file)}-contact.png`);
  save(bg, contact);
  try {
    const labelsArg = groups.flatMap((g, n) => ['-annotate', `+${g.x0}+${g.y0 + 14}`, String(n)]);
    execFileSync('magick', [bg, '-background', '#203040', '-alpha', 'remove', '-fill', 'yellow', '-pointsize', '16', ...labelsArg, out]);
  } catch { console.log('  (magick missing, skipped contact sheet)'); }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
// Prop sizes for the layout builder (collision), importable from Node and Vite alike (public/ is not).
writeFileSync('data/sets/prop-sizes.json', JSON.stringify(Object.fromEntries(Object.entries(index.props).map(([k, v]) => [k, { w: v.w, h: v.h }])), null, 1) + '\n');
