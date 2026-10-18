// The contract between the writer (LLM or a hand-written season) and the show engine.
// Parsing is lenient on purpose: a missing or invalid non-essential field is repaired
// with a sensible default (via .catch) instead of failing the whole episode, because
// every retry costs credits. Places are names from the set files (regions, spots), and
// people are character ids; the LLM never sees coordinates.
import { z } from 'zod';
import { Extra } from './common';
import { SeasonStart } from './season';

/** A string that falls back to `d` when missing or malformed. */
const str = (d = '') => z.string().catch(d);
/** A string list that falls back to [] (non-string items are dropped); a lone string becomes a list. */
const strs = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []),
    z.array(z.string()),
  );
/** A list whose invalid items are dropped one by one. */
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => item.safeParse(x).success) : []), z.array(item));

export { Extra };
export const SetId = z.enum(['office', 'kitchen', 'annex', 'break_room', 'parking_lot', 'warehouse', 'offsite']);
export const Part = z.enum(['cold_open', 'act1', 'act2', 'tag']);
export const Plot = z.enum(['cold_open', 'A', 'B', 'C', 'tag']);
export const Mood = z.enum([
  'neutral', 'happy', 'excited', 'awkward', 'annoyed', 'angry', 'sad', 'smug', 'nervous', 'deadpan', 'sarcastic', 'panicked',
]);
export const Reaction = z.enum([
  'look_at_camera', 'eye_roll', 'laugh', 'facepalm', 'stare', 'sigh', 'gasp', 'cringe', 'shrug', 'cheer',
]);
export const Verb = z.enum([
  'prank', 'phone_call', 'typing', 'eat', 'drink', 'hide', 'snoop', 'present', 'dance', 'sing', 'fall', 'hug', 'high_five', 'search', 'sleep', 'copy',
]);

export const Beat = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('say'),
    who: z.string(),
    text: z.string().describe('One short line of dialogue (under ~25 words)'),
    to: str('none').describe('Character id being addressed, "all", or "none"'),
    mood: Mood.catch('neutral'),
  }),
  z.object({
    type: z.literal('talking_head'),
    who: z.string(),
    lines: strs().describe('1-3 short lines said straight to the documentary camera'),
    mood: Mood.catch('neutral'),
  }),
  z.object({
    type: z.literal('move'),
    who: z.string(),
    to: z.string().describe('A region or spot name of the current set, or a character id to walk up to'),
    pace: z.enum(['walk', 'hurry', 'sneak']).catch('walk'),
  }),
  z.object({
    type: z.literal('enter'),
    who: strs(),
    to: str('none').describe('Where they go after entering: region, spot, character id, or "none"'),
  }),
  z.object({
    type: z.literal('exit'),
    who: strs(),
    how: z.enum(['walk', 'storm_off', 'sneak', 'run']).catch('walk'),
  }),
  z.object({
    type: z.literal('gather'),
    who: strs().describe('Character ids, or ["everyone"] for everyone in the scene'),
    to: str('conference_room').describe('Region they gather in, usually conference_room'),
  }),
  z.object({ type: z.literal('sit'), who: strs() }),
  z.object({ type: z.literal('stand'), who: strs() }),
  z.object({
    type: z.literal('react'),
    who: strs(),
    reaction: Reaction.catch('stare'),
  }),
  z.object({
    type: z.literal('action'),
    who: z.string(),
    verb: Verb.catch('typing'),
    target: str('none').describe('Character id or thing, or "none"'),
    caption: str().describe('A short stage direction shown on screen, e.g. "puts Dwight\'s stapler in Jell-O"'),
  }),
  z.object({
    type: z.literal('pause'),
    seconds: z.number().min(0.5).max(5).catch(2),
    caption: str().describe('Optional, e.g. "awkward silence"'),
  }),
  z.object({
    type: z.literal('caption'),
    text: z.string().describe('A title card, e.g. "LATER" or "3 HOURS INTO THE MEETING"'),
  }),
]);

