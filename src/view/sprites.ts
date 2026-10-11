// The sprite map view: the current set on a canvas (procedural floors and walls, sprite
// furniture and people, y-sorted for occlusion) with an HTML layer for balloons and cards.
// Same events and Stage reads as MapView, so the two are swappable per frame. The ASCII
// grid stays the logic layer: props are found as solid blocks, chairs as seat cells.
import PROPS from '../../data/sets/props.json';
import { firstName } from '../engine/cast';
import type { Actor } from '../engine/actor';
import type { EngineEvent } from '../engine/events';
import { readTime, type Stage } from '../engine/stage';
import type { SetMap } from '../sets/index.ts';
import { art } from './art';
import { esc } from './grid';
import { NameIndex } from './names';
import { MARKER } from './set';

/** World units: a cell is 16 x 32 (the grid is ~2:1). */
const CW = 16, CH = 32;
const BG_SCALE = 2; // static layer resolution, so zoomed-in cameras stay sharp
const PERSON_H = 80; // a standing character, in world px
const SEAT_DROP = 10; // seated people sink into the chair
const CHAIR_W = 30;
const MAX_ZOOM = 3;
const VOID = '#050508';
const SOLID = new Set(['desk', 'shelf', 'plant', 'machine', 'appliance', 'vending', 'prop']);
const BOX: Record<string, [string, string, number]> = {
  desk: ['#b08a55', '#8f6e3c', 14], shelf: ['#8b7355', '#6b5a45', 40], plant: ['#4fae68', '#2f7a46', 30], machine: ['#a9aeb8', '#7d828d', 24],
  appliance: ['#dfe2e8', '#b5b9c2', 44], vending: ['#d8505f', '#a8323f', 48], prop: ['#6c7a99', '#4d5873', 24],
};
const CAR_COLORS = ['#a83a3a', '#3a6aa8', '#8a8f99', '#3a8a5a', '#c9b24a', '#5a4a8a'];

interface PropsCfg {
  kinds: Record<string, string[]>;
  regions: Record<string, Record<string, string[]>>;
  sets: Record<string, { blocks?: Record<string, string>; kinds?: Record<string, string[]> }>;
}
const CFG = PROPS as unknown as PropsCfg;

/** Stable 0..1 hash of a cell. */
const hash = (x: number, y: number, k = 0): number => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(k + 7, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

interface Block { x0: number; y0: number; w: number; h: number; kind: string; sprite: string | null; set: string }
interface Chair { x: number; y: number; dir: 'front' | 'back' | 'side'; face: 1 | -1 }
interface Layout { bg: HTMLCanvasElement; W: number; H: number; blocks: Block[]; chairs: Chair[]; seats: Map<string, Chair> }
type Dir = 'front' | 'back' | 'side';

/** Greedy rectangles over same-kind solid cells. */
function findBlocks(set: SetMap): Block[] {
  const seen = set.kinds.map((r) => r.map(() => false));
  const out: Block[] = [];
  for (let y = 0; y < set.height; y++) {
    for (let x = 0; x < set.width; x++) {
      const kind = set.kinds[y][x];
      if (seen[y][x] || !SOLID.has(kind)) continue;
      const ok = (cx: number, cy: number) => cx < set.width && cy < set.height && !seen[cy][cx] && set.kinds[cy][cx] === kind;
      let w = 1;
      while (ok(x + w, y)) w++;
      let h = 1;
      while (Array.from({ length: w }, (_, i) => ok(x + i, y + h)).every(Boolean) && y + h < set.height) h++;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) seen[y + j][x + i] = true;
      out.push({ x0: x, y0: y, w, h, kind, sprite: null, set: set.id });
    }
  }
  return out;
}

