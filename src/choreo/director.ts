// The director turns an Episode into coroutines on the Stage: scenes, beats, walking,
// title cards, talking heads and the background life of the office.
//
// Blocking rule: movement beats (move, enter, gather, exit) only start walks and the
// director carries on. A later beat that needs an actor (as speaker, target or doer)
// first waits until that actor has arrived; a spoken-to target is waited for at most
// 3 s. So people talk while others are still walking over, but nobody speaks from
// halfway across the room, and a scene only ends when everyone has settled.
import { type Actor, type Pace } from '../engine/actor';
import { readTime, type Stage } from '../engine/stage';
import { Rng, hashSeed } from '../engine/rng';
import type { Co } from '../engine/tasks';
import { type Beat, type BeatOf, type Episode, remapLegacySet, type Scene, type SetId } from '../schema/episode';
import { key, type Point } from '../sets/index.ts';

/** What the title card says when the show cuts to a set. */
const SET_CARD: Record<SetId, string> = {
  office: 'DUNDER MIFFLIN', kitchen: 'KITCHEN', annex: 'ANNEX', break_room: 'BREAK ROOM', parking_lot: 'PARKING LOT', warehouse: 'WAREHOUSE', offsite: '',
};
/** Where a scene happens when it names no region. */
const DEFAULT_REGION: Record<SetId, string> = {
  office: 'bullpen', kitchen: 'kitchen', annex: 'annex', break_room: 'break_room', parking_lot: 'parking_lot', warehouse: 'warehouse', offsite: 'venue',
};
const AMBIENT_STOPS = ['copier', 'water_cooler'];
/** Where someone with no desk or partner in a scene hangs out, in order of preference. */
const HANGOUTS = ['water_cooler', 'copier'];
const PACE_OF: Record<string, Pace> = { walk: 'walk', hurry: 'hurry', sneak: 'sneak', storm_off: 'hurry', run: 'hurry' };

const list = (v: string | string[]) => (Array.isArray(v) ? v : [v]);
/** Sets where an actor not on screen can be conjured at their desk. */
const DESK_SETS = new Set<SetId>(['office', 'annex']);

export class Director {
  /** Bumped per scene so ambient coroutines of an earlier scene stop themselves. */
  private token = 0;

  constructor(
    private st: Stage,
    private ep: Episode,
    /** Season roster: members not in a scene sit at their desks as background. */
    private roster: string[],
    private label = 'Episode',
  ) {}

  *play(): Co {
    const { st, ep } = this;
    st.bus.emit({ type: 'episodeStart', title: ep.title, label: this.label });
    let prev: SetId | null = null;
    let opened = false;
    for (let i = 0; i < ep.scenes.length; i++) {
      const scene = ep.scenes[i];
      if (!opened && scene.part !== 'cold_open') {
        opened = true;
        yield* this.intro();
      }
      yield* this.scene(i, scene, prev);
      prev = remapLegacySet(scene).set;
    }
    yield* this.card('END OF EPISODE', ep.title, 3);
    st.bus.emit({ type: 'episodeEnd' });
  }

  /** The opening titles after the cold open: the logo and episode title over the working office. */
  private *intro(): Co {
    const { st, ep } = this;
    st.enterSet('office');
    for (const id of this.roster) {
      const a = st.actor(id), desk = a.desk ? st.set.spots[a.desk] : undefined;
      if (desk) st.show(a, desk);
    }
    st.bus.emit({ type: 'card', text: 'THE OFFICE', sub: ep.title, seconds: 0 });
    st.shot = { at: { x: Math.floor(st.set.width / 2), y: Math.floor(st.set.height / 2) }, span: st.set.width };
    st.logo = { title: ep.title, label: this.label };
    yield 3.2;
    st.shot = st.logo = null;
  }

  private *card(text: string, sub: string, seconds: number): Co {
    this.st.card = { text, sub, until: this.st.time + seconds };
    this.st.bus.emit({ type: 'card', text, sub, seconds });
    yield seconds;
    this.st.card = null;
  }

  // ---------------------------------------------------------------- scenes

