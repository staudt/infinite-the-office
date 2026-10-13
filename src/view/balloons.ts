// Balloon placement, pure (no DOM). Everything is in canvas CSS px: the view converts world feet to screen first.
import { BALLOON } from './geometry';

export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }
/** Which edge of the balloon its tail points from: 'b' = bottom (balloon above), 't' = top (below), 'l'/'r' = left/right edge (beside). */
export type TailSide = 'b' | 't' | 'l' | 'r';
export interface Placed { l: number; t: number; side: TailSide; /** Tail offset along its edge (px from the balloon's left/top), clamped inside the balloon. */ tail: number; rect: ScreenRect }

/** The screen box of a standing body: centered on `x`, `h` tall above `feet`. */
export const bodyRect = (x: number, feet: number, h: number, k: number): ScreenRect => ({ x0: x - BALLOON.bodyHalf * k, x1: x + BALLOON.bodyHalf * k, y0: feet - h, y1: feet });

/** Balloons sit above the head; if that is taken or off-screen, try beside, higher, then below.
 *  `x`/`feet`: the speaker's screen position, `bodyH`: their screen height, `k`: screen px per world px,
 *  `taken`: bodies and balloons to avoid. Falls back to the first spot that fits the canvas, then to the first one clamped. */
export function placeBalloon(w: number, h: number, x: number, feet: number, bodyH: number, k: number, cw: number, chh: number, taken: ScreenRect[]): Placed {
  const { gap: G, margin: M } = BALLOON;
  const top = feet - bodyH, mid = top + BALLOON.midDown * k, sideOff = BALLOON.sideOff * k;
  type Cand = { l: number; t: number; side: TailSide };
  const above = (dx: number, lift: number): Cand => ({ l: x - w / 2 + dx, t: top - h - G - lift, side: 'b' });
  const cands: Cand[] = [
    above(0, 0), above(-w / 3, 0), above(w / 3, 0),
    { l: x + sideOff, t: mid - h / 2, side: 'l' }, { l: x - sideOff - w, t: mid - h / 2, side: 'r' },
    above(0, h + BALLOON.lift), above(-w / 3, h + BALLOON.lift), above(w / 3, h + BALLOON.lift),
    { l: x - w / 2, t: feet + G, side: 't' }, { l: x - w / 2 - w / 3, t: feet + G, side: 't' }, { l: x - w / 2 + w / 3, t: feet + G, side: 't' },
  ];
  const fit = (c: Cand) => c.l >= M && c.t >= M && c.l + w <= cw - M && c.t + h <= chh - M;
  const rect = (c: Cand): ScreenRect => ({ x0: c.l, y0: c.t, x1: c.l + w, y1: c.t + h });
  const slide = (c: Cand): Cand => (c.side === 'b' || c.side === 't' ? { ...c, l: Math.max(M, Math.min(cw - w - M, c.l)) } : c);
  const blocked = (r: ScreenRect) => taken.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0);
  const sl = cands.map(slide);
  const pick = sl.find((c) => fit(c) && !blocked(rect(c))) ?? sl.find(fit) ?? { ...sl[0], t: Math.max(M, sl[0].t) };
  const tail = pick.side === 'b' || pick.side === 't' ? Math.max(BALLOON.tailMin, Math.min(w - BALLOON.tailMin, x - pick.l)) : Math.max(BALLOON.tailMinSide, Math.min(h - BALLOON.tailMinSide, mid - pick.t));
  return { ...pick, tail, rect: rect(pick) };
}
