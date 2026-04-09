"""
Generate App Store / Google Play screenshot mockups for Project IQ Bot.

Screens:
  1. Welcome  — "Hi user, Where should we start?" + quick-action cards
  2. Chat     — conversation with bot reply + quick chips
  3. History  — conversation history list

Device sizes:
  Phone        1080 × 1920
  7-in tablet  1200 × 1920
  10-in tablet 1600 × 2560
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

# ── Brand ────────────────────────────────────────────────────────────────────
BLUE       = (59,  130, 246)
BLUE_DARK  = (29,   78, 216)
BLUE_LIGHT = (239, 246, 255)
WHITE      = (255, 255, 255)
TEXT       = (17,   24,  39)
TEXT_MID   = (75,   85, 100)
TEXT_LIGHT = (156, 163, 175)
BORDER     = (229, 231, 235)
CARD_BG    = (255, 255, 255)
INPUT_BG   = (240, 244, 249)
RED        = (239,  68,  68)
AMBER      = (217, 119,   6)
AMBER_BG   = (254, 252, 232)
AMBER_BDR  = (253, 230, 138)
GREEN      = (16,  185, 129)

OUT = Path(__file__).parent / "assets" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)


# ── Low-level drawing helpers ─────────────────────────────────────────────────

def pill(draw, x0, y0, x1, y1, fill, border=None, bw=2):
    r = (y1 - y0) // 2
    draw.rounded_rectangle([x0, y0, x1, y1], radius=r,
                            fill=fill, outline=border, width=bw)


def rrect(draw, x0, y0, x1, y1, r, fill, border=None, bw=2):
    draw.rounded_rectangle([x0, y0, x1, y1], radius=r,
                            fill=fill, outline=border, width=bw)


def circle(draw, cx, cy, r, fill):
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=fill)


def text_line(draw, x, y, txt, size, color, anchor="la"):
    """Draw text using default PIL font scaled by size (approximate)."""
    try:
        from PIL import ImageFont
        # Try to load a system font
        for name in ["arial.ttf", "Arial.ttf", "DejaVuSans.ttf",
                     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
            try:
                font = ImageFont.truetype(name, size)
                draw.text((x, y), txt, fill=color, font=font, anchor=anchor)
                return
            except Exception:
                pass
        # Fallback: default bitmap font (no size control)
        draw.text((x, y), txt, fill=color, anchor=anchor)
    except Exception:
        draw.text((x, y), txt, fill=color)


def text_bold(draw, x, y, txt, size, color, anchor="la"):
    """Simulate bold by drawing text twice with 1px offset."""
    try:
        from PIL import ImageFont
        for name in ["arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf",
                     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
            try:
                font = ImageFont.truetype(name, size)
                draw.text((x, y), txt, fill=color, font=font, anchor=anchor)
                return
            except Exception:
                pass
        # Fake bold
        for dx in range(2):
            draw.text((x+dx, y), txt, fill=color)
    except Exception:
        draw.text((x, y), txt, fill=color)


def chevron(draw, cx, cy, size, color):
    """Small upward chevron logo."""
    stroke = max(3, int(size * 0.14))
    hw = int(size * 0.40)
    ay = cy - int(size * 0.36)
    by = cy + int(size * 0.36)
    draw.line([(cx, ay), (cx - hw, by)], fill=color, width=stroke)
    draw.line([(cx, ay), (cx + hw, by)], fill=color, width=stroke)
    r = stroke // 2
    for pt in [(cx, ay), (cx - hw, by), (cx + hw, by)]:
        draw.ellipse([pt[0]-r, pt[1]-r, pt[0]+r, pt[1]+r], fill=color)


def sparkle(draw, cx, cy, size, color):
    """4-point star sparkle — bot avatar icon."""
    outer = size // 2
    inner = int(outer * 0.38)
    pts = []
    for i in range(8):
        angle = math.pi / 4 * i - math.pi / 2
        r = outer if i % 2 == 0 else inner
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(pts, fill=color)


# ── Shared UI components ──────────────────────────────────────────────────────

def draw_status_bar(draw, W, h, scale):
    """Minimal phone status bar."""
    s = scale
    y = int(h * 0.5)
    text_line(draw, int(16*s), y, "9:41", int(13*s), TEXT, anchor="lm")
    # battery block
    bx, bw, bh = W - int(44*s), int(22*s), int(11*s)
    by = y - bh//2
    rrect(draw, bx, by, bx+bw, by+bh, 2, None, TEXT, 1)
    rrect(draw, bx+2, by+2, bx+bw-8, by+bh-2, 1, TEXT)
    draw.rectangle([bx+bw, by+3, bx+bw+3, by+bh-3], fill=TEXT)


def draw_header(draw, W, top, h, scale, title="Project IQ"):
    """App top bar: hamburger | title | U avatar."""
    s = scale
    cy = top + h // 2
    # hamburger lines
    lx, lw, lh = int(18*s), int(20*s), int(2*s)
    for dy in [-int(5*s), 0, int(5*s)]:
        draw.rectangle([lx, cy+dy-lh//2, lx+lw, cy+dy+lh//2], fill=TEXT)
    # title
    text_bold(draw, W//2, cy, title, int(17*s), TEXT, anchor="mm")
    # U avatar circle
    ar = int(16*s)
    circle(draw, W - int(22*s), cy, ar, BLUE)
    text_bold(draw, W - int(22*s), cy, "U", int(13*s), WHITE, anchor="mm")


def draw_input_bar(draw, W, y, h, scale, placeholder="Ask Project IQ..."):
    """Bottom pill input area."""
    s = scale
    pad = int(16*s)
    bh  = int(44*s)
    by  = y + (h - bh) // 2
    rrect(draw, pad, by, W-pad, by+bh, bh//2, INPUT_BG)
    # clip icon
    text_line(draw, pad + int(14*s), by+bh//2, "⌀", int(14*s), TEXT_LIGHT, anchor="lm")
    text_line(draw, pad + int(30*s), by+bh//2, placeholder,
              int(14*s), TEXT_LIGHT, anchor="lm")
    # mic icon
    text_line(draw, W - pad - int(14*s), by+bh//2, "♪", int(14*s), TEXT_LIGHT, anchor="rm")


def draw_quick_chips(draw, W, y, h, scale, chips):
    """Horizontal scrollable quick-action chips."""
    s   = scale
    ph  = int(34*s)
    px  = int(16*s)
    py  = y + (h - ph) // 2
    gap = int(8*s)
    for label in chips:
        tw  = int(len(label) * 7.5 * s) + int(24*s)
        pill(draw, px, py, px+tw, py+ph, CARD_BG, BORDER, max(1, int(s)))
        text_line(draw, px + tw//2, py+ph//2, label,
                  int(12*s), TEXT_MID, anchor="mm")
        px += tw + gap


# ── Screen 1: Welcome ─────────────────────────────────────────────────────────

QUICK_ACTIONS = [
    ("📝", "Create Ticket"),
    ("📋", "My Tickets"),
    ("🔍", "Check Status"),
    ("❓", "Get Help"),
]


def screen_welcome(W, H, scale):
    s = scale
    img  = Image.new("RGB", (W, H), BLUE_LIGHT)
    draw = ImageDraw.Draw(img)

    # Status bar
    sb_h = int(36*s)
    draw_status_bar(draw, W, sb_h, s)

    # White header card
    hdr_h = int(56*s)
    hdr_y = sb_h
    draw.rectangle([0, hdr_y, W, hdr_y+hdr_h], fill=WHITE)
    draw_header(draw, W, hdr_y, hdr_h, s)

    # Greeting
    gy = hdr_y + hdr_h + int(32*s)
    text_line(draw, int(24*s), gy, "Hi user-it", int(22*s), TEXT)
    gy += int(30*s)
    text_bold(draw, int(24*s), gy, "Where should we start?", int(24*s), TEXT)

    # Quick action cards
    cy = gy + int(44*s)
    cw = W - int(48*s)
    ch = int(56*s)
    gap = int(12*s)
    for icon, label in QUICK_ACTIONS:
        rrect(draw, int(24*s), cy, int(24*s)+cw, cy+ch, int(14*s), WHITE,
              BORDER, max(1, int(s)))
        text_line(draw, int(52*s), cy+ch//2, icon+" "+label,
                  int(15*s), TEXT, anchor="lm")
        cy += ch + gap

    # Input bar at bottom
    ib_h = int(72*s)
    draw.rectangle([0, H-ib_h, W, H], fill=WHITE)
    draw_input_bar(draw, W, H-ib_h, ib_h, s)

    return img


# ── Screen 2: Chat conversation ───────────────────────────────────────────────

def screen_chat(W, H, scale):
    s = scale
    img  = Image.new("RGB", (W, H), WHITE)
    draw = ImageDraw.Draw(img)

    sb_h  = int(36*s)
    hdr_h = int(56*s)
    draw_status_bar(draw, W, sb_h, s)
    draw.rectangle([0, sb_h, W, sb_h+hdr_h], fill=WHITE)
    draw_header(draw, W, sb_h, hdr_h, s)

    # thin divider
    dy = sb_h + hdr_h
    draw.rectangle([0, dy, W, dy+1], fill=BORDER)

    y = dy + int(20*s)

    # ── Bot greeting bubble ──────────────────────────────────────
    # Sparkle avatar
    av_r = int(18*s)
    av_cx = int(24*s) + av_r
    av_cy = y + av_r
    circle(draw, av_cx, av_cy, av_r, BLUE_LIGHT)
    sparkle(draw, av_cx, av_cy, int(av_r*1.1), BLUE)

    bx = av_cx + av_r + int(10*s)
    bw = int(W * 0.68)
    lines1 = ["Hi user-it!", "Welcome back. How can I help you today?"]
    line_h = int(20*s)
    bh = int(24*s) + len(lines1)*line_h
    rrect(draw, bx, y, bx+bw, y+bh, int(14*s), BLUE_LIGHT)
    ty = y + int(12*s)
    for i, ln in enumerate(lines1):
        fn = text_bold if i == 0 else text_line
        fn(draw, bx+int(12*s), ty, ln, int(14*s), TEXT)
        ty += line_h
    y += bh + int(16*s)

    # ── User message ─────────────────────────────────────────────
    umsg = "I need to create a support ticket"
    uw   = int(len(umsg)*7.5*s) + int(24*s)
    uw   = min(uw, int(W*0.70))
    uh   = int(44*s)
    ux   = W - int(16*s) - uw
    rrect(draw, ux, y, ux+uw, y+uh, int(14*s), BLUE)
    text_line(draw, ux+uw//2, y+uh//2, umsg, int(13*s), WHITE, anchor="mm")
    y += uh + int(16*s)

    # ── Bot reply bubble ─────────────────────────────────────────
    blines = [
        "Sure! To create a ticket,",
        "please provide:",
        " • Issue description",
        " • Priority level",
        " • Your department",
    ]
    bh2 = int(20*s) + len(blines)*int(19*s)
    bw2 = int(W * 0.72)
    av_cy2 = y + av_r
    circle(draw, av_cx, av_cy2, av_r, BLUE_LIGHT)
    sparkle(draw, av_cx, av_cy2, int(av_r*1.1), BLUE)
    rrect(draw, bx, y, bx+bw2, y+bh2, int(14*s), BLUE_LIGHT)
    ty = y + int(10*s)
    for ln in blines:
        text_line(draw, bx+int(12*s), ty, ln, int(13*s), TEXT)
        ty += int(19*s)
    y += bh2 + int(16*s)

    # ── Inactivity warning ───────────────────────────────────────
    ww = W - int(48*s)
    wh = int(70*s)
    rrect(draw, int(24*s), y, int(24*s)+ww, y+wh, int(12*s),
          AMBER_BG, AMBER_BDR, max(1,int(s)))
    text_line(draw, int(40*s), y+int(10*s), "⏰  Still there?", int(13*s), AMBER)
    text_line(draw, int(40*s), y+int(28*s),
              "You've been inactive for 8 minutes.", int(12*s), AMBER)
    text_bold(draw, int(40*s), y+int(46*s),
              "Session ends in 2 min if no activity.", int(12*s), AMBER)
    y += wh + int(16*s)

    # ── Quick chips ──────────────────────────────────────────────
    chip_h = int(48*s)
    chips  = ["📝 Create Ticket", "📋 My Tickets", "🔍 Status", "❓ Help"]
    draw_quick_chips(draw, W, y, chip_h, s, chips)
    y += chip_h + int(4*s)

    # Input bar
    ib_h = int(72*s)
    draw.rectangle([0, H-ib_h, W, H], fill=WHITE)
    draw.rectangle([0, H-ib_h, W, H-ib_h+1], fill=BORDER)
    draw_input_bar(draw, W, H-ib_h, ib_h, s)

    return img


# ── Screen 3: History ─────────────────────────────────────────────────────────

HISTORY = [
    ("Today",   [
        ("2 min ago",  "I need to create a support ticket"),
        ("1 hr ago",   "What is the status of ticket TK-1042?"),
    ]),
    ("Yesterday", [
        ("9:30 AM",  "How do I reset my password?"),
        ("8:15 AM",  "My laptop is not connecting to Wi-Fi"),
    ]),
    ("Apr 5", [
        ("3:44 PM",  "Create a ticket for printer issue"),
        ("10:02 AM", "List all my open tickets"),
    ]),
]


def screen_history(W, H, scale):
    s    = scale
    img  = Image.new("RGB", (W, H), BLUE_LIGHT)
    draw = ImageDraw.Draw(img)

    sb_h  = int(36*s)
    hdr_h = int(56*s)
    draw_status_bar(draw, W, sb_h, s)
    draw.rectangle([0, sb_h, W, sb_h+hdr_h], fill=WHITE)
    draw_header(draw, W, sb_h, hdr_h, s, title="Conversation History")

    y = sb_h + hdr_h + int(16*s)

    for group, items in HISTORY:
        # Date label
        text_bold(draw, int(24*s), y, group, int(11*s), TEXT_LIGHT)
        y += int(22*s)

        for time_str, preview in items:
            cw = W - int(32*s)
            ch = int(62*s)
            rrect(draw, int(16*s), y, int(16*s)+cw, y+ch, int(12*s),
                  WHITE, BORDER, max(1,int(s)))
            text_line(draw, int(30*s), y+int(14*s), time_str,
                      int(11*s), TEXT_LIGHT)
            # Truncate preview
            max_chars = int(cw / (7*s))
            shown = preview if len(preview) <= max_chars else preview[:max_chars-1]+"…"
            text_line(draw, int(30*s), y+int(32*s), shown, int(13*s), TEXT)
            # chevron
            text_line(draw, int(16*s)+cw-int(20*s), y+ch//2, "›",
                      int(18*s), TEXT_LIGHT, anchor="mm")
            y += ch + int(8*s)

        y += int(8*s)

    return img


# ── Render all three screens for each device ─────────────────────────────────

DEVICES = {
    "phone":    (1080, 1920, 1.0),
    "tablet_7": (1200, 1920, 1.1),
    "tablet_10":(1600, 2560, 1.48),
}

SCREENS = {
    "01_welcome": screen_welcome,
    "02_chat":    screen_chat,
    "03_history": screen_history,
}

if __name__ == "__main__":
    for dev, (W, H, scale) in DEVICES.items():
        dev_dir = OUT / dev
        dev_dir.mkdir(exist_ok=True)
        for name, fn in SCREENS.items():
            img  = fn(W, H, scale)
            path = dev_dir / f"{name}.png"
            img.save(str(path), "PNG", optimize=True)
            kb = path.stat().st_size // 1024
            print(f"  {dev:12s}  {name}  {W}×{H}  {kb} KB")
    print(f"\nSaved to: {OUT}")
