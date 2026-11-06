#!/usr/bin/env python3
"""Extract every original asset the remake needs from an After Dark install.

Usage:
    npm run extract -- "<path to After Dark 4.94 Collection>"
    python3 tools/extract.py "<source>" [--out <repo root>]

<source> is the folder that holds the original files. Each input is looked up
first at its place in the After Dark 4.94 Collection, read through macOS's
"<file>/..namedfork/rsrc" resource fork path, then as a raw resource fork file
"<source>/<name>.rsrc" (for systems that can't read resource forks):

    After Dark Files/After Dark 3.0/Rat Race                   or  Rat Race.rsrc
    After Dark Files/AD 3.0 Resources/AD 3.0 Sound             or  AD 3.0 Sound.rsrc
    After Dark Files/After Dark 3.0/After Dark 3.0 Faceplate   or  After Dark 3.0 Faceplate.rsrc
    After Dark 4.94  (the control panel)                       or  After Dark 4.94.rsrc

Writes public/assets/rat-race/ and reference/STFT_110.bin under --out (default:
this repo), then regenerates data/ with tools/build-data.mjs.

Needs Python 3 with Pillow and numpy, ImageMagick (`magick`), and
resource_dasm (on PATH, or set RESOURCE_DASM to the binary). Fails before
writing anything if one is missing.
"""
import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

RAT_RACE_SHA256 = '5385f6b345ac69fa2fa67d68f75aa03be0f494bb9eb448162c99c23640d16a4a'

INPUTS = {
    'rat_race': ('After Dark Files/After Dark 3.0/Rat Race', 'Rat Race'),
    'sound': ('After Dark Files/AD 3.0 Resources/AD 3.0 Sound', 'AD 3.0 Sound'),
    'faceplate': ('After Dark Files/After Dark 3.0/After Dark 3.0 Faceplate', 'After Dark 3.0 Faceplate'),
    'control_panel': ('After Dark 4.94', 'After Dark 4.94'),
}

RLEP_IDS = [1001, 1100, 1101, 1102, 1150, 1200, 1300, 1400]
ATLAS_COLUMNS = 6
CLUT_IDS = [1050, 1051, 1100, 1101]
SOUNDS = {1000: 'click', 1001: 'gate-dropping'}
PICTS = {('PiCT', 110): 'ratvetica', ('SiCT', 1100): 'grass', ('SiCT', 1101): 'track'}
# Classic Macintosh 16-colour icon palette (icl4).
ICL4_PALETTE = ['FFFFFF', 'FCF305', 'FF6403', 'DD0806', 'F20884', '4600A5', '0000D4', '02ABEA',
                '1FB714', '006411', '562C05', '90713A', 'C0C0C0', '808080', '404040', '000000']


def fail(msg):
    sys.exit(f'extract: {msg}')


# --- Requirements -----------------------------------------------------------

def check_requirements():
    missing = []
    try:
        import PIL  # noqa: F401
    except ImportError:
        missing.append('Pillow (pip install pillow)')
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append('numpy (pip install numpy)')
    magick = shutil.which('magick')
    if not magick:
        missing.append('ImageMagick 7 (`magick`, e.g. brew install imagemagick)')
    dasm = os.environ.get('RESOURCE_DASM') or shutil.which('resource_dasm')
    if not dasm or not os.access(dasm, os.X_OK):
        missing.append('resource_dasm (build it from https://github.com/fuzziqersoftware/resource_dasm '
                       'and put it on PATH or set RESOURCE_DASM; see the README)')
    if missing:
        fail('missing requirements:\n  - ' + '\n  - '.join(missing))
    return magick, dasm


def find_inputs(source):
    found, missing = {}, []
    for key, (rel, name) in INPUTS.items():
        candidates = [source / rel / '..namedfork' / 'rsrc', source / f'{name}.rsrc']
        path = next((p for p in candidates if p.is_file() and p.stat().st_size > 0), None)
        if path:
            found[key] = path
        else:
            missing.append(f'{name}: looked for "{candidates[0]}" and "{candidates[1]}"')
    if missing:
        fail('could not find these original files (or their resource forks are empty, which '
             'happens when they were copied by a tool that drops them):\n  - ' + '\n  - '.join(missing))
    return found


