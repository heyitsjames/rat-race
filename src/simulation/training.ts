/**
 * Training, recovered from the original module (CODE 129 RR_D1 at 0x4126).
 *
 * The control value (0-100, saved default 70) picks one row. At every
 * checkpoint (each six running steps on a straight) a running rat draws
 * RandInt(1000) and walks down the row: r <= turnAround -> turn round and run
 * the wrong way; else r -= turnAround, r <= nap -> curl up / nap; else
 * r -= nap, r <= sniff -> stop and sniff; otherwise keep running.
 * The numbers are per-thousand odds per checkpoint.
 */
export interface TrainingRow {
  min: number;
  label: string;
  turnAround: number;
  nap: number;
  sniff: number;
  /**
   * Odds of turning back while running the wrong way. The original reuses
   * turnAround here (RR_D2 0x12A0), so rats turn back as rarely as they turn
   * round; only the added Cracked level sets its own.
   */
  turnBack?: number;
  /** False for levels added by this remake. */
  original: boolean;
}

export const TRAINING_TABLE: readonly TrainingRow[] = [
  { min: 0, label: 'Drop Out', turnAround: 450, nap: 150, sniff: 50, original: true },
  { min: 20, label: 'Grade School', turnAround: 60, nap: 20, sniff: 700, original: true },
  { min: 40, label: 'High School', turnAround: 50, nap: 250, sniff: 500, original: true },
  { min: 60, label: 'Collegiate', turnAround: 50, nap: 100, sniff: 350, original: true },
  { min: 80, label: 'Professional', turnAround: 25, nap: 75, sniff: 200, original: true },
  /**
   * Not in the original: the top of the slider. Rare, short distractions, and a
   * rat that does turn round corrects itself fairly quickly (15% per checkpoint).
   */
  { min: 100, label: 'Cracked', turnAround: 3, nap: 10, sniff: 50, turnBack: 150, original: false },
];

/** Labels and slider stops: sUnt 1000's five, plus Cracked at 100. */
export const TRAINING_LEVELS = TRAINING_TABLE.map((r) => ({ value: r.min, label: r.label }));

/** Saved default (sVal 1000 = 70, i.e. Collegiate). */
export const DEFAULT_TRAINING = 70;

export function trainingRow(value: number): TrainingRow {
  let row = TRAINING_TABLE[0];
  for (const r of TRAINING_TABLE) if (value >= r.min) row = r;
  return row;
}

export function trainingLabel(value: number): string {
  return trainingRow(value).label;
}
