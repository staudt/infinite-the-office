import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLayoutSet, parseLayout } from './layout.ts';
import { parseSet, type SetMap } from './parse.ts';

/** Load every `*.txt` and `*.layout.json` set in a directory (for CLI use outside Vite). */
export function loadSetsFromDir(dir: string): Record<string, SetMap> {
  const out: Record<string, SetMap> = {};
  for (const f of readdirSync(dir).sort()) {
    const text = () => readFileSync(join(dir, f), 'utf8');
    if (f.endsWith('.layout.json')) {
      const id = f.replace(/\.layout\.json$/, '');
      out[id] = buildLayoutSet(id, parseLayout(JSON.parse(text())));
    } else if (f.endsWith('.txt')) {
      const id = f.replace(/\.txt$/, '');
      out[id] = parseSet(id, text());
    }
  }
  return out;
}
