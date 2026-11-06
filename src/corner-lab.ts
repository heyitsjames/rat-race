/**
 * Corner lab (?corners=1): one rat per lane runs round the bottom-right corner
 * on a loop, so the corner animation options can be compared by eye.
 *
 * Keys: 1-6 pick a style, Space pauses, [ and ] change the speed.
 * The rats are driven directly here, not by the race simulation.
 */
import { CORNER_FRAMES, STRIDE_PX } from './simulation/constants';
import { cornerPose, runPose, type Pose } from './simulation/rat';
import type { Track } from './simulation/track';
import type { SceneRenderer, Viewport } from './render/scene';

type Style = { key: string; name: string; note: string };

export const CORNER_STYLES: Style[] = [
  { key: '1', name: 'Held frames (current)', note: 'Stride-sized steps; each of the 12 turn frames held for ~3 strides.' },
  { key: '2', name: 'Wiggle', note: 'As 1, but every other stride shows the next turn frame round: a ~7° body swing.' },
  { key: '3', name: 'Sway', note: 'As 1, plus a 1 px sideways sway, alternating each stride.' },
  { key: '4', name: 'Wiggle + sway', note: '2 and 3 together.' },
  { key: '5', name: 'Glide (12 frames, smooth)', note: '12 turn frames like the original, but the rat moves smoothly between them.' },
  { key: '6', name: 'Original (reference)', note: 'The original: 12 jumps at ~100 ms, not lane-fair timing.' },
];

/** Typical straight-line stride interval (ms) for the lab rats. */
const STRIDE_MS = 110;
/** Original corner step: 75 + 17 x RollD(2) ms, on average. */
const ORIGINAL_CORNER_MS = 100;
/** Straight run before and after the corner. */
const LEAD_PX = 126;
const PAUSE_MS = 700;

interface Placed {
  pose: Pose;
  x: number;
  y: number;
}

export class CornerLab {
  style = 0;
  speed = 1;
  paused = false;
  private t = 0;

  constructor(private readonly track: Track) {}

  key(e: KeyboardEvent): boolean {
    const i = CORNER_STYLES.findIndex((s) => s.key === e.key);
    if (i >= 0) this.style = i;
    else if (e.key === ' ') this.paused = !this.paused;
    else if (e.key === '[') this.speed = Math.max(0.125, this.speed / 2);
    else if (e.key === ']') this.speed = Math.min(4, this.speed * 2);
    else return false;
    return true;
  }

  update(dt: number): void {
    if (!this.paused) this.t += dt * 1000 * this.speed;
  }

  render(scene: SceneRenderer, vp: Viewport): void {
    const sprites = [0, 1, 2].map((lane) => ({ ...this.place(lane), fur: lane * 2, silk: lane + 1 }));
    scene.renderLab(vp, this.track, sprites);
  }

  /** Corner duration (ms) and step count for a lane in the current style. */
  private cornerPlan(lane: number): { ms: number; steps: number; glide: boolean } {
    const tr = this.track;
    const len = tr.segmentLength(1, lane);
    if (this.style === 5) return { ms: CORNER_FRAMES * ORIGINAL_CORNER_MS, steps: CORNER_FRAMES, glide: false };
    // FAIR_CORNERS timing: inside lane's corner plus a quarter of this lane's stagger, at stride pace.
    const fairPx = tr.segmentLength(1, 0) + (tr.gateNoseX(lane) - tr.gateNoseX(0)) / 4;
    const ms = (fairPx / STRIDE_PX) * STRIDE_MS;
    if (this.style === 4) return { ms, steps: CORNER_FRAMES, glide: true };
    return { ms, steps: Math.max(CORNER_FRAMES, Math.round(len / STRIDE_PX)), glide: false };
  }

  private place(lane: number): Placed {
    const tr = this.track;
    const leadSteps = Math.round(LEAD_PX / STRIDE_PX);
    const leadMs = leadSteps * STRIDE_MS;
    const plan = this.cornerPlan(lane);
    const cycle = leadMs + plan.ms + leadMs + PAUSE_MS;
    // lanes start a little apart so they don't move in lockstep
    let t = (this.t + lane * 157) % cycle;

    const straight = (seg: number, fromEnd: boolean, k: number): Placed => {
      const px = (fromEnd ? LEAD_PX - leadSteps * STRIDE_PX : 0) + k * STRIDE_PX;
      const q = fromEnd ? seg + 1 - (LEAD_PX - px) / tr.segmentLength(seg, lane) : seg + px / tr.segmentLength(seg, lane);
      const p = tr.point(q, lane);
      return { pose: runPose(p.heading, k % 6), x: p.x, y: p.y };
    };

    if (t < leadMs) return straight(0, true, Math.floor(t / STRIDE_MS));
    t -= leadMs;
    if (t < plan.ms) {
      const stepMs = plan.ms / plan.steps;
      const k = Math.min(plan.steps - 1, Math.floor(t / stepMs));
      const frac = plan.glide ? t / plan.ms : (k + 1) / plan.steps;
      const p = tr.point(1 + Math.min(frac, 1 - 1e-9), lane);
      let frame = Math.floor((k * CORNER_FRAMES) / plan.steps);
      const wiggle = this.style === 1 || this.style === 3;
      const sway = this.style === 2 || this.style === 3;
      if (wiggle && k % 2 === 1) frame = frame < CORNER_FRAMES - 1 ? frame + 1 : frame - 1;
      let { x, y } = p;
      if (sway) {
        // 1 px either side of the direction of travel (heading 0 = right, 90 = up)
        const h = (p.heading * Math.PI) / 180;
        const s = k % 2 === 0 ? 1 : -1;
        x += Math.sin(h) * s;
        y += Math.cos(h) * s;
      }
      return { pose: cornerPose(0, frame), x, y };
    }
    t -= plan.ms;
    if (t < leadMs) return straight(2, false, Math.floor(t / STRIDE_MS) + 1);
    return straight(2, false, leadSteps);
  }

  /** Status text for the overlay. */
  describe(): string {
    const s = CORNER_STYLES[this.style];
    const lanes = [0, 1, 2]
      .map((l) => {
        const p = this.cornerPlan(l);
        const px = p.glide ? 'smooth' : `${(this.track.segmentLength(1, l) / p.steps).toFixed(1)} px`;
        return `lane ${l}: ${p.steps} steps, ${px}/step, ${(p.ms / 1000).toFixed(2)} s`;
      })
      .join('\n');
    const keys = CORNER_STYLES.map((x, i) => `${i === this.style ? '▶' : ' '} ${x.key}  ${x.name}`).join('\n');
    return `CORNER LAB  speed ×${this.speed}${this.paused ? '  (paused)' : ''}\n\n${keys}\n\n${s.note}\n\n${lanes}\n\nSpace pause · [ ] speed`;
  }
}
