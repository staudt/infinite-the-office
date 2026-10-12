// Pure pixel helpers for the sprite pipeline (RGBA, row-major, no deps).
export interface Img { w: number; h: number; data: Uint8Array }
export interface Box { x0: number; y0: number; x1: number; y1: number } // inclusive
export interface Comp extends Box { area: number; label: number }

export const blank = (w: number, h: number): Img => ({ w, h, data: new Uint8Array(w * h * 4) });
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Median colour of the 1px border = the flat background.
export function borderColor(img: Img): [number, number, number] {
  const ch: number[][] = [[], [], []];
  const take = (x: number, y: number) => { const i = (y * img.w + x) * 4; for (let c = 0; c < 3; c++) ch[c].push(img.data[i + c]); };
  for (let x = 0; x < img.w; x++) { take(x, 0); take(x, img.h - 1); }
  for (let y = 1; y < img.h - 1; y++) { take(0, y); take(img.w - 1, y); }
  return ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]) as [number, number, number];
}

export interface KeyOpts { shadowMax?: number; edge?: number; minArea?: number }
// Chroma-key a magenta sheet in place. Bright bg -> clear; dark magenta (shadow) -> translucent black;
// magenta-tinted pixels near the cut-out edge get despilled so no purple fringe survives.
export function keyMagenta(img: Img, o: KeyOpts = {}): void {
  const { shadowMax = 0.5, edge = 3 } = o;
  const bg = borderColor(img);
  const bgMax = Math.max(bg[0], bg[2], 1);
  const { w, h, data: d } = img;
  const tint = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, b);
    const s = Math.min(r, b) - g, t = mx > 0 ? s / mx : 0, bal = Math.abs(r - b) / Math.max(mx, 1);
    d[i + 3] = 255;
    tint[p] = t;
    if (t > (mx < bgMax * 0.85 ? 0.6 : 0.75) && bal < 0.3) {
      const dark = 1 - mx / bgMax;
      if (dark < 0.15) d[i + 3] = 0;
      else { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = Math.round(Math.min(shadowMax, dark * 0.7) * 255); }
    }
  }
  // Despill opaque pixels within `edge` px of a fully transparent pixel.
  const clear = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || d[(y * w + x) * 4 + 3] === 0;
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!clear(x, y)) continue;
    for (let dy = -edge; dy <= edge; dy++) for (let dx = -edge; dx <= edge; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) near[Y * w + X] = 1;
    }
  }
  for (let p = 0; p < w * h; p++) {
    const i = p * 4, t = tint[p];
    if (!near[p] || d[i + 3] !== 255 || t < 0.12) continue;
    const m = (Math.min(d[i], d[i + 2]) - d[i + 1]) * 0.9;
    d[i] = clamp(d[i] - m); d[i + 2] = clamp(d[i + 2] - m);
    if (t > 0.55) d[i + 3] = Math.round(255 * (1 - Math.min(1, (t - 0.55) / 0.3) * 0.85));
  }
}

/**
 * Keys out any flat background color (not just magenta): flood-fills from the border over pixels close to the
 * border color, then drops the 1 px blended fringe. Only background connected to the edge goes, so similar
 * colors inside the art survive.
 */
export function keyBorder(img: Img, tol = 70): void {
  const bg = borderColor(img), { w, h, data: d } = img;
  const dist = (p: number) => Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]);
  for (let p = 0; p < w * h; p++) d[p * 4 + 3] = 255;
  const stack: number[] = [];
  const push = (p: number) => { if (d[p * 4 + 3] === 255 && dist(p) < tol) { d[p * 4 + 3] = 0; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!, x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  const fringe: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (d[p * 4 + 3] !== 255 || dist(p) > tol * 2) continue;
    const x = p % w;
    if ((x > 0 && !d[(p - 1) * 4 + 3]) || (x < w - 1 && !d[(p + 1) * 4 + 3]) || (p >= w && !d[(p - w) * 4 + 3]) || (p < w * (h - 1) && !d[(p + w) * 4 + 3])) fringe.push(p);
  }
  for (const p of fringe) d[p * 4 + 3] = 0;
  // Pockets of background enclosed by the art (between strands of hair): near-exact matches only.
  for (let p = 0; p < w * h; p++) if (d[p * 4 + 3] && dist(p) < tol * 0.6) d[p * 4 + 3] = 0;
}