/** Pick the sprite for a block: overrides, then the candidate whose aspect fits best (ties broken by a stable hash). */
function chooseSprite(set: SetMap, b: Block): string | null {
  const over = CFG.sets[set.id]?.blocks?.[`${b.x0},${b.y0}`];
  if (over) return art.index.props?.[over] ? over : null;
  const votes = new Map<string, number>();
  for (let y = b.y0 - 1; y <= b.y0 + b.h; y++) {
    for (let x = b.x0 - 1; x <= b.x0 + b.w; x++) {
      const r = set.regionAt({ x, y });
      if (r) votes.set(r, (votes.get(r) ?? 0) + 1);
    }
  }
  const region = [...votes].sort((a, c) => c[1] - a[1])[0]?.[0] ?? '';
  const rc = CFG.regions[region];
  const narrow = b.kind === 'desk' && b.w <= 2 && b.h >= 2;
  const list = narrow ? [] : (b.w >= 3 && (rc?.[`${b.kind}${b.h >= 2 ? '_tall' : ''}`] ?? rc?.[b.kind])) || CFG.sets[set.id]?.kinds?.[b.kind] || CFG.kinds[b.kind] || [];
  const aspect = (b.w * CW) / (b.h * CH + CH);
  const scored = list.flatMap((n) => {
    const e = art.index.props?.[n];
    return e ? [{ n, d: Math.abs(Math.log(e.w / e.h / aspect)) }] : [];
  }).sort((a, c) => a.d - c.d);
  if (!scored.length) return null;
  const near = scored.filter((s) => s.d <= scored[0].d + 0.15);
  return near[Math.floor(hash(b.x0, b.y0) * near.length)].n;
}

/** Which way a sitter faces: toward the adjacent (or nearest) desk. */
function seatOf(set: SetMap, x: number, y: number): Chair {
  const desk = (cx: number, cy: number) => set.kinds[cy]?.[cx] === 'desk';
  if (desk(x, y + 1)) return { x, y, dir: 'front', face: 1 };
  if (desk(x, y - 1)) return { x, y, dir: 'back', face: 1 };
  if (desk(x - 1, y)) return { x, y, dir: 'side', face: -1 };
  if (desk(x + 1, y)) return { x, y, dir: 'side', face: 1 };
  let best: [number, number] | null = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) if (desk(x + dx, y + dy) && dx * dx + dy * dy * 2 < bd) { bd = dx * dx + dy * dy * 2; best = [dx, dy]; }
  }
  if (!best) return { x, y, dir: 'front', face: 1 };
  const [dx, dy] = best;
  return Math.abs(dy) >= Math.abs(dx) ? { x, y, dir: dy > 0 ? 'front' : 'back', face: 1 } : { x, y, dir: 'side', face: dx > 0 ? 1 : -1 };
}

// ---------------------------------------------------------------- static layer

function floorColor(set: SetMap, x: number, y: number): string {
  const n = hash(x, y, 1) - 0.5;
  const region = set.regionAt({ x, y }) ?? '';
  const tile = set.id === 'break_room' || region === 'kitchen' || region === 'break_room';
  if (set.id === 'warehouse') return `hsl(210 3% ${46 + n * 3}%)`;
  if (set.id === 'parking_lot') return `hsl(220 6% ${24 + n * 2.5}%)`;
  if (set.id === 'offsite') return `hsl(30 26% ${38 + n * 3}%)`;
  if (tile) return (x + y) % 2 ? `hsl(40 14% ${80 + n * 2}%)` : `hsl(40 12% ${74 + n * 2}%)`;
  return `hsl(215 13% ${38 + n * 2.4}%)`;
}

