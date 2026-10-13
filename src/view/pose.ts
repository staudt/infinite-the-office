// What a person looks like right now (pose) and how it is drawn: walk sheets, sit/type/phone/react art, or a
// colored placeholder. Reads actor state only; the view owns the canvas and the order.
import type { Actor } from '../engine/actor';
import { hashId } from '../engine/rng';
import type { Stage } from '../engine/stage';
import type { Reaction } from '../schema/episode';
import { art } from './art';
import { ART_H, DESK_SIT, PLACEHOLDER_H, SEAT_BASE, SEAT_DROP, SHADOW, TORSO, type Geo } from './geometry';
import type { Chair, Dir } from './plan';

/** Reactions drawn as standing pose art (`<id>_react_<pose>`); without 'look' art, a look just turns to the camera. Others keep the emote. */
const REACT_POSE: Partial<Record<Reaction, string>> = {
  gasp: 'gasp', laugh: 'laugh', cheer: 'laugh', facepalm: 'facepalm', cringe: 'facepalm', sigh: 'sad', look_at_camera: 'look', stare: 'look',
};

/** An anim's name if its art is loaded. */
const poseArt = (name: string): string | null => (art.anim(name) && art.image(name) ? name : null);

export interface Pose { a: Actor; x: number; y: number; moving: boolean; dir: Dir; face: 1 | -1; seated: boolean; frame: number; chair: Chair | null; /** Pose art drawn instead of the walk sheet (sit/type/phone/react), and whether it brings its own chair. */ art: string | null; ownChair: boolean }

/** What poseOf needs besides the actor. */
export interface PoseEnv {
  /** Last walking direction per actor (kept so a stopped walker keeps facing the way they went). */
  heading: Map<string, { dir: Dir; face: 1 | -1 }>;
  note: Stage['note'];
  /** Cells of `*_desk` seats: where people type. */
  desks: Set<string>;
  /** Seat cells by "x,y". */
  seats: Map<string, Chair>;
}

export function poseOf(a: Actor, t: number, env: PoseEnv): Pose {
  let x = a.x, y = a.y, moving = false;
  const hd = env.heading.get(a.id) ?? { dir: 'front' as Dir, face: a.facing };
  if (a.dest && a.stepFrom && a.stepTo && a.stepEnd > a.stepStart) {
    const u = Math.max(0, Math.min(1, (t - a.stepStart) / (a.stepEnd - a.stepStart)));
    x = a.stepFrom.x + (a.stepTo.x - a.stepFrom.x) * u;
    y = a.stepFrom.y + (a.stepTo.y - a.stepFrom.y) * u;
    moving = true;
    const dx = a.stepTo.x - a.stepFrom.x, dy = a.stepTo.y - a.stepFrom.y;
    if (dx) { hd.dir = 'side'; hd.face = dx > 0 ? 1 : -1; } else hd.dir = dy > 0 ? 'front' : 'back';
  } else if (hd.dir === 'side') hd.face = a.facing;
  env.heading.set(a.id, hd);
  const chair = a.seated ? env.seats.get(`${a.x},${a.y}`) ?? null : null;
  const dir = chair ? chair.dir : hd.dir, face = chair ? chair.face : hd.face;
  const base = { a, x, y, moving, dir, face, chair, ownChair: false };
  const busy = a.speaking || (a.reaction !== null && a.reactionUntil > t);
  if (chair) {
    // At a desk: phone when a stage direction says so, else type in bursts (sometimes a call instead),
    // phased per person so a room never types in sync; show time, so renders match.
    const note = env.note, called = !!note && note.who === a.id && note.until > t && /phone|call/i.test(note.text);
    const desk = env.desks.has(`${a.x},${a.y}`);
    const ph = (hashId(a.id) % 997) / 997, cyc = t / 7 + ph, on = desk && !busy && cyc % 1 < 0.65;
    const phone = poseArt(`${a.id}_phone_${dir}`), type = poseArt(`${a.id}_type_${dir}`), sit = poseArt(`${a.id}_sit_${dir}`);
    if (phone && (called || (on && Math.floor(cyc) % 4 === 0))) return { ...base, seated: true, frame: 0, art: phone, ownChair: true };
    if (type && on) return { ...base, seated: true, frame: Math.floor(t * 6) % 2, art: type, ownChair: true };
    return { ...base, seated: true, frame: 0, art: sit, ownChair: !!sit };
  }
  // Standing still with a reaction: its pose art, or turn to the camera for a look.
  const r = !moving && a.reaction && a.reactionUntil > t ? REACT_POSE[a.reaction] : undefined;
  const react = r ? poseArt(`${a.id}_react_${r}`) : null;
  if (react) return { ...base, seated: false, frame: 0, art: react };
  if (r === 'look') return { ...base, dir: 'front', seated: false, frame: 0, art: null };
  return { ...base, seated: false, frame: moving ? 1 + (Math.floor(t * 8) % 4) : 0, art: null };
}

