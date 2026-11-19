import { MAX_LANES, MIN_LANES } from './simulation/track';
import { MAX_TRAINING } from './simulation/training';

export interface Settings {
  training: number;
  /**
   * Competitive mode (not in the original, on by default): rats keep racing normally after
   * the winner crosses, so 2nd and 3rd are still contested, and every finish plays the ending.
   */
  competitive: boolean;
  /** Expanded names (not in the original, on by default): add data/expanded-names.json to the name draw. */
  expandedNames: boolean;
  /** Only expanded names (not in the original, off by default): draw names from data/expanded-names.json alone. */
  onlyExpandedNames: boolean;
  /** Rats per race, one per lane (not in the original, which always races three): 3-8. */
  rats: number;
  sound: boolean;
  volume: number;
}

/**
 * The remake's defaults, not the original's (Collegiate, 3 rats): Rat God, 8 rats,
 * competitive and expanded names, for a busier, closer race out of the box.
 */
export const DEFAULT_SETTINGS: Settings = {
  training: 120,
  competitive: true,
  expandedNames: true,
  onlyExpandedNames: false,
  rats: MAX_LANES,
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
    // Older saves had Music (music, musicLevel) and Race Track (raceTrack) settings, both since removed.
    delete (out as { music?: unknown }).music;
    delete (out as { musicLevel?: unknown }).musicLevel;
    delete (out as { raceTrack?: unknown }).raceTrack;
    out.training = Math.min(MAX_TRAINING, Math.max(0, Number(out.training) || 0));
    out.volume = Math.min(1, Math.max(0, Number(out.volume)));
    out.competitive = !!out.competitive;
    out.expandedNames = !!out.expandedNames;
    out.onlyExpandedNames = !!out.onlyExpandedNames;
    out.rats = Math.min(MAX_LANES, Math.max(MIN_LANES, Math.round(Number(out.rats)) || DEFAULT_SETTINGS.rats));
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
