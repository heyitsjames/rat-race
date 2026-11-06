# Reverse-engineering helpers

`disassemble.py` makes Rat Race's 68K code readable: it disassembles CODE 129 (RR_D1) and CODE 130 (RR_D2) and labels every relocated reference, so module globals read as `RR129.gXXXX`, module functions as `RR130.fXXXX`, and calls into the shared After Dark libraries with their MacsBug names (for example `AD3_Resource.f3398<RandInt__FCUl>`).

```sh
python3 tools/re/disassemble.py "<path to After Dark 4.94 Collection>"
```

It writes `tools/re/out/RR_D1.annotated.txt` and `RR_D2.annotated.txt` (git ignores them; they are Berkeley Systems' code). Addresses cited in `src/simulation/constants.ts` and `docs/RECONSTRUCTION.md`, such as "RR_D1 0x4D5E" or "RR130.f171e", point into these listings. It needs the *Rat Race* and *AD 3.0 Code* files and the same `resource_dasm` build as `npm run extract`. The script header explains the relocation and symbol formats.
