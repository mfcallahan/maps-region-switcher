#!/usr/bin/env python3
"""Generate the extension's PNG icons with no third-party dependencies.

Design: a yellow shopping-tag label tilted 45 degrees, sitting on top of a
generic map background of green, tan and blue regions. Supersampled for
antialiasing and written as true-color-with-alpha PNGs using only zlib and
struct from the stdlib. Re-run after changing any constant below.
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = (16, 32, 48, 128)
SS = 5  # supersampling factor

# --- palette ---------------------------------------------------------------
GREEN = (0x8C, 0xC6, 0x76)   # land
TAN = (0xE2, 0xCE, 0x99)     # dry land / desert
BLUE = (0x6F, 0xB6, 0xDC)    # water
TAG = (0xFF, 0xC5, 0x26)     # the label itself
TAG_EDGE = (0x7A, 0x4F, 0x00)  # outline + punch hole, for definition at 16px

CORNER_R = 0.22              # rounded-square corner radius, fraction of side

# --- map background --------------------------------------------------------
# The tag lies along the down-left/up-right diagonal, so the background is only
# really visible in the four corners. Tan is a wedge in the top-left corner and
# water a wedge in the bottom-right, which puts all three colours on screen
# either side of the tag; green fills the rest. Boundaries are diagonal and sum
# two sines, so they read as irregular coastline rather than as flag stripes.
def map_colour(x, y):
    if 0.80 * x + 1.20 * y < 0.64 + 0.13 * math.sin(5.0 * x) + 0.05 * math.sin(12.0 * x + 1.7):
        return TAN
    if 0.70 * x + y > 1.13 + 0.12 * math.sin(5.0 * x + 1.0) + 0.05 * math.sin(10.0 * x + 2.4):
        return BLUE
    return GREEN


# --- tag geometry ----------------------------------------------------------
TAG_ANGLE = -45.0            # negative tilts the point up and to the right
TAG_CX, TAG_CY = 0.50, 0.52  # centre of the tag on the canvas
TAG_L, TAG_W = 0.74, 0.34    # length along the axis, width across it
TAPER_AT = 0.72              # fraction of the length where the point begins
HOLE_T = 0.85                # where the punch hole sits along the length
HOLE_R = 0.043
EDGE = 0.030                 # outline thickness

_c = math.cos(math.radians(TAG_ANGLE))
_s = math.sin(math.radians(TAG_ANGLE))


def tag_uv(x, y):
    """Canvas point -> tag-local (u along the axis, v across it)."""
    dx, dy = x - TAG_CX, y - TAG_CY
    return dx * _c + dy * _s, -dx * _s + dy * _c


def in_tag(u, v, length, width):
    if abs(u) > length / 2.0:
        return False
    t = (u + length / 2.0) / length          # 0 at the blunt end, 1 at the point
    half = width / 2.0
    if t > TAPER_AT:
        half *= (1.0 - t) / (1.0 - TAPER_AT)
    return abs(v) <= half


# --- rasteriser ------------------------------------------------------------
def in_rounded_rect(x, y, r):
    if r <= 0:
        return True
    cx = min(max(x, r), 1.0 - r)
    cy = min(max(y, r), 1.0 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def sample(x, y):
    """Return straight RGBA for a point in the unit square."""
    if not in_rounded_rect(x, y, CORNER_R):
        return (0, 0, 0, 0)

    u, v = tag_uv(x, y)
    if in_tag(u, v, TAG_L, TAG_W):
        hu = -TAG_L / 2.0 + HOLE_T * TAG_L
        du, dv = u - hu, v
        if du * du + dv * dv <= HOLE_R * HOLE_R:
            return TAG_EDGE + (255,)
        return TAG + (255,)
    if in_tag(u, v, TAG_L + 2 * EDGE, TAG_W + 2 * EDGE):
        return TAG_EDGE + (255,)

    return map_colour(x, y) + (255,)


def render(size):
    n = size * SS
    k = SS * SS
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                y = (py * SS + sy + 0.5) / n
                for sx in range(SS):
                    x = (px * SS + sx + 0.5) / n
                    r, g, b, a = sample(x, y)
                    f = a / 255.0
                    acc[0] += r * f
                    acc[1] += g * f
                    acc[2] += b * f
                    acc[3] += a
            a = acc[3] / k
            if a <= 0.5:
                row += bytes(4)
                continue
            f = (a / 255.0) * k          # un-premultiply back to straight alpha
            row += bytes((
                min(255, round(acc[0] / f)),
                min(255, round(acc[1] / f)),
                min(255, round(acc[2] / f)),
                min(255, round(a)),
            ))
        rows.append(bytes(row))
    return rows


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)
    return len(png)


# Rec. 709 luminance, then flattened toward mid-grey so the off-state icon reads
# as clearly inactive rather than as a monochrome design choice. Derived from
# the rendered color pixels so both variants are guaranteed identical in shape.
GREY_MIX = 0.62   # how much of the original luminance to keep
GREY_BASE = 158   # mid-grey the remainder is pulled toward


def to_grey(rows):
    out = []
    for row in rows:
        b = bytearray(row)
        for i in range(0, len(b), 4):
            if b[i + 3] == 0:
                continue
            lum = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]
            g = min(255, max(0, round(lum * GREY_MIX + GREY_BASE * (1.0 - GREY_MIX))))
            b[i] = b[i + 1] = b[i + 2] = g
        out.append(bytes(b))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        rows = render(size)
        for suffix, data in (("", rows), ("-off", to_grey(rows))):
            path = OUT / f"icon{size}{suffix}.png"
            n = write_png(path, size, data)
            print(f"{path.relative_to(OUT.parent.parent)}  {size}x{size}  {n} bytes")


if __name__ == "__main__":
    main()
