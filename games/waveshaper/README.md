# WAVESHAPER 98

An independent browser remake inspired by **WAVESHAPER** by GAMES FOR HUMANS.
All code, canvas art and synthesized audio here are original. No original game
files, sprites or soundtrack are included.

Read the closest visible bend and press its shape/direction before it reaches
the receiver. W / S clear square up/down; Up / Down clear triangle up/down.
One press clears one bend immediately. Holding a button does not repeat. A wrong
input costs a life and leaves the bend; letting a bend reach the receiver also
costs a life. Simultaneous gamepad buttons produce one attempt, and a short
cooldown after damage prevents four-button mashing from clearing the queue.

Normal has four lives, accelerates with score, and heals one life every twenty
consecutive matches. Hard starts faster with one life. Practice has fixed speed,
unlimited attempts and no saved high score. Normal and Hard records are local
and separate. This remake's modes, balancing and audio are tuned for the web.

Standard gamepads: LB/LT for squares, RB/RT for triangles; Xbox Y/A and X/B are
alternatives. Start/Menu starts or pauses. Touch has the same four actions.
Blur, hidden tabs and a disconnected controller pause the run. Reduced motion
disables cosmetic particles and pulses while keeping the playable wave.

`waveshaper-sim.js` owns the rules, seeded wave generation and standard gamepad
mapping; `waveshaper.js` owns input, canvas, audio, menus and optional storage.
Run `node .github/scripts/check-waveshaper.mjs` from the repository root.

Research references:

- [Original Steam page](https://store.steampowered.com/app/562260/WAVESHAPER/)
- [Four-button control guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3020722689)
- [Gameplay reference](https://www.youtube.com/watch?v=uhcMOeK8_B8)

This is an extra release (`daily: false` in the Playground catalog), separate
from the existing paired daily game/app drops.
