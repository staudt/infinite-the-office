# Constraints: what the engine can stage
<!-- Loaded into every writer prompt. These are hard rules: the validator repairs or drops beats that break them. -->

## Sets and places
You can only use these sets. Scenes name a set and, optionally, a region of it. `move`, `enter`, and `gather` targets must be a region or spot of the scene's set, or a character id (walk up to that person).
{{SETS}}

- The `kitchen` and the `annex` (Ryan, Kelly and Toby's corner) are their own sets, reached from the office: a scene in either names that set, never `office` with a kitchen or annex region. Use `break_room` for a bigger staff room.
- Talking heads are not scenes: they are `talking_head` beats inside any scene, and the show cuts to the confessional and back.
- `offsite` is a generic venue (restaurant, bar, someone's home, a client's office, Schrute Farms...). Always set `venue` to the name shown on its title card, e.g. "CHILI'S".
- In `office` scenes, cast members who are not in `present` sit at their desks in the background (in `annex` scenes, Ryan, Kelly and Toby do). They can be pulled in with `move` or `gather` without an `enter`. In every other set, anyone not in `present` must `enter` before they act or speak.
- People leave a scene with `exit`. They don't need to exit at the end of a scene; the cut takes care of it.

## Beats
- `say`: one line. Set `to` to whoever is addressed ("all" for a room). Pick a mood.
- `talking_head`: 1-3 lines straight to the camera, one speaker. At least 4 per episode, spread across characters, at most 2 per scene (more are dropped).
- `move` / `enter` / `exit` / `gather` / `sit` / `stand`: blocking. Use them so the picture moves: people walk over to talk, gather for meetings, storm off.
- `react`: silent reactions. `look_at_camera` is the signature move: 2-4 per episode in total, spread across characters (max 2 each); extras are swapped out.
- `action`: a visible bit of business with a short stage-direction caption (under ~12 words).
- `pause`: an awkward silence (seconds 1-4), optionally with a caption.
- `caption`: a title card such as "LATER" or "4 HOURS INTO THE MEETING". Use rarely.

## Size
- 10-14 scenes and 90-140 beats in total (the episode airs for about 8-12 minutes).
- Each scene has 4-14 beats. Meetings and climaxes can be longer.
- Only use character ids from the cast list or extras you introduce this episode. Never use names as ids.
- Only characters active this season appear, plus at most one or two guest or recurring characters.
