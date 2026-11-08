# WAVESHAPER 98

An independent browser remake inspired by WAVESHAPER by GAMES FOR HUMANS.
All code, canvas art and synthesized audio are original.

Open it from the desktop Start menu, the Playground card, search, the Run box,
or `/?app=waveshaper`. The old `/games/waveshaper/` URL redirects into the
same desktop. The native app window owns dragging, minimize, maximize,
fullscreen and the taskbar. Closing it unloads the game and its audio;
minimizing pauses the run. The game is isolated in a same-origin frame so its
keyboard shortcuts and styles cannot interfere with other desktop apps.

W / S match square up/down; Up / Down match triangle up/down. Press only when
the bend's centre overlaps the shaded target (28 logical pixels either side
of the receiver). A correct hit scores one. Early input, a wrong shape at the
target, or a missed bend costs one of four lives. A wrong shape consumes that
bend, so it cannot also cost another life as a miss. Holding never repeats.
A 200ms damage cooldown prevents one simultaneous input from burning all lives.

There is one run type. Speed starts at 235 logical pixels/second, gains 5 per
correct hit up to 620, and loses 40% of its current value per mistake, down to
140. The score is preserved. A subsequent hit increases the reduced speed;
it does not jump back to a speed calculated from the total score. Twenty
consecutive hits restore one life. Timing scores use a new local save key
because the untimed prototype's records are not comparable.

Gamepads: LB/LT = square up/down, RB/RT = triangle up/down; Y/A and X/B are
alternatives. Start/Menu starts or pauses. Touch has the same four actions.
Blur, hidden tabs and a disconnected controller pause the run. Unfocused
frames do not consume gamepad input. Reduced motion removes cosmetic particles.

Run from the repo root:

- `node .github/scripts/check-waveshaper.mjs`
- `SITE_URL=http://127.0.0.1:8095 node .github/scripts/browser-waveshaper.mjs`

References: [original game](https://store.steampowered.com/app/562260/WAVESHAPER/),
[control guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3020722689),
[gameplay](https://www.youtube.com/watch?v=uhcMOeK8_B8).
