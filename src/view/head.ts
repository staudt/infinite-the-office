// The confessional: a close-up of one person in front of the blinds, in the same box as the
// map so cutting to it and back is a clean swap. Uses the speaker's portrait art, else a
// simple bust drawn in their color.
import type { Stage } from '../engine/stage';
import type { Mood } from '../schema/episode';
import { art } from './art';
import { NameIndex } from './names';
import { esc } from './text';

/** The writer's 12 moods share 5 drawn faces (`<id>_head_<face>`); neutral is the plain portrait. */
const MOOD_FACE: Partial<Record<Mood, string>> = {
  happy: 'happy', excited: 'happy', smug: 'happy',
  annoyed: 'annoyed', angry: 'annoyed', sarcastic: 'annoyed',
  sad: 'sad', nervous: 'nervous', awkward: 'nervous', panicked: 'nervous', deadpan: 'deadpan',
};

interface Gfx { bg: HTMLImageElement; who: HTMLImageElement; ph: HTMLElement; dot: HTMLElement; third: HTMLElement; name: HTMLElement; title: HTMLElement; sub: HTMLElement; last: Map<HTMLElement, string>; color: string }

const SKIN = ['#f1c9a5', '#e0ac85', '#c68a64', '#8d5a3c'];
const HAIR = ['#2b2018', '#5a3a22', '#8a6a3a', '#b8b0a0', '#1c1c24'];
/** Stable pick per character, so a placeholder always looks the same. */
const pick = <T,>(xs: T[], id: string): T => xs[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % xs.length];

/** A stand-in bust: head and shoulders in the actor's color, their letter on the chest. */
function bust(id: string, color: string, glyph: string, mouthOpen: boolean): string {
  const skin = pick(SKIN, id), hair = pick(HAIR, id + 'h');
  const mix = (pct: number, to: string) => `color-mix(in srgb, ${color} ${pct}%, ${to})`;
  const mouth = mouthOpen
    ? '<ellipse cx="50" cy="57" rx="4.5" ry="3.2" fill="#5a1f1f"/>'
    : '<path d="M44 56 Q50 59.5 56 56" fill="none" stroke="#5a1f1f" stroke-width="1.6" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M3 120 C3 94 22 85 40 80 L60 80 C78 85 97 94 97 120 Z" style="fill:${mix(55, '#000')};stroke:${mix(90, '#fff')};stroke-width:1"/>
    <rect x="43" y="62" width="14" height="22" rx="4" fill="${skin}" style="filter:brightness(0.82)"/>
    <path d="M39 80 L50 98 L61 80 Z" fill="#e4e4ee"/>
    <circle cx="29" cy="45" r="4" fill="${skin}"/><circle cx="71" cy="45" r="4" fill="${skin}"/>
    <ellipse cx="50" cy="42" rx="21" ry="26" fill="${skin}"/>
    <path d="M28.5 40 C25 12 75 12 71.5 40 C68 29 59 25 50 25 C41 25 32 29 28.5 40 Z" fill="${hair}"/>
    <circle cx="42" cy="44" r="1.9" fill="#222"/><circle cx="58" cy="44" r="1.9" fill="#222"/>
    ${mouth}
    <text x="50" y="108" text-anchor="middle" font-family="monospace" font-weight="700" font-size="16" style="fill:${mix(35, '#fff')}">${esc(glyph.slice(0, 1).toUpperCase())}</text>
  </svg>`;
}

export class HeadView {
  private names: NameIndex;
  private gfx: Gfx | null = null;

  constructor(private el: HTMLElement, private stage: Stage) {
    this.names = new NameIndex(stage);
  }

  /** Show (and draw) the confessional, or hide it. */
  show(on: boolean): void {
    if (this.el.hidden === on) this.el.hidden = !on;
    if (on && this.stage.head) this.render();
  }

  /** The speaker's portrait for their mood (and mouth-open frame while talking), if drawn. */
  private portrait(): string | null {
    const h = this.stage.head!;
    // A drawn face for the mood (exact name first, then the shared face), else the neutral portrait.
    const face = [h.mood, MOOD_FACE[h.mood]].find((f) => f && art.url(`${h.who}_head_${f}`));
    const still = face ? `${h.who}_head_${face}` : `${h.who}_head`;
    if (!art.url(still) || !h.text) return art.url(still);
    // Mouth flaps on show time, so renders are deterministic. Only with a matching mouth-open frame,
    // so a mood face never flickers back to neutral.
    const open = Math.floor(this.stage.time * 7) % 2 === 0;
    return (open && art.url(`${still}_talk`)) || art.url(still);
  }

  private render(): void {
    const h = this.stage.head!;
    const a = this.stage.actor(h.who);
    const portrait = this.portrait();
    if (!this.gfx) {
      this.el.innerHTML = `<img class="hg-bg" alt=""><img class="hg-who" alt=""><div class="hg-who hg-ph"></div>
        <div class="hg-rec"><span class="hg-dot">●</span> REC</div><div class="hg-vf">DUNDER MIFFLIN - SCRANTON</div>
        <div class="hg-third"><b class="hg-name"></b><span class="hg-title"></span></div><div class="hg-sub"></div>`;
      const q = <T extends HTMLElement>(c: string) => this.el.querySelector(c) as T;
      this.gfx = { bg: q('.hg-bg'), who: q('.hg-who'), ph: q('.hg-ph'), dot: q('.hg-dot'), third: q('.hg-third'), name: q('.hg-name'), title: q('.hg-title'), sub: q('.hg-sub'), last: new Map(), color: '' };
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
    if (portrait) set(g.who, 'src', portrait);
    else set(g.ph, 'innerHTML', bust(a.id, a.color, a.glyph, !!h.text && Math.floor(this.stage.time * 7) % 2 === 0));
    if (g.who.hidden === !!portrait) g.who.hidden = !portrait;
    if (g.ph.hidden === !portrait) g.ph.hidden = !!portrait;
    // A small bob while talking reads as speech even without a mouth frame.
    const bob = h.text && Math.floor(this.stage.time * 4) % 2 === 0 ? 'translateY(-0.6%)' : '';
    const body = portrait ? g.who : g.ph;
    if (body.style.transform !== bob) body.style.transform = bob;
    const dot = Math.floor(this.stage.time * 1.2) % 2 === 0 ? '' : 'hidden';
    if (g.dot.style.visibility !== dot) g.dot.style.visibility = dot;
    set(g.name, 'textContent', a.name.toUpperCase());
    if (g.color !== a.color) g.third.style.color = g.color = a.color; // style.color reads back as rgb()
    set(g.title, 'textContent', a.title);
    set(g.sub, 'innerHTML', h.text ? `<span>${this.names.html(h.text, esc)}</span>` : '');
  }
}