/** A side-facing sitter at a desk: drawn in two layers around the desk (see DESK_SIT). */
export const atDeskSide = (p: Pose): boolean => p.seated && p.dir === 'side' && p.chair?.front != null;

/** Where a pose's feet are (world px): seated people sink into the chair; side sitters at a desk sit back from it. */
export function poseFeet(p: Pose, geo: Geo): { fx: number; fy0: number; fy: number } {
  const [x, y] = geo.foot(p.x, p.y), desk = atDeskSide(p);
  const fx = desk ? x - p.face * DESK_SIT.back : x, fy0 = desk ? y + DESK_SIT.down : y;
  return { fx, fy0, fy: fy0 + (p.seated ? SEAT_DROP : 0) };
}

/** The lap line of a seated pose (world y): above it is what shows over the desk in front of them. */
export function lapY(p: Pose, geo: Geo): number {
  const { fy0, fy } = poseFeet(p, geo), pa = p.art ? art.anim(p.art) : undefined;
  return pa ? fy0 + SEAT_BASE - DESK_SIT.lap * pa.frameH * (geo.personH / ART_H) : fy - TORSO.keep; // placeholder: ASCII torso line
}

/** Draw one person. `cut`: only the part above this world y (the torso over a desk in front of them; the legs stay
 *  hidden under it). `wt` is show time (placeholder bob). */
export function drawActor(ctx: CanvasRenderingContext2D, p: Pose, geo: Geo, wt: number, cut?: number): void {
  const a = p.a, u = geo.personH / PLACEHOLDER_H, { fx, fy0, fy } = poseFeet(p, geo);
  if (cut !== undefined) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(fx - TORSO.half, fy - TORSO.up, TORSO.half * 2, cut - (fy - TORSO.up));
    ctx.clip();
    drawActor(ctx, p, geo, wt);
    ctx.restore();
    return;
  }
  if (!p.seated) {
    ctx.fillStyle = `rgba(0,0,0,${SHADOW.alpha})`;
    ctx.beginPath();
    ctx.ellipse(fx, fy, SHADOW.rx * u, SHADOW.ry * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const pa = p.art ? art.anim(p.art) : undefined, pim = p.art ? art.image(p.art) : null;
  if (pa && pim) {
    // Pose art shares the walk art's pixel density. Seated art includes the chair, so its base sits where the
    // empty chair stood; standing reactions stand on the feet like the walk sheet.
    const s = geo.personH / ART_H;
    ctx.save();
    ctx.translate(fx, p.seated ? fy0 + SEAT_BASE : fy);
    if (p.seated && p.dir === 'side' && p.face === -1) ctx.scale(-1, 1); // seated side art faces right
    ctx.drawImage(pim, p.frame * pa.frameW, 0, pa.frameW, pa.frameH, -pa.anchorX * s, -pa.anchorY * s, pa.frameW * s, pa.frameH * s);
    ctx.restore();
    return;
  }
  const an = art.anim(`${a.id}_walk_${p.dir}`) && art.image(`${a.id}_walk_${p.dir}`) ? `${a.id}_walk_${p.dir}` : art.anim(`${a.id}_walk_front`) && art.image(`${a.id}_walk_front`) ? `${a.id}_walk_front` : null;
  const anim = an ? art.anim(an)! : null;
  if (anim && an) {
    const s = geo.personH / ART_H, im = art.image(an)!;
    // Side art faces left; mirror for right. The front and back views are symmetric enough.
    const flip = an.endsWith('_side') && p.face === 1;
    ctx.save();
    ctx.translate(fx, fy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(im, p.frame * anim.frameW, 0, anim.frameW, anim.frameH, -anim.anchorX * s, -anim.anchorY * s, anim.frameW * s, anim.frameH * s);
    ctx.restore();
    return;
  }
  // Placeholder for anyone not drawn yet: a colored body, a head, and their letter (drawn at PLACEHOLDER_H tall, scaled).
  const bob = p.moving ? Math.sin(wt * 18) * 2 : 0;
  ctx.save();
  ctx.translate(fx, fy - 2 + bob);
  ctx.scale(u, u);
  ctx.fillStyle = a.color;
  ctx.beginPath();
  ctx.roundRect(-13, -48, 26, 48, 9);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-13, -14, 26, 14);
  ctx.fillStyle = '#e8c19a';
  ctx.beginPath();
  ctx.arc(0, -60, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#10101a';
  ctx.font = '700 20px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.glyph, 0, -28);
  ctx.restore();
}
