// Finds character names inside any text so views can paint them in that character's
// color ("Jim tapes a plaque" -> "Jim" in Jim's color). Matches full names and
// unambiguous first/last names.
import type { Stage } from '../engine/stage';

export interface Run { text: string; color: string | null }

export class NameIndex {
  private re: RegExp | null = null;
  private colorOf = new Map<string, string>();
  private key = '';

  constructor(private stage: Stage) {}

  private rebuild(): void {
    const actors = [...this.stage.actors.values()];
    const key = actors.map((a) => a.id).join();
    if (key === this.key) return;
    this.key = key;
    this.colorOf.clear();
    const words = new Map<string, string[]>();
    const add = (name: string, color: string) => {
      if (name.length < 3 || this.colorOf.has(name.toLowerCase())) return;
      this.colorOf.set(name.toLowerCase(), color);
    };
    for (const a of actors) {
      add(a.name, a.color);
      for (const w of a.name.split(' ')) if (w.length >= 3) words.set(w, [...(words.get(w) ?? []), a.color]);
    }
    // Single words only when they belong to exactly one character.
    for (const [w, colors] of words) if (colors.length === 1) add(w, colors[0]);
    const names = [...this.colorOf.keys()].sort((a, b) => b.length - a.length);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.re = names.length ? new RegExp(`(?<![\\w'])(${names.map(esc).join('|')})(?!\\w)`, 'gi') : null;
  }

  /** Split text into runs, coloring every name. */
  runs(text: string): Run[] {
    this.rebuild();
    if (!this.re) return [{ text, color: null }];
    const out: Run[] = [];
    let last = 0;
    for (const m of text.matchAll(this.re)) {
      const word = m[0];
      // Single words must match case exactly; multi-word names may be shouted in caps.
      const color = this.colorOf.get(word.toLowerCase());
      if (!color || (!word.includes(' ') && !/^[A-Z]/.test(word))) continue;
      if (m.index! > last) out.push({ text: text.slice(last, m.index), color: null });
      out.push({ text: word, color });
      last = m.index! + word.length;
    }
    if (last < text.length) out.push({ text: text.slice(last), color: null });
    return out;
  }

  html(text: string, esc: (s: string) => string): string {
    return this.runs(text)
      .map((r) => (r.color ? `<b style="color:${r.color}">${esc(r.text)}</b>` : esc(r.text)))
      .join('');
  }
}
