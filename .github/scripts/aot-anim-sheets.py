"""aot-anim-sheets.py -- Age of Troll's animations, from the approved gifs

The animations were drawn as pose sheets, exported to gifs and approved in a
gallery outside this repo. The game wants something it can cut frames from
cheaply, so this turns each gif back into one 4 x 4 sheet: every frame cut to
the same box for a character's walk, attack and death, so the troll does not
jump between them, then scaled to the size the lane draws it at.

It writes games/age-of-troll/anim/*.webp and the frame boxes into the block
between the markers in games/age-of-troll/age-of-troll-data.js. Like the other
generated files here, the output is committed and nothing runs on deploy.

    python .github/scripts/aot-anim-sheets.py <folder with the 53 gifs>

Needs Pillow.
"""
import json, os, re, sys
from PIL import Image, ImageSequence

SRC = sys.argv[1] if len(sys.argv) > 1 else 'age-of-troll-emojis/refined'
OUT = 'games/age-of-troll/anim'
DATA = 'games/age-of-troll/age-of-troll-data.js'
CELL = 96          # a troll is drawn at 43 to 74 css pixels, on a zoomed 2560 screen about 110
CELL_BOSS = 192    # the king is drawn at 110
PROJ = 48
QUALITY = 82
CHARS = ['01-he', '02-hello', '03-hot', '04-joe-fight', '05-joe-cool', '06-joe-angry', '07-joe-murder',
         '08-joe-chef', '09-lesgooo', '10-pffft', '11-nasiya', '12-ingaaa', '13-xd-troll', '14-trollface',
         '15-patron-edasiyla', '16-the-troll-king']
BODY = ['walk', 'attack', 'death']


def frames(path):
    im = Image.open(path)
    out = []
    for f in ImageSequence.Iterator(im):
        out.append(f.convert('RGBA'))
    if len(out) != 16:
        raise SystemExit(path + ': expected 16 frames, found ' + str(len(out)))
    return out


def union_box(seqs):
    box = None
    for seq in seqs:
        for f in seq:
            b = f.getchannel('A').getbbox()
            if not b:
                continue
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def sheet(seq, box, cell):
    """16 frames cut to box, scaled into cell x cell keeping the aspect, feet on the floor"""
    bw, bh = box[2] - box[0], box[3] - box[1]
    k = cell / max(bw, bh)
    w, h = max(1, round(bw * k)), max(1, round(bh * k))
    out = Image.new('RGBA', (cell * 4, cell * 4), (0, 0, 0, 0))
    for i, f in enumerate(seq):
        # premultiplied, or the transparent pixels' colour bleeds into the edges
        part = f.crop(box).convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
        x = (i % 4) * cell + (cell - w) // 2
        y = (i // 4) * cell + (cell - h)
        out.paste(part, (x, y), part)
    return out, w / cell, h / cell


os.makedirs(OUT, exist_ok=True)
meta = {}
total = 0
for ch in CHARS:
    cell = CELL_BOSS if ch.startswith('16-') else CELL
    seqs = {a: frames(os.path.join(SRC, ch + '-' + a + '.gif')) for a in BODY}
    box = union_box(seqs.values())
    entry = {'cell': cell}
    for a in BODY:
        img, fw, fh = sheet(seqs[a], box, cell)
        name = ch + '-' + a + '.webp'
        img.save(os.path.join(OUT, name), 'WEBP', quality=QUALITY, method=6)
        total += os.path.getsize(os.path.join(OUT, name))
        entry['w'], entry['h'] = round(fw, 3), round(fh, 3)
    proj = os.path.join(SRC, ch + '-projectile.gif')
    if os.path.exists(proj):
        seq = frames(proj)
        img, fw, fh = sheet(seq, union_box([seq]), PROJ)
        img.save(os.path.join(OUT, ch + '-projectile.webp'), 'WEBP', quality=QUALITY, method=6)
        total += os.path.getsize(os.path.join(OUT, ch + '-projectile.webp'))
        entry['shot'] = {'cell': PROJ, 'w': round(fw, 3), 'h': round(fh, 3)}
    meta[ch] = entry

block = 'AOT.ANIM = ' + json.dumps(meta, separators=(',', ':')) + ';'
src = open(DATA, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in src else '\n'
start, end = '// <aot-anim>', '// </aot-anim>'
if start not in src:
    raise SystemExit(DATA + ' has no ' + start + ' block')
src = re.sub(re.escape(start) + r'.*?' + re.escape(end),
             lambda m: start + nl + '    ' + block + nl + '    ' + end, src, flags=re.S)
open(DATA, 'w', encoding='utf-8', newline='').write(src)
print('wrote %d sheets, %d kb, and the frame boxes into %s' % (len(os.listdir(OUT)), total // 1024, DATA))
