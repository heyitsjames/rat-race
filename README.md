# Rat Race

A browser reconstruction of the After Dark 3.0 screensaver module **Rat Race** (©1994 Berkeley Systems, Inc.; programming by Andrew Armstrong, art by Matt Small), built from the original artwork, sounds and music recovered from the module and the shared AD 3.0 Sound library.

Three rats come out of the pipes, line up behind staggered gates, race one lap of a track that rings the screen, and leave through the pipes at the far end. The results board then shows in the infield while the next three line up. It runs unattended indefinitely. After 90 minutes the track disappears and the rats carry on racing on the grass, as in the original.

This is a private, personal-use project. The artwork, sounds and music are Berkeley Systems' and are not relicensed here.

![Results board during staging](docs/screenshots/05-results-board.jpg)

## Run it

Requires Node 20+ (tested with Node 24).

```sh
npm install        # install dependencies
npm run dev        # dev server at http://localhost:5173
npm test           # deterministic simulation tests (vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build at http://localhost:4173
```

`dist/` is a static site with relative URLs, so it can be served from any folder or subpath.

## Controls

The page opens on a start menu modelled on the After Dark 3.0 control panel: the AD 3.0 faceplate, the module's own **Training** and **Music** sliders (with the control panel's flying-toaster slider thumbs) and **Race Track** checkbox, a speaker button that steps through the volume icons, and **?** for the module's help text. **Run Race** (or Enter) starts a fresh session; **Menu** in the control bar (or Esc) stops it and returns to the menu. Add `?run=1` to skip the menu.

While racing, the control bar and cursor hide after 3 seconds without input; move the mouse or press a key to bring them back.

| Key | Action |
|---|---|
| Enter | Run Race (from the menu) |
| Space | Pause / resume |
| R | Restart (new races, resets the 90-minute clock) |
| F | Fullscreen |
| M | Sound on/off |
| T | Race Track on/off |
| Esc | Close About, otherwise back to the menu |

Settings (saved in this browser): **Training** (Drop Out … Professional, plus an added **Cracked** level at the top), **Race Track**, **Music** (Never / Once / Twice / Always), sound and volume. Browsers only allow audio after a click or key press; pressing Run Race counts, so music starts with the first race.

## Debug tools

Add query parameters to the URL:

| Parameter | Effect |
|---|---|
| `?debug=1` | Diagnostics panel: seed, phase, per-rat mode/position, session clock, audio nodes, recolour cache. Buttons for +30 min, speed ×1/×4/×16, the frame inspector and skipping to the next race. |
| `?seed=1234` | Fixed seed for reproducible races (outcomes also depend on window size, which sets the track shape). |
| `?speed=16` | Simulation speed multiplier. |
| `?session=90` | Start the 90-minute clock at N minutes (90 hides the track immediately). |
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
  session.ts              90-minute clock, fixed-step timing
  training.ts             Training levels and tuning curves
  random.ts               seeded PRNG
src/render/               Canvas 2D rendering, recolouring, Ratvetica font
src/audio.ts              Web Audio: effects and music
src/debug.ts              frame / anchor inspector
data/                     animations, scene layout, palette mapping, font metrics
public/assets/rat-race/   original artwork, sounds and rendered music
  panel/                  After Dark control panel art for the start menu
tools/                    data and music generation scripts; tools/re has the annotated original code
docs/RECONSTRUCTION.md    evidence, approximations and open questions
docs/screenshots/         validation screenshots
reference/                raw STFT font metrics used by tools/build-data.mjs
```

## Regenerating data

- `npm run data` rebuilds `data/animations.json` (sprite anchors), `data/font.json` and `data/palette-mappings.json` from the assets in `public/`.
- Menu art: `tools/extract_panel_art.py` exports the AD 3.0 faceplate, slider thumbs and speaker icons from the *After Dark 3.0 Faceplate* and *After Dark* control panel resource forks (Python 3 + Pillow). See the script header.
- Music: `tools/render_music.py` renders the three William Tell songs from a `resource_dasm` export of the original *AD 3.0 Sound* resource fork (Python 3 + numpy). Only needed if you want to re-render; the WAVs are committed. See the script header for the exact commands.

## Credits

Rat Race 3.0 ©1994 Berkeley Systems, Inc. Programming by Andrew Armstrong. Art by Matt Small. Music is the AD 3.0 Sound library's "William Tell" arrangement (songs 30, 40 and 45) played with that library's own instrument samples.
