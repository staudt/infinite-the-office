// The sprite map view: the current set on a canvas (floors and walls, sprite furniture and people, y-sorted for
// occlusion) with an HTML layer for balloons and cards. Layout sets (plan.ts) and the procedural ASCII sets
// (ascii.ts) both come as a Plan, so there is one drawing path. Numbers live in geometry.ts, framing in camera.ts,
// balloon placement in balloons.ts, poses in pose.ts.
import { firstName } from '../engine/cast';
import type { EngineEvent } from '../engine/events';
import { readTime, type Stage } from '../engine/stage';
import type { SetMap } from '../sets/index.ts';
import { art } from './art';
import { buildAscii } from './ascii';
import { headRect, placeBalloon, type Anchor, type ScreenRect } from './balloons';
import { ease, frame, regionBox, shotBox, widenFor, type Cam } from './camera';
import { BALLOON, CAM_EASE, EMOTE, geoOf, SIDE_HALF, TORSO, WAIST, WALK_IN, type Geo } from './geometry';
import { drawGrid, GRID } from './grid';
import { MARKER } from './markers';
import { NameIndex } from './names';
import { buildPlan, type Dir, type Item, type Plan } from './plan';
import { atDeskSide, drawActor, lapY, poseFeet, poseOf, type Pose, type PoseEnv } from './pose';
import { esc } from './text';

/** `?cam=all` frames the whole set in every scene (for looking at a floor plan). */
const CAM_ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('cam') === 'all';
const VOID = '#050508';
/** Sort key for someone drawn over a prop whose base is at `B`: right after it, and among everyone else drawn over it
 *  in feet order, so a person standing in front of a sitter still covers the sitter's arms (and not the other way round). */
const overProp = (B: number, fy: number) => B + 0.1 + fy * 1e-5;

interface Built { plan: Plan; seats: Map<string, Plan['chairs'][number]> }
const built = new WeakMap<SetMap, Built>();
function builtFor(set: SetMap): Built {
  let l = built.get(set);
  if (l && (l.plan.ready?.() ?? true)) return l;
  const plan = set.layout ? buildPlan(set) : buildAscii(set, l?.plan);
  l = { plan, seats: new Map(plan.chairs.map((c) => [`${c.x},${c.y}`, c])) };
  built.set(set, l);
  return l;
}

interface GBalloon { anchor?: Anchor; who: string; text: string; el: HTMLDivElement; at: number; until: number; note: boolean; w: number; h: number; mw: number; pos: string; tail: string; t: string }

export class SpriteMapView {
  private canvas = document.createElement('canvas');
  private ui = document.createElement('div');
  private cardEl = document.createElement('div');
  private capEl = document.createElement('div');
  private logoEl = document.createElement('div');
  private logoKey = '';
  private lastShot: unknown = null;
  private names: NameIndex;
  private balloons = new Map<string, GBalloon>();
  private region = '';
  private cam: Cam | null = null;
  private snap = true;
  private lastWt = 0;
  private lastSet: SetMap | null = null;
  private lastSig = '';
  private heading = new Map<string, { dir: Dir; face: 1 | -1 }>();
  private dpr = 1;
  private cardKey = '';
  private capKey = '';

  constructor(private el: HTMLElement, private stage: Stage) {
    this.names = new NameIndex(stage);
    this.ui.className = 'sg-ui';
    this.cardEl.className = 'sg-card';
    this.cardEl.hidden = true;
    this.capEl.className = 'sg-cap';
    this.capEl.hidden = true;
    this.logoEl.className = 'sg-logo';
    this.logoEl.hidden = true;
    this.ui.append(this.cardEl, this.capEl, this.logoEl);
    el.replaceChildren(this.canvas, this.ui);
  }


  onEvent(e: EngineEvent): void {
    const st = this.stage;
    if (e.type === 'said') {
      const a = st.actor(e.who);
      this.removeBalloon(e.who);
      const el = document.createElement('div');
      el.className = 'sg-balloon';
      el.style.borderColor = a.color;
      el.innerHTML = `<b class="sg-who" style="color:${a.color}">${esc(firstName(a.name))}</b> ${this.names.html(e.text, esc)}`;
      this.ui.append(el);
      this.balloons.set(e.who, { who: e.who, text: e.text, el, at: st.wt, until: st.wt + readTime(e.text, 'said') + 0.3, note: false, w: 0, h: 0, mw: 0, pos: '', tail: '', t: '' });
    } else if (e.type === 'despawn') this.removeBalloon(e.id);
    else if (e.type === 'sceneStart') {
      for (const k of [...this.balloons.keys()]) this.removeBalloon(k);
      this.region = e.region;
      this.snap = true;
    }
  }

