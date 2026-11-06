// Lane fairness as a slope: how a rat's finishing place changes per lane outwards
// (negative = outer lanes do better), with its z-score, per Training level and rat count.
// Usage: npx vite-node tools/lane-slope.ts <races> <counts e.g. 4,8> <levels e.g. 0,20,100>
import names from '../public/assets/rat-race/rat-names-and-labels.json';
import { Race } from '../src/simulation/race';
import { Track, sceneSize } from '../src/simulation/track';
const [N, counts, levels] = [Number(process.argv[2]), process.argv[3].split(',').map(Number), process.argv[4].split(',').map(Number)];
for (const training of levels)
  for (const n of counts) {
    const s = sceneSize(n);
    const t = new Track(s.width, s.height, n);
    const mid = (n - 1) / 2;
    const sxx = Array.from({ length: n }, (_, l) => (l - mid) ** 2).reduce((a, b) => a + b);
    const slopes: number[] = [];
    const wins = Array(n).fill(0);
    for (let i = 0; i < N; i++) {
      const race = new Race({ seed: 424242 + 7919 * i + n * 13 + training, training, names: names['2000'], track: t });
      while (race.phase !== 'done') race.step(1 / 20);
      let sxy = 0;
      race.standings.forEach((r, p) => (sxy += (r.lane - mid) * (p + 1)));
      slopes.push(sxy / sxx);
      wins[race.standings[0].lane]++;
    }
    const mean = slopes.reduce((a, b) => a + b) / N;
    const sd = Math.sqrt(slopes.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    const z = mean / (sd / Math.sqrt(N));
    console.log(`level ${String(training).padStart(3)} rats ${n} slope ${mean.toFixed(3).padStart(7)} z ${z.toFixed(1).padStart(5)}  win% inner ${((wins[0] / N) * 100).toFixed(1)} outer ${((wins[n - 1] / N) * 100).toFixed(1)} fair ${(100 / n).toFixed(1)}`);
  }
