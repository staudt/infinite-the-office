// The stage: scheduler, event bus, actors and the current set. All motion is driven by
// coroutines on the fixed-step clock, so an episode replays identically for a given seed.
import type { Episode, Mood, SetId } from '../schema/episode';
import { findPath, getSet, key, SETS, type Point, type SetMap } from '../sets/index.ts';
import { Actor, type Pace, SPEED } from './actor';
import { type CastMember, pickGlyph } from './cast';
import { distinctColor } from './colors';
import { type EngineEvent, EventBus } from './events';
import { Rng } from './rng';
import { type Co, Scheduler, type Task } from './tasks';

export const TICK = 1 / 60;

/** Reading-time model: how long a line stays up before the show moves on. */
export function readTime(text: string, kind: 'said' | 'narrated' | 'big'): number {
  const words = text.trim().split(/\s+/).length;
  if (kind === 'said') return Math.min(7, 1.3 + words * 0.32);
  if (kind === 'big') return Math.min(5, 1.6 + words * 0.25);
  return Math.min(5, 0.9 + words * 0.24);
}

/** Every character id an episode mentions (scene.present, who, to). */
export function mentionedIds(ep: Episode): Set<string> {
  const ids = new Set<string>();
  for (const s of ep.scenes) {
    s.present.forEach((i) => ids.add(i));
    for (const b of s.beats) {
      if ('who' in b) (Array.isArray(b.who) ? b.who : [b.who]).forEach((i) => ids.add(i));
      if ('to' in b && typeof b.to === 'string') ids.add(b.to);
    }
  }
  ids.delete('everyone');
  ids.delete('all');
  ids.delete('none');
  return ids;
}

/** What a series adds to the canon cast on stage: its own regulars and seating changes. */
export interface StageSeries {
  extras?: { id: string; name: string; title: string; glyph: string; color: string; look?: string }[];
  deskOverrides?: Record<string, string>;
}

export interface Card { text: string; sub: string; until: number }
/** A camera shot the director forces (the opening title shot over the office): center cell and visible width in cells. */
export interface Shot { at: Point; span: number }
/** The show's logo over the map, with the episode title. */
export interface Logo { title: string; label: string }
export interface Note { who: string | null; text: string; until: number }
export interface Head { who: string; text: string; mood: Mood }

export class Stage {
  readonly sched = new Scheduler();
  readonly bus = new EventBus(() => this.sched.time);
  readonly rng: Rng;
  readonly actors = new Map<string, Actor>();
  set: SetMap;
  setId: SetId = 'office';
  /** World time: stops while a talking head is on screen, so the scene resumes exactly as it was. */
  wt = 0;
  frozen = false;
  /** Full-screen title card (show time). */
  card: Card | null = null;
  /** Opening-title shot: forced camera and logo overlay (views only). */
  shot: Shot | null = null;
  logo: Logo | null = null;
  /** Dim caption at the bottom of the map (show time). */
  pauseCaption: Card | null = null;
  /** Stage direction near an actor (world time). */
  note: Note | null = null;
  /** The confessional: set while a talking head is on screen. */
  head: Head | null = null;
  private usedGlyphs = new Set<string>();

  constructor(seed: number, cast: CastMember[], episode: Episode, roster: string[], series: StageSeries = {}) {
    this.rng = new Rng(seed);
    this.set = getSet('office');
    const desks = series.deskOverrides ?? {};
    // A desk override only counts if the spot exists in some set (office desks, annex desks).
    const deskOf = (id: string, d: string | null) => (desks[id] && Object.values(SETS).some((s) => s.spots[desks[id]]) ? desks[id] : d);
    for (const c of cast) this.actors.set(c.id, new Actor(c.id, c.name, c.glyph, c.color, c.title, c.home, deskOf(c.id, c.desk)));
    for (const c of cast) if (c.look) this.actors.get(c.id)!.look = c.look;
    // The series' recurring side characters keep the glyph and color they were given once.
    for (const x of series.extras ?? []) {
      this.actors.set(x.id, new Actor(x.id, x.name, x.glyph, x.color, x.title, 'offsite', deskOf(x.id, null)));
      this.actors.get(x.id)!.look = x.look ?? null;
      this.usedGlyphs.add(x.glyph);
    }
    // Extras get a letter nobody in the episode uses and a color distinct from the cast on screen.
    const inShow = new Set([...roster, ...mentionedIds(episode)]);
    for (const id of inShow) this.usedGlyphs.add(this.actors.get(id)?.glyph ?? '');
    const colors = [...inShow].map((id) => this.actors.get(id)?.color).filter((c): c is string => !!c);
    for (const x of episode.extras) {
      if (this.actors.has(x.id)) continue;
      const color = distinctColor('#cfcfcf', colors);
      colors.push(color);
      this.actors.set(x.id, new Actor(x.id, x.name, this.freeGlyph(x.name), color, x.title, 'offsite', null));
      this.actors.get(x.id)!.look = x.look ?? null;
    }
  }

