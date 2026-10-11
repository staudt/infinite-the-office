import { describe, expect, it } from 'vitest';
import { SETS } from '../src/sets/index.ts';
import { bibleUserPrompt, episodeSystemPrompt, episodeUserPrompt, pickDirectives, setListing } from '../src/writer/prompt.ts';
import { reviewBible, reviewEpisode } from '../src/writer/validate.ts';
import { newSeries } from '../src/world/state.ts';

import { bible, draft, testSeries } from './helpers.ts';

describe('prompts', () => {
  const series = testSeries();
  it('system prompt has the style, the set listing and the format', () => {
    const p = episodeSystemPrompt();
    expect(p).toContain('Cringe and warmth');
    expect(p).not.toContain('{{SETS}}');
    expect(p).toContain('conference_room');
    expect(p).toContain('exits to: parking_lot');
    expect(p).toContain('write_episode');
    expect(setListing()).toContain('**break_room**');
  });
  it('user prompt has the direction, bible beats, roster voices, and avoids old plots', () => {
    const s = { ...series, recentPlots: ['Old Plot: not again'], notes: [{ episode: 1, text: 'Kevin owes Oscar' }], storySoFar: 'Things happened.' };
    s.history = [{ episode: 1, title: 'Old Plot', logline: 'not again', sceneRecaps: ['a scene recap'] }];
    s.episode = 2;
    const p = episodeUserPrompt(s);
    expect(p).toContain('episode 3 of 12');
    expect(p).toContain('Jim and Pam');
    expect(p).toContain('Michael hints');
    expect(p).toContain('Dry, understated'); // Jim's voice
    expect(p).toContain('Gary Trundle'); // the extra
    expect(p).toContain('RECENTLY USED PLOTS');
    expect(p).toContain('a scene recap');
    expect(p).toContain('Kevin owes Oscar');
    expect(p).toContain('desk: jim_desk'.replace('desk', 'Desk'));
  });
  it('picks two stable directives per episode', () => {
    expect(pickDirectives(series, 3)).toHaveLength(2);
    expect(pickDirectives(series, 3)).toEqual(pickDirectives(series, 3));
    expect(pickDirectives(series, 3)).not.toEqual(pickDirectives(series, 4));
  });
  it('bible prompt for season 2 carries the history', () => {
    const s = { ...series, episode: 12, history: [{ episode: 12, title: 'Finale', logline: 'Big finish', sceneRecaps: [] }] };
    const p = bibleUserPrompt(s);
    expect(p).toContain('season 2');
    expect(p).toContain('Big finish');
    expect(p).toContain('The cast may change');
  });
});

describe('reviewBible', () => {
  it('resolves names, drops unknowns and bad tentpoles/desks', () => {
    const r = reviewBible(newSeries('T', '', 1), bible(), SETS);
    const b = r.bible!;
    expect(b.manager).toBe('michael');
    expect(b.roster).toContain('meredith');
    expect(b.roster).not.toContain('nobody_here');
    expect(b.roster).toContain('gary_trundle');
    expect(b.deskOverrides).toEqual([{ id: 'kevin', spot: 'jim_desk' }]);
    expect(b.relationships).toEqual([{ a: 'jim', b: 'pam', status: 'crushing' }]);
    expect(b.tentpoles).toHaveLength(1);
  });
  it('rejects a bible with no arcs', () => {
    expect(reviewBible(newSeries('T', '', 1), bible({ arcs: [] }), SETS).bible).toBeNull();
  });
});

describe('reviewEpisode', () => {
  const series = testSeries();
  it('repairs names, places and lengths, and drops broken beats', () => {
    const r = reviewEpisode(series, draft(), SETS);
    const ep = r.episode!;
    expect(ep).not.toBeNull();
    expect(ep.title).toBe('The Test');
    expect(ep.scenes).toHaveLength(5);
    const s0 = ep.scenes[0];
    expect(s0.present).toEqual(['jim', 'pam']);
    expect(s0.beats[0]).toMatchObject({ type: 'say', who: 'jim', to: 'pam' });
    expect(s0.beats.some((b) => b.type === 'say' && b.who === 'nobody_at_all')).toBe(false);
    expect(s0.beats.find((b) => b.type === 'move' && b.who === 'jim')).toMatchObject({ to: 'none' });
    expect(s0.beats.find((b) => b.type === 'react')).toMatchObject({ who: ['jim'] });
    expect(s0.beats.find((b) => b.type === 'talking_head')).toMatchObject({ lines: ['One.', 'Two.', 'Three.'] });
    expect(ep.scenes[1].region).toBe('none');
    const long = ep.scenes[2].beats[0];
    expect(long.type === 'say' && long.text.length).toBeLessThanOrEqual(221);
    expect(ep.stateChanges).toEqual([{ type: 'note', text: 'n' }]);
    expect(r.problems.some((p) => p.includes('the_moon'))).toBe(true);
    expect(r.problems.some((p) => p.includes('malformed'))).toBe(true);
  });
  it('is unplayable with too few scenes or beats', () => {
    expect(reviewEpisode(series, draft(3), SETS).episode).toBeNull();
    const tiny = draft(5);
    tiny.beats = tiny.beats.filter((_, i) => i % 11 < 3 || i % 11 === 0);
    expect(reviewEpisode(series, tiny, SETS).episode).toBeNull();
  });
  it('flags (but allows) too few talking heads, and accepts JSON-string beats', () => {
    const d = draft(5);
    d.beats = d.beats.filter((b) => (b as { type: string }).type !== 'talking_head');
    const r = reviewEpisode(series, { ...d, beats: JSON.stringify(d.beats) }, SETS);
    expect(r.episode).not.toBeNull();
    expect(r.problems.some((p) => p.includes('talking head'))).toBe(true);
  });
  it('is idempotent: reviewing a reviewed episode changes nothing', () => {
    const once = reviewEpisode(series, draft(), SETS).episode!;
    const twice = reviewEpisode(series, JSON.parse(JSON.stringify(once)), SETS).episode!;
    expect(twice).toEqual(once);
  });
  it('lets a new extra speak in the episode it is introduced', () => {
    const d = draft(5, { extras: [{ id: 'Harold Sims', name: 'Harold Sims', title: 'Fridge', voice: 'v' }] });
    (d.beats as unknown[]).splice(2, 0, { type: 'say', who: 'harold_sims', text: 'Harold Sims, Vance Refrigeration.', to: 'jim' });
    const ep = reviewEpisode(series, d, SETS).episode!;
    expect(ep.extras.map((x) => x.id)).toEqual(['harold_sims']);
    expect(ep.scenes[0].beats.some((b) => b.type === 'say' && b.who === 'harold_sims')).toBe(true);
  });
});

