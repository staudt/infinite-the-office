import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import './style.css';
import { Director } from './choreo/director';
import { DEMO_EPISODE, DEMO_ROSTER } from './demo';
import type { EngineEvent } from './engine/events';
import { Stage, TICK } from './engine/stage';
import type { Task } from './engine/tasks';
import type { Episode } from './schema/episode';
import { CardView } from './view/card';
import { firstName } from './engine/cast';
import { FeedView } from './view/feed';
import { esc } from './view/grid';
import { HeadView } from './view/head';
import { FRAME_H, FRAME_W, MapView } from './view/set';
import { connectionText, StartScreen } from './view/start';
import { sceneHeading } from './view/transcript';
import { CAST } from './world/cast';
import { applyEpisode } from './world/apply';
import { episodeLabel } from './world/season';
import { loadSeriesFromStorage, randomSeed, saveSeriesToStorage, type Series } from './world/state';
import {
  fetchEpisode, fetchHealth, fetchLibrary, fetchNewSeries, fetchStoredSeries, type Health, type LibraryEntry, type Source, type Unavailable,
} from './writer/client';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);

// Render mode (?render=1, used by `npm run render`): no real-time loop and no UI chrome.
// The renderer script steps the simulation by exact simulated time through window.__render
// and screenshots the page, so it only needs the page to look right (any view will do).
//   ?render=1&format=horizontal|vertical  &clip=1 (with scene=N: stop when that scene ends)
const RENDER = params.has('render');
const CLIP = RENDER && params.has('clip');
const renderState = { ready: false, done: false, error: '', changed: true, clock: 0, ticks: 0, subUntil: 0 };
if (RENDER) {
  document.body.classList.add('render', params.get('format') === 'vertical' ? 'vertical' : 'horizontal');
  // Lets the renderer reuse the previous frame when nothing on screen changed.
  new MutationObserver(() => (renderState.changed = true)).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
}

// ------------------------------------------------------------------ stage + views

/** What is on screen: an episode, who is on the roster, and how the stage should seat them. */
interface Playable {
  episode: Episode;
  roster: string[];
  label: string;
  seed: number;
  series: Series | null;
}
let cur: Playable = { episode: DEMO_EPISODE, roster: DEMO_ROSTER, label: 'Demo', seed: SEED, series: null };

// Every run plays on a fresh stage, so jumping (to a scene or a log line) replays the
// episode silently up to that point: the engine is deterministic for a given seed.
let stage!: Stage;
let map!: MapView;
let head!: HeadView;
let feed!: FeedView;
let card!: CardView;
let playing: { task: Task; done: () => void } | null = null;
let scene = 0;
let status = '';

function onEvent(e: EngineEvent): void {
  map.onEvent(e);
  feed.onEvent(e);
  card.onEvent(e);
  if (RENDER) subtitle(e);
  if (CLIP && e.type === 'sceneEnd' && e.index === renderTargetScene) renderState.done = true;
  if (e.type === 'episodeStart') $('ep').textContent = cur.series ? `${cur.label}: ${e.title}` : e.title;
  if (e.type === 'sceneStart') {
    scene = e.index;
    $('seg').textContent = sceneHeading(e);
  }
}

/** The scene a clip render covers (0-based), from ?scene=N. */
const renderTargetScene = Number(params.get('scene') ?? 0) - 1;

/** Render mode: the current line as a big subtitle under the picture. */
function subtitle(e: EngineEvent): void {
  const el = $('subtitle');
  let html = '';
  if (e.type === 'said' || e.type === 'headSay') {
    const a = stage.actor(e.who);
    html = `<b style="color:${a.color}">${esc(firstName(a.name).toUpperCase())}</b><span class="q">${esc(e.text)}</span>`;
    renderState.subUntil = e.t + 2.5 + e.text.length * 0.06;
  } else if (e.type === 'action') {
    html = `<span class="dir">(${esc(firstName(stage.actor(e.who).name))} ${esc(e.caption)})</span>`;
    renderState.subUntil = e.t + 3;
  } else if (e.type === 'caption') {
    html = `<span class="dir">${esc(e.text)}</span>`;
    renderState.subUntil = e.t + 3;
  } else if (e.type === 'sceneStart' || e.type === 'episodeStart') {
    html = '';
    renderState.subUntil = 0;
  } else return;
  el.innerHTML = html;
}