  private freeGlyph(name: string): string {
    const g = pickGlyph(name, this.usedGlyphs);
    this.usedGlyphs.add(g);
    return g;
  }

  get time(): number {
    return this.sched.time;
  }

  on(fn: (e: EngineEvent) => void): () => void {
    return this.bus.on(fn);
  }

  /** The actor with this id; unknown ids (a sloppy writer) get a plain placeholder. */
  actor(id: string): Actor {
    let a = this.actors.get(id);
    if (!a) {
      const name = id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      a = new Actor(id, name, this.freeGlyph(name), distinctColor('#cfcfcf', [...this.actors.values()].map((x) => x.color)), 'Guest', 'offsite', null);
      this.actors.set(id, a);
    }
    return a;
  }

  visibleActors(): Actor[] {
    return [...this.actors.values()].filter((a) => a.visible);
  }

  spawn(gen: Co): Task {
    return this.sched.spawn(gen);
  }

  /** Advance the simulation by one fixed tick. */
  update(dt = TICK): void {
    if (!this.frozen) this.wt += dt;
    this.sched.tick(dt);
  }

  /** Sleep in world time (motion and ambient life stop while a talking head is up). */
  *sleepW(seconds: number): Co {
    const end = this.wt + seconds;
    yield () => this.wt >= end - 1e-9;
  }

  // ---------------------------------------------------------------- sets and placement

  /** Cut to a new set: everyone leaves, any walk in progress is cancelled. */
  enterSet(id: SetId): void {
    this.setId = id;
    this.set = getSet(id);
    for (const a of this.actors.values()) {
      a.visible = a.seated = a.speaking = false;
      a.dest = null;
      a.reaction = null;
      a.walkId++;
    }
    this.note = this.card = this.pauseCaption = null;
  }

  /** Cells people stand on or are walking to (a walker only holds its destination). */
  occupied(...except: Actor[]): Set<string> {
    const s = new Set<string>();
    for (const a of this.actors.values()) {
      if (except.includes(a)) continue;
      if (a.dest) s.add(key(a.dest));
      else if (a.visible) s.add(key(a));
    }
    return s;
  }

  /** Put an actor on the set at a cell (standing, or seated on a seat cell); `announce` for a visible entrance. */
  show(a: Actor, p: Point, announce = false): void {
    const was = a.visible;
    a.x = p.x;
    a.y = p.y;
    a.visible = true;
    a.dest = null;
    a.walkId++;
    a.seated = this.set.kinds[p.y][p.x] === 'seat';
    a.turn = null;
    if (!was && announce) this.bus.emit({ type: 'spawn', id: a.id });
  }

  hide(a: Actor): void {
    if (!a.visible) return;
    a.visible = a.seated = a.speaking = false;
    a.dest = null;
    a.walkId++;
    this.bus.emit({ type: 'despawn', id: a.id });
  }

  // ---------------------------------------------------------------- walking

  /** Start walking to a cell; the returned task finishes on arrival. */
  walk(a: Actor, to: Point, pace: Pace = 'walk', then?: () => void): Task {
    const id = ++a.walkId;
    a.dest = to;
    return this.spawn(this.walkGen(a, to, pace, id, then));
  }

  private *walkGen(a: Actor, to: Point, pace: Pace, id: number, then?: () => void): Co {
    // Standing people are obstacles (except the goal), so walkers go around them.
    const blocked = new Set<string>();
    for (const o of this.actors.values()) if (o !== a && o.visible && !o.dest) blocked.add(key(o));
    blocked.delete(key(to));
    const set = this.set;
    const path = findPath(set.width, set.height, (x, y) => set.walkable({ x, y }) && !blocked.has(`${x},${y}`), a.pos, to) ?? set.path(a.pos, to);
    a.seated = false;
    a.turn = null;
    let due = this.wt;
    for (const p of path ?? [to]) {
      a.stepFrom = a.pos;
      a.stepTo = p;
      a.stepStart = due;
      // Uniform walking speed in world px, whatever the cell shape (SPEED is cells of 16 px per second).
      due += Math.hypot((p.x - a.x) * set.cellW, (p.y - a.y) * set.cellH) / (SPEED[pace] * 16);
      a.stepEnd = due;
      yield () => this.wt >= due - 1e-9;
      if (a.walkId !== id) return;
      if (p.x !== a.x) a.facing = p.x > a.x ? 1 : -1;
      a.x = p.x;
      a.y = p.y;
    }
    a.dest = null;
    a.stepFrom = a.stepTo = null;
    a.seated = set.kinds[to.y][to.x] === 'seat';
    then?.();
  }
}