describe('pacing repairs', () => {
  const series = testSeries();
  const scene = (plot: string, extra: unknown[] = []) => [
    { type: 'scene', part: 'act1', plot, set: 'office', present: ['jim'], recap: 'r' },
    { type: 'say', who: 'jim', text: 'Hello there.', to: 'pam' },
    { type: 'say', who: 'pam', text: 'Hi.', to: 'jim' },
    { type: 'say', who: 'dwight', text: 'False.', to: 'jim' },
    ...Array.from({ length: 6 }, () => ({ type: 'say', who: 'jim', text: 'Sure.', to: 'pam' })),
    ...extra,
  ];
  const ep = (beats: unknown[]) => ({ title: 'T', beats });
  const look = (who: string) => ({ type: 'react', who: [who], reaction: 'look_at_camera' });
  const looks = (e: NonNullable<ReturnType<typeof reviewEpisode>['episode']>) =>
    e.scenes.flatMap((s) => s.beats).filter((b) => b.type === 'react' && b.reaction === 'look_at_camera');

  it('defaults a missing or bad plot to A', () => {
    const r = reviewEpisode(series, ep([...scene('nonsense'), ...scene('B'), ...scene('C'), ...scene('tag')]), SETS);
    expect(r.episode!.scenes[0].plot).toBe('A');
    expect(r.episode!.scenes[1].plot).toBe('B');
  });
  it('caps look_at_camera per person and per episode, keeping the first', () => {
    const beats = [...scene('A', [look('jim'), look('jim'), look('jim')]), ...scene('B', [look('pam'), look('pam'), look('dwight'), look('oscar')]), ...scene('C'), ...scene('tag')];
    const r = reviewEpisode(series, ep(beats), SETS);
    const kept = looks(r.episode!);
    expect(kept).toHaveLength(4);
    expect(kept.map((b) => (b as { who: string[] }).who[0])).toEqual(['jim', 'jim', 'pam', 'pam']);
    const third = r.episode!.scenes[0].beats.filter((b) => b.type === 'react')[2];
    expect(third).toMatchObject({ reaction: 'stare' });
    expect(r.problems.some((p) => p.includes('look_at_camera'))).toBe(true);
  });
  it('drops talking heads beyond 2 per scene', () => {
    const head = { type: 'talking_head', who: 'jim', lines: ['Hm.'] };
    const r = reviewEpisode(series, ep([...scene('A', [head, head, head]), ...scene('B'), ...scene('C'), ...scene('tag')]), SETS);
    expect(r.episode!.scenes[0].beats.filter((b) => b.type === 'talking_head')).toHaveLength(2);
    expect(r.problems.some((p) => p.includes('talking heads'))).toBe(true);
  });
  it('reports runs of 3+ same-plot scenes and a thin A-plot, without changing the episode', () => {
    const r = reviewEpisode(series, ep([...scene('A'), ...scene('B'), ...scene('B'), ...scene('B'), ...scene('C')]), SETS);
    expect(r.episode!.scenes).toHaveLength(5);
    expect(r.problems.some((p) => p.includes('in a row of plot B'))).toBe(true);
    expect(r.problems.some((p) => p.includes('A-plot has only 1'))).toBe(true);
  });
  it('is quiet about a well-interleaved episode', () => {
    const order = ['cold_open', 'A', 'B', 'A', 'C', 'B', 'A', 'tag'];
    const r = reviewEpisode(series, ep(order.flatMap((p) => scene(p, [{ type: 'talking_head', who: 'jim', lines: ['Hm.'] }]))), SETS);
    expect(r.problems).toEqual([]);
  });
});

describe('action captions', () => {
  it('strips a leading actor name', () => {
    const d = draft(5);
    (d.beats as unknown[]).splice(2, 0, { type: 'action', who: 'jim', verb: 'prank', target: 'dwight', caption: 'Jim slides the stapler into Jell-O' });
    const ep = reviewEpisode(testSeries(), d, SETS).episode!;
    expect(ep.scenes[0].beats.find((b) => b.type === 'action')).toMatchObject({ caption: 'slides the stapler into Jell-O' });
  });
});
