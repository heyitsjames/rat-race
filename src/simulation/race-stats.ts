import type { Race } from './race';
import type { Rat } from './rat';

/** Per-rat tallies for one race, for the anonymous race stats (see src/analytics.ts). */
export interface RatTally {
  naps: number;
  sniffs: number;
  turnArounds: number;
  /** Was ever last on the loop after the field had spread out. */
  everLast: boolean;
  /** Was ever in front on the loop after the field had spread out. */
  everLed: boolean;
  /** Fell asleep while in front. */
  nappedLeading: boolean;
}

export interface RatResult extends RatTally {
  name: string;
  lane: number;
  /** Final place (1-based, photo-finish order), or null if the rat never finished. */
  place: number | null;
  /** Seconds from the gates opening. */
  time: number | null;
}

export interface RaceSummary {
  raceSeed: number;
  training: number;
  competitive: boolean;
  rats: number;
  /** Seconds from the gates opening to the last rat home. */
  duration: number;
  winner: string | null;
  winnerLane: number | null;
  winTime: number | null;
  /** Rats in the photo-finish board, and how far (px) 2nd was behind the winner's nose. */
  photo: { rats: number; marginPx: number } | null;
  /** The winner was last at some point after the field spread out. */
  comeback: boolean;
  /** The winner fell asleep while leading and still won. */
  nappedLeaderWon: boolean;
  results: RatResult[];
}

/** Ignore the scramble out of the gates: who is first or last only counts after this. */
const SETTLE_SECONDS = 3;

/**
 * Watches a race step by step (call `observe` after each step) and tallies the fun
 * things: naps, sniffs, wrong-way turns, who led, who was last. Read-only: it never
 * touches the race, so races stay reproducible from their seed.
 */
export class RaceStats {
  private readonly tallies = new Map<Rat, RatTally & { wasNapping: boolean; wasSniffing: boolean; wasTurning: boolean }>();

  constructor(private readonly race: Race) {
    for (const rat of race.rats) {
      this.tallies.set(rat, {
        naps: 0,
        sniffs: 0,
        turnArounds: 0,
        everLast: false,
        everLed: false,
        nappedLeading: false,
        wasNapping: false,
        wasSniffing: false,
        wasTurning: false,
      });
    }
  }

  observe(): void {
    const race = this.race;
    if (race.phase !== 'racing' && race.phase !== 'finishing') return;
    // Ranking only means something while the race is still open.
    const ranking = race.finishOrder.length === 0 && race.raceTime >= SETTLE_SECONDS;
    const onLoop = race.rats.filter((r) => r.visible && !r.finished && r.chuteX === null);
    let leader: Rat | null = null;
    let last: Rat | null = null;
    if (ranking && onLoop.length > 1) {
      for (const r of onLoop) {
        if (!leader || r.q > leader.q) leader = r;
        if (!last || r.q < last.q) last = r;
      }
      this.tallies.get(leader!)!.everLed = true;
      this.tallies.get(last!)!.everLast = true;
    }
    for (const rat of race.rats) {
      const t = this.tallies.get(rat)!;
      const napping = rat.napping;
      const sniffing = rat.sniffing;
      const turning = rat.mode === 'turnAround';
      if (napping && !t.wasNapping) {
        t.naps++;
        if (rat === leader) t.nappedLeading = true;
      }
      if (sniffing && !t.wasSniffing) t.sniffs++;
      if (turning && !t.wasTurning) t.turnArounds++;
      t.wasNapping = napping;
      t.wasSniffing = sniffing;
      t.wasTurning = turning;
    }
  }

  summary(): RaceSummary {
    const race = this.race;
    const standings = race.standings;
    const winner = standings[0] ?? null;
    const wt = winner ? this.tallies.get(winner)! : null;
    const photo = race.photo && race.photo.entries.length > 1
      ? { rats: race.photo.entries.length, marginPx: Math.round(race.photo.entries[1].behindPx * 10) / 10 }
      : null;
    const round = (s: number | null) => (s === null ? null : Math.round(s * 100) / 100);
    return {
      raceSeed: race.seed,
      training: race.training,
      competitive: race.competitive,
      rats: race.rats.length,
      duration: round(race.raceTime)!,
      winner: winner?.name ?? null,
      winnerLane: winner ? winner.lane + 1 : null,
      winTime: round(winner?.finishTime ?? null),
      photo,
      comeback: !!wt?.everLast,
      nappedLeaderWon: !!wt?.nappedLeading,
      results: race.rats.map((rat) => {
        const { naps, sniffs, turnArounds, everLast, everLed, nappedLeading } = this.tallies.get(rat)!;
        const i = standings.indexOf(rat);
        return {
          name: rat.name,
          lane: rat.lane + 1,
          place: i < 0 ? null : i + 1,
          time: round(rat.finishTime),
          naps,
          sniffs,
          turnArounds,
          everLast,
          everLed,
          nappedLeading,
        };
      }),
    };
  }
}
