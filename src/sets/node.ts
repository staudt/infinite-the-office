import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSet, type SetMap } from './parse.ts';

/** Load every `*.txt` set in a directory (for CLI use outside Vite). */
export function loadSetsFromDir(dir: string): Record<string, SetMap> {
  const out: Record<string, SetMap> = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt')).sort()) {
    const id = f.replace(/\.txt$/, '');
    out[id] = parseSet(id, readFileSync(join(dir, f), 'utf8'));
  }
  return out;
}
