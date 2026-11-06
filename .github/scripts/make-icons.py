"""Draws the mrhakan 98 app icons: a Win98 window with joe cool in it.

Usage: python .github/scripts/make-icons.py .   (needs Pillow; the PNGs are committed, so CI never runs this)
Each size is drawn at that size, so the bevels stay one crisp step wide.
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = sys.argv[1]
OUT = os.path.join(ROOT, 'src', 'icons')
os.makedirs(OUT, exist_ok=True)
JOE = Image.open(os.path.join(ROOT, 'src', 'emoj', 'Cursed Pack 1-emojigg-pack', '7161-joe-cool.png')).convert('RGBA')

SPACE = (26, 11, 46, 255)      # #1a0b2e, the theme colour
DEEP = (13, 5, 23, 255)        # #0d0517, the background colour
NEON = (13, 242, 89, 255)      # #0df259
GRAY = (192, 192, 192, 255)
NAVY = (0, 0, 128, 255)
BLUE = (16, 132, 208, 255)


def font(px):
    for f in ('tahomabd.ttf', 'arialbd.ttf'):
        try:
            return ImageFont.truetype(os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts', f), px)
        except OSError:
            pass
    return ImageFont.load_default()


def bevel(d, box, w, inset=False):
    l, t, r, b = box
    hi, lo = ((128, 128, 128, 255), (255, 255, 255, 255)) if inset else ((255, 255, 255, 255), (64, 64, 64, 255))
    for i in range(w):
        d.line([(l + i, b - i), (l + i, t + i), (r - i, t + i)], fill=hi)
        d.line([(l + i, b - i), (r - i, b - i), (r - i, t + i)], fill=lo)


def stars(d, box, n, seed, size):
    rnd = random.Random(seed)
    l, t, r, b = box
    for k in range(n):
        x, y = rnd.randint(l, r), rnd.randint(t, b)
        s = max(1, round(size * (2 if k % 5 == 0 else 1)))
        d.rectangle([x, y, x + s - 1, y + s - 1], fill=NEON if k % 6 == 0 else (255, 255, 255, 200))


def window(img, box, unit):
    """A Win98 window filling box. unit is one 'pixel' of the frame."""
    d = ImageDraw.Draw(img)
    l, t, r, b = box
    u = max(1, round(unit))
    # the hard Win98 drop shadow
    d.rectangle([l + 3 * u, t + 3 * u, r + 3 * u, b + 3 * u], fill=(0, 0, 0, 150))
    d.rectangle(box, fill=GRAY)
    bevel(d, box, u)
    # title bar, a navy to blue ramp
    tl, tt, tr = l + 2 * u, t + 2 * u, r - 2 * u
    tb = tt + round((b - t) * 0.16)
    for x in range(tl, tr + 1):
        # in even steps, the way a 256 colour desktop drew it
        f = min(7, int((x - tl) / max(1, tr - tl + 1) * 8)) / 7
        d.line([(x, tt), (x, tb)], fill=tuple(round(NAVY[i] + (BLUE[i] - NAVY[i]) * f) for i in range(3)) + (255,))
    th = tb - tt
    fnt = font(max(8, round(th * 0.72)))
    d.text((tl + round(th * 0.3), tt + th / 2), '98', font=fnt, fill=(255, 255, 255, 255), anchor='lm')
    # three title buttons
    bw = round(th * 0.78)
    for i in range(3):
        bx = tr - round(th * 0.12) - (i + 1) * bw - i * u
        by = tt + (th - bw) // 2
        d.rectangle([bx, by, bx + bw, by + bw], fill=GRAY)
        bevel(d, [bx, by, bx + bw, by + bw], max(1, u // 2 or 1))
    cx = tr - round(th * 0.12) - bw
    m = max(1, round(bw * 0.25))
    by = tt + (th - bw) // 2
    lw = max(1, u)
    # minimise: a bar at the bottom. maximise: a box with a thick top
    mx = tr - round(th * 0.12) - 3 * bw - 2 * u
    d.rectangle([mx + m, by + bw - m - lw, mx + bw - m - 1, by + bw - m], fill=(0, 0, 0, 255))
    xx = tr - round(th * 0.12) - 2 * bw - u
    d.rectangle([xx + m, by + m, xx + bw - m, by + bw - m], outline=(0, 0, 0, 255), width=lw)
    d.rectangle([xx + m, by + m, xx + bw - m, by + m + lw], fill=(0, 0, 0, 255))
    d.line([(cx + m, by + m), (cx + bw - m, by + bw - m)], fill=(0, 0, 0, 255), width=max(1, u))
    d.line([(cx + bw - m, by + m), (cx + m, by + bw - m)], fill=(0, 0, 0, 255), width=max(1, u))
    # the client area: the site's night sky
    cl, ct, cr, cb = l + 4 * u, tb + 2 * u, r - 4 * u, b - 4 * u
    d.rectangle([cl, ct, cr, cb], fill=SPACE)
    bevel(d, [cl - u, ct - u, cr + u, cb + u], u, inset=True)
    stars(d, [cl + u, ct + u, cr - 2 * u, cb - 2 * u], 26, 98, unit * 0.9)
    return (cl, ct, cr, cb)


def place_joe(img, area, frac):
    cl, ct, cr, cb = area
    h = round((cb - ct) * frac)
    w = round(h * JOE.width / JOE.height)
    # nearest neighbour above the source size: the pixels are the point
    face = JOE.resize((w, h), Image.NEAREST if h >= JOE.height * 1.5 else Image.LANCZOS)
    img.alpha_composite(face, ((cl + cr - w) // 2, (ct + cb - h) // 2 + round((cb - ct) * 0.03)))


def icon_any(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    unit = size / 128
    pad = round(size * 0.06)
    area = window(img, [pad, pad + round(size * 0.04), size - pad - round(4 * unit), size - pad - round(size * 0.02)], unit)
    place_joe(img, area, 0.78)
    return img


def icon_full(size):
    """Full bleed, everything inside the maskable safe circle (radius 40%)."""
    img = Image.new('RGBA', (size, size), DEEP)
    d = ImageDraw.Draw(img)
    stars(d, [0, 0, size - 1, size - 1], 40, 7, size / 170)
    unit = size / 200
    half = round(size * 0.27)
    c = size // 2
    area = window(img, [c - half, c - round(half * 0.92), c + half, c + round(half * 0.92)], unit)
    place_joe(img, area, 0.78)
    return img


def save(img, name, opaque=False):
    path = os.path.join(OUT, name)
    out = img.convert('RGB') if opaque else img
    # 256 colours, like the desktop it comes from, at a third of the bytes
    out = out.quantize(colors=256, method=Image.Quantize.MEDIANCUT if opaque else Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    out.save(path, optimize=True)
    print(name, img.size, os.path.getsize(path), 'bytes')


save(icon_any(192), 'icon-192.png')
save(icon_any(512), 'icon-512.png')
save(icon_full(192), 'maskable-192.png', opaque=True)
save(icon_full(512), 'maskable-512.png', opaque=True)
save(icon_full(180), 'apple-touch-180.png', opaque=True)
