#!/usr/bin/env python3
"""Regenerate the annotated disassembly of Rat Race's 68K code.

Usage:
    python3 tools/re/disassemble.py "<path to After Dark 4.94 Collection>" [out dir]

Writes RR_D1.annotated.txt (CODE 129) and RR_D2.annotated.txt (CODE 130) to the
out dir (default tools/re/out, which git ignores). Addresses cited in
src/simulation/constants.ts and docs/RECONSTRUCTION.md ("RR_D1 0x4D5E",
"RR130.f171e", ...) refer to these listings.

Needs resource_dasm and m68kdasm from the resource_dasm build (on PATH, or set
RESOURCE_DASM to the resource_dasm binary; m68kdasm is taken from the same
folder). Inputs, found the same way as tools/extract.py:

    After Dark Files/After Dark 3.0/Rat Race           or  Rat Race.rsrc
    After Dark Files/AD 3.0 Resources/AD 3.0 Code      or  AD 3.0 Code.rsrc

How it works:
 1. CRLT/DRLT resources are 12-byte relocation records: type u16, offset u32
    (+4 for the CODE header), kind i16 (-2 code, -1 data), symbol id u32.
 2. SYMT records are 14 bytes: id u32, 6 unused bytes, segment u16, offset u16.
    Segment 1 is a jump-table slot (JUMP entry (offset-2)/8, whose first word is
    the code offset including the 4-byte header); segment 0 is a data global.
 3. The shared AD 3.0 Code libraries (Canvas1/2, Required1/2, Resource, RLE,
    Sound, Sprite) own contiguous symbol id ranges and keep MacsBug function
    names after each routine, which label calls into them.
Module globals print as RR129.gXXXX, module functions as RR130.fXXXX and library
calls as e.g. AD3_Resource.f3398<RandInt__FCUl>. The disassembler writes
`move dest, src`.
"""
import glob
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from extract import read_fork  # noqa: E402

INPUTS = {
    'rat_race': ('After Dark Files/After Dark 3.0/Rat Race', 'Rat Race'),
    'code': ('After Dark Files/AD 3.0 Resources/AD 3.0 Code', 'AD 3.0 Code'),
}
LINE = re.compile(r'([0-9A-F]{8})\s+((?:[0-9A-F]{4} ?)+)')


def fail(msg):
    sys.exit(f'disassemble: {msg}')


def tools():
    dasm = os.environ.get('RESOURCE_DASM') or shutil.which('resource_dasm')
    if not dasm:
        fail('resource_dasm not found; put it on PATH or set RESOURCE_DASM (see the README)')
    m68k = os.path.join(os.path.dirname(dasm), 'm68kdasm')
    if not os.access(m68k, os.X_OK):
        m68k = shutil.which('m68kdasm')
    if not m68k:
        fail('m68kdasm not found next to resource_dasm or on PATH')
    return dasm, m68k


def find(source, key):
    rel, name = INPUTS[key]
    for p in (source / rel / '..namedfork' / 'rsrc', source / f'{name}.rsrc'):
        if p.is_file() and p.stat().st_size > 0:
            return p
    fail(f'could not find {name} under {source}')


def symt(b):
    return {struct.unpack_from('>I', b, i)[0]: struct.unpack_from('>HH', b, i + 10)
            for i in range(0, len(b) - 13, 14)}


def jump(b):
    return [struct.unpack_from('>H', b, i)[0] for i in range(0, len(b), 8)]


def relocs(b):
    return [struct.unpack_from('>HIhI', b, i) for i in range(0, len(b) - 11, 12)]


def annotate(listing, crlt, sym):
    """Append the symbol each relocated instruction refers to."""
    notes = {}
    for _t, off, _kind, sid in relocs(crlt):
        notes.setdefault(off - 4, []).append(sym.get(sid, f'?{sid:04x}'))
    out = []
    for ln in listing.split('\n'):
        ln = re.sub(r'\s+;.*$', '', ln)
        m = LINE.match(ln)
        if m:
            a = int(m.group(1), 16)
            n = len(m.group(2).replace(' ', '')) // 2
            found = sum([notes[x] for x in range(a, a + n) if x in notes], [])
            if found:
                ln += '   ; ' + ', '.join(found)
        out.append(ln)
    return '\n'.join(out)


def library_names(listing, lib):
    """MacsBug names: each routine (LINK A6 = 4E56) is followed by its name string."""
    names, pending = {}, []
    for ln in listing.split('\n'):
        m = re.match(r'([0-9A-F]{8})\s+4E56 ', ln)
        if m:
            pending.append(int(m.group(1), 16))
            continue
        m = re.search(r'dc\.b\s+"([^"]+)"', ln)
        if m and pending:
            for a in pending:
                names[f'{lib}.f{a:04x}'] = m.group(1)
            pending = []
    return names


def main():
    if len(sys.argv) < 2:
        fail(__doc__)
    source = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / 'out'
    dasm, m68k = tools()
    rat = find(source, 'rat_race')
    code = find(source, 'code')
    out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='rat-race-re-') as t:
        tmp = Path(t)
        for name, fork in (('lib', code), ('rr', rat)):
            r = subprocess.run([dasm, '--data-fork', str(fork), str(tmp / name)], capture_output=True, text=True)
            if r.returncode:
                fail(f'resource_dasm failed on {fork}:\n{r.stderr[-2000:]}')

        def one(pattern):
            hits = glob.glob(str(tmp / pattern))
            assert len(hits) == 1, (pattern, hits)
            return hits[0]

        # Libraries: id -> name from their SYMT resources' names.
        libs = {}
        for f in glob.glob(str(tmp / 'lib/*SYMT_*')):
            m = re.search(r'_SYMT_(\d+)_(.+)\.bin$', f)
            libs[m.group(1)] = m.group(2)
        lib = read_fork(code)
        units = [(name, symt(lib[('SYMT', int(rid))]), jump(lib[('JUMP', int(rid))]))
                 for rid, name in sorted(libs.items())]
        res = read_fork(rat)
        for seg in (129, 130):
            units.append((f'RR{seg}', symt(res[('SYMT', seg)]), jump(res[('JUMP', seg)])))

        sym = {}
        for name, table, jt in units:
            for sid, (seg, off) in table.items():
                if seg == 1:
                    i = (off - 2) // 8
                    sym[sid] = f'{name}.f{jt[i] - 4:04x}' if i < len(jt) else f'{name}.jmp?{off}'
                else:
                    sym[sid] = f'{name}.g{off:04x}'

        names = {}
        for rid, name in libs.items():
            binary = tmp / f'lib_{name}.bin'
            binary.write_bytes(lib[('CODE', int(rid))][4:])
            listing = subprocess.run([m68k, '--68k', str(binary)], capture_output=True, text=True).stdout
            crlt = lib[('CRLT', int(rid))]
            names.update(library_names(annotate(listing, crlt, sym), name))

        for seg, label in ((129, 'RR_D1'), (130, 'RR_D2')):
            text = annotate(Path(one(f'rr/*CODE_{seg}_*.txt')).read_text(), res[('CRLT', seg)], sym)
            text = re.sub(r'(AD3_\w+|Runtime)\.f([0-9a-f]{4})',
                          lambda m: m.group(0) + '<' + names.get(m.group(0), '?') + '>', text)
            path = out / f'{label}.annotated.txt'
            path.write_text(text)
            print(f'{label}: {path}')


if __name__ == '__main__':
    main()
