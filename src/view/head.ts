// The confessional: a close-up of one person in front of the blinds, at exactly the map's
// size so cutting to it and back is a clean swap. Drawn from sprite art when the speaker
// has a portrait, else as ASCII with the character's letter as a big block face.
import type { Stage } from '../engine/stage';
import { art } from './art';
import { esc } from './grid';
import { blank, type Cell, gridHtml, paint, wrap } from './grid';
import { NameIndex } from './names';
import { FRAME_H, FRAME_W } from './set';

/** 5x5 block capitals; lowercase glyphs use the same shapes. */
const FONT: Record<string, string[]> = {
  A: [' ### ', '#   #', '#####', '#   #', '#   #'], B: ['#### ', '#   #', '#### ', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'], D: ['#### ', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'], F: ['#####', '#    ', '#### ', '#    ', '#    '],
  G: [' ####', '#    ', '#  ##', '#   #', ' ### '], H: ['#   #', '#   #', '#####', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '#####'], J: ['  ###', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'], L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'], N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '], P: ['#### ', '#   #', '#### ', '#    ', '#    '],
  Q: [' ### ', '#   #', '# # #', '#  # ', ' ## #'], R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '], T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '], V: ['#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '# # #', '## ##', '#   #'], X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '], Z: ['#####', '   # ', '  #  ', ' #   ', '#####'],
};

const CX = Math.floor(FRAME_W / 2);

/** Everything behind the speaker: blinds, bookshelf, chair, floor. Built once. */
function backdrop(): Cell[][] {
  const g = blank(FRAME_W, FRAME_H);
  // Window with blinds
  const wx = 6, wy = 3, ww = 24, wh = 12;
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const edge = y === 0 || y === wh - 1 || x === 0 || x === ww - 1;
      g[wy + y][wx + x] = edge ? { ch: '#', cls: 'h-frame' } : { ch: y % 2 ? '=' : ' ', cls: 'h-blind' };
    }
  }
  paint(g, wy + wh, wx - 1, '='.repeat(ww + 2), 'h-frame');
  // Bookshelf
  const sx = 70, sy = 4;
  for (let s = 0; s < 4; s++) {
    paint(g, sy + s * 4 + 3, sx, '='.repeat(22), 'h-shelf');
    paint(g, sy + s * 4 + 1, sx + 1, '|[]|[]||[] |[]|[||]  []|', 'h-books');
    paint(g, sy + s * 4 + 2, sx + 1, '|[]|[]||[] |[]|[||]  []|', 'h-books');
  }
  // Chair back behind the shoulders
  for (let y = 7; y < 22; y++) {
    paint(g, y, CX - 19, '|', 'h-chair');
    paint(g, y, CX + 19, '|', 'h-chair');
  }
  paint(g, 6, CX - 17, '.' + '-'.repeat(33) + '.', 'h-chair');
  // Floor
  paint(g, FRAME_H - 5, 0, '_'.repeat(FRAME_W), 'h-floor');
  // Viewfinder corners
  for (const [r, c, s] of [[0, 1, '┌─'], [0, FRAME_W - 3, '─┐'], [FRAME_H - 1, 1, '└─'], [FRAME_H - 1, FRAME_W - 3, '─┘']] as const) paint(g, r, c, s, 'h-vf');
  return g;
}

interface Gfx { bg: HTMLImageElement; who: HTMLImageElement; dot: HTMLElement; third: HTMLElement; name: HTMLElement; title: HTMLElement; sub: HTMLElement; last: Map<HTMLElement, string>; color: string }

export class HeadView {
  private bg = backdrop();
  private names: NameIndex;
  private lastHtml = '';

  private gfx: Gfx | null = null;

  constructor(private el: HTMLElement, private gfxEl: HTMLElement, private stage: Stage) {
    this.names = new NameIndex(stage);
  }

  /** Show (and draw) the confessional, or hide both versions of it. */
  show(on: boolean): void {
    const portrait = on && this.stage.head ? this.portrait() : null;
    const wantAscii = on && !portrait, wantGfx = on && !!portrait;
    if (this.el.hidden === wantAscii) this.el.hidden = !wantAscii;
    if (this.gfxEl.hidden === wantGfx) this.gfxEl.hidden = !wantGfx;
    if (portrait) this.renderGfx(portrait);
    else if (on) this.render();
  }

  /** The speaker's portrait for their mood (and mouth-open frame while talking), if drawn. */
  private portrait(): string | null {
    const h = this.stage.head!;
    const base = art.url(`${h.who}_head_${h.mood}`) ?? art.url(`${h.who}_head`);
    if (!base || !h.text) return base;
    // Mouth flaps on show time, so renders are deterministic.
    const open = Math.floor(this.stage.time * 7) % 2 === 0;
    return (open && art.url(`${h.who}_head_talk`)) || base;
  }

