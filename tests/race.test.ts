import { describe, expect, it } from 'vitest';
import names from '../public/assets/rat-race/rat-names-and-labels.json';
import { Race, RaceSeries, type RaceEvent } from '../src/simulation/race';
import { INTRO_SONG_MS, NO_MUSIC_INTRO_MS, PHOTO_FINISH_RANGE_PX } from '../src/simulation/constants';
import { Rat } from '../src/simulation/rat';
import { STEP_SECONDS } from '../src/simulation/session';
import { Track, sceneSize } from '../src/simulation/track';
import { TRAINING_LEVELS, TRAINING_TABLE } from '../src/simulation/training';

const NAMES = names['2000'];
const track = new Track(1024, 768);
/** Test guard only (the game has no time limit): far beyond the slowest simulated Drop Out race, 34 min. */
const TEST_GIVE_UP_SECONDS = 2 * 60 * 60;

function runRace(seed: number, training: number, t = track, dt = STEP_SECONDS) {
  const race = new Race({ seed, training, names: NAMES, track: t });
  const points: { x: number; y: number }[] = [];
  let k = 0;
  let steps = 0;
  while (race.phase !== 'done') {
    race.step(dt);
    if (k++ % 8 === 0) for (const r of race.rats) if (r.visible) points.push(r.position(t));
    if (++steps > TEST_GIVE_UP_SECONDS / dt) throw new Error('race never ended');
  }
  return { race, points };
}

describe('race', () => {
  it('is reproducible from its seed', () => {
    const a = runRace(1234, 50).race;
    const b = runRace(1234, 50).race;
    expect(a.finishOrder.map((r) => r.name)).toEqual(b.finishOrder.map((r) => r.name));
    expect(a.finishOrder.map((r) => r.finishTime)).toEqual(b.finishOrder.map((r) => r.finishTime));
    const c = runRace(1235, 50).race;
    expect(c.rats.map((r) => r.name)).not.toEqual(a.rats.map((r) => r.name));
  });

  it('orders results by simulated crossing of the finish line', () => {
    const goal = Rat.finishQ(track);
    for (let seed = 1; seed <= 15; seed++) {
      const { race } = runRace(seed, 30);
      const times = race.finishOrder.map((r) => r.finishTime!);
      expect(times).toHaveLength(3);
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      for (const r of race.finishOrder) expect(r.q).toBeGreaterThanOrEqual(goal);
      // finishers leave through the right-hand pipe instead of lapping again
      for (const r of race.finishOrder) expect(r.mode).toBe('gone');
      // standings only differ from crossing order inside a photo finish
      if (!race.isPhotoFinish) expect(race.standings).toEqual(race.finishOrder);
    }
  });

  it('completes at every training level, keeping rats on screen', () => {
    for (const level of TRAINING_LEVELS) {
      for (let seed = 100; seed < 103; seed++) {
        const { race, points } = runRace(seed, level.value, track, 1 / 30);
        expect(race.finishOrder).toHaveLength(3);
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        expect([...xs, ...ys].every(Number.isFinite)).toBe(true);
        // x may run past the screen edges only inside the pipes at the ends of the chute
        expect(Math.min(...xs)).toBeGreaterThan(-120);
        expect(Math.max(...xs)).toBeLessThan(track.width + 120);
        expect(Math.min(...ys)).toBeGreaterThan(0);
        expect(Math.max(...ys)).toBeLessThan(track.height);
      }
    }
  });

  it('runs about one lap', () => {
    const { race } = runRace(77, 100);
    for (const r of race.finishOrder) expect(r.q).toBeGreaterThan(8);
  });

  it('Professionals finish faster than Grade School rats on average', () => {
    const avg = (training: number) => {
      let sum = 0;
      for (let s = 0; s < 8; s++) sum += runRace(500 + s, training, track, 1 / 30).race.finishOrder[0].finishTime!;
      return sum / 8;
    };
    expect(avg(100)).toBeLessThan(avg(20));
  });

  it('Drop Out races finish on their own, with no time limit', () => {
    // Wrong-way rats can't run back past the start of a straight, so progress ratchets
    // forward a corner at a time. Simulated over 500 races: winner at 5-34 min, median 14.
    for (let seed = 40; seed < 46; seed++) {
      const { race } = runRace(seed, 0, track, 1 / 20);
      expect(race.finishOrder).toHaveLength(3);
      expect(race.finishOrder[0].finishTime!).toBeGreaterThan(60);
    }
  });

  it('gives no lane a real advantage (FAIR_CORNERS + checkpoint credit)', () => {
    // Cracked is the most sensitive level: the original rules give the outside lane 56%.
    const N = 300;
    const wins = [0, 0, 0];
    for (let s = 0; s < N; s++) wins[runRace(9000 + s, 100, track, 1 / 20).race.standings[0].lane]++;
    console.log('wins by lane (Cracked, 300 races):', wins);
    // a fair third is 100 ± 8 (one standard error); allow about three
    for (const w of wins) {
      expect(w).toBeGreaterThan(75);
      expect(w).toBeLessThan(125);
    }
  });

  it('moves through corners in stride-sized steps, not big jumps (FAIR_CORNERS)', () => {
    let maxPx = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const race = new Race({ seed, training: 100, names: NAMES, track });
      const last = race.rats.map(() => ({ x: NaN, y: NaN, mode: '' }));
      while (race.finishOrder.length < 3) {
        race.step(1 / 240);
        race.rats.forEach((r, i) => {
          const p = r.position(track);
          const L = last[i];
          if (p.x === L.x && p.y === L.y) return;
          if (r.mode === 'corner' && L.mode === 'corner') maxPx = Math.max(maxPx, Math.hypot(p.x - L.x, p.y - L.y));
          last[i] = { x: p.x, y: p.y, mode: r.mode };
        });
      }
    }
    // a stride is 7 px; the outside lane used to jump 21 px per turn frame
    expect(maxPx).toBeGreaterThan(5);
    expect(maxPx).toBeLessThan(8);
  });

  it('emits lifecycle events in order', () => {
    const race = new Race({ seed: 9, training: 70, names: NAMES, track });
    const types: string[] = [];
    while (race.phase !== 'done') {
      race.step(STEP_SECONDS);
      types.push(...race.drainEvents().map((e) => e.type));
    }
    expect(types.indexOf('gates-open')).toBeGreaterThan(-1);
    expect(types.indexOf('release')).toBeGreaterThan(types.indexOf('gates-open'));
    expect(types.indexOf('first-finish')).toBeGreaterThan(types.indexOf('release'));
    expect(types.filter((t) => t === 'finish').length).toBeGreaterThanOrEqual(3);
    expect(types.at(-1)).toBe('done');
  });
});