# --- Resource fork ----------------------------------------------------------

def read_fork(path):
    """Return {(type, id): bytes} for a classic Mac resource fork."""
    d = Path(path).read_bytes()
    data_off, map_off = struct.unpack_from('>II', d)
    type_list = map_off + struct.unpack_from('>H', d, map_off + 24)[0]
    res = {}
    for i in range(struct.unpack_from('>H', d, type_list)[0] + 1):
        rtype, count, ref_off = struct.unpack_from('>4sHH', d, type_list + 2 + i * 8)
        for j in range(count + 1):
            ref = type_list + ref_off + j * 12
            rid = struct.unpack_from('>h', d, ref)[0]
            off = data_off + int.from_bytes(d[ref + 5:ref + 8], 'big')
            size = struct.unpack_from('>I', d, off)[0]
            res[(rtype.decode('mac_roman'), rid)] = d[off + 4:off + 4 + size]
    return res


# --- RLEP sprites -----------------------------------------------------------
# RLEP is the After Dark 3.0 run-length sprite format (decoded from the shared
# AD 3.0 Code library, CODE 133). A 32-byte RLID header is followed by chunks
# that each store their total length at +12: CTAB (palette: a metadata byte,
# then RGB8 per entry), IHDR (image record: QuickDraw rect top/left/bottom/right
# at +20) and CSTM (pixel stream, commands from +16).

def rlep_chunks(b):
    chunks, p = [], 32
    while p < len(b):
        tag, size = b[p:p + 4], struct.unpack_from('>I', b, p + 12)[0]
        assert size >= 16 and p + size <= len(b), ('bad RLEP chunk', p, size)
        chunks.append((tag, p, size))
        p += size
    assert p == len(b)
    return chunks


