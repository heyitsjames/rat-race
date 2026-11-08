#!/usr/bin/env node
// Reports on the anonymous race stats in the rat-race-stats D1 database
// (sent by src/analytics.ts, stored by functions/api/event.ts). Uses your `wrangler login`.
//
//   npm run stats                 list the reports
//   npm run stats -- fame         run one report (several: fame lanes photos)
//   npm run stats -- all          run every report
//   npm run stats -- sql "SELECT ..."   run your own query
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB = 'rat-race-stats';

// Every finished race's per-rat results, one row per rat.
const RESULTS = `
  SELECT e.received_at, e.session, json_extract(e.props, '$.training') AS training,
         json_extract(e.props, '$.trainingLabel') AS training_label,
         json_extract(e.props, '$.rats') AS field, json_extract(e.props, '$.competitive') AS competitive,
         json_extract(r.value, '$.name') AS name, json_extract(r.value, '$.lane') AS lane,
         json_extract(r.value, '$.place') AS place, json_extract(r.value, '$.time') AS time,
         json_extract(r.value, '$.naps') AS naps, json_extract(r.value, '$.sniffs') AS sniffs,
         json_extract(r.value, '$.turnArounds') AS turns, json_extract(r.value, '$.everLast') AS ever_last,
         json_extract(r.value, '$.nappedLeading') AS napped_leading
  FROM events e, json_each(e.props, '$.results') r WHERE e.name = 'race_end'`;

