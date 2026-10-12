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
npm run render -- --show <id> --ep N [--scene M] [--format vertical]   # MP4 (needs ffmpeg + chromium); --demo, --season
```
URL params: `show`, `ep`, `scene` (1-based), `demo=1`, `seed`, `play`, `id`, `name`, `direction`, `render=1` (used by the renderer). Keys: space, 1–4 speed, ←/→ scene, d debug, f fullscreen, N start screen.

## Architecture (the LLM decides *what* happens, the engine decides *how*)
1. **Writer** (`server/writer.ts`, `src/writer/`, `src/schema/`). Mirrors wrestling's booker: `callTool`/`callWithRetry`, prompt caching, lenient Zod parsing, and one retry only when the result is unplayable. Repairs are logged to `sessions/failures/`.
   - **Season bible** (`WRITER_PLAN_MODEL`, default `claude-sonnet-5-5`, ~$0.04): theme, roster drawn from any era of the show (the user chose "whole run, mixed"), desk overrides, 3–5 arcs with per-episode beats, recurring invented extras (glyph and color persisted), running gags, tentpoles. Seasons are 12 episodes. A season-2+ bible is stored inside that season's first episode as `seasonStart`.
   - **Episode** (`WRITER_MODEL`, default `claude-haiku-5-5`, ~$0.015): the `write_episode` tool returns a **flat beat list with `scene` markers** (`EpisodeDraft` → `draftToEpisode`), plus `outline` (filled first), `theme`, `stateChanges`, `storySoFar`. Each scene has `part` (cold_open/act1/act2/tag), `plot` (cold_open/A/B/C/tag), `set`, `region`, `venue`, `present`.
   - Beat types: say, talking_head, move, enter, exit, gather, sit, stand, react, action, pause, caption.
   - **Prompts are data**: `data/writer/style.md`, `constraints.md` (`{{SETS}}` is filled from the set files), `format.md`, `directives.json` (2 seeded nudges per episode), `tentpoles.json`. Tune the writing there, not in TS. Validator caps (camera looks, talking heads per scene, plot runs) are constants at the top of `src/writer/validate.ts`.
2. **Series state** (`src/world/`): roster, relationships, gags, notes, arc progress, storySoFar, history, recentPlots. `applyEpisode` is pure, so state is replayed from stored episodes.
3. **Director** (`src/choreo/director.ts`): turns beats into coroutines. Movement beats start walks and the director continues; a later beat waits for the actors it involves. Talking heads freeze world time and cut to the confessional. Office background cast sits at their desks, and ambient life (copier and water-cooler trips) runs on a seeded rng. Unknown targets degrade gracefully.
4. **Engine** (`src/engine/`): a fixed 60 Hz scheduler of generator coroutines (copied from wrestling), seeded, so the same episode always plays identically. Tests assert this.
5. **Sets** (`data/sets/`, `src/sets/`): invisible logic maps (A* walking, seats, regions, exits). The LLM only ever sees region and spot names. The **office** is an art-scale floor plan, `office.layout.json` (world px at native sprite scale, rasterized onto a 16 px grid by `src/sets/layout.ts`; walls, doors, windows, props, spots, regions), modeled on the user's reference `art/raw/office-reference.png`. The other sets (break_room, kitchen, annex, parking_lot, warehouse, offsite) are still ASCII grids (16×32 px cells), drawn procedurally until they get art. Kitchen and annex are separate sets; old episodes with `office` + region `kitchen`/`annex` are remapped. Format docs in `data/sets/README.md`. `tests/sets.test.ts` guards the spot/region names the writer relies on.
6. **Views** (`src/view/`): `sprites.ts` (canvas sprite map with camera framing and an HTML balloon layer; the only map view, placeholders where art is missing), `head.ts` (drawn confessional: portrait art, or a placeholder bust in the actor's color), feed/transcript, card, start screen. The map and confessional share one 16:9 box (`#stage`; text scales with it via container units). Views only read engine state and events, so they are swappable.
7. **Storage**: `sessions/<id>/` (git-ignored: `series.json`, `ep-NNN.json`) and `library/<id>/` (committed, bundled into the Pages build by the Vite library plugin and `.github/workflows/pages.yml`). Cast canon is in `data/cast.json`. The hand-written demo episode is `data/demo/episode.json` (`?demo=1`, and the fallback when nothing else is available).

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

## Status (2026-10-11)
Done: sprite renderer (ASCII removed) with the office floor plan, Pam's sprites and portrait, sprite pipeline (`npm run sprites`: `art/raw/` → `public/sprites/`, manifest `art/sprites.json`), AI writer (bible + episodes), stored shows, start screen, CLI (pregen/preview/library/render), MP4 export (horizontal and vertical), README, first push, and Pages enabled (Actions build).

In progress: a 2-season pregen of "The Office" (direction: classic mid-run Scranton). It got the id `the-office-2` because an older 2-episode `sessions/the-office` already existed (origin unclear; don't delete it without asking). Plan: review the episodes and `sessions/failures/`, then copy the series to `library/the-office` with the id fixed in `series.json`, commit, and push to redeploy. This is also the first live test of the season-1 → season-2 bible transition.

## Next steps
1. **Art** (the user generates it with ChatGPT; magenta backgrounds key out cleanly). Only Pam is drawn; everyone else is a colored placeholder (`<id>_walk_front|back|side` and `<id>_head[_talk|_<mood>]` plug in by name). Wanted next: walk sheets for the main cast, Pam sitting/typing, portrait variants (mouth open, moods), water cooler/vending/fridge, and art for the other sets (they'll come as separate reference images like the office). Fine-tune the office by editing `office.layout.json` (`?cam=all` frames the whole floor). Pam is complete and is the template: `art/templates/pam-sheet.png` (26 map frames in a fixed order, no text; `-labeled` variant for humans) and `pam-confessional.png` (neutral, talk, happy, happy talk). A generated sheet in that layout goes in `art/sprites.json` as `{ "kind": "character", "name": "<id>", "key": true, "gap": 12 }`; it is sliced in reading order and scaled so the standing frame matches Pam (`"height"`: standing height in px, default 128, e.g. Jim 142; seated frames keep the base scale so their chair matches the empty chairs). Portrait variants share one `box` crop so faces never shift; `"key": "border"` keys any flat background color. After `npm run sprites`, restart Vite (it stops serving the regenerated `public/sprites/`).
2. Writing quality: Haiku is serviceable. Try `WRITER_MODEL=claude-sonnet-5-5` for curated library seasons. Watch `sessions/failures/` and tune `data/writer/*.md`.
3. Rough edges:
   - Present characters start at their desk only if it's in the scene's region (keep region rects covering their desks).
   - The conference room seats 10.
   - Moving walkers can overlap in doorways.
   - Offsite venues all share one generic layout.
   - Render-mode CSS: `body.render #frame > #hud` outranks plain `body.render.vertical #hud` rules, so match its specificity.
