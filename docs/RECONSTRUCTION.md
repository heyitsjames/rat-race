# Reconstruction notes

How the remake was put together, what is backed by evidence from the original, and what is approximate. No emulated run of the original was available. The main visual reference is one screenshot of the original running (provided by the owner, 2026-11-05), showing the track layout, staggered gates, pipes, finish line and results board.

## Sources

| Source | Used for |
|---|---|
| Rat Race 3.0 resource fork (SHA-256 `5385f6b3…16a4a`), extracted to PNG/JSON/WAV | All artwork, palettes, font, names, sound effects, settings labels |
| Module code, CODE 129 (RR_D1) and CODE 130 (RR_D2), with relocations resolved (tools/re) | Training table, rat state machine, step timing, distraction odds, finish line, music IDs, 90-minute timer |
| Shared *AD 3.0 Sound* resource fork, via `resource_dasm` | SONG 30/40/45 MIDI and instrument samples |
| Reference screenshot of the original | Track shape, 3 lanes, pipes, gates, finish line, board placement and content |
| Original help text (TEXT 1000) | Settings descriptions, 90-minute track disappearance |

## Fidelity table

Confidence: **High** = read directly from original data or code. **Medium** = matches the reference screenshot or several independent clues. **Low** = implementation choice.

| Feature | Implementation | Evidence | Confidence | Remaining difference |
|---|---|---|---|---|
| Artwork | Original RLEP frames (98 images) via atlases, no smoothing | Decoded resources | High | none |
| Track shape | Rounded-rectangle loop around the screen with a full-width start chute along the bottom | Reference screenshot | Medium | Corner radius (180 px), margin (8 px) and finish position measured by eye |
| Track surface | Original grass (128²) and track (64²) tiles; thin white lane dividers | SiCT 1100/1101; screenshot | Medium | Divider colour/width approximate |
| Lanes / entrants | 3 lanes, 3 rats, 36.6 px lane pitch. **Remake addition:** a Rats setting (3-8, default 3) adds lanes at the same pitch; the corner radius grows a pitch per lane so the inside lane's corners stay the same, the scene grows (still 4:3, scaled to the window) once the infield would drop below 330 px, and the 117 px gate stagger shrinks to keep the outermost gate a rat's length (130 px) short of the finish. Winner share by lane at Cracked stays within chance of even at every count (800 races each) | Screenshot; pipe 1001/0 is 110 px = 3 lanes; photo 1300/0 has 3 lane bands; board has 3 wells | High | none |
| Pipes | 1001/0 drawn at both ends of the chute, over the rats; rats come out of the left pipes and leave through the right | Screenshot plus owner's description of the original | Medium | Entry/exit speed is a guess |
| Gates and start | Rats come out of the pipes (no distractions), then sniff continuously at the gates. The gates drop once every rat is in place **and** the intro song has reached its MIDI end-of-track (13.42 s; 10 s with music off) and a RandInt(4)×500 ms timer has run; the gun/gate sound fires as the doors start, doors show 1200/1 then 1200/2 one 175 ms tick later, then the rats are released and the race music starts; a rat mid-sniff finishes it first; dropped doors stay 2.5 s | RR_D1 controller stages 0-2 (0x47A2 jump table), f5ca4, gate class f03c2/f038c; RR_D2 state 3 at 0x06E6 | High | Gate positions measured from footage |
| Finish line | Dashed white line near the right end of the bottom straight | Screenshot | Medium | Exact x approximate |
| Race length | Exactly one lap: gate, four corners, finish on the bottom straight | RR_D2 states 4→5→…→8; finish x = right − 184 − 30 (RR_D1 0x1E32) | High | none |
| Lane fairness | **Remake change** (`FAIR_CORNERS`): each corner takes a rat the time to cover the inside lane's corner plus a quarter of its lane's gate stagger at its own pace, which repays the staggered gates' head start over the four corners; that same distance is credited toward distraction checkpoints, so every lane also gets the same number of distraction rolls. The original turns every corner in 12 steps in every lane, so the staggered gates give the outer lanes a free head start | RR_D2 per-lane corner tables, FA = 11; gate positions from footage | High (original rule) | Winner share by lane, inside/middle/outside: original Professional 26/31/43%, Cracked 15/29/56% (1,500 races); now within about 2 points of a third at every level (3,000 races each, e.g. Professional 33/33/34%, Cracked 33/34/33%). Set `FAIR_CORNERS` to false for the original. **With 4-8 rats** (`CORNER_DISTRACTIONS`): the extra checkpoints landed right by the wrong-way limit, where a turnaround costs almost nothing, and the outer lanes won up to twice their share at the slower levels. Distractions now happen in corners too, every 42 px of "fair" distance (a corner counts as the inside lane's corner plus a quarter of the lane's stagger), and every lane shares the inside lane's wrong-way limits by race progress, so turn-back points can fall mid-straight or in a corner for outer lanes. Over 1,000 races per level and count, the worst cells leave the outer lanes 1-2 points ahead (from up to 9); `tools/lane-slope.ts` and `tools/lane-fairness.ts` re-run the checks. A rat sniffing, napping, turning round or running the wrong way in a corner is drawn as on the straight it came from, turned by how far round the corner it is, so it follows the curve like a running rat |
| Running and turning | Discrete steps of 7 px; one gait frame per step; corners are 12 turn frames at 92/109 ms; left and down use the right/up frames rotated 180° | RR_D2 f02ac, state 5, sequence XOR 3 for directions 2 and 3 | High | Corner path is a circular arc rather than the original per-step delta tables |
| Anchors | Silk-band centroid of each frame | RLEP stores no hot spot; silk is a fixed body point | Medium | Inspector shows no visible jumps |
| Mirroring | Running left = 1100/0-5 mirrored; running down = 1100/18-23 flipped vertically | No left/down art exists | Medium | Lighting flips on mirrored frames |
| Lane changes | None: rats stay in their lane | No lane-change code exists in RR_D2 | High | none |
| Distractions | Turn round and run the wrong way (1102/17-28), nap/curl (1101/24-32, 1102/0-16 vertically), stop and sniff (1101/12 rump + 13-17 front, 18 + 19-23 vertically) | RR_D2 states 6/7, f1c1a, f171e; frame numbers in code | High (what and when) / Medium (frame-by-frame choreography) | Nap and sniff frame sequences are simplified from the decoded control flow |
| Training | Per-thousand odds per checkpoint (every 6 steps): Drop Out 450/150/50, Grade School 60/20/700, High School 50/250/500, Collegiate 50/100/350, Professional 25/75/200 (turn round / nap / sniff) | RR_D1 0x4126 (f4126) sets three globals compared against RandInt(1000) in RR_D2 0x0988 | High | none |
| Start menu | After Dark-style window: AD 3.0 faceplate (PICT 128), module icon (icl4 1000), Training slider (sUnt/sVal 1000), Race Track checkbox (xVal 1001), Music slider (sUnt/sVal 1002), help text (TEXT 1000), toaster slider thumbs (THUM 128 → ics8 128/130/131/132) and speaker icons (ICON 128-133), then a Run Race button | Faceplate from *After Dark 3.0 Faceplate*; thumbs and speaker icons from the *After Dark 4.94* control panel, as the AD 3.0 control panel itself isn't in the collection | Medium (art) / Low (layout) | Window layout, slider groove, fonts and thumb flap speed are approximations; the original panel had a module list and a Demo button rather than Run Race |
| Cracked (added) | Sixth Training level at the top of the slider (100): turn round 3, nap 10, sniff 50 per thousand, and a wrong-way rat turns back at 150 per thousand (the original levels turn back at their turn-round odds) | Not in the original | — | Remake addition |
| Recolouring | Exact colour substitution from clut 1100: 6 fur ramps × 5 silk ramps; silks unique within a race. **Remake addition:** 3 more silks (orange, teal, orchid) so races of up to 8 rats never repeat one, chosen by farthest-point search in OKLab from the original silks and clear of the fur colours (`extendSilks` in `tools/build-data.mjs`; orange replaces the search's magenta by owner's choice) | clut 1100 layout; ramp 0 equals sprite palettes exactly | High (data) / Medium (use) | clut 1101 and 1050/1051 and entries 80-101 (likely 16-colour variants) unused |
| Entrants board | 1400/0 over 1400/1 in the infield centre, always showing the current race's three entrants (silk-coloured head 1150/0 and Ratvetica name, inner lane at the top); as each of the first three crosses the line its row gains W I N / P L A C E / S H O W (RatN 2003) under the name, rows staying in lane order (RR_D2 0x07E4-0x082C counter g03cc from 1, drawn at RR_D1 0x0F16; owner's screenshot); a photo finish replaces the panel with the photo for 3 s. **Remake addition:** 4 rats get a 4-well board and 5-8 rats two equal columns, made by repeating a 48 px strip of the original board (rows 50-98 repeat exactly); the photo, which has 3 lane bands, shows the winner and the two closest centred in the first column's panel | Exact size fit to 1300/0 and 1150/0; footage shows the entrants during staging and racing | High | none |
| Photo finish | When the winner crosses, any other rat on the same straight, not running the wrong way, within 20 px of it → camera click, 3 s photo board, and those rats ranked by nose position at that instant (needs the track visible). Rare (~1 race in 150) | RR_D1 0x5064-0x52DC, closeness at 0x5370-0x53E0 | High (rule) / Low (photo layout) | How the still is drawn is not recovered |
| Bitmap font | Ratvetica strip with STFT 110 glyph offsets (chars 33-126) | Marker dots on the strip's bottom row match the offsets | High | Header words (9, 3, 10, 1) not fully decoded; space width (4) guessed |
| Sound effects | snd 1001 (gate/gun) as the gates drop; snd 1000 (click) is the photo-finish camera | Music player messages 3 and 2 sent from RR_D1 0x4D5E and 0x5182 | High | none |
| Music | SONG 30 intro from staging, SONG 40 looping from the release, SONG 45 when the winner crosses | RR_D1 player messages 4, 5, 6 (0x4ABA, 0x4E10, 0x5072); song IDs at 0x5BD6-0x5C72 | High | Rendered offline with a simple sampler; the original MIDI synth's envelopes and mixing differ |
| Music setting | Never / Once (first race of the session) / Twice (first two) / Always | Control value / 25 → count, decremented after each race unless 3 (RR_D1 0x18AE, 0x56EA) | High | none |
| 90-minute rule | Track hidden once 90 min of running time has accumulated; rats keep racing | Help text | High (rule) / Low (clock) | See session clock decisions |
| Scale | Fixed 1024×768 (4:3) scene, letterboxed or pillarboxed in the window | Footage of the original at 1024×768 (lane pitch 35 px matches the code) | High | The original's 2-lane small-screen variant (1001/1, 1300/1, 1400/0 alone) isn't implemented |

