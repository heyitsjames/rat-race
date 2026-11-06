import { describe, expect, it } from 'vitest';
import font from '../data/font.json';

describe('results board times', () => {
  it('formats race times as mm:ss.xx', async () => {
    const { formatRaceTime } = await import('../src/render/scene');
    expect(formatRaceTime(0)).toBe('00:00.00');
    expect(formatRaceTime(23.456)).toBe('00:23.46');
    expect(formatRaceTime(59.996)).toBe('01:00.00');
    expect(formatRaceTime(754.3)).toBe('12:34.30');
  });

  it('names places 1st to 8th', async () => {
    const { ordinal } = await import('../src/render/scene');
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']);
    expect([11, 12, 13, 21, 22].map(ordinal)).toEqual(['11th', '12th', '13th', '21st', '22nd']);
  });

  it('fits the widest label in the name panel', () => {
    const glyphs = font.glyphs as Record<string, { w: number }>;
    const width = (t: string) => [...t].reduce((w, c) => w + (glyphs[c]?.w ?? font.spaceWidth), 0);
    // Panel 124 px minus 4 px padding each side; the slowest simulated race is about 34 minutes.
    expect(width('8th  59:58.88')).toBeLessThanOrEqual(116);
  });
});
