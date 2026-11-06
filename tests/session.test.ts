import { describe, expect, it } from 'vitest';
import { musicForRace } from '../src/settings';
import {
  clampFrameDelta,
  FixedStepper,
  MAX_FRAME_SECONDS,
  SessionClock,
  STEP_SECONDS,
  TRACK_FADE_AFTER_SECONDS,
} from '../src/simulation/session';

describe('session clock', () => {
  it('hides the track after 90 minutes but respects the Race Track setting', () => {
    const c = new SessionClock();
    expect(c.trackVisible(true)).toBe(true);
    expect(c.trackVisible(false)).toBe(false);
    c.add(TRACK_FADE_AFTER_SECONDS - 1);
    expect(c.trackVisible(true)).toBe(true);
    c.add(1);
    expect(c.trackVisible(true)).toBe(false);
    c.reset();
    expect(c.trackVisible(true)).toBe(true);
  });

  it('supports a debug offset', () => {
    expect(new SessionClock(TRACK_FADE_AFTER_SECONDS).trackExpired).toBe(true);
  });
});

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

describe('music choice', () => {
  it('maps Never/Once/Twice/Always to races in the session', () => {
    const plays = (c: Parameters<typeof musicForRace>[0]) => [0, 1, 2, 3].map((i) => musicForRace(c, i));
    expect(plays('never')).toEqual([false, false, false, false]);
    expect(plays('once')).toEqual([true, false, false, false]);
    expect(plays('twice')).toEqual([true, true, false, false]);
    expect(plays('always')).toEqual([true, true, true, true]);
  });
});
