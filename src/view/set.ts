// The map view: the current set as a character grid, people as colored letters, and
// everything anyone says as a talk balloon built from character cells, with names
// painted in each character's color. Every set is centered in one fixed-size frame
// (the size of the biggest set) so the confessional cut is a clean swap.
import { firstName } from '../engine/cast';
import type { Actor } from '../engine/actor';
import type { EngineEvent } from '../engine/events';
import { readTime, type Stage } from '../engine/stage';
import type { Reaction } from '../schema/episode';
import { SETS } from '../sets/index.ts';
import { blank, type Cell, gridHtml, paint, wrap } from './grid';
import { NameIndex } from './names';

const sets = Object.values(SETS);
export const FRAME_W = Math.max(...sets.map((s) => s.width));
export const FRAME_H = Math.max(...sets.map((s) => s.height));

const BALLOON_WIDTH = 34;
const BALLOON_LINES = 4;
const TEXT = '#ececec';

/** Small marker drawn above a head for ~1.5 s. */
export const MARKER: Record<Reaction, string> = {
  look_at_camera: '[o]', eye_roll: '-.-', laugh: ':D', facepalm: 'T_T', stare: '?', sigh: '...', gasp: '!', cringe: '>_<', shrug: '~?~', cheer: '\\o/',
};

/** Where exits are drawn, as arrows pointing out of the set. */
function exitChar(x: number, y: number, w: number, h: number): string {
  return y === 0 ? 'v' : y === h - 1 ? '^' : x === 0 ? '>' : x === w - 1 ? '<' : '+';
}

/** Per-character colors let names stay colored across line breaks. */
interface Balloon {
  who: string;
  text: string;
  colors: string[];
  bold: boolean[];
  italic: boolean;
  lines: [number, number][];
  color: string;
  at: number;
  /** World time when it disappears. */
  until: number;
}

interface Rect { r0: number; r1: number; c0: number; c1: number }

export class MapView {
  private balloons = new Map<string, Balloon>();
  private noteBalloon: { src: string; b: Balloon } | null = null;
  private names: NameIndex;
  private lastHtml = '';

  constructor(private el: HTMLElement, private stage: Stage) {
    this.names = new NameIndex(stage);
  }

  onEvent(e: EngineEvent): void {
    const st = this.stage;
    if (e.type === 'said') {
      const a = st.actor(e.who);
      const b = this.balloon(a, `${firstName(a.name)}: ${e.text}`, firstName(a.name).length + 1, false, TEXT);
      b.until = st.wt + readTime(e.text, 'said') + 0.3;
      this.balloons.set(e.who, b);
    } else if (e.type === 'despawn') this.balloons.delete(e.id);
    else if (e.type === 'sceneStart') this.balloons.clear();
  }

  /** `lead` characters at the start are the speaker's name, in their color. */
  private balloon(a: Actor, text: string, lead: number, italic: boolean, base: string): Balloon {
    const colors: string[] = [];
    const bold: boolean[] = [];
    for (let i = 0; i < lead; i++) {
      colors.push(a.color);
      bold.push(true);
    }
    for (const run of this.names.runs(text.slice(lead))) {
      for (let i = 0; i < run.text.length; i++) {
        colors.push(run.color ?? base);
        bold.push(run.color !== null);
      }
    }
    return { who: a.id, text, colors, bold, italic, lines: wrap(text, BALLOON_WIDTH, BALLOON_LINES), color: a.color, at: this.stage.wt, until: Infinity };
  }

  /** The stage direction near an actor, as an italic balloon in parentheses. */
  private note(): Balloon | null {
    const n = this.stage.note;
    if (!n || n.who === null || n.until <= this.stage.wt) return (this.noteBalloon = null);
    const a = this.stage.actor(n.who);
    const text = `(${firstName(a.name)} ${n.text})`;
    if (this.noteBalloon?.src !== text) this.noteBalloon = { src: text, b: this.balloon(a, text, 1, true, '#b4b4cc') };
    // The name inside the parentheses is colored by the name index; the lead "(" stays plain.
    this.noteBalloon.b.colors[0] = '#b4b4cc';
    this.noteBalloon.b.bold[0] = false;
    this.noteBalloon.b.until = n.until;
    return this.noteBalloon.b;
  }