  private sceneRegion(sc: Scene): string {
    const regions = this.st.set.regions;
    if (regions[sc.region]) return sc.region;
    return regions[DEFAULT_REGION[sc.set]] ? DEFAULT_REGION[sc.set] : Object.keys(regions)[0];
  }

  private *scene(index: number, scene: Scene, prev: SetId | null): Co {
    const { st } = this;
    const sc = remapLegacySet(scene);
    const token = ++this.token;
    st.enterSet(sc.set);
    const region = this.sceneRegion(sc);
    const title = sc.set === 'offsite' ? sc.venue : prev && prev !== sc.set ? SET_CARD[sc.set] : '';
    st.bus.emit({ type: 'sceneStart', index, set: sc.set, region, venue: sc.venue, title, part: sc.part });

    // Who is on screen when the scene starts: those who enter later wait offscreen.
    const entrants = new Set<string>();
    const seen = new Set<string>();
    for (const b of sc.beats) {
      const who = 'who' in b ? list(b.who) : [];
      if (b.type === 'enter') who.filter((w) => !seen.has(w)).forEach((w) => entrants.add(w));
      who.forEach((w) => seen.add(w));
    }
    const busy = new Set(sc.present);
    for (const b of sc.beats) {
      if ('who' in b) list(b.who).forEach((w) => busy.add(w));
      if ('to' in b) busy.add(b.to);
    }
    const background: Actor[] = [];
    for (const id of this.roster) {
      const a = st.actor(id);
      const desk = a.desk ? st.set.spots[a.desk] : undefined;
      if (sc.present.includes(id) || !desk) continue;
      st.show(a, desk);
      if (!busy.has(id)) background.push(a);
    }
    // People at their desks first, so the others can start beside whoever they talk with.
    const atDesk = (id: string) => { const d = st.actor(id).desk; return !!d && !!st.set.spots[d] && st.set.regionAt(st.set.spots[d]) === region; };
    for (const id of [...sc.present].sort((x, y) => Number(atDesk(y)) - Number(atDesk(x)))) {
      const a = st.actor(id);
      if (!entrants.has(id) && !a.visible) st.show(a, this.startCell(a, region, sc));
    }
    if (title) yield* this.card(title, '', 1.5);
    if (sc.set === 'office') st.spawn(this.ambient(token, new Rng(hashSeed('ambient', index)), background));

    for (const b of sc.beats) yield* this.beat(b, region);

    yield () => st.visibleActors().every((a) => !a.moving);
    this.token++; // ends ambient life
    st.bus.emit({ type: 'sceneEnd', index, recap: sc.recap });
    yield 0.4;
  }

  /** Desk if it is in the scene's region, else a free seat there, else beside the first person they talk with,
   *  else a hangout spot (water cooler, copier), else a free cell. */
  private startCell(a: Actor, region: string, sc: Scene): Point {
    const { st } = this;
    const set = st.set, occ = st.occupied();
    const desk = a.desk ? set.spots[a.desk] : undefined;
    if (desk && set.regionAt(desk) === region && !occ.has(key(desk))) return desk;
    const seats = this.seatsIn(region).filter((p) => !occ.has(key(p)));
    if (seats.length) return seats[Math.floor(st.rng.next() * seats.length)];
    const talk = sc.beats.find((b) => b.type === 'say' && ((b.who === a.id && st.actors.has(b.to)) || b.to === a.id)) as BeatOf<'say'> | undefined;
    const mate = talk && st.actors.get(talk.who === a.id ? talk.to : talk.who);
    const beside = mate?.visible && mate !== a ? this.besideOf(mate, occ) : null;
    if (beside) return beside;
    for (const s of HANGOUTS) {
      const p = set.spots[s];
      if (p && set.regionAt(p) === region && !set.crowded(p, occ)) return p;
    }
    return set.freeCellIn(region, occ, () => st.rng.next()) ?? set.nextTo(set.regions[region].cells[0], occ) ?? set.regions[region].cells[0];
  }