/** Where to jump when (re)starting: a scene index or a show time. */
type Target = { scene: number } | { time: number };

/** Run the simulation silently until `until()` holds (or the episode ends). */
function fastForward(task: Task, until: () => boolean): void {
  const limit = stage.time + 3600;
  while (!task.done && stage.time < limit && !until()) stage.update();
}

/** (Re)start the current episode on a fresh stage; `done` runs when it ends. */
function start(target?: Target, done: () => void = () => start()): void {
  const { episode, roster, series } = cur;
  stage = new Stage(cur.seed, CAST, episode, roster, series ?? {});
  map = new MapView($('map'), stage);
  head = new HeadView($('head'), stage);
  feed = new FeedView($('feed'), stage);
  feed.clear();
  card = new CardView($('card'), stage);
  card.setEpisode(episode);
  stage.on(onEvent);
  $('subtitle').innerHTML = '';
  const task = stage.spawn(new Director(stage, episode, roster, cur.label).play());
  playing = { task, done };
  if (target) {
    let reached = false;
    const off = stage.on((e) => {
      if ('scene' in target && e.type === 'sceneStart' && e.index >= target.scene) reached = true;
    });
    fastForward(task, () => reached || ('time' in target && stage.time >= target.time - 0.05));
    off();
  }
  if (RENDER) renderState.ready = true;
}

const SPEEDS = [1, 2, 4, 8];
let speed = 1;
let paused = false;

function setStatus(s: string): void {
  status = s;
  if (RENDER) return;
  renderStatus();
}

function renderStatus(): void {
  if (!stage) return;
  const sceneInfo = cur.episode.scenes.length ? ` · scene ${scene + 1}/${cur.episode.scenes.length}` : '';
  $('status').textContent = `${paused ? '⏸ paused' : `▶ ${speed}x`}${sceneInfo}${status ? ` · ${status}` : ''}`;
  if (!$('debug').hidden) {
    $('debug-body').textContent = JSON.stringify(
      {
        time: Math.round(stage.time * 10) / 10,
        worldTime: Math.round(stage.wt * 10) / 10,
        set: stage.setId,
        head: stage.head?.who ?? null,
        onScreen: stage.visibleActors().map((a) => `${a.name} (${a.x},${a.y})${a.seated ? ' seated' : ''}${a.moving ? ' walking' : ''}`),
        series: cur.series && { id: cur.series.id, season: cur.series.season, episode: cur.series.episode, arcs: cur.series.arcProgress, storySoFar: cur.series.storySoFar },
      },
      null,
      2,
    );
  }
}

// Clicks: a scene in the card, or a line in the script.
$('card').addEventListener('click', (e) => {
  const i = (e.target as HTMLElement).closest<HTMLElement>('[data-scene]')?.dataset.scene;
  if (i !== undefined) jump({ scene: Number(i) });
});
$('feed').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
  if (t !== undefined) jump({ time: Number(t) });
});

/** Replay the current episode from a point, keeping the way it hands over to the next one. */
function jump(target?: Target): void {
  const done = playing?.done ?? (() => start());
  start(target, done);
}

// ------------------------------------------------------------------ series: episodes + the endless chain

/** An episode we can (re)play: the series state it follows, and the episode itself. */
interface Entry { before: Series; episode: Episode; source: Source }

const entries = new Map<number, Promise<Entry | null>>();
/** The show's starting point: the first episode to air and the state before it. */
let base: { n: number; series: Series } | null = null;
let nowPlaying = 0;
/** Bumped by every jump, so an older playback chain stops when it notices. */
let generation = 0;
let lastUnavailable: Unavailable | null = null;
let currentSeries: Series | null = null;

