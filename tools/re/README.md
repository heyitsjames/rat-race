# Reverse-engineering helpers

Scripts used to make the Rat Race module's 68K code readable. They were run once; the annotated output is committed.

- `RR_D1.annotated.txt` / `RR_D2.annotated.txt`: CODE 129 / 130 disassembly (from resource_dasm) with every relocated reference resolved: module globals as `RR129.gXXXX`, module functions as `RR130.fXXXX`, and shared-library calls with their MacsBug names (for example `AD3_Resource.f3398<RandInt__FCUl>`). Note that this disassembler writes `move dest, src`.

How it works:

1. `CRLT`/`DRLT` resources are 12-byte relocation records: `type u16, offset u32 (+4 for the CODE header), kind i16 (-2 code, -1 data), symbol id u32`.
2. `SYMT` records are 14 bytes: `id u32, 6 junk bytes, segment u16, offset u16`. Segment 1 is a jump-table slot (`JUMP` entry `(offset-2)/8`, whose first word is the code offset including the 4-byte header); segment 0 is a data global.
3. The shared *AD 3.0 Code* libraries (Canvas1/2, Required1/2, Resource, RLE, Sound, Sprite) own contiguous id ranges and keep MacsBug function names after each routine.

`libdis.py` disassembles the shared libraries, `resolve.py` builds the symbol map and annotates, `names2.py` attaches library function names. Paths at the top of each script point at the extraction on the original Mac and need adjusting to re-run.