## Recovered pacing and behaviour

From the rat state machine in RR_D2 (message handler 0x0420); constants with their code addresses are in `src/simulation/constants.ts`, and the machine itself is `src/simulation/rat-machine.ts` (XState).

- Each rat steps on its own millisecond timer. A step advances the gait one frame and moves 7 px.
- Out of the pipe: 75 ms per step, lane n starting n × 25 ms late, random starting gait frame. No distractions (matches footage of the original).
- At the gate the interval becomes 126 ms and stays so after the gates drop until re-rolled.
- Every 6 steps on a straight: one time in three the interval is re-rolled to 75 + 17 × RollD(3) (92, 109 or 126 ms); then RandInt(1000) is compared with the Training odds.
- Corners: 12 turn frames at 75 + 17 × RollD(2) ms, so rats speed up through corners (outer lane ~3×), as in the original. With `FAIR_CORNERS` on (the default) corner timing is set for lane fairness instead, and outer lanes speed up only slightly; rats then take corners in stride-sized (~7 px) steps, because 12 slow steps of up to 21 px looked like the rat glitching forward. **Remake change:** in corners the rat keeps its normal walk cycle and the sprite is rotated to follow the curve, instead of the original 12 turn frames (1100/6-17, 1101/0-11), which have no walk cycle and looked stiff and choppy when held over several steps. The original turn frames are still in the corner lab (`?corners=1`) for comparison; with it off, `CORNER_SPEED_BLEND` (1 = original) applies.
- Turn round: 6 frames at 126 ms, then a sniff, then running backwards with the same checkpoints (turn back with the turn-round odds, sniff, no naps); a rat reaching the start of its straight turns back automatically.
- Nap: one of 8 variants (never the same twice running); shallow ones wiggle 4-6 times, deep ones loop the curl or sleep 2-3 extra times then uncurl; nap steps are 17 ms slower.
- Sniff: one of 3 variants (never the same twice running), head flicking or wandering until a coin flip ends it.
- Distractions are on from the gates opening until the winner crosses the line. At that moment every other rat drops what it is doing: a napping or sniffing rat gets straight up, a wrong-way rat turns round at once, and nobody starts a new distraction, so they all run the rest of the lap into the pipe. This follows the owner's recollection of the original (2026-11-05). The code (f15b6) reads as switching distractions off a little later, once the first finisher is completely off screen, and does not show in-progress naps being cut short. Once there is a winner, any rat on the home straight heads straight for the pipe (RR_D2 0x1536).
- A rat running the wrong way turns back 65 px into its straight (RR_D2 corner-exit handler 0x0E6C-0x0ED0); on the first straight the original limit is screen-left + 130, approximated here as the start of the straight.
- Typical race length at 1024×768: Professional winner ≈ 80 s, Collegiate ≈ 2 min, Grade/High School ≈ 2.5-3 min. Drop Out is close to a coin flip on each straight (45% turn-round odds both ways), but a wrong-way rat can't run back past the start of its straight, so progress ratchets forward a corner at a time: simulated over 500 races the winner crosses at 5-34 min (median 14, 99% within 30 min). As in the original, there is no time limit.
- The original's speed was also bounded by its frame rate; on a slow 1994 Mac steps may have come later than these timers allow.

