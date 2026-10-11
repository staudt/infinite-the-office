# Format: how to fill the write_episode tool
<!-- Loaded into the episode system prompt. Field names here must match src/schema/episode.ts. -->

Call `write_episode` exactly once with the complete episode. `beats` is ONE flat, ordered list for the whole episode. Every scene starts with a scene marker, followed by that scene's beats:

```
{ "type": "scene", "part": "cold_open|act1|act2|tag", "plot": "cold_open|A|B|C|tag", "set": "office|break_room|parking_lot|warehouse|offsite", "region": "bullpen", "venue": "", "present": ["jim","pam"], "recap": "One sentence: what happens in this scene" }
```

Beat shapes (use exactly these field names; `who` is always a character id, never a name):

```
{ "type": "say", "who": "michael", "text": "One short line.", "to": "pam", "mood": "excited" }
{ "type": "talking_head", "who": "jim", "lines": ["One to three short lines to the camera."], "mood": "deadpan" }
{ "type": "move", "who": "dwight", "to": "copier", "pace": "walk|hurry|sneak" }
{ "type": "enter", "who": ["dwight"], "to": "dwight_desk" }
{ "type": "exit", "who": ["angela"], "how": "walk|storm_off|sneak|run" }
{ "type": "gather", "who": ["everyone"], "to": "conference_room" }
{ "type": "sit", "who": ["jim"] }
{ "type": "stand", "who": ["jim"] }
{ "type": "react", "who": ["jim"], "reaction": "look_at_camera|eye_roll|laugh|facepalm|stare|sigh|gasp|cringe|shrug|cheer" }
{ "type": "action", "who": "jim", "verb": "prank|phone_call|typing|eat|drink|hide|snoop|present|dance|sing|fall|hug|high_five|search|sleep|copy", "target": "dwight", "caption": "puts Dwight's stapler in Jell-O" }
{ "type": "pause", "seconds": 2, "caption": "awkward silence" }
{ "type": "caption", "text": "LATER" }
```

An `action` caption is a stage direction WITHOUT the actor's name, starting with a verb (the show prepends the name): "slides Dwight's stapler into lime Jell-O", not "Jim slides...".

`to` in `say` is a character id, "all" or "none". Moods: neutral, happy, excited, awkward, annoyed, angry, sad, smug, nervous, deadpan, sarcastic, panicked.

## Episode-level fields
- `outline`: FILL THIS FIRST, before the beats. Under 80 words: one line each for the A, B and C plots (naming who drives each), then the scene order by plot label, e.g. `A: Michael wants a girlfriend; B: Dwight's parking war; C: Kevin's chili. Order: cold, A, B, A, C, B, A, B, A, tag`.
- `plot` on every scene marker: `cold_open`, `A`, `B`, `C` or `tag`.
- `title`: a short, funny title (no "Episode N"). `logline`: one sentence for the whole episode. `theme`: the unstated theme.
- `storySoFar`: the UPDATED running summary of all ongoing storylines in under 150 words, as of the end of this episode.
- `extras`: only when you introduce a new recurring side character: `{ "id": "gary", "name": "Gary Trundle", "title": "Owner, Trundle Storage", "voice": "how they talk" }`. Then use their id in beats.
- `stateChanges`: what changed, so the next writer remembers. Each is one of:
  `{ "type": "relationship", "a": "jim", "b": "pam", "status": "dating" }`,
  `{ "type": "note", "text": "a setup to pay off later" }`,
  `{ "type": "gag", "text": "a running gag used or started" }`,
  `{ "type": "arc", "arc": "<exact arc name from the bible>", "progress": "where it stands now" }`.
  Record every arc that moved this episode, and any relationship that changed.
