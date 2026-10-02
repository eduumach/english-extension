# /// script
# dependencies = ["pillow"]
# ///
# Redraws the Glossa icon (three subtitle bars colored by word state) at any size.
import sys
from PIL import Image, ImageDraw

BG = (26, 26, 26, 255)          # #1A1A1A
GREEN = (127, 209, 127, 255)    # --known
YELLOW = (255, 224, 102, 255)   # --study
ORANGE = (255, 158, 94, 255)    # new words
# Each row: (bar end, yellow end, green end) as fractions of the bar area width.
ROWS = [(1.00, 0.72, 0.42), (1.00, 0.50, 0.28), (0.78, 0.62, 0.40)]

def draw(size, out, inset=0.06):
    # Lay out in target pixels and round to whole pixels, then draw 16x supersampled:
    # edges land on the pixel grid, so small sizes stay crisp instead of blurry.
    k = 16
    img = Image.new("RGBA", (size * k, size * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    px = lambda v: round(v) * k
    pad = round(size * inset)
    inner = size - 2 * pad
    d.rounded_rectangle([pad * k, pad * k, (size - pad) * k - 1, (size - pad) * k - 1],
                        radius=inner * 0.23 * k, fill=BG)
    bar_h = max(2, round(inner * 0.135))
    gap = max(2, round(inner * 0.085))
    x0 = pad + round(inner * 0.18)
    w = round(inner * 0.64)
    top = pad + round((inner - (3 * bar_h + 2 * gap)) / 2)
    for i, (end, yellow, green) in enumerate(ROWS):
        y = top + i * (bar_h + gap)
        # Layered pills: orange full bar, yellow over it, green on top.
        for frac, color in ((end, ORANGE), (yellow, YELLOW), (green, GREEN)):
            d.rounded_rectangle([px(x0), px(y), px(x0 + w * frac) - 1, px(y + bar_h) - 1],
                                radius=bar_h * k / 2, fill=color)
    img.resize((size, size), Image.LANCZOS).save(out)

if __name__ == "__main__":
    # Usage: uv run scripts/icon.py  (writes public/icons and store/icon-1024.png)
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    for size in (16, 24, 32, 64, 128):
        # Tiny toolbar sizes use the full square so the bars stay as big as possible.
        draw(size, f"{root}/public/icons/icon-{size}.png", inset=0.0 if size <= 32 else 0.06)
    draw(1024, f"{root}/store/icon-1024.png")
