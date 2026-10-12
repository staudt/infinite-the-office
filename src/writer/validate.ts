// Semantic checks on top of the lenient Zod schemas. `reviewEpisode` repairs what it can
// (names -> ids, unknown places -> 'none', overlong lines), drops what it can't, and
// returns an episode that is always safe to stage, or null when too little is left.
// Sets are passed in so this runs in the browser (Vite glob) and in node (fs) alike.
import { type Beat, draftToEpisode, Episode, EpisodeDraft, type Scene } from '../schema/episode';
import { SeasonBible } from '../schema/season';
import type { SetMap } from '../sets/index.ts';
import { castById, CAST } from '../world/cast';
import { SEASON_LENGTH, TENTPOLES } from '../world/season';
import type { Series } from '../world/state';
import { matchCharacter, unstringify } from './json';

export type Sets = Record<string, SetMap>;
export interface EpisodeReview { episode: Episode | null; problems: string[] }
export interface BibleReview { bible: SeasonBible | null; problems: string[] }

const MIN_SCENES = 4;
const MIN_BEATS = 30;
const MAX_SCENES = 18;
const MAX_LINE = 220;
// Pacing limits, enforced as non-fatal repairs or reports (tune freely).
const MAX_CAMERA_LOOKS = 4; // look_at_camera per episode (excess becomes another reaction)
const MAX_CAMERA_LOOKS_PER_PERSON = 2;
const MAX_HEADS_PER_SCENE = 2; // extra talking heads in a scene are dropped
const MAX_PLOT_RUN = 2; // reported only: consecutive scenes of the same plot
const MIN_A_SCENES = 3; // reported only
const LOOK_REPLACEMENTS = ['stare', 'sigh', 'eye_roll'] as const;
const MAX_CAPTION = 120;
const SPECIAL = new Set(['everyone', 'all', 'none']);

