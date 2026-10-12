// Sprite art, built by `npm run sprites` into public/sprites/. Loaded once at startup; views
// ask for an image by name and draw a placeholder when it is missing, so a character
// nobody has drawn yet (or a build without art) still plays.
interface Entry { src: string; w: number; h: number }
export interface Anim { src: string; frameW: number; frameH: number; frames: number; anchorX: number; anchorY: number }
interface ArtIndex { props?: Record<string, Entry>; anims?: Record<string, Anim>; images?: Record<string, Entry> }

class Art {
  index: ArtIndex = {};
  private imgs = new Map<string, HTMLImageElement>();

  async load(): Promise<void> {
    try {
      const r = await fetch('sprites/index.json');
      if (!r.ok) return;
      this.index = (await r.json()) as ArtIndex;
    } catch {
      return; // no art: views draw placeholders
    }
    const all = [this.index.images, this.index.props, this.index.anims].flatMap((g) => Object.entries(g ?? {}));
    await Promise.all(all.map(([name, e]) => new Promise<void>((done) => {
      const im = new Image();
      im.onload = () => { this.imgs.set(name, im); done(); };
      im.onerror = () => done();
      im.src = `sprites/${e.src}`;
    })));
  }

  image(name: string): HTMLImageElement | null {
    return this.imgs.get(name) ?? null;
  }

  url(name: string): string | null {
    return this.image(name)?.src ?? null;
  }
}

export const art = new Art();