  private renderGfx(portrait: string): void {
    const h = this.stage.head!;
    const a = this.stage.actor(h.who);
    if (!this.gfx) {
      this.gfxEl.innerHTML = `<img class="hg-bg" alt=""><img class="hg-who" alt="">
        <div class="hg-rec"><span class="hg-dot">●</span> REC</div><div class="hg-vf">DUNDER MIFFLIN - SCRANTON</div>
        <div class="hg-third"><b class="hg-name"></b><span class="hg-title"></span></div><div class="hg-sub"></div>`;
      const q = <T extends HTMLElement>(c: string) => this.gfxEl.querySelector(c) as T;
      this.gfx = { bg: q('.hg-bg'), who: q('.hg-who'), dot: q('.hg-dot'), third: q('.hg-third'), name: q('.hg-name'), title: q('.hg-title'), sub: q('.hg-sub'), last: new Map(), color: '' };
    }
    const g = this.gfx;
    // Touch the DOM only on change (the renderer counts mutations as new frames).
    const set = (el: HTMLElement, prop: 'src' | 'innerHTML' | 'textContent', v: string) => {
      if (g.last.get(el) !== v) {
        g.last.set(el, v);
        (el as unknown as Record<string, string>)[prop] = v;
      }
    };
    set(g.bg, 'src', art.url('head_bg') ?? '');
    set(g.who, 'src', portrait);
    // A small bob while talking reads as speech even without a mouth frame.
    const bob = h.text && Math.floor(this.stage.time * 4) % 2 === 0 ? 'translateY(-0.6%)' : '';
    if (g.who.style.transform !== bob) g.who.style.transform = bob;
    const dot = Math.floor(this.stage.time * 1.2) % 2 === 0 ? '' : 'hidden';
    if (g.dot.style.visibility !== dot) g.dot.style.visibility = dot;
    set(g.name, 'textContent', a.name.toUpperCase());
    if (g.color !== a.color) g.third.style.color = g.color = a.color; // style.color reads back as rgb()
    set(g.title, 'textContent', a.title);
    set(g.sub, 'innerHTML', h.text ? `<span>${this.names.html(h.text, esc)}</span>` : '');
  }

  render(): void {
    const head = this.stage.head;
    if (!head) return;
    const a = this.stage.actor(head.who);
    const g = this.bg.map((r) => r.map((c) => ({ ...c })));

    // Head: a filled ellipse with the letter as the face (each font pixel is 4x2 cells)
    const H = 14, hw = 17, top = 2, mid = (H - 1) / 2;
    for (let r = 0; r < H; r++) {
      const half = Math.round(hw * Math.sqrt(1 - ((r - mid) / (mid + 0.6)) ** 2));
      const y = top + r;
      for (let x = CX - half; x <= CX + half; x++) g[y][x] = { ch: ' ', cls: 'h-fill', color: a.color };
      if (r === 0 || r === H - 1) paint(g, y, CX - half, '.' + '-'.repeat(2 * half - 1) + '.', 'h-skin', a.color);
      else {
        paint(g, y, CX - half, '(', 'h-skin', a.color);
        paint(g, y, CX + half, ')', 'h-skin', a.color);
      }
    }
    const rows = FONT[a.glyph.toUpperCase()] ?? FONT.O;
    rows.forEach((row, i) => {
      for (const y of [top + 2 + i * 2, top + 3 + i * 2]) {
        [...row].forEach((p, k) => paint(g, y, CX - 10 + k * 4, p === '#' ? '####' : '    ', p === '#' ? 'h-face' : 'h-fill', a.color));
      }
    });
    // Neck, shoulders (a filled suit) and tie
    for (const y of [top + H, top + H + 1]) {
      for (let x = CX - 4; x <= CX + 4; x++) g[y][x] = { ch: ' ', cls: 'h-fill', color: a.color };
      paint(g, y, CX - 4, '|', 'h-body', a.color);
      paint(g, y, CX + 4, '|', 'h-body', a.color);
    }
    for (let i = 0; i < 6; i++) {
      const y = top + H + 1 + i, half = 5 + i * 4;
      for (let x = CX - half; x <= CX + half; x++) g[y][x] = { ch: ' ', cls: 'h-suit', color: a.color };
      paint(g, y, CX - half, '/', 'h-body', a.color);
      paint(g, y, CX + half, '\\', 'h-body', a.color);
    }
    paint(g, top + H + 2, CX - 3, '\\ | /', 'h-collar');
    paint(g, top + H + 3, CX - 1, '\\|/', 'h-collar');
    for (let y = top + H + 4; y < top + H + 7; y++) paint(g, y, CX, '|', 'h-tie');

    // Camera tags
    if (Math.floor(this.stage.time * 1.2) % 2 === 0) paint(g, 1, 4, '●', 'h-rec');
    paint(g, 1, 6, ' REC', 'h-rec-text');
    const tag = 'DUNDER MIFFLIN - SCRANTON';
    paint(g, 1, FRAME_W - tag.length - 4, tag, 'h-vf');

    // Subtitle: the current line, wrapped, centered, names in color
    if (head.text) {
      const lines = wrap(head.text, 62, 3);
      const w = Math.max(...lines.map(([s, e]) => e - s));
      const colors: (string | null)[] = [];
      for (const run of this.names.runs(head.text)) for (let i = 0; i < run.text.length; i++) colors.push(run.color);
      const r0 = FRAME_H - 8 + (3 - lines.length);
      lines.forEach(([s, e], i) => {
        const c0 = Math.floor((FRAME_W - w) / 2) - 2;
        for (let c = c0; c < c0 + w + 4; c++) g[r0 + i][c] = { ch: ' ', cls: 'bubble' };
        const left = Math.floor((FRAME_W - (e - s)) / 2);
        for (let k = s; k < e; k++) g[r0 + i][left + k - s] = { ch: head.text[k], cls: `bubble${colors[k] ? ' name' : ''}`, color: colors[k] ?? '#f4f4f4' };
      });
    }

    // Lower third: NAME / Job title
    const name = a.name.toUpperCase();
    const w = Math.max(name.length, a.title.length) + 4;
    for (const r of [FRAME_H - 4, FRAME_H - 3]) {
      for (let c = 4; c < 4 + w; c++) g[r][c] = { ch: ' ', cls: 'h-third' };
      paint(g, r, 4, '▌', 'h-third', a.color);
    }
    paint(g, FRAME_H - 4, 6, name, 'h-third h-name', a.color);
    paint(g, FRAME_H - 3, 6, a.title, 'h-third h-title');

    const html = gridHtml(g);
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.el.innerHTML = html;
    }
  }
}
