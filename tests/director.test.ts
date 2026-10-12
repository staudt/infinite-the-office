import { describe, expect, it } from 'vitest';
import { Director } from '../src/choreo/director.ts';
import { CAST, DEMO_EPISODE, DEMO_ROSTER } from '../src/demo.ts';
import type { EngineEvent } from '../src/engine/events.ts';
import { Stage, TICK } from '../src/engine/stage.ts';
import { Episode } from '../src/schema/episode.ts';

/** Run the whole demo headlessly; `onTick` sees the stage after every tick. */
function run(seed: number, onTick?: (st: Stage) => void) {
  const st = new Stage(seed, CAST, DEMO_EPISODE, DEMO_ROSTER);
  const events: EngineEvent[] = [];
  st.on((e) => events.push(e));
  const task = st.spawn(new Director(st, DEMO_EPISODE, DEMO_ROSTER).play());
  while (!task.done && st.time < 3600) {
    st.update(TICK);
    onTick?.(st);
  }
  return { st, events, done: task.done };
}

describe('director', () => {
  it('plays the demo episode to the end in 5-15 minutes', () => {
    const { st, events, done } = run(1);
    expect(done).toBe(true);
    expect(st.time).toBeGreaterThan(5 * 60);
    expect(st.time).toBeLessThan(15 * 60);
    expect(events.filter((e) => e.type === 'sceneStart')).toHaveLength(DEMO_EPISODE.scenes.length);
    expect(events.at(-1)?.type).toBe('episodeEnd');
  });

  it('only lets visible people speak', () => {
    const bad: string[] = [];
    const st = new Stage(1, CAST, DEMO_EPISODE, DEMO_ROSTER);
    st.on((e) => {
      if (e.type === 'said' && !st.actor(e.who).visible) bad.push(`${e.t} ${e.who}`);
    });
    const task = st.spawn(new Director(st, DEMO_EPISODE, DEMO_ROSTER).play());
    while (!task.done) st.update(TICK);
    expect(bad).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const a = run(7).events, b = run(7).events;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never stands anyone on a wall', () => {
    const bad: string[] = [];
    run(3, (st) => {
      for (const a of st.visibleActors()) if (!st.set.walkable(a.pos)) bad.push(`${st.time} ${a.id} ${a.x},${a.y}`);
    });
    expect(bad).toEqual([]);
  });
});

describe('director with a sloppy episode', () => {
  it('plays unknown targets, unknown people and missing regions without stalling', () => {
    const ep = Episode.parse({
      title: 'Sloppy', logline: '', scenes: [
        { part: 'cold_open', set: 'office', region: 'the_moon', present: ['jim', 'ghost'], recap: 'x', beats: [
          { type: 'move', who: 'jim', to: 'nowhere_at_all', pace: 'walk' },
          { type: 'say', who: 'jim', text: 'Hello.', to: 'phantom', mood: 'happy' },
          { type: 'move', who: 'pam', to: 'none', pace: 'hurry' },
          { type: 'enter', who: ['dwight'], to: 'also_nowhere' },
          { type: 'gather', who: ['everyone'], to: 'not_a_region' },
          { type: 'exit', who: ['nobody'] },
          { type: 'say', who: 'ghost', text: 'Boo.', to: 'none', mood: 'neutral' },
        ] },
        { part: 'act1', set: 'warehouse', region: 'none', present: [], recap: 'y', beats: [
          { type: 'move', who: 'darryl', to: 'sky', pace: 'walk' },
          { type: 'say', who: 'darryl', text: 'Yo.', to: 'all', mood: 'neutral' },
        ] },
      ],
    });
    const st = new Stage(1, CAST, ep, DEMO_ROSTER, { extras: [{ id: 'gary', name: 'Gary', title: 'x', glyph: 'G', color: '#123456' }], deskOverrides: { kevin: 'jim_desk', oscar: 'bogus' } });
    expect(st.actors.get('gary')?.glyph).toBe('G');
    expect(st.actors.get('kevin')?.desk).toBe('jim_desk');
    expect(st.actors.get('oscar')?.desk).not.toBe('bogus');
    const task = st.spawn(new Director(st, ep, DEMO_ROSTER).play());
    while (!task.done && st.time < 600) st.update(TICK);
    expect(task.done).toBe(true);
  });
});

describe('kitchen and annex sets', () => {
  const scene = (set: string, region: string, present: string[]) => ({
    part: 'act1', set, region, present, recap: 'x', beats: [{ type: 'say', who: present[0], text: 'Hello there.', to: 'none', mood: 'neutral' }],
  });

  it('plays old office scenes with a kitchen or annex region in the new sets, with the annex crew at their desks', () => {
    const ep = Episode.parse({ title: 'Old', logline: '', scenes: [scene('office', 'kitchen', ['kevin']), scene('office', 'annex', ['kelly']), scene('annex', 'annex', ['ryan'])] });
    const roster = [...DEMO_ROSTER, 'ryan', 'toby'];
    const st = new Stage(1, CAST, ep, roster);
    const sets: string[] = [], seated: string[] = [];
    st.on((e) => {
      if (e.type === 'sceneStart') sets.push(`${e.set}/${e.region}`);
      if (e.type === 'said' && st.setId === 'annex') seated.push(...st.visibleActors().filter((a) => a.seated).map((a) => a.id));
    });
    const task = st.spawn(new Director(st, ep, roster).play());
    while (!task.done && st.time < 600) st.update(TICK);
    expect(task.done).toBe(true);
    expect(sets).toEqual(['kitchen/kitchen', 'annex/annex', 'annex/annex']);
    expect(seated).toContain('toby');
  });

  it('walks at a uniform pixel speed on a square-cell set', () => {
    const ep = Episode.parse({ title: 'Walk', logline: '', scenes: [scene('office', 'bullpen', ['jim'])] });
    const st = new Stage(1, CAST, ep, DEMO_ROSTER);
    st.enterSet('office');
    const jim = st.actor('jim'), a = st.set.spots.jim_desk;
    st.show(jim, a);
    const start = st.wt;
    st.walk(jim, { x: a.x, y: a.y + 10 });
    while (jim.moving) st.update(TICK);
    expect(st.wt - start).toBeCloseTo((10 * st.set.cellH) / 80, 0);
  });
});
