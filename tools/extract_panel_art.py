#!/usr/bin/env python3
"""Extract the After Dark control panel art used by the Rat Race start menu.

Usage:
  python3 -I tools/extract_panel_art.py <faceplate PICT 128 as BMP> <After Dark cdev rsrc> <out dir>

The faceplate BMP comes from resource_dasm run on the AD 3.0 Faceplate resource
fork. Resource forks can be read on macOS as "<file>/..namedfork/rsrc", e.g.
  "After Dark Files/After Dark 3.0/After Dark 3.0 Faceplate/..namedfork/rsrc"
  "After Dark 4.94/..namedfork/rsrc"

Writes (needs Pillow):
  faceplate.png        PICT 128 of the AD 3.0 Faceplate (185x47)
  thumb-<id>.png       slider thumbs: ics8 + ics# mask 128, 130, 131, 132 (THUM 128 sequence);
                       the mask is solid, so each thumb is an opaque black square
  volume-<n>.png       ICON 128-133 "Volume 0/1/2/3/5/7", black on transparent
"""
import struct
import sys
from pathlib import Path

from PIL import Image

# Standard Macintosh 8-bit system palette (the 6x6x6 cube, then ramps).
def mac_palette():
    pal = []
    steps = [0xFF, 0xCC, 0x99, 0x66, 0x33, 0x00]
    for r in steps:
        for g in steps:
            for b in steps:
                pal.append((r, g, b))
    pal = pal[:215]
    ramp = [0xEE, 0xDD, 0xBB, 0xAA, 0x88, 0x77, 0x55, 0x44, 0x22, 0x11]
    pal += [(v, 0, 0) for v in ramp] + [(0, v, 0) for v in ramp] + [(0, 0, v) for v in ramp]
    pal += [(v, v, v) for v in ramp] + [(0, 0, 0)]
    return pal


def read_fork(path):
    d = Path(path).read_bytes()
    data_off, map_off = struct.unpack('>II', d[:8])
    m = d[map_off:]
    type_list_off, name_list_off = struct.unpack('>HH', m[24:28])
    tl = m[type_list_off:]
    (n_types,) = struct.unpack('>H', tl[:2])
    res = {}
    for i in range(n_types + 1):
        rtype, count, ref_off = struct.unpack('>4sHH', tl[2 + i * 8 : 10 + i * 8])
        for j in range(count + 1):
            e = tl[ref_off + j * 12 : ref_off + j * 12 + 12]
            rid, _name, attr_off = struct.unpack('>hhI', e[:8])
            off = data_off + (attr_off & 0xFFFFFF)
            (ln,) = struct.unpack('>I', d[off : off + 4])
            res[(rtype.decode('mac_roman'), rid)] = d[off + 4 : off + 4 + ln]
    return res


def bits(data, w, h):
    row = (w + 7) // 8
    return [[(data[y * row + x // 8] >> (7 - x % 8)) & 1 for x in range(w)] for y in range(h)]


def main():
    face, cdev, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    pal = mac_palette()

    cp = read_fork(cdev)
    for rid in (128, 130, 131, 132):
        px = cp[('ics8', rid)]
        mask = bits(cp[('ics#', rid)][32:64], 16, 16)
        im = Image.new('RGBA', (16, 16))
        for y in range(16):
            for x in range(16):
                r, g, b = pal[px[y * 16 + x]]
                im.putpixel((x, y), (r, g, b, 255 if mask[y][x] else 0))
        im.save(out / f'thumb-{rid}.png')

    for rid, n in zip(range(128, 134), (0, 1, 2, 3, 5, 7)):
        ink = bits(cp[('ICON', rid)], 32, 32)
        im = Image.new('RGBA', (32, 32))
        for y in range(32):
            for x in range(32):
                im.putpixel((x, y), (0, 0, 0, 255) if ink[y][x] else (0, 0, 0, 0))
        im.save(out / f'volume-{n}.png')

    # The faceplate is a PICT; resource_dasm renders it to BMP. Pass that BMP via
    # FACEPLATE_BMP if available, otherwise skip.
    bmp = Path(face)
    if bmp.suffix.lower() == '.bmp':
        Image.open(bmp).convert('RGB').save(out / 'faceplate.png')
    else:
        print('faceplate: pass the resource_dasm BMP of PICT 128 as the first argument to export it')


if __name__ == '__main__':
    main()
