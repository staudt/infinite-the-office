// Sprite art, built by `npm run sprites` into public/sprites/. Loaded once at startup; views
// ask for an image by name and draw a placeholder when it is missing, so a character
// nobody has drawn yet (or a build without art) still plays.
//
// Anyone without their own sheet wears a generic body (`generic_<look>_*`) whose green clothes
// are recolored to their own color: `dress()` maps `<id>_<anim>` names onto it.
import { hashId } from '../engine/rng';

interface Entry { src: string; w: number; h: number }
export interface Anim { src: string; frameW: number; frameH: number; frames: number; anchorX: number; anchorY: number }
interface ArtIndex { props?: Record<string, Entry>; anims?: Record<string, Anim>; images?: Record<string, Entry> }
export type Picture = HTMLImageElement | HTMLCanvasElement;

const LOOKS = ['office_m', 'office_f', 'warehouse'];
/** The middle green of the generic sheets' clothes; shades around it keep their relative lightness. */
const GREEN_MID = 108;

class Art {
  index: ArtIndex = {};
  private imgs = new Map<string, HTMLImageElement>();
  /** id -> generic body and clothes color, for characters without art. */
  private dressed = new Map<string, { base: string; color: string }>();
  private tints = new Map<string, HTMLCanvasElement>();

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

  /**
   * Give a character without their own sheet a generic body: their `look`, else warehouse for warehouse staff,
   * else an office body picked by a hash of the id (stable forever).
   */
  dress(id: string, look: string | null, color: string, home = ''): void {
    if (this.index.anims?.[`${id}_walk_front`] || this.dressed.has(id)) return;
    const have = LOOKS.filter((l) => this.index.anims?.[`generic_${l}_walk_front`]);
    const pool = have.filter((l) => (home === 'warehouse' ? l === 'warehouse' : l !== 'warehouse'));
    const from = pool.length ? pool : have;
    if (!from.length) return;
    const pick = look && have.includes(look) ? look : from[hashId(id) % from.length];
    this.dressed.set(id, { base: `generic_${pick}`, color });
  }

  /** `<id>_<anim>` for a dressed character becomes the generic body's anim. */
  private resolve(name: string): { name: string; color: string | null } {
    for (const [id, d] of this.dressed) if (name.startsWith(`${id}_`)) return { name: `${d.base}${name.slice(id.length)}`, color: d.color };
    return { name, color: null };
  }

  anim(name: string): Anim | undefined {
    return this.index.anims?.[this.resolve(name).name];
  }

  image(name: string): Picture | null {
    const r = this.resolve(name), im = this.imgs.get(r.name);
    if (!im || !r.color) return im ?? null;
    const k = `${r.name}|${r.color}`;
    let c = this.tints.get(k);
    if (!c) this.tints.set(k, (c = tint(im, r.color)));
    return c;
  }

  /** Only real image files have a URL (portraits); tinted bodies do not. */
  url(name: string): string | null {
    const im = this.image(name);
    return im instanceof HTMLImageElement ? im.src : null;
  }
}

/** Recolor the green clothes of a generic sheet to `color`, keeping each shade's lightness relative to mid green. */
function tint(im: HTMLImageElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(im, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height), d = px.data;
  const t = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (!d[i + 3] || g < 40 || g < r * 1.3 || g < b * 1.3) continue;
    const s = g / GREEN_MID;
    for (let k = 0; k < 3; k++) d[i + k] = s <= 1 ? t[k] * s : t[k] + (255 - t[k]) * Math.min(1, (s - 1) * 0.7);
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

export const art = new Art();
