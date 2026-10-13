// Layout sets (`*.layout.json`, see data/sets/README.md): an art-scale floor plan in world px,
// rasterized onto a square grid so path-finding, spots and regions work like any other set.
// Everything here is lenient: missing fields get defaults, unknown sprites get a default footprint.
import SIZES from '../../data/sets/prop-sizes.json';
import { assemble, type Point, type Region, type SetMap } from './parse.ts';

export interface Rect { x: number; y: number; w: number; h: number }
export type Facing = 'down' | 'up' | 'left' | 'right';
export interface LDoor extends Rect { exit?: string | string[] }
export type LWindow = Rect;
export interface LDecor { sprite: string; x: number; y: number; scale?: number }
export interface LProp {
  sprite: string;
  /** Bottom-center of the sprite, world px. */
  x: number; y: number;
  flip?: boolean;
  scale?: number;
  /** Size for sprites with no art (procedural props such as the water cooler). */
  w?: number; h?: number;
  /** Blocking rect(s) in px from the sprite's top-left (unscaled, mirrored with `flip`); `null` = walk-through. Default: the lower part of the sprite. */
  solid?: Rect | Rect[] | null;
  /** Px from the sprite's top: the rows above are drawn behind anyone standing at the prop (a desk with a hutch, so the sitter shows between hutch and desk). */
  split?: number;
}
export interface LSpot {
  x: number; y: number;
  /** Direction the sitter faces; absent = a standing spot. A chair is drawn unless `chair` is false (baked into the prop art). */
  seat?: Facing;
  chair?: boolean;
  /** Draw the sitter over the prop they sit at (default for left/right seats, e.g. baked-in pod chairs). */
  front?: boolean;
}
export interface Layout {
  width: number; height: number; cell: number;
  floor: (Rect & { style?: string })[];
  walls: Rect[];
  doors: LDoor[];
  windows: LWindow[];
  decor: LDecor[];
  props: LProp[];
  spots: Record<string, LSpot>;
  regions: Record<string, Rect[]>;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rect = (r: Partial<Rect> | undefined): Rect => ({ x: num(r?.x), y: num(r?.y), w: num(r?.w), h: num(r?.h) });
const list = <T>(v: unknown, f: (x: any) => T): T[] => (Array.isArray(v) ? v.map(f) : []);

/** Coerce parsed JSON into a Layout (lenient: defaults for anything missing). */
export function parseLayout(raw: any): Layout {
  return {
    width: num(raw?.width), height: num(raw?.height), cell: num(raw?.cell, 16) || 16,
    floor: list(raw?.floor, (f) => ({ ...rect(f), style: typeof f?.style === 'string' ? f.style : 'carpet' })),
    walls: list(raw?.walls, rect),
    doors: list(raw?.doors, (d) => ({ ...rect(d), exit: d?.exit })),
    windows: list(raw?.windows, rect),
    decor: list(raw?.decor, (d) => ({ sprite: String(d?.sprite ?? ''), x: num(d?.x), y: num(d?.y), scale: d?.scale })),
    props: list(raw?.props, (p) => ({ sprite: String(p?.sprite ?? ''), x: num(p?.x), y: num(p?.y), flip: !!p?.flip, scale: p?.scale, w: p?.w, h: p?.h, split: p?.split, solid: p?.solid === null ? null : Array.isArray(p?.solid) ? p.solid.map(rect) : p?.solid ? rect(p.solid) : undefined })),
    spots: Object.fromEntries(Object.entries(raw?.spots ?? {}).map(([k, s]: [string, any]) => [k, { x: num(s?.x), y: num(s?.y), seat: s?.seat, chair: s?.chair, front: s?.front }])),
    regions: Object.fromEntries(Object.entries(raw?.regions ?? {}).map(([k, v]) => [k, list(v, rect)])),
  };
}

const sizes = SIZES as Record<string, { w: number; h: number }>;
/** Sprite size in px at scale 1 (the layout may override with w/h for procedural props). */
export function propSize(p: LProp): { w: number; h: number } {
  const e = sizes[p.sprite], s = p.scale ?? 1;
  return { w: (p.w ?? e?.w ?? 32) * s, h: (p.h ?? e?.h ?? 32) * s };
}

/** Top-left and size of a prop's sprite rect in world px. */
export function propRect(p: LProp): Rect {
  const { w, h } = propSize(p);
  return { x: p.x - w / 2, y: p.y - h, w, h };
}

/** The blocking rects of a prop in world px. */
export function solidRects(p: LProp): Rect[] {
  if (p.solid === null) return [];
  const r = propRect(p), s = p.scale ?? 1;
  if (p.solid) {
    return [p.solid].flat().map((q) => {
      const sx = q.x * s, sw = q.w * s;
      return { x: r.x + (p.flip ? r.w - sx - sw : sx), y: r.y + q.y * s, w: sw, h: q.h * s };
    });
  }
  // Plants block only their pot; everything else its lower part (capped, so tall shelves don't wall off the floor).
  if (/^plant/.test(p.sprite)) return [{ x: r.x + r.w * 0.3, y: r.y + r.h - 24, w: r.w * 0.4, h: 22 }];
  const d = Math.min(r.h * 0.5, 56);
  return [{ x: r.x, y: r.y + r.h - d, w: r.w, h: d }];
}

/** The CSS-ish kind the grid reports for a prop's cells. */
export function propKind(sprite: string): string {
  if (/^plant/.test(sprite)) return 'plant';
  if (/desk|table|counter|reception|couch|sofa|armchair/.test(sprite)) return 'desk';
  if (/copier|printer|water/.test(sprite)) return 'machine';
  if (/shelf|cabinet|credenza|wardrobe|coat|bookcase/.test(sprite)) return 'shelf';
  return 'prop';
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** Rasterize a layout onto its square grid: a cell is blocked when mostly covered by a wall (door gaps excepted) or a prop's solid rect. */
export function buildLayoutSet(id: string, L: Layout): SetMap {
  const c = L.cell, width = Math.ceil(L.width / c), height = Math.ceil(L.height / c);
  const grid = <T>(v: T) => Array.from({ length: height }, () => Array.from({ length: width }, () => v));
  const kinds = grid('void'), walk = grid(false), owner = grid<string | null>(null);
  const cellRect = (x: number, y: number): Rect => ({ x: x * c, y: y * c, w: c, h: c });
  const mostly = (r: Rect, rs: Rect[]) => rs.some((o) => overlap(r, o) > c * c * 0.4);
  const spots: Record<string, Point> = {};
  const exits: Record<string, Point[]> = {};
  const solids = L.props.flatMap((p) => solidRects(p).map((s) => ({ s, kind: propKind(p.sprite) })));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = cellRect(x, y), cx = r.x + c / 2, cy = r.y + c / 2;
      if (L.floor.some((f) => inside(f, cx, cy))) { kinds[y][x] = 'floor'; walk[y][x] = true; }
      if (L.doors.some((d) => inside(d, cx, cy))) { kinds[y][x] = 'door'; walk[y][x] = true; continue; }
      if (mostly(r, L.walls)) { kinds[y][x] = 'wall'; walk[y][x] = false; continue; }
      const s = solids.find((o) => overlap(r, o.s) > c * c * 0.4);
      if (s) { kinds[y][x] = s.kind; walk[y][x] = false; }
    }
  }
  const cellOf = (x: number, y: number): Point => ({ x: Math.max(0, Math.min(width - 1, Math.floor(x / c))), y: Math.max(0, Math.min(height - 1, Math.floor(y / c))) });
  for (const [name, s] of Object.entries(L.spots)) {
    const p = cellOf(s.x, s.y);
    spots[name] = p;
    walk[p.y][p.x] = true;
    kinds[p.y][p.x] = s.seat ? 'seat' : 'spot';
  }
  for (const d of L.doors) {
    const names = d.exit ? [d.exit].flat() : [];
    if (!names.length) continue;
    for (let y = Math.floor(d.y / c); y < Math.ceil((d.y + d.h) / c); y++) {
      for (let x = Math.floor(d.x / c); x < Math.ceil((d.x + d.w) / c); x++) {
        if (x < 0 || y < 0 || x >= width || y >= height || !inside(d, x * c + c / 2, y * c + c / 2)) continue;
        for (const n of names) (exits[n] ??= []).push({ x, y });
        kinds[y][x] = 'exit';
      }
    }
  }

  // Regions are rects: a walkable non-door cell belongs to the first region whose rect holds its center.
  const regions: Record<string, Region> = {};
  for (const [name, rs] of Object.entries(L.regions)) {
    const cells: Point[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!walk[y][x] || owner[y][x] || kinds[y][x] === 'door' || kinds[y][x] === 'exit') continue;
        if (!rs.some((r) => inside(r, x * c + c / 2, y * c + c / 2))) continue;
        owner[y][x] = name;
        cells.push({ x, y });
      }
    }
    const mx = cells.reduce((s, p) => s + p.x, 0) / (cells.length || 1), my = cells.reduce((s, p) => s + p.y, 0) / (cells.length || 1);
    const at = cells.reduce<Point | null>((b, p) => (!b || (p.x - mx) ** 2 + (p.y - my) ** 2 < (b.x - mx) ** 2 + (b.y - my) ** 2 ? p : b), null) ?? { x: 0, y: 0 };
    regions[name] = { cells, label: { text: name.replace(/_/g, ' ').toUpperCase(), at } };
  }

  return assemble({ id, width, height, cellW: c, cellH: c, kinds, walk, spots, exits, regions, owner, gap: 2, layout: L });
}
