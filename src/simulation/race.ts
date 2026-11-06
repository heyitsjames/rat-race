import {
  GATE_FRAME_MS,
  GATE_DELAY_DIE,
  GATE_DELAY_STEP_MS,
  INTRO_SONG_MS,
  NO_MUSIC_INTRO_MS,
  PHOTO_FINISH_RANGE_PX,
  PHOTO_SHOW_MS,
} from './constants';
import palette from '../../data/palette-mappings.json';
import { Random } from './random';
import { Rat } from './rat';
import { Track } from './track';
import { trainingRow } from './training';

/**
 * Race lifecycle, following the original race controller (RR_D1, stage
 * machine at this+0x54):
 *
 *  stage 0  rats come out of the pipes; the intro (SONG 30) starts; a gate
 *           timer is set to RandInt(4) x 500 ms
 *  stage 1  wait until every rat is at its gate and the intro has finished
 *           (10 s if music is off); rats sniff at the gates meanwhile
 *  stage 2  gates drop with the gate/gun sound; once down, rats are released
 *           and the race music (SONG 40) loops
 *  stage 3+ racing; when the winner crosses, the ending (SONG 45) plays and
 *           rats reaching the home straight head for the pipe; a photo finish
 *           (camera click, 3 s photo) if another rat is within 20 px of it.
 *           Competitive mode (not in the original) holds that off until all but
 *           one rat have crossed, so 2nd place is still raced for; the last rat
 *           then runs straight home.
 *
 * The infield board shows the current race's three entrants, inner lane at the
 * top, throughout (footage of the original); a photo finish briefly replaces
 * its panel with the photo.
 */
export type Phase = 'staging' | 'gates' | 'racing' | 'finishing' | 'done';

export const PHASE_SECONDS = {
  /** Door animation (1200/1 then 1200/2, one gate tick apart) before the rats are released. */
  gates: GATE_FRAME_MS / 1000,
  /** Minimum run-out after the top three finish... */
  finishing: 1,
  /** ...and the most we wait for everyone to disappear into the pipe. */
  finishingMax: 8,
} as const;

export type RaceEvent =
  | { type: 'staging'; withMusic: boolean }
  | { type: 'gates-open' }
  | { type: 'release' }
  | { type: 'first-finish' }
  /** `settlesAt`: the place whose finish decides the race (1, or in competitive mode all but the last). */
  | { type: 'finish'; rat: Rat; place: number; settlesAt: number }
  | { type: 'photo' }
  | { type: 'done' };

/** Plain record of a placed rat, kept for the next race's results board. */
export interface Placing {
  name: string;
  fur: number;
  silk: number;
}

/** Snapshot taken when the winner crosses with others close behind. */
export interface PhotoFinish {
  /** Race time (s) of the photo. */
  at: number;
  /** Rats in the photo, best first, with how far (px) behind the winner's nose each was. */
  entries: { rat: Rat; behindPx: number }[];
}

export interface RaceOptions {
  seed: number;
  training: number;
  names: readonly string[];
  track: Track;
  /** Whether this race plays music (Music setting); without it the intro wait is 10 s. */
  withMusic?: boolean;
  /** Photo finishes need the track to be showing (original g03ba check). */
  trackVisible?: () => boolean;
  /** True while the intro song is audibly playing; the gates wait for it (RR_D1 f5ca4). */
  introPlaying?: () => boolean;
  /** Competitive mode: distractions carry on until all but one rat have finished, not just the winner. */
  competitive?: boolean;
  furCount?: number;
  silkCount?: number;
}

export function cleanName(name: string): string {
  // RatN 2000 stores "Whisper\b"; strip control characters.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f]/g, '').trim();
}

export class Race {
  readonly seed: number;
  readonly random: Random;
  readonly rats: Rat[];
  /** Rats in the order they physically crossed the line. */
  readonly finishOrder: Rat[] = [];
  readonly withMusic: boolean;
  readonly competitive: boolean;
  track: Track;
  training: number;
  phase: Phase = 'staging';
  phaseTime = 0;
  /** Seconds since the gates opened. */
  raceTime = 0;
  /** Race clock in ms, running from the start of staging. */
  clockMs = 0;
  /** Original g03be: distractions happen from the gates opening until the winner crosses. */
  behavioursOn = false;
  photo: PhotoFinish | null = null;
  /** Earliest staging time (ms) at which the gates may drop: intro length and gate timer. */
  readonly gatesNotBeforeMs: number;
  private readonly trackVisible: () => boolean;
  private readonly introPlaying: () => boolean;
  private gatesOpenedMs = 0;
  private events: RaceEvent[];

