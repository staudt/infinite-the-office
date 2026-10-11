// Parser for ASCII set maps (see data/sets/README.md for the format).
import { findPath } from './path.ts';

export interface Point { x: number; y: number }
export const key = (p: Point) => `${p.x},${p.y}`;

export interface Region { cells: Point[]; label: { text: string; at: Point } }

export interface SetMap {
  id: string;
  width: number;
  height: number;
  /** Display char per cell after substitution (spots -> seat marker, labels kept as letters). */
  tiles: string[][];
  /** Tile class per cell for CSS: wall|floor|desk|window|plant|door|machine|vending|appliance|shelf|prop|deco|label|seat|spot|exit|void. */
  kinds: string[][];
  walkable(p: Point): boolean;
  spots: Record<string, Point>;
  exits: Record<string, Point[]>;
  regions: Record<string, Region>;
  regionAt(p: Point): string | null;
  /** Shortest walkable path (8-directional, no corner cutting), excluding start, including goal. null if unreachable. */
  path(from: Point, to: Point): Point[] | null;
  /** A walkable non-spot, non-exit cell in the region not in `occupied`, preferring the middle; `pick` is an rng in [0,1). */
  freeCellIn(region: string, occupied: Set<string>, pick: () => number): Point | null;
  /** Nearest walkable cell adjacent to p not in occupied (for "walk up to someone"). */
  nextTo(p: Point, occupied: Set<string>): Point | null;
}

/** Fixed tile legend: char -> [css kind, walkable]. */
const LEGEND: Record<string, [string, boolean]> = {
  '#': ['wall', false], ' ': ['floor', true], '.': ['floor', true], '=': ['desk', false],
  '"': ['window', false], '%': ['plant', false], '+': ['door', true], '&': ['machine', false],
  '$': ['vending', false], '*': ['appliance', false], '[': ['shelf', false], ']': ['shelf', false],
  ':': ['prop', false], '~': ['deco', true],
};

