#!/usr/bin/env node
// Derive sprite anchors and write data/animations.json.
//
// The RLEP image records all start at (0,0) and store no hot spot, so anchors
// come from the artwork itself. Every full rat pose carries the purple silk
// band at a fixed spot on the rat's back; its centroid is the body anchor.
// Partial photo-finish pieces are anchored on their cut edge instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ATL = path.join(ROOT, 'public/assets/rat-race/atlases');
const SILK = new Set(['51,38,102', '97,63,156', '117,81,171', '138,102,204']);

function load(sheet) {
  const meta = JSON.parse(fs.readFileSync(path.join(ATL, `${sheet}.json`), 'utf8'));
  const png = PNG.sync.read(fs.readFileSync(path.join(ATL, `${sheet}.png`)));
  return { frames: meta.frames, png };
}

function silkAnchor(png, f) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const o = ((f.y + y) * png.width + f.x + x) * 4;
      const d = png.data;
      if (d[o + 3] && SILK.has(`${d[o]},${d[o + 1]},${d[o + 2]}`)) { sx += x; sy += y; n++; }
    }
  }
  return n ? [Math.round((sx / n) * 10) / 10, Math.round((sy / n) * 10) / 10] : null;
}

const out = { sheets: {}, states: {} };
for (const sheet of [1100, 1101, 1102, 1150]) {
  const { frames, png } = load(sheet);
  out.sheets[sheet] = frames.map((f) => {
    const a = silkAnchor(png, f);
    return { i: f.frame, x: f.x, y: f.y, w: f.width, h: f.height, ax: a ? a[0] : null, ay: a ? a[1] : null };
  });
}
for (const sheet of [1001, 1200, 1300, 1400]) {
  const { frames } = load(sheet);
  out.sheets[sheet] = frames.map((f) => ({ i: f.frame, x: f.x, y: f.y, w: f.width, h: f.height, ax: 0, ay: 0 }));
}
// Sniff pieces (RR_D2 f171e): the rump/tail piece stays still while the front
// half animates, and every piece shares one cut line. The original positions
// sprites by their top-left corner, so all front halves share the same cut-edge
// offset from the rat's anchor (taken from 1101/13's silk, or 1101/19's
// vertically) instead of each using its own silk band, which moves as the head
// turns. Horizontal pieces are cut at the front's left edge, vertical ones at
// the front's bottom edge.
const s = out.sheets[1101];
const cutX = Math.round(s[13].ax); // anchor -> cut line, horizontal pieces
const rowY = Math.round(s[13].ay);
for (let i = 13; i <= 17; i++) Object.assign(s[i], { ax: cutX, ay: rowY });
Object.assign(s[12], { ax: cutX + s[12].w, ay: rowY });
const colX = Math.round(s[19].ax);
const cutY = Math.round(s[19].h - s[19].ay); // anchor -> cut line, vertical pieces
for (let i = 19; i <= 23; i++) Object.assign(s[i], { ax: colX, ay: s[i].h - cutY });
Object.assign(s[18], { ax: colX, ay: -cutY });

const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
const seq = (sheet, idx) => idx.map((i) => [sheet, i]);
// heading: direction of travel in degrees (0 = right, 90 = up the screen)
Object.assign(out.states, {
  'run-right': { frames: seq(1100, range(0, 6)), ms: 109, loop: true, heading: 0 },
  'turn-right-up': { frames: seq(1100, range(6, 18)), ms: 100, loop: false, heading: [0, 90] },
  'run-up': { frames: seq(1100, range(18, 24)), ms: 109, loop: true, heading: 90 },
  'turn-up-left': { frames: seq(1101, range(0, 12)), ms: 100, loop: false, heading: [90, 180] },
  stop: { frames: seq(1101, [24]), ms: 150, loop: false, heading: 0 },
  'turn-around': { frames: seq(1102, range(17, 23)), ms: 126, loop: false, heading: [0, 180] },
  'turn-around-up': { frames: seq(1102, range(23, 29)), ms: 126, loop: false, heading: [90, 270] },
  // Nap (RR_D2 f1c1a): original frames 48-60 = 1101/24-32 + 1102/0-3; on vertical
  // straights the code adds 13, giving 1102/4-16.
  nap: { frames: [...seq(1101, range(24, 33)), ...seq(1102, range(0, 4))], ms: 109, loop: false },
  'nap-vertical': { frames: seq(1102, range(4, 17)), ms: 109, loop: false },
  // Sniff (RR_D2 f171e): original frames 36-41 = 1101/12 rump + 13-17 front; +6 vertically.
  'sniff-rump': { frames: seq(1101, [12]), ms: 109, loop: false },
  'sniff-front': { frames: seq(1101, range(13, 18)), ms: 109, loop: true },
  'sniff-rump-up': { frames: seq(1101, [18]), ms: 109, loop: false },
  'sniff-front-up': { frames: seq(1101, range(19, 24)), ms: 109, loop: true },
});
const file = path.join(ROOT, 'data/animations.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log('wrote', file);

// ---- Ratvetica font metrics (STFT 110) ----
// Layout (big-endian words): [0]=9 [1]=3 [2]=10 [3]=1, then 94 glyph start x
// offsets for chars 33..126, then 94 width bytes. The glyph starts match the
// marker dots on the strip's bottom row, which confirms the mapping.
{
  const b = fs.readFileSync(path.join(ROOT, 'reference/STFT_110.bin'));
  const words = [];
  for (let i = 0; i < 0xc4; i += 2) words.push(b.readUInt16BE(i));
  const starts = words.slice(4);
  const widths = [...b.subarray(0xc4)];
  const stripWidth = 578;
  const glyphs = {};
  starts.forEach((x, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : stripWidth;
    glyphs[String.fromCharCode(33 + i)] = { x, w: end - x };
  });
  const font = {
    source: 'STFT 110 + PiCT 110 (Ratvetica)',
    header: words.slice(0, 4),
    headerNote: 'Header semantics unverified; 9 is treated as ascent and 3 as descent (12 ink rows).',
    rows: 12,
    spaceWidth: 4,
    storedWidths: widths,
    glyphs,
  };
  fs.writeFileSync(path.join(ROOT, 'data/font.json'), JSON.stringify(font, null, 1));
  console.log('wrote data/font.json');
}

// ---- Extra silks (remake addition) ----
//
// The original has five silks; races of up to eight rats need three more. They
// are chosen by greedy farthest-point search in OKLab: every in-gamut 4-shade
// ramp built from the original ramps' average shape (lightness and chroma of
// each shade relative to the brightest) is a candidate, and each pick maximises
// its smallest distance (mean OKLab distance over the 4 shades) to the silks
// already chosen. Candidates within 0.08 of any fur shade are skipped so the
// silk band never blends into the coat. That picks magenta, teal and orchid.
// By the owner's choice magenta is then swapped for the orange (OKLCh hue
// 45-70) farthest from the other seven; the russet and golden coats are
// orange-brown, so no orange clears 0.08 from them (the best is about 0.067)
// and the orange uses a 0.06 gap instead.

const srgbToLinear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to 8-bit sRGB, or null when out of gamut. */
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return lin.map((v) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255));
}

const labDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const rampDist = (A, B) => A.reduce((s, a, i) => s + labDist(a, B[i]), 0) / A.length;

function extendSilks(silks, furs, count, swap) {
  const ramps = silks.map((r) => r.map(rgbToOklab));
  const chroma = (p) => Math.hypot(p[1], p[2]);
  const shape = [0, 1, 2, 3].map((i) => [
    ramps.reduce((s, r) => s + r[i][0] / r[3][0], 0) / ramps.length,
    ramps.reduce((s, r) => s + chroma(r[i]) / chroma(r[3]), 0) / ramps.length,
  ]);
  const furLab = furs.flat().map(rgbToOklab);
  const candidates = [];
  for (let L = 55; L <= 86; L++)
    for (let C = 8; C <= 32; C++)
      for (let h = 0; h < 360; h += 2) {
        const hr = (h * Math.PI) / 180;
        const rgb = shape.map(([kl, kc]) => oklabToRgb([(L / 100) * kl, (C / 100) * kc * Math.cos(hr), (C / 100) * kc * Math.sin(hr)]));
        if (rgb.some((c) => !c)) continue;
        const lab = rgb.map(rgbToOklab);
        const furGap = Math.min(...furLab.flatMap((f) => lab.map((p) => labDist(p, f))));
        candidates.push({ rgb, lab, h, furGap });
      }
  const farthest = (others, ok) => {
    let best = null;
    let bestD = -1;
    for (const c of candidates) {
      if (!ok(c)) continue;
      const d = Math.min(...others.map((r) => rampDist(r, c.lab)));
      if (d > bestD) [best, bestD] = [c, d];
    }
    return best;
  };
  const chosen = [];
  for (let k = 0; k < count; k++) {
    const best = farthest(ramps, (c) => c.furGap >= 0.08);
    ramps.push(best.lab);
    chosen.push(best);
  }
  if (swap) {
    const at = silks.length + swap.index;
    const others = ramps.filter((_, i) => i !== at);
    chosen[swap.index] = farthest(others, (c) => c.furGap >= swap.furGap && c.h >= swap.hue[0] && c.h <= swap.hue[1]);
  }
  return chosen.map((c) => c.rgb);
}

// ---- Furs n Silks palette mapping (clut 1100) ----
{
  const clut = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/rat-race/palettes/1100.json'), 'utf8'))
    .map((c) => [c.r, c.g, c.b]);
  const furs = [0, 1, 2, 3, 4, 5].map((k) => clut.slice(k * 10, k * 10 + 10));
  const silks = [0, 1, 2, 3, 4].map((k) => clut.slice(60 + k * 4, 64 + k * 4));
  const extraSilks = extendSilks(silks, furs, 3, { index: 0, hue: [45, 70], furGap: 0.06 });
  const map = {
    source: 'clut 1100 (Furs n Silks)',
    note:
      'Entries 0-59 form six 10-colour fur ramps (9 coat shades + 1 nose/ear tone); entries 60-79 form five ' +
      '4-colour silk ramps. Ramp 0 and silk 0 equal the colours stored in the rat RLEP palettes, so a sprite ' +
      'is recoloured by exact colour substitution. Entries 80-101 (paired duplicates) are not used here. ' +
      'Silks 5-7 are not in the original: they are generated by extendSilks() (tools/build-data.mjs) so races ' +
      'of up to 8 rats never repeat a silk.',
    sourceFur: furs[0],
    sourceSilk: silks[0],
    furs,
    silks: [...silks, ...extraSilks],
    furNames: ['tan', 'grey', 'rose', 'olive', 'russet', 'golden'],
    silkNames: ['purple', 'gold', 'green', 'blue', 'red', 'orange', 'teal', 'orchid'],
  };
  fs.writeFileSync(path.join(ROOT, 'data/palette-mappings.json'), JSON.stringify(map, null, 1));
  console.log('wrote data/palette-mappings.json');
}