/** Episode n: this session's, or written from the state after episode n-1 (stored first, then the LLM). */
function entryFor(n: number): Promise<Entry | null> {
  const known = entries.get(n);
  if (known) return known;
  const promise = (async (): Promise<Entry | null> => {
    if (!base || n < base.n) return null;
    let before: Series | null = null;
    if (n === base.n) before = base.series;
    else {
      const prev = await entryFor(n - 1);
      if (prev) before = applyEpisode(prev.before, prev.episode);
    }
    if (!before) return null;
    const written = await fetchEpisode(before);
    if (!written.episode) {
      lastUnavailable = written;
      return null;
    }
    return { before, episode: written.episode, source: written.source };
  })();
  entries.set(n, promise);
  void promise.then((e) => {
    if (!e) entries.delete(n); // let a later attempt try again
  });
  return promise;
}

/** Play episode n of the series, then keep the show going while the next one is written. */
async function run(n: number, target?: Target): Promise<void> {
  const my = ++generation;
  playing = null;
  hideEnded();
  setStatus(n === nowPlaying ? 'rewinding…' : `loading episode ${n}…`);
  const entry = await entryFor(n);
  if (my !== generation) return;
  if (!entry) {
    if (RENDER) {
      renderState.error = `episode ${n} is not available${lastUnavailable ? `: ${lastUnavailable.message}` : ''}`;
      return;
    }
    if (n < nowPlaying) setStatus('earlier episodes of this show are not stored');
    else showEnded(n, lastUnavailable);
    return;
  }
  nowPlaying = n;
  const after = applyEpisode(entry.before, entry.episode);
  currentSeries = after;
  cur = { episode: entry.episode, roster: after.roster, label: episodeLabel(after, n), seed: after.seed + n, series: after };
  $('show').textContent = after.name;
  document.title = after.name;
  const from = entry.source === 'stored' ? 'from storage' : 'written by the AI';
  setStatus(`${from} · preparing the next one…`);
  if (!RENDER) void entryFor(n + 1).then((next) => {
    if (my !== generation) return;
    setStatus(next ? `${from} · next episode ready` : `${from} · no next episode: ${lastUnavailable?.message ?? 'not available'}`);
  });
  await new Promise<void>((resolve) => start(target, resolve));
  if (my !== generation || RENDER) return;
  saveSeriesToStorage(after);
  void run(n + 1);
}

// ------------------------------------------------------------------ end of the available episodes

let retryTimer: number | undefined;

function hideEnded(): void {
  $('ended').hidden = true;
  window.clearTimeout(retryTimer);
}

function showNotice(title: string, text: string, actions: [string, () => void, boolean][] = []): void {
  $('ended-title').textContent = title;
  $('ended-text').textContent = text;
  const box = $('ended-actions');
  box.innerHTML = '';
  for (const [label, action, primary] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', action);
    box.append(b);
  }
  $('ended').hidden = false;
}

/** Nothing more to air: the stored episodes ran out with no AI to write the next one, or the writer failed. */
function showEnded(n: number, why: Unavailable | null): void {
  const show = currentSeries?.name ?? 'this show';
  const failed = why?.reason === 'error';
  showNotice(
    failed ? `The writers couldn't finish episode ${n}` : `That's all the stored episodes of ${show}`,
    failed
      ? `${why!.message}. Retrying in 30 seconds…`
      : why?.reason === 'no-llm'
        ? 'The writer server has no API key, so no new episodes can be written. Replay it, or pick another show.'
        : 'New episodes need the AI writer (run it locally with an API key). Replay it, or pick another show.',
    [
      ...(failed ? [['Retry now', () => void run(n), true] as [string, () => void, boolean]] : []),
      ['Replay from the start', () => void run(base?.n ?? 1), !failed],
      ['Choose another show', () => void openStart(true), false],
    ],
  );
  setStatus(failed ? `writer failed: ${why!.message}` : 'end of the stored episodes');
  if (failed) retryTimer = window.setTimeout(() => void run(n), 30_000);
}

/** Start the endless show from a series state (the next episode is series.episode + 1). */
function startShow(series: Series, target?: Target, ep?: number): void {
  entries.clear();
  base = { n: series.episode + 1, series };
  void run(ep && ep >= base.n ? ep : base.n, target);
}

// ------------------------------------------------------------------ connection + start screen

let health: Health | null | undefined;
async function refreshHealth(): Promise<void> {
  health = await fetchHealth();
  const c = connectionText(health);
  $('conn').textContent = c.text;
  $('conn').className = c.cls;
}