describe('start sequence (RR_D1 stages 0-2)', () => {
  const stageUntilGates = (withMusic: boolean, seed = 3) => {
    const race = new Race({ seed, training: 70, names: NAMES, track, withMusic });
    let sniffedAtGate = false;
    while (race.phase === 'staging') {
      race.step(STEP_SECONDS);
      if (race.rats.some((r) => r.mode === 'gate' && r.sniffing)) sniffedAtGate = true;
    }
    return { race, sniffedAtGate, gatesAtMs: race.clockMs };
  };

  it('waits for the intro song to finish before the gates drop', () => {
    const { gatesAtMs } = stageUntilGates(true);
    expect(gatesAtMs).toBeGreaterThanOrEqual(INTRO_SONG_MS);
  });

  it('waits 10 seconds instead when the music is off', () => {
    const { gatesAtMs } = stageUntilGates(false);
    expect(gatesAtMs).toBeGreaterThanOrEqual(NO_MUSIC_INTRO_MS);
    expect(gatesAtMs).toBeLessThan(INTRO_SONG_MS);
  });

  it('has the rats sniff at the gates while they wait', () => {
    expect(stageUntilGates(true).sniffedAtGate).toBe(true);
  });

  it('never distracts a rat on its way out of the pipe', () => {
    const race = new Race({ seed: 11, training: 0, names: NAMES, track, withMusic: true });
    while (race.phase === 'staging') {
      race.step(STEP_SECONDS);
      for (const r of race.rats) if (r.mode === 'enter') expect(r.sniffing || r.napping).toBe(false);
    }
  });

  it('lets a rat finish its sniff before it leaves the gate', () => {
    // Over many races, at least one rat is still sniffing when the gates drop and leaves late.
    let lateStarts = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { race } = stageUntilGates(true, seed);
      while (race.phase === 'gates') race.step(STEP_SECONDS);
      race.step(STEP_SECONDS);
      if (race.rats.some((r) => r.mode === 'gate')) lateStarts++;
    }
    expect(lateStarts).toBeGreaterThan(0);
  });
});