  render(): void {
    const st = this.stage;
    const g = blank(FRAME_W, FRAME_H);
    if (st.card && st.card.until > st.time) this.drawCard(g, st.card.text, st.card.sub);
    else {
      const ox = Math.floor((FRAME_W - st.set.width) / 2), oy = Math.floor((FRAME_H - st.set.height) / 2);
      this.drawSet(g, ox, oy);
      this.drawActors(g, ox, oy);
      if (st.pauseCaption && st.pauseCaption.until > st.time) {
        const t = st.pauseCaption.text;
        paint(g, FRAME_H - 1, Math.floor((FRAME_W - t.length) / 2), t, 'pause');
      }
    }
    const html = gridHtml(g);
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.el.innerHTML = html;
    }
  }

  private drawCard(g: Cell[][], text: string, sub: string): void {
    const mid = Math.floor(FRAME_H / 2);
    const big = [...text.toUpperCase()].join(' ');
    const width = Math.max(big.length, sub.length) + 12;
    const rule = '-'.repeat(Math.min(width, FRAME_W - 4));
    const at = (s: string) => Math.floor((FRAME_W - s.length) / 2);
    paint(g, mid - 3, at(rule), rule, 'card-rule');
    paint(g, mid - 1, at(big), big, 'card-title');
    if (sub) paint(g, mid + 1, at(sub), sub, 'card-sub');
    paint(g, mid + 3, at(rule), rule, 'card-rule');
  }

  private drawSet(g: Cell[][], ox: number, oy: number): void {
    const set = this.stage.set;
    for (let y = 0; y < set.height; y++) {
      for (let x = 0; x < set.width; x++) {
        const kind = set.kinds[y][x];
        if (kind === 'void' || kind === 'floor' || kind === 'spot') continue;
        const ch = kind === 'exit' ? exitChar(x, y, set.width, set.height) : set.tiles[y][x];
        g[oy + y][ox + x] = { ch, cls: `k-${kind}` };
      }
    }
  }

  private drawActors(g: Cell[][], ox: number, oy: number): void {
    const st = this.stage;
    const t = st.wt;
    // Seated people first, so a walker passing over a chair stays visible.
    const actors = st.visibleActors().sort((a, b) => Number(b.seated) - Number(a.seated) || a.y - b.y);
    const taken: Rect[] = [];
    for (const a of actors) {
      const r = oy + a.y, c = ox + a.x;
      const blink = a.reaction === 'look_at_camera' && a.reactionUntil > t && Math.floor(t * 3) % 2 === 0;
      const cls = ['actor', a.seated ? 'seated' : '', a.speaking ? 'speaking' : '', blink ? 'blink' : ''].filter(Boolean).join(' ');
      g[r][c] = { ch: a.glyph, cls, color: a.color };
      taken.push({ r0: r, r1: r, c0: c, c1: c });
      if (a.reaction && a.reactionUntil > t && r > 0) {
        const m = MARKER[a.reaction];
        paint(g, r - 1, Math.max(0, Math.min(FRAME_W - m.length, c - Math.floor(m.length / 2))), m, 'marker');
      }
    }
    const note = this.note();
    for (const [id, b] of this.balloons) if (b.until <= t || !st.actor(id).visible) this.balloons.delete(id);
    const list = [...this.balloons.values(), ...(note ? [note] : [])].sort((a, b) => a.at - b.at);
    this.drawBalloons(g, list, taken, ox, oy);
  }

  /**
   * Balloons are blocks of cells with a tail pointing at the speaker. Placement tries
   * spots in order of preference (above, beside, higher, below) and takes the first that
   * covers no person and no other balloon; the newest balloon wins when nothing fits.
   */
  private drawBalloons(g: Cell[][], list: Balloon[], taken: Rect[], ox: number, oy: number): void {
    const overlaps = (r: Rect) => taken.some((b) => r.r0 <= b.r1 && r.r1 >= b.r0 && r.c0 <= b.c1 && r.c1 >= b.c0);
    for (const b of list) {
      const a = this.stage.actor(b.who);
      const ar = oy + a.y, ac = ox + a.x;
      const h = b.lines.length;
      const w = Math.min(FRAME_W, Math.max(...b.lines.map(([s, e]) => e - s)) + 3); // edge bar + padding
      const clampC = (c: number) => Math.max(0, Math.min(FRAME_W - w, c));
      interface Spot { top: number; left: number; tail: [number, number, string] }
      const above = (lift: number): Spot[] =>
        [ac - Math.floor(w / 2), ac - w + 3, ac - 2, ac - Math.floor(w / 2) - 8, ac - Math.floor(w / 2) + 8].map((c) => {
          const left = clampC(c), top = ar - 1 - h - lift;
          return { top, left, tail: [top + h, Math.max(left, Math.min(left + w - 1, ac)), '▾'] };
        });
      const beside = (): Spot[] =>
        [ar - h + 1, ar - Math.floor(h / 2), ar].flatMap((top) => [
          { top, left: ac - 1 - w, tail: [ar, ac - 1, '▸'] as [number, number, string] },
          { top, left: ac + 2, tail: [ar, ac + 1, '◂'] as [number, number, string] },
        ]);
      const below = (lift: number): Spot[] =>
        above(0).map((s) => ({ top: ar + 2 + lift, left: s.left, tail: [ar + 1 + lift, s.tail[1], '▴'] }));
      const cands = [...above(0), ...beside(), ...above(1), ...above(2), ...above(3), ...below(0), ...below(1), ...below(2)];
      const rect = (s: Spot): Rect => ({
        r0: Math.min(s.top, s.tail[0]), r1: Math.max(s.top + h - 1, s.tail[0]), c0: Math.min(s.left, s.tail[1]), c1: Math.max(s.left + w - 1, s.tail[1]),
      });
      const fits = (s: Spot) => s.top >= 0 && s.top + h <= FRAME_H && s.left >= 0 && s.left + w <= FRAME_W && s.tail[0] >= 0 && s.tail[0] < FRAME_H;
      const spot = cands.find((s) => fits(s) && !overlaps(rect(s))) ?? cands.find(fits) ?? above(0)[0];
      taken.push(rect(spot));
      b.lines.forEach(([s, e], i) => {
        const r = spot.top + i;
        if (r < 0 || r >= FRAME_H) return;
        for (let c = spot.left; c < spot.left + w; c++) g[r][c] = { ch: ' ', cls: 'bubble' };
        g[r][spot.left] = { ch: '▌', cls: 'bubble edge', color: b.color };
        for (let k = s; k < e && spot.left + 2 + k - s < FRAME_W; k++) {
          g[r][spot.left + 2 + k - s] = { ch: b.text[k], cls: `bubble${b.bold[k] ? ' name' : ''}${b.italic ? ' dir' : ''}`, color: b.colors[k] };
        }
      });
      const [tr, tc, ch] = spot.tail;
      if (tr >= 0 && tr < FRAME_H && !(tr === ar && tc === ac)) g[tr][tc] = { ch, cls: 'tail', color: b.color };
    }
  }
}
