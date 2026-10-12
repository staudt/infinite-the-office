// Prompt assembly for the writer (node only: reads data/writer/* at call time, so a
// human can tune prompts without touching code).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Rng } from '../engine/rng';
import { SETS, type SetMap } from '../sets/index.ts';
import { loadSetsFromDir } from '../sets/node.ts';
import { CAST, castById } from '../world/cast';
import { episodeInSeason, isFinale, SEASON_LENGTH, seasonOf, tentpoleFor, TENTPOLES } from '../world/season';
import type { Series } from '../world/state';

const dataPath = (rel: string) => fileURLToPath(new URL(`../../data/${rel}`, import.meta.url));
const readData = (rel: string) => readFileSync(dataPath(rel), 'utf8');
const readJson = <T>(rel: string) => JSON.parse(readData(rel)) as T;

/** How many past episodes the episode prompt recaps in detail. */
export const RECENT_EPISODES = 6;

let sets: Record<string, SetMap> | null = null;
/** The sets from disk; also registers them in SETS so the stage works outside Vite. */
export function loadSets(): Record<string, SetMap> {
  if (!sets) {
    sets = loadSetsFromDir(dataPath('sets'));
    for (const [id, set] of Object.entries(sets)) SETS[id] ??= set;
  }
  return sets;
}

/** Each set's regions, spots and exits, as the writer needs to name them. */
export function setListing(all: Record<string, SetMap> = loadSets()): string {
  return Object.entries(all).map(([id, set]) => {
    const spots = Object.keys(set.spots).filter((n) => !set.exits[n]);
    const exits = Object.keys(set.exits);
    return `- **${id}**\n  - regions: ${Object.keys(set.regions).join(', ')}\n  - spots: ${spots.join(', ') || '(none)'}\n  - exits to: ${exits.join(', ') || '(none)'}`;
  }).join('\n');
}

const TOOL_USE = (tool: string) => `## How to answer
Call the \`${tool}\` tool exactly once with the complete result. Do not answer in prose and do not ask questions.`;

/** The cached system prompt for episodes: role + style + constraints (with sets) + format. */
export function episodeSystemPrompt(): string {
  const constraints = readData('writer/constraints.md').replace('{{SETS}}', setListing());
  return [
    'You are the head writer of an endless, never-ending version of *The Office* (US). You write one episode at a time as structured data; an engine stages it as pixel-art animation with a camera crew. Continuity matters: follow the season bible and the story so far.',
    readData('writer/style.md'), constraints, readData('writer/format.md'), TOOL_USE('write_episode'),
  ].join('\n\n');
}

/** The cached system prompt for season bibles. */
export function bibleSystemPrompt(): string {
  return [
    'You are the showrunner of an endless, never-ending version of *The Office* (US). Once per season (12 episodes) you write the season bible that the episode writers follow. The whole run of the real show is available to you: pick the configuration that gives this season its identity (who manages the branch, who is dating whom, who sits where, who has just arrived or left).',
    readData('writer/style.md'),
    `## What a good bible does
- A season has 3-5 arcs: one A spine that pays off in the finale, a B or two, small C runners. Each arc lists beats for specific episodes (1-${SEASON_LENGTH}) so the weekly writer knows what to advance now; arcs rest in between.
- Every episode still needs its own self-contained comedy; arcs are seasoning, not the whole meal.
- Regulars: pick the roster from the cast list (about 14-20 people). Use recurring characters as regulars when their story needs them. Do not use characters outside the era you chose unless the story justifies it.
- You may invent 0-3 new recurring side characters (a client, a rival, a new hire) with a distinct voice. Give them lowercase_snake_case ids.
- Schedule 3-5 tentpole episodes from the tentpole list (the finale is always episode ${SEASON_LENGTH}) and say what each does for the story.
- \`deskOverrides\` use desk spot names from the office or annex sets (e.g. "dwight_desk", "ryan_desk"), only when someone changes seats. \`manager\` is the character id of whoever runs the branch.
- Keep \`plan\`/\`summary\`/\`beat\` strings concrete and short (one or two sentences).`,
    TOOL_USE('plan_season'),
  ].join('\n\n');
}

function castLine(id: string, series: Series): string {
  const c = castById(id);
  const x = series.extras.find((e) => e.id === id);
  if (c) {
    const desk = series.deskOverrides[id] ?? c.desk;
    return `- ${c.id} (${c.name}, ${c.title}): ${c.voice} Quirks: ${c.quirks.join('; ')}.${desk ? ` Desk: ${desk}.` : ''}`;
  }
  return x ? `- ${x.id} (${x.name}, ${x.title}, recurring): ${x.voice}` : `- ${id}`;
}

const nameOf = (id: string, s: Series) => castById(id)?.name ?? s.extras.find((e) => e.id === id)?.name ?? id;

/** Two directives for this episode, picked by the series seed (so a retry gets the same ones). */
export function pickDirectives(series: Series, n: number): string[] {
  const all = readJson<{ directives: string[] }>('writer/directives.json').directives;
  const rng = new Rng(series.seed ^ Math.imul(n, 0x9e3779b1));
  const pool = [...all];
  return [0, 1].map(() => pool.splice(Math.floor(rng.next() * pool.length), 1)[0]).filter(Boolean);
}