const slug = (s: string) => s.toLowerCase().replace(/"[^"]*"/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Cut an overlong line at a sentence or word boundary. */
export function capText(s: string, max = MAX_LINE): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max)}…`;
}

/** Resolves loose references ("Michael Scott", "michael_scott", "dwight") to known ids. */
function resolver(people: { id: string; name: string }[]) {
  const ids = new Set(people.map((p) => p.id));
  const alias = new Map<string, string>();
  const firstOf = (p: { name: string }) => slug(p.name.split(/\s+/)[0]);
  for (const p of people) alias.set(slug(p.name), p.id);
  // A first name that two people share resolves to no one.
  for (const p of people) if (people.filter((q) => firstOf(q) === firstOf(p)).length === 1) alias.set(firstOf(p), p.id);
  const one = (ref: string): string | null => {
    if (ids.has(ref)) return ref;
    const s = slug(ref);
    return ids.has(s) ? s : alias.get(s) ?? matchCharacter(ref, people)?.id ?? null;
  };
  const ref = (r: unknown): string | null => (typeof r === 'string' ? (SPECIAL.has(r) ? r : one(r)) : null);
  return { ref, ids };
}

function everyone(series: Series, extra: { id: string; name: string }[] = []) {
  const seen = new Set<string>();
  return [
    ...CAST.map((c) => ({ id: c.id, name: c.name })),
    ...series.extras.map((e) => ({ id: e.id, name: e.name })),
    ...extra,
  ].filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/** The show prepends the actor's name to an action, so "Jim slides..." would read "Jim Jim slides...". */
function stripName(caption: string, fullName: string): string {
  const names = [fullName, fullName.split(' ')[0]].map((n) => n.replace(/[^\w ]/g, '')).filter(Boolean);
  return names.length ? caption.replace(new RegExp(`^(?:${names.join('|')})\\b[ ,]*`, 'i'), '') : caption;
}

/** Clean title: the show adds "Episode N" itself. */
const cleanTitle = (t: string) => t.replace(/^\s*(?:season\s*\d+\s*,?\s*)?(?:episode|ep\.?)\s*#?\d+\s*[:\-–—|]\s*/i, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();

export function reviewEpisode(series: Series, raw: unknown, sets: Sets): EpisodeReview {
  const problems: string[] = [];
  const input = unstringify(raw);
  if (!isObj(input)) return { episode: null, problems: ['the episode was not an object'] };
  // Nested episodes (stored shows) and flat drafts (fresh from the LLM) both come through here.
  let nested: Episode;
  let seasonStart: Episode['seasonStart'];
  if (Array.isArray(input.scenes) && !Array.isArray(input.beats)) {
    const p = Episode.safeParse(input);
    if (!p.success) return { episode: null, problems: p.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`) };
    nested = p.data;
    seasonStart = p.data.seasonStart;
  } else {
    // Models sometimes put the flat list under `scenes`.
    const flat = Array.isArray(input.beats) ? input : { ...input, beats: input.scenes };
    const p = EpisodeDraft.safeParse(flat);
    if (!p.success) return { episode: null, problems: p.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`) };
    let result: ReturnType<typeof draftToEpisode>;
    try {
      result = draftToEpisode(p.data);
    } catch (err) {
      return { episode: null, problems: [`a scene marker was malformed: ${(err as Error).message}`] };
    }
    nested = result.episode;
    if (result.dropped) problems.push(`${result.dropped} malformed beat(s) dropped`);
  }
  const ep = structuredClone(nested);
  if (seasonStart) ep.seasonStart = seasonStart;

  // New recurring characters first, so beats can use them.
  const taken = new Set([...CAST.map((c) => c.id), ...series.extras.map((e) => e.id)]);
  const fresh: Episode['extras'] = [];
  for (const x of ep.extras) {
    const id = slug(x.id) || slug(x.name);
    if (!id || !x.name.trim()) continue;
    if (taken.has(id)) {
      problems.push(`extra "${x.id}" already exists`);
      continue;
    }
    taken.add(id);
    fresh.push({ ...x, id });
  }
  ep.extras = fresh;
  const bibleExtras = (ep.seasonStart?.bible.extras ?? []).map((x) => ({ id: x.id, name: x.name }));
  const { ref } = resolver(everyone(series, [...fresh.map((x) => ({ id: x.id, name: x.name })), ...bibleExtras]));
  const one = (r: unknown) => { const v = ref(r); return v && !SPECIAL.has(v) ? v : null; };
  const list = (v: string[], where: string) => {
    const out = v.map((w) => (w === 'everyone' || w === 'all' ? 'everyone' : one(w) ?? w)).filter((w) => {
      const ok = w === 'everyone' || one(w);
      if (!ok) problems.push(`${where}: unknown person "${w}" dropped`);
      return ok;
    });
    return [...new Set(out)];
  };

  const scenes: Scene[] = [];
  ep.scenes.slice(0, MAX_SCENES).forEach((sc, si) => {
    const where = `scene ${si + 1}`;
    // The kitchen and annex used to be regions of the office; a writer that still says so gets the set.
    if (sc.set === 'office' && (sc.region === 'kitchen' || sc.region === 'annex')) sc.set = sc.region;
    const set = sets[sc.set] ?? sets.office;
    if (sc.region !== 'none' && !set.regions[sc.region]) {
      problems.push(`${where}: unknown region "${sc.region}" in ${sc.set}, using none`);
      sc.region = 'none';
    }
    if (sc.set === 'offsite' && !sc.venue.trim()) sc.venue = 'OFFSITE';
    sc.venue = sc.venue.toUpperCase().slice(0, 30);
    sc.present = list(sc.present, where).filter((p) => p !== 'everyone');
    sc.recap = capText(sc.recap, 200);
    const place = (to: string, whereB: string): string => {
      if (to === 'none' || set.regions[to] || set.spots[to]) return to;
      const who = one(to);
      if (who) return who;
      problems.push(`${whereB}: unknown place "${to}" in ${sc.set}, using none`);
      return 'none';
    };
    const beats: Beat[] = [];
    let heads = 0;
    sc.beats.forEach((b, bi) => {
      const w = `${where} beat ${bi + 1} (${b.type})`;
      const person = (id: string): string | null => {
        const r = one(id);
        if (!r) problems.push(`${w}: unknown person "${id}", beat dropped`);
        return r;
      };
      switch (b.type) {
        case 'say': {
          const who = person(b.who);
          const text = capText(b.text);
          if (!who || !text) return;
          const to = ref(b.to) ?? 'none';
          beats.push({ ...b, who, text, to: to === 'everyone' ? 'all' : to });
          return;
        }
        case 'talking_head': {
          const who = person(b.who);
          const lines = b.lines.map((l) => capText(l)).filter(Boolean).slice(0, 3);
          if (!who || !lines.length) return;
          if (++heads > MAX_HEADS_PER_SCENE) {
            problems.push(`${w}: more than ${MAX_HEADS_PER_SCENE} talking heads in one scene, extra dropped`);
            return;
          }
          beats.push({ ...b, who, lines });
          return;
        }
        case 'move': {
          const who = person(b.who);
          if (who) beats.push({ ...b, who, to: place(b.to, w) });
          return;
        }
        case 'enter': {
          const who = list(b.who, w);
          if (who.length) beats.push({ ...b, who, to: place(b.to, w) });
          return;
        }
        case 'gather': {
          const who = list(b.who, w);
          if (who.length) beats.push({ ...b, who, to: set.regions[b.to] ? b.to : 'none' });
          return;
        }
        case 'exit':
        case 'sit':
        case 'stand':
        case 'react': {
          const who = list(b.who, w);
          if (who.length) beats.push({ ...b, who });
          return;
        }
        case 'action': {
          const who = person(b.who);
          const full = who ? castById(who)?.name ?? series.extras.find((e) => e.id === who)?.name ?? '' : '';
          const caption = capText(stripName(b.caption, full), MAX_CAPTION);
          if (who && caption) beats.push({ ...b, who, caption, target: one(b.target) ?? b.target });
          return;
        }
        case 'pause':
          beats.push({ ...b, caption: capText(b.caption, 60) });
          return;
        case 'caption': {
          const text = capText(b.text, 60);
          if (text) beats.push({ ...b, text });
          return;
        }
      }
    });
    if (beats.length) scenes.push({ ...sc, beats });
    else problems.push(`${where}: no playable beats, scene dropped`);
  });
  if (ep.scenes.length > MAX_SCENES) problems.push(`too many scenes (${ep.scenes.length}), kept ${MAX_SCENES}`);
  ep.scenes = scenes;
  ep.title = cleanTitle(ep.title) || 'Untitled';
  ep.stateChanges = ep.stateChanges.filter((c) => {
    if (c.type !== 'relationship') return true;
    const a = one(c.a), b = one(c.b);
    if (!a || !b || a === b) return false;
    c.a = a;
    c.b = b;
    return true;
  });
  ep.storySoFar = ep.storySoFar.slice(0, 1500);

  // Pacing: cap look_at_camera (keep the first ones), then report plot structure.
  const looks = new Map<string, number>();
  let totalLooks = 0, swaps = 0;
  for (const sc of scenes) for (const b of sc.beats) {
    if (b.type !== 'react' || b.reaction !== 'look_at_camera') continue;
    const over = totalLooks >= MAX_CAMERA_LOOKS || b.who.some((id) => (looks.get(id) ?? 0) >= MAX_CAMERA_LOOKS_PER_PERSON);
    if (over) {
      b.reaction = LOOK_REPLACEMENTS[swaps++ % LOOK_REPLACEMENTS.length];
    } else {
      totalLooks++;
      for (const id of b.who) looks.set(id, (looks.get(id) ?? 0) + 1);
    }
  }
  if (swaps) problems.push(`${swaps} excess look_at_camera reaction(s) replaced (max ${MAX_CAMERA_LOOKS} per episode, ${MAX_CAMERA_LOOKS_PER_PERSON} per person)`);
  let run = 0;
  scenes.forEach((sc, i) => {
    run = i > 0 && scenes[i - 1].plot === sc.plot ? run + 1 : 1;
    if (run === MAX_PLOT_RUN + 1) problems.push(`scene ${i + 1}: more than ${MAX_PLOT_RUN} scenes in a row of plot ${sc.plot}`);
  });
  const aScenes = scenes.filter((sc) => sc.plot === 'A').length;
  if (aScenes < MIN_A_SCENES) problems.push(`the A-plot has only ${aScenes} scene(s); it needs at least ${MIN_A_SCENES}`);

  const beatCount = scenes.reduce((n, s) => n + s.beats.length, 0);
  const heads = scenes.reduce((n, s) => n + s.beats.filter((b) => b.type === 'talking_head').length, 0);
  if (heads < 3) problems.push(`only ${heads} talking head(s); the show needs at least 3`);
  if (scenes.length < MIN_SCENES) {
    problems.push(`needs at least ${MIN_SCENES} scenes (got ${scenes.length})`);
    return { episode: null, problems };
  }
  if (beatCount < MIN_BEATS) {
    problems.push(`needs at least ${MIN_BEATS} beats (got ${beatCount})`);
    return { episode: null, problems };
  }
  return { episode: ep, problems };
}

/** Check a season bible: known ids only, valid tentpoles and desks, enough regulars. */
export function reviewBible(series: Series, raw: unknown, sets: Sets): BibleReview {
  const problems: string[] = [];
  const parsed = SeasonBible.safeParse(unstringify(raw));
  if (!parsed.success) return { bible: null, problems: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`) };
  const b = structuredClone(parsed.data);
  const taken = new Set([...CAST.map((c) => c.id), ...series.extras.map((e) => e.id)]);
  b.extras = b.extras.slice(0, 3).flatMap((x) => {
    const id = slug(x.id) || slug(x.name);
    if (!id || taken.has(id) || !x.name.trim()) return [];
    taken.add(id);
    return [{ ...x, id }];
  });
  const { ref } = resolver(everyone(series, b.extras.map((x) => ({ id: x.id, name: x.name }))));
  const one = (r: unknown) => { const v = ref(r); return v && !SPECIAL.has(v) ? v : null; };
  b.roster = [...new Set(b.roster.map((r) => one(r)).filter((x): x is string => !!x))];
  for (const x of b.extras) if (!b.roster.includes(x.id)) b.roster.push(x.id);
  b.manager = one(b.manager) ?? (b.roster.includes('michael') ? 'michael' : b.roster[0] ?? 'michael');
  if (!b.roster.includes(b.manager) && castById(b.manager)) b.roster.push(b.manager);
  const hasSpot = (n: string) => !!(sets.office?.spots[n] ?? sets.annex?.spots[n]);
  b.deskOverrides = b.deskOverrides.flatMap((d) => {
    const id = one(d.id);
    if (!id || !hasSpot(d.spot)) { problems.push(`desk override ${d.id} -> ${d.spot} dropped`); return []; }
    return [{ id, spot: d.spot }];
  });
  b.relationships = b.relationships.flatMap((r) => {
    const a = one(r.a), c = one(r.b);
    return a && c && a !== c ? [{ a, b: c, status: r.status }] : [];
  });
  const tent = new Set<number>();
  // The finale is always the last episode: a "finale" tentpole is redundant, not a problem.
  b.tentpoles = b.tentpoles.filter((t) => {
    if (t.id === 'finale' || t.episode >= SEASON_LENGTH) return false;
    const ok = TENTPOLES.some((x) => x.id === t.id) && !tent.has(t.episode);
    if (ok) tent.add(t.episode);
    else problems.push(`tentpole ${t.id} @ ${t.episode} dropped`);
    return ok;
  });
  b.arcs = b.arcs.slice(0, 6);
  if (!b.arcs.length) return { bible: null, problems: [...problems, 'the bible needs 3-5 arcs'] };
  if (b.roster.length < 8) return { bible: null, problems: [...problems, `the roster needs at least 8 regulars (got ${b.roster.length})`] };
  if (b.arcs.length < 3) problems.push('fewer than 3 arcs');
  return { bible: b, problems };
}