def decode_stream(b, start, end, w, h):
    """Decode one CSTM pixel stream to rows of palette indexes (None = transparent).

    Each command byte has the opcode in its low nibble and a short count or
    colour in its high nibble (n).
    """
    pix = [[None] * w for _ in range(h)]
    x = y = 0
    q = start

    def byte():
        nonlocal q
        v = b[q]
        q += 1
        assert q <= end, 'stream overrun'
        return v

    def put(vals):
        nonlocal x
        assert y < h and x + len(vals) <= w, ('row overflow', x, y, len(vals))
        pix[y][x:x + len(vals)] = vals
        x += len(vals)

    done = False
    while q < end:
        c = byte()
        op, n = c & 15, c >> 4
        if op == 0:                      # control
            if n == 0:                   # end of image
                done = True
                break
            elif n == 1:                 # end of row
                assert x == w, ('short row', y, x, w)
                x, y = 0, y + 1
            elif n == 3:                 # repeat an earlier row
                row = byte() * 256 + byte()
                pix[y] = pix[row][:]
                x, y = 0, y + 1
            else:
                raise ValueError(('control', c))
        elif op == 1:                    # transparent skip
            x += n or byte()
            assert x <= w
        elif op == 2:                    # run of colour n, count follows
            put([n] * byte())
        elif op in (3, 4, 5):            # 1-3 pixels of colour n
            put([n] * (op - 2))
        elif op == 6:                    # run of a byte colour
            if n == 0:
                color, count = byte(), byte()
            else:
                count, color = n, byte()
            put([color] * count)
        elif op == 7:                    # literal pixels
            count = byte()
            if n == 0:                   # packed 4-bit
                vals = []
                for _ in range((count + 1) // 2):
                    v = byte()
                    vals += [v >> 4, v & 15]
                put(vals[:count])
            elif n == 1:                 # 8-bit
                put([byte() for _ in range(count)])
            else:
                raise ValueError(('literal', c))
        elif op in (8, 9):               # alternating two colours
            count = n or byte()
            v = byte()
            colors = [v >> 4, v & 15] if op == 8 else [v, byte()]
            put([colors[i % 2] for i in range(count)])
        else:
            raise ValueError(('opcode', c))
    assert y in (h - 1, h) and (done or y == h), ('stream ended early', y, h)
    assert end - q <= 3, 'unexpected trailing bytes'
    return pix


def decode_rlep(b):
    from PIL import Image
    chunks = rlep_chunks(b)
    palettes = [[tuple(b[k + 1:k + 4]) + (255,) for k in range(p + 16, p + size, 4)]
                for tag, p, size in chunks if tag == b'CTAB']
    streams = [(p, size) for tag, p, size in chunks if tag == b'CSTM']
    headers = [p for tag, p, size in chunks if tag == b'IHDR']
    assert len(streams) == len(headers)
    frames = []
    for (p, size), hp in zip(streams, headers):
        top, left, bottom, right = struct.unpack_from('>4h', b, hp + 20)
        w, h = right - left, bottom - top
        pix = decode_stream(b, p + 16, p + size, w, h)
        im = Image.new('RGBA', (w, h))
        pal = palettes[0]
        im.putdata([(0, 0, 0, 0) if v is None else pal[v] for row in pix for v in row])
        frames.append((im, [top, left, bottom, right]))
    return frames


def write_atlas(frames, rid, out):
    """Pack frames into a grid of up to 6 columns, each cell the largest frame size."""
    from PIL import Image
    cw = max(im.width for im, _ in frames)
    ch = max(im.height for im, _ in frames)
    cols = min(ATLAS_COLUMNS, len(frames))
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
    meta = []
    for i, (im, rect) in enumerate(frames):
        x, y = i % cols * cw, i // cols * ch
        sheet.paste(im, (x, y))
        meta.append({'frame': i, 'x': x, 'y': y, 'width': im.width, 'height': im.height, 'sourceRect': rect})
    sheet.save(out / f'{rid}.png')
    (out / f'{rid}.json').write_text(json.dumps({'image': f'{rid}.png', 'frames': meta}, indent=2))


# --- Other module resources -------------------------------------------------

def write_sound(b, path):
    """snd resource (format 1, one sampled-sound command) to 8-bit mono WAV."""
    header = struct.unpack_from('>I', b, 16)[0]
    n, rate = struct.unpack_from('>II', b, header + 4)
    assert b[header + 20] == 0, 'expected a standard sound header'
    with wave.open(str(path), 'wb') as f:
        f.setparams((1, 1, round(rate / 65536), n, 'NONE', 'not compressed'))
        f.writeframes(b[header + 22:header + 22 + n])


def clut_json(b):
    n = struct.unpack_from('>H', b, 6)[0] + 1
    colors = []
    for k in range(n):
        idx, r, g, bl = struct.unpack_from('>4H', b, 8 + k * 8)
        colors.append({'index': idx, 'r': r >> 8, 'g': g >> 8, 'b': bl >> 8})
    return json.dumps(colors, indent=2)


def write_icons(res, out):
    from PIL import Image
    icn = res[('ICN#', 1000)]
    mask = Image.frombytes('1', (32, 32), icn[128:])
    mono = Image.frombytes('1', (32, 32), icn[:128]).convert('RGBA')
    mono.putalpha(mask)
    mono.save(out / 'icon-monochrome.png')
    color = Image.new('RGBA', (32, 32))
    color.putdata([tuple(bytes.fromhex(ICL4_PALETTE[v])) + (255,)
                   for c in res[('icl4', 1000)] for v in (c >> 4, c & 15)])
    color.putalpha(mask)
    color.save(out / 'icon-color.png')


def write_pict(magick, data, path, tmp):
    """Render a PICT resource with ImageMagick (standalone PICT files need a 512-byte prefix)."""
    pict = tmp / (path.stem + '.pict')
    pict.write_bytes(bytes(512) + data)
    subprocess.run([magick, f'PICT:{pict}', str(path)], check=True)


# The remake's settings differ from the original's, so its help text is edited
# to match: Competitive replaces Race Track and Music, and the track always shows.
HELP_EDITS = [
    ('"Race Track" determines whether or not the race track will appear.\n'
     '"Music" determines how often the music will play.\n',
     '"Competitive" determines whether or not the rats keep racing for second place after the winner crosses.\n'),
    ('After 90 minutes of uninterrupted racing the track will disappear, but the tireless rats will continue racing.\n\n', ''),
]


def help_text(res):
    text = res[('TEXT', 1000)].decode('mac_roman').replace('\r', '\n')
    for old, new in HELP_EDITS:
        assert old in text, f'help text no longer contains: {old!r}'
        text = text.replace(old, new)
    return text


def rat_names(res):
    names = {}
    for rid in (2000, 2002, 2003):
        b = res[('RatN', rid)]
        n = struct.unpack_from('>H', b)[0]
        names[str(rid)] = [x.decode('mac_roman') for x in b[2:].split(b'\0')[:n]]
    return json.dumps(names, indent=2)


def run_dasm(dasm, fork, out):
    out.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([dasm, '--data-fork', str(fork), str(out)], capture_output=True, text=True)
    if r.returncode != 0:
        fail(f'resource_dasm failed on {fork}:\n{r.stderr[-2000:]}')


# --- Main -------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', type=Path, help='folder holding the original After Dark files')
    ap.add_argument('--out', type=Path, default=ROOT, help='repo root to write into (default: this repo)')
    ap.add_argument('--skip-data', action='store_true', help="don't run tools/build-data.mjs afterwards")
    args = ap.parse_args()

    magick, dasm = check_requirements()
    if not args.source.is_dir():
        fail(f'"{args.source}" is not a folder')
    inputs = find_inputs(args.source)

    digest = hashlib.sha256(inputs['rat_race'].read_bytes()).hexdigest()
    if digest != RAT_RACE_SHA256:
        fail(f'Rat Race resource fork has SHA-256 {digest}, expected {RAT_RACE_SHA256} (Rat Race 3.0 '
             'from After Dark 3.0). Other editions may work but have not been checked.')

    import extract_panel_art
    import render_music

    assets = args.out / 'public/assets/rat-race'
    dirs = {k: assets / k for k in ('atlases', 'audio', 'images', 'palettes', 'panel')}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    (args.out / 'reference').mkdir(exist_ok=True)

    res = read_fork(inputs['rat_race'])
    with tempfile.TemporaryDirectory(prefix='rat-race-extract-') as t:
        tmp = Path(t)

        for rid in RLEP_IDS:
            frames = decode_rlep(res[('RLEP', rid)])
            write_atlas(frames, rid, dirs['atlases'])
            print(f'sprites  RLEP {rid}: {len(frames)} frames')

        for rid, name in SOUNDS.items():
            write_sound(res[('snd ', rid)], dirs['audio'] / f'{name}.wav')
        for rid in CLUT_IDS:
            (dirs['palettes'] / f'{rid}.json').write_text(clut_json(res[('clut', rid)]))
        for key, name in PICTS.items():
            write_pict(magick, res[key], dirs['images'] / f'{name}.png', tmp)
        write_icons(res, dirs['images'])
        (assets / 'rat-names-and-labels.json').write_text(rat_names(res))
        (assets / 'module-help.txt').write_text(help_text(res))
        (args.out / 'reference/STFT_110.bin').write_bytes(res[('STFT', 110)])
        print('module   sounds, palettes, textures, font, icons, names, help text')

        run_dasm(dasm, inputs['faceplate'], tmp / 'faceplate')
        bmps = list((tmp / 'faceplate').glob('*_PICT_128*.bmp'))
        if len(bmps) != 1:
            fail('resource_dasm did not render the faceplate (PICT 128)')
        extract_panel_art.main(str(bmps[0]), str(inputs['control_panel']), str(dirs['panel']))
        print('panel    faceplate, slider thumbs, volume icons')

        run_dasm(dasm, inputs['sound'], tmp / 'sound')
        render_music.main(str(tmp / 'sound'), str(dirs['audio'] / 'music'))

    if not args.skip_data:
        subprocess.run(['node', str(args.out / 'tools/build-data.mjs')], check=True)
    print(f'done: {assets}')


if __name__ == '__main__':
    main()
