// Sprite art, built by `npm run sprites` into public/sprites/. Loaded once at startup; views
// ask for an image by name and fall back to ASCII when it is missing, so a character
// nobody has drawn yet (or a build without art) still plays.
interface Entry { src: string; w: number; h: number }
export interface Anim { src: string; frameW: number; frameH: number; frames: number; anchorX: number; anchorY: number }
interface ArtIndex { props?: Record<string, Entry>; anims?: Record<string, Anim>; images?: Record<string, Entry> }

class Art {
  /** Off with ?gfx=0 or the g key. */
  enabled = true;
  index: ArtIndex = {};
  private imgs = new Map<string, HTMLImageElement>();

  async load(): Promise<void> {
    try {
      const r = await fetch('sprites/index.json');
      if (!r.ok) return;
      this.index = (await r.json()) as ArtIndex;
    } catch {
      return; // no art: ASCII everywhere
    }
    const all = [this.index.images, this.index.props, this.index.anims].flatMap((g) => Object.entries(g ?? {}));
    await Promise.all(all.map(([name, e]) => new Promise<void>((done) => {
      const im = new Image();
      im.onload = () => { this.imgs.set(name, im); done(); };
      im.onerror = () => done();
      im.src = `sprites/${e.src}`;
    })));
  }

  /** Sprites are loaded and on (else views stay ASCII). */
  get loaded(): boolean {
    return this.enabled && this.imgs.size > 0;
  }

  image(name: string): HTMLImageElement | null {
    return this.enabled ? this.imgs.get(name) ?? null : null;
  }

  url(name: string): string | null {
    return this.image(name)?.src ?? null;
  }
}

export const art = new Art();
