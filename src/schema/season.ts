// The season bible: what Sonnet plans once per season, and Haiku then follows episode by
// episode. Lenient like episode.ts: a bad optional field is repaired, not fatal.
import { z } from 'zod';
import { Extra } from './common';

const str = (d = '') => z.string().catch(d);
const strs = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []),
    z.array(z.string()),
  );
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => item.safeParse(x).success) : []), z.array(item));

export const Arc = z.object({
  name: z.string(),
  kind: z.enum(['A', 'B', 'C']).catch('B').describe('A = the season-long spine, B = a major subplot, C = a smaller runner'),
  summary: str(),
  perEpisode: listOf(z.object({
    episode: z.number().int().min(1).max(12).describe('Episode number within the season, 1-12'),
    beat: z.string().describe('What this arc does in that episode'),
  })).describe('Beats for the episodes this arc shows up in (not every episode)'),
  payoff: str().describe('How the arc resolves or pays off by the finale'),
});

export const SeasonBible = z.object({
  theme: z.string().describe('The season in one or two sentences'),
  era: str().describe('Which period of the show this season resembles, e.g. "Season 2-3 energy: Jim and Pam tension, Michael and Jan"'),
  roster: strs().describe('Character ids from the cast list who are regulars this season'),
  deskOverrides: listOf(z.object({ id: z.string(), spot: z.string() })).describe('Only when someone sits somewhere else than their usual desk'),
  manager: str('michael').describe('Character id of whoever runs the branch this season'),
  relationships: listOf(z.object({ a: z.string(), b: z.string(), status: z.string() })).describe('Where the important relationships stand at the start of the season'),
  arcs: z.array(Arc).describe('3-5 arcs'),
  extras: listOf(Extra).describe('0-3 NEW recurring side characters invented for this season'),
  runningGags: strs().describe('2-5 running gags to keep coming back'),
  tentpoles: listOf(z.object({
    episode: z.number().int().min(1).max(12),
    id: z.string().describe('A tentpole id from the list'),
    plan: z.string().describe('What the special episode does for this season\'s story'),
  })),
  finale: str().describe('The plan for episode 12: how arcs pay off and what hook it leaves for next season'),
  changes: str().describe('Seasons 2+: what changed in the cast since last season, and why (who left, who arrived)'),
});

export const SeasonStart = z.object({ season: z.number().int().min(1), bible: SeasonBible });

export type Arc = z.infer<typeof Arc>;
export type SeasonBible = z.infer<typeof SeasonBible>;
export type SeasonStart = z.infer<typeof SeasonStart>;
