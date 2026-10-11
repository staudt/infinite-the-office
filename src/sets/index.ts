import { parseSet, type SetMap } from './parse.ts';

export * from './parse.ts';
export { findPath } from './path.ts';

// Vite inlines the glob; plain node (tsx CLIs) has none, so the set stays empty there and
// the node-only loader (writer/prompt.ts loadSets) fills it in.
let files: Record<string, string> = {};
try {
  files = import.meta.glob('../../data/sets/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
} catch {
  // not running under Vite
}

/** All sets keyed by id (the file's basename). */
export const SETS: Record<string, SetMap> = Object.fromEntries(
  Object.entries(files).map(([path, text]) => {
    const id = path.split('/').pop()!.replace(/\.txt$/, '');
    return [id, parseSet(id, text)];
  }),
);

/** Look up a set by id; throws on unknown ids. */
export function getSet(id: string): SetMap {
  const s = SETS[id];
  if (!s) throw new Error(`unknown set: ${id}`);
  return s;
}
