// Every number that places or sizes something in the sprite map view, in one place. Tweak here.
// World px are native sprite px; "screen" values are canvas CSS px (they do not scale with the camera zoom).
import type { SetMap } from '../sets/index.ts';

// ---- people
/** A standard standing frame (Pam's) is this tall in art px; people are drawn at personH, so art scale = personH / ART_H.
 *  Taller or shorter characters keep their own height (the sprite script's `height`). */
export const ART_H = 130;
/** A standing character in world px: layout sets (art scale) and the ASCII sets (smaller cells). */
export const PERSON_H = { layout: 96, ascii: 80 };
/** The colored-body placeholder (undrawn characters) is authored at this height and scaled by personH / it. */
export const PLACEHOLDER_H = 80;
/** Ground shadow of a standing person, in placeholder units (scaled like the placeholder). */
export const SHADOW = { rx: 11, ry: 4, alpha: 0.28 };
/** Half the width of a person's footprint: for overlap with a prop's side, and for balloons to avoid bodies (screen = x zoom). */
export const SIDE_HALF = 18;

// ---- seats and chairs
/** A sitter sinks this far into the chair (world px), which also shifts the chair's draw order. */
export const SEAT_DROP = 10;
/** Where seated art / the chair sprite put their base, below the seat cell's feet (world px). */
export const SEAT_BASE = 8;
/** Chair art matches the character art's density (personH / ART_H), rounded to 2 decimals (0.74) as the chairs were tuned. */
export const CHAIR_SCALE = Math.round((PERSON_H.layout / ART_H) * 100) / 100;
/** Side-facing sitters at a desk (pods, reception) are drawn twice: whole, behind the desk (legs go under the desktop),
 *  and from the lap up in front of it (arms on the desktop). `lap`: the lap line as a fraction of the seated frame's height
 *  above its base; `back`: world px they sit away from the desk they face. */
export const DESK_SIT = { lap: 0.41, back: 6 };
/** Visibility box of a chair around its feet (world px), for culling. */
export const CHAIR_BOX = { half: 30, up: 70, down: 12 };

// ---- camera
/** Layout sets: padding around a region's cells, in world px (the wall behind it, a little air). */
export const VIEW_PAD = { top: 100, side: 28, bottom: 28 };
/** ASCII sets: padding around a region's cells, in cells. */
export const ASCII_PAD_CELLS = 2;
/** Whoever speaks is kept in frame: their body box (world px) around the feet, and extra air. */
export const SPEAKER_MARGIN = { side: 28, top: 8, bottom: 8 };
/** The forced opening-title shot may zoom this much tighter than a scene (x maxZoom). */
export const OPENING_ZOOM = 1.6;
/** Forced shot: aim this fraction of a person's height above the feet. */
export const SHOT_AIM = 0.4;
/** Camera ease rate (1/s) toward its goal. */
export const CAM_EASE = 2.5;
/** Static layer resolution multiplier, so zoomed-in cameras stay sharp. */
export const BG_SCALE = 2;

// ---- balloons and emotes
export const BALLOON = {
  gap: 18,      // between a balloon and the head (above) or the feet (below); the tail pokes ~7 px into it
  midDown: 14,  // world px below the head top: where side balloons point
  sideOff: 26,  // world px from the body center to a side balloon
  lift: 6,      // screen px between stacked "higher" candidates
  margin: 2,    // screen px kept clear of the canvas edge
  bodyHalf: 22, // world px: half width of a body for avoiding collisions
  head: 38,     // world px: the top of a body that counts as the head (covering it costs, the rest is free)
  seatedH: 0.8, // a sitter's head is this fraction of a standing height above the feet
  tailMin: 10,  // screen px: a tail stays this far from a balloon's corners
  tailMinSide: 8,
  // Placement scores in screen px of distance from the head: covering someone costs this much per world px² of them hidden
  // (a head is ~1700), and going beside / below costs a flat extra.
  coverCost: 0.08,
  offCenterCost: 0.15, // per px the balloon's center is off the speaker
  sideCost: 30,
  belowCost: 120,
};
/** Reaction emote pill: above the head by this much (world px), font size in CSS px (x dpr). */
export const EMOTE = { lift: 16, font: 13 };

// ---- ASCII sets (procedural, 16 x 32 px cells)
export const ASCII = {
  cw: 16, ch: 32,
  footInset: 4,   // feet sit this far above the cell bottom
  blockPad: { side: 40, up: 120 }, // visibility padding around a prop block (world px)
};
/** ASCII sets: a seated front-facing person is redrawn over the desk in front of them, clipped to a box around the feet:
 *  `half` wide each side, `up` above, and only down to `keep` above the feet (the desk hides the legs). */
export const TORSO = { half: 60, up: 160, keep: 26 };

/** How a set maps cells to world px, and how big people are in it. */
export interface Geo {
  cw: number; ch: number;
  /** A standing character, in world px. */
  personH: number;
  maxZoom: number;
  /** Camera padding around a region's cells, in world px. */
  pad: { side: number; top: number; bottom: number };
  /** Screen feet are this far below `foot()` (world px): ASCII feet sit a little above the cell bottom. */
  feetPad: number;
  /** Feet position of a (possibly fractional) cell. */
  foot(x: number, y: number): [number, number];
}
export const GEO_ASCII: Geo = {
  cw: ASCII.cw, ch: ASCII.ch, personH: PERSON_H.ascii, maxZoom: 3,
  pad: { side: ASCII_PAD_CELLS * ASCII.cw, top: ASCII_PAD_CELLS * ASCII.ch, bottom: ASCII_PAD_CELLS * ASCII.ch },
  feetPad: ASCII.footInset,
  foot: (x, y) => [x * ASCII.cw + ASCII.cw / 2, (y + 1) * ASCII.ch - ASCII.footInset],
};
/** Pixel position of a (possibly fractional) layout cell: feet at the cell center. */
export const layoutFoot = (set: SetMap, x: number, y: number): [number, number] => [(x + 0.5) * set.cellW, (y + 0.5) * set.cellH];
export const geoOf = (set: SetMap): Geo => (set.layout
  ? { cw: set.cellW, ch: set.cellH, personH: PERSON_H.layout, maxZoom: 2.5, pad: VIEW_PAD, feetPad: 0, foot: (x, y) => layoutFoot(set, x, y) }
  : GEO_ASCII);
