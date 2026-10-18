// The start screen: continue the current series, create a new one (with an optional name
// and direction), or watch a stored one from the beginning. Choices reload the page with
// ?play=... so every run starts from a clean stage.
import type { Health } from '../writer/client';
import { episodeLabel } from '../world/season';
import type { LibraryEntry, Series } from '../world/state';

const PRESETS: { label: string; text: string }[] = [
  { label: 'Classic seasons 2-3', text: 'Classic seasons 2-3: Jim and Pam will-they-won\'t-they, Michael desperate for a girlfriend and trying to impress Jan, Dwight scheming for power, Roy still around.' },
  { label: 'Michael Scott Paper Company', text: 'The Michael Scott Paper Company era: Michael quits and starts a rival paper company out of a tiny office with Pam and Ryan, while Dunder Mifflin under Charles Miner tries to crush them.' },
  { label: 'Dwight regional manager', text: 'Dwight finally becomes Regional Manager. Michael is gone. Power goes to his head, Jim and Pam plot, and the office slowly discovers Dwight\'s management style is somehow effective.' },
  { label: 'Holly returns', text: 'Holly Flax returns to Scranton as the new HR rep. Michael is overjoyed, Toby is back from Costa Rica, and a love story finally gets a real chance, with Jim and Pam newly engaged in the background.' },
  { label: 'Jim & Pam wedding', text: 'Jim and Pam\'s engagement and wedding season: planning chaos, Dwight as an unwanted wedding planner, Michael trying to give a speech, and the office rallying when it matters.' },
  { label: 'Surprise me', text: '' },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One line describing what the writer can do right now. */
export function connectionText(h: Health | null | undefined): { text: string; cls: string } {
  if (h === undefined) return { text: 'checking connection…', cls: 'conn-wait' };
  if (h === null) return { text: '● no AI writer connected: stored shows only', cls: 'conn-wait' };
  if (!h.llm) return { text: '● writer server has no API key: stored shows only', cls: 'conn-warn' };
  return { text: `● live: ${h.model} (season bibles: ${h.planModel})`, cls: 'conn-on' };
}

/** A link that opens straight into a stored series, e.g. https://…/infinite-the-office/?show=my-office */
function shareLink(e: LibraryEntry): string {
  return `${location.origin}${location.pathname}?show=${encodeURIComponent(e.id)}`;
}

/** Reload into a program, keeping dev flags like ?offline. */
export function go(play: Record<string, string>): void {
  const keep = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  if (keep.has('offline')) next.set('offline', '1');
  for (const [k, v] of Object.entries(play)) next.set(k, v);
  location.search = `?${next}`;
}

export class StartScreen {
  constructor(private el: HTMLElement) {
    const presets = el.querySelector('#presets')!;
    presets.innerHTML = PRESETS.map((p, i) => `<button class="chip" data-preset="${i}">${esc(p.label)}</button>`).join('');
    presets.addEventListener('click', (e) => {
      const i = (e.target as HTMLElement).dataset.preset;
      if (i !== undefined) (el.querySelector('#direction') as HTMLTextAreaElement).value = PRESETS[Number(i)].text;
    });
    el.querySelector('#create')!.addEventListener('click', () => {
      const value = (sel: string) => (el.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement).value.trim();
      const play: Record<string, string> = { play: 'new' };
      if (value('#direction')) play.direction = value('#direction');
      if (value('#series-name')) play.name = value('#series-name');
      go(play);
    });
    el.querySelector('#library-list')!.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.show;
      if (id) go({ show: id });
    });
    el.querySelector('#start-continue')!.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.continue !== undefined) {
        this.close();
        this.onContinue?.();
      }
    });
  }

  /** Called when "Continue" is picked (e.g. to start the show if it isn't running yet). */
  onContinue: (() => void) | null = null;

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(opts: { current: Series | null; library: LibraryEntry[]; health: Health | null | undefined; canClose: boolean }): void {
    const conn = connectionText(opts.health);
    const connEl = this.el.querySelector('#start-conn')!;
    connEl.textContent = conn.text;
    connEl.className = `conn-line ${conn.cls}`;

    // New series are written by the AI; without it (the published site) the form is hidden and only stored shows play.
    // A local writer server without a key keeps a short note on how to enable it.
    const canCreate = !!opts.health?.llm;
    (this.el.querySelector('#create-area') as HTMLFieldSetElement).disabled = !canCreate;
    (this.el.querySelector('#create-area') as HTMLElement).hidden = !canCreate;
    this.el.querySelector('.start-panel')!.classList.toggle('no-llm', !canCreate);
    const note = this.el.querySelector('#create-note') as HTMLElement;
    note.hidden = canCreate;
    note.innerHTML = opts.health === null
      ? '<b>No AI writer is available here.</b> New series are written live by Claude; run the project locally with <code>npm run server</code> and an Anthropic API key to create your own.'
      : '<b>The writer server has no API key.</b> Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and restart <code>npm run server</code>.';

    const cont = this.el.querySelector('#start-continue')!;
    cont.innerHTML = opts.current && opts.canClose
      ? `<h2>Your show</h2><button class="primary" data-continue>Continue ${esc(opts.current.name)}</button>
         <span class="hint"> next: ${esc(episodeLabel(opts.current, opts.current.episode + 1))}</span>`
      : '';

    const list = this.el.querySelector('#library-list')!;
    list.innerHTML = opts.library.length
      ? opts.library.map((e) => {
        const seasons = Math.ceil(e.episodes / 12);
        const stored = e.episodes ? `${e.episodes} episode${e.episodes === 1 ? '' : 's'} stored · season${seasons === 1 ? '' : 's'} 1${seasons > 1 ? `–${seasons}` : ''}` : 'no episodes yet';
        return `<li>
          <div><b>${esc(e.name)}</b> <span class="badge">${e.source === 'library' ? 'library' : 'saved'}</span></div>
          <div class="hint desc" title="${esc(e.direction || '')}">${esc(e.direction || 'no direction')}</div>
          <div class="row"><span class="hint">${stored} · <a class="share" href="${shareLink(e)}" title="Link that starts this show right away">share link</a></span><button data-show="${esc(e.id)}">Watch from the start</button></div>
        </li>`;
      }).join('')
      : '<li class="hint">Nothing stored yet. Series you create are saved automatically when the writer server is running.</li>';
    this.el.hidden = false;
    if (canCreate) (this.el.querySelector('#series-name') as HTMLInputElement).focus();
  }

  close(): void {
    this.el.hidden = true;
  }
}
