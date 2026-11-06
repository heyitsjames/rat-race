import { describe, expect, it } from 'vitest';
import animations from '../data/animations.json';

type R = { w: number; h: number; ax: number | null; ay: number | null };
const frame = (anim: keyof typeof animations.states, i: number): R => {
  const [sheet, idx] = animations.states[anim].frames[i] as [number, number];
  return (animations.sheets as Record<string, R[]>)[String(sheet)][idx];
};
// Pixel offsets from the rat's anchor, rounded as drawFrame rounds them.
const left = (r: R) => -Math.round(r.ax!);
const right = (r: R) => -Math.round(r.ax!) + r.w;
const top = (r: R) => -Math.round(r.ay!);
const bottom = (r: R) => -Math.round(r.ay!) + r.h;

describe('sniff pieces', () => {
  it('every horizontal front half meets the still rump exactly, with no gap or overlap', () => {
    const rump = frame('sniff-rump', 0);
    for (let i = 0; i < animations.states['sniff-front'].frames.length; i++) {
      const f = frame('sniff-front', i);
      expect(left(f)).toBe(right(rump));
      expect(top(f)).toBe(top(rump));
    }
  });

  it('every vertical front half meets the still rump exactly', () => {
    const rump = frame('sniff-rump-up', 0);
    for (let i = 0; i < animations.states['sniff-front-up'].frames.length; i++) {
      const f = frame('sniff-front-up', i);
      expect(bottom(f)).toBe(top(rump));
      expect(left(f)).toBe(left(rump));
    }
  });
});
