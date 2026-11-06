import { DEFAULT_LANES, MAX_LANES, MIN_LANES } from './simulation/track';
import { DEFAULT_TRAINING } from './simulation/training';

export interface Settings {
  training: number;
  /** Race Track (xVal 1001, default on). */
  raceTrack: boolean;
  /**
   * Competitive mode (not in the original, off by default): rats keep racing normally after
   * the winner crosses, so 2nd and 3rd are still contested, and every finish plays the ending.
   */
  competitive: boolean;
  /** Rats per race, one per lane (not in the original, which always races three): 3-8. */
  rats: number;
  sound: boolean;
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  training: DEFAULT_TRAINING,
  raceTrack: true,
  competitive: false,
  rats: DEFAULT_LANES,
  sound: true,
  volume: 0.7,
};

const KEY = 'rat-race-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS, ...s };
    // Older saves had a Music setting (music, musicLevel); there is one race per run now, so it's gone.
    delete (out as { music?: unknown }).music;
    delete (out as { musicLevel?: unknown }).musicLevel;
    out.training = Math.min(100, Math.max(0, Number(out.training) || 0));
    out.volume = Math.min(1, Math.max(0, Number(out.volume)));
    out.raceTrack = !!out.raceTrack;
    out.competitive = !!out.competitive;
    out.rats = Math.min(MAX_LANES, Math.max(MIN_LANES, Math.round(Number(out.rats)) || DEFAULT_LANES));
    out.sound = !!out.sound;
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode etc.): settings just won't persist */
  }
}