const startScreen = new StartScreen($('start'));
async function openStart(canClose: boolean, saved: Series | null = canClose ? loadSeriesFromStorage() : null): Promise<void> {
  startScreen.open({ current: saved, library: await fetchLibrary(), health, canClose });
}

/** Match a ?show= value against stored series: id, seed, or (part of) the name. */
function findShow(library: LibraryEntry[], query: string): LibraryEntry | undefined {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const q = slug(query);
  return library.find((e) => e.id === query || String(e.seed) === query)
    ?? library.find((e) => slug(e.name) === q) ?? library.find((e) => slug(e.name).startsWith(q));
}

const CHOSEN_KEY = 'office.chosen';
const chosenThisTab = () => {
  try {
    return sessionStorage.getItem(CHOSEN_KEY) === '1';
  } catch {
    return false;
  }
};
function markChosen(): void {
  try {
    sessionStorage.setItem(CHOSEN_KEY, '1');
  } catch {
    // no session storage: the start screen simply shows on every load
  }
}

/** The hand-written demo episode, looping (the fallback when there is nothing else to play). */
function playDemo(target?: Target): void {
  generation++;
  cur = { episode: DEMO_EPISODE, roster: DEMO_ROSTER, label: 'Demo', seed: SEED, series: null };
  $('show').textContent = 'THE OFFICE';
  start(target);
}

/** Decide what to air: ?demo, ?show= / ?play=new|library, the saved series, the start screen, or the demo. */
async function main(): Promise<void> {
  const deepScene = Number(params.get('scene') ?? 0);
  const target: Target | undefined = deepScene > 0 ? { scene: deepScene - 1 } : undefined;
  if (params.has('demo')) {
    if (!RENDER) await refreshHealth();
    playDemo(target);
    return;
  }
  if (!RENDER) {
    await refreshHealth();
    setInterval(refreshHealth, 20_000);
  }
  const showParam = params.get('show');
  const program = showParam ? 'library' : params.get('play');
  const deepEp = Number(params.get('ep') ?? 0);
  let series: Series | null = null;
  if (program === 'new') {
    const direction = params.get('direction') ?? '';
    setStatus('creating a new series…');
    showNotice('Writing your series…', `The showrunner is planning season 1${direction ? ` (${direction.slice(0, 80)}${direction.length > 80 ? '…' : ''})` : ''}. This takes a minute.`);
    playDemo(); // something to look at while the writers work
    const created = await fetchNewSeries(direction, randomSeed(), params.get('name') ?? '');
    hideEnded();
    series = created.series;
    if (!created.series) setStatus(`couldn't create a series: ${created.message}`);
  } else if (program === 'library') {
    const id = showParam ? findShow(await fetchLibrary(), showParam)?.id ?? showParam : params.get('id');
    series = id ? await fetchStoredSeries(id) : null;
    if (!series) setStatus(`couldn't find the stored show "${showParam ?? params.get('id')}"`);
  } else {
    series = loadSeriesFromStorage();
  }
  // Keep the URL clean so a reload continues the show instead of restarting it.
  for (const k of ['play', 'direction', 'name', 'id', 'show', 'ep', 'scene']) params.delete(k);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  if (!series && RENDER) {
    renderState.error = status || 'no show to render';
    return;
  }
  if (!series) {
    const library = await fetchLibrary();
    if (!program && !health?.llm && !library.length) {
      // No server, nothing stored: the demo is all there is.
      setStatus('demo episode (no writer server, no stored shows)');
      playDemo();
      return;
    }
    if (!status.startsWith("couldn't")) setStatus('choose a show');
    if (!stage) playDemo(); // attract mode behind the start screen
    await openStart(false);
    return;
  }
  const fresh = series;
  if (!RENDER) saveSeriesToStorage(series);
  // Opening the show in a new tab asks what to watch (Continue is the first choice);
  // reloads in the same tab, or a pick from the start screen, go straight to the show.
  if (!RENDER && !program && !chosenThisTab()) {
    setStatus('choose a show');
    playDemo();
    startScreen.onContinue = () => {
      startScreen.onContinue = null;
      markChosen();
      startShow(fresh);
    };
    await openStart(true, fresh);
    return;
  }
  markChosen();
  startShow(series, target, deepEp >= 1 ? deepEp : undefined);
}

