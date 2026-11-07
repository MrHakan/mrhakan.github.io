"""tp-tower-art.py -- the troll problem's towers and projectiles, from the approved pngs

The towers were drawn as 1254 x 1254 pngs (troll-problem-towers/PROMPTS.md has the
prompts), one per tower and upgrade path, plus a projectile for each tower that
throws something. The game draws a tower about 56 pixels tall and a projectile
about 26 across, so this cuts each one to what is actually drawn, scales it down
and writes a webp:

    games/troll-problem/art/NN-name-{base,a,b}.webp    towers, 160 px on the long side
    games/troll-problem/art/NN-name-projectile.webp    projectiles, 64 px on the long side

The pngs have a haze of nearly invisible pixels round the edges (alpha 1 to 8),
which would make the crop the whole canvas, so those are cleared first.

A tower stands on a round base seen at an angle. Where that base is, and how wide,
is what the game needs to put the tower on the spot that was clicked and to size
it to its footprint, so this finds it: the widest row in the bottom of the
picture is the middle of the base. Those numbers go into the block between the
markers in games/troll-problem/troll-problem-data.js. Like the other generated
files here, the output is committed and nothing runs on deploy.

    python .github/scripts/tp-tower-art.py <folder with the 39 pngs>

Needs Pillow.
"""
import json, os, re, sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'troll-problem-towers'
OUT = 'games/troll-problem/art'
DATA = 'games/troll-problem/troll-problem-data.js'
TOWER = 160
PROJ = 64
QUALITY = 84
HAZE = 8          # alpha at or below this is the generator's haze, not the drawing
NAMES = ['01-pointer-post', '02-floppy-launcher', '03-cooling-fan', '04-overclocked-cpu', '05-dial-up-modem',
         '06-fax-machine', '07-recycle-bin-catapult', '08-spam-folder', '09-paperclip-helper', '10-ban-hammer']
LOOKS = ['base', 'a', 'b']


def clean(path):
    im = Image.open(path).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 0 if v <= HAZE else v)
    im.putalpha(a)
    box = a.getbbox()
    if not box:
        raise SystemExit(path + ': nothing in it')
    # a pixel of air round the edge, so the scaled edge is not cut
    pad = 6
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
    return im.crop(box)


def base_of(im):
    """the widest row of solid pixels in the bottom 30 percent: the middle of the round base"""
    a = im.getchannel('A')
    w, h = im.size
    px = a.load()
    best, rows = 0, []
    for y in range(int(h * 0.70), h):
        left = next((x for x in range(w) if px[x, y] > 128), None)
        if left is None:
            continue
        right = next(x for x in range(w - 1, -1, -1) if px[x, y] > 128)
        rows.append((y, left, right))
        best = max(best, right - left)
    wide = [r for r in rows if r[2] - r[1] >= best * 0.97]
    ay = sum(r[0] for r in wide) / len(wide)
    ax = sum((r[1] + r[2]) / 2 for r in wide) / len(wide)
    return ax, ay, best / 2


def fit(im, side):
    k = side / max(im.size)
    size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
    # premultiplied, or the transparent pixels' colour bleeds into the edges
    return im.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA'), k


os.makedirs(OUT, exist_ok=True)
meta = {}
total = 0
for name in NAMES:
    entry = {}
    for look in LOOKS:
        im = clean(os.path.join(SRC, name + '-' + look + '.png'))
        ax, ay, br = base_of(im)
        small, k = fit(im, TOWER)
        small.save(os.path.join(OUT, name + '-' + look + '.webp'), 'WEBP', quality=QUALITY, method=6)
        total += os.path.getsize(os.path.join(OUT, name + '-' + look + '.webp'))
        # where the base's middle is, and its radius, in the webp's pixels
        entry[look] = {'w': small.width, 'h': small.height, 'ax': round(ax * k, 1), 'ay': round(ay * k, 1), 'r': round(br * k, 1)}
    proj = os.path.join(SRC, name + '-projectile.png')
    if os.path.exists(proj):
        small, k = fit(clean(proj), PROJ)
        small.save(os.path.join(OUT, name + '-projectile.webp'), 'WEBP', quality=QUALITY, method=6)
        total += os.path.getsize(os.path.join(OUT, name + '-projectile.webp'))
        entry['shot'] = {'w': small.width, 'h': small.height}
    meta[name] = entry

block = 'TP.ART = ' + json.dumps(meta, separators=(',', ':')) + ';'
src = open(DATA, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in src else '\n'
start, end = '// <tp-art>', '// </tp-art>'
if start not in src:
    raise SystemExit(DATA + ' has no ' + start + ' block')
src = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda m: start + nl + block + nl + end, src, flags=re.S)
open(DATA, 'w', encoding='utf-8', newline='').write(src)
print('wrote %d images, %d kb, and the bases into %s' % (len(os.listdir(OUT)), total // 1024, DATA))
