# Brawlz 98 fighter art

Created with the built-in **imagegen** tool, using the site's own local cursed emoji
images as facial reference. The selected original PNG outputs are copied into this
directory, preserving their alpha channels. All game art is served locally.

Each atlas has **four equal columns** (idle, run, jump, attack) and **three equal
rows**. `rift-art.js` locates each frame and its opaque foot baseline, then renders
it without smoothing. The runtime adds direction mirroring, breathing, running
motion, attack wind-up, hit reaction, dodge afterimages and impact effects. Reduced
motion stops ambient animation and camera shake.

| Atlas | Rows, in order | Local reference images |
| --- | --- | --- |
| `fighters-1.png` | Joe Cool, Dusung, Hothead | `joe-cool-114.webp`, `dusung-288.webp`, `hot-40.webp` |
| `fighters-2.png` | Bebetrol, Zirlak, Hehe | `bebetrol.png`, `pffft.png` |
| `fighters-3.png` | Nasiya, Patron, Sahur | `nasiya.png`, `patronedasiyla.png`, `sahurdudimi.png` |
| `fighters-4.png` | Oleey, Yeter, Pffft | `oleyy.png`, `yeterartik.png`, `heh.png` |

The generation prompt set follows. Reference images were explicitly described as
facial inspiration, not editing targets.

## Shared prompt

Use case: stylized-concept. Production 2D pixel-art GAME SPRITE ATLAS, genuinely
transparent alpha background. Exactly 4 equal columns x 3 equal rows on a regular
4:3 landscape grid. One full-body fighter per cell, centered with generous transparent
margins, feet baseline 88% cell height, character occupies at most 76% cell height.
All twelve sprites at the same scale. No text, labels, grid lines, shadows, floor or
scenery. Facing right in all poses. Deliberate low-resolution arcade pixel clusters,
1–2 pixel dark outlines, detailed expressive cursed internet meme faces, shaded
late-1990s fighting-game pixel art, muted gold/ivory/navy/plum palettes. Every row is
a different custom complete original fighter; the four columns are respectively
idle ready stance, running right with separated legs, airborne jump right with knees
tucked, and attack lunging right with extended weapon/fist. Consistent identity and
outfit throughout each row. Supplied local images are facial inspiration references.

## Atlas 1 subjects

Joe Cool: oversized mustard-yellow meme head, reflective black sunglasses, cocky
smirk, navy biker jacket, brass chain weapon and chunky boots. Dusung: ivory
asymmetric thinking meme face, raised brow, chin-resting hand, lanky purple longcoat,
wooden question-mark cane and worn boots. Hothead: orange-yellow panicked eyes,
sweating cheeks, red boxing wraps, sleeveless burnt-red jacket, brass gauntlets,
black shorts and red boots. Each has idle, running, airborne and forward melee poses.

## Atlas 2 subjects

Bebetrol: ivory trollface, huge mischievous toothy grin, squinty eyes, tiny stocky
body in teal overalls and diaper, yellow propeller cap and oversized red prank
mallet. Zirlak: mustard-yellow distressed crying head, watery eyes and blue tears,
blue hooded jacket, tissue box, small fists and white sneakers. Hehe: ivory smug
head, half-lidded sideways eyes and wide toothy grin, olive surplus vest, cargo
trousers, short silver dagger and boots. Hand-crafted expressive pixel sprites.

## Atlas 3 subjects

Nasiya: ivory confused asymmetric meme face, one giant eye and one squinty eye,
crooked mouth, raised brow, mauve jacket, shrugging arms, red rubber plunger and
scuffed shoes. Patron: ivory stern businessman meme face, slick charcoal hair,
black-rim spectacles, thin moustache, navy suit, red tie, brown briefcase weapon and
polished shoes. Sahur: tired ivory half-lidded face, deep eye bags, crooked purple
nightcap, striped plum pajamas, large cream pillow weapon and worn slippers.

## Atlas 4 subjects

Oleey: ecstatic yellow open-mouth face, excited eyes, orange headphones and red
headband, tan varsity jacket over red shirt, black athletic shorts, red sneakers and
wooden baseball bat. Yeter: off-white exhausted angry troll face, frown lines,
bloodshot eyes, clenched teeth, teal tracksuit, fingerless gloves, steel ban hammer
with a red X and black boots. Pffft: mustard-yellow puffed-cheek annoyed face,
angled brows, puckered lips, olive padded jacket, brass gauntlets, stocky body, dark
cargo trousers and chunky boots. Strong comic personality and distinct silhouettes.
