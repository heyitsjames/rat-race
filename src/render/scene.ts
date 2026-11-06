import layout from '../../data/scene-layout.json';
import type { Placing, Race } from '../simulation/race';
import type { Pose, Rat } from '../simulation/rat';
import type { Track } from '../simulation/track';
import { GATE_FRAME_MS } from '../simulation/constants';
import { DEFAULT_LANES, sceneSize } from '../simulation/track';
import { BitmapFont } from './bitmap-font';
import { animFrame, type Assets, drawFrame, frameRect, Recolorer } from './sprites';
import labels from '../../public/assets/rat-race/rat-names-and-labels.json';

export interface Viewport {
  /** Logical scene size: 1024x768 (4:3) for three lanes, as the original; larger for more (sceneSize). */
  width: number;
  height: number;
  /** Device pixels per logical pixel. */
  scale: number;
  /** Device-pixel offset of the scene inside the canvas (letterbox / pillarbox bars). */
  offsetX: number;
  offsetY: number;
}

/** Fit the 4:3 scene for this many lanes inside the window, centred, with bars on the spare sides. */
export function computeViewport(cssW: number, cssH: number, dpr: number, lanes: number = DEFAULT_LANES): Viewport {
  const { width, height } = sceneSize(lanes);
  const scale = Math.min((cssW * dpr) / width, (cssH * dpr) / height);
  return {
    width,
    height,
    scale,
    offsetX: Math.round((cssW * dpr - width * scale) / 2),
    offsetY: Math.round((cssH * dpr - height * scale) / 2),
  };
}

/** Canvas transform for drawing in logical scene coordinates. */
export function sceneTransform(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
}

const [PHOTO, FINISH] = labels['2002'];
/** RatN 2003: W I N / P L A C E / S H O W. */
const PLACE_LABELS = labels['2003'];
/** Furthest a placed rat is drawn behind the winner in the photo-finish still. */
const PHOTO_MAX_GAP_PX = 70;
/** How far past the line the winner's nose is drawn in the still. */
const PHOTO_NOSE_PAST_LINE_PX = 5;
/** Ratvetica line height used on the results board. */
const BOARD_LINE_HEIGHT = 12;
/** Inner padding of the board's name panel. */
const BOARD_PANEL_PADDING = 4;
/** Where the photo-finish labels sit in the panel: PHOTO near the top, FINISH near the bottom. */
const PHOTO_LABEL_TOP_PX = 9;
const PHOTO_LABEL_BOTTOM_PX = 13;

/** Board layout for `rats` entrants: one column up to four, then two equal columns. */
export function boardGrid(rats: number): { columns: number; rows: number } {
  const columns = rats <= 4 ? 1 : 2;
  return { columns, rows: Math.max(layout.board.squares.length, Math.ceil(rats / columns)) };
}

/**
 * Pipe pieces, inside lane first, that make up a column of `lanes` pipe mouths:
 * three-pipe pieces (1001/0) with two-pipe ones (1001/1) for the remainder,
 * e.g. 8 = 3 + 3 + 2 and 7 = 3 + 2 + 2.
 */
export function pipePieces(lanes: number): number[] {
  const twos = [0, 2, 1][lanes % 3];
  const threes = (lanes - 2 * twos) / 3;
  return [...Array(threes).fill(3), ...Array(twos).fill(2)];
}

