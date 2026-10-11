import { firstName } from '../engine/cast';
import type { EngineEvent, EventOf } from '../engine/events';
import type { Stage } from '../engine/stage';
import type { Reaction } from '../schema/episode';
import { getSet } from '../sets/index.ts';

export function clock(t: number): string {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** What a reaction reads like in the script: "Jim looks at the camera". */
export const REACTION_TEXT: Record<Reaction, string> = {
  look_at_camera: 'looks at the camera', eye_roll: 'rolls their eyes', laugh: 'laughs', facepalm: 'facepalms', stare: 'stares',
  sigh: 'sighs', gasp: 'gasps', cringe: 'cringes', shrug: 'shrugs', cheer: 'cheers',
};

/** Screenplay slug line: "INT. CONFERENCE ROOM" / "EXT. PARKING LOT". */
export function sceneHeading(e: Pick<EventOf<'sceneStart'>, 'set' | 'region' | 'venue'>): string {
  if (e.set === 'offsite') return `INT. ${e.venue || 'OFFSITE'}`;
  const label = getSet(e.set).regions[e.region]?.label.text ?? e.set.replace('_', ' ').toUpperCase();
  return `${e.set === 'parking_lot' ? 'EXT' : 'INT'}. ${label}`;
}

/** Turn engine events into plain transcript lines (tests, terminal preview). */
export function transcriptLine(stage: Stage, e: EngineEvent): string | null {
  const name = (id: string) => firstName(stage.actor(id).name);
  switch (e.type) {
    case 'episodeStart':
      return `\n=== ${e.label.toUpperCase()}: ${e.title} ===`;
    case 'sceneStart':
      return `\n${sceneHeading(e)}`;
    case 'said':
      return `${clock(e.t)}  ${name(e.who).toUpperCase()}: ${e.text}`;
    case 'headSay':
      return `${clock(e.t)}  [TALKING HEAD] ${name(e.who).toUpperCase()}: ${e.text}`;
    case 'react':
      return `${clock(e.t)}  (${name(e.who)} ${REACTION_TEXT[e.reaction]})`;
    case 'action':
      return `${clock(e.t)}  (${name(e.who)} ${e.caption})`;
    case 'caption':
      return `${clock(e.t)}  -- ${e.text} --`;
    default:
      return null;
  }
}
