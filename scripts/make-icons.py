"""App icons: a still of the game mark, a solved 6x6 Shikaku (the last grid of the
growing-grid loading animation in src/art.ts, same piece layout and colours).

Writes the Android launcher icons and the web favicon / apple-touch icon.
Run from the repository root:  python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw

BG = (0x12, 0x14, 0x1C)
CELL = (0x2A, 0x30, 0x42)
BLUE, PEACH, GREEN = (0x9F, 0xC7, 0xF0), (0xF4, 0xB6, 0xA6), (0xA8, 0xDC, 0xC0)
# the 6x6 partition used by growArt(): (col, row, width, height), colour
PIECES = [((0, 0, 3, 3), BLUE), ((3, 0, 3, 2), PEACH), ((3, 2, 3, 4), GREEN), ((0, 3, 3, 3), BLUE)]
N, CELL_PX, GAP_PX = 6, 9, 2  # art.ts units: a 64-unit grid


def mark(size, span, transparent):
    """Draw the solved 6x6 so the grid spans `span` of the image width."""
    S = 4
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0) if transparent else BG + (255,))
    d = ImageDraw.Draw(img)
    grid = N * (CELL_PX + GAP_PX) - GAP_PX
    k = W * span / grid
    o = (W - grid * k) / 2
    step = (CELL_PX + GAP_PX) * k
    for r in range(N):
        for c in range(N):
            x, y = o + c * step, o + r * step
            d.rounded_rectangle([x, y, x + CELL_PX * k, y + CELL_PX * k], radius=2 * k, fill=CELL + (255,))
    for (c, r, w, h), col in PIECES:
        x, y = o + c * step, o + r * step
        d.rounded_rectangle([x, y, x + w * step - GAP_PX * k, y + h * step - GAP_PX * k], radius=2.5 * k, fill=col + (255,))
    return img.resize((size, size), Image.LANCZOS)


def masked(img, shape):
    n = img.width
    m = Image.new('L', (n * 4, n * 4), 0)
    dm = ImageDraw.Draw(m)
    if shape == 'circle':
        dm.ellipse([0, 0, n * 4 - 1, n * 4 - 1], fill=255)
    else:
        dm.rounded_rectangle([0, 0, n * 4 - 1, n * 4 - 1], radius=n * 4 * 0.2, fill=255)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(img, (0, 0), m.resize((n, n), Image.LANCZOS))
    return out


RES = 'android/app/src/main/res'
for name, f in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    # adaptive icon foreground: 108 dp canvas, keep the mark inside the 66 dp safe zone
    mark(int(108 * f), 0.56, True).save(f'{RES}/mipmap-{name}/ic_launcher_foreground.png')
    n = int(48 * f)
    masked(mark(n, 0.74, False), 'square').save(f'{RES}/mipmap-{name}/ic_launcher.png')
    masked(mark(n, 0.66, False), 'circle').save(f'{RES}/mipmap-{name}/ic_launcher_round.png')

mark(64, 0.84, False).save('public/favicon.png')
mark(180, 0.74, False).save('public/apple-touch-icon.png')
print('icons written')