function paintBg(set: SetMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = set.width * CW * BG_SCALE;
  c.height = set.height * CH * BG_SCALE;
  const g = c.getContext('2d')!;
  g.scale(BG_SCALE, BG_SCALE);
  g.fillStyle = VOID;
  g.fillRect(0, 0, set.width * CW, set.height * CH);
  const kindAt = (x: number, y: number) => set.kinds[y]?.[x];
  const wallish = (x: number, y: number) => kindAt(x, y) === 'wall' || kindAt(x, y) === 'window';
  const lot = set.id === 'parking_lot';
  for (let y = 0; y < set.height; y++) {
    for (let x = 0; x < set.width; x++) {
      const kind = set.kinds[y][x], px = x * CW, py = y * CH;
      if (kind === 'void') continue;
      if (wallish(x, y)) {
        g.fillStyle = '#2b2d3d';
        g.fillRect(px, py, CW, CH);
        g.fillStyle = '#3a3d52';
        g.fillRect(px, py, CW, 2);
        const below = kindAt(x, y + 1);
        const face = below !== undefined && !wallish(x, y + 1) && below !== 'void';
        if (face) {
          g.fillStyle = '#cdbb94';
          g.fillRect(px, py + 13, CW, CH - 13);
          g.fillStyle = '#6a5d45';
          g.fillRect(px, py + 13, CW, 1);
          g.fillStyle = '#8f7e5e';
          g.fillRect(px, py + CH - 3, CW, 3);
        }
        if (kind === 'window') {
          const wy = face ? py + 15 : py + 8;
          g.fillStyle = '#6f5f45';
          g.fillRect(px + 1, wy - 1, CW - 2, face ? 13 : 17);
          g.fillStyle = face ? '#a9d6f0' : '#5d7a96';
          g.fillRect(px + 2, wy, CW - 4, face ? 11 : 15);
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.fillRect(px + 3, wy + 1, 3, face ? 9 : 13);
        }
        continue;
      }
      g.fillStyle = floorColor(set, x, y);
      g.fillRect(px, py, CW, CH);
      if (set.regionAt({ x, y }) === 'kitchen' || set.id === 'break_room') {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(px, py, CW, 1);
        g.fillRect(px, py, 1, CH);
      }
      if (kind === 'deco') {
        if (lot) {
          g.fillStyle = 'rgba(235,235,225,0.8)';
          if (kindAt(x - 1, y) === 'deco' || kindAt(x + 1, y) === 'deco') for (let i = 1; i < CW; i += 6) g.fillRect(px + i, py + 4, 3, CH - 8);
          else g.fillRect(px + 7, py, 2, CH);
        } else {
          g.fillStyle = 'rgba(30,20,40,0.28)';
          g.fillRect(px, py + 2, CW, CH - 4);
        }
      } else if (kind === 'door') {
        g.fillStyle = '#8a6a3e';
        g.fillRect(px, py + 12, CW, 7);
        g.fillStyle = '#b08a55';
        g.fillRect(px, py + 12, CW, 2);
      } else if (kind === 'exit') {
        g.fillStyle = '#2e2724';
        g.fillRect(px, py + 1, CW, CH - 2);
        g.fillStyle = '#4a3f38';
        g.fillRect(px, py + 1, CW, 3);
      }
    }
  }
  return c;
}

const layouts = new WeakMap<SetMap, Layout>();
function layoutFor(set: SetMap): Layout {
  let l = layouts.get(set);
  if (l && l.blocks.every((b) => b.sprite === null || art.image(b.sprite))) return l;
  const blocks = findBlocks(set);
  for (const b of blocks) b.sprite = chooseSprite(set, b);
  const chairs: Chair[] = [];
  for (let y = 0; y < set.height; y++) for (let x = 0; x < set.width; x++) if (set.kinds[y][x] === 'seat') chairs.push(seatOf(set, x, y));
  l = { bg: l?.bg ?? paintBg(set), W: set.width * CW, H: set.height * CH, blocks, chairs, seats: new Map(chairs.map((c) => [`${c.x},${c.y}`, c])) };
  layouts.set(set, l);
  return l;
}

// ---------------------------------------------------------------- the view

interface GBalloon { who: string; text: string; el: HTMLDivElement; at: number; until: number; note: boolean; w: number; h: number; mw: number; pos: string; tail: string; t: string }
interface Rect { x0: number; y0: number; x1: number; y1: number }
interface Cam { cx: number; cy: number; w: number }
interface Pose { a: Actor; x: number; y: number; moving: boolean; dir: Dir; face: 1 | -1; seated: boolean; frame: number; chair: Chair | null }

