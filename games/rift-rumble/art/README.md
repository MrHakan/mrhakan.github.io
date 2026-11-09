# Brawlz 98 cutout fighters

The game uses twelve original emoji-inspired fighters with **16 separate rigid
bitmap attachments each**, animated by the project's Canvas skeletal runtime.
There are no whole-body animation frames, texture warps or static face patches.

## Art and layout

The built-in imagegen tool created `cutout-<name>.png`, using the existing fighter
designs as identity references. Joe Cool was the rig pilot; his part layout was
then supplied as the template for the other eleven characters. The prompts and
file mapping are recorded in [cutout-prompts.json](cutout-prompts.json).
Original imagegen outputs are preserved outside the project as well.

Each raw source is a 4×4 grid:

| Row | Column 1 | Column 2 | Column 3 | Column 4 |
| --- | --- | --- | --- | --- |
| 1 | Head, including hat/hair | Torso | Pelvis | Weapon, grip left |
| 2 | Front upper arm | Front forearm | Back upper arm | Back forearm |
| 3 | Front thigh | Front shin | Back thigh | Back shin |
| 4 | Front hand | Back hand | Front foot | Back foot |

Limbs point downward in their bind orientation. Feet point right with soles down.
Rounded joint caps overlap adjacent pieces. Hands and feet have their own pivots.
The raw sheets are editable source art; the game never requests them.

The four original `fighters-1.png` to `fighters-4.png` design sheets are retained
as references, in roster order: Joe Cool/Dusung/Hothead, Bebetrol/Zirlak/Hehe,
Nasiya/Patron/Sahur, and Oleey/Yeter/Pffft.

## Preparation

Run `node .github/scripts/prepare-rift-art.mjs` with Playwright Chromium installed,
or set `PW_CHROMIUM` to an installed Chromium executable. `ART_ONLY=joe-cool`
prepares only the pilot. No AI call is required to rebuild the runtime textures.

The script removes disconnected alpha noise, crops each part, and uniformly fits
it into a 128×128 cell. It writes lossless **512×512 `rig-<name>.png` atlases**,
about 3.9 MiB total. The runtime reads the part bounds once after decoding and
draws those attachments with normal Canvas translations and rotations.

## Skeleton and motion

`rift-animation.js` implements a root with pelvis, torso and head; three bones
per arm and per leg; and a weapon attached to the front hand. The 16 visible
attachments follow 17 hierarchical transforms including the invisible root.
Every limb keeps its length. Two-bone IK places the ankles without stretching.
Feet have independent rotation, keeping the sole level during ground contact.

The 112-world-unit gait follows host-owned travel. A foot's stance occupies 42%
of the cycle and moves backward relative to the body at exactly the world
movement speed. Swing targets follow a continuous lifted arc. Brief flight
intervals separate alternating contacts. Torso lean, counter-swinging arms and
small hip motion complete the run; heavier fighters use smaller arm swings.
Patron holds his briefcase higher while running.

Attack anticipation, contact and recovery use each move's actual simulation
windows. The hand aims sideways, upward or downward; the weapon remains attached
to the wrist. Rotation blending takes the shortest path. Action transitions use
short eased blends, bounded by the remaining startup time for responsive attacks.
The head counter-rotates slightly to keep the face readable.

`rift-art.js` handles slot order. The far upper arm stays behind the body, while
its forearm and hand draw over the torso when they move across the chest. The
weapon can pass behind the head during preparation and in front during contact.
Head and clothing use the same rigid textures throughout every pose.

Animation uses the simulation clock, freezes on pause and disables idle breathing
for reduced motion. Host positions interpolate between physics samples so faster
displays do not repeat only the latest 60 Hz position.

## Validation

`check-rift-animation.mjs` covers fixed bone lengths, world-space foot plants,
continuous swing boundaries, bounded IK, 30/60/144 Hz agreement, pause, pose
transitions, aiming and contact timing.
`browser-rift-animation.mjs` checks actual decoded parts, continuous rendered
samples, clipping and floor penetration, and records a motion review with a
bone-overlay option. `browser-rift-rumble.mjs` exercises the real desktop app,
mobile controls and live 1v1/2v2 transports. Reviews are saved in `.ci-shots/`.
Automated geometry checks do not establish perceptual quality; the recorded
run, attack and transition sequences also need visual review.

Design references for the hierarchy and IK concepts:
[Spine bones](https://esotericsoftware.com/spine-bones) and
[Spine IK constraints](https://esotericsoftware.com/spine-ik-constraints).
The implementation is the project's own runtime and does not load Spine.