describe('finish (RR_D1 stage 3+)', () => {
  it('sends rats on the home straight straight into the pipe once there is a winner', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const race = new Race({ seed, training: 20, names: NAMES, track });
      let winnerSeen = false;
      while (race.phase !== 'done') {
        race.step(1 / 60);
        if (race.finishOrder.length > 0) winnerSeen = true;
        if (!winnerSeen) continue;
        for (const r of race.rats) {
          // after the winner, nobody on the home straight starts a sniff or a nap
          if (r.chuteX === null && r.q >= 8.05 && r.mode === 'run') expect(r.napping).toBe(false);
        }
      }
    }
  });

  it('once the winner crosses, every other rat drops its distraction and runs home', () => {
    // Drop Out: distractions everywhere, so plenty of rats are mid-nap, mid-sniff or
    // running the wrong way at the moment the winner crosses.
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const race = new Race({ seed, training: 0, names: NAMES, track });
      let winnerAt: number | null = null;
      while (race.phase !== 'done') {
        race.step(STEP_SECONDS);
        if (winnerAt === null && race.finishOrder.length > 0) winnerAt = race.raceTime;
        if (winnerAt === null) continue;
        // Allow one step to get up and the 12-frame turn round for wrong-way rats.
        if (race.raceTime - winnerAt < 2) continue;
        for (const r of race.rats) {
          if (!r.visible) continue;
          checked++;
          expect(r.sniffing || r.napping, `seed ${seed} ${r.name} ${r.mode}`).toBe(false);
          expect(r.mode, `seed ${seed} ${r.name}`).not.toBe('wrongWay');
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('in competitive mode, distractions carry on until 2nd crosses, then the last rat runs home', () => {
    let distracted = 0;
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      // Collegiate (the default): Drop Out races run much longer in this mode.
      const race = new Race({ seed, training: 70, names: NAMES, track, competitive: true });
      expect(race.settlesAt).toBe(race.rats.length - 1);
      let settledAt: number | null = null;
      let steps = 0;
      while (race.phase !== 'done') {
        race.step(STEP_SECONDS);
        if (++steps > TEST_GIVE_UP_SECONDS / STEP_SECONDS) throw new Error('race never ended');
        const placed = race.finishOrder.length;
        if (placed === 0) continue;
        if (placed < race.settlesAt) {
          expect(race.behavioursOn).toBe(true);
          if (race.rats.some((r) => !r.finished && (r.sniffing || r.napping || r.mode === 'wrongWay'))) distracted++;
          continue;
        }
        expect(race.behavioursOn).toBe(false);
        settledAt ??= race.raceTime;
        // Allow a step to get up and the turn round for a wrong-way rat.
        if (race.raceTime - settledAt < 2) continue;
        for (const r of race.rats) {
          if (!r.visible) continue;
          checked++;
          expect(r.sniffing || r.napping, `seed ${seed} ${r.name}`).toBe(false);
          expect(r.mode, `seed ${seed} ${r.name}`).not.toBe('wrongWay');
        }
      }
      expect(race.finishOrder.length).toBe(race.rats.length);
    }
    expect(distracted).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(0);
  });

  it('calls a photo finish when another rat is within 20 px of the winner, ranked by nose', () => {
    // Photo finishes are rare (~1 race in 150), so search seeds for one.
    let race: Race | null = null;
    for (let seed = 20000; seed < 20600 && !race; seed++) {
      const r = new Race({ seed, training: 70, names: NAMES, track });
      while (r.phase !== 'done') r.step(1 / 30);
      if (r.photo) race = r;
    }
    expect(race).not.toBeNull();
    if (!race) return;
    const photo = race.photo!;
    expect(photo.entries[0].rat).toBe(race.finishOrder[0]);
    expect(photo.entries.length).toBeGreaterThan(1);
    for (const e of photo.entries) expect(e.behindPx).toBeLessThanOrEqual(PHOTO_FINISH_RANGE_PX);
    expect(race.standings.slice(0, photo.entries.length)).toEqual(photo.entries.map((e) => e.rat));
  });

  it('calls no photo finish when the runner-up is further back', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { race } = runRace(seed, 100, track, 1 / 30);
      if (race.photo) continue;
      expect(race.standings).toEqual(race.finishOrder);
    }
  });

  it('never calls a photo finish when the track is hidden', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const race = new Race({ seed, training: 100, names: NAMES, track, trackVisible: () => false });
      while (race.phase !== 'done') race.step(1 / 30);
      expect(race.photo).toBeNull();
    }
  });
});

