# Set maps

Each `*.txt` file is one set (the file name is the set id). A file is a header, a line
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
