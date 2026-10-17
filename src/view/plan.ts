// Draws a layout set (data/sets/*.layout.json): carpet and door thresholds on a static canvas, then
// walls, props, decor and chairs as y-sorted items the sprite view mixes with the actors.
// World units are px at native sprite scale; walls are screen rects (cap on top, face below).
import { propRect, solidRects, type Layout, type LProp, type Rect, type SetMap } from '../sets/index.ts';
import { art } from './art';
import { BG_SCALE, CHAIR_BOX, CHAIR_SCALE, SEAT_BASE, SEAT_DROP } from './geometry';

export type Dir = 'front' | 'back' | 'side';
/** A seat cell: where the sitter's feet go, which way they face, and whether a chair is drawn. */
export interface Chair { x: number; y: number; fx: number; fy: number; dir: Dir; face: 1 | -1; draw: boolean; /** The base (px y) of the prop they sit at, drawn over it; or null. */ front: number | null }
export interface Item { k: number; x0: number; y0: number; x1: number; y1: number; f: (ctx: CanvasRenderingContext2D) => void; /** A chair's seat cell (hidden while someone with sit art is in it). */ seat?: string }
/** A prop's sprite box and the x-range of its solid base: people beside the base overlap the prop's side. */
export interface Side { x0: number; x1: number; top: number; B: number; sx0: number; sx1: number }
/** Everything static about a set, in the one shape the view draws from (layout sets: plan.ts, ASCII sets: ascii.ts). */
export interface Plan {
  bg: HTMLCanvasElement; W: number; H: number; items: Item[]; chairs: Chair[]; sides: Side[];
  /** Sort key of a torso redraw for a seated, front-facing person at this cell (they sit behind the desk in front), or null. */
  torsoKey?: (x: number, y: number) => number | null;
  /** False while a chosen sprite is still loading: the view rebuilds the plan. */
  ready?: () => boolean;
}

const CAP = 16; // cap thickness (the plan depth of a wall)
const END_FACE = 56; // the visible end of a vertical wall
const COLOR = {
  cap: '#f2e6c6', capShade: '#d9c9a0', face: '#e0cfa6', faceLow: '#cbb68a', base: '#8a7352', edge: '#26242b',
  wood: '#b06d2a', woodDark: '#6d4320', outside: '#6f7d96', frame: '#2a2f3a',
};
/** How far ahead of a side seat (world px) the desk they work at may start. */
const DESK_REACH = 24;
const FACING: Record<string, [Dir, 1 | -1]> = { down: ['front', 1], up: ['back', 1], left: ['side', -1], right: ['side', 1] };

const hit = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const isHoriz = (w: Rect) => w.w >= w.h;

/** Cut a wall along its length around the doors in it. */
function segments(w: Rect, doors: Rect[]): Rect[] {
  const horiz = isHoriz(w);
  const cuts = doors.filter((d) => meets(w, d)).map((d) => (horiz ? [d.x, d.x + d.w] : [d.y, d.y + d.h])).sort((a, b) => a[0] - b[0]);
  const out: Rect[] = [];
  let at = horiz ? w.x : w.y;
  const end = horiz ? w.x + w.w : w.y + w.h;
  const push = (a: number, b: number) => { if (b > a) out.push(horiz ? { x: a, y: w.y, w: b - a, h: w.h } : { x: w.x, y: a, w: w.w, h: b - a }); };
  for (const [a, b] of cuts) { push(at, Math.min(a, end)); at = Math.max(at, b); }
  push(at, end);
  return out;
}

// ---------------------------------------------------------------- static layer

function carpetPattern(g: CanvasRenderingContext2D, style: string): CanvasPattern | string {
  const base = style === 'tile' ? '#cfc7b4' : style === 'wood' ? '#9a6b3c' : '#606d86';
  const t = document.createElement('canvas');
  t.width = t.height = 64;
  const c = t.getContext('2d')!;
  c.fillStyle = base;
  c.fillRect(0, 0, 64, 64);
  // Deterministic speckle, so the carpet has texture but never shimmers.
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 520; i++) {
    c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
    c.fillRect(Math.floor(rnd() * 32) * 2, Math.floor(rnd() * 32) * 2, 2, 2);
  }
  if (style === 'tile') { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 0, 1, 64); }
  return g.createPattern(t, 'repeat') ?? base;
}

