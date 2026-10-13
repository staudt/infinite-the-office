// Balloon placement, pure (no DOM). Everything is in canvas CSS px: the view converts world feet to screen first.
import { BALLOON } from './geometry';

export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }
/** Which edge of the balloon its tail points from: 'b' = bottom (balloon above), 't' = top (below), 'l'/'r' = left/right edge (beside). */
export type TailSide = 'b' | 't' | 'l' | 'r';
export interface Placed { l: number; t: number; side: TailSide; /** Tail offset along its edge (px from the balloon's left/top): it sits right at the speaker. */ tail: number; rect: ScreenRect }

/** The screen box of a standing body: centered on `x`, `h` tall above `feet`. */
export const bodyRect = (x: number, feet: number, h: number, k: number): ScreenRect => ({ x0: x - BALLOON.bodyHalf * k, x1: x + BALLOON.bodyHalf * k, y0: feet - h, y1: feet });

const area = (a: ScreenRect, b: ScreenRect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * The closest spot to the speaker's head that stays on the canvas, scored rather than first-fit: distance from the head,
 * plus a cost for being off-center and for covering other people (soft) and other balloons (hard), plus a small preference for above > beside > below.
 * The tail always sits on the edge facing the speaker, at the speaker's x (or y), so it points at them wherever the balloon
 * slides. `x`/`feet`: the speaker's screen position, `bodyH`: their screen height, `k`: screen px per world px,
 * `bodies`: people to avoid covering (the speaker's own body is never covered), `balloons`: balloons already placed.
 */
export function placeBalloon(w: number, h: number, x: number, feet: number, bodyH: number, k: number, cw: number, chh: number, bodies: ScreenRect[], balloons: ScreenRect[] = []): Placed {
  const { gap: G, margin: M, tailMin: TM, tailMinSide: TS } = BALLOON;
  const top = feet - bodyH, mid = top + BALLOON.midDown * k, half = BALLOON.bodyHalf * k;
  const own = bodyRect(x, feet, bodyH, k);
  const cands: Placed[] = [];
  const add = (l: number, t: number, side: TailSide, bias: number) => {
    // Keep it on the canvas; then the tail must still reach the speaker from inside the edge.
    l = Math.max(M, Math.min(cw - w - M, l));
    t = Math.max(M, Math.min(chh - h - M, t));
    const tail = side === 'b' || side === 't' ? x - l : mid - t;
    const len = side === 'b' || side === 't' ? w : h, min = side === 'b' || side === 't' ? TM : TS;
    if (tail < min || tail > len - min) return;
    const rect = { x0: l, y0: t, x1: l + w, y1: t + h };
    // Where the tail tip lands vs where it should (just off the head or body).
    const tip = side === 'b' ? [x, t + h + G] : side === 't' ? [x, t - G] : side === 'l' ? [l - G, mid] : [l + w + G, mid];
    const want = side === 'b' ? [x, top] : side === 't' ? [x, feet] : side === 'l' ? [x + half, mid] : [x - half, mid];
    if (area(rect, own) > 0) return;
    const dist = Math.hypot(tip[0] - want[0], tip[1] - want[1]);
    const cover = bodies.reduce((s, b) => s + area(rect, b), 0) / (k * k);
    const clash = balloons.reduce((s, b) => s + area(rect, b), 0);
    cands.push({ l, t, side, tail, rect, score: dist + Math.abs(l + w / 2 - x) * BALLOON.offCenterCost + cover * BALLOON.coverCost + clash * 1e3 + bias } as Placed & { score: number });
  };
  // Above: slide along so the tail can be anywhere on the bottom edge, at a few heights.
  for (const lift of [0, h * 0.5, h + BALLOON.lift]) for (let i = 0; i <= 8; i++) add(x - TM - ((w - 2 * TM) * i) / 8, top - h - G - lift, 'b', 0);
  // Beside, at a few heights around the face.
  for (const dy of [0, -h / 2, h / 2]) {
    add(x + half + G, mid - h / 2 + dy, 'l', BALLOON.sideCost);
    add(x - half - G - w, mid - h / 2 + dy, 'r', BALLOON.sideCost);
  }
  // Below the feet, last resort.
  for (let i = 0; i <= 8; i++) add(x - TM - ((w - 2 * TM) * i) / 8, feet + G, 't', BALLOON.belowCost);
  const best = (cands as (Placed & { score: number })[]).sort((a, b) => a.score - b.score)[0];
  if (best) return { l: best.l, t: best.t, side: best.side, tail: best.tail, rect: best.rect };
  // Speaker off-screen or the canvas is tiny: centered above, clamped, tail clamped.
  const l = Math.max(M, Math.min(cw - w - M, x - w / 2)), t = Math.max(M, top - h - G);
  return { l, t, side: 'b', tail: Math.max(TM, Math.min(w - TM, x - l)), rect: { x0: l, y0: t, x1: l + w, y1: t + h } };
}
