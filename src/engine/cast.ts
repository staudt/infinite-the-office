// The recurring cast (data/cast.json), as the engine sees it.
export interface CastMember {
  id: string;
  name: string;
  /** One letter: how the character is drawn on the map. */
  glyph: string;
  color: string;
  title: string;
  seasons: [number, number];
  kind: string;
  home: string;
  /** Spot name of their desk, or null. */
  desk: string | null;
  voice: string;
  /** Generic body when they have no sprite art of their own. */
  look?: string;
  quirks: string[];
}

/** First word of a name, for balloons and the feed ("Michael Scott" -> "Michael"). */
export const firstName = (name: string) => name.split(/\s+/)[0];

/** A map letter for a name: its own letters first, then the alphabet; the first not in `taken`. */
export function pickGlyph(name: string, taken: Set<string>): string {
  const letters = [...name.toUpperCase().replace(/[^A-Z]/g, ''), ...name.toLowerCase().replace(/[^a-z]/g, ''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];
  return letters.find((l) => !taken.has(l)) ?? '?';
}
