import { describe, expect, it } from 'vitest';
import { type Img, anchorStrip, blank, components, keyMagenta, mergeComps, readingOrder, resize, trim } from '../src/cli/sprites/pixels';

const px = (im: Img, x: number, y: number, c: number[]) => im.data.set(c, (y * im.w + x) * 4);
const alpha = (im: Img, x: number, y: number) => im.data[(y * im.w + x) * 4 + 3];
const magenta = (w: number, h: number): Img => { const im = blank(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(im, x, y, [250, 0, 250, 255]); return im; };

describe('sprite pixels', () => {
  it('keys magenta, keeps the block, finds one trimmed component', () => {
    const im = magenta(6, 6);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) px(im, x, y, [128, 128, 128, 255]);
    keyMagenta(im);
    expect(alpha(im, 0, 0)).toBe(0);
    expect(alpha(im, 2, 2)).toBe(255);
    const { comps } = components(im);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ x0: 2, y0: 2, x1: 3, y1: 3, area: 4 });
    expect(trim(im).w).toBe(2);
  });
  it('turns dark magenta into translucent black', () => {
    const im = magenta(6, 6);
    px(im, 3, 3, [100, 0, 100, 255]);
    keyMagenta(im);
    expect(Array.from(im.data.subarray((3 * 6 + 3) * 4, (3 * 6 + 3) * 4 + 3))).toEqual([0, 0, 0]);
    expect(alpha(im, 3, 3)).toBeGreaterThan(0);
    expect(alpha(im, 3, 3)).toBeLessThan(140);
  });
  it('merges overlapping boxes only and orders by rows', () => {
    const g = mergeComps([{ x0: 0, y0: 0, x1: 9, y1: 9, area: 1, label: 0 }, { x0: 5, y0: 8, x1: 9, y1: 15, area: 1, label: 1 }, { x0: 30, y0: 0, x1: 39, y1: 9, area: 1, label: 2 }], 0);
    expect(g).toHaveLength(2);
    const o = readingOrder([{ x0: 50, y0: 0, x1: 60, y1: 10 }, { x0: 0, y0: 200, x1: 10, y1: 210 }, { x0: 0, y0: 0, x1: 10, y1: 10 }]);
    expect(o.map((b) => [b.x0, b.y0])).toEqual([[0, 0], [50, 0], [0, 200]]);
  });
  it('anchors feet to the cell bottom and downscales', () => {
    const a = blank(2, 4), b = blank(4, 2);
    a.data.fill(255); b.data.fill(255);
    const { strip, cellW, cellH } = anchorStrip([a, b], 0);
    expect([cellW, cellH, strip.w]).toEqual([4, 4, 8]);
    expect(alpha(strip, 5, 3)).toBe(255);
    expect(alpha(strip, 5, 1)).toBe(0);
    expect(resize(a, 1, 2).data[3]).toBe(255);
  });
});