export class SpriteMapView {
  private canvas = document.createElement('canvas');
  private ui = document.createElement('div');
  private cardEl = document.createElement('div');
  private capEl = document.createElement('div');
  private names: NameIndex;
  private balloons = new Map<string, GBalloon>();
  private region = '';
  private cam: Cam | null = null;
  private snap = true;
  private lastWt = 0;
  private lastSet: SetMap | null = null;
  private lastSig = '';
  private heading = new Map<string, { dir: Dir; face: 1 | -1 }>();
  private dpr = 1;
  private cardKey = '';
  private capKey = '';

  constructor(private el: HTMLElement, private stage: Stage) {
    this.names = new NameIndex(stage);
    this.ui.className = 'sg-ui';
    this.cardEl.className = 'sg-card';
    this.cardEl.hidden = true;
    this.capEl.className = 'sg-cap';
    this.capEl.hidden = true;
    this.ui.append(this.cardEl, this.capEl);
    el.replaceChildren(this.canvas, this.ui);
  }

  onEvent(e: EngineEvent): void {
    const st = this.stage;
    if (e.type === 'said') {
      const a = st.actor(e.who);
      this.removeBalloon(e.who);
      const el = document.createElement('div');
      el.className = 'sg-balloon';
      el.style.borderColor = a.color;
      el.innerHTML = `<b class="sg-who" style="color:${a.color}">${esc(firstName(a.name))}</b> ${this.names.html(e.text, esc)}`;
      this.ui.append(el);
      this.balloons.set(e.who, { who: e.who, text: e.text, el, at: st.wt, until: st.wt + readTime(e.text, 'said') + 0.3, note: false, w: 0, h: 0, mw: 0, pos: '', tail: '', t: '' });
    } else if (e.type === 'despawn') this.removeBalloon(e.id);
    else if (e.type === 'sceneStart') {
      for (const k of [...this.balloons.keys()]) this.removeBalloon(k);
      this.region = e.region;
      this.snap = true;
    }
  }

  private removeBalloon(key: string): void {
    this.balloons.get(key)?.el.remove();
    this.balloons.delete(key);
  }

  /** The stage direction near an actor, as an italic balloon. */
  private syncNote(): void {
    const st = this.stage, n = st.note;
    const live = n && n.who !== null && n.until > st.wt ? n : null;
    const cur = this.balloons.get('~note');
    const text = live ? `(${firstName(st.actor(live.who!).name)} ${live.text})` : '';
    if (cur && (!live || cur.text !== text)) this.removeBalloon('~note');
    if (live && !this.balloons.has('~note')) {
      const el = document.createElement('div');
      el.className = 'sg-balloon sg-dir';
      el.innerHTML = this.names.html(text, esc);
      this.ui.append(el);
      this.balloons.set('~note', { who: live.who!, text, el, at: st.wt, until: live.until, note: true, w: 0, h: 0, mw: 0, pos: '', tail: '', t: '' });
    }
  }

  // ---------------------------------------------------------------- camera

  private regionBox(set: SetMap): Rect {
    const cells = set.regions[this.region]?.cells;
    if (!cells?.length) return { x0: 0, y0: 0, x1: set.width * CW, y1: set.height * CH };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
    return { x0: (x0 - 2) * CW, y0: (y0 - 2) * CH, x1: (x1 + 3) * CW, y1: (y1 + 3) * CH };
  }

  /** The camera that frames a box at the canvas aspect, never wider than the whole set nor tighter than MAX_ZOOM. */
  private frame(box: Rect, W: number, H: number, aspect: number): Cam {
    const fitW = Math.max(W, H * aspect);
    const w = Math.min(fitW, Math.max(fitW / MAX_ZOOM, box.x1 - box.x0, (box.y1 - box.y0) * aspect));
    return this.clamp({ cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, w }, W, H, aspect);
  }

  private clamp(c: Cam, W: number, H: number, aspect: number): Cam {
    const h = c.w / aspect;
    return { w: c.w, cx: c.w >= W ? W / 2 : Math.max(c.w / 2, Math.min(W - c.w / 2, c.cx)), cy: h >= H ? H / 2 : Math.max(h / 2, Math.min(H - h / 2, c.cy)) };
  }