  constructor(opts: RaceOptions) {
    this.seed = opts.seed;
    this.training = opts.training;
    this.track = opts.track;
    this.withMusic = opts.withMusic ?? false;
    this.competitive = opts.competitive ?? false;
    this.trackVisible = opts.trackVisible ?? (() => true);
    this.introPlaying = opts.introPlaying ?? (() => false);
    this.random = new Random(opts.seed);
    const names = this.random.shuffle(opts.names.map(cleanName).filter(Boolean));
    const silks = this.random.shuffle([...Array(opts.silkCount ?? palette.silks.length).keys()]);
    const furCount = opts.furCount ?? palette.furs.length;
    this.rats = [];
    for (let lane = 0; lane < this.track.lanes; lane++) {
      this.rats.push(
        new Rat(
          { name: names[lane % names.length], fur: this.random.int(furCount), silk: silks[lane % silks.length], lane },
          this.track,
          this.random,
        ),
      );
    }
    const gateTimer = this.random.int(GATE_DELAY_DIE) * GATE_DELAY_STEP_MS;
    const intro = this.withMusic ? INTRO_SONG_MS : NO_MUSIC_INTRO_MS;
    this.gatesNotBeforeMs = Math.max(gateTimer, intro);
    this.events = [{ type: 'staging', withMusic: this.withMusic }];
  }

  /**
   * Final order: on a photo finish the rats in the photo are ranked by nose
   * position at that instant (RR_D1 0x51EA-0x52DC); everyone else by crossing.
   */
  get standings(): Rat[] {
    if (!this.photo) return this.finishOrder;
    const inPhoto = this.photo.entries.map((e) => e.rat);
    return [...inPhoto, ...this.finishOrder.filter((r) => !inPhoto.includes(r))];
  }

  get winners(): Rat[] {
    return this.standings.slice(0, 3);
  }

  get placings(): Placing[] {
    return this.winners.map(({ name, fur, silk }) => ({ name, fur, silk }));
  }

  get isPhotoFinish(): boolean {
    return this.photo !== null;
  }

  /** The photo-finish board shows for 3 s after the winner crosses. */
  get photoVisible(): boolean {
    return !!this.photo && (this.raceTime - this.photo.at) * 1000 < PHOTO_SHOW_MS;
  }

