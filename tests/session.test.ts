import { describe, expect, it } from 'vitest';
import {
  clampFrameDelta,
  FixedStepper,
  MAX_FRAME_SECONDS,
  STEP_SECONDS,
} from '../src/simulation/session';

describe('frame timing', () => {
  it('clamps long gaps such as returning to a background tab', () => {
    expect(clampFrameDelta(600)).toBe(MAX_FRAME_SECONDS);
    expect(clampFrameDelta(-1)).toBe(0);
    expect(clampFrameDelta(NaN)).toBe(0);
  });

  it('produces the same number of steps regardless of frame rate', () => {
    const count = (fps: number) => {
      const s = new FixedStepper();
      let n = 0;
      for (let i = 0; i < fps * 10; i++) n += s.advance(1 / fps);
      return n;
    };
    const expected = Math.round(10 / STEP_SECONDS);
    for (const fps of [30, 60, 120, 144]) expect(Math.abs(count(fps) - expected)).toBeLessThanOrEqual(1);
  });

  it('does not catch up after a long pause', () => {
    const s = new FixedStepper();
    expect(s.advance(3600)).toBe(Math.floor(MAX_FRAME_SECONDS / STEP_SECONDS));
  });
});
