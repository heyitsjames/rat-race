import { describe, expect, it } from 'vitest';
import { DEFAULT_MUSIC_LEVEL, DEFAULT_SETTINGS, musicChoice, musicLabel } from '../src/settings';
import { volumeStep } from '../src/menu';

describe('Music slider (sUnt 1002)', () => {
  it('picks the last stop at or below the slider value', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(musicChoice)).toEqual(['never', 'never', 'once', 'once', 'twice', 'twice', 'always', 'always']);
  });
  it('defaults to the saved sVal 1002 position, Once', () => {
    expect(musicLabel(DEFAULT_MUSIC_LEVEL)).toBe('Once');
  });
});

describe('menu speaker', () => {
  it('maps volume to the nearest speaker icon, 0 when sound is off', () => {
    expect(volumeStep(false, 1)).toBe(0);
    expect(volumeStep(true, 1)).toBe(7);
    expect(volumeStep(true, 0.7)).toBe(5);
    expect(volumeStep(true, 0.05)).toBe(1);
  });
});

describe('slider stops', () => {
  it('snaps a saved value to the stop it falls in', async () => {
    const { stopIndex } = await import('../src/menu');
    const training = [0, 20, 40, 60, 80, 100];
    expect(stopIndex(training, 70)).toBe(3); // saved default: Collegiate
    expect(stopIndex(training, 100)).toBe(5);
    expect(stopIndex([0, 25, 50, 75], 30)).toBe(1); // Once
  });
});

describe('competitive mode', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.competitive).toBe(false);
  });
});
