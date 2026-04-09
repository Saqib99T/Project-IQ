"""
Generate Project IQ app assets matching the actual app design:
  - App icon: white bg + blue "A" chevron (matches home screen icon)
  - Splash:   light-blue bg + centered logo
  - Android adaptive icon layers
  - Favicon
  - Feature graphic (Google Play banner)
"""

from pathlib import Path
from PIL import Image, ImageDraw

# ─── Brand colours ────────────────────────────────────────────────────────────
BLUE        = (59, 130, 246)      # #3b82f6  primary
BLUE_DARK   = (29,  78, 216)      # #1d4ed8
BLUE_LIGHT  = (239, 246, 255)     # #eff6ff  app background
WHITE       = (255, 255, 255)
TEXT_DARK   = (17,  24,  39)      # #111827

ASSETS = Path(__file__).parent / "assets"
ASSETS.mkdir(exist_ok=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def new_white(size):
    return Image.new("RGBA", (size, size), (255, 255, 255, 255))

def new_light_blue(size):
    return Image.new("RGBA", (size, size), (*BLUE_LIGHT, 255))

def new_blue_grad(size):
    img = Image.new("RGBA", (size, size))
    for y in range(size):
        t = y / size
        r = int(BLUE[0] + t * (BLUE_DARK[0] - BLUE[0]))
        g = int(BLUE[1] + t * (BLUE_DARK[1] - BLUE[1]))
        b = int(BLUE[2] + t * (BLUE_DARK[2] - BLUE[2]))
        for x in range(size):
            img.putpixel((x, y), (r, g, b, 255))
    return img


def draw_A_chevron(draw, cx, cy, size, color):
    """
    Upward-pointing chevron  ∧  — two thick diagonal strokes meeting
    at an apex, NO crossbar. Matches the Project IQ app icon exactly.
    """
    stroke  = max(6, int(size * 0.13))   # thick rounded stroke
    half_w  = int(size * 0.40)           # how far legs spread at the bottom
    apex_y  = cy - int(size * 0.38)      # top point
    base_y  = cy + int(size * 0.38)      # bottom of each leg

    apex = (cx,            apex_y)
    bl   = (cx - half_w,   base_y)
    br   = (cx + half_w,   base_y)

    # Draw the two strokes
    draw.line([apex, bl], fill=color, width=stroke)
    draw.line([apex, br], fill=color, width=stroke)

    # Fill rounded caps at every endpoint
    r = stroke // 2
    for pt in [apex, bl, br]:
        draw.ellipse([pt[0]-r, pt[1]-r, pt[0]+r, pt[1]+r], fill=color)


def draw_sparkle(draw, cx, cy, size, color):
    """4-point star / sparkle — used as the bot avatar in the app."""
    import math
    outer = size // 2
    inner = int(outer * 0.38)
    pts = []
    for i in range(8):
        angle = math.pi / 4 * i - math.pi / 2
        r = outer if i % 2 == 0 else inner
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(pts, fill=color)


# ─── 1.  App Icon  1024 × 1024  (white bg + blue A) ─────────────────────────

def make_icon(size=1024):
    img = new_white(size)
    draw = ImageDraw.Draw(img)

    cx, cy = size // 2, size // 2
    logo_size = int(size * 0.54)
    draw_A_chevron(draw, cx, cy, logo_size, BLUE)

    return img.convert("RGB")


# ─── 2.  Splash icon  1024 × 1024  (light-blue bg + white A) ────────────────

def make_splash(size=1024):
    img = new_light_blue(size)
    draw = ImageDraw.Draw(img)

    cx, cy = size // 2, size // 2

    # Blue circle background for the logo
    pad = int(size * 0.22)
    draw.ellipse([pad, pad, size - pad, size - pad], fill=BLUE)

    # White "A" inside circle
    logo_size = int(size * 0.36)
    draw_A_chevron(draw, cx, cy, logo_size, WHITE)

    return img.convert("RGB")


# ─── 3.  Android foreground  (transparent bg + blue A) ───────────────────────

def make_android_foreground(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    draw_A_chevron(draw, cx, cy, int(size * 0.52), (*BLUE, 255))
    return img


# ─── 4.  Android background  (solid blue gradient) ───────────────────────────

def make_android_background(size=1024):
    return new_blue_grad(size).convert("RGB")


# ─── 5.  Android monochrome  (white A on transparent) ────────────────────────

def make_android_monochrome(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    draw_A_chevron(draw, cx, cy, int(size * 0.52), (255, 255, 255, 255))
    return img


# ─── 6.  Favicon  48 × 48 ────────────────────────────────────────────────────

def make_favicon(size=48):
    img = new_white(size)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    draw_A_chevron(draw, cx, cy, int(size * 0.72), BLUE)
    return img.convert("RGB")


# ─── 7.  Feature Graphic  1024 × 500  (Google Play banner) ──────────────────

def make_feature_graphic():
    W, H = 1024, 500

    # Light-blue background (matches app)
    img = Image.new("RGB", (W, H), BLUE_LIGHT)
    draw = ImageDraw.Draw(img)

    # Left side: blue circle with white A logo
    circle_cx, circle_cy = int(W * 0.25), H // 2
    cr = int(H * 0.34)
    draw.ellipse(
        [circle_cx - cr, circle_cy - cr, circle_cx + cr, circle_cy + cr],
        fill=BLUE
    )
    draw_A_chevron(draw, circle_cx, circle_cy, int(cr * 1.1), WHITE)

    # Right side: text placeholder bars (title + subtitle)
    tx   = int(W * 0.50)
    bh   = int(H * 0.072)
    gap  = int(H * 0.038)
    brad = bh // 2

    def pill(x0, y0, x1, y1, r, fill):
        draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
        draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
        for ex, ey in [(x0, y0), (x1 - 2*r, y0), (x0, y1 - 2*r), (x1 - 2*r, y1 - 2*r)]:
            draw.ellipse([ex, ey, ex + 2*r, ey + 2*r], fill=fill)

    # "Project IQ" title bar
    pill(tx, int(H*0.26), tx + int(W*0.40), int(H*0.26) + bh, brad, BLUE)

    # subtitle bars
    y1 = int(H*0.26) + bh + gap
    pill(tx, y1, tx + int(W*0.30), y1 + int(bh*0.65), int(bh*0.32),
         (*BLUE[:3], 150) if False else (180, 210, 250))

    y2 = y1 + int(bh*0.65) + int(gap*0.6)
    pill(tx, y2, tx + int(W*0.23), y2 + int(bh*0.65), int(bh*0.32),
         (180, 210, 250))

    # quick-action pill badges
    bw, bh2 = int(W * 0.105), int(H * 0.092)
    y3 = int(H * 0.66)
    labels_x = [tx + i * (bw + int(W*0.018)) for i in range(3)]
    for bx in labels_x:
        pill(bx, y3, bx + bw, y3 + bh2, bh2 // 2, WHITE)

    return img


# ─── Generate all ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    jobs = [
        ("icon.png",                     make_icon,              {}),
        ("splash-icon.png",              make_splash,            {}),
        ("android-icon-foreground.png",  make_android_foreground,{}),
        ("android-icon-background.png",  make_android_background,{}),
        ("android-icon-monochrome.png",  make_android_monochrome,{}),
        ("favicon.png",                  make_favicon,           {}),
        ("feature_graphic.png",          make_feature_graphic,   {}),
    ]

    for filename, fn, kwargs in jobs:
        out = ASSETS / filename
        result = fn(**kwargs)
        result.save(str(out), "PNG", optimize=True)
        size_kb = out.stat().st_size // 1024
        print(f"  {filename:42s}  {size_kb} KB")

    print("\nDone.")