  private removeBalloon(key: string): void {
    this.balloons.get(key)?.el.remove();
    this.balloons.delete(key);
  }

  /** The stage direction near an actor, as an italic balloon. */
  private syncNote(): void {
    const st = this.stage, n = st.note;
    const live = n && n.who !== null && n.until > st.wt ? n : null;
    const cur = this.balloons.get('~note');
    const text = live ? `(${firstName(st.actor(live.who!).name)} ${live.text})` : '';
    if (cur && (!live || cur.text !== text)) this.removeBalloon('~note');
    if (live && !this.balloons.has('~note')) {
      const el = document.createElement('div');
      el.className = 'sg-balloon sg-dir';
      el.innerHTML = this.names.html(text, esc);
      this.ui.append(el);
      this.balloons.set('~note', { who: live.who!, text, el, at: st.wt, until: live.until, note: true, w: 0, h: 0, mw: 0, pos: '', tail: '', t: '' });
    }
  }

  /** Cells of `*_desk` seats: where people type (not guest chairs or the conference table). */
  private desks = new WeakMap<SetMap, Set<string>>();
  private deskCells(set: SetMap): Set<string> {
    let d = this.desks.get(set);
    if (!d) this.desks.set(set, (d = new Set(Object.entries(set.spots).filter(([n]) => n.endsWith('_desk')).map(([, p]) => `${p.x},${p.y}`))));
    return d;
  }

  // ---------------------------------------------------------------- render

  /** Draws the frame; true when the picture changed since the last call (the renderer reads this). */
  render(): boolean {
    const st = this.stage;
    // Undrawn characters wear a generic body in their color (cheap: a no-op once dressed).
    for (const a of st.actors.values()) art.dress(a.id, a.look, a.color, a.home);
    let changed = this.syncCard();
    if (st.card && st.card.until > st.time) return changed;
    const set = st.set;
    const { plan, seats } = builtFor(set), geo = geoOf(set);
    if (set !== this.lastSet) { this.lastSet = set; this.snap = true; this.lastSig = ''; }
    const cw = this.el.clientWidth, chh = this.el.clientHeight;
    if (!cw || !chh) return changed;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cw * this.dpr), ph = Math.round(chh * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this.lastSig = '';
      for (const b of this.balloons.values()) { b.mw = 0; b.anchor = undefined; }
    }
    const aspect = pw / ph, t = st.wt;
    this.syncNote();
    for (const [k, b] of this.balloons) if (b.until <= t || (!b.note && !st.actor(b.who).visible)) this.removeBalloon(k);

    const env: PoseEnv = { heading: this.heading, note: st.note, desks: this.deskCells(set), seats };
    const poses = st.visibleActors().map((a) => poseOf(a, t, env));
    // Camera: the scene's region, widened to keep whoever is talking in frame. Not for mere
    // walkers: background copier trips would keep pulling the shot wide.
    // The opening-title shot is forced: a hard cut, and may go tighter than scenes.
    const shot = st.shot;
    if (shot !== this.lastShot) { this.lastShot = shot; this.snap = true; }
    const box = shot ? shotBox(shot, geo, aspect) : { ...regionBox(CAM_ALL ? undefined : set.regions[this.region]?.cells, { w: set.width * geo.cw, h: set.height * geo.ch }, geo) };
    const talking = new Set([...this.balloons.values()].map((b) => b.who));
    if (!shot) widenFor(box, poses.filter((p) => p.a.speaking || talking.has(p.a.id)).map((p) => geo.foot(p.x, p.y)), geo.personH);
    const goal = frame(box, plan.W, plan.H, aspect, geo.maxZoom, !!shot);
    changed = this.syncLogo() || changed;
    const dt = Math.min(0.5, Math.max(0, t - this.lastWt));
    this.lastWt = t;
    if (!this.cam || this.snap) { this.cam = goal; this.snap = false; } else this.cam = ease(this.cam, goal, dt, CAM_EASE, plan.W, plan.H, aspect);
    const cam = this.cam;

