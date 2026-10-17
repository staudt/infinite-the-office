# Infinite The Office

A never-ending, screensaver-style generative *The Office* (US). Claude writes the show and a deterministic engine stages it in the browser. Vite + TypeScript (strict). Deployed to GitHub Pages, where it plays pre-generated seasons with no AI.

- Repo: https://github.com/staudt/infinite-the-office (branch `master`; push over **HTTPS**, since SSH isn't set up)
- Site: https://staudt.github.io/infinite-the-office/ (`?show=<id>` opens a stored show)
- Sibling project: `../infinite-wrestling`, an AI-booked wrestling show. This repo was built by **copying and adapting** its code; there is no shared package. When adding a feature, check first whether wrestling already solved it (e.g. its sprite-ready view split, CLI patterns, booker prompts).

## Commands
```bash
npm run dev          # browser app (Vite); proxies /api to :8787
npm run server       # writer proxy on :8787; reads .env (ANTHROPIC_API_KEY, WRITER_MODEL, WRITER_PLAN_MODEL)
npm test             # vitest; npm run typecheck for tsc
npm run pregen -- --name "..." --direction "..." --seasons 1    # or --episodes N; --show <id> extends; prints cost
npm run preview -- --show <id> --ep N                            # headless transcript (no API calls)
npm run library [-- add <id>]                                    # list / copy sessions/<id> into library/<id>
npm run import -- --dir <drafts> [--out library]                 # hand-written season (bible.json + ep-NN.json drafts) through the same review/replay; no API
npm run render -- --show <id> --ep N [--scene M] [--format vertical]   # MP4 (needs ffmpeg + chromium); --demo, --season
npm run shot -- --show <id> --ep N [--scene M] [--at SEC] [--every SEC --count K] [--cam all] [--grid]   # PNGs in shots/ (same frames as the MP4); --demo
```
URL params: `show`, `ep`, `scene` (1-based), `demo=1`, `seed`, `play`, `id`, `name`, `direction`, `render=1` (used by the renderer), `cam=all` (frame the whole set), `grid=1` (logic-grid overlay: blocked cells, seats/spots/exits, regions, walker paths). Keys: space, 1–4 speed, ←/→ scene, d debug, f fullscreen, N start screen.

## Architecture (the LLM decides *what* happens, the engine decides *how*)
1. **Writer** (`server/writer.ts`, `src/writer/`, `src/schema/`). Mirrors wrestling's booker: `callTool`/`callWithRetry`, prompt caching, lenient Zod parsing, and one retry only when the result is unplayable. Repairs are logged to `sessions/failures/`.
   - **Season bible** (`WRITER_PLAN_MODEL`, default `claude-sonnet-5-5`, ~$0.04): theme, roster drawn from any era of the show (the user chose "whole run, mixed"), desk overrides, 3–5 arcs with per-episode beats, recurring invented extras (glyph and color persisted), running gags, tentpoles. Seasons are 12 episodes. A season-2+ bible is stored inside that season's first episode as `seasonStart`.
   - **Episode** (`WRITER_MODEL`, default `claude-haiku-5-5`, ~$0.015): the `write_episode` tool returns a **flat beat list with `scene` markers** (`EpisodeDraft` → `draftToEpisode`), plus `outline` (filled first), `theme`, `stateChanges`, `storySoFar`. Each scene has `part` (cold_open/act1/act2/tag), `plot` (cold_open/A/B/C/tag), `set`, `region`, `venue`, `present`.
   - Beat types: say, talking_head, move, enter, exit, gather, sit, stand, react, action, pause, caption.
   - **Prompts are data**: `data/writer/style.md`, `constraints.md` (`{{SETS}}` is filled from the set files), `format.md`, `directives.json` (2 seeded nudges per episode), `tentpoles.json`. Tune the writing there, not in TS. Validator caps (camera looks, talking heads per scene, plot runs) are constants at the top of `src/writer/validate.ts`.