// 8-connected components over alpha > thr, labels row-major order of first pixel.
export function components(img: Img, thr = 127): { comps: Comp[]; labels: Int32Array } {
  const { w, h, data: d } = img;
  const labels = new Int32Array(w * h).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (labels[s] >= 0 || d[s * 4 + 3] <= thr) continue;
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, area: 0, label: comps.length };
    labels[s] = c.label; stack.push(s);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p / w) | 0;
      c.area++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (labels[q] < 0 && d[q * 4 + 3] > thr) { labels[q] = c.label; stack.push(q); }
      }
    }
    comps.push(c);
  }
  return { comps, labels };
}

// Merge components whose bboxes are within `gap` px; returns merged groups (label sets + bbox).
export interface Group extends Box { labels: number[]; area: number }
export function mergeComps(comps: Comp[], gap: number): Group[] {
  const par = comps.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
    const a = comps[i], b = comps[j];
    if (a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1) par[find(j)] = find(i);
  }
  const map = new Map<number, Group>();
  comps.forEach((c, i) => {
    const r = find(i), g = map.get(r);
    if (!g) map.set(r, { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, labels: [c.label], area: c.area });
    else { g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); g.labels.push(c.label); g.area += c.area; }
  });
  return [...map.values()];
}

// Reading order: rows are clusters of y-centres (new row when the centre jumps > rowGap), then x.
export function readingOrder<T extends Box>(items: T[], rowGap = 70): T[] {
  const cy = (i: Box) => (i.y0 + i.y1) / 2;
  const rows: T[][] = [];
  for (const it of [...items].sort((a, b) => cy(a) - cy(b))) {
    const last = rows[rows.length - 1];
    if (last && cy(it) - cy(last[0]) < rowGap) last.push(it); else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x0 - b.x0));
}

// Drop solid components under minArea (alpha -> 0).
export function removeSpecks(img: Img, minArea: number): void {
  const { comps, labels } = components(img);
  const dead = new Set(comps.filter((c) => c.area < minArea).map((c) => c.label));
  for (let p = 0; p < labels.length; p++) if (dead.has(labels[p])) img.data[p * 4 + 3] = 0;
}

export function crop(img: Img, b: Box, keep?: (x: number, y: number) => boolean): Img {
  const out = blank(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || (keep && !keep(x, y))) continue;
    const s = (y * img.w + x) * 4, o = ((y - b.y0) * out.w + (x - b.x0)) * 4;
    out.data.set(img.data.subarray(s, s + 4), o);
  }
  return out;
}

export function alphaBox(img: Img, thr = 0): Box | null {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3] > thr) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
export const trim = (img: Img, thr = 0): Img => { const b = alphaBox(img, thr); return b ? crop(img, b) : img; };

// Area-average (box filter) resample, alpha-premultiplied so edges don't darken.
export function resize(img: Img, w: number, h: number): Img {
  if (w === img.w && h === img.h) return img;
  const out = blank(w, h), sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
      const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
      for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
        const wt = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0)), i = (yy * img.w + xx) * 4, al = img.data[i + 3] * wt;
        r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; wsum += wt;
      }
    }
    const o = (y * w + x) * 4;
    if (a > 0) { out.data[o] = Math.round(r / a); out.data[o + 1] = Math.round(g / a); out.data[o + 2] = Math.round(b / a); }
    out.data[o + 3] = wsum > 0 ? Math.round(a / wsum) : 0;
  }
  return out;
}
export const scaleBy = (img: Img, s: number): Img => resize(img, Math.max(1, Math.round(img.w * s)), Math.max(1, Math.round(img.h * s)));
export function fitMax(img: Img, maxW?: number, maxH?: number): Img {
  const s = Math.min(maxW ? maxW / img.w : 1, maxH ? maxH / img.h : 1, 1);
  return s < 1 ? scaleBy(img, s) : img;
}

// Place frames in a common cell: centred on bbox centre, feet (bbox bottom) on the bottom row.
export function anchorStrip(frames: Img[], pad = 2): { strip: Img; cellW: number; cellH: number; anchorX: number; anchorY: number } {
  const cellW = Math.max(...frames.map((f) => f.w)) + pad * 2, cellH = Math.max(...frames.map((f) => f.h)) + pad;
  const strip = blank(cellW * frames.length, cellH);
  frames.forEach((f, n) => {
    const ox = n * cellW + ((cellW - f.w) >> 1), oy = cellH - f.h;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const s = (y * f.w + x) * 4, o = ((oy + y) * strip.w + ox + x) * 4;
      strip.data.set(f.data.subarray(s, s + 4), o);
    }
  });
  return { strip, cellW, cellH, anchorX: cellW >> 1, anchorY: cellH - 1 };
}