/** The user prompt for the next episode (series.episode + 1). */
export function episodeUserPrompt(series: Series): string {
  const n = series.episode + 1;
  const b = series.bible;
  const k = episodeInSeason(n);
  const out: string[] = [];
  out.push(`# Write episode ${k} of ${SEASON_LENGTH} of season ${seasonOf(n)} (episode ${n} overall) of "${series.name}"`);
  if (series.direction) out.push(`## Series direction from the viewer (honor it throughout)\n${series.direction}`);
  if (b) {
    const arcLines = b.arcs.map((a) => {
      const beat = a.perEpisode.find((p) => p.episode === k)?.beat;
      const prog = series.arcProgress[a.name];
      return `- [${a.kind}] **${a.name}**: ${a.summary}${prog ? ` NOW: ${prog}.` : ''}${beat ? `\n  THIS EPISODE: ${beat}` : ''}\n  Payoff: ${a.payoff}`;
    });
    out.push(`## Season bible\nTheme: ${b.theme}\nEra: ${b.era}\nManager of the branch: ${nameOf(b.manager, series)}\n${arcLines.join('\n')}`);
    const tp = tentpoleFor(b, n);
    const hint = tp && TENTPOLES.find((t) => t.id === tp.id)?.hint;
    out.push(`## Where we are\nEpisode ${k} of ${SEASON_LENGTH}.${tp ? ` TENTPOLE: ${tp.name} (${hint}). Plan: ${tp.plan}` : ''}${isFinale(n) ? ` THIS IS THE SEASON FINALE. Plan: ${b.finale}` : k === SEASON_LENGTH - 1 ? ` Next week is the finale (${b.finale}): set it up.` : ''}\nIn arcs without a beat listed above, do not advance them unless it serves the story.`);
  }
  out.push(`## Cast this season (use these ids)\n${series.roster.map((id) => castLine(id, series)).join('\n')}`);
  if (series.relationships.length) out.push(`## Relationships\n${series.relationships.map((r) => `- ${nameOf(r.a, series)} & ${nameOf(r.b, series)}: ${r.status}`).join('\n')}`);
  if (series.gags.length) out.push(`## Running gags\n${series.gags.map((g) => `- ${g}`).join('\n')}`);
  if (series.notes.length) out.push(`## Notes / setups to pay off\n${series.notes.map((x) => `- (ep ${x.episode}) ${x.text}`).join('\n')}`);
  if (series.storySoFar) out.push(`## Story so far\n${series.storySoFar}`);
  const recent = series.history.slice(-RECENT_EPISODES);
  if (recent.length) {
    out.push(`## Recent episodes\n${recent.map((h) => `Episode ${h.episode}, "${h.title}": ${h.logline}\n${h.sceneRecaps.map((r) => `  - ${r}`).join('\n')}`).join('\n')}`);
  }
  if (series.recentPlots.length) out.push(`## RECENTLY USED PLOTS (do not repeat these premises or jokes)\n${series.recentPlots.map((p) => `- ${p}`).join('\n')}`);
  out.push(`## This week's directives (weave in, don't force)\n${pickDirectives(series, n).map((d) => `- ${d}`).join('\n')}`);
  out.push('Before the beats, fill `outline` first: one line each for the A, B and C plots (the A-plot protagonist drives most A scenes), then the scene order by plot, alternating plots (never 3 scenes of one plot in a row). Label each scene with `plot`. Then write the episode with the write_episode tool.');
  return out.join('\n\n');
}

/** The user prompt for the next season's bible (seasonOf(series.episode + 1)). */
export function bibleUserPrompt(series: Series): string {
  const season = seasonOf(series.episode + 1);
  const out: string[] = [`# Write the season bible for season ${season} of "${series.name}"`];
  if (series.direction) out.push(`## Series direction from the viewer (honor it)\n${series.direction}`);
  out.push(`## The cast to choose from (id, name, title, seasons of the original show they appeared in, kind)\n${CAST.map((c) => `- ${c.id}: ${c.name}, ${c.title}, orig. seasons ${c.seasons[0]}-${c.seasons[1]}, ${c.kind}, ${c.voice.split('.')[0]}.`).join('\n')}`);
  out.push(`## Tentpoles you may schedule\n${TENTPOLES.map((t) => `- ${t.id}: ${t.name} — ${t.hint}`).join('\n')}`);
  if (season === 1) {
    out.push('This is the very first season of the series. Choose the starting configuration that best fits the direction (or, with no direction, a classic early-seasons setup).');
  } else {
    out.push(`## Previous seasons of this series\n${series.history.map((h) => `- S${seasonOf(h.episode)}E${episodeInSeason(h.episode)} "${h.title}": ${h.logline}`).join('\n')}`);
    if (series.storySoFar) out.push(`## Story so far\n${series.storySoFar}`);
    out.push(`## Last season's roster\n${series.roster.map((id) => `- ${id}: ${nameOf(id, series)}`).join('\n')}`);
    if (series.extras.length) out.push(`## Recurring characters invented so far\n${series.extras.map((e) => `- ${e.id}: ${e.name}, ${e.title}`).join('\n')}`);
    if (series.relationships.length) out.push(`## Relationships now\n${series.relationships.map((r) => `- ${nameOf(r.a, series)} & ${nameOf(r.b, series)}: ${r.status}`).join('\n')}`);
    if (series.gags.length) out.push(`## Running gags so far\n${series.gags.map((g) => `- ${g}`).join('\n')}`);
    if (series.notes.length) out.push(`## Open setups\n${series.notes.map((x) => `- ${x.text}`).join('\n')}`);
    if (series.bible) out.push(`## Last season's finale plan (and hook)\n${series.bible.finale}`);
    out.push('The cast may change: someone leaves, someone is hired, the manager may change. Say what changed in `changes`. Continue open storylines, but give the season a new identity.');
  }
  out.push('Now write the bible with the plan_season tool.');
  return out.join('\n\n');
}
