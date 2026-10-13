// Shared headless-Chromium plumbing for the render and shot CLIs: find a browser, serve the app with
// Vite on a free port, open it in render mode and screenshot it over CDP. The page is only looked at,
// so any view works; the show is stepped by exact simulated time through window.__render.
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';

export const FORMATS = {
  // Viewport x scale = output size.
  horizontal: { width: 1280, height: 720, scale: 1.5 },
  vertical: { width: 540, height: 960, scale: 2 },
} as const;
export type FormatName = keyof typeof FORMATS;

/** The in-page handle main.ts exposes in render mode. */
export type R = {
  ready: boolean; error: string; done: boolean; time: number; label: string;
  step(dt: number): boolean;
  advance(seconds: number, frameDt?: number): number;
};

export const failer = (tag: string) => (msg: string): never => {
  console.error(`[${tag}] ${msg}`);
  process.exit(1);
};

export function findBrowser(): string | undefined {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => p && existsSync(p));
}

export interface Session { browser: Browser; base: string; server: ViteDevServer; close(): Promise<void> }

/** Vite dev server on a free port plus a headless Chromium. */
export async function startSession(tag: string): Promise<Session> {
  const executablePath = findBrowser() ?? failer(tag)('no Chrome/Chromium found; set CHROMIUM_PATH');
  const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer!.address();
  const base = `http://localhost:${typeof address === 'object' && address ? address.port : 5173}`;
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });
  return { browser, base, server, close: async () => { await browser.close(); await server.close(); } };
}

export interface RenderPage {
  page: Page;
  label: string;
  /** Run `fn(window.__render, arg)` in the page (fn is serialized: no closures). */
  call<T>(fn: (r: R, arg: any) => T, arg?: unknown): Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Screenshot of the whole viewport at the format's output size. */
  capture(type: 'jpeg' | 'png'): Promise<Buffer>;
}

/** Open the app in render mode with `params` (render/offline/format are added) and wait until it is ready. */
export async function openRender(s: Session, tag: string, formatName: FormatName, params: URLSearchParams): Promise<RenderPage> {
  const fail = failer(tag), format = FORMATS[formatName];
  const page = await s.browser.newPage({ viewport: { width: format.width, height: format.height }, deviceScaleFactor: format.scale });
  const all = new URLSearchParams({ render: '1', offline: '1', format: formatName });
  params.forEach((v, k) => all.set(k, v));
  await page.goto(`${s.base}/?${all}`);
  await page.waitForFunction(() => {
    const r = (window as unknown as { __render?: R }).__render;
    return r && (r.ready || r.error);
  }, null, { timeout: 120_000 });
  const call: RenderPage['call'] = (fn, arg) => page.evaluate(`(${fn})(window.__render, ${JSON.stringify(arg ?? null)})`) as never;
  const err = await call((r) => r.error);
  if (err) fail(err);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  const capture = async (type: 'jpeg' | 'png') => Buffer.from((await cdp.send('Page.captureScreenshot', {
    format: type, ...(type === 'jpeg' ? { quality: 90 } : {}), optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: format.width, height: format.height, scale: format.scale },
  } as never) as { data: string }).data, 'base64');
  return { page, label: await call((r) => r.label), call, capture };
}
