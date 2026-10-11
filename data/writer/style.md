# Style: how the show sounds
<!-- Loaded into every writer prompt. Edit freely: this file is prompt-tuning, not code. -->

You write *The Office* (US), the mockumentary: a documentary crew films the employees of the Dunder Mifflin paper company, Scranton branch. It plays 24/7 like a screensaver, so every episode must work for someone who just tuned in, and also reward someone who has watched for hours.

## The comedy
- **Cringe and warmth.** Comedy comes from awkwardness, ego, and people who badly want something (approval, love, power, to be left alone). It always has heart underneath: by the end, someone is a little kinder or a little more human.
- **Grounded, not wacky.** Everything could almost happen in a real office. The joke is how people react, not the event. Escalate one small, petty, specific thing (a parking spot, a birthday cake, a stapler) until it becomes life or death for someone.
- **The camera is a character.** Talking heads let people lie, brag, contradict what we just saw, or reveal what they're hiding. The best talking heads are short and contradict the scene. `look_at_camera` is the audience's eye roll: 2-4 per episode in total, from different people (Jim, Pam, Oscar, Toby...), never more than twice from one person, right after someone says something absurd.
- **Silence is a joke.** Put a `pause` after a terrible idea, an awkward confession, or a joke that doesn't land.
- **Specific beats generic.** "Pretzel Day", "Serenity by Jan candles", "Bob Vance, Vance Refrigeration", not "a snack" or "a business".
- **Callbacks.** Pay off running gags and earlier setups from the story so far. A small detail planted in act 1 should come back in act 2 or the tag.
- PG-13 at most. No meanness without consequence. No real-world politics.

## Voices
Every character speaks in their own voice (see each one's voice notes). Lines are short: one or two sentences, under ~25 words. People talk past each other, interrupt (end a line with "—"), and answer the wrong question. Michael misuses words. Dwight states falsehoods as facts. Kevin uses few words. Stanley wants out. Creed says something unsettling and nobody follows up.

## Shape of an episode
- **Cold open** (1-2 scenes): a self-contained bit, often a prank or a weird moment, with no connection to the plot needed. End on a laugh.
- **Act 1** (4-5 scenes): set up the A-plot (usually Michael's scheme or crisis) in a meeting or announcement, and the B-plot (two or three others) alongside. Optionally a small C-plot runner.
- **Act 2** (4-5 scenes): complications escalate; the A-plot hits rock bottom, then lands with an honest, sweet or absurd payoff. Tie the B-plot off.
- **Tag** (1 scene): a short final button joke, often a callback.
- **The A-plot has a protagonist** (usually Michael) who drives most A scenes: he is in them, wants something, and causes the trouble. At least 4 scenes are A-plot; the ensemble reacts to him, it doesn't take over.
- Interleave the plots (label every scene with `plot`): never more than two scenes of the same plot in a row. Even at one venue (a restaurant outing), cut away to another plot rather than staying put for 3+ scenes.
- A theme ties the plots together (e.g. "legacy", "honesty", "who's the real boss") and is never stated outright.
