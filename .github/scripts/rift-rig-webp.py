"""rift-rig-webp.py -- Brawlz 98's runtime fighter atlases, as webp

prepare-rift-art.mjs writes each fighter's 512 x 512 attachment atlas as a
lossless png. The game finds every part in an atlas by its alpha (rift-art.js),
so the alpha has to come through untouched. A browser's own webp encoder
compresses alpha lossily and moved a couple of hundred edge pixels per fighter.
libwebp with alpha_quality=100 keeps it exact, and the colour at quality 90
is about a sixth the size of the png.

The pngs stay in the repo as the source of truth and .pagesignore keeps them
off the site. Run this after prepare-rift-art.mjs:

    python .github/scripts/rift-rig-webp.py

Needs Pillow. It refuses to write a webp whose alpha differs from its png.
"""
import glob, os, sys
from PIL import Image

ART = 'games/rift-rumble/art'
total_png = total_webp = 0
for png in sorted(glob.glob(os.path.join(ART, 'rig-*.png'))):
    webp = png[:-4] + '.webp'
    im = Image.open(png).convert('RGBA')
    if im.size != (512, 512):
        sys.exit(png + ': expected 512 x 512, found %d x %d' % im.size)
    im.save(webp, 'WEBP', quality=90, alpha_quality=100, method=6, exact=True)
    back = Image.open(webp).convert('RGBA')
    if back.getchannel('A').tobytes() != im.getchannel('A').tobytes():
        os.remove(webp)
        sys.exit(webp + ': the alpha did not survive, and the game finds its parts by it')
    total_png += os.path.getsize(png)
    total_webp += os.path.getsize(webp)
    print('%s: %d KiB' % (os.path.basename(webp), os.path.getsize(webp) // 1024))
print('%d KiB of png became %d KiB of webp, alpha identical' % (total_png // 1024, total_webp // 1024))
