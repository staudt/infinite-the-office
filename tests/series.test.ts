import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETS } from '../src/sets/index.ts';
import { reviewEpisode } from '../src/writer/validate.ts';
import { applyEpisode } from '../src/world/apply.ts';
import { episodeLabel, needsBible, seasonOf } from '../src/world/season.ts';
import { replayStored } from '../src/cli/replay.ts';
import { draft, testSeries } from './helpers.ts';

const ep = (series = testSeries(), over = {}) => reviewEpisode(series, draft(5, over), SETS).episode!;

describe('series state', () => {
  it('season bible sets roster, desks, extras with a persistent look, gags and relationships', () => {
    const s = testSeries();
    expect(s.bibleSeason).toBe(1);
    expect(s.roster).toContain('gary_trundle');
    expect(s.deskOverrides).toEqual({ kevin: 'jim_desk' });
    const gary = s.extras[0];
    expect(gary).toMatchObject({ id: 'gary_trundle', since: 1 });
    expect(gary.glyph).toMatch(/^[A-Za-z]$/);
    expect(gary.color).toMatch(/^#/);
    expect(s.gags).toContain('Dwight\'s beets');
    expect(s.relationships).toEqual([{ a: 'jim', b: 'pam', status: 'crushing' }]);
    expect(needsBible(s)).toBe(false);
  });

  it('applyEpisode is pure and records history, plots, notes, state changes', () => {
    const s = testSeries();
    const before = JSON.stringify(s);
    const e = ep(s, { stateChanges: [{ type: 'relationship', a: 'jim', b: 'pam', status: 'dating' }, { type: 'arc', arc: 'The Promotion', progress: 'hinted' }, { type: 'gag', text: 'new gag' }, { type: 'note', text: 'setup' }] });
    const next = applyEpisode(s, e);
    expect(JSON.stringify(s)).toBe(before);
    expect(next.episode).toBe(1);
    expect(next.relationships).toEqual([{ a: 'jim', b: 'pam', status: 'dating' }]);
    expect(next.arcProgress['The Promotion']).toBe('hinted');
    expect(next.gags).toContain('new gag');
    expect(next.notes).toEqual([{ episode: 1, text: 'setup' }]);
    expect(next.storySoFar).toBe('s');
    expect(next.history[0]).toMatchObject({ episode: 1, title: 'The Test' });
    expect(next.recentPlots[0]).toContain('The Test');
  });

  it('keeps an invented extra\'s look and rolls into season 2 needing a new bible', () => {
    let s = testSeries();
    s = applyEpisode(s, ep(s, { extras: [{ id: 'harold_sims', name: 'Harold Sims', title: 'Fridge', voice: 'v' }] }));
    const harold = s.extras.find((x) => x.id === 'harold_sims')!;
    expect(harold.glyph).not.toBe(s.extras[0].glyph);
    for (let i = 0; i < 11; i++) s = applyEpisode(s, ep(s));
    expect(s.episode).toBe(12);
    expect(seasonOf(s.episode + 1)).toBe(2);
    expect(needsBible(s)).toBe(true);
    expect(s.extras.find((x) => x.id === 'harold_sims')).toEqual(harold);
    expect(episodeLabel(s, 12)).toBe('Season 1 · Episode 12 — Finale');
    expect(s.history.length).toBe(12);
  });
});

describe('series on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-'));
  beforeAll(() => {
    process.env.SESSIONS_DIR = join(dir, 'sessions');
    process.env.LIBRARY_DIR = join(dir, 'library');
  });
  afterAll(() => {
    delete process.env.SESSIONS_DIR;
    delete process.env.LIBRARY_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a series and its episodes, deterministically', async () => {
    const { saveSeries, saveEpisode, listLibrary, newSeriesId, exportLibrary, readStored } = await import('../server/sessions.ts');
    let s = testSeries();
    s = { ...s, id: newSeriesId(s.name, s.seed) };
    expect(s.id).toBe('test');
    expect(newSeriesId('Test', 1)).toBe('test'); // not saved yet
    saveSeries(s);
    expect(newSeriesId('Test', 1)).toBe('test-2');
    let live = s;
    for (let i = 0; i < 3; i++) {
      const e = ep(live);
      saveEpisode(live, i + 1, e);
      live = applyEpisode(live, e);
    }
    const replayed = replayStored(s.id)!;
    expect(replayed.series).toEqual(live);
    expect(replayed.episodes).toHaveLength(3);
    expect(listLibrary()).toMatchObject([{ id: 'test', episodes: 3, name: 'Test', source: 'sessions' }]);
    expect(readStored('../etc', 'series.json')).toBeNull();
    expect(exportLibrary().map((f) => f.path)).toEqual(['library/index.json']); // only library/ ships
  });
});