const NEIGHBORS4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** "MICHAEL'S OFFICE" -> "michael_office". */
export function labelName(text: string): string {
  return text.replace(/'S\b/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

interface SpotDef { name: string; render: string }

function parseHeader(lines: string[]) {
  const defs = new Map<string, SpotDef | { exit: string }>();
  const overrides = new Map<string, string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const eq = line.indexOf(' = ');
    if (eq < 1) throw new Error(`bad header line: ${raw}`);
    const k = line.slice(0, eq).trim(), v = line.slice(eq + 3).trim();
    if (k.length > 1 && k.startsWith('@')) { overrides.set(k.slice(1), v); continue; }
    if ([...k].length !== 1) throw new Error(`header key must be one char: ${raw}`);
    if (k in LEGEND) throw new Error(`header key '${k}' clashes with a tile`);
    if (v.startsWith('exit:')) { defs.set(k, { exit: v.slice(5) }); continue; }
    const [name, render = '_'] = v.split(/\s+/);
    defs.set(k, { name, render: render === '.' ? ' ' : render });
  }
  return { defs, overrides };
}

/** Parse a set file's text into a SetMap. Pure: no fs, no DOM. */
export function parseSet(id: string, text: string): SetMap {
  const all = text.replace(/\r/g, '').split('\n');
  const sep = all.findIndex((l) => l.trim() === '---');
  if (sep < 0) throw new Error(`${id}: missing '---' separator`);
  const { defs, overrides } = parseHeader(all.slice(0, sep));
  const rows = all.slice(sep + 1);
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  const height = rows.length, width = Math.max(...rows.map((r) => r.length));
  const raw = rows.map((r) => r.padEnd(width, ' ').split(''));

  const tiles = raw.map((r) => r.slice());
  const kinds: string[][] = raw.map((r) => r.map(() => 'floor'));
  const walk: boolean[][] = raw.map((r) => r.map(() => true));
  const isLabel: boolean[][] = raw.map((r) => r.map(() => false));
  const spots: Record<string, Point> = {};
  const exits: Record<string, Point[]> = {};
  const labels: { text: string; name: string; cells: Point[] }[] = [];

  // Labels: words of capitals/apostrophes joined by single spaces, with at least two letters in a row.
  raw.forEach((r, y) => {
    for (const m of r.join('').matchAll(/[A-Z][A-Z']*(?: [A-Z][A-Z']*)*/g)) {
      if (!/[A-Z]{2}/.test(m[0])) continue;
      const cells = [...m[0]].map((_, i) => ({ x: m.index! + i, y }));
      cells.forEach((c) => { isLabel[y][c.x] = true; kinds[y][c.x] = 'label'; });
      labels.push({ text: m[0], name: overrides.get(m[0]) ?? labelName(m[0]), cells });
    }
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isLabel[y][x]) continue;
      const ch = raw[y][x], def = defs.get(ch), p = { x, y };
      if (def && 'exit' in def) {
        kinds[y][x] = 'exit';
        (exits[def.exit] ??= []).push(p);
      } else if (def) {
        if (spots[def.name]) throw new Error(`${id}: duplicate spot ${def.name}`);
        spots[def.name] = p;
        tiles[y][x] = def.render;
        kinds[y][x] = def.render === '_' ? 'seat' : 'spot';
      } else if (LEGEND[ch]) {
        const [kind, w] = LEGEND[ch];
        kinds[y][x] = kind;
        walk[y][x] = w;
        if (ch === '.') tiles[y][x] = ' ';
      } else throw new Error(`${id}: unknown tile '${ch}' at ${x},${y}`);
    }
  }

  // Void: plain floor reachable from the border without crossing anything drawn.
  const stack: Point[] = [];
  const voidIfPlain = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (raw[y][x] !== ' ' || isLabel[y][x] || kinds[y][x] === 'void') return;
    kinds[y][x] = 'void';
    walk[y][x] = false;
    stack.push({ x, y });
  };
  for (let x = 0; x < width; x++) { voidIfPlain(x, 0); voidIfPlain(x, height - 1); }
  for (let y = 0; y < height; y++) { voidIfPlain(0, y); voidIfPlain(width - 1, y); }
  for (let p = stack.pop(); p; p = stack.pop()) for (const [dx, dy] of NEIGHBORS4) voidIfPlain(p.x + dx, p.y + dy);

  const inBounds = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const walkable = (p: Point) => inBounds(p) && walk[p.y][p.x];

  // Regions: multi-source BFS from label cells. Doors are walkable but never claimed or expanded,
  // so they belong to no region and walls/doors bound each room.
  const owner: (string | null)[][] = raw.map((r) => r.map(() => null));
  const regions: Record<string, Region> = {};
  let queue: Point[] = [];
  for (const l of labels) {
    regions[l.name] ??= { cells: [], label: { text: l.text, at: l.cells[0] } };
    for (const c of l.cells) { owner[c.y][c.x] = l.name; queue.push(c); }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of NEIGHBORS4) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (!walkable(q) || owner[q.y][q.x] || kinds[q.y][q.x] === 'door') continue;
      owner[q.y][q.x] = owner[p.y][p.x];
      queue.push(q);
    }
  }
  for (const p of queue) regions[owner[p.y][p.x]!].cells.push(p);
  queue = [];
  for (const r of Object.values(regions)) r.cells.sort((a, b) => a.y - b.y || a.x - b.x);

  const middle = new Map<string, Point[]>();
  const candidates = (region: string): Point[] => {
    let c = middle.get(region);
    if (c) return c;
    const cells = regions[region]?.cells ?? [];
    const plain = cells.filter((p) => ['floor', 'deco'].includes(kinds[p.y][p.x]));
    const pool = plain.length ? plain : cells.filter((p) => !['exit'].includes(kinds[p.y][p.x]));
    const cx = cells.reduce((s, p) => s + p.x, 0) / (cells.length || 1), cy = cells.reduce((s, p) => s + p.y, 0) / (cells.length || 1);
    const d = (p: Point) => (p.x - cx) ** 2 + ((p.y - cy) * 2) ** 2; // cells are ~2x taller than wide
    c = pool.slice().sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
    middle.set(region, c);
    return c;
  };

  return {
    id, width, height, tiles, kinds, spots, exits, regions, walkable,
    regionAt: (p) => (inBounds(p) ? owner[p.y][p.x] : null),
    path: (from, to) => findPath(width, height, (x, y) => walk[y][x], from, to),
    freeCellIn(region, occupied, pick) {
      const free = candidates(region).filter((p) => !occupied.has(key(p)));
      if (!free.length) return null;
      const pool = free.slice(0, Math.max(1, Math.ceil(free.length / 2)));
      return pool[Math.floor(pick() * pool.length)];
    },
    nextTo(p, occupied) {
      for (let r = 1; r <= 4; r++) {
        let best: Point | null = null, bestScore = Infinity;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const q = { x: p.x + dx, y: p.y + dy };
            if (!walkable(q) || occupied.has(key(q))) continue;
            const kind = kinds[q.y][q.x];
            const score = dx * dx + dy * dy + (kind === 'floor' || kind === 'deco' ? 0 : 3);
            if (score < bestScore) { best = q; bestScore = score; }
          }
        }
        if (best) return best;
      }
      return null;
    },
  };
}
