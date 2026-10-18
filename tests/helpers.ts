import ep1 from '../library/scranton-the-golden-years/ep-001.json';
import goldenYears from '../library/scranton-the-golden-years/series.json';
import { Episode } from '../src/schema/episode.ts';
import { SETS } from '../src/sets/index.ts';
import { reviewBible } from '../src/writer/validate.ts';
import { applySeasonStart } from '../src/world/apply.ts';
import { newSeries, type Series } from '../src/world/state.ts';

/** A real stored episode to stage (the published season's first one) and the roster it airs with. */
export const EPISODE = Episode.parse(ep1);
export const ROSTER = goldenYears.roster as string[];

export const bible = (over: object = {}) => ({
  theme: 'Everyone wants a promotion', era: 'Season 2-3', manager: 'Michael Scott',
  roster: ['michael', 'dwight', 'jim', 'pam', 'ryan', 'stanley', 'phyllis', 'angela', 'oscar', 'kevin', 'Meredith Palmer', 'nobody_here'],
  deskOverrides: [{ id: 'kevin', spot: 'jim_desk' }, { id: 'oscar', spot: 'nowhere_desk' }],
  relationships: [{ a: 'jim', b: 'Pam Beesly', status: 'crushing' }],
  arcs: [{ name: 'The Promotion', kind: 'A', summary: 's', perEpisode: [{ episode: 3, beat: 'Michael hints' }, { episode: 99, beat: 'bad' }], payoff: 'p' }],
  extras: [{ id: 'Gary Trundle', name: 'Gary Trundle', title: 'Storage', voice: 'literal' }],
  runningGags: ['Dwight\'s beets'], tentpoles: [{ episode: 4, id: 'halloween', plan: 'x' }, { episode: 5, id: 'made_up', plan: 'x' }],
  finale: 'Michael picks', ...over,
});

export function testSeries(): Series {
  const r = reviewBible(newSeries('Test', 'Jim and Pam', 7), bible(), SETS);
  return applySeasonStart(newSeries('Test', 'Jim and Pam', 7), { season: 1, bible: r.bible! });
}

/** A flat draft with `scenes` scenes of 9 beats, using names and bad places on purpose. */
export function draft(scenes = 5, over: Record<string, unknown> = {}) {
  const beats: unknown[] = [];
  for (let i = 0; i < scenes; i++) {
    beats.push({ type: 'scene', part: i === 0 ? 'cold_open' : 'act1', set: 'office', region: i === 1 ? 'the_moon' : 'bullpen', present: ['jim', 'Pam Beesly', 'ghost'], recap: `Scene ${i + 1}` });
    beats.push({ type: 'say', who: 'Jim Halpert', text: 'x'.repeat(i === 2 ? 400 : 20), to: 'Pam', mood: 'deadpan' });
    beats.push({ type: 'say', who: 'pam', text: 'Hi.', to: 'jim' });
    beats.push({ type: 'say', who: 'nobody_at_all', text: 'I should be dropped.', to: 'jim' });
    beats.push({ type: 'move', who: 'jim', to: 'the_void', pace: 'walk' });
    beats.push({ type: 'move', who: 'pam', to: 'copier', pace: 'walk' });
    beats.push({ type: 'react', who: ['jim', 'phantom'], reaction: 'look_at_camera' });
    beats.push({ type: 'talking_head', who: 'jim', lines: ['One.', 'Two.', 'Three.', 'Four.'], mood: 'sarcastic' });
    beats.push({ type: 'say', who: 'dwight', text: 'False.', to: 'jim' });
    beats.push({ type: 'enter', who: ['dwight'], to: 'michael_office' });
    beats.push({ type: 'broken_beat', who: 'jim' });
  }
  return { title: 'Episode 4: The Test', logline: 'L', theme: 't', storySoFar: 's', extras: [], stateChanges: [{ type: 'relationship', a: 'jim', b: 'ghost', status: 'x' }, { type: 'note', text: 'n' }], beats, ...over };
}