  /** Visitor seats in a region (not anybody's desk), in spot-name order. */
  private seatsIn(region: string): Point[] {
    const set = this.st.set;
    return Object.entries(set.spots)
      .filter(([n, p]) => set.kinds[p.y][p.x] === 'seat' && !n.endsWith('_desk') && set.regionAt(p) === region)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([, p]) => p);
  }

  // ---------------------------------------------------------------- ambient life

  /** Background people occasionally get up for the copier, water cooler or kitchen, one at a time. */
  private *ambient(token: number, rng: Rng, people: Actor[]): Co {
    const { st } = this;
    const stops = AMBIENT_STOPS.filter((s) => st.set.spots[s]);
    if (!stops.length) return;
    while (true) {
      yield* st.sleepW(rng.range(8, 20));
      if (token !== this.token) return;
      const ready = people.filter((a) => a.visible && a.seated && !a.moving);
      if (!ready.length) continue;
      const a = rng.pick(ready);
      const home = a.pos, spot = st.set.spots[rng.pick(stops)];
      const occ = st.occupied(a);
      yield [st.walk(a, occ.has(key(spot)) ? st.set.nextTo(spot, occ) ?? spot : spot)];
      if (token !== this.token) return;
      yield* st.sleepW(rng.range(2, 5));
      if (token !== this.token) return;
      yield [st.walk(a, home)];
    }
  }

  // ---------------------------------------------------------------- helpers

  /** Manhattan distance in world px (cells are not square in the ASCII sets). */
  private dist(a: Point, b: Point): number {
    const { cellW, cellH } = this.st.set;
    return Math.abs(a.x - b.x) * cellW + Math.abs(a.y - b.y) * cellH;
  }

  /** "everyone" means everyone on screen. */
  private ids(who: string | string[]): string[] {
    return [...new Set(list(who).flatMap((i) => (i === 'everyone' ? this.st.visibleActors().map((a) => a.id) : [i])))];
  }

  /** Wait until these actors have stopped walking (at most `cap` seconds if given). */
  private *settle(ids: string[], cap = Infinity): Co {
    const { st } = this;
    const end = st.time + cap;
    yield () => ids.every((i) => !st.actor(i).moving) || st.time >= end;
  }

  /** The cell to walk to for a place name: a person, a spot, or a region. Null when there is nothing to go to. */
  private target(a: Actor, to: string): Point | null {
    const { st } = this;
    const set = st.set, occ = st.occupied(a);
    const other = st.actors.get(to);
    if (other && other !== a && other.visible) return this.besideOf(other, occ);
    const spot = set.spots[to];
    // A standing spot next to someone counts as taken (a seat beside someone is fine).
    if (spot) return occ.has(key(spot)) || (set.kinds[spot.y][spot.x] !== 'seat' && set.crowded(spot, occ)) ? set.nextTo(spot, occ) : spot;
    if (set.regions[to]) return set.freeCellIn(to, occ, () => st.rng.next());
    return null;
  }

  /** Where to stand to talk with someone: 3-4 cells to their side (so neither sprite covers the other, seated or not),
   *  on plain floor, in their region if possible; else the nearest free cell. */
  private besideOf(other: Actor, occ: Set<string>): Point | null {
    const set = this.st.set, at = other.dest ?? other.pos, region = set.regionAt(at);
    const free = (p: Point) => !set.crowded(p, occ) && !set.hidden(p);
    // Their own region first (region rects can end right beside a desk), then anywhere.
    for (const strict of [true, false]) {
      for (const dy of [0, 1, -1, 2, -2]) {
        for (const dx of [-3, 3, -4, 4]) {
          const p = { x: at.x + dx, y: at.y + dy }, kind = set.kinds[p.y]?.[p.x];
          if ((kind === 'floor' || kind === 'deco') && set.walkable(p) && free(p) && (!strict || !region || set.regionAt(p) === region)) return p;
        }
      }
    }
    return set.nextTo(at, occ);
  }

  /** The exit cell closest to `near` (or the emptiest one). */
  private exitCell(near?: Point): Point {
    const { st } = this;
    const occ = st.occupied();
    const cells = Object.values(st.set.exits).flat();
    const score = (p: Point) => (occ.has(key(p)) ? 1000 : 0) + (near ? this.dist(p, near) : 0);
    return cells.reduce((best, p) => (score(p) < score(best) ? p : best));
  }

  /** Walk someone in from an exit toward `to` (a place name, or the scene's region). */
  private walkIn(a: Actor, to: string, region: string, pace: Pace = 'walk'): void {
    const { st } = this;
    let goal = to !== 'none' ? this.target(a, to) : null;
    const exit = this.exitCell(goal ?? undefined);
    if (!goal) {
      const near = st.set.regionAt(exit);
      goal = (near && st.set.freeCellIn(near, st.occupied(a), () => st.rng.next())) || this.target(a, region) || exit;
    }
    st.show(a, exit, true);
    st.walk(a, goal, pace);
  }

  private *bringIn(a: Actor, toward: Actor | null, region: string): Co {
    const { st } = this;
    const desk = a.desk ? st.set.spots[a.desk] : undefined;
    if (DESK_SETS.has(st.setId) && desk && !st.occupied().has(key(desk))) st.show(a, desk);
    else this.walkIn(a, toward ? toward.id : region, region);
    yield* this.settle([a.id]);
  }

  private face(a: Actor, to: Actor | undefined): void {
    if (to && to.x !== a.x) a.facing = to.x > a.x ? 1 : -1;
  }

  /** Walk to a place; an unknown one means "somewhere in the scene's region" (stay if already there). */
  private walkTo(a: Actor, to: string, pace: Pace, region: string): void {
    const { st } = this;
    let p = this.target(a, to);
    if (!p && st.set.regionAt(a.pos) !== region && st.set.regions[region]) p = st.set.freeCellIn(region, st.occupied(a), () => st.rng.next());
    if (p && (p.x !== a.x || p.y !== a.y)) this.st.walk(a, p, pace);
  }

  // ---------------------------------------------------------------- beats

  private *beat(b: Beat, region: string): Co {
    switch (b.type) {
      case 'say': return yield* this.say(b, region);
      case 'talking_head': return yield* this.head(b);
      case 'move': return yield* this.move(b, region);
      case 'enter': return yield* this.enter(b, region);
      case 'exit': return yield* this.exit(b);
      case 'gather': return yield* this.gather(b, region);
      case 'sit': return yield* this.sit(b);
      case 'stand': return yield* this.stand(b);
      case 'react': return yield* this.react(b);
      case 'action': return yield* this.action(b, region);
      case 'pause': return yield* this.pause(b);
      case 'caption': return yield* this.caption(b);
    }
  }

  private *say(b: BeatOf<'say'>, region: string): Co {
    const { st } = this;
    const a = st.actor(b.who);
    yield* this.settle([a.id]);
    const to = st.actors.get(b.to);
    if (!a.visible) yield* this.bringIn(a, to?.visible ? to : null, region);
    if (to?.visible) yield* this.settle([to.id], 3);
    this.face(a, to);
    a.speaking = true;
    st.bus.emit({ type: 'said', who: a.id, text: b.text, mood: b.mood, to: b.to });
    yield readTime(b.text, 'said');
    a.speaking = false;
    yield 0.25;
  }

  private *head(b: BeatOf<'talking_head'>): Co {
    const { st } = this;
    const a = st.actor(b.who);
    st.frozen = true;
    st.head = { who: a.id, text: '', mood: b.mood };
    st.bus.emit({ type: 'headStart', who: a.id });
    yield 0.5;
    for (const line of b.lines) {
      st.head = { who: a.id, text: line, mood: b.mood };
      st.bus.emit({ type: 'headSay', who: a.id, text: line, mood: b.mood });
      yield readTime(line, 'said') + 0.3;
    }
    st.head = null;
    st.frozen = false;
    st.bus.emit({ type: 'headEnd', who: a.id });
    yield 0.4;
  }

  private *move(b: BeatOf<'move'>, region: string): Co {
    const a = this.st.actor(b.who);
    yield* this.settle([a.id]);
    const other = this.st.actors.get(b.to);
    if (other?.visible) yield* this.settle([other.id], 3);
    if (a.visible) this.walkTo(a, b.to, b.pace, region);
    else this.walkIn(a, b.to, region, b.pace);
  }

  private *enter(b: BeatOf<'enter'>, region: string): Co {
    for (const id of this.ids(b.who)) {
      const a = this.st.actor(id);
      yield* this.settle([id]);
      if (a.visible) this.walkTo(a, b.to, 'walk', region);
      else this.walkIn(a, b.to, region);
    }
  }

  private *exit(b: BeatOf<'exit'>): Co {
    const { st } = this;
    for (const id of this.ids(b.who)) {
      const a = st.actor(id);
      yield* this.settle([id]);
      if (!a.visible) continue;
      const exits = Object.values(st.set.exits).flat();
      const len = (p: Point) => st.set.path(a.pos, p)?.length ?? Infinity;
      const door = exits.reduce((best, p) => (len(p) < len(best) ? p : best));
      st.walk(a, door, PACE_OF[b.how], () => st.hide(a));
    }
  }

  private *gather(b: BeatOf<'gather'>, region: string): Co {
    const { st } = this;
    const set = st.set;
    const place = set.regions[b.to] ? b.to : region;
    const people = this.ids(b.who).map((i) => st.actor(i));
    const occ = st.occupied(...people);
    // Each person takes the nearest free seat of the room; whoever is left over stands.
    const taken = new Set<string>();
    for (const a of people) {
      if (!a.visible) st.show(a, this.exitCell(set.regions[place].cells[0]), true);
      const seats = this.seatsIn(place).filter((p) => !occ.has(key(p)) && !taken.has(key(p)));
      const seat = seats.sort((p, q) => this.dist(p, a) - this.dist(q, a))[0];
      const spot = seat ?? set.freeCellIn(place, new Set([...occ, ...taken]), () => st.rng.next());
      if (!spot) continue;
      taken.add(key(spot));
      if (spot.x !== a.x || spot.y !== a.y || a.moving) st.walk(a, spot, 'walk');
    }
    yield 0.2;
  }

  private *sit(b: BeatOf<'sit'>): Co {
    const { st } = this;
    for (const id of this.ids(b.who)) {
      const a = st.actor(id);
      yield* this.settle([id]);
      if (!a.visible || a.seated) continue;
      const region = st.set.regionAt(a.pos);
      const desk = a.desk ? st.set.spots[a.desk] : undefined;
      const occ = st.occupied(a);
      const seats = [...(desk ? [desk] : []), ...(region ? this.seatsIn(region) : [])].filter((p) => !occ.has(key(p)) && st.set.regionAt(p) === region);
      const seat = seats.sort((p, q) => this.dist(p, a) - this.dist(q, a))[0];
      if (seat) st.walk(a, seat, 'walk');
    }
  }

  private *stand(b: BeatOf<'stand'>): Co {
    for (const id of this.ids(b.who)) {
      yield* this.settle([id]);
      this.st.actor(id).seated = false;
    }
  }

  private *react(b: BeatOf<'react'>): Co {
    const { st } = this;
    for (const id of this.ids(b.who)) {
      const a = st.actor(id);
      if (!a.visible) continue;
      a.reaction = b.reaction;
      a.reactionUntil = st.wt + 1.6;
      st.bus.emit({ type: 'react', who: id, reaction: b.reaction });
    }
    yield 1.1;
  }

  private *action(b: BeatOf<'action'>, region: string): Co {
    const { st } = this;
    const a = st.actor(b.who);
    yield* this.settle([a.id]);
    if (!a.visible && DESK_SETS.has(st.setId)) yield* this.bringIn(a, null, region);
    const seconds = Math.max(2.2, Math.min(4, readTime(b.caption, 'narrated') + 0.8));
    st.note = { who: a.visible ? a.id : null, text: b.caption, until: st.wt + seconds };
    st.bus.emit({ type: 'action', who: a.id, caption: b.caption });
    yield seconds;
    yield 0.2;
  }

  private *pause(b: BeatOf<'pause'>): Co {
    const { st } = this;
    if (b.caption) st.pauseCaption = { text: b.caption, sub: '', until: st.time + b.seconds };
    st.bus.emit({ type: 'pause', seconds: b.seconds, caption: b.caption });
    yield b.seconds;
  }

  private *caption(b: BeatOf<'caption'>): Co {
    this.st.bus.emit({ type: 'caption', text: b.text });
    yield* this.card(b.text, '', 2);
  }
}
