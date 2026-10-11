import type { Point } from '../sets/index.ts';
import type { Reaction } from '../schema/episode';

export type Pace = 'walk' | 'hurry' | 'sneak';
/** Cells per second. */
export const SPEED: Record<Pace, number> = { walk: 5, hurry: 9, sneak: 3 };

/** One person (or extra) on screen. Positions are whole grid cells of the current set. */
export class Actor {
  x = 0;
  y = 0;
  visible = false;
  /** Standing on a seat cell (drawn underlined). */
  seated = false;
  facing: 1 | -1 = 1;
  speaking = false;
  /** Where the current walk ends (a reserved cell); null when standing still. */
  dest: Point | null = null;
  /** Bumped to cancel an older walk coroutine when a new one starts. */
  walkId = 0;
  reaction: Reaction | null = null;
  /** World time (Stage.wt) when the reaction marker disappears. */
  reactionUntil = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly glyph: string,
    readonly color: string,
    readonly title: string,
    readonly home: string,
    readonly desk: string | null,
  ) {}

  get pos(): Point {
    return { x: this.x, y: this.y };
  }

  get moving(): boolean {
    return this.dest !== null;
  }
}
