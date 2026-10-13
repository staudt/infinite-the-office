// Camera framing, pure (no DOM): which part of the world the canvas shows. World px; `aspect` is canvas w / h.
import { OPENING_ZOOM, SPEAKER_MARGIN, SHOT_AIM, type Geo } from './geometry';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
/** A camera: center and visible width in world px (height follows from the aspect). */
export interface Cam { cx: number; cy: number; w: number }
export interface CellPt { x: number; y: number }

/** The box of a region's cells plus the set's padding; the whole set (`full`, world px) when there are no cells. */
export function regionBox(cells: CellPt[] | undefined, full: { w: number; h: number }, geo: Geo): Rect {
  if (!cells?.length) return { x0: 0, y0: 0, x1: full.w, y1: full.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
  const p = geo.pad;
  return { x0: x0 * geo.cw - p.side, y0: y0 * geo.ch - p.top, x1: (x1 + 1) * geo.cw + p.side, y1: (y1 + 1) * geo.ch + p.bottom };
}

/** Widen a box to keep these feet positions (and the person standing on them) in frame. Mutates and returns the box. */
export function widenFor(box: Rect, feet: [number, number][], personH: number): Rect {
  for (const [fx, fy] of feet) {
    box.x0 = Math.min(box.x0, fx - SPEAKER_MARGIN.side); box.x1 = Math.max(box.x1, fx + SPEAKER_MARGIN.side);
    box.y0 = Math.min(box.y0, fy - personH - SPEAKER_MARGIN.top); box.y1 = Math.max(box.y1, fy + SPEAKER_MARGIN.bottom);
  }
  return box;
}

/** A forced shot's box: `span` cells wide around a cell, framed a little above it so a sitter's head is in. */
export function shotBox(shot: { at: CellPt; span: number }, geo: Geo, aspect: number): Rect {
  const [fx, fy] = geo.foot(shot.at.x, shot.at.y), w = shot.span * geo.cw, h = w / aspect, cy = fy - geo.personH * SHOT_AIM;
  return { x0: fx - w / 2, x1: fx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
}

/** Keep the view inside the set (centered when it is wider/taller than the set). */
export function clamp(c: Cam, W: number, H: number, aspect: number): Cam {
  const h = c.w / aspect;
  return { w: c.w, cx: c.w >= W ? W / 2 : Math.max(c.w / 2, Math.min(W - c.w / 2, c.cx)), cy: h >= H ? H / 2 : Math.max(h / 2, Math.min(H - h / 2, c.cy)) };
}

/** The camera that frames a box at the canvas aspect, never wider than the whole set nor tighter than the zoom cap
 *  (a forced opening shot may go OPENING_ZOOM tighter). */
export function frame(box: Rect, W: number, H: number, aspect: number, maxZoom: number, opening = false): Cam {
  const zoom = opening ? maxZoom * OPENING_ZOOM : maxZoom;
  const fitW = Math.max(W, H * aspect);
  const w = Math.min(fitW, Math.max(fitW / zoom, box.x1 - box.x0, (box.y1 - box.y0) * aspect));
  return clamp({ cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, w }, W, H, aspect);
}

/** One easing step of the camera toward a goal over dt seconds. */
export function ease(c: Cam, goal: Cam, dt: number, rate: number, W: number, H: number, aspect: number): Cam {
  const k = 1 - Math.exp(-dt * rate);
  return clamp({ cx: c.cx + (goal.cx - c.cx) * k, cy: c.cy + (goal.cy - c.cy) * k, w: c.w + (goal.w - c.w) * k }, W, H, aspect);
}
