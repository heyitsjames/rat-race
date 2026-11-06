"""Minimal Standard MIDI File parser (format 0/1) used by render_music.py."""
import struct


def _varlen(b, i):
    v = 0
    while True:
        c = b[i]; i += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, i


def parse(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'MThd'
    fmt, ntrk, div = struct.unpack('>HHH', b[8:14])
    i = 8 + struct.unpack('>I', b[4:8])[0]
    events = []  # (tick, order, kind, data)
    order = 0
    for _ in range(ntrk):
        assert b[i:i + 4] == b'MTrk', b[i:i + 4]
        ln = struct.unpack('>I', b[i + 4:i + 8])[0]
        j, end = i + 8, i + 8 + ln
        tick, status = 0, 0
        while j < end:
            d, j = _varlen(b, j)
            tick += d
            c = b[j]
            if c & 0x80:
                status = c; j += 1
            if status == 0xFF:
                t = b[j]; j += 1
                n, j = _varlen(b, j)
                data = b[j:j + n]; j += n
                if t == 0x51:
                    events.append((tick, order, 'tempo', int.from_bytes(data, 'big')))
                elif t == 0x2F:
                    events.append((tick, order, 'end', None))
            elif status in (0xF0, 0xF7):
                n, j = _varlen(b, j); j += n
            else:
                hi, ch = status & 0xF0, status & 0x0F
                if hi in (0xC0, 0xD0):
                    a = b[j]; j += 1
                    if hi == 0xC0:
                        events.append((tick, order, 'program', (ch, a)))
                else:
                    a, v = b[j], b[j + 1]; j += 2
                    if hi == 0x90 and v > 0:
                        events.append((tick, order, 'on', (ch, a, v)))
                    elif hi == 0x80 or (hi == 0x90 and v == 0):
                        events.append((tick, order, 'off', (ch, a)))
                    elif hi == 0xB0:
                        events.append((tick, order, 'cc', (ch, a, v)))
            order += 1
        i = end
    events.sort(key=lambda e: (e[0], e[1]))
    return div, events


def to_seconds(div, events):
    """Convert tick times to seconds using the tempo map."""
    out, tempo, last_tick, t = [], 500000, 0, 0.0
    for tick, _, kind, data in events:
        t += (tick - last_tick) * tempo / 1e6 / div
        last_tick = tick
        if kind == 'tempo':
            tempo = data
        out.append((t, kind, data))
    return out
