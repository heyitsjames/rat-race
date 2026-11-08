import { describe, expect, it } from 'vitest';
import names from '../public/assets/rat-race/rat-names-and-labels.json';
import { Race } from '../src/simulation/race';
import { RaceStats } from '../src/simulation/race-stats';
import { STEP_SECONDS } from '../src/simulation/session';
import { Track } from '../src/simulation/track';

const track = new Track(1024, 768);

function run(seed: number, training: number, watch: boolean) {
  const race = new Race({ seed, training, names: names['2000'], track });
  const stats = new RaceStats(race);
  for (let i = 0; race.phase !== 'done'; i++) {
    race.step(STEP_SECONDS);
    if (watch) stats.observe();
    if (i > 2_000_000) throw new Error('race never ended');
  }
  return { race, summary: stats.summary() };
}

describe('race stats', () => {
  it('only watches: the result is the same with or without it', () => {
    const watched = run(42, 10, true).race;
    const unwatched = run(42, 10, false).race;
    expect(watched.standings.map((r) => r.name)).toEqual(unwatched.standings.map((r) => r.name));
    expect(watched.standings.map((r) => r.finishTime)).toEqual(unwatched.standings.map((r) => r.finishTime));
  });

  it('reports the standings, lanes and times', () => {
    const { race, summary } = run(7, 50, true);
    expect(summary.winner).toBe(race.standings[0].name);
    expect(summary.winnerLane).toBe(race.standings[0].lane + 1);
    expect(summary.results).toHaveLength(race.rats.length);
    const places = summary.results.map((r) => r.place).sort();
    expect(places).toEqual(race.rats.map((_, i) => i + 1));
    expect(summary.photo === null).toBe(!race.photo || race.photo.entries.length < 2);
  });

  it('counts distractions on slack training and someone always leads', () => {
    let naps = 0;
    let sniffs = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { summary } = run(seed, 0, true);
      naps += summary.results.reduce((n, r) => n + r.naps, 0);
      sniffs += summary.results.reduce((n, r) => n + r.sniffs, 0);
      expect(summary.results.some((r) => r.everLed)).toBe(true);
      expect(summary.results.some((r) => r.everLast)).toBe(true);
    }
    expect(naps + sniffs).toBeGreaterThan(0);
  });
});
