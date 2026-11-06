import { describe, expect, it } from 'vitest';
import { cornerPose, runPose } from '../src/simulation/rat';
import { Track } from '../src/simulation/track';

describe('track geometry', () => {
  for (const [w, h] of [
    [1024, 768],
    [1600, 900],
    [1024, 2100],
  ]) {
    const t = new Track(w, h);
    it(`is continuous around the loop at ${w}x${h}`, () => {
      for (let v = 0; v <= 2; v += 0.5) {
        let prev = t.point(0, v);
        for (let q = 0.001; q <= 8.0001; q += 0.001) {
          const p = t.point(q, v);
          const len = t.segmentLength(Math.floor(q - 0.0005), v) * 0.001;
          expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(len + 0.01);
          prev = p;
        }
        const start = t.point(0, v);
        const end = t.point(8, v);
        expect(Math.hypot(start.x - end.x, start.y - end.y)).toBeLessThan(1e-6);
      }
    });

    it(`keeps every lane on screen at ${w}x${h}`, () => {
      for (let q = 0; q < 8; q += 0.01) {
        for (const v of [0, 1, 2]) {
          const p = t.point(q, v);
          expect(p.x).toBeGreaterThan(t.margin);
          expect(p.x).toBeLessThan(w - t.margin);
          expect(p.y).toBeGreaterThan(t.margin);
          expect(p.y).toBeLessThan(h - t.margin);
        }
      }
    });
  }

  it('puts the gates before the finish line on the bottom straight', () => {
    const t = new Track(1024, 768);
    expect(t.gateNoseX(2)).toBeLessThan(t.finishX() - 100);
    // the inner gate sits slightly into the start chute (footage), clear of the pipe mouth
    expect(t.gateNoseX(0)).toBeGreaterThan(t.margin + 15 + 130);
  });

  it('measures corner length from the lane radius', () => {
    const t = new Track(1024, 768);
    expect(t.lapLength(2) - t.lapLength(0)).toBeCloseTo(2 * Math.PI * 2 * t.laneHeight, 6);
  });
});

describe('direction to sprite (original mirroring)', () => {
  it('uses the right/up gait cycles, rotated 180 degrees for left and down', () => {
    expect(runPose(0, 2)).toMatchObject({ anim: 'run-right', frame: 2, flipX: false, flipY: false });
    expect(runPose(90, 1)).toMatchObject({ anim: 'run-up', frame: 1, flipX: false, flipY: false });
    expect(runPose(180, 0)).toMatchObject({ anim: 'run-right', flipX: true, flipY: true });
    expect(runPose(270, 0)).toMatchObject({ anim: 'run-up', flipX: true, flipY: true });
  });

  it('uses right->up and up->left turn frames, rotated for the other two corners', () => {
    expect(cornerPose(0, 5)).toMatchObject({ anim: 'turn-right-up', frame: 5, flipX: false });
    expect(cornerPose(90, 5)).toMatchObject({ anim: 'turn-up-left', frame: 5, flipX: false });
    expect(cornerPose(180, 5)).toMatchObject({ anim: 'turn-right-up', flipX: true, flipY: true });
    expect(cornerPose(270, 5)).toMatchObject({ anim: 'turn-up-left', flipX: true, flipY: true });
  });
});
