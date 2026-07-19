"""Generate the extension's PNG icons.

Design (v0.3.0): a neutral utility icon — dark-charcoal circle with a
simple white microphone glyph. Explicit choices:

 - Circle, not the iOS-style rounded square, to avoid reading as an
   Apple app tile.
 - Flat solid fill, no gradient, no highlight, no drop shadow.
 - Single monochrome mic glyph (filled), designed to stay legible at
   16 px.
 - No brand colours; keep the tone tool-like and neutral.
 - A muted recording-capable dot at the top-right on larger sizes; it
   is dropped at 16/24 px so the shape survives sub-pixel rendering.

Sizes: 16, 32, 48, 128, 512.
"""
from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
OUT.mkdir(parents=True, exist_ok=True)

MASTER = 1024
SIZES = [16, 32, 48, 128, 512]

# Colours — deliberately tool-like, not iOS system palette.
BG = "#2A2A2E"       # dark charcoal
FG = "#F2F2F5"       # near-white with a hint of warmth
DOT = "#4AC98A"      # muted recording indicator

SVG_LARGE = f"""<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='{MASTER}' height='{MASTER}' viewBox='0 0 1024 1024'>
  <circle cx='512' cy='512' r='488' fill='{BG}'/>
  <g fill='{FG}' transform='translate(0 -20)'>
    <rect x='412' y='236' width='200' height='420' rx='100' ry='100'/>
    <path d='M 292 512
             a 220 220 0 0 0 440 0
             l -56 0
             a 164 164 0 1 1 -328 0 z'/>
    <rect x='488' y='700' width='48' height='120' rx='24' ry='24'/>
    <rect x='400' y='792' width='224' height='42' rx='21' ry='21'/>
  </g>
  <circle cx='820' cy='230' r='54' fill='{DOT}' opacity='0.9'/>
</svg>
"""

SVG_TINY = f"""<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='{MASTER}' height='{MASTER}' viewBox='0 0 1024 1024'>
  <circle cx='512' cy='512' r='488' fill='{BG}'/>
  <g fill='{FG}'>
    <rect x='388' y='228' width='248' height='452' rx='124' ry='124'/>
    <path d='M 260 520
             a 252 252 0 0 0 504 0
             l -72 0
             a 180 180 0 1 1 -360 0 z'/>
    <rect x='480' y='720' width='64' height='120' rx='32' ry='32'/>
    <rect x='372' y='808' width='280' height='60' rx='30' ry='30'/>
  </g>
</svg>
"""


def render(size: int) -> None:
    svg = SVG_TINY if size <= 24 else SVG_LARGE
    png_bytes = cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=size, output_height=size)
    with Image.open(io.BytesIO(png_bytes)) as im:
        im.save(OUT / f"icon{size}.png", optimize=True)
        print(f"wrote {OUT / f'icon{size}.png'} ({im.size[0]}x{im.size[1]})")


def main() -> None:
    for s in SIZES:
        render(s)


if __name__ == "__main__":
    main()
