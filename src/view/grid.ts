// Debug overlay (?grid=1, `npm run shot -- --grid`): the logic grid over the map, in world px, for fixing
// walk paths. Red = blocked, S = seat, + = spot (named), > = exit, region edges and names, and each
// walker's remaining path. Drawn inside the map's world transform; touches no state.
import type { Actor } from '../engine/actor';
import type { SetMap } from '../sets/index.ts';

export const GRID = typeof location !== 'undefined' && new URLSearchParams(location.search).get('grid') === '1';

const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);

export function drawGrid(ctx: CanvasRenderingContext2D, set: SetMap, actors: Actor[]): void {
  const { cellW: cw, cellH: ch, width, height, kinds } = set;
  const mid = (x: number, y: number): [number, number] => [(x + 0.5) * cw, (y + 0.5) * ch];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(7, cw * 0.45)}px monospace`;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (set.walkable({ x, y })) continue;
      ctx.fillStyle = 'rgba(255,40,40,0.28)';
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= width; x++) { ctx.beginPath(); ctx.moveTo(x * cw, 0); ctx.lineTo(x * cw, height * ch); ctx.stroke(); }
  for (let y = 0; y <= height; y++) { ctx.beginPath(); ctx.moveTo(0, y * ch); ctx.lineTo(width * cw, y * ch); ctx.stroke(); }

  // Region edges: a border wherever the neighbour cell is not in the same region.
  ctx.lineWidth = 1.5;
  for (const [name, r] of Object.entries(set.regions)) {
    ctx.strokeStyle = `hsl(${hue(name)} 90% 60%)`;
    const own = new Set(r.cells.map((c) => `${c.x},${c.y}`));
    ctx.beginPath();
    for (const { x, y } of r.cells) {
      const x0 = x * cw, y0 = y * ch;
      if (!own.has(`${x},${y - 1}`)) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cw, y0); }
      if (!own.has(`${x},${y + 1}`)) { ctx.moveTo(x0, y0 + ch); ctx.lineTo(x0 + cw, y0 + ch); }
      if (!own.has(`${x - 1},${y}`)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + ch); }
      if (!own.has(`${x + 1},${y}`)) { ctx.moveTo(x0 + cw, y0); ctx.lineTo(x0 + cw, y0 + ch); }
    }
    ctx.stroke();
    ctx.fillStyle = `hsl(${hue(name)} 90% 70%)`;
    ctx.font = `bold ${Math.max(6, cw * 0.6)}px monospace`;
    const [lx, ly] = mid(r.label.at.x, r.label.at.y);
    ctx.fillText(name.toUpperCase(), lx, ly);
  }

  // Seats, spots and exits, tiny labels.
  ctx.font = `${Math.max(7, cw * 0.45)}px monospace`;
  const mark = (x: number, y: number, fill: string, text: string) => {
    const [px, py] = mid(x, y);
    ctx.fillStyle = fill;
    ctx.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, px, py);
  };
  for (const [name, p] of Object.entries(set.spots)) mark(p.x, p.y, kinds[p.y][p.x] === 'seat' ? 'rgba(40,120,255,0.45)' : 'rgba(40,200,120,0.4)', name);
  for (const [name, cells] of Object.entries(set.exits)) for (const p of cells) mark(p.x, p.y, 'rgba(255,200,0,0.45)', `>${name}`);

  // Remaining path of everyone walking.
  ctx.lineWidth = 2;
  for (const a of actors) {
    if (!a.dest) continue;
    const path = set.path(a.pos, a.dest);
    if (!path) continue;
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.moveTo(...mid(a.x, a.y));
    for (const p of path) ctx.lineTo(...mid(p.x, p.y));
    ctx.stroke();
    const e = path[path.length - 1] ?? a.pos;
    ctx.beginPath();
    ctx.arc(...mid(e.x, e.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
