// Render stored episodes (or the demo) to silent MP4. The show is deterministic, so instead of
// recording in real time we step it by exact simulated time in headless Chromium, screenshot
// each frame and pipe the frames into ffmpeg. The page is just screenshotted: any view works.
//
//   npm run render -- --show <id> --ep 3              one episode -> renders/<id>-s1e03.mp4
//   npm run render -- --show <id> --ep 3 --scene 2    one scene (a clip)
//   npm run render -- --show <id> --season 1          every stored episode of a season
//   npm run render -- --demo [--scene 3]              the built-in demo episode
//   options: --format horizontal|vertical (1920x1080 | 1080x1920)  --fps 30  --out renders
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { listLibrary, type LibraryEntry } from '../../server/sessions';
import { episodeInSeason, SEASON_LENGTH, seasonOf } from '../world/season';

const args = process.argv.slice(2);
const arg = (f: string) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const FORMATS = {
  // Viewport x scale = output size.
  horizontal: { width: 1280, height: 720, scale: 1.5 },
  vertical: { width: 540, height: 960, scale: 2 },
} as const;

function fail(msg: string): never {
  console.error(`[render] ${msg}`);
  process.exit(1);
}

function findShow(query: string): LibraryEntry | undefined {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const q = slug(query);
  const all = listLibrary();
  return all.find((e) => e.id === query || String(e.seed) === query)
    ?? all.find((e) => slug(e.name) === q) ?? all.find((e) => slug(e.name).startsWith(q));
}

function findBrowser(): string | undefined {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => p && existsSync(p));
}

const demo = args.includes('--demo');
const formatName = (arg('format') ?? 'horizontal') as keyof typeof FORMATS;
const format = FORMATS[formatName] ?? fail('--format is horizontal or vertical');
const fps = Number(arg('fps') ?? 30);
const outDir = arg('out') ?? 'renders';
const scene = arg('scene') ? Number(arg('scene')) : null;

interface Job { episode: number | null; file: string }
const jobs: Job[] = [];
let show: LibraryEntry | undefined;
const sceneSuffix = scene ? `-scene${scene}` : '';
if (demo) {
  jobs.push({ episode: null, file: `demo${sceneSuffix}.mp4` });
} else {
  const showArg = arg('show') ?? fail('missing --show <id | name> (or --demo)');
  show = findShow(showArg) ?? fail(`no stored show matches "${showArg}"`);
  let episodes: number[];
  if (arg('ep')) episodes = [Number(arg('ep'))];
  else if (arg('season')) {
    const s = Number(arg('season'));
    episodes = Array.from({ length: SEASON_LENGTH }, (_, i) => (s - 1) * SEASON_LENGTH + i + 1).filter((n) => n <= show!.episodes);
  } else fail('pass --ep <n>, --season <n> or --demo');
  if (!episodes.length || episodes.some((n) => !(n >= 1 && n <= show!.episodes))) fail(`"${show.name}" has ${show.episodes} stored episodes`);
  if (scene !== null && episodes.length > 1) fail('--scene works with a single --ep');
  for (const n of episodes) {
    jobs.push({ episode: n, file: `${show.id}-s${seasonOf(n)}e${String(episodeInSeason(n)).padStart(2, '0')}${sceneSuffix}.mp4` });
  }
}

const executablePath = findBrowser() ?? fail('no Chrome/Chromium found; set CHROMIUM_PATH');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const address = server.httpServer!.address();
const base = `http://localhost:${typeof address === 'object' && address ? address.port : 5173}`;

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });
try {
  for (const job of jobs) await renderJob(job, join(outDir, job.file));
} finally {
  await browser.close();
  await server.close();
}

type R = { ready: boolean; error: string; done: boolean; time: number; label: string; step(dt: number): boolean };

async function renderJob(job: Job, file: string): Promise<void> {
  const page: Page = await browser.newPage({
    viewport: { width: format.width, height: format.height },
    deviceScaleFactor: format.scale,
  });
  const params = new URLSearchParams({ render: '1', offline: '1', format: formatName });
  if (job.episode === null) params.set('demo', '1');
  else {
    params.set('show', show!.id);
    params.set('ep', String(job.episode));
  }
  if (scene) {
    params.set('scene', String(scene));
    params.set('clip', '1');
  }
  await page.goto(`${base}/?${params}`);
  await page.waitForFunction(() => {
    const r = (window as unknown as { __render?: R }).__render;
    return r && (r.ready || r.error);
  }, null, { timeout: 120_000 });
  const err = await page.evaluate(() => (window as unknown as { __render: R }).__render.error);
  if (err) fail(err);
  await page.evaluate(() => document.fonts.ready);
  const label = await page.evaluate(() => (window as unknown as { __render: R }).__render.label);
  console.error(`[render] ${label} -> ${file}`);

  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart',
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise<number>((resolve) => ffmpeg.on('close', (code) => resolve(code ?? 1)));
  const write = (buf: Buffer) => new Promise<void>((resolve) => (ffmpeg.stdin.write(buf) ? resolve() : ffmpeg.stdin.once('drain', resolve)));

  const cdp = await page.context().newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', {
    format: 'jpeg', quality: 90, optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: format.width, height: format.height, scale: format.scale },
  } as never) as { data: string }).data, 'base64');
  const started = Date.now();
  let frames = 0;
  let captured = 0;
  let frame = await shot();
  for (;;) {
    await write(frame);
    frames++;
    const state = await page.evaluate((dt) => {
      const r = (window as unknown as { __render: R }).__render;
      const changed = r.step(dt);
      return { done: r.done, time: r.time, changed };
    }, 1 / fps);
    if (state.changed) {
      frame = await shot();
      captured++;
    }
    if (frames % (fps * 30) === 0) {
      const t = Math.floor(state.time);
      console.error(`[render]   ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} of show time, ${frames} frames, ${Math.round((100 * captured) / frames)}% captured (${Math.round(frames / ((Date.now() - started) / 1000))} fps)`);
    }
    if (state.done) break;
  }
  const last = await shot();
  for (let i = 0; i < fps * 2; i++) await write(last);
  ffmpeg.stdin.end();
  const code = await finished;
  await page.close();
  if (code !== 0) fail(`ffmpeg exited with code ${code}`);
  const secs = frames / fps + 2;
  const took = (Date.now() - started) / 1000;
  console.error(`[render]   done: ${secs.toFixed(1)}s of video in ${took.toFixed(1)}s (${(took / secs).toFixed(2)}s per video second)`);
}
