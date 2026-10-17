import { describe, expect, it } from 'vitest';
import { SETS, getSet, key, parseSet } from '../src/sets/index.ts';
import { loadSetsFromDir } from '../src/sets/node.ts';

const range = (p: string, n: number, from = 1) => Array.from({ length: n }, (_, i) => `${p}${i + from}`);

/** The contract other code relies on. */
const EXPECT: Record<string, { spots: string[]; regions: string[]; exits: string[] }> = {
  office: {
    spots: [
      'michael_desk', 'michael_guest_1', 'michael_guest_2', 'pam_desk', 'jim_desk', 'dwight_desk', 'stanley_desk',
      'phyllis_desk', 'andy_desk', 'ryan_desk', 'creed_desk', 'meredith_desk', 'oscar_desk', 'angela_desk', 'kevin_desk',
      'erin_desk', ...range('conf_', 10), 'conf_front', 'copier', 'water_cooler',
    ],
    regions: ['michael_office', 'conference_room', 'reception', 'bullpen', 'accounting'],
    exits: ['parking_lot', 'warehouse', 'break_room', 'kitchen', 'annex'],
  },
  kitchen: { spots: [...range('kitchen_', 3), 'microwave', 'fridge', 'vending'], regions: ['kitchen'], exits: ['office'] },
  annex: { spots: ['ryan_desk', 'kelly_desk', 'toby_desk'], regions: ['annex'], exits: ['office'] },
  break_room: { spots: range('table_', 6), regions: ['break_room'], exits: ['office'] },
  parking_lot: {
    spots: ['car_michael', 'car_dwight', 'car_jim', 'car_stanley', 'smoking_spot', 'dumpster'],
    regions: ['parking_lot', 'entrance'],
    exits: ['office'],
  },
  warehouse: {
    spots: ['darryl_desk', 'forklift', 'dock_1', 'dock_2'],
    regions: ['warehouse', 'darryl_office', 'loading_dock'],
    exits: ['office'],
  },
  offsite: { spots: range('seat_', 8), regions: ['venue', 'entrance'], exits: ['parking_lot'] },
};

describe('sets', () => {
  it('loads exactly the contract sets', () => {
    expect(Object.keys(SETS).sort()).toEqual(Object.keys(EXPECT).sort());
    expect(() => getSet('nope')).toThrow();
  });

  for (const [id, want] of Object.entries(EXPECT)) {
    describe(id, () => {
      const set = SETS[id];

      it('has the contracted spots, regions and exits', () => {
        for (const s of want.spots) expect(set.spots, s).toHaveProperty(s);
        for (const r of want.regions) expect(set.regions, r).toHaveProperty(r);
        for (const e of want.exits) expect(set.exits[e]?.length, e).toBeGreaterThan(0);
      });

      it('spots and exits are walkable', () => {
        for (const p of [...Object.values(set.spots), ...Object.values(set.exits).flat()]) expect(set.walkable(p)).toBe(true);
      });

      it('every spot is reachable from every exit', () => {
        const exits = Object.values(set.exits).map((c) => c[0]);
        for (const e of exits) for (const [name, s] of Object.entries(set.spots)) expect(set.path(e, s), `${name} from ${key(e)}`).not.toBeNull();
      });

      it('regions are non-empty and contain their label', () => {
        for (const [name, r] of Object.entries(set.regions)) {
          expect(r.cells.length, name).toBeGreaterThan(0);
          expect(set.regionAt(r.label.at), name).toBe(name);
          expect(r.cells.some((c) => key(c) === key(r.label.at))).toBe(true);
        }
      });

      it('freeCellIn returns free cells in the region; paths stay on walkable cells', () => {
        let n = 1;
        const pick = () => ((n = (n * 16807) % 2147483647) / 2147483647);
        for (const name of Object.keys(set.regions)) {
          const occ = new Set<string>();
          for (let i = 0; i < 5; i++) {
            const c = set.freeCellIn(name, occ, pick)!;
            expect(c, name).not.toBeNull();
            expect(set.regionAt(c)).toBe(name);
            expect(set.walkable(c)).toBe(true);
            expect(occ.has(key(c))).toBe(false);
            occ.add(key(c));
            const path = set.path(Object.values(set.spots)[0], c)!;
            expect(path).not.toBeNull();
            let prev = Object.values(set.spots)[0];
            for (const s of path) {
              expect(set.walkable(s)).toBe(true);
              expect(Math.max(Math.abs(s.x - prev.x), Math.abs(s.y - prev.y))).toBe(1);
              prev = s;
            }
          }
        }
      });

      it('parse is deterministic', () => {
        const again = loadSetsFromDir(new URL('../data/sets', import.meta.url).pathname)[id];
        expect(again.kinds).toEqual(set.kinds);
        expect(again.regions).toEqual(set.regions);
      });
    });
  }
});

