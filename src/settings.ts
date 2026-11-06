import { DEFAULT_TRAINING } from './simulation/training';

/** Music choices from sUnt 1002 (slider values 0/25/50/75; saved default sVal 1002 = 30, i.e. Once). */
export type MusicChoice = 'never' | 'once' | 'twice' | 'always';
export const MUSIC_CHOICES: { value: MusicChoice; label: string; min: number }[] = [
  { value: 'never', label: 'Never', min: 0 },
  { value: 'once', label: 'Once', min: 25 },
  { value: 'twice', label: 'Twice', min: 50 },
  { value: 'always', label: 'Always', min: 75 },
];

/** Saved default slider position (sVal 1002 = 30, i.e. Once). */
export const DEFAULT_MUSIC_LEVEL = 30;

/** The Music slider (0-100) picks the last sUnt 1002 stop at or below it. */
export function musicChoice(level: number): MusicChoice {
  let out: MusicChoice = 'never';
  for (const m of MUSIC_CHOICES) if (level >= m.min) out = m.value;
  return out;
}

export function musicLabel(level: number): string {
  return MUSIC_CHOICES.find((m) => m.value === musicChoice(level))!.label;
}

export interface Settings {
  training: number;
  /** Race Track (xVal 1001, default on). */
  raceTrack: boolean;
  /**
   * Competitive mode (not in the original, off by default): rats keep racing normally after
   * the winner crosses, so 2nd and 3rd are still contested, and every finish plays the ending.
   */
  competitive: boolean;
  /** Music slider position, 0-100 (sVal 1002). */
  musicLevel: number;
  sound: boolean;
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  training: DEFAULT_TRAINING,
  raceTrack: true,
  competitive: false,
  musicLevel: DEFAULT_MUSIC_LEVEL,
  sound: true,
  volume: 0.7,
};

const KEY = 'rat-race-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings> & { music?: MusicChoice };
    const out = { ...DEFAULT_SETTINGS, ...s };
    // Settings saved before Music became a slider stored the choice itself.
    const legacy = MUSIC_CHOICES.find((m) => m.value === s.music);
    if (s.musicLevel === undefined && legacy) out.musicLevel = legacy.value === 'once' ? DEFAULT_MUSIC_LEVEL : legacy.min;
    delete (out as { music?: MusicChoice }).music;
    out.training = Math.min(100, Math.max(0, Number(out.training) || 0));
    out.volume = Math.min(1, Math.max(0, Number(out.volume)));
    out.musicLevel = Math.min(100, Math.max(0, Number.isFinite(Number(out.musicLevel)) ? Number(out.musicLevel) : DEFAULT_MUSIC_LEVEL));
    out.raceTrack = !!out.raceTrack;
    out.competitive = !!out.competitive;
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

/**
 * Whether music plays for the race with this zero-based index in the session.
 * Interpretation (unverified): Once = first race only, Twice = first two races.
 */
export function musicForRace(choice: MusicChoice, raceIndex: number): boolean {
  switch (choice) {
    case 'never':
      return false;
    case 'once':
      return raceIndex < 1;
    case 'twice':
      return raceIndex < 2;
    case 'always':
      return true;
  }
}