export class SceneRenderer {
  readonly font: BitmapFont;
  readonly recolor: Recolorer;
  private grass: CanvasPattern | null;
  private trackPattern: CanvasPattern | null;
  private boardImages = new Map<number, HTMLCanvasElement>();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly assets: Assets,
  ) {
    this.font = new BitmapFont(assets.font);
    this.recolor = new Recolorer(assets);
    this.grass = ctx.createPattern(assets.grass, 'repeat');
    this.trackPattern = ctx.createPattern(assets.track, 'repeat');
  }

  render(race: Race, vp: Viewport): void {
    const { ctx } = this;
    const track = race.track;
    sceneTransform(ctx, vp);
    ctx.imageSmoothingEnabled = false;

    this.fill(this.grass, () => ctx.rect(0, 0, vp.width, vp.height));
    this.drawTrack(track, this.doorFrame(race));

    const placed = race.rats
      .filter((rat) => rat.visible)
      .map((rat) => ({ rat, p: rat.position(track) }))
      .sort((a, b) => a.p.y - b.p.y || a.rat.lane - b.rat.lane);
    for (const { rat, p } of placed) {
      if (rat.chuteX === null) {
        this.drawRat(rat, p.x, p.y, vp.scale);
        continue;
      }
      // In the chute: only the part between the pipe mouths is visible.
      ctx.save();
      ctx.beginPath();
      ctx.rect(track.margin, 0, track.width - 2 * track.margin, track.height);
      ctx.clip();
      this.drawRat(rat, p.x, p.y, vp.scale);
      ctx.restore();
    }
    // Pipe mouths go over the rats so they vanish into them.
    this.drawPipes(track);

    // The board always shows this race's entrants, inner lane at the top; a photo
    // finish replaces the name panel with the photo for 3 s. As each of the first
    // three crosses the line its row gains WIN / PLACE / SHOW under the name
    // (RR_D2 0x07E4-0x082C: the row takes a counter that starts at 1 and counts up
    // with each finisher; RR_D1 0x0F16 draws that string of RatN 2003).
    const entrants = [...race.rats].sort((a, b) => a.lane - b.lane);
    const standings = race.standings;
    const places = entrants.map((r) => (r.finished ? standings.indexOf(r) : -1));
    this.drawBoard(vp, entrants, race.photoVisible ? race : null, places);
  }

  private fill(pattern: CanvasPattern | null, path: () => void, rule: CanvasFillRule = 'nonzero'): void {
    if (!pattern) return;
    const { ctx } = this;
    ctx.beginPath();
    path();
    ctx.fillStyle = pattern;
    ctx.fill(rule);
  }

  private drawTrack(track: Track, door: number | null): void {
    const { ctx } = this;
    const m = track.margin;
    const W = track.width;
    const H = track.height;
    const R = track.outerRadius;
    const tw = track.trackWidth;
    const lh = track.laneHeight;
    // Ring plus the full-width starting chute along the bottom.
    this.fill(this.trackPattern, () => {
      ctx.roundRect(m, m, W - 2 * m, H - 2 * m, R);
      ctx.roundRect(m + tw, m + tw, W - 2 * (m + tw), H - 2 * (m + tw), R - tw);
    }, 'evenodd');
    this.fill(this.trackPattern, () => ctx.rect(m, H - m - tw, W - 2 * m, tw));
    // Lane dividers: around the loop, and straight across the chute.
    ctx.strokeStyle = layout.track.laneLine;
    ctx.lineWidth = 1;
    for (let i = 1; i < track.lanes; i++) {
      const d = i * lh;
      ctx.beginPath();
      ctx.roundRect(m + d, m + d, W - 2 * (m + d), H - 2 * (m + d), R - d);
      ctx.stroke();
      const y = Math.round(H - m - d) + 0.5;
      ctx.beginPath();
      ctx.moveTo(m, y);
      ctx.lineTo(W - m, y);
      ctx.stroke();
    }
    // Finish line across the bottom straight.
    const fx = Math.round(track.finishX()) + 0.5;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(fx, H - m - tw);
    ctx.lineTo(fx, H - m);
    ctx.stroke();
    ctx.restore();

    // Staggered starting-gate doors in front of each lane.
    if (door !== null) {
      const d = frameRect(1200, door);
      for (let lane = 0; lane < track.lanes; lane++) {
        const x = Math.round(track.gateNoseX(lane) + layout.gate.doorGap);
        const y = Math.round(track.bottomLaneY(lane) - d.h / 2);
        ctx.drawImage(this.assets.sheets['1200'], d.x, d.y, d.w, d.h, x, y, d.w, d.h);
      }
    }
  }

  /**
   * Pipe mouths at both ends of the start chute: rats come out of the left one
   * and leave through the right one. The original three lanes use 1001/0 (three
   * pipes, 110 px); other counts stack it with the small-screen 1001/1 (two
   * pipes, 73 px), which has the same lane pitch (see pipePieces).
   */
  private drawPipes(track: Track): void {
    const { ctx } = this;
    const img = this.assets.sheets['1001'];
    let lane = 0;
    for (const size of pipePieces(track.lanes)) {
      const pipe = frameRect(1001, size === 3 ? 0 : 1);
      const y = Math.round(track.height - track.margin - track.trackWidth + lane * track.laneHeight);
      ctx.drawImage(img, pipe.x, pipe.y, pipe.w, pipe.h, track.margin, y, pipe.w, pipe.h);
      ctx.drawImage(img, pipe.x, pipe.y, pipe.w, pipe.h, Math.round(track.width - track.margin - pipe.w), y, pipe.w, pipe.h);
      lane += size;
    }
  }

  /**
   * Door frame for the current phase (RR_D1 gate f03c2): closed while staging,
   * frame 1 as soon as the gun goes and frame 2 one gate tick later. The
   * dropped door then stays up for the rest of the race (footage of the original).
   */
  doorFrame(race: Race): number {
    if (race.phase === 'staging') return 0;
    if (race.phase === 'gates') return race.phaseTime * 1000 >= GATE_FRAME_MS ? 2 : 1;
    return 2;
  }

  drawRat(rat: Rat, x: number, y: number, snap: number): void {
    this.drawPose(rat.pose(), rat.fur, rat.silk, x, y, snap);
  }

  /**
   * Debug scenes (corner lab): grass, track with dropped gates, then sprites
   * given directly as poses rather than from a race.
   */
  renderLab(vp: Viewport, track: Track, sprites: { pose: Pose; fur: number; silk: number; x: number; y: number }[]): void {
    const { ctx } = this;
    sceneTransform(ctx, vp);
    ctx.imageSmoothingEnabled = false;
    this.fill(this.grass, () => ctx.rect(0, 0, vp.width, vp.height));
    this.drawTrack(track, 2);
    for (const s of [...sprites].sort((a, b) => a.y - b.y)) this.drawPose(s.pose, s.fur, s.silk, s.x, s.y, vp.scale);
  }

  private drawPose(pose: Pose, fur: number, silk: number, x: number, y: number, snap: number): void {
    const rat = { fur, silk };
    const opts = { flipX: pose.flipX, flipY: pose.flipY, snap, rotate: pose.rotate };
    if (pose.under) {
      const u = animFrame(pose.under.anim, pose.under.frame);
      drawFrame(this.ctx, this.recolor.sheet(u.sheet, rat.fur, rat.silk), u.rect, x, y, opts);
    }
    const { sheet, rect } = animFrame(pose.anim, pose.frame);
    drawFrame(this.ctx, this.recolor.sheet(sheet, rat.fur, rat.silk), rect, x, y, opts);
  }

  /**
   * The board's two pieces (1400/0 over 1400/1) joined into one image, `rows`
   * wells tall. Drawn separately, the join can land mid-pixel at non-integer
   * scales and let the grass show through as a faint line. Each well past the
   * original three repeats a 48 px strip from the middle (boardRows).
   */
  private board(rows: number): HTMLCanvasElement {
    const cached = this.boardImages.get(rows);
    if (cached) return cached;
    const b = layout.board;
    const t0 = frameRect(1400, 0);
    const t1 = frameRect(1400, 1);
    const s = this.assets.sheets['1400'];
    const base = document.createElement('canvas');
    base.width = b.width;
    base.height = b.topHeight + t1.h;
    const g0 = base.getContext('2d')!;
    g0.drawImage(s, t0.x, t0.y, t0.w, t0.h, 0, 0, t0.w, t0.h);
    g0.drawImage(s, t1.x, t1.y, t1.w, t1.h, 0, b.topHeight, t1.w, t1.h);
    const extra = rows - b.squares.length;
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height + extra * b.slotPitch;
    const g = c.getContext('2d')!;
    const { from, to } = b.repeat;
    // Everything above the strip's end, the strip again per extra well, then the rest.
    g.drawImage(base, 0, 0, c.width, to, 0, 0, c.width, to);
    for (let k = 0; k < extra; k++) g.drawImage(base, 0, from, c.width, to - from, 0, to + k * b.slotPitch, c.width, to - from);
    g.drawImage(base, 0, to, c.width, base.height - to, 0, to + extra * b.slotPitch, c.width, base.height - to);
    this.boardImages.set(rows, c);
    return c;
  }

  /**
   * Results board in the infield, one head and name per well: the original
   * single three-well board for three rats, taller or in two columns for more
   * (boardGrid), inner lanes first down the left column.
   */
  private drawBoard(vp: Viewport, placings: Placing[], photoRace: Race | null, places: number[] = []): void {
    const { ctx } = this;
    const b = layout.board;
    const { columns, rows } = boardGrid(placings.length);
    const img = this.board(rows);
    const totalW = columns * img.width + (columns - 1) * b.columnGap;
    const bx0 = Math.round(vp.width / 2 - totalW / 2);
    const by = Math.round(vp.height / 2 - img.height / 2);
    const panelH = b.panel.h + (rows - b.squares.length) * b.slotPitch;
    const head = frameRect(1150, 0);
    const slot = (k: number) => {
      const bx = bx0 + Math.floor(k / rows) * (img.width + b.columnGap);
      return { bx, px: bx + b.panel.x, wellY: by + b.squares[0].y + (k % rows) * b.slotPitch };
    };
    for (let col = 0; col < columns; col++) ctx.drawImage(img, bx0 + col * (img.width + b.columnGap), by);

    placings.forEach((p, k) => {
      const { bx, wellY } = slot(k);
      const src = this.recolor.sheet('1150', p.fur, p.silk);
      ctx.drawImage(src, head.x, head.y, head.w, head.h, bx + b.squares[0].x, wellY, head.w, head.h);
    });

    // A photo finish covers the first column's names; a second column keeps its own.
    if (photoRace) this.drawPhoto(photoRace, bx0 + b.panel.x, by + b.panel.y + Math.round((panelH - b.panel.h) / 2));
    placings.forEach((p, k) => {
      if (photoRace && k < rows) return;
      const { px, wellY } = slot(k);
      const lines = this.font.wrap(p.name, b.panel.w - 2 * BOARD_PANEL_PADDING);
      // WIN / PLACE / SHOW for the top three; every later finisher gets the photo
      // finish's own "F I N I S H" (remake addition: the original board had three rows).
      const place = places[k] ?? -1;
      const label = place < 0 ? undefined : (PLACE_LABELS[place] ?? FINISH);
      if (label) lines.push(label);
      const centre = wellY + head.h / 2;
      const top = centre - (lines.length * BOARD_LINE_HEIGHT) / 2;
      lines.forEach((line, i) => this.font.drawCentered(ctx, line, px + b.panel.w / 2, top + i * BOARD_LINE_HEIGHT, '#ffffff'));
    });
  }

  /**
   * Photo-finish still: the 1300/0 finish-line close-up with the first three
   * running (1100/0), each set back by how far behind the winner it crossed.
   * The original photo layout is not recovered; this is an approximation. It
   * has three lane bands, so in bigger races it shows the winner and the two
   * closest, centred in a taller panel.
   */
  private drawPhoto(race: Race, px: number, py: number): void {
    const { ctx } = this;
    const p = layout.board.panel;
    const photo = frameRect(1300, 0);
    ctx.drawImage(this.assets.sheets['1300'], photo.x, photo.y, photo.w, photo.h, px, py, photo.w, photo.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, p.w, p.h);
    ctx.clip();
    const entries = race.photo!.entries.slice(0, layout.photo.bands.length).sort((a, b) => a.rat.lane - b.rat.lane);
    const { sheet, rect } = animFrame('run-right', 0);
    entries.forEach(({ rat, behindPx }, i) => {
      const band = layout.photo.bands[Math.min(i, layout.photo.bands.length - 1)];
      const gap = Math.min(PHOTO_MAX_GAP_PX, behindPx);
      const nose = px + layout.photo.finishX + PHOTO_NOSE_PAST_LINE_PX - gap;
      const cy = py + (band.top + band.bottom) / 2;
      const src = this.recolor.sheet(sheet, rat.fur, rat.silk);
      ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, Math.round(nose - rect.w), Math.round(cy - rect.h / 2), rect.w, rect.h);
    });
    ctx.restore();
    const cx = px + p.w / 2;
    for (const [text, y] of [
      [PHOTO, py + PHOTO_LABEL_TOP_PX],
      [FINISH, py + p.h - PHOTO_LABEL_BOTTOM_PX],
    ] as const) {
      this.font.drawCentered(ctx, text, cx + 1, y + 1, '#000');
      this.font.drawCentered(ctx, text, cx, y, '#fff');
    }
  }
}
