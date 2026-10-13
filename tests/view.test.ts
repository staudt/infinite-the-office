import { describe, expect, it } from 'vitest';
import { bodyRect, placeBalloon, type ScreenRect } from '../src/view/balloons';
import { clamp, ease, frame, regionBox, shotBox, widenFor } from '../src/view/camera';
import { GEO_ASCII, OPENING_ZOOM, SPEAKER_MARGIN, VIEW_PAD, type Geo } from '../src/view/geometry';

// A layout-style geo: 16 px cells, 96 px people.
const geo: Geo = { cw: 16, ch: 16, personH: 96, maxZoom: 2.5, pad: VIEW_PAD, feetPad: 0, foot: (x, y) => [(x + 0.5) * 16, (y + 0.5) * 16] };
const ASPECT = 16 / 9;

describe('camera', () => {
  it('pads a region by the set padding and falls back to the whole set', () => {
    const cells = [{ x: 10, y: 20 }, { x: 14, y: 22 }];
    expect(regionBox(cells, { w: 800, h: 600 }, geo)).toEqual({ x0: 160 - VIEW_PAD.side, y0: 320 - VIEW_PAD.top, x1: 15 * 16 + VIEW_PAD.side, y1: 23 * 16 + VIEW_PAD.bottom });
    expect(regionBox(undefined, { w: 800, h: 600 }, geo)).toEqual({ x0: 0, y0: 0, x1: 800, y1: 600 });
    expect(regionBox([{ x: 1, y: 1 }], { w: 32, h: 64 }, GEO_ASCII)).toEqual({ x0: 16 - 32, y0: 32 - 64, x1: 32 + 32, y1: 64 + 64 });
  });
  it('clamps the view inside the set and centers it when it is larger', () => {
    const c = clamp({ cx: 0, cy: 0, w: 400 }, 1000, 1000, ASPECT);
    expect(c.cx).toBe(200);
    expect(c.cy).toBeCloseTo(400 / ASPECT / 2);
    const far = clamp({ cx: 5000, cy: 5000, w: 400 }, 1000, 1000, ASPECT);
    expect(far.cx).toBe(800);
    expect(far.cy).toBeCloseTo(1000 - 400 / ASPECT / 2);
    expect(clamp({ cx: 5, cy: 5, w: 2000 }, 1000, 800, ASPECT)).toMatchObject({ cx: 500, cy: 400 });
  });
  it('frames a box at the canvas aspect, within the zoom cap and the set', () => {
    const W = 1000, H = 1000;
    const c = frame({ x0: 400, y0: 400, x1: 600, y1: 500 }, W, H, ASPECT, 2.5);
    expect(c.w).toBeCloseTo(W * ASPECT / 2.5); // tiny box: capped by max zoom (fit width = H * aspect)
    expect(c.cx).toBe(500);
    const wide = frame({ x0: 0, y0: 0, x1: 5000, y1: 100 }, W, H, ASPECT, 2.5);
    expect(wide.w).toBeCloseTo(H * ASPECT); // never wider than the set fits
    const tall = frame({ x0: 400, y0: 0, x1: 500, y1: 900 }, W, H, ASPECT, 2.5);
    expect(tall.w).toBeCloseTo(900 * ASPECT); // a tall box widens the view to fit its height
    const open = frame({ x0: 400, y0: 400, x1: 450, y1: 420 }, W, H, ASPECT, 2.5, true);
    expect(open.w).toBeCloseTo(c.w * 0 + (H * ASPECT) / (2.5 * OPENING_ZOOM));
  });
  it('keeps speakers in frame and eases toward the goal', () => {
    const box = widenFor({ x0: 100, y0: 100, x1: 200, y1: 200 }, [[400, 300]], geo.personH);
    expect(box).toEqual({ x0: 100, y0: 100, x1: 400 + SPEAKER_MARGIN.side, y1: 300 + SPEAKER_MARGIN.bottom });
    const up = widenFor({ x0: 100, y0: 100, x1: 200, y1: 200 }, [[150, 150]], geo.personH);
    expect(up.y0).toBe(150 - geo.personH - SPEAKER_MARGIN.top);
    const a = { cx: 300, cy: 300, w: 400 }, goal = { cx: 500, cy: 500, w: 800 };
    const e = ease(a, goal, 0.1, 2.5, 2000, 2000, ASPECT);
    expect(e.cx).toBeGreaterThan(300);
    expect(e.cx).toBeLessThan(500);
    expect(ease(a, goal, 0, 2.5, 2000, 2000, ASPECT)).toEqual(clamp(a, 2000, 2000, ASPECT));
  });
  it('frames a forced shot a little above the cell', () => {
    const b = shotBox({ at: { x: 10, y: 10 }, span: 8 }, geo, ASPECT);
    expect((b.x0 + b.x1) / 2).toBe(168);
    expect(b.x1 - b.x0).toBe(128);
    expect((b.y0 + b.y1) / 2).toBeLessThan(168);
  });
});

