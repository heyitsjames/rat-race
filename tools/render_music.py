#!/usr/bin/env python3
"""Render the After Dark 3.0 Sound songs used by Rat Race to WAV files.

Inputs come from a resource_dasm export of the shared "AD 3.0 Sound" resource
fork (SONG/cmid/csnd/snd resources). Only the original MIDI sequences and the
original instrument samples are used; no new music is composed.

Usage:
    resource_dasm --data-fork "AD 3.0 Sound/..namedfork/rsrc" EXPORT_DIR
    python3 tools/render_music.py EXPORT_DIR public/assets/rat-race/audio/music

Rat Race CODE 129 (RR_D1, around 0x5BD6-0x5C72) asks the shared song player for
song IDs 30 (intro), 40 (looped body) and 45 (ending).
"""
import glob
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import midi  # noqa: E402

RATE = 22254  # native rate of the extracted instrument samples
SONGS = {30: 'william-tell-intro', 40: 'william-tell-loop', 45: 'william-tell-end'}


def read_wav(path):
    b = open(path, 'rb').read()
    i, fmt, data, loop = 12, None, None, None
    while i < len(b) - 8:
        cid = b[i:i + 4]
        sz = struct.unpack('<I', b[i + 4:i + 8])[0]
        body = b[i + 8:i + 8 + sz]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
        elif cid == b'data':
            data = body
        elif cid == b'smpl':
            n = struct.unpack('<I', body[28:32])[0]
            if n:
                s, e = struct.unpack('<II', body[36 + 8:36 + 16])
                loop = (s, e)
        i += 8 + sz + (sz & 1)
    assert fmt and fmt[0] == 3 and fmt[5] == 32, (path, fmt)
    x = np.frombuffer(data, dtype='<f4').astype(np.float64)
    if loop and loop[1] > loop[0]:
        # resource_dasm writes these loop points as byte offsets into the float data
        s, e = loop
        if e > len(x):
            s, e = s // 4, e // 4
        loop = (s, min(e, len(x))) if e - s > 32 else None
    else:
        loop = None
    return x, fmt[2], loop


def render(export_dir, song_id, cache):
    env_path = glob.glob(os.path.join(export_dir, f'*_SONG_{song_id}_*_smssynth_env.json'))[0]
    env = json.load(open(env_path))
    insts = {i['id']: i['regions'] for i in env['instruments']}
    decay = env.get('note_decay', 3)
    release = 0.035 * decay
    div, events = midi.parse(os.path.join(export_dir, env['sequence_filename']))
    timed = midi.to_seconds(div, events)
    length = timed[-1][0]

    program = {}
    active = {}
    notes = []
    for t, kind, data in timed:
        if kind == 'program':
            program[data[0]] = data[1]
        elif kind == 'on':
            ch, key, vel = data
            if (ch, key) in active:
                notes.append(active.pop((ch, key)) + (t,))
            active[(ch, key)] = (t, ch, key, vel, program.get(ch, 0))
        elif kind == 'off':
            ch, key = data
            if (ch, key) in active:
                notes.append(active.pop((ch, key)) + (t,))
    for v in active.values():
        notes.append(v + (length,))

    total = int((length + 2.0) * RATE)
    out = np.zeros(total)
    for start, ch, key, vel, prog, end in notes:
        regions = insts.get(prog)
        if not regions:
            continue
        reg = next((r for r in regions if r['key_low'] <= key <= r['key_high']), None)
        if reg is None:
            reg = min(regions, key=lambda r: abs(r['base_note'] - key))
        fn = os.path.join(export_dir, reg['filename'])
        if fn not in cache:
            cache[fn] = read_wav(fn)
        x, sr, loop = cache[fn]
        percussion = prog == 127
        step = (2 ** ((key - reg['base_note']) / 12)) * sr / RATE
        if percussion:
            loop = None
        held = max(end - start, 0.02)
        n = int((held + release) * RATE)
        pos = np.arange(n) * step
        if loop:
            s, e = loop
            over = pos >= e
            pos[over] = s + np.mod(pos[over] - s, e - s)
        else:
            n = min(n, int((len(x) - 1) / step))
            pos = pos[:n]
        if n <= 0:
            continue
        i0 = pos.astype(np.int64)
        frac = pos - i0
        i1 = np.minimum(i0 + 1, len(x) - 1)
        y = x[i0] * (1 - frac) + x[i1] * frac
        envl = np.ones(n)
        rel_start = int(held * RATE)
        if rel_start < n:
            envl[rel_start:] = np.linspace(1, 0, n - rel_start)
        y *= envl * (vel / 127.0)
        a = int(start * RATE)
        b = min(a + n, total)
        out[a:b] += y[:b - a]
    return out, int(length * RATE)


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    hdr = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack(
        '<IHHIIHH', 16, 1, 1, RATE, RATE * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm))
    open(path, 'wb').write(hdr + pcm)


def main(export_dir=None, out_dir=None):
    if export_dir is None:
        export_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    cache = {}
    rendered = {sid: render(export_dir, sid, cache) for sid in SONGS}
    peak = max(np.abs(x).max() for x, _ in rendered.values())
    gain = 0.89 / peak
    for sid, (x, n) in rendered.items():
        x = x * gain
        if sid == 40:
            # fold the release tail onto the head so the loop is seamless
            tail = x[n:]
            x = x[:n].copy()
            x[:len(tail)] += tail
        else:
            # Keep the song until its MIDI end-of-track (n), not just its last audible
            # sample: the original player reports the song finished at end-of-track, and
            # the race waits for that before dropping the gates (RR_D1 f5ca4).
            nz = np.nonzero(np.abs(x) > 1e-4)[0]
            audible = nz[-1] + 1 if len(nz) else 0
            x = x[:max(n, audible)]
        path = os.path.join(out_dir, f'{SONGS[sid]}.wav')
        write_wav(path, x)
        print(f'SONG {sid} -> {path} ({len(x) / RATE:.2f}s)')


if __name__ == '__main__':
    main()