export const Scene = z.object({
  part: Part.catch('act1'),
  plot: Plot.catch('A').describe('Which storyline this scene advances: cold_open, A (the main plot), B, C, or tag. Label every scene.'),
  set: SetId.catch('office'),
  region: str('none').describe('Region of the set the scene is focused on, or "none"'),
  venue: str().describe('Offsite only: the place shown on the title card, e.g. "CHILI\'S"'),
  present: strs().describe('Character ids on screen when the scene starts (others are offscreen, or at their desks in the background)'),
  away: strs().describe('Regulars not at their desks in this scene only (e.g. everyone gone home at night)'),
  recap: str().describe('One sentence: what happens in this scene'),
  beats: listOf(Beat),
});


export const StateChange = z.discriminatedUnion('type', [
  z.object({ type: z.literal('relationship'), a: z.string(), b: z.string(), status: z.string().describe('e.g. "dating", "rivals", "awkward after the kiss"') }),
  z.object({ type: z.literal('note'), text: z.string().describe('A storyline note or setup to pay off later') }),
  z.object({ type: z.literal('gag'), text: z.string().describe('A running gag used or started this episode') }),
  z.object({ type: z.literal('arc'), arc: z.string(), progress: z.string().describe('Where this season arc stands now') }),
]);

export const Episode = z.object({
  title: str('Untitled'),
  logline: str(),
  outline: str().describe('Plan written BEFORE the beats, under ~80 words: the A, B and C plots in one line each, then the scene order by plot'),
  theme: str().describe('The episode theme that ties the A, B and C plots together'),
  storySoFar: str().describe('Updated summary of the ongoing storylines, max ~150 words'),
  extras: listOf(Extra).describe('New recurring side characters introduced this episode'),
  away: strs().describe('Regulars who are away all episode (not drawn at their desks), e.g. on vacation or not hired yet'),
  scenes: z.array(Scene),
  stateChanges: listOf(StateChange),
  /** Set by the server on a season's first episode: the new bible (and cast changes) that this episode airs under. */
  seasonStart: SeasonStart.optional().catch(undefined),
});

// What the LLM writes: one flat list of beats, where a `scene` marker starts each
// scene. Models fill flat lists far more reliably than nested ones; `draftToEpisode`
// converts it into the nested Episode.
export const SceneMarker = Scene.omit({ beats: true }).extend({ type: z.literal('scene') });

export const EpisodeDraft = Episode.omit({ scenes: true, seasonStart: true }).extend({
  beats: z.array(z.unknown()).describe('The whole episode in order. Start EVERY scene with a {"type":"scene"} marker, followed by its beats.'),
});

/** Split the flat beat list at scene markers; beats before the first marker open an office scene. */
export function draftToEpisode(draft: EpisodeDraft): { episode: Episode; dropped: number } {
  const scenes: Scene[] = [];
  let dropped = 0;
  for (const raw of draft.beats) {
    if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'scene') {
      const m = SceneMarker.parse(raw);
      const { type: _t, ...rest } = m;
      scenes.push({ ...rest, beats: [] });
      continue;
    }
    const b = Beat.safeParse(raw);
    if (!b.success) {
      dropped++;
      continue;
    }
    if (!scenes.length) scenes.push(Scene.parse({ beats: [] }));
    scenes.at(-1)!.beats.push(b.data);
  }
  const { beats: _b, ...rest } = draft;
  return { episode: { ...rest, scenes: scenes.filter((s) => s.beats.length) }, dropped };
}

export type SetId = z.infer<typeof SetId>;
export type Plot = z.infer<typeof Plot>;
export type Part = z.infer<typeof Part>;
export type Mood = z.infer<typeof Mood>;
export type Reaction = z.infer<typeof Reaction>;
export type Verb = z.infer<typeof Verb>;
export type Beat = z.infer<typeof Beat>;
export type Scene = z.infer<typeof Scene>;

export type StateChange = z.infer<typeof StateChange>;
export type Episode = z.infer<typeof Episode>;
export type EpisodeDraft = z.infer<typeof EpisodeDraft>;
export type BeatOf<T extends Beat['type']> = Extract<Beat, { type: T }>;

/** Episodes written before the kitchen and annex became their own sets put them in the office as regions. */
export const remapLegacySet = <T extends { set: string; region: string }>(sc: T): T =>
  (sc.set === 'office' && (sc.region === 'kitchen' || sc.region === 'annex') ? { ...sc, set: sc.region } : sc);
