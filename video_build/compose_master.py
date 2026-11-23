#!/usr/bin/env python3
"""
Master 720p HD (1280x720 @ 30.00 fps, 1800 frames = 60.00s, 2x supersampled from 2560x1440)
Video Compositor Engine for Wave Function Collapse & Adjacency Growth CAD Viewport Showcase.
White Background Theme (#FFFFFF), Minimal Text Script, and High Anti-Aliasing.

Supports:
  --pre-render-cards : Renders and caches the 4 Chapter Title Cards (36f each)
                       and the Chapter 2 Progressive 3-Stage Comparison Stack (120f)
                       into `video_build/raw/cards/` AND `video_build/frames/`.
  (default)          : Renders all 1800 frames (`video_build/frames/frame_0000.jpg`
                       .. `frame_1799.jpg` at 1280x720, quality 95) and encodes the final 720p HD
                       MP4 (`video_build/wfc_showcase_60s_720p.mp4`) using FFmpeg 7.1.
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ============================================================================
# PATHS & CONSTANTS
# ============================================================================
BASE_DIR = Path(r"c:\Users\shajay.b\Documents\REPOS\ANTIGRAVITY REPOS\DRL")
VIDEO_BUILD_DIR = BASE_DIR / "video_build"
RAW_DIR = VIDEO_BUILD_DIR / "raw"
CARDS_DIR = RAW_DIR / "cards"
FRAMES_DIR = VIDEO_BUILD_DIR / "frames"
OUTPUT_MP4 = VIDEO_BUILD_DIR / "wfc_showcase_60s_720p.mp4"
ROOT_MP4_720P = BASE_DIR / "wfc_showcase_60s_720p.mp4"
ROOT_MP4_2K = BASE_DIR / "wfc_showcase_30s_2k.mp4"

FFMPEG_EXE = Path(
    r"C:\Users\shajay.b\Documents\REPOS\CODEX_REPOS\Video_editing\.video_tools\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
)
FONTS_DIR = Path(r"C:\Windows\Fonts")

W, H = 2560, 1440
OUT_W, OUT_H = 1280, 720
FPS = 30
TOTAL_FRAMES = 1800

# ============================================================================
# COLOR PALETTE (Pure White Background & Clean Light Theme)
# ============================================================================
BG_CANVAS = (255, 255, 255)       # #FFFFFF Pure White Outer Canvas Background
C_BG = BG_CANVAS
C_PANEL = (248, 250, 252)         # #F8FAFC Soft Light Slate Card / Panel Surface
C_PANEL_INNER = (255, 255, 255)   # #FFFFFF Inner Card Surface
C_HEADER = (241, 245, 249)        # #F1F5F9 Clean Light Header Bar
C_BADGE_FILL = (248, 250, 252, 242)  # #F8FAFC (~95% opacity)
C_VP_BORDER = (203, 213, 225)     # #CBD5E1 Smooth Anti-Aliased Border
C_DIVIDER = (226, 232, 240)       # #E2E8F0 Subtle Divider

C_TEAL = (13, 148, 136)           # #0D9488 Primary Teal Accent
C_TEAL_DARK = (15, 118, 110)      # #0F766E Adjacency Growth Teal
C_TEAL_MUTED = (20, 184, 166)     # #14B8A6 Secondary Teal
C_TEAL_BAR = (13, 148, 136)       # #0D9488 Badge Vertical Accent Bar
C_CYAN = (2, 132, 199)            # #0284C7 Cyan Accent
C_PINK = (190, 24, 93)            # #BE185D WFC Collapse Magenta Accent
C_PINK_LIGHT = (236, 72, 153)     # #EC4899 Tile CRS Pink
C_GREEN = (16, 185, 129)          # #10B981 Emerald Allow / Export Green
C_GREEN_DARK = (5, 150, 105)      # #059669 Dark Emerald Text
C_ROSE = (244, 63, 94)            # #F43F5E Rose Deny / Prune
C_ROSE_DARK = (225, 29, 72)       # #E11D48 Dark Rose Text
C_AMBER = (217, 119, 6)           # #D97706 Warm Amber Accent

C_TEXT = (15, 23, 42)             # #0F172A Dark-Slate Primary Ink
C_SUB = (71, 85, 105)             # #475569 Muted Slate Subtitle Text
C_MUTED = (100, 116, 139)         # #64748B Muted Label Text

# Tile definitions matching index_WFC.html
TILES = [
    {"id": 0, "short": "NUL", "name": "Empty",           "quads": "0q",  "color": (148, 163, 184), "hex": "#94a3b8", "sockets": [0, 0, 0, 0, 0, 0]},
    {"id": 1, "short": "CRS", "name": "6-Way Hub",       "quads": "24q", "color": (236, 72, 153),  "hex": "#ec4899", "sockets": [1, 1, 1, 1, 1, 1]},
    {"id": 2, "short": "VTB", "name": "Vertical Tube",   "quads": "8q",  "color": (56, 189, 248),  "hex": "#38bdf8", "sockets": [0, 0, 0, 0, 1, 1]},
    {"id": 3, "short": "HTB", "name": "Horizontal Tube", "quads": "8q",  "color": (100, 116, 139), "hex": "#64748b", "sockets": [1, 1, 0, 0, 0, 0]},
]

# Socket-matching adjacency rules: adjRules[axis][rowA][colB]
SOCKET_RULES = [
    [[1 if TILES[a]["sockets"][axis * 2] == TILES[b]["sockets"][axis * 2 + 1] else 0 for b in range(4)] for a in range(4)]
    for axis in range(3)
]


# ============================================================================
# FONT LOADER & CACHING
# ============================================================================
_FONT_CACHE = {}

FONT_FILES = {
    "bold_italic": ["segoeuiz.ttf", "arialbi.ttf"],
    "italic": ["segoeuii.ttf", "ariali.ttf"],
    "bold": ["segoeuib.ttf", "arialbd.ttf"],
    "semibold": ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"],
    "regular": ["segoeui.ttf", "arial.ttf"],
    "mono_bold": ["consolab.ttf", "courbd.ttf"],
    "mono": ["consola.ttf", "cour.ttf"],
}


def get_font(style: str, size: int) -> ImageFont.FreeTypeFont:
    key = (style, size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    candidates = FONT_FILES.get(style, ["segoeui.ttf"])
    for fn in candidates:
        p = FONTS_DIR / fn
        if p.exists():
            font = ImageFont.truetype(str(p), size)
            _FONT_CACHE[key] = font
            return font
    font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill,
):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = cx - tw / 2.0 - bbox[0]
    y = cy - th / 2.0 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


# ============================================================================
# HIGH ANTI-ALIASING GEOMETRY & COMPOSITING HELPERS
# ============================================================================
_MASK_CACHE = {}
_BOX_CACHE = {}


def get_rounded_mask(w: int, h: int, radius: int) -> Image.Image:
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))
    radius = max(0, min(int(round(radius)), min(w, h) // 2))
    key = (w, h, radius)
    if key in _MASK_CACHE:
        return _MASK_CACHE[key]
    scale = 4 if (w * h <= 400000) else 2
    mask_hi = Image.new("L", (w * scale, h * scale), 0)
    d = ImageDraw.Draw(mask_hi)
    d.rounded_rectangle(
        (0, 0, w * scale - 1, h * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    mask = mask_hi.resize((w, h), Image.Resampling.LANCZOS)
    _MASK_CACHE[key] = mask
    return mask


def _to_rgba(col) -> tuple:
    if col is None:
        return (0, 0, 0, 0)
    if len(col) == 4:
        return (int(col[0]), int(col[1]), int(col[2]), int(col[3]))
    return (int(col[0]), int(col[1]), int(col[2]), 255)


def make_aa_rounded_box(
    w: int,
    h: int,
    radius: int,
    fill_color,
    border_color=None,
    border_w: int = 0,
) -> Image.Image:
    """
    Creates an RGBA image of size (w, h) containing a silky-smooth anti-aliased
    rounded rectangle with an anti-aliased border using supersampled masks.
    Never uses 1x ImageDraw.rounded_rectangle(..., outline=...).
    """
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))
    radius = max(0, min(int(round(radius)), min(w, h) // 2))
    border_w = max(0, int(round(border_w)))
    fill_rgba = _to_rgba(fill_color)
    border_rgba = _to_rgba(border_color) if (border_color is not None and border_w > 0) else None

    key = (w, h, radius, fill_rgba, border_rgba, border_w)
    if key in _BOX_CACHE:
        return _BOX_CACHE[key]

    outer_mask = get_rounded_mask(w, h, radius)
    box = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    if border_rgba is not None and border_w > 0:
        border_layer = Image.new("RGBA", (w, h), border_rgba)
        if border_rgba[3] < 255:
            om = outer_mask.point(lambda p: (p * border_rgba[3]) // 255)
            box.paste(border_layer, (0, 0), om)
        else:
            box.paste(border_layer, (0, 0), outer_mask)

        iw = max(1, w - 2 * border_w)
        ih = max(1, h - 2 * border_w)
        ir = max(0, radius - border_w)
        inner_mask = get_rounded_mask(iw, ih, ir)
        fill_layer = Image.new("RGBA", (iw, ih), fill_rgba)
        if fill_rgba[3] < 255:
            im = inner_mask.point(lambda p: (p * fill_rgba[3]) // 255)
            box.paste(fill_layer, (border_w, border_w), im)
        else:
            box.paste(fill_layer, (border_w, border_w), inner_mask)
    else:
        fill_layer = Image.new("RGBA", (w, h), fill_rgba)
        if fill_rgba[3] < 255:
            om = outer_mask.point(lambda p: (p * fill_rgba[3]) // 255)
            box.paste(fill_layer, (0, 0), om)
        else:
            box.paste(fill_layer, (0, 0), outer_mask)

    if len(_BOX_CACHE) < 512:
        _BOX_CACHE[key] = box
    return box


def paste_aa_rounded_box(
    target_img: Image.Image,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    radius: int,
    fill_color,
    border_color=None,
    border_w: int = 0,
):
    """Pastes an anti-aliased rounded rectangle onto an RGB or RGBA target image."""
    w = int(round(x1 - x0))
    h = int(round(y1 - y0))
    if w <= 0 or h <= 0:
        return
    box = make_aa_rounded_box(w, h, radius, fill_color, border_color, border_w)
    if target_img.mode == "RGBA":
        target_img.alpha_composite(box, (int(round(x0)), int(round(y0))))
    else:
        target_img.paste(box.convert("RGB"), (int(round(x0)), int(round(y0))), box.split()[3])


def fit_cover(img: Image.Image, target_w: int, target_h: int, align_x: float = 0.5, align_y: float = 0.5) -> Image.Image:
    """Resize and crop image to fill target_w x target_h without aspect distortion."""
    iw, ih = img.size
    if iw == target_w and ih == target_h:
        return img.convert("RGB")
    scale = max(target_w / iw, target_h / ih)
    nw = max(target_w, int(round(iw * scale)))
    nh = max(target_h, int(round(ih * scale)))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS).convert("RGB")
    left = int(round((nw - target_w) * align_x))
    top = int(round((nh - target_h) * align_y))
    return resized.crop((left, top, left + target_w, top + target_h))


def sanitize_viewport_image(img: Image.Image, crop_left_sidebar: bool = False) -> Image.Image:
    """
    Since raw viewport images are on a white background (1920x1440 at 2x DPR or 960x720 at 1x DPR),
    do NOT trim white pixels from the right edge. Only crop left sidebar if crop_left_sidebar=True
    on a full-window capture, and clear the faint 48px left CSS drop-shadow cast by <aside>.
    """
    w, h = img.size
    if crop_left_sidebar:
        if w >= 2500:
            img = img.crop((640 if h >= 1400 else 320, 0, w, h))
        elif w == 1280 and h == 720:
            img = img.crop((320, 0, w, h))
        w, h = img.size
    if w >= 900:
        # Crop the faint left-edge CSS box-shadow strip (48px at 1920w, 24px at 960w)
        trim_l = 48 if w >= 1800 else 24
        img = img.crop((trim_l, 0, w, h))
    return img


def load_raw_image(rel_path: str, crop_left_sidebar: bool = False) -> Image.Image:
    """Loads a raw PNG/JPG from `video_build/raw/` with nearest-frame fallback or clean white placeholder."""
    p = RAW_DIR / rel_path
    if p.exists():
        try:
            return sanitize_viewport_image(Image.open(p).convert("RGB"), crop_left_sidebar=crop_left_sidebar)
        except Exception:
            pass

    parent = p.parent
    stem = p.stem
    if "_" in stem and parent.exists():
        prefix = stem.rsplit("_", 1)[0]
        candidates = sorted(parent.glob(f"{prefix}_*.png")) + sorted(parent.glob(f"{prefix}_*.jpg"))
        if candidates:
            try:
                idx = int(stem.rsplit("_", 1)[1])
                best = min(
                    candidates,
                    key=lambda c: abs(int(c.stem.rsplit("_", 1)[1]) - idx)
                    if c.stem.rsplit("_", 1)[1].isdigit()
                    else 9999,
                )
                return sanitize_viewport_image(Image.open(best).convert("RGB"), crop_left_sidebar=crop_left_sidebar)
            except Exception:
                return sanitize_viewport_image(Image.open(candidates[-1]).convert("RGB"), crop_left_sidebar=crop_left_sidebar)

    img = Image.new("RGB", (1920, 1440), BG_CANVAS)
    return img


def place_rounded_viewport(
    canvas: Image.Image,
    vp_img: Image.Image,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    rx: int = 20,
    border_color=C_VP_BORDER,
    border_width: int = 3,
    align_x: float = 0.5,
    align_y: float = 0.5,
):
    """
    Places a 3D viewport inside an anti-aliased rounded container with a smooth
    #CBD5E1 border (width=3 at 2560x1440) on the white canvas.
    """
    vw = x1 - x0
    vh = y1 - y0
    # 1. Paste anti-aliased border shell first
    paste_aa_rounded_box(
        canvas,
        x0,
        y0,
        x1,
        y1,
        radius=rx,
        fill_color=BG_CANVAS,
        border_color=border_color,
        border_w=border_width,
    )
    # 2. Paste fitted viewport image inside the border inset
    iw = max(1, vw - 2 * border_width)
    ih = max(1, vh - 2 * border_width)
    ir = max(0, rx - border_width)
    fitted = fit_cover(vp_img, iw, ih, align_x=align_x, align_y=align_y)
    inner_mask = get_rounded_mask(iw, ih, ir)
    canvas.paste(fitted, (x0 + border_width, y0 + border_width), inner_mask)


def apply_fade_to_bg(img: Image.Image, alpha: float) -> Image.Image:
    """Blends `img` with pure white `BG_CANVAS` (`#FFFFFF`) by factor `alpha` in [0.0, 1.0]."""
    alpha = max(0.0, min(1.0, float(alpha)))
    if alpha >= 0.999:
        return img
    bg = Image.new("RGB", img.size, BG_CANVAS)
    if alpha <= 0.001:
        return bg
    return Image.blend(bg, img, alpha)


# ============================================================================
# MINIMAL, SINGLE-LINE HUD PILLS & ZERO REDUNDANCY
# ============================================================================
def draw_stage_badge(
    canvas: Image.Image,
    x: int = 90,
    y: int = 114,
    stage_str: str = "",
    title_str: str = "",
    accent=C_TEAL,
):
    """
    Draws a single-line compact pill with a vertical accent bar on the left and
    ONLY `title_str` in bold dark-slate (#0F172A, 28pt at 2560x1440) on a soft
    translucent white/slate pill (#F8FAFC, 242 alpha) with a smooth anti-aliased
    border (#CBD5E1). `stage_str` is ignored so there is zero redundant eyebrow text.
    """
    text = title_str if title_str else stage_str
    if not text:
        return

    f_title = get_font("bold", 28)
    tmp_draw = ImageDraw.Draw(canvas)
    tw, th = text_size(tmp_draw, text, f_title)

    pill_h = 74
    pill_w = tw + 82
    rx = 16

    overlay = Image.new("RGBA", (pill_w, pill_h), (0, 0, 0, 0))
    paste_aa_rounded_box(
        overlay,
        0,
        0,
        pill_w,
        pill_h,
        radius=rx,
        fill_color=C_BADGE_FILL,
        border_color=(*C_VP_BORDER, 255),
        border_w=3,
    )

    # Vertical accent bar on the left
    paste_aa_rounded_box(
        overlay,
        22,
        17,
        29,
        pill_h - 17,
        radius=3,
        fill_color=(*accent, 255),
    )

    odraw = ImageDraw.Draw(overlay)
    bbox = odraw.textbbox((0, 0), text, font=f_title)
    ty = (pill_h - (bbox[3] - bbox[1])) / 2.0 - bbox[1]
    odraw.text((46, ty), text, font=f_title, fill=(*C_TEXT, 255))

    canvas.paste(overlay.convert("RGB"), (x, y), overlay.split()[3])


def draw_hud_badge(
    canvas: Image.Image,
    kicker: str = "",
    title: str = "",
    x: int = 90,
    y: int = 114,
    height: int = 74,
    min_w: int = 0,
    max_w: int = 1600,
    accent_color=C_TEAL,
    bar_color=C_TEAL_BAR,
):
    """Wrapper around draw_stage_badge that ignores kicker and renders only single-line title."""
    draw_stage_badge(canvas, x=x, y=y, stage_str=kicker, title_str=title, accent=accent_color)


def draw_bottom_pill(*args, **kwargs):
    """No-op to eliminate redundant bottom summary pills."""
    return


def draw_bottom_summary_pill(*args, **kwargs):
    """No-op to eliminate redundant bottom summary pills."""
    return


def draw_ch3_param_card(*args, **kwargs):
    """No-op to eliminate redundant bottom-right parameter table in Chapter 3."""
    return


def draw_ch3_param_inset(*args, **kwargs):
    """No-op to eliminate redundant bottom-right parameter table in Chapter 3."""
    return


def draw_ch4_quad_topology_inset(*args, **kwargs):
    """No-op to eliminate code snippets in Shot 18."""
    return


def draw_ch4_arctic_inset(*args, **kwargs):
    """No-op to eliminate code snippets in Shot 19."""
    return


# ============================================================================
# LAYOUT A: CHAPTER TITLE CARDS (36 FRAMES = 1.20s, WHITE THEME)
# ============================================================================
TITLE_CARDS_SPEC = {
    1: {
        "start_frame": 0,
        "num": "01",
        "title": "BUILDING BLOCKS",
        "subtitle": "Tiles  \u00b7  Voxel Grid  \u00b7  Adjacency Rules",
    },
    2: {
        "start_frame": 390,
        "num": "02",
        "title": "TWO SOLVERS",
        "subtitle": "Adjacency Growth  vs.  Wave Function Collapse",
    },
    3: {
        "start_frame": 870,
        "num": "03",
        "title": "DESIGN CATALOGUE",
        "subtitle": "Varying Grid Shape, Tiles & Rules",
    },
    4: {
        "start_frame": 1470,
        "num": "04",
        "title": "QUAD-MESH OUTPUT",
        "subtitle": "Clean Topology  \u00b7  Arctic Shading  \u00b7  Rhino .3dm",
    },
}


def render_title_card_base(ch_num: str, title: str, subtitle: str) -> Image.Image:
    """
    White #FFFFFF background, teal (13, 148, 136) L-bracket corners,
    teal chapter number ("01".."04"), dark-slate (15, 23, 42) main title (54pt -> 108px at 2x),
    and muted slate (71, 85, 105) subtitle (26pt -> 52px at 2x).
    """
    img = Image.new("RGB", (W, H), BG_CANVAS)
    draw = ImageDraw.Draw(img)

    arm = 44
    stroke = 4
    col = C_TEAL

    # TL: (106, 132)
    tl_x, tl_y = 106, 132
    draw.rectangle((tl_x, tl_y, tl_x + arm, tl_y + stroke), fill=col)
    draw.rectangle((tl_x, tl_y, tl_x + stroke, tl_y + arm), fill=col)

    # TR: (2454 - arm, 132)
    tr_x, tr_y = 2454 - arm, 132
    draw.rectangle((tr_x, tr_y, tr_x + arm, tr_y + stroke), fill=col)
    draw.rectangle((tr_x + arm - stroke, tr_y, tr_x + arm, tr_y + arm), fill=col)

    # BL: (106, 1308 - arm)
    bl_x, bl_y = 106, 1308 - arm
    draw.rectangle((bl_x, bl_y, bl_x + stroke, bl_y + arm), fill=col)
    draw.rectangle((bl_x, bl_y + arm - stroke, bl_x + arm, bl_y + arm), fill=col)

    # BR: (2454 - arm, 1308 - arm)
    br_x, br_y = 2454 - arm, 1308 - arm
    draw.rectangle((br_x + arm - stroke, br_y, br_x + arm, br_y + arm), fill=col)
    draw.rectangle((br_x, br_y + arm - stroke, br_x + arm, br_y + arm), fill=col)

    # Chapter number pill / label in teal
    f_num = get_font("mono_bold", 38)
    f_title = get_font("bold", 96)
    f_sub = get_font("regular", 46)

    # Subtle teal chapter pill at y = 520
    paste_aa_rounded_box(
        img,
        1280 - 68,
        490,
        1280 + 68,
        554,
        radius=16,
        fill_color=(240, 253, 250),
        border_color=C_TEAL,
        border_w=3,
    )
    draw_centered_text(draw, 1280, 522, ch_num, f_num, C_TEAL)
    draw_centered_text(draw, 1280, 666, title.upper(), f_title, C_TEXT)
    draw_centered_text(draw, 1280, 796, subtitle, f_sub, C_SUB)

    return img


def title_card_envelope(local_f: int) -> float:
    """
    Fade envelope across the 36 frames (local_f = 0..35):
      - local_f = 0..7 (8 frames): fade in from #FFFFFF (alpha = (local_f + 1) / 8.0)
      - local_f = 8..27 (20 frames): full hold (alpha = 1.0)
      - local_f = 28..35 (8 frames): fade out to #FFFFFF (alpha = (35 - local_f) / 8.0)
    """
    if local_f <= 7:
        return (local_f + 1) / 8.0
    elif local_f <= 27:
        return 1.0
    else:
        return (35 - local_f) / 8.0


def render_title_card_frame(chapter_idx: int, local_f: int) -> Image.Image:
    card_cache_path = CARDS_DIR / f"title_ch{chapter_idx}_{local_f:03d}.png"
    if card_cache_path.exists():
        try:
            return Image.open(card_cache_path).convert("RGB")
        except Exception:
            pass
    spec = TITLE_CARDS_SPEC[chapter_idx]
    base = render_title_card_base(spec["num"], spec["title"], spec["subtitle"])
    alpha = title_card_envelope(local_f)
    return apply_fade_to_bg(base, alpha)


# ============================================================================
# CHAPTER 1 SPECIAL OVERLAYS (LIGHT THEME, MINIMAL TEXT)
# ============================================================================
def draw_ch1_tile_legend_bar(canvas: Image.Image):
    """
    Shot 02 (0036..0089): Clean white card at bottom showing the 4 simple tile chips:
    `NUL · Empty`, `CRS · 6-Way Hub`, `VTB · Vertical Tube`, `HTB · Horizontal Tube`
    without socket array brackets.
    """
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))

    x0, y0 = 90, 1236
    x1, y1 = 1690, 1324
    paste_aa_rounded_box(
        overlay,
        x0,
        y0,
        x1,
        y1,
        radius=18,
        fill_color=(248, 250, 252, 244),
        border_color=(*C_VP_BORDER, 255),
        border_w=3,
    )

    odraw = ImageDraw.Draw(overlay)
    f_chip = get_font("bold", 25)

    items = [
        ("NUL  \u00b7  Empty", (148, 163, 184)),
        ("CRS  \u00b7  6-Way Hub", (236, 72, 153)),
        ("VTB  \u00b7  Vertical Tube", (56, 189, 248)),
        ("HTB  \u00b7  Horizontal Tube", (100, 116, 139)),
    ]

    cur_x = x0 + 32
    for label_txt, swatch_col in items:
        paste_aa_rounded_box(
            overlay,
            cur_x,
            y0 + 25,
            cur_x + 38,
            y0 + 63,
            radius=8,
            fill_color=(*swatch_col, 255),
            border_color=(15, 23, 42, 45),
            border_w=2,
        )
        bbox = odraw.textbbox((0, 0), label_txt, font=f_chip)
        ty = y0 + (88 - (bbox[3] - bbox[1])) / 2.0 - bbox[1]
        odraw.text((cur_x + 52, ty), label_txt, font=f_chip, fill=(*C_TEXT, 255))
        cur_x += 392

    composited = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    canvas.paste(composited.convert("RGB"))


def draw_matrix_table(
    overlay: Image.Image,
    x0: int,
    y0: int,
    axis_idx: int,
    cell_w: int = 86,
    cell_h: int = 56,
    hdr_w: int = 92,
    hdr_h: int = 48,
    active_lookups=None,
    highlight_axis: bool = False,
):
    """Draws a crisp anti-aliased light-themed 4x4 Adjacency Matrix table for axis_idx in {0,1,2}."""
    short_ax = ["X", "Y", "Z"][axis_idx]
    active_lookups = active_lookups or []
    active_rows = {r["rowA"] for r in active_lookups}
    active_cols = {r["colB"] for r in active_lookups}

    odraw = ImageDraw.Draw(overlay)
    f_hdr = get_font("mono_bold", 20)
    f_cell = get_font("mono_bold", 24)
    f_corner = get_font("mono_bold", 18)

    # Corner label
    cx0, cy0 = x0, y0
    paste_aa_rounded_box(
        overlay,
        cx0,
        cy0,
        cx0 + hdr_w - 6,
        cy0 + hdr_h - 6,
        radius=8,
        fill_color=(241, 245, 249, 255),
        border_color=(203, 213, 225, 255),
        border_w=2,
    )
    draw_centered_text(
        odraw,
        cx0 + (hdr_w - 6) / 2,
        cy0 + (hdr_h - 6) / 2,
        f"{short_ax}",
        f_corner,
        (*C_TEAL, 255) if highlight_axis else (*C_MUTED, 255),
    )

    # Column headers
    for b in range(4):
        hx0 = x0 + hdr_w + b * cell_w
        hy0 = y0
        is_act = b in active_cols
        paste_aa_rounded_box(
            overlay,
            hx0,
            hy0,
            hx0 + cell_w - 6,
            hy0 + hdr_h - 6,
            radius=8,
            fill_color=(254, 243, 199, 255) if is_act else (241, 245, 249, 255),
            border_color=(*C_AMBER, 255) if is_act else (203, 213, 225, 255),
            border_w=3 if is_act else 2,
        )
        draw_centered_text(
            odraw,
            hx0 + (cell_w - 6) / 2,
            hy0 + (hdr_h - 6) / 2,
            TILES[b]["short"],
            f_hdr,
            (*C_AMBER, 255) if is_act else (*C_TEXT, 255),
        )

    # Rows
    for a in range(4):
        ry0 = y0 + hdr_h + a * cell_h
        is_row_act = a in active_rows
        paste_aa_rounded_box(
            overlay,
            x0,
            ry0,
            x0 + hdr_w - 6,
            ry0 + cell_h - 6,
            radius=8,
            fill_color=(254, 243, 199, 255) if is_row_act else (241, 245, 249, 255),
            border_color=(*C_AMBER, 255) if is_row_act else (203, 213, 225, 255),
            border_w=3 if is_row_act else 2,
        )
        draw_centered_text(
            odraw,
            x0 + (hdr_w - 6) / 2,
            ry0 + (cell_h - 6) / 2,
            TILES[a]["short"],
            f_hdr,
            (*C_AMBER, 255) if is_row_act else (*C_TEXT, 255),
        )

        for b in range(4):
            cx = x0 + hdr_w + b * cell_w
            val = SOCKET_RULES[axis_idx][a][b]
            match = next((r for r in active_lookups if r["rowA"] == a and r["colB"] == b), None)

            if match is not None:
                if match.get("allowed", bool(val)):
                    fill_col = (209, 250, 229, 255)
                    border_col = (*C_GREEN, 255)
                    txt_col = (*C_GREEN_DARK, 255)
                    bw = 4
                else:
                    fill_col = (255, 228, 230, 255)
                    border_col = (*C_ROSE, 255)
                    txt_col = (*C_ROSE_DARK, 255)
                    bw = 4
            else:
                if val == 1:
                    fill_col = (240, 253, 250, 255)
                    border_col = (153, 246, 228, 255)
                    txt_col = (*C_TEAL_DARK, 255)
                    bw = 2
                else:
                    fill_col = (255, 255, 255, 255)
                    border_col = (226, 232, 240, 255)
                    txt_col = (148, 163, 184, 255)
                    bw = 2

            paste_aa_rounded_box(
                overlay,
                cx,
                ry0,
                cx + cell_w - 6,
                ry0 + cell_h - 6,
                radius=8,
                fill_color=fill_col,
                border_color=border_col,
                border_w=bw,
            )
            draw_centered_text(
                odraw,
                cx + (cell_w - 6) / 2,
                ry0 + (cell_h - 6) / 2,
                str(val),
                f_cell,
                txt_col,
            )


def draw_ch1_three_matrices_overlay(canvas: Image.Image, local_f: int):
    """
    Shot 04 (0144..0197, 54f): Clean light-themed card on the right showing
    `X Axis`, `Y Axis`, `Z Axis` 4x4 matrices on a #F8FAFC card, no footer text.
    """
    active_axis = min(2, local_f // 18)
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))

    px0, py0 = 1860, 114
    px1, py1 = 2472, 1326
    paste_aa_rounded_box(
        overlay,
        px0,
        py0,
        px1,
        py1,
        radius=20,
        fill_color=(248, 250, 252, 246),
        border_color=(*C_VP_BORDER, 255),
        border_w=3,
    )

    odraw = ImageDraw.Draw(overlay)
    f_hdr = get_font("bold", 26)

    axis_titles = [
        ("X Axis", C_TEAL_DARK),
        ("Y Axis", C_TEAL),
        ("Z Axis", C_CYAN),
    ]

    for ax in range(3):
        card_y0 = py0 + 26 + ax * 392
        card_y1 = card_y0 + 368
        is_sel = ax == active_axis
        t_str, acc_col = axis_titles[ax]

        paste_aa_rounded_box(
            overlay,
            px0 + 22,
            card_y0,
            px1 - 22,
            card_y1,
            radius=16,
            fill_color=(255, 255, 255, 255),
            border_color=(*acc_col, 255) if is_sel else (203, 213, 225, 255),
            border_w=4 if is_sel else 2,
        )
        odraw.text((px0 + 48, card_y0 + 18), t_str, font=f_hdr, fill=(*acc_col, 255) if is_sel else (*C_SUB, 255))

        draw_matrix_table(
            overlay,
            x0=px0 + 62,
            y0=card_y0 + 70,
            axis_idx=ax,
            cell_w=98,
            cell_h=56,
            hdr_w=96,
            hdr_h=48,
            highlight_axis=is_sel,
        )

    composited = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    canvas.paste(composited.convert("RGB"))


# ============================================================================
# LAYOUT C1: CHAPTER 1 SUB-STEP SPLIT SCREEN (Frames 0198..0389)
# ============================================================================
_SUBSTEP_META_CACHE = None


def get_substep_meta():
    global _SUBSTEP_META_CACHE
    if _SUBSTEP_META_CACHE is not None:
        return _SUBSTEP_META_CACHE

    meta_path = RAW_DIR / "ch1" / "substep_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "frames" in data:
                    _SUBSTEP_META_CACHE = data["frames"]
                elif isinstance(data, list):
                    _SUBSTEP_META_CACHE = data
                if _SUBSTEP_META_CACHE:
                    return _SUBSTEP_META_CACHE
        except Exception:
            pass

    fallback = []
    sample_events = [
        {"axis": 0, "allowed": False, "rulesChecked": [{"rowA": 1, "colB": 0, "allowed": False}]},
        {"axis": 0, "allowed": True,  "rulesChecked": [{"rowA": 1, "colB": 1, "allowed": True}]},
        {"axis": 0, "allowed": False, "rulesChecked": [{"rowA": 1, "colB": 2, "allowed": False}]},
        {"axis": 0, "allowed": True,  "rulesChecked": [{"rowA": 1, "colB": 3, "allowed": True}]},
        {"axis": 1, "allowed": False, "rulesChecked": [{"rowA": 1, "colB": 3, "allowed": False}]},
        {"axis": 2, "allowed": True,  "rulesChecked": [{"rowA": 1, "colB": 2, "allowed": True}]},
    ]
    for i in range(192):
        ev = dict(sample_events[(i // 16) % len(sample_events)])
        fallback.append(ev)
    return fallback


def render_layout_c1_substep(local_f: int) -> Image.Image:
    """
    Shot 05 (Frames 0198..0389, 192f):
      - Left panel (#F8FAFC card on #FFFFFF canvas):
        - Header: "Rule Lookup"
        - Axis tabs: "X Axis", "Y Axis", "Z Axis"
        - Large 4x4 matrix (NUL, CRS, VTB, HTB) with highlighted active row & column
        - Single clean status banner below the matrix: e.g. "Y Axis:  CRS → CRS = 1 (Allowed)"
          in emerald or "0 (Denied)" in rose — no code snippet box, no coordinate string, no socket table!
      - Right panel (3D viewport):
        - Top-left pill: "3D Neighbor Check  ·  Green = Allowed, Red = Denied"
    """
    canvas = Image.new("RGB", (W, H), BG_CANVAS)

    # 1. Right Panel: 3D Sub-Step Viewport
    vp_img = load_raw_image(f"ch1/substep_vp_{local_f:03d}.png")
    place_rounded_viewport(canvas, vp_img, 1066, 80, 2507, 1360, rx=20)

    draw_stage_badge(
        canvas,
        x=1100,
        y=114,
        title_str="3D Neighbor Check  \u00b7  Green = Allowed, Red = Denied",
        accent=C_TEAL,
    )

    # 2. Left Panel: Clean Light Rule Lookup Panel
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    lx0, ly0, lx1, ly1 = 53, 80, 1040, 1360
    paste_aa_rounded_box(
        overlay,
        lx0,
        ly0,
        lx1,
        ly1,
        radius=20,
        fill_color=(*C_PANEL, 255),
        border_color=(*C_VP_BORDER, 255),
        border_w=3,
    )

    odraw = ImageDraw.Draw(overlay)

    # Header: "Rule Lookup"
    paste_aa_rounded_box(
        overlay,
        lx0 + 28,
        ly0 + 28,
        lx1 - 28,
        ly0 + 106,
        radius=14,
        fill_color=(255, 255, 255, 255),
        border_color=(226, 232, 240, 255),
        border_w=2,
    )
    paste_aa_rounded_box(
        overlay,
        lx0 + 50,
        ly0 + 46,
        lx0 + 58,
        ly0 + 88,
        radius=4,
        fill_color=(*C_TEAL, 255),
    )
    f_hdr = get_font("bold", 34)
    odraw.text((lx0 + 78, ly0 + 44), "Rule Lookup", font=f_hdr, fill=(*C_TEXT, 255))

    # Fetch sub-step metadata for this frame
    meta_list = get_substep_meta()
    ev = meta_list[min(local_f, len(meta_list) - 1)] if meta_list else {}
    if "substep" in ev and isinstance(ev["substep"], dict):
        ev = ev["substep"]

    active_axis = int(ev.get("axis", 0) or 0)
    allowed = bool(ev.get("allowed", True))
    rules_checked = ev.get("rulesChecked", [])
    if not rules_checked and "rowA" in ev and "colB" in ev:
        rules_checked = [{"rowA": ev["rowA"], "colB": ev["colB"], "allowed": allowed}]
    if not rules_checked:
        rules_checked = [{"rowA": 1, "colB": 1 if allowed else 0, "allowed": allowed}]

    row_a = int(rules_checked[0].get("rowA", 1))
    col_b = int(rules_checked[0].get("colB", 1))
    tile_a = TILES[min(3, max(0, row_a))]["short"]
    tile_b = TILES[min(3, max(0, col_b))]["short"]
    axis_name = ["X Axis", "Y Axis", "Z Axis"][min(2, max(0, active_axis))]

    # Axis tabs: "X Axis", "Y Axis", "Z Axis"
    axis_labels = ["X Axis", "Y Axis", "Z Axis"]
    tab_w = 296
    tab_gap = 20
    for ax in range(3):
        tx0 = lx0 + 30 + ax * (tab_w + tab_gap)
        ty0 = ly0 + 136
        tx1 = tx0 + tab_w
        ty1 = ty0 + 68
        is_on = ax == active_axis
        paste_aa_rounded_box(
            overlay,
            tx0,
            ty0,
            tx1,
            ty1,
            radius=14,
            fill_color=(240, 253, 250, 255) if is_on else (255, 255, 255, 255),
            border_color=(*C_TEAL, 255) if is_on else (203, 213, 225, 255),
            border_w=4 if is_on else 2,
        )
        draw_centered_text(
            odraw,
            (tx0 + tx1) / 2,
            (ty0 + ty1) / 2,
            axis_labels[ax],
            get_font("bold", 26),
            (*C_TEAL_DARK, 255) if is_on else (*C_SUB, 255),
        )

    # Large 4x4 Matrix Card
    mat_box_y0 = ly0 + 234
    mat_box_y1 = ly0 + 980
    paste_aa_rounded_box(
        overlay,
        lx0 + 30,
        mat_box_y0,
        lx1 - 30,
        mat_box_y1,
        radius=18,
        fill_color=(255, 255, 255, 255),
        border_color=(203, 213, 225, 255),
        border_w=3,
    )

    draw_matrix_table(
        overlay,
        x0=lx0 + 70,
        y0=mat_box_y0 + 48,
        axis_idx=active_axis,
        cell_w=178,
        cell_h=136,
        hdr_w=142,
        hdr_h=96,
        active_lookups=rules_checked,
        highlight_axis=True,
    )

    # Single clean status banner below the matrix
    call_y0 = ly0 + 1020
    call_y1 = ly0 + 1180
    acc_col = C_GREEN if allowed else C_ROSE
    txt_col = C_GREEN_DARK if allowed else C_ROSE_DARK
    fill_tint = (236, 253, 245, 255) if allowed else (255, 241, 242, 255)
    status_str = f"{axis_name}:   {tile_a} \u2192 {tile_b} = {'1 (Allowed)' if allowed else '0 (Denied)'}"

    paste_aa_rounded_box(
        overlay,
        lx0 + 30,
        call_y0,
        lx1 - 30,
        call_y1,
        radius=18,
        fill_color=fill_tint,
        border_color=(*acc_col, 255),
        border_w=4,
    )
    draw_centered_text(
        odraw,
        (lx0 + lx1) / 2,
        (call_y0 + call_y1) / 2,
        status_str,
        get_font("bold", 34),
        (*txt_col, 255),
    )

    composited = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    res = composited.convert("RGB")

    # Fade out last 8 frames (382..389 -> local_f 184..191) to #FFFFFF
    if local_f >= 184:
        alpha = (191 - local_f) / 8.0
        res = apply_fade_to_bg(res, alpha)

    return res


def render_ch1_substep_split(local_f: int) -> Image.Image:
    return render_layout_c1_substep(local_f)


# ============================================================================
# LAYOUT E: CHAPTER 2 PROGRESSIVE 3-STAGE STACK (Frames 0426..0545, WHITE THEME)
# ============================================================================
def render_ch2_stack_frame(local_f: int, use_cache: bool = True) -> Image.Image:
    """
    Shot 07 (0426..0545, 120f / 4.00s): Simplified Keyframe on White #FFFFFF background.
    3 clean horizontal cards (#F8FAFC fill, #CBD5E1 border), progressively revealed:
      - Card 1 (0..10): "1. Next Cell"
        - Left (Adjacency Growth, teal #0F766E): "Random frontier neighbor"
        - Right (WFC Collapse, magenta #BE185D): "Lowest-entropy cell first"
      - Card 2 (34..46): "2. Rule Check"
        - Left (Adjacency Growth, teal #0F766E): "Checks collapsed neighbors at placement"
        - Right (WFC Collapse, magenta #BE185D): "Propagates rules ahead of time"
      - Card 3 (68..80): "3. Growth Pattern"
        - Left (Adjacency Growth, teal #0F766E): "Branches outward from seed"
        - Right (WFC Collapse, magenta #BE185D): "Prunes possibilities across grid"
    Zero STAGE 01..03 pills and zero code boxes! Large 32pt bold titles and 28pt comparison phrases!
    """
    cache_path = CARDS_DIR / f"ch2_stack_{local_f:03d}.png"
    if use_cache and cache_path.exists():
        try:
            return Image.open(cache_path).convert("RGB")
        except Exception:
            pass

    canvas = Image.new("RGB", (W, H), BG_CANVAS)

    def blend_with_white(col, factor: float):
        factor = max(0.0, min(1.0, float(factor)))
        return (
            int(round(255 + (col[0] - 255) * factor)),
            int(round(255 + (col[1] - 255) * factor)),
            int(round(255 + (col[2] - 255) * factor)),
        )

    stages = [
        {
            "reveal_f": 0,
            "span": 11.0,
            "y0": 135,
            "title": "1. Next Cell",
            "accent": C_TEAL,
            "col_a_title": "Adjacency Growth",
            "col_a_body": "Random frontier neighbor",
            "col_b_title": "WFC Collapse",
            "col_b_body": "Lowest-entropy cell first",
        },
        {
            "reveal_f": 34,
            "span": 13.0,
            "y0": 560,
            "title": "2. Rule Check",
            "accent": C_CYAN,
            "col_a_title": "Adjacency Growth",
            "col_a_body": "Checks collapsed neighbors at placement",
            "col_b_title": "WFC Collapse",
            "col_b_body": "Propagates rules ahead of time",
        },
        {
            "reveal_f": 68,
            "span": 13.0,
            "y0": 985,
            "title": "3. Growth Pattern",
            "accent": C_TEAL_DARK,
            "col_a_title": "Adjacency Growth",
            "col_a_body": "Branches outward from seed",
            "col_b_title": "WFC Collapse",
            "col_b_body": "Prunes possibilities across grid",
        },
    ]

    draw = ImageDraw.Draw(canvas)
    card_h = 320

    # Vertical connector lines at x = 1280 between cards
    for conn_idx in range(2):
        cy0 = stages[conn_idx]["y0"] + card_h
        cy1 = stages[conn_idx + 1]["y0"]
        next_rev = stages[conn_idx + 1]["reveal_f"]
        next_span = stages[conn_idx + 1]["span"]
        if local_f < next_rev:
            active_amt = 0.22
        else:
            active_amt = min(1.0, 0.22 + 0.78 * ((local_f - next_rev + 1) / next_span))
        col_line = blend_with_white(C_TEAL, active_amt)
        draw.rectangle((1277, cy0, 1283, cy1), fill=col_line)

    f_card_title = get_font("bold", 42)     # >32pt bold title
    f_col_hdr = get_font("bold", 28)        # Solver label
    f_col_body = get_font("semibold", 34)   # >28pt ultra-legible comparison phrase

    for st in stages:
        rev = st["reveal_f"]
        span = st["span"]
        if local_f < rev:
            vis = 0.16
        else:
            vis = min(1.0, 0.16 + 0.84 * ((local_f - rev + 1) / span))

        x0, y0 = 280, st["y0"]
        x1, y1 = 2280, y0 + card_h
        acc = blend_with_white(st["accent"], vis)
        border_col = blend_with_white(C_VP_BORDER, vis)

        # Outer card (#F8FAFC fill, #CBD5E1 anti-aliased border)
        paste_aa_rounded_box(
            canvas,
            x0,
            y0,
            x1,
            y1,
            radius=22,
            fill_color=blend_with_white(C_PANEL, vis),
            border_color=border_col,
            border_w=3,
        )

        # Left vertical accent bar inside card
        paste_aa_rounded_box(
            canvas,
            x0 + 28,
            y0 + 28,
            x0 + 38,
            y1 - 28,
            radius=5,
            fill_color=acc,
        )

        # Card Title
        draw.text((x0 + 64, y0 + 28), st["title"], font=f_card_title, fill=blend_with_white(C_TEXT, vis))

        # Two clean comparison columns inside the card
        col_y0 = y0 + 104
        col_y1 = y1 - 28

        # Column A (Left: Adjacency Growth, teal #0F766E)
        ca_x0, ca_x1 = x0 + 64, 1260
        paste_aa_rounded_box(
            canvas,
            ca_x0,
            col_y0,
            ca_x1,
            col_y1,
            radius=16,
            fill_color=blend_with_white((255, 255, 255), vis),
            border_color=blend_with_white((153, 246, 228), vis),
            border_w=3,
        )
        paste_aa_rounded_box(
            canvas,
            ca_x0 + 24,
            col_y0 + 24,
            ca_x0 + 32,
            col_y1 - 24,
            radius=4,
            fill_color=blend_with_white(C_TEAL_DARK, vis),
        )
        draw.text((ca_x0 + 52, col_y0 + 24), st["col_a_title"], font=f_col_hdr, fill=blend_with_white(C_TEAL_DARK, vis))
        draw.text((ca_x0 + 52, col_y0 + 82), st["col_a_body"], font=f_col_body, fill=blend_with_white(C_TEXT, vis))

        # Column B (Right: WFC Collapse, magenta #BE185D)
        cb_x0, cb_x1 = 1300, x1 - 40
        paste_aa_rounded_box(
            canvas,
            cb_x0,
            col_y0,
            cb_x1,
            col_y1,
            radius=16,
            fill_color=blend_with_white((255, 255, 255), vis),
            border_color=blend_with_white((251, 207, 232), vis),
            border_w=3,
        )
        paste_aa_rounded_box(
            canvas,
            cb_x0 + 24,
            col_y0 + 24,
            cb_x0 + 32,
            col_y1 - 24,
            radius=4,
            fill_color=blend_with_white(C_PINK, vis),
        )
        draw.text((cb_x0 + 52, col_y0 + 24), st["col_b_title"], font=f_col_hdr, fill=blend_with_white(C_PINK, vis))
        draw.text((cb_x0 + 52, col_y0 + 82), st["col_b_body"], font=f_col_body, fill=blend_with_white(C_TEXT, vis))

    # Fade out last 8 frames (local_f >= 112) to #FFFFFF
    if local_f >= 112:
        alpha = (119 - local_f) / 8.0
        canvas = apply_fade_to_bg(canvas, alpha)

    return canvas


# ============================================================================
# CHAPTER 2: DUAL SYNCHRONIZED VIEWPORT RACE (Frames 0546..0725)
# ============================================================================
def render_ch2_dual_race(local_f: int) -> Image.Image:
    """
    Shot 08 (0546..0725, 180f / 6.00s):
      - Left pill: "Adjacency Growth  ·  Random Frontier"
      - Right pill: "WFC Collapse  ·  Lowest Entropy"
    """
    canvas = Image.new("RGB", (W, H), BG_CANVAS)

    img_g = load_raw_image(f"ch2/race_growth_{local_f:03d}.png")
    img_w = load_raw_image(f"ch2/race_wfc_{local_f:03d}.png")

    place_rounded_viewport(canvas, img_g, 53, 80, 1267, 1360, rx=20)
    place_rounded_viewport(canvas, img_w, 1293, 80, 2507, 1360, rx=20)

    draw_stage_badge(
        canvas,
        x=86,
        y=114,
        title_str="Adjacency Growth  \u00b7  Random Frontier",
        accent=C_TEAL_DARK,
    )
    draw_stage_badge(
        canvas,
        x=1326,
        y=114,
        title_str="WFC Collapse  \u00b7  Lowest Entropy",
        accent=C_PINK,
    )

    return canvas


# ============================================================================
# LAYOUT D: CHAPTER 3 2x2 QUAD GRID OVERVIEW (Frames 0906..1037)
# ============================================================================
def render_ch3_quad_grid(local_f: int) -> Image.Image:
    """
    Shot 12 (0906..1037, 132f): 2x2 grid on #FFFFFF canvas with crisp #CBD5E1 borders:
      - Top-left: "10×10×10 Cube  ·  All 4 Tiles"
      - Top-right: "4×4×8 Tower  ·  CRS + VTB"
      - Bottom-left: "6×6×1 Slab  ·  CRS + HTB"
      - Bottom-right: "5×5×5 Cube  ·  All Rules Open"
    """
    canvas = Image.new("RGB", (W, H), BG_CANVAS)

    v1 = load_raw_image(f"ch3/v1_{local_f:03d}.png")
    v2 = load_raw_image(f"ch3/v2_{local_f:03d}.png")
    v3 = load_raw_image(f"ch3/v3_{local_f:03d}.png")
    v4 = load_raw_image(f"ch3/v4_{local_f:03d}.png")

    place_rounded_viewport(canvas, v1, 40, 36, 1266, 706, rx=18)
    place_rounded_viewport(canvas, v2, 1294, 36, 2520, 706, rx=18)
    place_rounded_viewport(canvas, v3, 40, 734, 1266, 1404, rx=18)
    place_rounded_viewport(canvas, v4, 1294, 734, 2520, 1404, rx=18)

    draw_stage_badge(canvas, x=68, y=64, title_str="10\u00d710\u00d710 Cube  \u00b7  All 4 Tiles", accent=C_TEAL)
    draw_stage_badge(canvas, x=1322, y=64, title_str="4\u00d74\u00d78 Tower  \u00b7  CRS + VTB", accent=C_CYAN)
    draw_stage_badge(canvas, x=68, y=762, title_str="6\u00d76\u00d71 Slab  \u00b7  CRS + HTB", accent=C_TEAL_DARK)
    draw_stage_badge(canvas, x=1322, y=762, title_str="5\u00d75\u00d75 Cube  \u00b7  All Rules Open", accent=C_AMBER)

    return canvas


# ============================================================================
# CHAPTER 4: RHINO (.3DM) EXPORT BUTTON PILL (Shot 20 Only)
# ============================================================================
def draw_ch4_export_inset(canvas: Image.Image, stage_num: int = 3):
    """
    In Shot 18 & 19 (stage_num 1 & 2): No-op (zero code cards).
    In Shot 20 (stage_num == 3): Single clean bottom-right button pill (`▶  Export .3dm`)
    in emerald (16, 185, 129) with white bold text and a crisp vector triangle icon.
    """
    if stage_num != 3:
        return

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    bx0, by0 = 2080, 1226
    bx1, by1 = 2466, 1316

    paste_aa_rounded_box(
        overlay,
        bx0,
        by0,
        bx1,
        by1,
        radius=20,
        fill_color=(*C_GREEN, 255),
        border_color=(5, 150, 105, 255),
        border_w=3,
    )

    odraw = ImageDraw.Draw(overlay)
    cy_btn = (by0 + by1) / 2.0
    # Crisp vector triangle icon (supersampled via polygon on 2K canvas)
    odraw.polygon(
        [(bx0 + 44, cy_btn - 13), (bx0 + 44, cy_btn + 13), (bx0 + 66, cy_btn)],
        fill=(255, 255, 255, 255),
    )

    f_btn = get_font("bold", 30)
    draw_centered_text(
        odraw,
        (bx0 + bx1) / 2.0 + 18,
        cy_btn,
        "Export .3dm",
        f_btn,
        (255, 255, 255, 255),
    )

    composited = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    canvas.paste(composited.convert("RGB"))


# ============================================================================
# MASTER 1,800-FRAME DISPATCHER (60.00s @ 30.00 fps)
# ============================================================================
def render_master_frame(f: int) -> Image.Image:
    """Renders exact frame `f` in `0..1799` at 2560x1440 (2x supersampled for 1280x720 output)."""

    # ------------------------------------------------------------------------
    # CHAPTER 1: Frames 0000..0389 (00.00s - 13.00s | 390 frames)
    # ------------------------------------------------------------------------
    if 0 <= f <= 35:
        return render_title_card_frame(1, f - 0)

    if 36 <= f <= 89:
        local_f = f - 36
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch1/tiles_{local_f:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(canvas, x=90, y=114, title_str="4 Tile Primitives", accent=C_TEAL)
        draw_ch1_tile_legend_bar(canvas)
        return canvas

    if 90 <= f <= 143:
        local_f = f - 90
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch1/grid_{local_f:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        if local_f < 18:
            title = "Voxel Grid  \u00b7  4\u00d73\u00d71 Slab"
        elif local_f < 36:
            title = "Voxel Grid  \u00b7  4\u00d74\u00d78 Tower"
        else:
            title = "Voxel Grid  \u00b7  10\u00d710\u00d710 Cube"
        draw_stage_badge(canvas, x=90, y=114, title_str=title, accent=C_TEAL)
        return canvas

    if 144 <= f <= 197:
        local_f = f - 144
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch1/rules_{local_f:03d}.png", crop_left_sidebar=True)
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="Adjacency Rules  \u00b7  1 = Allow, 0 = Deny",
            accent=C_TEAL,
        )
        draw_ch1_three_matrices_overlay(canvas, local_f)
        return canvas

    if 198 <= f <= 389:
        return render_ch1_substep_split(f - 198)

    # ------------------------------------------------------------------------
    # CHAPTER 2: Frames 0390..0869 (13.00s - 29.00s | 480 frames)
    # ------------------------------------------------------------------------
    if 390 <= f <= 425:
        return render_title_card_frame(2, f - 390)

    if 426 <= f <= 545:
        return render_ch2_stack_frame(f - 426)

    if 546 <= f <= 725:
        return render_ch2_dual_race(f - 546)

    if 726 <= f <= 797:
        local_f = f - 726
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch2/mech_growth_{local_f:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="Adjacency Growth  \u00b7  Checks Collapsed Neighbors",
            accent=C_TEAL_DARK,
        )
        return canvas

    if 798 <= f <= 869:
        local_f = f - 798
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch2/mech_wfc_{local_f:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="WFC Collapse  \u00b7  Prunes Neighbor Possibilities",
            accent=C_PINK,
        )
        if f >= 862:
            alpha = (869 - f) / 8.0
            canvas = apply_fade_to_bg(canvas, alpha)
        return canvas

    # ------------------------------------------------------------------------
    # CHAPTER 3: Frames 0870..1469 (29.00s - 49.00s | 600 frames)
    # ------------------------------------------------------------------------
    if 870 <= f <= 905:
        return render_title_card_frame(3, f - 870)

    if 906 <= f <= 1037:
        return render_ch3_quad_grid(f - 906)

    if 1038 <= f <= 1145:
        idx = 132 + (f - 1038)
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch3/v1_{idx:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="10\u00d710\u00d710 Cube  \u00b7  All 4 Tiles  \u00b7  Socket Rules",
            accent=C_TEAL,
        )
        return canvas

    if 1146 <= f <= 1253:
        idx = 132 + (f - 1146)
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch3/v2_{idx:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="4\u00d74\u00d78 Tower  \u00b7  CRS + VTB Only",
            accent=C_CYAN,
        )
        return canvas

    if 1254 <= f <= 1361:
        idx = 132 + (f - 1254)
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch3/v3_{idx:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="6\u00d76\u00d71 Slab  \u00b7  CRS + HTB Only",
            accent=C_TEAL_DARK,
        )
        return canvas

    if 1362 <= f <= 1469:
        idx = 132 + (f - 1362)
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch3/v4_{idx:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="5\u00d75\u00d75 Cube  \u00b7  All Rules Open",
            accent=C_AMBER,
        )
        if f >= 1462:
            alpha = (1469 - f) / 8.0
            canvas = apply_fade_to_bg(canvas, alpha)
        return canvas

    # ------------------------------------------------------------------------
    # CHAPTER 4: Frames 1470..1799 (49.00s - 60.00s | 330 frames)
    # ------------------------------------------------------------------------
    if 1470 <= f <= 1505:
        return render_title_card_frame(4, f - 1470)

    if 1506 <= f <= 1601:
        idx = f - 1506
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch4/shaded_{idx:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="Quad-Mesh Wireframe  \u00b7  4-Sided Faces Only",
            accent=C_TEAL,
        )
        return canvas

    if 1602 <= f <= 1697:
        idx = 96 + (f - 1602)
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        arctic_img = load_raw_image(f"ch4/arctic_{idx:03d}.png")
        if f <= 1631:
            shaded_img = load_raw_image(f"ch4/shaded_{idx:03d}.png")
            s_fit = fit_cover(shaded_img, 2454, 1280)
            a_fit = fit_cover(arctic_img, 2454, 1280)
            blend_t = (f - 1602 + 1) / 30.0
            vp = Image.blend(s_fit, a_fit, blend_t)
        else:
            vp = arctic_img

        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="Arctic Clay Shading  \u00b7  Ambient Occlusion",
            accent=C_TEAL,
        )
        return canvas

    if 1698 <= f <= 1799:
        idx = 192 + (f - 1698)
        canvas = Image.new("RGB", (W, H), BG_CANVAS)
        vp = load_raw_image(f"ch4/arctic_{idx:03d}.png")
        place_rounded_viewport(canvas, vp, 53, 80, 2507, 1360, rx=20)
        draw_stage_badge(
            canvas,
            x=90,
            y=114,
            title_str="Native Rhino .3dm Export  \u00b7  8,320 Quad Faces",
            accent=C_GREEN,
        )
        draw_ch4_export_inset(canvas, stage_num=3)

        # Smooth 45-frame (1.50s) fade-to-white across frames 1755..1799
        if f >= 1755:
            alpha = (1799 - f) / 45.0
            canvas = apply_fade_to_bg(canvas, alpha)
        return canvas

    return Image.new("RGB", (W, H), BG_CANVAS)


# ============================================================================
# PRE-RENDER CARDS & FULL COMPOSITE RUNNERS
# ============================================================================
def pre_render_cards():
    """
    Renders and saves all 4 Chapter Title Cards (36f each) and the Chapter 2
    Progressive 3-Stage Stack (120f) into `video_build/raw/cards/` (at 2560x1440) AND
    writes their corresponding 2x-supersampled 1280x720 frame_XXXX.jpg files into `video_build/frames/`.
    """
    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/2] Pre-rendering 4 White-Theme Chapter Title Cards (4 x 36 = 144 frames)...")
    for ch_idx, spec in TITLE_CARDS_SPEC.items():
        base_img = render_title_card_base(spec["num"], spec["title"], spec["subtitle"])
        start_f = spec["start_frame"]
        for local_f in range(36):
            alpha = title_card_envelope(local_f)
            frame_img = apply_fade_to_bg(base_img, alpha)
            card_path = CARDS_DIR / f"title_ch{ch_idx}_{local_f:03d}.png"
            frame_img.save(card_path, format="PNG", compress_level=1)
            global_f = start_f + local_f
            frame_jpg = FRAMES_DIR / f"frame_{global_f:04d}.jpg"
            out_img = frame_img.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
            out_img.save(frame_jpg, format="JPEG", quality=95, subsampling=0)

    print("[2/2] Pre-rendering Chapter 2 Simplified 3-Stage Comparison Stack (120 frames: 426..545)...")
    for local_f in range(120):
        cache_path = CARDS_DIR / f"ch2_stack_{local_f:03d}.png"
        frame_img = render_ch2_stack_frame(local_f, use_cache=False)
        frame_img.save(cache_path, format="PNG", compress_level=1)
        global_f = 426 + local_f
        frame_jpg = FRAMES_DIR / f"frame_{global_f:04d}.jpg"
        out_img = frame_img.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
        out_img.save(frame_jpg, format="JPEG", quality=95, subsampling=0)

    print(f"Pre-render complete! Saved 264 standalone card frames to {CARDS_DIR} and {FRAMES_DIR}.")


def _render_and_save_single(f: int):
    img = render_master_frame(f)
    if img.size != (OUT_W, OUT_H):
        img = img.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
    out_path = FRAMES_DIR / f"frame_{f:04d}.jpg"
    img.save(out_path, format="JPEG", quality=95, subsampling=0)
    return f


def build_full_video(workers: int = 8):
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Rendering all {TOTAL_FRAMES} frames (2x supersampled {W}x{H} -> {OUT_W}x{OUT_H} @ {FPS:.2f} fps) with {workers} threads...")

    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_render_and_save_single, f): f for f in range(TOTAL_FRAMES)}
        for fut in as_completed(futures):
            _ = fut.result()
            completed += 1
            if completed % 100 == 0 or completed == TOTAL_FRAMES:
                print(f"  Rendered {completed}/{TOTAL_FRAMES} frames...")

    print(f"Encoding 720p HD MP4 to {OUTPUT_MP4} via FFmpeg 7.1...")
    cmd = [
        str(FFMPEG_EXE),
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        str(FRAMES_DIR / "frame_%04d.jpg"),
        "-r",
        str(FPS),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "17",
        "-preset",
        "fast",
        "-movflags",
        "+faststart",
        str(OUTPUT_MP4),
    ]
    subprocess.run(cmd, check=True)
    print(f"Master 60s 720p HD showcase video successfully created at: {OUTPUT_MP4}")

    for dst in (ROOT_MP4_720P, ROOT_MP4_2K):
        shutil.copy2(OUTPUT_MP4, dst)
        print(f"Copied output video to: {dst}")


def main():
    parser = argparse.ArgumentParser(description="720p HD White-Theme Master Video Compositor Engine")
    parser.add_argument(
        "--pre-render-cards",
        action="store_true",
        help="Pre-render standalone Title Cards and Chapter 2 Progressive 3-Stage Stack frames.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Number of worker threads for frame rendering.",
    )
    args = parser.parse_args()

    if args.pre_render_cards:
        pre_render_cards()
    else:
        build_full_video(workers=args.workers)


if __name__ == "__main__":
    main()
