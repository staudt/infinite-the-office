import { firstName } from '../engine/cast';
import type { EngineEvent } from '../engine/events';
import type { Stage } from '../engine/stage';
import { esc } from './grid';
import { NameIndex } from './names';
import { clock, REACTION_TEXT, sceneHeading } from './transcript';

const MAX_LINES = 160;

/** The script as it airs: dialogue, stage directions in italics, talking heads, scene headings. */
export class FeedView {
  private names: NameIndex;

  constructor(private el: HTMLElement, private stage: Stage) {
    this.names = new NameIndex(stage);
  }

  onEvent(e: EngineEvent): void {
    const who = (id: string) => {
      const a = this.stage.actor(id);
      return `<b style="color:${a.color}">${esc(firstName(a.name))}</b>`;
    };
    const say = (id: string, tag = '') => {
      const a = this.stage.actor(id);
      return `${tag}<b style="color:${a.color}">${esc(firstName(a.name).toUpperCase())}:</b> `;
    };
    switch (e.type) {
      case 'episodeStart':
        return void this.add(`<span class="ep">★ THE OFFICE: ${esc(e.title)} ★</span>`, 'header', e.t);
      case 'sceneStart':
        return void this.add(`<span class="slug">${esc(sceneHeading(e))}</span>`, 'header', e.t);
      case 'said':
        return void this.add(`${say(e.who)}<span class="q">${this.names.html(e.text, esc)}</span>`, `said mood-${e.mood}`, e.t);
      case 'headSay':
        return void this.add(`${say(e.who, '<span class="th">[TALKING HEAD]</span> ')}<span class="q">${this.names.html(e.text, esc)}</span>`, 'head', e.t);
      case 'react':
        return void this.add(`(${who(e.who)} ${REACTION_TEXT[e.reaction]})`, 'dir', e.t);
      case 'action':
        return void this.add(`(${who(e.who)} ${this.names.html(e.caption, esc)})`, 'dir', e.t);
      case 'spawn':
        return void this.add(`(${who(e.id)} enters)`, 'dir dim', e.t);
      case 'despawn':
        return void this.add(`(${who(e.id)} exits)`, 'dir dim', e.t);
      case 'caption':
        return void this.add(`— ${esc(e.text)} —`, 'cap', e.t);
      case 'pause':
        if (e.caption) this.add(`(${this.names.html(e.caption, esc)})`, 'dir', e.t);
    }
  }

  private add(html: string, cls: string, t: number): void {
    const li = document.createElement('li');
    li.className = cls;
    // The show time lets a click on the line jump the show to that moment.
    li.dataset.t = String(t);
    li.title = 'Jump to this moment';
    li.innerHTML = `<span class="ts">${clock(t)}</span> ${html}`;
    this.el.appendChild(li);
    while (this.el.children.length > MAX_LINES) this.el.firstElementChild!.remove();
    this.el.scrollTop = this.el.scrollHeight;
  }

  clear(): void {
    this.el.innerHTML = '';
  }
}
