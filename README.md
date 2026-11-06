# Rat Race

A browser reconstruction of the After Dark 3.0 screensaver module **Rat Race** (©1994 Berkeley Systems, Inc.; programming by Andrew Armstrong, art by Matt Small), built from the original artwork, sounds and music recovered from the module and the shared AD 3.0 Sound library.

Three rats come out of the pipes, line up behind staggered gates, race one lap of a track that rings the screen, and leave through the pipes at the far end. The results board then shows in the infield while the next three line up.

This is a private, personal-use project. The artwork, sounds and music are Berkeley Systems' and are **not in this repository**: you extract them from your own copy of After Dark (see [Getting the assets](#getting-the-assets)).

## Getting the assets

The game needs the original artwork, sounds and music, which are made from four files in the **After Dark 4.94 Collection**:

| File (inside the collection folder) | What comes from it |
|---|---|
| `After Dark Files/After Dark 3.0/Rat Race` | the module: rat sprites, track and grass textures, Ratvetica font, palettes, sound effects, rat names, help text |
| `After Dark Files/AD 3.0 Resources/AD 3.0 Sound` | the William Tell music (MIDI sequences and instrument samples) |
| `After Dark Files/After Dark 3.0/After Dark 3.0 Faceplate` | the faceplate on the start menu |
| `After Dark 4.94` | the control panel: toaster slider thumbs and speaker icons |

These are classic Mac OS files: everything is in their **resource forks**, and the data forks are empty (0 bytes). The extractor reads a fork on macOS through `<file>/..namedfork/rsrc`, so copy the collection with something that keeps resource forks (Finder, `ditto`, or unpacking the original `.sit`/`.dmg` on a Mac). On other systems, save each fork as a raw file named `Rat Race.rsrc`, `AD 3.0 Sound.rsrc`, `After Dark 3.0 Faceplate.rsrc` and `After Dark 4.94.rsrc` in one folder and pass that folder instead. The Rat Race fork must be version 3.0 (SHA-256 `5385f6b345ac69fa2fa67d68f75aa03be0f494bb9eb448162c99c23640d16a4a`); the extractor checks.

Requirements:

