# Infinite The Office

**Never-ending generative *The Office* (US).** A screensaver-style sitcom that writes itself. Claude writes each season's plan and every ~10-minute episode. A deterministic engine stages it on ASCII floor plans of Dunder Mifflin Scranton: characters walk around, talk in speech balloons, hold conference-room meetings, and cut to a confessional close-up for talking heads.

```
# MICHAEL'S OFFICE            # CONFERENCE ROOM               # KITCHEN       # ANNEX           #
#              m           [[ #         1  2  3  4  5       % # ** ==&==== $$ #                 #
#         ============     [[ #=      =================     [[#               # ===== ===== === #
#  :::::  ============        #=  ^   =================     [[#   =======     #   r     q    t  #
#                             #=      =================       #   =======     #                 #
```

Fan project, not affiliated with NBC/Universal. It uses the characters' names and no official assets. The engine is built on [infinite-wrestling](https://github.com/staudt/infinite-wrestling).

## Run it

```bash
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY so Claude writes the show
npm run server              # writer proxy on :8787 (keeps the key server-side)
npm run dev                 # open the printed URL
```

`npm run server` and `npm run pregen` read `.env`. Variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | none | Enables writing. Without it, stored shows and the demo still play. |
| `WRITER_MODEL` | `claude-haiku-5-5` | Writes each episode. |
| `WRITER_PLAN_MODEL` | `claude-sonnet-5-5` | Season bibles and cast changes. |
| `PORT` | `8787` | Writer proxy port. |
| `SESSIONS_DIR`, `LIBRARY_DIR` | `sessions`, `library` | Where saved and curated shows live. |

The first visit opens the **start screen** (press `N` to reopen it):

- **New series**: Claude creates a cast and writes the first season. You can add an optional name and direction (era, cast, tone) or start from a preset. The direction is saved with the series and steers every writing call.
- **Stored shows**: every series you watch live is saved and plays back from Episode 1 for free, even with the server down. When a stored show runs out, new episodes are written live and saved.
- **Continue** the current show.

Episode N+1 is written while N airs. The footer shows the connection: live (with model names), server up without a key, or not connected.

Keys: `space` pause · `1`–`4` speed (1/2/4/8x) · `←`/`→` previous/next episode · `d` debug panel · `f` fullscreen · `N` shows · `Esc` close the start screen.

URL params (read in `src/main.ts`): `?show=<id>` opens a stored show, `?ep=N` and `?scene=N` jump to an episode and scene (1-based scene), `?play=new|library` and `?id=<id>` select a program, `?direction=` and `?name=` prefill a new series, `?demo` plays the built-in demo episode, and `?seed=N` sets the seed.

### Seasons

A season is 12 episodes. At the start of each season, the plan model writes a **season bible**: a theme, a cast configuration drawn from any era of the show, 3–5 long-term arcs, recurring extras, running gags, and tentpole episodes. Tentpoles come from `data/writer/tentpoles.json` (the Dundies, the Christmas party, Halloween, and so on), and the finale is always the last episode of the season.

## Commands

```bash
npm run pregen -- --direction "…" --name "…" --episodes 12   # or --seasons 1
npm run pregen -- --show <id> --episodes 5                  # extend a stored show
npm run library                                             # list stored shows
npm run library -- add <id>                                 # copy a saved show into library/
npm run preview -- --show <id> --ep 3 [--quiet]             # headless transcript -> sessions/<id>/ep-003.md
```

`pregen` prints calls, tokens, and estimated cost when it finishes. Rough costs: an episode on Haiku is about $0.01–0.02, and a season bible on Sonnet about $0.04.

Saved shows live in `sessions/<id>/` (git-ignored). Curated shows live in `library/<id>/` (committed). `library/` is bundled into the GitHub Pages build by `.github/workflows/pages.yml`, which runs on push to `master`. To publish a show, pregen it, run `npm run library -- add <id>`, then commit `library/`.

### Rendering videos

```bash
npm run render -- --show <id> --ep 3                         # one episode -> renders/<id>-s1e03.mp4
npm run render -- --show <id> --ep 3 --scene 2               # one scene (a clip)
npm run render -- --show <id> --season 1                     # every stored episode of a season
npm run render -- --show <id> --ep 12 --format vertical      # 1080x1920 for Shorts/Reels
```

Options: `--demo`, `--fps 24` (default 30), `--out renders`. The renderer steps the deterministic show frame by frame in headless Chromium and pipes frames to ffmpeg. It needs `ffmpeg` on the PATH and Chrome or Chromium; set `CHROMIUM_PATH` if it isn't found.

## Tuning the writing without code

- `data/writer/style.md`: tone, voices, episode shape.
- `data/writer/constraints.md`: what the engine can stage. `{{SETS}}` is filled in from the set files.
- `data/writer/format.md`: beat shapes.
- `data/writer/directives.json`: random weekly nudges (two per episode, seeded).
- `data/writer/tentpoles.json`: special episodes and `seasonLength` (12).
- `src/writer/validate.ts`: repair caps (camera looks, talking heads per scene) are constants at the top of the file.

Model output that needed repairs is saved to `sessions/failures/` for prompt tuning. Only an unplayable result pays for a retry.

## Floor plans and cast

- `data/sets/*.txt` are hand-editable ASCII maps. The file name is the set id. See `data/sets/README.md` for the header format and tile legend.
- Labels become regions (`MICHAEL'S OFFICE` becomes `michael_office`). Header-declared characters are seats, standing spots, and exits.
- `npm test` checks that every spot and region the writer relies on exists.
- `data/cast.json` defines each character: glyph, color, job title, seasons, desk, voice, and quirks. Characters are colored letters, with case used to tell apart pairs like `M` (Michael) and `m` (Meredith).

## How it works

Three layers. The writer decides **what** happens; the engine decides **how**.

1. **Writer** (`server/writer.ts`, `src/writer/`, `src/schema/`): Claude fills a tool with flat beats split by scene markers, which are converted into a nested episode. Parsing is lenient: broken beats are dropped individually rather than failing the whole episode.
2. **Director** (`src/choreo/director.ts`): turns beats into coroutines over actor primitives (walk, say, act), handling blocking rules and ambient office life.
3. **Engine** (`src/engine/`): a fixed-step 60 Hz scheduler with seeded randomness. The same episode always plays identically, which is what makes jumping to a moment and rendering video possible.

Series state (roster, relationships, gags, notes, arcs, story so far) lives in `src/world/` and is rebuilt purely by replaying stored episodes. Views (`src/view/`) subscribe to engine events. The ASCII view is the only one for now. Sprite views are planned, and a new renderer can replace it without touching the engine or the episodes.

## Tests

```bash
npm test          # Vitest suite, including the floor plan checks
npm run typecheck
```
