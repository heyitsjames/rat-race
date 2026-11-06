import { TRACK_TIMEOUT_MS } from './constants';
/**
 * Session timing. Original help: "After 90 minutes of uninterrupted racing the
 * track will disappear, but the tireless rats will continue racing."
 *
 * Decisions (documented in docs/RECONSTRUCTION.md):
 * - The session clock advances with simulated race time only: it stops while
 *   paused and while the tab is hidden (the browser stops animation frames).
 * - Showing the controls does not count as an interruption; Restart does,
 *   and resets the clock.
 * - Each real frame contributes at most MAX_FRAME_SECONDS, so returning to a
 *   background tab never produces a large catch-up jump.
 */
/** 90 minutes, recovered as now + 0x5265C0 ms (see constants.ts). */
export const TRACK_FADE_AFTER_SECONDS = TRACK_TIMEOUT_MS / 1000;
export const MAX_FRAME_SECONDS = 0.25;
export const STEP_SECONDS = 1 / 120;

export function clampFrameDelta(realSeconds: number): number {
  if (!Number.isFinite(realSeconds) || realSeconds < 0) return 0;
  return Math.min(realSeconds, MAX_FRAME_SECONDS);
}

export class SessionClock {
  elapsed = 0;
  constructor(offsetSeconds = 0) {
    this.elapsed = offsetSeconds;
  }
  add(seconds: number): void {
    this.elapsed += seconds;
  }
  reset(): void {
    this.elapsed = 0;
  }
  get trackExpired(): boolean {
    return this.elapsed >= TRACK_FADE_AFTER_SECONDS;
  }
  /** Whether to draw the track, given the user's Race Track setting. */
  trackVisible(setting: boolean): boolean {
    return setting && !this.trackExpired;
  }
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