- Python 3 with Pillow and numpy (`pip install pillow numpy`)
- ImageMagick 7 (`brew install imagemagick`)
- [resource_dasm](https://github.com/fuzziqersoftware/resource_dasm), built from source with its library [phosg](https://github.com/fuzziqersoftware/phosg) (needs CMake and a C++ compiler):

  ```sh
  git clone https://github.com/fuzziqersoftware/phosg.git
  git clone https://github.com/fuzziqersoftware/resource_dasm.git
  (cd phosg && cmake -S . -B build && cmake --build build -j8 && sudo cmake --install build)
  (cd resource_dasm && cmake -S . -B build && cmake --build build -j8)
  export RESOURCE_DASM="$PWD/resource_dasm/build/resource_dasm"   # or put it on PATH
  ```

Then:

```sh
npm run extract -- "/path/to/After Dark 4.94 Collection"
```

This writes `public/assets/rat-race/` and `reference/STFT_110.bin` (both git-ignored) and regenerates `data/`. It stops with a list of anything missing before writing files. The help text is edited to match the remake's settings, and the script fails loudly if the original wording isn't found.

### The private asset bucket

So the site can build without the original files, the extracted assets also live as one archive in a private Cloudflare R2 bucket (`rat-race-assets`). `assets.lock` names the archive and its SHA-256.

```sh
npm run assets:fetch    # download and unpack the archive in assets.lock (uses `wrangler login`)
npm run assets:upload   # after a new extract: upload a new archive and update assets.lock; commit it
```

The archive also holds `public/og-image.jpg`, the link preview image (a screenshot of the game), which isn't made by the extractor.

## Run it

Requires Node 20+ (tested with Node 24), and the assets above.

```sh
npm install        # install dependencies
npm run assets:fetch   # or npm run extract -- "<collection folder>"
npm run dev        # dev server at http://localhost:5173
npm test           # deterministic simulation tests (vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build at http://localhost:4173
```

`dist/` is a static site with relative URLs, so it can be served from any folder or subpath. `dev`, `build` and `test` stop with instructions if the assets are missing.

## Deploying

Pushing to master deploys to Cloudflare Pages (project `rat-race`). Its build command is `npm run assets:fetch && npm run build`. The fetch reads the bucket with a read-only R2 key, stored as the encrypted Pages variables `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for both Production and Preview.

## Controls

The page opens on a start menu modelled on the After Dark 3.0 control panel: the AD 3.0 faceplate, the module's own **Training** slider (with the control panel's flying-toaster slider thumbs), a speaker button that steps through the volume icons, and **?** for the module's help text. **Run Race** (or Enter) starts a fresh session; **Menu** in the control bar (or Esc) stops it and returns to the menu. Add `?run=1` to skip the menu.

While racing, the control bar and cursor hide after 1.5 seconds without input; move the mouse or tap the screen to bring them back. Keyboard shortcuts work without showing them.

| Key | Action |
|---|---|
| Enter | Run Race (from the menu) |
| Space | Pause / resume |
| R | Restart: the same rats race again with fresh luck |
| F | Fullscreen |
| M | Sound on/off |
| Esc | Close About, otherwise back to the menu |

Settings (saved in this browser): **Training** (Drop Out … Professional, plus an added **Cracked** level at the top), **Competitive**, **Rats**, sound and volume. Run Race runs one race, with music. When it ends, two buttons appear under the results board: **Restart** runs the same rats again (same names, colours and lanes) with fresh luck, so the result can change, and **New Race** goes back to the menu. Browsers only allow audio after a click or key press; pressing Run Race counts.

## Debug tools

Add query parameters to the URL:

| Parameter | Effect |
|---|---|
| `?debug=1` | Diagnostics panel: seed, phase, per-rat mode/position, audio nodes, recolour cache. Buttons for speed ×1/×4/×16, the frame inspector and ending the current race. |
| `?seed=1234` | Fixed seed for reproducible races (outcomes also depend on window size, which sets the track shape). |
| `?speed=16` | Simulation speed multiplier. |
| `?corners=1` | Corner lab: one rat per lane loops round the bottom-right corner. Keys 1-7 switch between corner animation styles (1 is what races use), Space pauses, `[` `]` change the speed. |
| `?inspect=1` | Open the frame inspector (also `I` with `?debug=1`): step through every animation state, with anchor, bounding box, RLEP ID/frame, mirroring and recolouring. |

## Project layout

```
src/main.ts               app shell: start menu, loop, controls, debug panel
src/menu.ts               start menu widgets: toaster-thumb slider, speaker steps
src/simulation/           pure, DOM-free simulation (tested)
  rat-machine.ts          rat behaviour as an XState machine (recovered from the original)
  constants.ts            every recovered number, with its source address
  track.ts                rounded-rectangle loop geometry
  rat.ts                  rat actor wrapper: step timer, position, sprite poses
  race.ts                 race lifecycle and race series
  session.ts              fixed-step timing
  training.ts             Training levels and tuning curves
  random.ts               seeded PRNG
src/render/               Canvas 2D rendering, recolouring, Ratvetica font
src/audio.ts              Web Audio: effects and music
src/debug.ts              frame / anchor inspector
data/                     animations, scene layout, palette mapping, font metrics
public/assets/rat-race/   (git-ignored) extracted artwork, sounds and rendered music
reference/                (git-ignored) raw STFT font metrics used by tools/build-data.mjs
tools/extract.py          extracts all assets from the original files
tools/assets.mjs          uploads and fetches the asset archive in R2
tools/                    also data, menu art and music generation scripts
tools/re/                 regenerates the annotated disassembly of the original code
docs/RECONSTRUCTION.md    evidence, approximations and open questions
```

## Regenerating data

- `npm run data` rebuilds `data/animations.json` (sprite anchors), `data/font.json` and `data/palette-mappings.json` from the assets in `public/`. `npm run extract` runs it for you.
- `npm run extract` calls `tools/extract_panel_art.py` (menu art) and `tools/render_music.py` (music); both can also be run on their own, see their headers.
- `python3 tools/re/disassemble.py "<collection folder>"` regenerates the annotated disassembly that the source addresses in `src/simulation/constants.ts` refer to. It also needs `After Dark Files/AD 3.0 Resources/AD 3.0 Code`. See `tools/re/README.md`.

## Credits

Rat Race 3.0 ©1994 Berkeley Systems, Inc. Programming by Andrew Armstrong. Art by Matt Small. Music is the AD 3.0 Sound library's "William Tell" arrangement (songs 30, 40 and 45) played with that library's own instrument samples.
