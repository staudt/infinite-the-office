// The procedural ASCII sets (break room, kitchen, annex, parking lot, warehouse, offsite): no floor plan, so props
// are found as solid blocks in the logic grid, chairs as seat cells, and the floor is painted per cell. Builds the
// same Plan the layout sets use (plan.ts), so the map view has one drawing path.
import PROPS from '../../data/sets/props.json';
import type { SetMap } from '../sets/index.ts';
import { art } from './art';
import { ASCII, BG_SCALE, GEO_ASCII } from './geometry';
import { chairItem, type Chair, type Dir, type Item, type Plan } from './plan';

const CW = ASCII.cw, CH = ASCII.ch;
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
  const [fx, fy] = GEO_ASCII.foot(x, y);
  const at = (dir: Dir, face: 1 | -1): Chair => ({ x, y, fx, fy, dir, face, draw: true, front: null });
  if (desk(x, y + 1)) return at('front', 1);
  if (desk(x, y - 1)) return at('back', 1);
  if (desk(x - 1, y)) return at('side', -1);
  if (desk(x + 1, y)) return at('side', 1);
  let best: [number, number] | null = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) if (desk(x + dx, y + dy) && dx * dx + dy * dy * 2 < bd) { bd = dx * dx + dy * dy * 2; best = [dx, dy]; }
  }
  if (!best) return at('front', 1);
  const [dx, dy] = best;
  return Math.abs(dy) >= Math.abs(dx) ? at(dy > 0 ? 'front' : 'back', 1) : at('side', dx > 0 ? 1 : -1);
}

// ---------------------------------------------------------------- static layer

function floorColor(set: SetMap, x: number, y: number): string {
  const n = hash(x, y, 1) - 0.5;
  const region = set.regionAt({ x, y }) ?? '';
  const tile = ['break_room', 'kitchen'].includes(set.id) || region === 'kitchen' || region === 'break_room';
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
      if (set.regionAt({ x, y }) === 'kitchen' || set.id === 'break_room' || set.id === 'kitchen') {
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

/** A prop block as a sort item: sprite scaled into its cells, or a colored box. */
function drawBlock(ctx: CanvasRenderingContext2D, b: Block): void {
  const x = b.x0 * CW, y = b.y0 * CH, w = b.w * CW, h = b.h * CH, B = y + h;
  const e = b.sprite ? art.index.props?.[b.sprite] : null;
  const im = b.sprite ? art.image(b.sprite) : null;
  if (e && im) {
    const s = Math.min((w + (b.w < 3 ? CW : 0)) / e.w, (h + 64) / e.h);
    ctx.drawImage(im, x + w / 2 - (e.w * s) / 2, B - e.h * s, e.w * s, e.h * s);
    return;
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

/** The ASCII set as a Plan. `prev` is the earlier plan of the same set: the static layer is kept, the sprites re-chosen (images load late). */
export function buildAscii(set: SetMap, prev?: Plan): Plan {
  const blocks = findBlocks(set);
  for (const b of blocks) b.sprite = chooseSprite(set, b);
  const chairs: Chair[] = [];
  for (let y = 0; y < set.height; y++) for (let x = 0; x < set.width; x++) if (set.kinds[y][x] === 'seat') chairs.push(seatOf(set, x, y));
  const items: Item[] = blocks.map((b) => {
    const B = (b.y0 + b.h) * CH, { side, up } = ASCII.blockPad;
    return { k: B, x0: b.x0 * CW - side, y0: b.y0 * CH - up, x1: (b.x0 + b.w) * CW + side, y1: B, f: (ctx) => drawBlock(ctx, b) };
  });
  items.push(...chairs.filter((c) => c.draw).map(chairItem));
  return {
    bg: prev?.bg ?? paintBg(set), W: set.width * CW, H: set.height * CH, items, chairs, sides: [],
    ready: () => blocks.every((b) => b.sprite === null || !!art.image(b.sprite)),
    torsoKey: (x, y) => {
      const desk = blocks.find((b) => x >= b.x0 && x < b.x0 + b.w && y + 1 >= b.y0 && y + 1 < b.y0 + b.h);
      return desk ? (desk.y0 + desk.h) * CH + 0.1 : null;
    },
  };
}