describe('balloon placement', () => {
  const CW = 800, CH = 450, k = 2, bodyH = 96 * k;
  const sized = { w: 160, h: 50 };
  const inside = (r: ScreenRect) => r.x0 >= 0 && r.y0 >= 0 && r.x1 <= CW && r.y1 <= CH;
  const overlap = (a: ScreenRect, b: ScreenRect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const place = (x: number, feet: number, bodies: ScreenRect[] = [], balloons: ScreenRect[] = []) => placeBalloon(sized.w, sized.h, x, feet, bodyH, k, CW, CH, bodies, balloons);
  /** The tail sits on the edge facing the speaker, right at them. */
  const pointsAt = (p: ReturnType<typeof place>, x: number) => {
    if (p.side === 'b' || p.side === 't') expect(p.l + p.tail).toBeCloseTo(x);
    expect(p.tail).toBeGreaterThan(0);
    expect(p.tail).toBeLessThan(p.side === 'b' || p.side === 't' ? sized.w : sized.h);
  };

  it('prefers above the head, centered on the speaker', () => {
    const p = place(400, 400, [bodyRect(400, 400, bodyH, k)]);
    expect(p.side).toBe('b');
    expect(p.rect.y1).toBeLessThan(400 - bodyH);
    expect((p.rect.x0 + p.rect.x1) / 2).toBe(400);
    expect(p.tail).toBe(80);
  });
  it('near a canvas edge, slides and moves the tail so it still points at the speaker', () => {
    const p = place(40, 400);
    expect(p.side).toBe('b');
    expect(p.l).toBe(2);
    pointsAt(p, 40);
    const q = place(780, 400);
    expect(q.l + sized.w).toBe(CW - 2);
    pointsAt(q, 780);
  });
  it('goes beside the speaker when above is off-screen', () => {
    const p = place(400, 200, [bodyRect(400, 200, bodyH, k)]);
    expect(p.side === 'l' || p.side === 'r').toBe(true);
    expect(inside(p.rect)).toBe(true);
    pointsAt(p, 400);
  });
  it('never overlaps another balloon, and stays close', () => {
    const first = place(400, 400);
    const second = place(400, 400, [], [first.rect]);
    expect(overlap(second.rect, first.rect)).toBe(false);
    pointsAt(second, 400);
    expect(Math.abs(second.rect.y1 - (400 - bodyH))).toBeLessThan(sized.h * 2 + 30);
  });
  it('shifts off the head of someone standing behind when that is cheap', () => {
    const other = bodyRect(400 + 60, 300, bodyH, k);
    const p = place(400, 400, [bodyRect(400, 400, bodyH, k), other]);
    expect(p.side).toBe('b');
    pointsAt(p, 400);
    expect(p.rect.x1).toBeLessThanOrEqual(other.x0 + 1);
  });
  it('never covers the speaker and never leaves the canvas', () => {
    for (const [x, feet] of [[400, 60], [5, 30], [795, 440], [400, 225], [0, 0], [820, 460]] as [number, number][]) {
      const own = bodyRect(x, feet, bodyH, k);
      const p = place(x, feet, [own]);
      expect(p.rect.x0).toBeGreaterThanOrEqual(2);
      expect(p.rect.y0).toBeGreaterThanOrEqual(2);
      if (x >= 0 && x <= CW && feet >= 60) {
        expect(inside(p.rect)).toBe(true);
        expect(overlap(p.rect, { ...own, y0: Math.max(own.y0, 0) })).toBe(false);
      }
    }
  });
});
