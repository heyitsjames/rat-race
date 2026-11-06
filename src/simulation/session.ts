/**
 * Fixed-step timing. Each real frame contributes at most MAX_FRAME_SECONDS, so
 * returning to a background tab never produces a large catch-up jump.
 */
export const MAX_FRAME_SECONDS = 0.25;
export const STEP_SECONDS = 1 / 120;

export function clampFrameDelta(realSeconds: number): number {
  if (!Number.isFinite(realSeconds) || realSeconds < 0) return 0;
  return Math.min(realSeconds, MAX_FRAME_SECONDS);
}

/** Fixed-step accumulator: converts variable frame time into whole simulation steps. */
export class FixedStepper {
  private acc = 0;
  constructor(readonly step = STEP_SECONDS) {}
  /** Returns how many fixed steps to run for this frame. */
  advance(frameSeconds: number, speed = 1): number {
    this.acc += clampFrameDelta(frameSeconds) * speed;
    const n = Math.floor(this.acc / this.step);
    this.acc -= n * this.step;
    return n;
  }
  reset(): void {
    this.acc = 0;
  }
}