  // ---------------------------------------------------------------- poses

  private poseOf(a: Actor, t: number, layout: Layout): Pose {
    let x = a.x, y = a.y, moving = false;
    const hd = this.heading.get(a.id) ?? { dir: 'front' as Dir, face: a.facing };
    if (a.dest && a.stepFrom && a.stepTo && a.stepEnd > a.stepStart) {
      const u = Math.max(0, Math.min(1, (t - a.stepStart) / (a.stepEnd - a.stepStart)));
      x = a.stepFrom.x + (a.stepTo.x - a.stepFrom.x) * u;
      y = a.stepFrom.y + (a.stepTo.y - a.stepFrom.y) * u;
      moving = true;
      const dx = a.stepTo.x - a.stepFrom.x, dy = a.stepTo.y - a.stepFrom.y;
      if (dx) { hd.dir = 'side'; hd.face = dx > 0 ? 1 : -1; } else hd.dir = dy > 0 ? 'front' : 'back';
    } else if (hd.dir === 'side') hd.face = a.facing;
    this.heading.set(a.id, hd);
    const chair = a.seated ? layout.seats.get(`${a.x},${a.y}`) ?? null : null;
    const dir = chair ? chair.dir : hd.dir, face = chair ? chair.face : hd.face;
    return { a, x, y, moving, dir, face, seated: !!chair, chair, frame: moving ? 1 + (Math.floor(t * 8) % 4) : 0 };
  }

  // ---------------------------------------------------------------- render

  /** Draws the frame; true when the picture changed since the last call (the renderer reads this). */
  render(): boolean {
    const st = this.stage;
    let changed = this.syncCard();
    if (st.card && st.card.until > st.time) return changed;
    const set = st.set;
    const layout = layoutFor(set);
    if (set !== this.lastSet) { this.lastSet = set; this.snap = true; this.lastSig = ''; }
    const cw = this.el.clientWidth, chh = this.el.clientHeight;
    if (!cw || !chh) return changed;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cw * this.dpr), ph = Math.round(chh * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this.lastSig = '';
      for (const b of this.balloons.values()) b.mw = 0;
    }
    const aspect = pw / ph, t = st.wt;
    this.syncNote();
    for (const [k, b] of this.balloons) if (b.until <= t || (!b.note && !st.actor(b.who).visible)) this.removeBalloon(k);

    const poses = st.visibleActors().map((a) => this.poseOf(a, t, layout));
    // Camera: the scene's region, widened to keep whoever is talking in frame. Not for mere
    // walkers: background copier trips would keep pulling the shot wide.
    const box = { ...this.regionBox(set) };
    const talking = new Set([...this.balloons.values()].map((b) => b.who));
    for (const p of poses) {
      if (!p.a.speaking && !talking.has(p.a.id)) continue;
      const fx = p.x * CW + 8, fy = (p.y + 1) * CH;
      box.x0 = Math.min(box.x0, fx - 28); box.x1 = Math.max(box.x1, fx + 28);
      box.y0 = Math.min(box.y0, fy - PERSON_H - 8); box.y1 = Math.max(box.y1, fy + 8);
    }
    const goal = this.frame(box, layout.W, layout.H, aspect);
    const dt = Math.min(0.5, Math.max(0, t - this.lastWt));
    this.lastWt = t;
    if (!this.cam || this.snap) { this.cam = goal; this.snap = false; } else {
      const k = 1 - Math.exp(-dt * 2.5), c = this.cam;
      this.cam = this.clamp({ cx: c.cx + (goal.cx - c.cx) * k, cy: c.cy + (goal.cy - c.cy) * k, w: c.w + (goal.w - c.w) * k }, layout.W, layout.H, aspect);
    }
    const cam = this.cam;