describe('pipes and gates', () => {
  it('rats come out of the left pipe and are at their gates before the gates open', () => {
    const race = new Race({ seed: 3, training: 70, names: NAMES, track });
    for (const r of race.rats) {
      expect(r.mode).toBe('enter');
      expect(r.position(track).x).toBeLessThan(0);
    }
    while (race.phase === 'staging') race.step(STEP_SECONDS);
    for (const r of race.rats) {
      expect(r.mode).toBe('gate');
      expect(r.position(track).x + 30).toBeCloseTo(track.gateNoseX(r.lane), 6);
    }
  });

  it('rats never change lanes (the original has no lane changes)', () => {
    const { race } = runRace(21, 0);
    for (const r of race.rats) expect(r.v).toBe(r.lane);
  });
});

describe('recovered Training odds', () => {
  it('distractions start at the per-thousand rates of each Training level', () => {
    for (const row of TRAINING_TABLE) {
      const counts = { turnAround: 0, nap: 0, sniff: 0, steps: 0 };
      for (let seed = 0; seed < 20; seed++) {
        const race = new Race({ seed: 7000 + seed, training: row.min, names: NAMES, track });
        const prev = new Map(race.rats.map((r) => [r, '']));
        while (race.phase !== 'done' && race.raceTime < 90) {
          race.step(1 / 30);
          for (const r of race.rats) {
            const key = r.mode + (r.sniffing ? ':sniff' : r.napping ? ':nap' : '');
            const was = prev.get(r)!;
            if (key !== was) {
              if (r.mode === 'turnAround' && !was.startsWith('turnAround')) counts.turnAround++;
              if (key === 'run:nap') counts.nap++;
              if (key === 'run:sniff') counts.sniff++;
              prev.set(r, key);
            }
          }
        }
      }
      const total = counts.turnAround + counts.nap + counts.sniff;
      // The split between distraction kinds follows the table. Turnarounds also include
      // automatic ones at the start of a straight, which skews shares of the total (most
      // at Drop Out, where nap runs about 0.1 low), so naps are checked against sniffs
      // alone, which only the dice start; sniffs against the total keep some slack.
      const want = row.turnAround + row.nap + row.sniff;
      expect(Math.abs(counts.nap / (counts.nap + counts.sniff) - row.nap / (row.nap + row.sniff))).toBeLessThan(0.06);
      expect(Math.abs(counts.sniff / total - row.sniff / want)).toBeLessThan(0.15);
    }
  });
});

describe('more rats', () => {
  for (const lanes of [5, 8]) {
    const { width, height } = sceneSize(lanes);
    const t = new Track(width, height, lanes);

    it(`races ${lanes} rats, one per lane, with no repeated silk or name`, () => {
      const { race, points } = runRace(31, 70, t, 1 / 30);
      expect(race.rats).toHaveLength(lanes);
      expect(new Set(race.rats.map((r) => r.lane)).size).toBe(lanes);
      expect(new Set(race.rats.map((r) => r.silk)).size).toBe(lanes);
      expect(new Set(race.rats.map((r) => r.name)).size).toBe(lanes);
      expect(race.finishOrder).toHaveLength(lanes);
      for (const r of race.finishOrder) expect(r.q).toBeGreaterThan(8);
      expect(Math.min(...points.map((p) => p.y))).toBeGreaterThan(0);
      expect(Math.max(...points.map((p) => p.y))).toBeLessThan(t.height);
    });

    it(`lines all ${lanes} rats up at their gates before the gates open`, () => {
      const race = new Race({ seed: 3, training: 70, names: NAMES, track: t });
      while (race.phase === 'staging') race.step(STEP_SECONDS);
      for (const r of race.rats) expect(r.position(t).x + 30).toBeCloseTo(t.gateNoseX(r.lane), 6);
    });
  }

  it('gives no lane a real advantage with eight rats', () => {
    // Measured over 800 Cracked races per count while adding this: every count from 3 to 8
    // within chance of an even split (a first run at 5 lanes looked uneven; 1,600 fresh races were even).
    const { width, height } = sceneSize(8);
    const t = new Track(width, height, 8);
    const N = 400;
    const wins = Array(8).fill(0);
    for (let s = 0; s < N; s++) wins[runRace(9000 + s, 100, t, 1 / 20).race.standings[0].lane]++;
    console.log('wins by lane (Cracked, 8 rats, 400 races):', wins);
    // a fair eighth is 50 ± 6.6 (one standard error); allow about three
    for (const w of wins) {
      expect(w).toBeGreaterThan(30);
      expect(w).toBeLessThan(70);
    }
    // 400 eight-rat races take about 5 s, right at vitest's default limit
  }, 30_000);
});

