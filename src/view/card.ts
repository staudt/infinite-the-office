// The side panel: episode title and logline, then every scene grouped by part
// (cold open, acts, tag) with its recap. The live scene is boxed and shows who is on
// screen; clicking a scene watches it from its start.
import type { EngineEvent } from '../engine/events';
import type { Stage } from '../engine/stage';
import type { Episode, Part } from '../schema/episode';
import { esc } from './grid';
import { sceneHeading } from './transcript';

const PART_LABEL: Record<Part, string> = { cold_open: 'COLD OPEN', act1: 'ACT 1', act2: 'ACT 2', tag: 'TAG' };

interface Entry { heading: string; recap: string; part: Part; state: 'upcoming' | 'live' | 'done' }

export class CardView {
  private entries: Entry[] = [];
  private title = '';
  private logline = '';
  private last = '';

  constructor(private el: HTMLElement, private stage: Stage) {}

  setEpisode(ep: Episode): void {
    this.title = ep.title;
    this.logline = ep.logline;
    this.entries = ep.scenes.map((s) => ({ heading: sceneHeading(s), recap: s.recap, part: s.part, state: 'upcoming' }));
    this.render();
  }

  onEvent(e: EngineEvent): void {
    if (e.type === 'sceneStart' && this.entries[e.index]) this.entries[e.index].state = 'live';
    else if (e.type === 'sceneEnd' && this.entries[e.index]) this.entries[e.index].state = 'done';
    else return;
    this.render();
  }

  /** Called every frame: refreshes the list of people on screen. */
  tick(): void {
    this.render();
  }

  /** Who is on screen right now (live scene only). */
  private people(): string {
    const items = this.stage.visibleActors().map(
      (a) => `<span class="who" style="color:${a.color}" title="${esc(a.name)}"><b>${esc(a.glyph)}</b> ${esc(a.name.split(' ')[0])}</span>`,
    );
    return items.length ? `<div class="people">${items.join('')}</div>` : '';
  }

  private render(): void {
    let part: Part | null = null;
    const rows = this.entries.map((s, i) => {
      const head = s.part !== part ? `<li class="part">${PART_LABEL[(part = s.part)]}</li>` : '';
      const live = s.state === 'live';
      const body = `<div class="slug">${live ? '<span class="onair">● LIVE</span> ' : ''}${esc(s.heading)}</div><div class="recap">${esc(s.recap)}</div>`;
      return `${head}<li class="scene ${s.state}" data-scene="${i}" title="Watch this scene">${body}${live ? this.people() : ''}</li>`;
    });
    const html = `<h3>${esc(this.title)}</h3><p class="logline">${esc(this.logline)}</p><ol>${rows.join('')}</ol>`;
    if (html === this.last) return;
    this.last = html;
    this.el.innerHTML = html;
  }
}
