// Shared by the map and the confessional: a character-cell frame rendered as HTML.
export interface Cell { ch: string; cls: string; color?: string }

export const blank = (w: number, h: number): Cell[][] =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', cls: '' })));

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * ASCII is safe in any monospace font; other glyphs (blocks, arrows) may come from a
 * fallback font with a different width, which would skew the grid. Each of those gets
 * its own one-cell box, so rows always line up.
 */
export function cellText(run: string): string {
  let out = '';
  for (const ch of run) out += ch.charCodeAt(0) > 0x7e ? `<i class="w">${ch}</i>` : esc(ch);
  return out;
}

/** Write text into the grid (clipped), one cell per character. */
export function paint(g: Cell[][], r: number, c: number, text: string, cls: string, color?: string): void {
  if (r < 0 || r >= g.length) return;
  [...text].forEach((ch, i) => {
    if (c + i >= 0 && c + i < g[r].length) g[r][c + i] = { ch, cls, color };
  });
}

export function rowHtml(row: Cell[]): string {
  let html = '';
  let run = '';
  let key = '';
  const flush = () => {
    if (!run) return;
    const [cls, color] = key.split('|');
    const text = cellText(run);
    html += cls || color ? `<span class="${cls}"${color ? ` style="color:${color}"` : ''}>${text}</span>` : text;
    run = '';
  };
  for (const c of row) {
    const k = `${c.cls}|${c.color ?? ''}`;
    if (k !== key) {
      flush();
      key = k;
    }
    run += c.ch;
  }
  flush();
  return html;
}

export const gridHtml = (g: Cell[][]) => g.map(rowHtml).join('\n');

/**
 * Word-wrap into [start, end) ranges of at most `max` lines; widens the box rather
 * than cutting the text.
 */
export function wrap(text: string, width: number, max: number): [number, number][] {
  const lines: [number, number][] = [];
  let cur: [number, number] | null = null;
  for (const m of text.matchAll(/\S+/g)) {
    const s = m.index!, e = s + m[0].length;
    if (cur && e - cur[0] > width) {
      lines.push(cur);
      cur = [s, e];
    } else {
      cur = cur ? [cur[0], e] : [s, e];
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > max && width < 80) return wrap(text, width + 8, max);
  return lines;
}
