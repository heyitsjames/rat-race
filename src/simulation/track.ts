import layout from '../../data/scene-layout.json';

/**
 * Rounded-rectangle loop around the screen (from a reference screenshot of the
 * original): the outer edge sits `margin` px inside the screen, the corners are
 * quarter circles, and the infield holds the results board. Rats run
 * counter-clockwise on screen: right along the bottom, up the right side, left
 * along the top, down the left side.
 *
 * Positions use a lane-independent loop coordinate q: the integer part is the
 * segment (0 bottom straight, 1 bottom-right corner, 2 right straight, 3 top-right
 * corner, 4 top straight, 5 top-left corner, 6 left straight, 7 bottom-left
 * corner) and the fraction is progress through it. q keeps counting past 8 on
 * later laps. Because the lanes are concentric, the same q in any lane is the
 * same x on a straight and the same angle on a corner, so changing lanes never
 * makes a rat jump.
 */
export interface TrackPoint {
  x: number;
  y: number;
  /** Direction of travel in degrees: 0 right, 90 up, 180 left, 270 down. */
  heading: number;
}

const T = layout.track;

/** Lanes (and rats) per race: the original's three by default, up to eight. */
export const DEFAULT_LANES = T.lanes;
export const MIN_LANES = 3;
export const MAX_LANES = 8;
/** Most lanes drawn: bigger fields put two rats in a lane (see LANE_MATE_OFFSET). */
export const MAX_TRACK_LANES = 4;

/** Lanes for a race of `rats` rats: one each up to MAX_TRACK_LANES, then shared. */
export function lanesFor(rats: number): number {
  return Math.min(rats, MAX_TRACK_LANES);
}

/**
 * Logical scene size for a race of `lanes` rats. Three lanes is the original
 * 1024x768. More lanes keep the same lane pitch and art at full size and grow
 * the scene instead (still 4:3, so the window scales it down), once the
 * infield inside the lanes would be shorter than `track.minInfield`.
 */
export function sceneSize(lanes: number): { width: number; height: number } {
  const base = layout.logical;
  const height = Math.max(base.height, Math.ceil(2 * T.margin + 2 * lanes * T.laneHeight + T.minInfield));
  return { width: Math.round((height * base.width) / base.height), height };
}

export class Track {
  readonly width: number;
  readonly height: number;
  readonly lanes: number;
  readonly laneHeight = T.laneHeight;
  readonly margin = T.margin;
  /** Outer edge's corner radius: grows a lane pitch per extra lane, so the inside lane's corners never tighten. */
  readonly outerRadius: number;
  readonly trackWidth: number;
  /** Lengths of the horizontal and vertical straights (same for every lane). */
  readonly straightH: number;
  readonly straightV: number;
  /** Gate step between neighbouring lanes (px along the bottom straight). */
  readonly gateStagger: number;

  constructor(width: number, height: number, lanes: number = DEFAULT_LANES) {
    this.width = width;
    this.height = height;
    this.lanes = lanes;
    this.trackWidth = this.lanes * this.laneHeight;
    this.outerRadius = T.outerRadius + (lanes - T.lanes) * this.laneHeight;
    this.straightH = Math.max(0, width - 2 * this.margin - 2 * this.outerRadius);
    this.straightV = Math.max(0, height - 2 * this.margin - 2 * this.outerRadius);
    // The original steps each gate 117 px; with more lanes that runs past the finish
    // line, so the step shrinks to keep the outermost gate a rat's length short of it.
    const room = this.finishX() - layout.gate.finishClearance - this.gateNoseX0();
    this.gateStagger = lanes > 1 ? Math.max(0, Math.min(layout.gate.stagger, room / (lanes - 1))) : 0;
  }

  /** Inset from the outer edge of the centre line of (fractional) lane v; lane 0 is the inside lane. */
  inset(v: number): number {
    return this.trackWidth - (v + 0.5) * this.laneHeight;
  }

  radius(v: number): number {
    return this.outerRadius - this.inset(v);
  }

  segmentLength(seg: number, v: number): number {
    const s = ((seg % 8) + 8) % 8;
    if (s % 2 === 1) return (Math.PI / 2) * this.radius(v);
    return s === 0 || s === 4 ? this.straightH : this.straightV;
  }

  lapLength(v: number): number {
    return 2 * this.straightH + 2 * this.straightV + 2 * Math.PI * this.radius(v);
  }

  /** Distance along lane v between loop coordinates a <= b. */
  distance(a: number, b: number, v: number): number {
    let d = 0;
    let q = a;
    while (q < b - 1e-9) {
      const seg = Math.floor(q);
      const end = Math.min(b, seg + 1);
      d += (end - q) * this.segmentLength(seg, v);
      q = end;
    }
    return d;
  }

  /** Loop coordinate on the bottom straight for screen x (clamped to the straight). */
  qAtBottomX(x: number): number {
    if (this.straightH === 0) return 0;
    return Math.min(1, Math.max(0, (x - (this.margin + this.outerRadius)) / this.straightH));
  }

  point(q: number, v: number): TrackPoint {
    const seg = ((Math.floor(q) % 8) + 8) % 8;
    const t = q - Math.floor(q);
    const d = this.inset(v);
    const r = this.radius(v);
    const m = this.margin;
    const x0 = m + d;
    const x1 = this.width - m - d;
    const y0 = m + d;
    const y1 = this.height - m - d;
    const left = m + this.outerRadius;
    const right = this.width - m - this.outerRadius;
    switch (seg) {
      case 0:
        return { x: left + t * this.straightH, y: y1, heading: 0 };
      case 2:
        return { x: x1, y: y1 - r - t * this.straightV, heading: 90 };
      case 4:
        return { x: right - t * this.straightH, y: y0, heading: 180 };
      case 6:
        return { x: x0, y: y0 + r + t * this.straightV, heading: 270 };
    }
    const centres: Record<number, [number, number]> = {
      1: [x1 - r, y1 - r],
      3: [x1 - r, y0 + r],
      5: [x0 + r, y0 + r],
      7: [x0 + r, y1 - r],
    };
    const [cx, cy] = centres[seg];
    const heading = 90 * ((seg - 1) / 2) + 90 * t;
    const h = (heading * Math.PI) / 180;
    return { x: cx + r * Math.sin(h), y: cy + r * Math.cos(h), heading };
  }

  /** Screen y of a lane's centre on the bottom straight. */
  bottomLaneY(v: number): number {
    return this.height - this.margin - this.inset(v);
  }

  /** Nose x of each lane's starting gate (staggered: outer lanes start further round). */
  gateNoseX(lane: number): number {
    return this.gateNoseX0() + lane * this.gateStagger;
  }

  private gateNoseX0(): number {
    return this.margin + this.outerRadius + layout.gate.innerOffset;
  }

  finishX(): number {
    return this.width - this.margin - this.outerRadius - layout.track.finishBeforeCorner;
  }
}