/** An open doorway: a darker threshold (outside tint for exits), jamb posts and a door leaf swung back. */
function paintDoor(g: CanvasRenderingContext2D, d: Rect & { exit?: string | string[] }): void {
  const horiz = d.w >= d.h;
  g.fillStyle = d.exit ? COLOR.outside : 'rgba(20,22,34,0.35)';
  g.fillRect(d.x, d.y, d.w, d.h);
  g.fillStyle = COLOR.woodDark;
  if (horiz) {
    g.fillRect(d.x - 1, d.y, 4, d.h);
    g.fillRect(d.x + d.w - 3, d.y, 4, d.h);
    // Leaf: seen edge-on beside the left jamb.
    g.fillStyle = COLOR.wood;
    g.fillRect(d.x + 3, d.y + CAP - 2, 9, d.h - CAP - 4);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(d.x + 3, d.y + CAP - 2, 2, d.h - CAP - 4);
    g.fillStyle = '#e8c35a';
    g.fillRect(d.x + 9, d.y + CAP + (d.h - CAP) / 2, 2, 3);
  } else {
    g.fillRect(d.x, d.y - 1, d.w, 4);
    g.fillRect(d.x, d.y + d.h - 3, d.w, 4);
    g.fillStyle = COLOR.wood;
    g.fillRect(d.x + 2, d.y + 4, d.w - 4, 5);
  }
}

function blankBg(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c;
}

function paintBg(L: Layout): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = L.width * BG_SCALE;
  c.height = L.height * BG_SCALE;
  const g = c.getContext('2d')!;
  g.scale(BG_SCALE, BG_SCALE);
  const pats = new Map<string, CanvasPattern | string>();
  for (const f of L.floor) {
    const st = f.style ?? 'carpet';
    if (!pats.has(st)) pats.set(st, carpetPattern(g, st));
    g.fillStyle = pats.get(st)!;
    g.fillRect(f.x, f.y, f.w, f.h);
  }
  // Soft shadow where a wall face meets the floor.
  for (const w of L.walls) {
    if (!isHoriz(w) || w.h <= CAP) continue;
    const y = w.y + w.h, gr = g.createLinearGradient(0, y, 0, y + 16);
    gr.addColorStop(0, 'rgba(10,12,24,0.38)');
    gr.addColorStop(1, 'rgba(10,12,24,0)');
    g.fillStyle = gr;
    const onFloor = L.floor.filter((f) => hit(f, w.x + w.w / 2, y + 4));
    for (const f of onFloor) g.fillRect(Math.max(w.x, f.x), y, Math.min(w.x + w.w, f.x + f.w) - Math.max(w.x, f.x), 16);
  }
  for (const d of L.doors) {
    if (!d.exit) { g.fillStyle = pats.get('carpet') ?? COLOR.outside; g.fillRect(d.x, d.y, d.w, d.h); }
    paintDoor(g, d);
  }
  return c;
}

// ---------------------------------------------------------------- walls

function drawHoriz(ctx: CanvasRenderingContext2D, s: Rect): void {
  const { x, y, w, h } = s;
  ctx.fillStyle = COLOR.cap;
  ctx.fillRect(x, y, w, Math.min(CAP, h));
  if (h > CAP) {
    const f = ctx.createLinearGradient(0, y + CAP, 0, y + h);
    f.addColorStop(0, COLOR.face);
    f.addColorStop(1, COLOR.faceLow);
    ctx.fillStyle = f;
    ctx.fillRect(x, y + CAP, w, h - CAP);
    ctx.fillStyle = COLOR.capShade;
    ctx.fillRect(x, y + CAP, w, 2);
    ctx.fillStyle = COLOR.base; // baseboard
    ctx.fillRect(x, y + h - 6, w, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y + h - 6, w, 1);
  }
  ctx.fillStyle = COLOR.edge; // the outline the art has all round
  ctx.fillRect(x, y, w, 1.5);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1.5, h);
  ctx.fillRect(x + w - 1.5, y, 1.5, h);
}

function drawWindow(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.fillStyle = COLOR.frame;
  ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#a9cdf2');
  g.addColorStop(1, '#6f95d4');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(235,245,255,0.55)'; // blinds
  for (let y = r.y + 3; y < r.y + r.h - 2; y += 5) ctx.fillRect(r.x, y, r.w, 2);
  ctx.fillStyle = 'rgba(40,60,110,0.35)';
  ctx.fillRect(r.x + r.w / 2 - 1, r.y, 2, r.h);
  ctx.fillStyle = '#e9e1cf'; // sill
  ctx.fillRect(r.x - 4, r.y + r.h + 3, r.w + 8, 3);
}

