// Fairness with lane-mates (more rats than lanes, two to a lane): per rat count and Training level,
// - lane slope: change in a rat's mean place per lane outward (negative = outer lanes do better), z-score;
// - win% per lane per rat (doubled lanes split their wins between two rats);
// - mates: how often the inner mate beats its outer lane-mate (fair 50%), z-score.
// Usage: npx vite-node tools/lane-mates-fairness.ts <races> <counts e.g. 5,8> <levels e.g. 0,20,100>
import names from '../public/assets/rat-race/rat-names-and-labels.json';
import { Race } from '../src/simulation/race';
import { Track, lanesFor, sceneSize } from '../src/simulation/track';
const [N, counts, levels] = [Number(process.argv[2]), process.argv[3].split(',').map(Number), process.argv[4].split(',').map(Number)];
for (const training of levels)
  for (const n of counts) {
    const lanes = lanesFor(n);
    const s = sceneSize(lanes);
    const t = new Track(s.width, s.height, lanes);
    const slopes: number[] = [];
    const wins = Array(lanes).fill(0);
    const perLane = Array(lanes).fill(0);
    let innerBeats = 0, pairs = 0;
    for (let i = 0; i < N; i++) {
      const race = new Race({ seed: 424242 + 7919 * i + n * 13 + training, training, names: names['2000'], track: t, rats: n });
      while (race.phase !== 'done') race.step(1 / 20);
      const st = race.standings;
      if (i === 0) for (const r of race.rats) perLane[r.lane]++;
      const mid = race.rats.reduce((a, r) => a + r.lane, 0) / n;
      const sxx = race.rats.reduce((a, r) => a + (r.lane - mid) ** 2, 0);
      let sxy = 0;
      st.forEach((r, p) => (sxy += (r.lane - mid) * (p + 1)));
      slopes.push(sxy / sxx);
      wins[st[0].lane]++;
      for (let l = 0; l < lanes; l++) {
        const m = st.filter((r) => r.lane === l);
        if (m.length === 2) { pairs++; if (m[0].side === -1) innerBeats++; }
      }
    }
    const mean = slopes.reduce((a, b) => a + b) / N;
    const sd = Math.sqrt(slopes.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    const z = mean / (sd / Math.sqrt(N));
    const perRat = wins.map((w, l) => ((w / N / perLane[l]) * 100).toFixed(1).padStart(5)).join(' ');
    const mz = (innerBeats - pairs / 2) / Math.sqrt(pairs / 4);
    console.log(`level ${String(training).padStart(3)} rats ${n} slope ${mean.toFixed(3).padStart(7)} z ${z.toFixed(1).padStart(5)}  win%/rat by lane ${perRat} (fair ${(100 / n).toFixed(1)})  inner mate wins ${((innerBeats / pairs) * 100).toFixed(1)}% z ${mz.toFixed(1)}`);
  }