  /** Remove and return events produced since the last call (audio and UI hooks). */
  drainEvents(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'gates') this.events.push({ type: 'gates-open' });
    if (phase === 'racing') {
      this.gatesOpenedMs = this.clockMs;
      this.events.push({ type: 'release' });
    }
    if (phase === 'done') this.events.push({ type: 'done' });
  }

  step(dt: number): void {
    if (this.phase === 'done') return;
    this.phaseTime += dt;
    switch (this.phase) {
      case 'staging': {
        this.stepRats(dt, false);
        // Stage 1: every rat at its gate, the intro over (by the clock, and audibly if it
        // started late because audio was unlocked part-way through), and the gate timer run out.
        const ready =
          this.phaseTime * 1000 >= this.gatesNotBeforeMs &&
          !(this.withMusic && this.introPlaying()) &&
          this.rats.every((r) => r.mode === 'gate');
        if (ready) this.enter('gates');
        return;
      }
      case 'gates':
        // Stage 2: the doors drop, then the rats are released.
        this.stepRats(dt, false);
        if (this.phaseTime >= PHASE_SECONDS.gates) {
          this.enter('racing');
          for (const r of this.rats) r.release(this.clockMs);
          this.behavioursOn = true;
        }
        return;
    }

    this.stepRats(dt);
    switch (this.phase) {
      case 'racing':
        // Every rat finishes (once the race is decided the rest run home), so wait for all
        // of them: with the original three that is the 3 the board has places for.
        if (this.finishOrder.length >= this.rats.length) this.enter('finishing');
        break;
      case 'finishing': {
        const allIn = this.rats.every((r) => !r.finished || !r.visible);
        if ((this.phaseTime >= PHASE_SECONDS.finishing && allIn && !this.photoVisible) || this.phaseTime >= PHASE_SECONDS.finishingMax) {
          this.enter('done');
        }
        break;
      }
    }
  }

  /**
   * RR_D1 0x5370-0x53E0: a rat counts as "close" when it is on the leader's
   * straight, not running the wrong way, and within 20 px of the leader.
   */
  private takePhoto(winner: Rat): void {
    if (!this.trackVisible()) return;
    const seg = Math.floor(winner.q);
    const len = this.track.segmentLength(seg, winner.lane);
    const close = this.rats
      .filter((r) => r !== winner && r.chuteX === null && Math.floor(r.q) === seg)
      .filter((r) => r.mode === 'run' || r.mode === 'exit')
      .map((rat) => ({ rat, behindPx: (winner.q - rat.q) * len }))
      .filter((e) => e.behindPx <= PHOTO_FINISH_RANGE_PX)
      .sort((a, b) => a.behindPx - b.behindPx || a.rat.lane - b.rat.lane);
    if (close.length === 0) return;
    this.photo = { at: this.raceTime, entries: [{ rat: winner, behindPx: 0 }, ...close] };
    this.events.push({ type: 'photo' });
  }

  private stepRats(dt: number, racing = true): void {
    if (racing) this.raceTime += dt;
    this.clockMs += dt * 1000;
    const env = {
      training: trainingRow(this.training),
      random: this.random,
      track: this.track,
      behavioursOn: this.behavioursOn,
      winnerDecided: this.settled,
    };
    const crossed: { rat: Rat; t: number }[] = [];
    for (const rat of this.rats) {
      const at = rat.update(this.clockMs, env);
      if (at !== null) crossed.push({ rat, t: (at - this.gatesOpenedMs) / 1000 });
    }
    // Rats stepping at the same instant are ordered by lane, as the original loops over lanes.
    crossed.sort((a, b) => a.t - b.t || a.rat.lane - b.rat.lane);
    for (const { rat, t } of crossed) {
      rat.finish(t);
      this.finishOrder.push(rat);
      if (this.finishOrder.length === 1) {
        this.events.push({ type: 'first-finish' });
        this.takePhoto(rat);
      }
      this.events.push({ type: 'finish', rat, place: this.finishOrder.length, settlesAt: this.settlesAt });
    }
    // The winner crossing the line ends the distractions for everyone: the others drop
    // what they are doing and run home (owner's recollection of the original). There is
    // no time limit: even Drop Out finishes on its own (see the Drop Out test).
    if (this.behavioursOn && this.settled) this.behavioursOn = false;
  }

  /**
   * How many finishers decide the race, after which everyone heads home: the winner,
   * or in competitive mode all but the last rat (1st and 2nd of three).
   */
  get settlesAt(): number {
    return this.competitive ? Math.max(1, this.rats.length - 1) : 1;
  }

  private get settled(): boolean {
    return this.finishOrder.length >= this.settlesAt;
  }
}

export interface SeriesOptions {
  /** Whether races play music (default true). */
  withMusic?: boolean;
  /** Run one race and stop at 'done' instead of starting the next (default false). */
  once?: boolean;
  trackVisible?: () => boolean;
  introPlaying?: () => boolean;
  /** Competitive mode for the next race (read as each race is set up). */
  competitive?: () => boolean;
}

/** Runs races back to back with reproducible per-race seeds. */
export class RaceSeries {
  private random: Random;
  race: Race;
  raceIndex = 0;
  readonly seed: number;
  private trackRef: Track;

  constructor(
    seed: number,
    private readonly names: readonly string[],
    private readonly getTraining: () => number,
    track: Track,
    private readonly options: SeriesOptions = {},
  ) {
    this.seed = seed;
    this.trackRef = track;
    this.random = new Random(seed);
    this.race = this.makeRace();
  }

  get track(): Track {
    return this.trackRef;
  }

  /** Swap geometry (window resize). Rats keep their loop position, so nothing jumps. */
  set track(t: Track) {
    this.trackRef = t;
    this.race.track = t;
  }

  private makeRace(): Race {
    return new Race({
      seed: this.random.fork(),
      training: this.getTraining(),
      names: this.names,
      track: this.trackRef,
      withMusic: this.options.withMusic ?? true,
      trackVisible: this.options.trackVisible,
      introPlaying: this.options.introPlaying,
      competitive: this.options.competitive?.() ?? false,
    });
  }

  /** The current race is over (with \`once\`, the series stops there). */
  get done(): boolean {
    return this.race.phase === 'done';
  }

  /** Advance one fixed step; returns events, including those of a finished race. */
  step(dt: number): RaceEvent[] {
    if (this.done) return [];
    this.race.training = this.getTraining();
    this.race.step(dt);
    const events = this.race.drainEvents();
    if (this.done && !this.options.once) {
      this.raceIndex++;
      this.race = this.makeRace();
      events.push(...this.race.drainEvents());
    }
    return events;
  }
}