const REPORTS = {
  overview: [
    'Traffic: sessions, races and events per day (last 14 days)',
    `SELECT substr(received_at, 1, 10) AS day, COUNT(DISTINCT session) AS sessions,
       SUM(name = 'race_start') AS races_started, SUM(name = 'race_end') AS races_finished,
       SUM(name = 'race_abandoned') AS abandoned, COUNT(*) AS events
     FROM events WHERE received_at >= date('now', '-14 days') GROUP BY day ORDER BY day DESC`,
  ],
  fame: [
    'Hall of fame: all-time wins and podiums by rat',
    `SELECT name, COUNT(*) AS races, SUM(place = 1) AS wins, SUM(place <= 3) AS podiums,
       ROUND(100.0 * SUM(place = 1) / COUNT(*), 1) AS win_pct, MIN(CASE WHEN place = 1 THEN time END) AS best_win_s
     FROM (${RESULTS}) GROUP BY name ORDER BY wins DESC, podiums DESC LIMIT 25`,
  ],
  fastest: [
    'Fastest and slowest winning times by Training level',
    `SELECT training_label AS level, COUNT(*) AS races, MIN(time) AS fastest_s, MAX(time) AS slowest_s, ROUND(AVG(time), 1) AS avg_s
     FROM (${RESULTS}) WHERE place = 1 GROUP BY training ORDER BY training`,
  ],
  streaks: [
    'Rematch kings: same rat winning back-to-back Restarts in one sitting',
    `WITH wins AS (
       SELECT session, id, json_extract(props, '$.winner') AS winner,
              LAG(json_extract(props, '$.winner')) OVER (PARTITION BY session ORDER BY id) AS prev
       FROM events WHERE name = 'race_end')
     SELECT winner, COUNT(*) AS repeat_wins FROM wins WHERE winner = prev GROUP BY winner ORDER BY repeat_wins DESC LIMIT 15`,
  ],
  photos: [
    'Photo finishes: how often, and the closest ever',
    `SELECT COUNT(*) AS races, SUM(json_extract(props, '$.photo') IS NOT NULL) AS photo_finishes,
       ROUND(100.0 * SUM(json_extract(props, '$.photo') IS NOT NULL) / COUNT(*), 1) AS photo_pct,
       MIN(json_extract(props, '$.photo.marginPx')) AS closest_px
     FROM events WHERE name = 'race_end'`,
  ],
  closest: [
    'Closest photo finishes ever (seed + window size replays them with ?seed=)',
    `SELECT received_at, json_extract(props, '$.winner') AS winner, json_extract(props, '$.photo.marginPx') AS margin_px,
       json_extract(props, '$.photo.rats') AS in_photo, json_extract(props, '$.raceSeed') AS race_seed
     FROM events WHERE name = 'race_end' AND json_extract(props, '$.photo') IS NOT NULL ORDER BY margin_px LIMIT 10`,
  ],
  naps: [
    'Sleepyheads: most naps, sniffs and wrong-way turns by rat',
    `SELECT name, COUNT(*) AS races, SUM(naps) AS naps, ROUND(1.0 * SUM(naps) / COUNT(*), 2) AS naps_per_race,
       SUM(sniffs) AS sniffs, SUM(turns) AS wrong_way_turns, SUM(napped_leading) AS napped_in_front
     FROM (${RESULTS}) GROUP BY name ORDER BY naps DESC LIMIT 20`,
  ],
  drama: [
    'Drama: comebacks, winners who napped in front, and record nap races',
    `SELECT COUNT(*) AS races, SUM(json_extract(props, '$.comeback')) AS comebacks_from_last,
       SUM(json_extract(props, '$.nappedLeaderWon')) AS napped_leading_and_won,
       (SELECT MAX(naps) FROM (${RESULTS})) AS most_naps_one_rat_one_race
     FROM events WHERE name = 'race_end'`,
  ],
  lanes: [
    'Lane fairness: win rate by lane and field size (compare with tools/lane-fairness.ts)',
    `SELECT field AS rats, lane, COUNT(*) AS races, SUM(place = 1) AS wins, ROUND(100.0 * SUM(place = 1) / COUNT(*), 1) AS win_pct
     FROM (${RESULTS}) GROUP BY field, lane ORDER BY field, lane`,
  ],
  competitive: [
    'Competitive on vs off: race length and photo finishes',
    `SELECT json_extract(props, '$.competitive') AS competitive, COUNT(*) AS races, ROUND(AVG(json_extract(props, '$.duration')), 1) AS avg_s,
       ROUND(100.0 * SUM(json_extract(props, '$.photo') IS NOT NULL) / COUNT(*), 1) AS photo_pct
     FROM events WHERE name = 'race_end' GROUP BY competitive`,
  ],
  settings: [
    'Settings people race with',
    `SELECT json_extract(props, '$.trainingLabel') AS training, json_extract(props, '$.rats') AS rats,
       json_extract(props, '$.competitive') AS competitive, json_extract(props, '$.expandedNames') AS expanded_names,
       json_extract(props, '$.sound') AS sound, COUNT(*) AS races
     FROM events WHERE name = 'race_start' GROUP BY 1, 2, 3, 4, 5 ORDER BY races DESC LIMIT 25`,
  ],
  choices: [
    'After a race: Restart, New Race, Esc or the Menu button',
    `SELECT json_extract(props, '$.choice') AS choice, COUNT(*) AS times FROM events WHERE name = 'race_end_choice' GROUP BY choice ORDER BY times DESC`,
  ],
  discovery: [
    'Discovery: sessions that clicked the results board, opened help or About, went fullscreen',
    `SELECT COUNT(DISTINCT session) AS sessions,
       COUNT(DISTINCT CASE WHEN name = 'board_toggle' THEN session END) AS clicked_board,
       COUNT(DISTINCT CASE WHEN name = 'help_open' THEN session END) AS opened_help,
       COUNT(DISTINCT CASE WHEN name = 'about_open' THEN session END) AS opened_about,
       COUNT(DISTINCT CASE WHEN name = 'fullscreen' THEN session END) AS went_fullscreen,
       COUNT(DISTINCT CASE WHEN name = 'sound_toggle' THEN session END) AS toggled_sound
     FROM events`,
  ],
  screensaver: [
    'Screensaver mode: longest sittings and unattended runs',
    `SELECT received_at, json_extract(props, '$.seconds') AS seconds, json_extract(props, '$.racesFinished') AS races,
       json_extract(props, '$.restarts') AS restarts, json_extract(props, '$.longestUnattendedSec') AS unattended_s,
       json_extract(props, '$.fullscreenSec') AS fullscreen_s
     FROM events WHERE name = 'session_end' ORDER BY unattended_s DESC LIMIT 10`,
  ],
  devices: [
    'Devices: screen sizes, touch and countries',
    `SELECT CASE WHEN json_extract(props, '$.touch') THEN 'touch' ELSE 'mouse' END AS input,
       (json_extract(props, '$.w') / 100 * 100) || 'x' || (json_extract(props, '$.h') / 100 * 100) AS size_bucket,
       country, COUNT(*) AS sessions
     FROM events WHERE name = 'session_start' GROUP BY 1, 2, 3 ORDER BY sessions DESC LIMIT 20`,
  ],
  perf: [
    'Performance: frame rate and slow frames per finished race, by screen size',
    `SELECT json_extract(props, '$.fullscreen') AS fullscreen, COUNT(*) AS races, ROUND(AVG(json_extract(props, '$.fps')), 1) AS avg_fps,
       MIN(json_extract(props, '$.fps')) AS worst_fps,
       ROUND(100.0 * SUM(json_extract(props, '$.slowFrames')) / MAX(1, SUM(json_extract(props, '$.frames'))), 2) AS slow_frame_pct
     FROM events WHERE name = 'race_end' GROUP BY fullscreen`,
  ],
  audio: [
    'Audio: races finished with sound on but the browser never let it start',
    `SELECT json_extract(props, '$.audio') AS audio_status, COUNT(*) AS races FROM events
     WHERE name = 'race_end' AND json_extract(props, '$.sound') GROUP BY audio_status`,
  ],
  errors: [
    'Script errors (most recent first)',
    `SELECT received_at, json_extract(props, '$.message') AS message, json_extract(props, '$.where') AS at, country
     FROM events WHERE name = 'error' ORDER BY id DESC LIMIT 20`,
  ],
  abandoned: [
    'Abandoned races: where people bailed',
    `SELECT json_extract(props, '$.phase') AS phase, json_extract(props, '$.leftWith') AS left_with, COUNT(*) AS times,
       ROUND(AVG(json_extract(props, '$.raceTime')), 1) AS avg_race_s
     FROM events WHERE name = 'race_abandoned' GROUP BY 1, 2 ORDER BY times DESC`,
  ],
};

function query(sql) {
  const out = execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out)[0]?.results ?? [];
}

function show(title, sql) {
  console.log(`\n${title}`);
  const rows = query(sql);
  if (rows.length) console.table(rows);
  else console.log('  (nothing yet)');
}

const args = process.argv.slice(2);
if (args[0] === 'sql') show('Query', args.slice(1).join(' '));
else if (!args.length) {
  console.log('Reports (npm run stats -- <name> [...] or all):');
  for (const [name, [title]] of Object.entries(REPORTS)) console.log(`  ${name.padEnd(12)} ${title}`);
} else {
  const names = args[0] === 'all' ? Object.keys(REPORTS) : args;
  for (const name of names) {
    if (!REPORTS[name]) {
      console.error(`unknown report "${name}"; run npm run stats to list them`);
      process.exit(1);
    }
    show(...REPORTS[name]);
  }
}