    const sig = [
      st.pauseCaption && st.pauseCaption.until > st.time ? st.pauseCaption.text : '',
      `${Math.round(cam.cx)},${Math.round(cam.cy)},${Math.round(cam.w)}`,
      ...poses.map((p) => `${p.a.id}:${Math.round(p.x * geo.cw)},${Math.round(p.y * geo.ch)},${p.frame},${p.dir},${p.face},${p.seated ? 1 : 0},${p.art ?? ''},${p.a.reaction && p.a.reactionUntil > t ? p.a.reaction : ''}`),
      ...[...this.balloons.values()].map((b) => `${b.who}|${b.text}`),
    ].join(';');
    changed = this.syncCaption() || changed;
    if (sig === this.lastSig) return changed;
    this.lastSig = sig;

    this.draw(plan, geo, poses, cam, aspect, pw, ph);
    this.placeBalloons(poses, geo, cam, cw, chh);
    return true;
  }

  private draw(plan: Plan, geo: Geo, poses: Pose[], cam: Cam, aspect: number, pw: number, ph: number): void {
    const ctx = this.canvas.getContext('2d')!, { seats } = builtFor(this.stage.set);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const k = pw / cam.w, vx = cam.cx - cam.w / 2, vy = cam.cy - cam.w / aspect / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, pw, ph);
    ctx.setTransform(k, 0, 0, k, -vx * k, -vy * k);
    ctx.drawImage(plan.bg, 0, 0, plan.W, plan.H);

    // Doors swing ajar while someone is near (feet from the poses, so it follows show time like everything else).
    if (plan.doors) {
      const { near, open } = plan.doors, feet = poses.map((p) => poseFeet(p, geo));
      open.clear();
      near.forEach((r, i) => { if (feet.some((f) => f.fx >= r.x && f.fx < r.x + r.w && f.fy >= r.y && f.fy < r.y + r.h)) open.add(i); });
    }
    const vis = (i: Item) => i.x1 >= vx && i.x0 <= vx + cam.w && i.y1 >= vy && i.y0 <= vy + cam.w / aspect;
    // A sitter drawn with sit art brings their own chair, so the empty one at that seat goes.
    const taken = new Set(poses.filter((p) => p.seated && p.ownChair).map((p) => `${p.a.x},${p.a.y}`));
    const items: { k: number; f: (c: CanvasRenderingContext2D) => void }[] = plan.items.filter((i) => (!i.seat || !taken.has(i.seat)) && vis(i));
    for (const p of poses) {
      const { fx, fy } = poseFeet(p, geo);
      // A side sitter at a desk: whole behind it (legs under the desktop), then from the lap up over it (arms on top).
      if (atDeskSide(p)) {
        items.push({ k: fy, f: () => drawActor(ctx, p, geo, this.stage.wt) });
        items.push({ k: Math.max(fy, overProp(p.chair!.front!, fy)), f: () => drawActor(ctx, p, geo, this.stage.wt, lapY(p, geo)) });
        continue;
      }
      // Walking the last steps into such a seat (behind the reception desk): the same split, legs behind, torso over.
      const to = p.moving ? p.a.dest : null, goal = to ? seats.get(`${to.x},${to.y}`) : undefined;
      if (to && goal?.front != null && goal.dir === 'side' && fy < goal.front && Math.abs(to.x - p.a.x) + Math.abs(to.y - p.a.y) <= WALK_IN) {
        items.push({ k: fy, f: () => drawActor(ctx, p, geo, this.stage.wt) });
        items.push({ k: overProp(goal.front, fy), f: () => drawActor(ctx, p, geo, this.stage.wt, fy - geo.personH * WAIST) });
        continue;
      }
      // Other sitters marked `front` are drawn over the prop they sit at; the rest sort by their feet.
      let k = p.seated && p.chair?.front ? Math.max(fy, overProp(p.chair.front, fy)) : fy;
      // Anyone beside a prop's base (not behind it) overlaps its side, so they draw in front of it,
      // walking or seated; otherwise feet-sorting hides them whenever their feet are above its base.
      for (const s of plan.sides) {
        if (fy > s.top && fy < s.B && fx + SIDE_HALF > s.x0 && fx - SIDE_HALF < s.x1 && (fx <= s.sx0 || fx >= s.sx1)) k = Math.max(k, overProp(s.B, fy));
      }
      items.push({ k, f: () => drawActor(ctx, p, geo, this.stage.wt) });
      // A sitter facing the camera sits behind the desk in front of them (ASCII sets): redraw the torso over it.
      const tk = p.seated && p.dir === 'front' ? plan.torsoKey?.(p.a.x, p.a.y) ?? null : null;
      if (tk !== null) items.push({ k: tk, f: () => drawActor(ctx, p, geo, this.stage.wt, fy - TORSO.keep) });
    }
    items.sort((a, b) => a.k - b.k);
    for (const i of items) i.f(ctx);
    if (GRID) drawGrid(ctx, this.stage.set, poses.map((p) => p.a));

    // Reaction emotes in screen space, so they stay legible at any zoom.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const font = Math.round(EMOTE.font * this.dpr);
    ctx.font = `700 ${font}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of poses) {
      if (!p.a.reaction || p.a.reactionUntil <= this.stage.wt || p.art?.includes('_react_')) continue;
      const m = MARKER[p.a.reaction], w = ctx.measureText(m).width + font;
      const [fx, fy] = geo.foot(p.x, p.y);
      const sx = (fx - vx) * k, sy = (fy - geo.personH - EMOTE.lift - vy) * k;
      ctx.fillStyle = 'rgba(20,20,34,0.9)';
      ctx.beginPath();
      ctx.roundRect(sx - w / 2, sy - font * 0.9, w, font * 1.8, font * 0.9);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.fillText(m, sx, sy);
    }
  }

  // ---------------------------------------------------------------- HTML layer

  private syncCard(): boolean {
    const st = this.stage, c = st.card && st.card.until > st.time ? st.card : null;
    const key = c ? `${c.text}|${c.sub}` : '';
    if (key === this.cardKey) return false;
    this.cardKey = key;
    this.cardEl.hidden = !c;
    this.cardEl.innerHTML = c ? `<b>${esc(c.text.toUpperCase())}</b>${c.sub ? `<span>${esc(c.sub)}</span>` : ''}` : '';
    if (c) this.lastSig = '';
    return true;
  }

  private syncLogo(): boolean {
    const l = this.stage.logo, key = l ? `${l.title}|${l.label}` : '';
    if (key === this.logoKey) return false;
    this.logoKey = key;
    this.logoEl.hidden = !l;
    this.logoEl.innerHTML = l ? `<div class="sg-mark"><small>the</small> office</div><div class="sg-ep">${esc(l.title)}</div>${l.label ? `<div class="sg-label">${esc(l.label)}</div>` : ''}` : '';
    return true;
  }

  private syncCaption(): boolean {
    const st = this.stage, c = st.pauseCaption && st.pauseCaption.until > st.time ? st.pauseCaption.text : '';
    if (c === this.capKey) return false;
    this.capKey = c;
    this.capEl.hidden = !c;
    this.capEl.textContent = c;
    return true;
  }

  /** Balloons sit above the head; the placement rules are in balloons.ts. Here: world to screen, DOM measuring, style writes. */
  private placeBalloons(poses: Pose[], geo: Geo, cam: Cam, cw: number, chh: number): void {
    const k = cw / cam.w, vx = cam.cx - cam.w / 2, vy = cam.cy - cam.w / (cw / chh) / 2;
    const body = (p: Pose) => { const [fx, fy] = geo.foot(p.x, p.y); return { x: (fx - vx) * k, feet: (fy + geo.feetPad - vy) * k }; };
    // Walkers pass by: covering them for a moment is fine (and avoiding them would chase them around).
    const heads = poses.filter((p) => !p.moving).map((p) => { const b = body(p); return headRect(b.x, b.feet, geo.personH * k * (p.seated ? BALLOON.seatedH : 1), k); }), placed: ScreenRect[] = [];
    for (const b of [...this.balloons.values()].sort((a, c) => a.at - c.at)) {
      if (!b.mw || !b.w) {
        b.el.style.transform = '';
        b.w = b.el.offsetWidth;
        b.h = b.el.offsetHeight;
        b.mw = 1;
      }
      const p = poses.find((q) => q.a.id === b.who);
      if (!p) continue;
      const { x, feet } = body(p);
      const pick = placeBalloon(b.w, b.h, x, feet, geo.personH * k, k, cw, chh, heads, placed, b.anchor);
      b.anchor = pick.anchor;
      placed.push(pick.rect);
      const pos = `translate(${Math.round(pick.l)}px,${Math.round(pick.t)}px)`;
      if (b.pos !== pos) { b.pos = pos; b.el.style.transform = pos; }
      if (b.tail !== pick.side) { b.tail = pick.side; b.el.dataset.tail = pick.side; }
      const tv = `${Math.round(pick.tail)}px`;
      if (b.t !== tv) { b.t = tv; b.el.style.setProperty('--t', tv); }
    }
  }
}
