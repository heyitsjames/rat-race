import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';
import { volumeStep } from '../src/menu';

describe('Music setting', () => {
  it('is gone: every run is one race with music, and old saves drop it', () => {
    const store = { getItem: () => JSON.stringify({ music: 'twice', musicLevel: 50 }) };
    const prev = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    try {
      const s = loadSettings() as unknown as Record<string, unknown>;
      expect('music' in s || 'musicLevel' in s).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true });
    }
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
  });
});

describe('rats per race', () => {
  const load = (saved: object) => {
    const store = { getItem: () => JSON.stringify(saved) };
    const prev = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    try {
      return loadSettings();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true });
    }
  };
  it('defaults to the original three', () => {
    expect(DEFAULT_SETTINGS.rats).toBe(3);
    expect(load({}).rats).toBe(3);
  });
  it('keeps a saved count from 3 to 8 and clamps anything else', () => {
    expect(load({ rats: 6 }).rats).toBe(6);
    expect(load({ rats: 12 }).rats).toBe(8);
    expect(load({ rats: 1 }).rats).toBe(3);
    expect(load({ rats: 'lots' }).rats).toBe(3);
  });
});

describe('competitive mode', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.competitive).toBe(false);
  });
});

describe('expanded names', () => {
  const load = (saved: object) => {
    const store = { getItem: () => JSON.stringify(saved) };
    const prev = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    try {
      return loadSettings();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true });
    }
  };
  it('is off by default and survives a save', () => {
    expect(DEFAULT_SETTINGS.expandedNames).toBe(false);
    expect(load({ expandedNames: true }).expandedNames).toBe(true);
    expect(load({ expandedNames: 'yes' }).expandedNames).toBe(true);
    expect(load({}).expandedNames).toBe(false);
  });

  it('only expanded names is off by default and survives a save', () => {
    expect(DEFAULT_SETTINGS.onlyExpandedNames).toBe(false);
    expect(load({ onlyExpandedNames: true }).onlyExpandedNames).toBe(true);
    expect(load({}).onlyExpandedNames).toBe(false);
  });

  it('only uses characters the Ratvetica font can draw, with no repeats', async () => {
    const extra: string[] = (await import('../data/expanded-names.json')).default;
    const original: string[] = (await import('../public/assets/rat-race/rat-names-and-labels.json')).default['2000'];
    const font = (await import('../data/font.json')).default as { glyphs: Record<string, unknown> };
    for (const name of extra) {
      expect(typeof name).toBe('string');
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      const missing = [...name].filter((ch) => ch !== ' ' && !(ch in font.glyphs));
      expect(missing, `"${name}" uses characters the font lacks`).toEqual([]);
    }
    const all = [...original.map((n) => n.replace(/[\u0000-\u001f]/g, '').trim()), ...extra].map((n) => n.toLowerCase());
    expect(all.filter((n, i) => all.indexOf(n) !== i), 'repeated names').toEqual([]);
  });
});