describe('office layout', () => {
  const office = SETS.office;

  it('is built from office.layout.json on a square grid', () => {
    expect(office.layout).toBeDefined();
    expect(office.cellW).toBe(office.cellH);
    expect(office.cellW * office.width).toBeGreaterThanOrEqual(office.layout!.width);
  });

  it('every seat is a seat cell, reachable from the main entrance', () => {
    const door = office.exits.parking_lot[0];
    for (const [name, p] of Object.entries(office.spots)) {
      expect(office.path(door, p), name).not.toBeNull();
      const seat = office.layout!.spots[name].seat;
      expect(office.kinds[p.y][p.x], name).toBe(seat ? 'seat' : 'spot');
    }
  });

  it('visiting places are reachable floor (Pam is talked to across the reception desk)', () => {
    const door = office.exits.parking_lot[0];
    expect(office.visits[key(office.spots.pam_desk)]).toBeDefined();
    for (const p of Object.values(office.visits).flat()) expect(office.path(door, p)).not.toBeNull();
  });

  it('walls block, door gaps do not, and people keep a gap when picking cells', () => {
    const { layout } = office;
    const c = office.cellW, wall = layout!.walls[0];
    expect(office.walkable({ x: Math.floor((wall.x + wall.w / 2) / c), y: Math.floor((wall.y + wall.h / 2) / c) })).toBe(false);
    for (const cells of Object.values(office.exits)) for (const p of cells) expect(office.walkable(p)).toBe(true);
    const spot = office.spots.jim_desk;
    const next = office.nextTo(spot, new Set([key(spot)]))!;
    expect(Math.max(Math.abs(next.x - spot.x), Math.abs(next.y - spot.y))).toBeGreaterThanOrEqual(2);
  });
});

describe('parseSet', () => {
  const header = 'a = alice\nb = bob .\n> = exit:elsewhere\n---\n';

  it('pads ragged rows and marks the outside as void', () => {
    const s = parseSet('t', header + '####\n#a #\n#  #>\n####\n# b');
    expect(s.width).toBe(5);
    expect(s.kinds.every((r) => r.length === 5)).toBe(true);
    expect(s.kinds[0][4]).toBe('void');
    expect(s.kinds[1][2]).toBe('floor');
    expect(s.spots.alice).toEqual({ x: 1, y: 1 });
    expect(s.kinds[1][1]).toBe('seat');
    expect(s.walkable({ x: 4, y: 2 })).toBe(true);
  });

  it('names labels, splits open floor by nearest label, and doors block regions', () => {
    const s = parseSet('t', header + [
      '############',
      "#TOM'S ROOM#",
      '#          #',
      '####+#######',
      '#  FOO BAR #',
      '#          #',
      '############',
    ].join('\n'));
    expect(Object.keys(s.regions).sort()).toEqual(['foo_bar', 'tom_room']);
    expect(s.regionAt({ x: 1, y: 2 })).toBe('tom_room');
    expect(s.regionAt({ x: 4, y: 3 })).toBeNull();
    expect(s.regionAt({ x: 1, y: 5 })).toBe('foo_bar');
  });

  it('paths do not cut corners', () => {
    const s = parseSet('t', header + '#####\n#a  #\n#=  #\n#  b#\n#####');
    const p = s.path(s.spots.alice, s.spots.bob)!;
    expect(p.length).toBe(3);
    expect(p.map(key)).not.toContain('1,2');
    const wall = parseSet('t', header + '#####\n#a# #\n# #b#\n#####');
    expect(wall.path(wall.spots.alice, wall.spots.bob)).toBeNull();
  });

  it('rejects unknown tiles', () => {
    expect(() => parseSet('t', header + '#q#')).toThrow();
  });
});