function wallItems(L: Layout): Item[] {
  const out: Item[] = [];
  for (const w of L.walls) {
    if (isHoriz(w)) {
      const segs = segments(w, L.doors);
      out.push({
        k: w.y + w.h + 0.01, x0: w.x, y0: w.y, x1: w.x + w.w, y1: w.y + w.h,
        f: (ctx) => {
          for (const s of segs) drawHoriz(ctx, s);
          for (const win of L.windows) if (win.y >= w.y && win.y < w.y + w.h && win.x >= w.x && win.x + win.w <= w.x + w.w) drawWindow(ctx, win);
          for (const d of L.decor) {
            const e = art.index.props?.[d.sprite], im = art.image(d.sprite);
            if (!e || !im || d.x < w.x || d.x > w.x + w.w || d.y < w.y || d.y > w.y + w.h) continue;
            const s = d.scale ?? 1;
            ctx.drawImage(im, Math.round(d.x - (e.w * s) / 2), Math.round(d.y - e.h * s), e.w * s, e.h * s);
          }
        },
      });
      continue;
    }
    // A vertical wall in 16 px slices, each sorted at its own bottom so people beside it are not clipped by its far end.
    const shade = [L.floor.some((f) => hit(f, w.x - 3, w.y + w.h / 2)) ? -1 : 0, L.floor.some((f) => hit(f, w.x + w.w + 3, w.y + w.h / 2)) ? 1 : 0];
    for (const s of segments(w, L.doors)) {
      const send = s.y + s.h;
      for (let y = s.y; y < send; y += CAP) {
        const y1 = Math.min(send, y + CAP);
        out.push({
          k: y1, x0: w.x, y0: y, x1: w.x + w.w, y1,
          f: (ctx) => {
            ctx.fillStyle = COLOR.cap;
            ctx.fillRect(w.x, y, w.w, y1 - y);
            if (shade[0]) { ctx.fillStyle = COLOR.faceLow; ctx.fillRect(w.x, y, 4, y1 - y); }
            if (shade[1]) { ctx.fillStyle = COLOR.faceLow; ctx.fillRect(w.x + w.w - 4, y, 4, y1 - y); }
            if (y1 > send - END_FACE) { // the end of a wall shows its face
              const a = Math.max(y, send - END_FACE);
              ctx.fillStyle = COLOR.face;
              ctx.fillRect(w.x, a, w.w, y1 - a);
              if (y1 > send - 6) { ctx.fillStyle = COLOR.base; ctx.fillRect(w.x, Math.max(a, send - 6), w.w, y1 - Math.max(a, send - 6)); }
            }
            ctx.fillStyle = COLOR.edge;
            ctx.fillRect(w.x, y, 1.5, y1 - y);
            ctx.fillRect(w.x + w.w - 1.5, y, 1.5, y1 - y);
            if (y === w.y || y === s.y) ctx.fillRect(w.x, y, w.w, 1.5);
            if (y1 === send) ctx.fillRect(w.x, y1 - 1, w.w, 1);
          },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- props

function waterCooler(ctx: CanvasRenderingContext2D, r: Rect): void {
  const cx = r.x + r.w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, r.y + r.h - 1, r.w / 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9ced8';
  ctx.fillRect(r.x + 2, r.y + r.h * 0.38, r.w - 4, r.h * 0.62);
  ctx.fillStyle = '#8f96a6';
  ctx.fillRect(r.x + 2, r.y + r.h * 0.38, r.w - 4, 2);
  ctx.fillStyle = '#4a86d8'; // the jug
  ctx.beginPath();
  ctx.roundRect(r.x + 4, r.y, r.w - 8, r.h * 0.4, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(r.x + 7, r.y + 4, 2, r.h * 0.22);
  ctx.fillStyle = '#2b2f3a';
  ctx.fillRect(cx - 3, r.y + r.h * 0.5, 6, 3);
}

function drawProp(ctx: CanvasRenderingContext2D, p: LProp, from = 0, to = Infinity): void {
  const r = propRect(p), im = art.image(p.sprite), e = art.index.props?.[p.sprite];
  const x = Math.round(r.x), y = Math.round(r.y);
  if (!im || !e) {
    if (p.sprite === 'water_cooler') return waterCooler(ctx, r);
    for (const s of solidRects(p)) { ctx.fillStyle = '#7b6a55'; ctx.fillRect(s.x, s.y, s.w, s.h); }
    return;
  }
  // A band of rows [from, to) of the sprite, in sprite px.
  const sc = p.scale ?? 1, a = Math.max(0, from), b = Math.min(e.h, to);
  if (b <= a) return;
  ctx.save();
  if (p.flip) { ctx.translate(x + r.w, 0); ctx.scale(-1, 1); ctx.drawImage(im, 0, a, e.w, b - a, 0, y + a * sc, r.w, (b - a) * sc); } else ctx.drawImage(im, 0, a, e.w, b - a, x, y + a * sc, r.w, (b - a) * sc);
  ctx.restore();
}

function propItems(L: Layout): Item[] {
  const out: Item[] = [];
  for (const p of L.props) {
    const r = propRect(p), B = p.y, e = r.x;
    const whole = { x0: e - 4, y0: r.y - 4, x1: e + r.w + 4, y1: B + 4 };
    if (p.split) {
      // The rows above `split` sit behind whoever stands at the prop; the rest in front.
      const sc = p.scale ?? 1;
      out.push({ k: r.y + p.split * sc, ...whole, f: (ctx) => drawProp(ctx, p, 0, p.split) });
      out.push({ k: B, ...whole, f: (ctx) => drawProp(ctx, p, p.split) });
    } else out.push({ k: B, ...whole, f: (ctx) => drawProp(ctx, p) });
  }
  return out;
}

function chairs(set: SetMap, L: Layout): Chair[] {
  const rects = L.props.map((p) => ({ r: propRect(p), B: p.y }));
  const out: Chair[] = [];
  for (const [name, s] of Object.entries(L.spots)) {
    const cell = set.spots[name];
    if (!s.seat || !cell) continue;
    // The spot's own px, not its cell centre: seats line up with the desk art (keyboards) finer than the 16 px grid.
    const [fx, fy] = [s.x, s.y], [dir, face] = FACING[s.seat] ?? FACING.down;
    // Left/right sitters (pod chairs) are drawn over the pod; up/down only when the layout says so.
    // The prop they sit at: under their feet, or (side seats) just ahead of them, where their hands and knees go.
    const ahead = dir === 'side' ? fx + face * DESK_REACH : fx;
    const under = Math.max(0, ...rects.filter((q) => hit(q.r, fx, fy) || hit(q.r, ahead, fy)).map((q) => q.B));
    out.push({ x: cell.x, y: cell.y, fx, fy, dir, face, draw: s.chair !== false, front: (s.front ?? dir === 'side') && under > 0 ? under : null });
  }
  return out;
}

export function chairItem(c: Chair): Item {
  const name = `chair_${c.dir}`;
  return {
    k: c.fy + SEAT_DROP + (c.dir === 'back' ? 0.5 : -0.5), x0: c.fx - CHAIR_BOX.half, y0: c.fy - CHAIR_BOX.up, x1: c.fx + CHAIR_BOX.half, y1: c.fy + CHAIR_BOX.down, seat: `${c.x},${c.y}`,
    f: (ctx) => {
      const e = art.index.props?.[name], im = art.image(name);
      if (!e || !im) return;
      const w = e.w * CHAIR_SCALE, h = e.h * CHAIR_SCALE, x = c.fx - w / 2, y = c.fy + SEAT_BASE - h; // base where sit art puts it
      if (c.dir === 'side' && c.face === -1) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, w, h); ctx.restore(); } else ctx.drawImage(im, x, y, w, h);
    },
  };
}

// ---------------------------------------------------------------- build

/** Everything static about a layout set. */
export function buildPlan(set: SetMap): Plan {
  const L = set.layout!;
  const seats = chairs(set, L);
  const bg = L.background;
  // A flat room picture replaces the drawn floor and walls (they stay as walking logic only).
  const under: Item[] = bg ? [{ k: -Infinity, x0: 0, y0: 0, x1: L.width, y1: L.height, f: (ctx) => {
    const e = art.index.props?.[bg.sprite], im = art.image(bg.sprite);
    if (e && im) ctx.drawImage(im, 0, 0, e.w * bg.scale, e.h * bg.scale);
  } }] : wallItems(L);
  const items = [...under, ...propItems(L), ...seats.filter((c) => c.draw).map(chairItem)];
  const sides = L.props.flatMap((p): Side[] => {
    const r = propRect(p), sol = solidRects(p);
    return sol.length ? [{ x0: r.x, x1: r.x + r.w, top: r.y, B: p.y, sx0: Math.min(...sol.map((q) => q.x)), sx1: Math.max(...sol.map((q) => q.x + q.w)) }] : [];
  });
  return { bg: bg ? blankBg() : paintBg(L), W: L.width, H: L.height, items, chairs: seats, sides };
}
