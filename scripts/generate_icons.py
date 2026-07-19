"""Generate the extension's PNG icons.

We render an Apple-style app tile: rounded square with a linear-blue gradient
(system blue → indigo) and a white microphone glyph. All sizes come from the
same source SVG so the visuals stay consistent across 16/32/48/128px.
"""
from __future__ import annotations

import io
import os
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
OUT.mkdir(parents=True, exist_ok=True)

# 1024px master, then downscale for the extension slots.
MASTER = 1024
SIZES = [16, 32, 48, 128, 512]

SVG = f"""<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='{MASTER}' height='{MASTER}' viewBox='0 0 1024 1024'>
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0%' stop-color='#0A84FF'/>
      <stop offset='100%' stop-color='#5E5CE6'/>
    </linearGradient>
    <radialGradient id='highlight' cx='30%' cy='20%' r='60%'>
      <stop offset='0%' stop-color='white' stop-opacity='0.28'/>
      <stop offset='100%' stop-color='white' stop-opacity='0'/>
    </radialGradient>
    <filter id='shadow' x='-20%' y='-20%' width='140%' height='140%'>
      <feDropShadow dx='0' dy='16' stdDeviation='18' flood-opacity='0.20'/>
    </filter>
  </defs>

  <!-- Rounded tile with system-blue gradient -->
  <rect x='40' y='40' width='944' height='944' rx='232' ry='232' fill='url(#bg)' filter='url(#shadow)'/>
  <rect x='40' y='40' width='944' height='944' rx='232' ry='232' fill='url(#highlight)'/>

  <!-- Microphone glyph, centered -->
  <g fill='white' transform='translate(512 512)'>
    <!-- Capsule body -->
    <rect x='-120' y='-260' width='240' height='420' rx='120' ry='120'/>
    <!-- U-shaped bracket -->
    <path d='M -240 0
             a 240 240 0 0 0 480 0
             l -60 0
             a 180 180 0 1 1 -360 0 z'/>
    <!-- Stem -->
    <rect x='-24' y='200' width='48' height='120' rx='24' ry='24'/>
    <!-- Base -->
    <rect x='-160' y='300' width='320' height='48' rx='24' ry='24'/>
  </g>
</svg>
"""


def render(size: int) -> None:
    png_bytes = cairosvg.svg2png(bytestring=SVG.encode("utf-8"), output_width=size, output_height=size)
    with Image.open(io.BytesIO(png_bytes)) as im:
        im.save(OUT / f"icon{size}.png", optimize=True)
        print(f"wrote {OUT / f'icon{size}.png'} ({im.size[0]}x{im.size[1]})")


def main() -> None:
    for s in SIZES:
        render(s)


if __name__ == "__main__":
    main()