2. **Series state** (`src/world/`): roster, relationships, gags, notes, arc progress, storySoFar, history, recentPlots. `applyEpisode` is pure, so state is replayed from stored episodes.
3. **Director** (`src/choreo/director.ts`): turns beats into coroutines. Movement beats start walks and the director continues; a later beat waits for the actors it involves. Talking heads freeze world time and cut to the confessional. Office background cast sits at their desks, and ambient life (copier and water-cooler trips) runs on a seeded rng. Unknown targets degrade gracefully.
4. **Engine** (`src/engine/`): a fixed 60 Hz scheduler of generator coroutines (copied from wrestling), seeded, so the same episode always plays identically. Tests assert this.
5. **Sets** (`data/sets/`, `src/sets/`): invisible logic maps (A* walking, seats, regions, exits). The LLM only ever sees region and spot names. The **office** is an art-scale floor plan, `office.layout.json` (world px at native sprite scale, rasterized onto a 16 px grid by `src/sets/layout.ts`; walls, doors, windows, props, spots, regions), modeled on the user's reference `art/raw/office-reference.png`. The **warehouse** is a layout on a flat picture (`background`: `art/raw/warehouse.png`, drawn at 1.35x; its walls are walking logic only, covering racks, the closed bathroom and Darryl's office, and the forklift). The **kitchen, annex and break room** are small separate layouts (one room each; a shared floor and a merge into the office were both tried and rejected as too spacious), furnished from the user's `art/raw/wing-furniture-sheet.png`, hand-cut into `wing-furniture.png` (1.35x; that art is drawn at an angle). The kitchen's bottom wall has the restroom doors, `closed` (drawn shut, not walkable). Kelly and Ryan share an office pod in the annex. The **parking lot** is a flat picture like the warehouse (`art/raw/parking-lot.png` at 1.4x; cars are walls with a strip behind the bottom row; exits: glass doors -> office, side door -> warehouse, gate -> offsite). The **offsite** venue (Chili's, bars, homes; the title card names it) is a small layout with two tables of four, a wood floor and terracotta walls (`wallColors`). No set uses the ASCII format (16×32 px cells) any more; it still works for rough new sets. Kitchen and annex are separate sets; old episodes with `office` + region `kitchen`/`annex` are remapped. Format docs in `data/sets/README.md`. `tests/sets.test.ts` guards the spot/region names the writer relies on.
6. **Views** (`src/view/`): `sprites.ts` (canvas sprite map orchestration and its HTML balloon/card layer; the only map view, placeholders where art is missing; layout sets come from `plan.ts`, ASCII sets from `ascii.ts`, both as a `Plan` of y-sorted items), `head.ts` (drawn confessional: portrait art, or a placeholder bust in the actor's color), feed/transcript, card, start screen. The map and confessional share one 16:9 box (`#stage`; text scales with it via container units). Views only read engine state and events, so they are swappable.
7. **Storage**: `sessions/<id>/` (git-ignored: `series.json`, `ep-NNN.json`) and `library/<id>/` (committed, bundled into the Pages build by the Vite library plugin and `.github/workflows/pages.yml`). Cast canon is in `data/cast.json`. The hand-written demo episode is `data/demo/episode.json` (`?demo=1`, and the fallback when nothing else is available).

### Where to tweak what (sprite map)
- Any placement/size number (person height, seat drop and base, chair scale, camera padding and zoom, balloon gaps, emote offset, ASCII cell size): `src/view/geometry.ts`. Dependent values are derived there.
- Camera framing: `camera.ts` (pure). Balloon placement: `balloons.ts` (pure). Both unit-tested in `tests/view.test.ts`.
- Poses (sit/type/phone/react/walk frame choice) and drawing a person: `pose.ts`. Draw order (y-sort keys) of walls/props/chairs: `plan.ts`; of ASCII-set blocks: `ascii.ts`.
- Office furniture, walls, spots, regions: `data/sets/office.layout.json`. Walk paths: check with `npm run shot -- ... --grid`.
- For a pure refactor of the view, shoot a frame list before and after and compare pixels (pngjs is a devDependency).

## Working conventions (user preferences)
- **Delegate to cheaper models by complexity** to save tokens. Use Sonnet subagents for substantial implementation and Haiku for mechanical work (copying, docs). The main session designs contracts (schema, prompts), reviews, and verifies.
- Verify agent work yourself: run typecheck/tests, and look at screenshots or rendered frames before reporting.
- Live API generation costs real money. Keep test generations small, and never put test shows (e.g. `live-test`) into `library/`.
- API gotchas already fixed in `server/writer.ts`; keep them:
  - `disable_parallel_tool_use: true` (Haiku otherwise splits an episode across several tool calls).
  - A retry must answer *every* `tool_use` block.
  - `max_tokens: 128000`: Haiku thinks for 30–45k tokens per episode at medium effort, and 48k got cut off.
  - Both writer models reject forced `tool_choice`.
- Match wrestling's code style: compact, short "why" comments, lenient parsing.

## Status (2026-10-13)
Done and pushed (site redeploys on every push to `master`):
- Sprite renderer only (ASCII views removed): canvas map with camera framing per scene region, depth sorting, pose art (walk, sit with chair, typing/phone at desks, reactions), HTML balloon layer; drawn confessional with portraits and talking mouths.
- Office as an art-scale floor plan from the user's reference; kitchen and annex are separate sets.
- Opening title card after the cold open (logo + episode title over the office; a quick-cut montage was tried and rejected).
- Side panel: episode label with ‹ › arrows (› enabled once the next episode is ready).
- Resume: the episode on screen is saved as it starts (`saveWatching`); stored shows reload from their origin at that episode, so ‹ still reaches earlier ones.
- Sprite pipeline (`npm run sprites`: `art/raw/` → `public/sprites/`, manifest `art/sprites.json`; prop sizes also go to `data/sets/prop-sizes.json` for the layout builder).
- AI writer (bible + episodes), stored shows, start screen, CLI (pregen/preview/library/render), MP4 export (horizontal and vertical), README with screenshots.

Published demo: `library/scranton-the-golden-years` ("Scranton: The Golden Years", 12 episodes, written entirely by Sonnet for $0.81; nostalgic seasons 2-4 feel) and its sequel `library/scranton-growing-up` ("Scranton: Growing Up", seasons 5-6 feel: Holly, Pam at Pratt, Angela/Andy/Dwight, Erin; written by hand by Opus in a Claude Code session, no API, via `npm run import`). Those two are the committed shows. Episodes can set `away` (regulars not drawn at their desks that episode); `pam_desk` and `erin_desk` are the same spot, so a season with both puts Pam elsewhere via `deskOverrides` (Growing Up: Pam in sales at `ryan_desk`, Ryan at `toby_desk`). The older 2-season `library/the-office` stays on disk but is git-ignored (local only); `sessions/the-office` and `sessions/the-office-2` are its sources. New shows get descriptive names, never just "The Office" (ids would collide). Sonnet for both models costs ~$0.06/episode; the user prefers that over Opus (too expensive) for curated seasons.

**Art** (paused 2026-10-12: "good with sprites for now"; the user generates art with ChatGPT on magenta). Map sheets for 19 characters plus 3 generic bodies (`generic_office_m|office_f|warehouse`, green clothes recolored at load time to the character's color by `art.dress()` in `src/view/art.ts`; picked by `look` on extras/cast, else warehouse staff -> warehouse, else a hash of the id). The writer may set `look` when inventing extras. Confessional portraits (`<id>_head` + painted `_talk` mouth) for Michael, Dwight, Jim, Pam, Ryan, Oscar, Andy, Stanley, Phyllis, Angela, Kevin, Kelly, Meredith, Creed, Toby; others use a crisp close-up of their map sprite (reaction frames as moods). Missing: portraits for Darryl, Jan, David and Roy (they use sprite close-ups); Erin, Holly, Karen, Gabe, Packer, Bob Vance, Mose, Hank sprites (they wear generic bodies). Open mouths were painted by a throwaway script (erase the lip line with sampled skin, stamp a 4-row pixel mouth at a hand-picked position). The office furniture (2026-10-17) comes from the user's sheet `art/raw/furniture-2.png` (chairless, laid out like the reference), hand-cut into `art/raw/office-furniture.png` and `art/raw/reception-corner.png` (touching pieces don't separate automatically; the top of Dwight's desk is mirrored so his keyboard faces his chair). Those props are stored at native size with `"sharpen": 1.2` and drawn at `"scale": 1.45` in the layout, since baking in an upscale blurred them. Desk positions follow the user's floor plan (accounting bottom-left; Andy in Creed's pod; `ryan_desk` in both the office and the annex). Seats are drawn at the spot's exact px, so line them up with the keyboards in the desk art. A seat's `visit` list is where people talking to the sitter stand (Pam's is beside the reception desk), and standing people turn toward what they came for (`faceFocus` in the director). Fine-tune the office in `office.layout.json` (`?cam=all` frames the whole floor). Pam is the template: `art/templates/pam-sheet.png` (26 map frames in a fixed order, no text; `-labeled` variant for humans) and `pam-confessional.png`. A generated sheet in that layout goes in `art/sprites.json` as `{ "kind": "character", "name": "<id>", "key": true, "gap": 12, "height": 132 }` (`height`: standing px, Pam 128; seated frames keep the base scale so their chair matches the empty chairs). Portrait variants share one `box` crop; `"key": "border"` keys any flat background color. After `npm run sprites`, restart Vite (it stops serving the regenerated `public/sprites/`).

## Next steps
1. **Episode transitions** (ideas the user liked but not built): end credits after the tag (title, "Written by Claude", the episode's cast in their colors), a "Next time on The Office" bumper when the next episode is ready, and fades to/from black at the seam between episodes. Must stay deterministic (show time) so video export matches.
2. **Writing quality:** review the demo season and `sessions/failures/`; tune `data/writer/*.md`.
3. **Set art:** every set has art now. The break room's angled vending art is a placeholder (the user will generate straight-on furniture), and the offsite venue is one generic room (venue types could follow).
4. **Rough edges:**
   - Present characters start at their desk only if it's in the scene's region (keep region rects covering their desks).
   - Moving walkers can overlap in doorways.
   - Render-mode CSS: `body.render #frame > #hud` outranks plain `body.render.vertical #hud` rules, so match its specificity.
   - After `npm run sprites`, the Vite dev server must be restarted.
