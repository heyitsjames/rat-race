// Lane fairness: wins, mean place and mean finish time by lane for 3-8 rats at one
// Training level. Usage: npx vite-node tools/lane-fairness.ts <training> <racesPerCount> <outfile>
import fs from 'node:fs';
import names from '../public/assets/rat-race/rat-names-and-labels.json';
import { Race } from '../src/simulation/race';
import { Track, sceneSize } from '../src/simulation/track';
const [training, N, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const results: Record<number, { wins: number[]; placeSum: number[]; timeSum: number[]; races: number; secs: number }> = {};
for (let n = 3; n <= 8; n++) {
  const s = sceneSize(n);
  const t = new Track(s.width, s.height, n);
  const r = { wins: Array(n).fill(0), placeSum: Array(n).fill(0), timeSum: Array(n).fill(0), races: 0, secs: 0 };
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const race = new Race({ seed: 100000 * n + 7919 * i + training, training, names: names['2000'], track: t });
    while (race.phase !== 'done') race.step(1 / 20);
    race.standings.forEach((rat, place) => { r.placeSum[rat.lane] += place + 1; r.timeSum[rat.lane] += rat.finishTime!; });
    r.wins[race.standings[0].lane]++;
    r.races++;
  }
  r.secs = (Date.now() - t0) / 1000;
  results[n] = r;
  fs.writeFileSync(out, JSON.stringify(results));
}
