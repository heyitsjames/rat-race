import { describe, expect, it } from 'vitest';
import { cornerPose, runPose } from '../src/simulation/rat';
import layout from '../data/scene-layout.json';
import { MAX_LANES, MIN_LANES, Track, sceneSize } from '../src/simulation/track';

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

describe('lane count (3-8 rats)', () => {
  it('keeps the original 1024x768 scene and gate stagger for three lanes', () => {
    expect(sceneSize(3)).toEqual({ width: 1024, height: 768 });
    expect(new Track(1024, 768, 3).gateStagger).toBe(layout.gate.stagger);
  });

  for (let lanes = MIN_LANES; lanes <= MAX_LANES; lanes++) {
    const { width, height } = sceneSize(lanes);
    const t = new Track(width, height, lanes);

    it(`fits ${lanes} lanes in a 4:3 scene with room for the board`, () => {
      expect(width / height).toBeCloseTo(4 / 3, 2);
      expect(height - 2 * t.margin - 2 * t.trackWidth).toBeGreaterThanOrEqual(layout.track.minInfield - 1);
      // the inside lane's corners stay as round as with three lanes
      expect(t.radius(0)).toBeCloseTo(new Track(1024, 768, 3).radius(0), 6);
    });

    it(`keeps all ${lanes} lanes continuous and on screen`, () => {
      for (const v of [0, lanes - 1]) {
        let prev = t.point(0, v);
        for (let q = 0.002; q <= 8.0001; q += 0.002) {
          const p = t.point(q, v);
          expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(t.segmentLength(Math.floor(q - 0.001), v) * 0.002 + 0.01);
          expect(p.x).toBeGreaterThan(t.margin);
          expect(p.x).toBeLessThan(width - t.margin);
          expect(p.y).toBeGreaterThan(t.margin);
          expect(p.y).toBeLessThan(height - t.margin);
          prev = p;
        }
      }
    });

    it(`puts all ${lanes} gates in order, a rat's length short of the finish`, () => {
      expect(t.gateStagger).toBeGreaterThan(40);
      expect(t.gateStagger).toBeLessThanOrEqual(layout.gate.stagger);
      expect(t.gateNoseX(lanes - 1)).toBeLessThanOrEqual(t.finishX() - layout.gate.finishClearance + 1e-9);
      expect(t.gateNoseX(0)).toBeGreaterThan(t.margin + 15 + 130);
    });
  }
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