    const sig = [
      st.pauseCaption && st.pauseCaption.until > st.time ? st.pauseCaption.text : '',
      `${Math.round(cam.cx)},${Math.round(cam.cy)},${Math.round(cam.w)}`,
      ...poses.map((p) => `${p.a.id}:${Math.round(p.x * CW)},${Math.round(p.y * CH)},${p.frame},${p.dir},${p.face},${p.seated ? 1 : 0},${p.a.reaction && p.a.reactionUntil > t ? p.a.reaction : ''}`),
      ...[...this.balloons.values()].map((b) => `${b.who}|${b.text}`),
    ].join(';');
    changed = this.syncCaption() || changed;
    if (sig === this.lastSig) return changed;
    this.lastSig = sig;

    this.draw(layout, poses, cam, aspect, pw, ph);
    this.placeBalloons(poses, cam, cw, chh);
    return true;
  }

  private draw(layout: Layout, poses: Pose[], cam: Cam, aspect: number, pw: number, ph: number): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const k = pw / cam.w, vx = cam.cx - cam.w / 2, vy = cam.cy - cam.w / aspect / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, pw, ph);
    ctx.setTransform(k, 0, 0, k, -vx * k, -vy * k);
    ctx.drawImage(layout.bg, 0, 0, layout.W, layout.H);

    const vis = (x0: number, y0: number, x1: number, y1: number) => x1 >= vx && x0 <= vx + cam.w && y1 >= vy && y0 <= vy + cam.w / aspect;
    const items: { k: number; f: () => void }[] = [];
    for (const b of layout.blocks) {
      const B = (b.y0 + b.h) * CH;
      if (vis(b.x0 * CW - 40, b.y0 * CH - 120, (b.x0 + b.w) * CW + 40, B)) items.push({ k: B, f: () => this.drawBlock(ctx, b) });
    }
    for (const c of layout.chairs) {
      const B = (c.y + 1) * CH;
      if (vis(c.x * CW - 20, B - 60, c.x * CW + 40, B)) items.push({ k: B + (c.dir === 'back' ? 6.5 : 5.5), f: () => this.drawChair(ctx, c) });
    }
    for (const p of poses) {
      const fy = (p.y + 1) * CH - 4 + (p.seated ? SEAT_DROP : 0);
      items.push({ k: fy, f: () => this.drawActor(ctx, p) });
      // A sitter facing the camera sits behind the desk in front of them: redraw the torso over it, legs stay hidden.
      const desk = p.seated && p.dir === 'front' ? layout.blocks.find((b) => p.a.x >= b.x0 && p.a.x < b.x0 + b.w && p.a.y + 1 >= b.y0 && p.a.y + 1 < b.y0 + b.h) : null;
      if (desk) items.push({ k: (desk.y0 + desk.h) * CH + 0.1, f: () => this.drawActor(ctx, p, fy - 26) });
    }
    items.sort((a, b) => a.k - b.k);
    for (const i of items) i.f();

    // Reaction emotes in screen space, so they stay legible at any zoom.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const font = Math.round(13 * this.dpr);
    ctx.font = `700 ${font}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of poses) {
      if (!p.a.reaction || p.a.reactionUntil <= this.stage.wt) continue;
      const m = MARKER[p.a.reaction], w = ctx.measureText(m).width + font;
      const sx = (p.x * CW + 8 - vx) * k, sy = ((p.y + 1) * CH - PERSON_H - 16 - vy) * k;
      ctx.fillStyle = 'rgba(20,20,34,0.9)';
      ctx.beginPath();
      ctx.roundRect(sx - w / 2, sy - font * 0.9, w, font * 1.8, font * 0.9);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.fillText(m, sx, sy);
    }
  }

  private sprite(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, flip = false): boolean {
    const im = art.image(name);
    if (!im) return false;
    if (flip) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(im, 0, 0, w, h);
      ctx.restore();
    } else ctx.drawImage(im, x, y, w, h);
    return true;
  }

  private drawBlock(ctx: CanvasRenderingContext2D, b: Block): void {
    const x = b.x0 * CW, y = b.y0 * CH, w = b.w * CW, h = b.h * CH, B = y + h;
    const e = b.sprite ? art.index.props?.[b.sprite] : null;
    if (e && b.sprite) {
      const s = Math.min((w + (b.w < 3 ? CW : 0)) / e.w, (h + 64) / e.h);
      if (this.sprite(ctx, b.sprite, x + w / 2 - (e.w * s) / 2, B - e.h * s, e.w * s, e.h * s)) return;
    }
    const [top, front, H] = BOX[b.kind] ?? BOX.prop;
    const car = b.kind === 'prop' && b.set === 'parking_lot';
    ctx.fillStyle = car ? CAR_COLORS[Math.floor(hash(b.x0, b.y0, 3) * CAR_COLORS.length)] : top;
    ctx.fillRect(x, y - H, w, h);
    if (car) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 6, y - H + 8, w - 12, h - 16); }
    if (!car) { ctx.fillStyle = front; ctx.fillRect(x, B - H, w, H); } else { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, B - H, w, H); }
    if (b.kind === 'shelf') { ctx.fillStyle = 'rgba(0,0,0,0.22)'; for (let i = 1; i < 4; i++) ctx.fillRect(x, B - H + (i * H) / 4, w, 1); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, B - H, w, 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - H + 0.5, w - 1, h + H - 1);
  }

  private drawChair(ctx: CanvasRenderingContext2D, c: Chair): void {
    const name = `chair_${c.dir}`, e = art.index.props?.[name];
    if (!e) return;
    const s = CHAIR_W / e.w, w = e.w * s, h = e.h * s;
    // The side chair is drawn facing right; mirror it when the desk is on the left.
    this.sprite(ctx, name, c.x * CW + 8 - w / 2, (c.y + 1) * CH + 4 - h + (c.dir === 'back' ? -4 : 0), w, h, c.dir === 'side' && c.face === -1);
  }

  private drawActor(ctx: CanvasRenderingContext2D, p: Pose, clipBelow?: number): void {
    const a = p.a, fx = p.x * CW + 8, drop = p.seated ? SEAT_DROP : 0;
    const fy = (p.y + 1) * CH - 4 + drop;
    if (clipBelow !== undefined) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx - 60, fy - 160, 120, clipBelow - (fy - 160));
      ctx.clip();
      this.drawActor(ctx, p);
      ctx.restore();
      return;
    }
    if (!p.seated) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(fx, fy, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const an = art.index.anims?.[`${a.id}_walk_${p.dir}`] && art.image(`${a.id}_walk_${p.dir}`) ? `${a.id}_walk_${p.dir}` : art.index.anims?.[`${a.id}_walk_front`] && art.image(`${a.id}_walk_front`) ? `${a.id}_walk_front` : null;
    const anim = an ? art.index.anims![an] : null;
    if (anim && an) {
      const s = PERSON_H / anim.frameH, im = art.image(an)!;
      // Side art faces left; mirror for right. The front and back views are symmetric enough.
      const flip = an.endsWith('_side') && p.face === 1;
      ctx.save();
      ctx.translate(fx, fy);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(im, p.frame * anim.frameW, 0, anim.frameW, anim.frameH, -anim.anchorX * s, -anim.anchorY * s, anim.frameW * s, anim.frameH * s);
      ctx.restore();
      return;
    }
    // Placeholder for anyone not drawn yet: a colored body, a head, and their letter.
    const bob = p.moving ? Math.sin(this.stage.wt * 18) * 2 : 0, by = fy - 2 + bob;
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.roundRect(fx - 13, by - 48, 26, 48, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(fx - 13, by - 14, 26, 14);
    ctx.fillStyle = '#e8c19a';
    ctx.beginPath();
    ctx.arc(fx, by - 60, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10101a';
    ctx.font = '700 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.glyph, fx, by - 28);
  }

  // ---------------------------------------------------------------- HTML layer

  private syncCard(): boolean {
    const st = this.stage, c = st.card && st.card.until > st.time ? st.card : null;
    const key = c ? `${c.text}|${c.sub}` : '';
    if (key === this.cardKey) return false;
    this.cardKey = key;
    this.cardEl.hidden = !c;
    this.cardEl.innerHTML = c ? `<b>${esc(c.text.toUpperCase())}</b>${c.sub ? `<span>${esc(c.sub)}</span>` : ''}` : '';
    if (c) this.lastSig = '';
    return true;
  }

  private syncCaption(): boolean {
    const st = this.stage, c = st.pauseCaption && st.pauseCaption.until > st.time ? st.pauseCaption.text : '';
    if (c === this.capKey) return false;
    this.capKey = c;
    this.capEl.hidden = !c;
    this.capEl.textContent = c;
    return true;
  }

  /** Balloons sit above the head; if that is taken or off-screen, try beside, higher, then below. */
  private placeBalloons(poses: Pose[], cam: Cam, cw: number, chh: number): void {
    const k = cw / cam.w, vx = cam.cx - cam.w / 2, vy = cam.cy - cam.w / (cw / chh) / 2;
    const sx = (x: number) => (x - vx) * k, sy = (y: number) => (y - vy) * k;
    const kc = k, body = (p: Pose) => ({ x: sx(p.x * CW + 8), feet: sy((p.y + 1) * CH) });
    const taken: Rect[] = poses.map((p) => {
      const b = body(p);
      return { x0: b.x - 22 * kc, x1: b.x + 22 * kc, y0: b.feet - PERSON_H * kc, y1: b.feet };
    });
    const hit = (r: Rect) => taken.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0);
    for (const b of [...this.balloons.values()].sort((a, c) => a.at - c.at)) {
      if (!b.mw || !b.w) {
        b.el.style.transform = '';
        b.w = b.el.offsetWidth;
        b.h = b.el.offsetHeight;
        b.mw = 1;
      }
      const p = poses.find((q) => q.a.id === b.who);
      if (!p) continue;
      const { x: hx, feet } = body(p);
      const top = feet - PERSON_H * kc, G = 9, w = b.w, h = b.h, mid = top + 14 * kc;
      type Cand = { l: number; t: number; side: 'b' | 't' | 'l' | 'r' };
      const above = (dx: number, lift: number): Cand => ({ l: hx - w / 2 + dx, t: top - h - G - lift, side: 'b' });
      const cands: Cand[] = [
        above(0, 0), above(-w / 3, 0), above(w / 3, 0),
        { l: hx + 26 * kc, t: mid - h / 2, side: 'l' }, { l: hx - 26 * kc - w, t: mid - h / 2, side: 'r' },
        above(0, h + 6), above(-w / 3, h + 6), above(w / 3, h + 6),
        { l: hx - w / 2, t: feet + G, side: 't' }, { l: hx - w / 2 - w / 3, t: feet + G, side: 't' }, { l: hx - w / 2 + w / 3, t: feet + G, side: 't' },
      ];
      const fit = (c: Cand) => c.l >= 2 && c.t >= 2 && c.l + w <= cw - 2 && c.t + h <= chh - 2;
      const rect = (c: Cand): Rect => ({ x0: c.l, y0: c.t, x1: c.l + w, y1: c.t + h });
      const slide = (c: Cand): Cand => (c.side === 'b' || c.side === 't' ? { ...c, l: Math.max(2, Math.min(cw - w - 2, c.l)) } : c);
      const sl = cands.map(slide);
      const pick = sl.find((c) => fit(c) && !hit(rect(c))) ?? sl.find(fit) ?? { ...sl[0], t: Math.max(2, sl[0].t) };
      taken.push(rect(pick));
      const pos = `translate(${Math.round(pick.l)}px,${Math.round(pick.t)}px)`;
      if (b.pos !== pos) { b.pos = pos; b.el.style.transform = pos; }
      const tail = pick.side;
      if (b.tail !== tail) { b.tail = tail; b.el.dataset.tail = tail; }
      const tv = tail === 'b' || tail === 't' ? `${Math.round(Math.max(10, Math.min(w - 10, hx - pick.l)))}px` : `${Math.round(Math.max(8, Math.min(h - 8, mid - pick.t)))}px`;
      if (b.t !== tv) { b.t = tv; b.el.style.setProperty('--t', tv); }
    }
  }
}
