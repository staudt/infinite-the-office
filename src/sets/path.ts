import type { Point } from './parse.ts';

const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

/** Minimal binary min-heap keyed by a number. */
class Heap {
  private a: { k: number; v: number }[] = [];
  get size() { return this.a.length; }
  push(k: number, v: number) {
    const a = this.a;
    a.push({ k, v });
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.v;
  }
}

/**
 * A* over a walkable grid, 8-directional; diagonals may not cut corners (both orthogonal
 * neighbours must be walkable). Returns the steps excluding `from`, including `to`; null if unreachable.
 */
export function findPath(width: number, height: number, walk: (x: number, y: number) => boolean, from: Point, to: Point): Point[] | null {
  if (!walk(from.x, from.y) || !walk(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const n = width * height, goal = to.y * width + to.x, start = from.y * width + from.x;
  const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const h = (i: number) => {
    const dx = Math.abs((i % width) - to.x), dy = Math.abs(Math.floor(i / width) - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  g[start] = 0;
  open.push(h(start), start);
  while (open.size) {
    const cur = open.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % width, cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height || !walk(x, y)) continue;
      if (dx && dy && !(walk(cx + dx, cy) && walk(cx, cy + dy))) continue;
      const ni = y * width + x, ng = g[cur] + (dx && dy ? Math.SQRT2 : 1);
      if (ng < g[ni]) {
        g[ni] = ng;
        prev[ni] = cur;
        open.push(ng + h(ni), ni);
      }
    }
  }
  if (prev[goal] < 0) return null;
  const out: Point[] = [];
  for (let i = goal; i !== start; i = prev[i]) out.push({ x: i % width, y: Math.floor(i / width) });
  return out.reverse();
}
