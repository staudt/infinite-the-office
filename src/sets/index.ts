import { buildLayoutSet, parseLayout } from './layout.ts';
import { parseSet, type SetMap } from './parse.ts';

export * from './parse.ts';
export { buildLayoutSet, parseLayout, propRect, propSize, solidRects, type Layout, type LProp, type Rect } from './layout.ts';
export { findPath } from './path.ts';

// Vite inlines the globs; plain node (tsx CLIs) has none, so the set stays empty there and
// the node-only loader (writer/prompt.ts loadSets) fills it in.
let files: Record<string, string> = {};
let layouts: Record<string, unknown> = {};
try {
  files = import.meta.glob('../../data/sets/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  layouts = import.meta.glob('../../data/sets/*.layout.json', { import: 'default', eager: true }) as Record<string, unknown>;
} catch {
  // not running under Vite
}

const idOf = (path: string) => path.split('/').pop()!.replace(/\.(layout\.json|txt)$/, '');

/** All sets keyed by id (the file's basename). */
export const SETS: Record<string, SetMap> = {
  ...Object.fromEntries(Object.entries(files).map(([path, text]) => [idOf(path), parseSet(idOf(path), text)])),
  ...Object.fromEntries(Object.entries(layouts).map(([path, json]) => [idOf(path), buildLayoutSet(idOf(path), parseLayout(json))])),
};

/** Look up a set by id; throws on unknown ids. */
export function getSet(id: string): SetMap {
  const s = SETS[id];
  if (!s) throw new Error(`unknown set: ${id}`);
  return s;
}