// Fixed-step simulation, decoupled from the frame rate.
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!paused && stage) {
    acc += dt * speed;
    while (acc >= TICK) {
      stage.update();
      acc -= TICK;
      if (playing?.task.done) {
        const p = playing;
        playing = null;
        p.done(); // the next episode (or the demo loop) starts here
        break;
      }
    }
  }
  if (stage) {
    const onHead = stage.head !== null;
    $('map').hidden = onHead;
    $('head').hidden = !onHead;
    if (onHead) head.render();
    else map.render();
    card.tick();
    renderStatus();
  }
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  if (startScreen.isOpen) {
    if (e.key === 'Escape' && currentSeries) startScreen.close();
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === ' ') {
    paused = !paused;
    e.preventDefault();
  } else if (e.key >= '1' && e.key <= '4') {
    speed = SPEEDS[Number(e.key) - 1];
  } else if (e.key === 'd') {
    $('debug').hidden = !$('debug').hidden;
  } else if (e.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  } else if (e.key === 'N') {
    void openStart(true);
  } else if (e.key === 'ArrowLeft') {
    jump({ scene: Math.max(0, scene - 1) });
  } else if (e.key === 'ArrowRight') {
    if (scene + 1 < cur.episode.scenes.length) jump({ scene: scene + 1 });
    else if (cur.series) void run(nowPlaying + 1);
    else jump();
  }
});

function fit(): void {
  if (RENDER) {
    // Broadcast layout: the map as large as the frame allows between the title bar and the subtitle.
    const vertical = document.body.classList.contains('vertical');
    const byWidth = (window.innerWidth - 24 - 18) / (FRAME_W * 0.6);
    const byHeight = (window.innerHeight - 34 - 96 - 36 - 18) / (FRAME_H * 1.3);
    const px = vertical ? byWidth : Math.min(byWidth, byHeight);
    document.documentElement.style.setProperty('--cell', `${px}px`);
    document.documentElement.style.setProperty('--rows', String(FRAME_H));
    document.documentElement.style.setProperty('--cols', String(FRAME_W));
    return;
  }
  // As big as fits beside the side panel and above the script.
  const phone = window.innerWidth <= 900;
  const side = phone ? 0 : 394;
  const width = Math.min(window.innerWidth - (phone ? 24 : 48) - side, 1500);
  let px = Math.min(22, (width - 18) / (FRAME_W * 0.6));
  if (!phone) px = Math.min(px, (window.innerHeight - 250) / (FRAME_H * 1.3));
  document.documentElement.style.setProperty('--cell', `${Math.max(phone ? 9 : 7, px)}px`);
  document.documentElement.style.setProperty('--rows', String(FRAME_H));
  document.documentElement.style.setProperty('--cols', String(FRAME_W));
}
window.addEventListener('resize', fit);
fit();

if (RENDER) {
  const view = () => {
    const onHead = stage.head !== null;
    if ($('map').hidden !== onHead) $('map').hidden = onHead;
    if ($('head').hidden === onHead) $('head').hidden = !onHead;
    if (onHead) head.render();
    else map.render();
  };
  (window as unknown as { __render: object }).__render = {
    get ready() { return renderState.ready; },
    get error() { return renderState.error; },
    get done() { return renderState.done; },
    get time() { return stage?.time ?? 0; },
    get label() { return cur.label; },
    /** Advance the show by `dt` seconds of simulated time (exactly, in 60 Hz ticks); true if the picture changed. */
    step(dt: number): boolean {
      renderState.clock += dt;
      const want = Math.round(renderState.clock * (1 / TICK));
      while (renderState.ticks < want && !renderState.done) {
        stage.update();
        renderState.ticks++;
        if (playing?.task.done) renderState.done = true;
      }
      if (renderState.subUntil && stage.time > renderState.subUntil) {
        $('subtitle').innerHTML = '';
        renderState.subUntil = 0;
      }
      view();
      const changed = renderState.changed;
      renderState.changed = false;
      return changed;
    },
  };
} else requestAnimationFrame(frame);
void main();
