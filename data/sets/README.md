# Set maps

A set is either an ASCII grid (`*.txt`, below) or an art-scale floor plan (`*.layout.json`, see the end). The file name is the set id. The office, warehouse, kitchen, annex, break_room and parking_lot are layouts; offsite is an ASCII grid, drawn procedurally.

## ASCII sets

Each `*.txt` file is one set. A file is a header, a line
containing only `---`, then the grid. Rows may be ragged; short rows are padded with spaces.

## Header

One `key = value` per line; `;` starts a comment (the header is the only place comments live,
so `;` never clashes with a tile).

```
j = jim_desk              ; a seat: the cell renders as "_"
^ = conf_front .          ; optional 2nd token = render char; "." renders blank (standing spot)
> = exit:parking_lot      ; an exit to another set (all cells sharing the char are recorded)
@MICHAEL'S OFFICE = boss  ; optional: override the auto-name of a label
```

Keys are one character that is not in the tile legend (lowercase letters, digits, punctuation
like `> } { ^ @`, or a single capital that is not next to other capitals). Spot and exit cells
are walkable.

## Tile legend

| char | meaning | walkable |
|------|---------|----------|
| `#` | wall (also fences, building) | no |
| ` ` / `.` | floor (spaces outside the outer wall become void) | yes |
| `=` | desk / table / counter | no |
| `"` | window (part of a wall) | no |
| `%` | plant | no |
| `+` | door (see regions) | yes |
| `&` | copier / machine / microwave | no |
| `$` | vending machine | no |
| `*` | fridge / appliance / water cooler | no |
| `[` `]` | shelf / cabinet / pallet | no |
| `:` | big prop: car, forklift, couch, dumpster | no |
| `~` | decorative floor: rug, parking lines | yes |

## Labels and regions

A label is words of capitals (and apostrophes) joined by single spaces, with at least two
letters in a row: `MICHAEL'S OFFICE`, `RECEPTION`. Use two or more spaces to keep two labels on
one row apart. Label cells are walkable floor, drawn dimmed. The region name is the text
lowercased, `'S` dropped, other non-alphanumerics turned into `_`: `michael_office`.
Several labels with the same name merge into one region.

Regions grow from their label cells by flood fill over walkable cells. Each cell goes to the
nearest label by path distance, so an open room is split just by placing labels. Walls and solid
tiles stop growth. Doors (`+`) are walkable but belong to no region and growth does not pass
through them, so close every room opening with a `+` (a plain gap would merge two rooms).
Exits sit in a wall or on an edge and join the region next to them. Cells no label reaches have
no region.

## Tips

- Keep walls aligned: the outer wall must be a closed `#` rectangle.
- Seats go next to the desk (`=`), standing spots in open floor.
- Keep corridors 2+ cells wide; characters move diagonally but never cut wall corners.

## Layout sets (`*.layout.json`)

`office.layout.json` is the Dunder Mifflin floor at native sprite scale: **world units are pixels**, y down,
and a desk pod sprite (~150 px wide) is the yardstick. People are ~96 px tall. The renderer draws the plan
(`src/view/plan.ts`); `src/sets/layout.ts` rasterizes it onto a square grid of `cell` px (16) that is only the
invisible walking/logic map (`SetMap.cellW === cellH`). A cell is blocked when more than 40% of it is covered by a
wall or a prop's solid rect. Keep walls and doors on multiples of 16 so the grid matches what is drawn, and
corridors 32 px or wider.

```json
{ "width": 1088, "height": 1008, "cell": 16,
  "floor":   [{ "x":0,"y":0,"w":0,"h":0, "style":"carpet" }],
  "walls":   [{ "x":0,"y":0,"w":0,"h":0 }],
  "doors":   [{ "x":0,"y":0,"w":0,"h":0, "exit":"parking_lot" }],
  "windows": [{ "x":0,"y":0,"w":0,"h":0 }],
  "decor":   [{ "sprite":"wall_picture","x":0,"y":0,"scale":1 }],
  "props":   [{ "sprite":"desk_pod_b","x":0,"y":0,"flip":false,"scale":1,"w":0,"h":0,"solid":{"x":0,"y":0,"w":0,"h":0},"split":0 }],
  "spots":   { "jim_desk": { "x":0,"y":0,"seat":"right","chair":false,"front":true,"visit":[{"x":0,"y":0}] } },
  "regions": { "bullpen": [{ "x":0,"y":0,"w":0,"h":0 }] } }
```

- **floor**: carpet rects (`style`: `carpet`, `tile`, `wood`). Anything outside a floor, wall or door is void.
- **walls**: screen rects. A horizontal wall (w >= h) is a 16 px cream cap on top and a beige face below it down to the
  baseboard, so `h` is 16 + the wall's height (80 for an interior wall, 112 for a back wall that carries tall
  furniture). A vertical wall is a cap column whose last 56 px show its end face. The whole rect blocks walking, and
  walls are y-sorted by their bottom edge with props and people (someone south of a wall overlaps its face; someone
  north of it is hidden by it). Vertical walls are sorted in 16 px slices.
- **doors**: openings cut through walls (give them the wall's full y/h or x/w extent). Walkable; drawn as a threshold
  with jambs and an open leaf. `exit` (a name or a list of names) makes every cell of the door an exit to that set.
  `"closed": true` draws a shut door that blocks walking (the restrooms off the kitchen).
  Doors in horizontal walls get door art (`art/raw/doors.png`): shut in the gap, swung a quarter open while someone is
  within a step of it (`closed` doors never open); exits use the lever handle, room doors the knob. Doors in side walls keep a thin edge-on leaf.
- **windows**: screen rects painted on a wall face (blue glass with blinds); **decor**: sprites hung on a face,
  `x` is the center and `y` the bottom edge; no collision.
- **props**: `x`,`y` is the **bottom-center** of the sprite at native size. `solid` is the blocking rect (or a list)
  in px from the sprite's top-left, mirrored with `flip`; `null` walks through; the default is the lower half of the
  sprite (at most 56 px deep), plants block only their pot. Sprites with no art (the `water_cooler`) take `w`/`h`.
  `split` (px from the sprite's top) draws the rows above it behind whoever stands at the prop, so Michael can sit
  between his hutch and his desk.
- **spots**: the names the writer and director use. `x`,`y` snap to their cell for walking; a person stands at the cell center, but a seat (and its
  sitter) is drawn at the exact `x`,`y`, so it can line up with a keyboard in the desk art. `seat` is the direction the sitter faces (`down`, `up`, `left`, `right`): the spot becomes a seat, a chair
  is drawn (`"chair": false` when the prop art already has one), and a left/right sitter is drawn over the prop
  beside them (`"front"` forces that for other seats). Put a seat where the art's chair is. `visit` (world px, a list) is where people who
  talk to the sitter stand, first free one first, e.g. across the reception desk, even where the prop hides their legs.
- **regions**: lists of rects; a walkable cell belongs to the first region holding its center. Doors belong to none.
- **background** (optional): `{ "sprite": "warehouse_bg", "scale": 1.35 }`, a flat picture of the whole room drawn under
  everything from the top-left. Floor, walls and doors are then not drawn, only walked: put walls over everything people
  must walk around, since a flat picture can't hide someone behind a rack (the warehouse does this).

Exits and seats must be reachable (`tests/sets.test.ts` checks every spot from the main entrance). `?cam=all`
frames the whole floor in every scene when looking at a plan.