## Session clock decisions

- The clock advances with simulated time only. It stops while paused and while the tab is hidden.
- Each frame contributes at most 0.25 s, so returning to a background tab never fast-forwards the race.
- Moving the mouse or using the controls doesn't reset it. Restart does.
- `?session=N` (minutes) and the debug "+30 min" button exist so the transition can be tested without waiting.

## Image record classification

| Records | Status |
|---|---|
| 1100/0-23, 1101/0-11 | Used: running poses (also rotated through corners); the turn frames 1100/6-17 and 1101/0-11 appear only in the corner lab |
| 1101/24-32, 1102/0-16 | Used: nap (1102/4-16 are the vertical-straight versions; there is no grooming) |
| 1102/17-28 | Used: wrong-way turnarounds |
| 1102/4 | Used: standing pose on vertical straights |
| 1101/12-23 | Used: sniff (still rump + moving front half, horizontal and vertical) |
| 1001/0 | Used: pipe mouths |
| 1001/1 | 2-lane pipe (small-screen variant in the original); the remake stacks it with 1001/0 for 4-8 lanes (`pipePieces`) |
| 1150/0 | Used: results heads |
| 1150/1-2 | Not yet understood: highlight frame and large head (perhaps the control-panel preview) |
| 1200/0-2 | Used: gate doors |
| 1300/0 | Used: photo-finish still |
| 1300/1 | Not used: 2-lane photo (small-screen variant) |
| 1400/0-1 | Used: results board |

## Music rendering

`tools/render_music.py` parses the cmid MIDI resources, maps program numbers to the SONG resources' instrument tables, and resamples the original float samples with their loop points. The loop song's release tail is folded onto its start so it loops seamlessly. Note-release time and mixing gain are approximations of the AD synth.

## Open questions

- How the photo-finish still is drawn; per-rat field +0xD6 (set to 2/3/4 by the controller, possibly drawing order).
- Any remaining gap between the intro ending and the gun: the code accounts for ~0.5 s (MIDI end-of-track after the last note) plus the 175 ms door tick; the original sound player may add more.
- What 1150/1-2 are for; the 2-lane small-screen variant is not implemented.
- Meaning of the STFT header words and the CTAB metadata byte.