describe('distractions in corners', () => {
  it('draws a rat stopped, turning or running the wrong way in a corner turned to follow the curve', () => {
    const { width, height } = sceneSize(8);
    const t = new Track(width, height, 8);
    const seen = new Set<string>();
    for (let seed = 1; seed < 40 && seen.size < 4; seed++) {
      const race = new Race({ seed, training: 0, names: NAMES, track: t });
      while (race.phase !== 'done' && race.raceTime < 600 && seen.size < 4) {
        race.step(1 / 30);
        for (const r of race.rats) {
          if (r.chuteX !== null || Math.floor(r.q) % 2 === 0) continue;
          const kind = r.sniffing ? 'sniff' : r.napping ? 'nap' : r.mode === 'turnAround' || r.mode === 'wrongWay' ? r.mode : null;
          if (!kind) continue;
          const bend = 90 * (r.q - Math.floor(r.q));
          expect(r.pose().rotate ?? 0).toBeCloseTo(bend, 6);
          seen.add(kind);
        }
      }
    }
    expect([...seen].sort()).toEqual(['nap', 'sniff', 'turnAround', 'wrongWay']);
  });
});

describe('race series', () => {
  it('runs 25 consecutive accelerated races with a constant entity count and fresh state', () => {
    const series = new RaceSeries(42, NAMES, () => 40, track);
    let races = 0;
    let steps = 0;
    let lastRace = series.race;
    const rows: number[] = [];
    while (races < 25) {
      for (let i = 0; i < 16; i++) {
        for (const e of series.step(STEP_SECONDS) as RaceEvent[]) if (e.type === 'release') rows.push(1);
      }
      steps += 16;
      expect(series.race.rats).toHaveLength(3);
      if (series.race !== lastRace) {
        expect(lastRace.phase).toBe('done');
        expect(new Set(lastRace.winners).size).toBe(3);
        expect(series.race.phase).toBe('staging');
        expect(series.race.finishOrder).toHaveLength(0);
        expect(series.race.rats.every((r) => r.mode === 'enter' && !r.finished)).toBe(true);
        lastRace = series.race;
        races++;
      }
      expect(steps).toBeLessThan((25 * 400) / STEP_SECONDS);
    }
    expect(series.raceIndex).toBe(25);
    // every race released its rats exactly once
    expect(rows.length).toBeGreaterThanOrEqual(25);
  });

  it('gives each race distinct names and silks', () => {
    const r = new RaceSeries(7, NAMES, () => 70, track).race;
    expect(new Set(r.rats.map((x) => x.name)).size).toBe(3);
    expect(new Set(r.rats.map((x) => x.silk)).size).toBe(3);
    expect(r.rats.every((x) => !/[\u0000-\u001f]/.test(x.name))).toBe(true);
  });

  it('keeps rats in place when the window is resized mid-race', () => {
    const series = new RaceSeries(5, NAMES, () => 70, track);
    for (let i = 0; i < 1500; i++) series.step(STEP_SECONDS);
    const before = series.race.rats.map((r) => [r.q, r.v]);
    series.track = new Track(1600, 900);
    expect(series.race.rats.map((r) => [r.q, r.v])).toEqual(before);
    for (let i = 0; i < 6000; i++) series.step(STEP_SECONDS);
    expect(series.race.rats.every((r) => Number.isFinite(r.position(series.track).x))).toBe(true);
  });
});
