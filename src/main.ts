import labels from '../public/assets/rat-race/rat-names-and-labels.json';
import expandedNames from '../data/expanded-names.json';
import { analytics } from './analytics';
import { AudioEngine } from './audio';
import { CornerLab } from './corner-lab';
import { Inspector } from './debug';
import { computeViewport, SceneRenderer, type Viewport } from './render/scene';
import { loadAssets } from './render/sprites';
import helpText from '../public/assets/rat-race/module-help.txt?raw';
import { MacSlider, VOLUME_STEPS, volumeIcon, volumeStep } from './menu';
import { loadSettings, saveSettings, type Settings } from './settings';
import { RaceSeries, type RaceEvent } from './simulation/race';
import { RaceStats } from './simulation/race-stats';
import { FixedStepper, STEP_SECONDS } from './simulation/session';
import { lanesFor, MAX_LANES, MIN_LANES, Track } from './simulation/track';
import { TRAINING_LEVELS, trainingLabel } from './simulation/training';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const IDLE_MS = 1500;
/** How long the finished race stays on screen before the menu comes back. */
/** Most of the window (each way) the start menu may take up. */
const MENU_MAX_FILL = 0.8;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('scene');
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const loading = $('loading');

  let assets;
  try {
    assets = await loadAssets();
  } catch (err) {
    $('loading-text').textContent = `Rat Race module has a problem. ${(err as Error).message}`;
    loading.classList.add('error');
    return;
  }
  // Wait for the start menu's own images too, so it appears complete.
  await Promise.all([...document.querySelectorAll<HTMLImageElement>('#menu img')].map((img) => img.decode().catch(() => undefined)));
  /** Show the page once the first frame (track, grass and a sized menu) has been drawn. */
  const reveal = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.body.classList.remove('loading');
        loading.classList.add('done');
        loading.addEventListener('transitionend', () => loading.remove(), { once: true });
        setTimeout(() => loading.remove(), 1000);
      }),
    );

  const settings: Settings = loadSettings();
  const scene = new SceneRenderer(ctx, assets);
  if (params.has('corners')) {
    runCornerLab(canvas, scene);
    reveal();
    return;
  }
  const audio = new AudioEngine();
  audio.setEnabled(settings.sound);
  audio.setVolume(settings.volume);
  const inspector = new Inspector();
  inspector.active = params.has('inspect');

  const seedParam = Number(params.get('seed'));
  const newSeed = () => (Number.isFinite(seedParam) && params.has('seed') ? seedParam : (Math.random() * 2 ** 32) >>> 0);
  // Lanes of the current series: the Rats setting as it was when the series began.
  let lanes = lanesFor(settings.rats);
  let vp: Viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio || 1, lanes);
  const makeSeries = () => {
    lanes = lanesFor(settings.rats);
    const rats = settings.rats;
    vp = computeViewport(innerWidth, innerHeight, devicePixelRatio || 1, lanes);
    const names = settings.expandedNames ? [...labels['2000'], ...expandedNames] : labels['2000'];
    return new RaceSeries(newSeed(), names, () => settings.training, new Track(vp.width, vp.height, lanes), {
      once: true,
      introPlaying: () => audio.currentMusic === 'intro',
      competitive: () => settings.competitive,
      rats: () => rats,
    });
  };
  let series = makeSeries();
  const stepper = new FixedStepper(STEP_SECONDS);
  let speed = Math.max(0.25, Number(params.get('speed') ?? 1) || 1);
  let paused = false;
  // The start menu shows first; ?run=1 skips straight to racing.
  let running = params.has('run');

  // ---------- anonymous race stats (see analytics.ts) ----------
  const pageStart = performance.now();
  let stats: RaceStats | null = null;
  let statsSent = false;
  let racesFinished = 0;
  let restarts = 0;
  let lastInput = performance.now();
  let longestUnattended = 0;
  let fullscreenSince = 0;
  let fullscreenMs = 0;
  // Frame timing while a race runs: count, sum and frames slower than 50 ms.
  let perf = { frames: 0, ms: 0, slow: 0 };
  const settingsProps = () => ({
    training: settings.training,
    trainingLabel: trainingLabel(settings.training),
    competitive: settings.competitive,
    expandedNames: settings.expandedNames,
    rats: settings.rats,
    sound: settings.sound,
    volume: Math.round(settings.volume * 100) / 100,
  });
  /** A race started (from the menu, ?run=1 or a restart): watch it and note who's racing. */
  const beginStats = (kind: 'new' | 'restart' | 'autorun') => {
    const r = series.race;
    stats = new RaceStats(r);
    statsSent = false;
    perf = { frames: 0, ms: 0, slow: 0 };
    analytics.track('race_start', {
      kind,
      seed: series.seed,
      raceSeed: r.seed,
      ...settingsProps(),
      w: innerWidth,
      h: innerHeight,
      lineup: r.rats.map((x) => x.name),
    });
  };
  /** The current race is being left: send its result, or note where it was abandoned. */
  const endStats = (leftWith: 'restart' | 'menu' | 'leave' | null) => {
    if (!stats || statsSent) return;
    statsSent = true;
    const r = series.race;
    if (r.phase !== 'done') {
      analytics.track('race_abandoned', { raceSeed: r.seed, phase: r.phase, raceTime: Math.round(r.raceTime * 10) / 10, leftWith });
      return;
    }
    racesFinished++;
    analytics.track('race_end', {
      ...stats.summary(),
      seed: series.seed,
      sound: settings.sound,
      audio: audio.status,
      fullscreen: !!document.fullscreenElement,
      fps: perf.ms > 0 ? Math.round((perf.frames * 1000) / perf.ms) : null,
      slowFrames: perf.slow,
      frames: perf.frames,
    });
  };
  /** What people do once a race is over: Restart, New Race, or Esc/Menu. */
  const afterRace = (choice: string) => {
    if (series.done) analytics.track('race_end_choice', { choice });
  };
  addEventListener('pagehide', () => {
    if (running) endStats('leave');
    if (fullscreenSince) fullscreenMs += performance.now() - fullscreenSince;
    analytics.track('session_end', {
      seconds: Math.round((performance.now() - pageStart) / 1000),
      racesFinished,
      restarts,
      longestUnattendedSec: Math.round(longestUnattended / 1000),
      fullscreenSec: Math.round(fullscreenMs / 1000),
    });
    analytics.flush(true);
  });

  // ---------- sizing ----------
  /**
   * Whole-number scaling keeps the control panel art crisp. Use the largest scale at
   * which the menu takes at most MENU_MAX_FILL of the window, measured from the menu
   * itself (offset sizes ignore the CSS transform), so it never fills a big screen.
   */
  let menuSize = { w: 240, h: 311 };
  const fitMenu = () => {
    const el = $('menu');
    if (el.offsetHeight > 0) menuSize = { w: el.offsetWidth, h: el.offsetHeight };
    const fit = Math.min((innerWidth * MENU_MAX_FILL) / menuSize.w, (innerHeight * MENU_MAX_FILL) / menuSize.h);
    const menuScale = Math.max(1, Math.min(3, Math.floor(fit)));
    document.documentElement.style.setProperty('--menu-scale', String(menuScale));
  };
  const resize = () => {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(innerHeight * dpr));
    vp = computeViewport(innerWidth, innerHeight, dpr, lanes);
    series.track = new Track(vp.width, vp.height, lanes);
    fitMenu();
  };
  resize();
  addEventListener('resize', resize);

  // ---------- events from the simulation ----------
  const handle = (e: RaceEvent) => {
    switch (e.type) {
      case 'staging':
        audio.raceStaging(e.withMusic);
        break;
      case 'gates-open':
        audio.gatesOpen();
        break;
      case 'release':
        audio.release();
        break;
      case 'finish':
        // The deciding finish (the winner, or 2nd in competitive mode) ends the music with the
        // ending; earlier ones in competitive mode pause it for the ending; later ones are silent.
        if (e.place === e.settlesAt) audio.firstFinish();
        else if (e.place < e.settlesAt) audio.finishOverMusic();
        break;
      case 'photo':
        audio.photo();
        break;
    }
  };

  // ---------- controls ----------
  const btnPause = $<HTMLButtonElement>('btn-pause');
  const btnSound = $<HTMLButtonElement>('btn-sound');
  const volume = $<HTMLInputElement>('volume');
  const trainingOut = $<HTMLOutputElement>('training-label');
  const competitive = $<HTMLInputElement>('competitive');
  const expanded = $<HTMLInputElement>('expanded-names');
  const menuLayer = $('menu-layer');
  const menuVolumeIcon = $<HTMLImageElement>('menu-volume-icon');
  const menuHelp = $('menu-help');
  const menuHelpBtn = $<HTMLButtonElement>('menu-help-btn');
  const runRace = $<HTMLButtonElement>('run-race');
  const aboutPanel = $('about');
  const controls = $('controls');
  menuHelp.textContent = helpText.trim();

  const training = new MacSlider($('training'), TRAINING_LEVELS.map((l) => l.value), (v) => {
    settings.training = v;
    commit();
  }, trainingLabel);
  const ratCount = new MacSlider($('rats'), Array.from({ length: MAX_LANES - MIN_LANES + 1 }, (_, i) => MIN_LANES + i), (v) => {
    settings.rats = v;
    commit();
    // Only settable from the menu, so the scene behind it can show the new field straight away.
    if (!running) series = makeSeries();
  }, String);
  const ratsOut = $<HTMLOutputElement>('rats-label');

  const syncUi = () => {
    btnPause.textContent = paused ? 'Resume' : 'Pause';
    btnSound.textContent = settings.sound ? 'Sound on' : 'Sound off';
    btnSound.setAttribute('aria-pressed', String(settings.sound));
    volume.value = String(settings.volume);
    training.set(settings.training);
    trainingOut.textContent = trainingLabel(settings.training);
    ratCount.set(settings.rats);
    ratsOut.textContent = String(settings.rats);
    competitive.checked = settings.competitive;
    expanded.checked = settings.expandedNames;
    const step = volumeStep(settings.sound, settings.volume);
    menuVolumeIcon.src = volumeIcon(step);
    $('menu-volume').title = step === 0 ? 'Sound off' : `Sound volume ${step} of 7`;
    menuLayer.hidden = running;
    controls.hidden = !running;
    if (!running) aboutPanel.hidden = true;
  };
  const commit = () => {
    saveSettings(settings);
    syncUi();
  };
  syncUi();

  const setPaused = (p: boolean) => {
    paused = p;
    audio.setPaused(p);
    syncUi();
  };
  /** The same rats race again with fresh luck, so the result can change. */
  const restart = () => {
    afterRace('restart');
    endStats('restart');
    restarts++;
    scene.showTimes = false;
    audio.stopAll();
    series.rerun();
    beginStats('restart');
    stepper.reset();
    setPaused(false);
  };
  const startRacing = () => {
    audio.unlock();
    running = true;
    scene.showTimes = false;
    audio.stopAll();
    series = makeSeries();
    beginStats('new');
    stepper.reset();
    setPaused(false);
    wake();
  };
  const showMenu = (choice = 'menu') => {
    if (running) {
      afterRace(choice);
      endStats('menu');
    }
    stats = null;
    running = false;
    scene.showTimes = false;
    audio.stopAll();
    setPaused(false);
    series = makeSeries();
    $('btn-about').setAttribute('aria-expanded', 'false');
    runRace.focus();
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const toggleSound = () => {
    settings.sound = !settings.sound;
    analytics.track('sound_toggle', { on: settings.sound, running });
    audio.setEnabled(settings.sound);
    commit();
  };
  const toggleAbout = (open?: boolean) => {
    aboutPanel.hidden = !(open ?? aboutPanel.hidden);
    if (!aboutPanel.hidden) analytics.track('about_open');
    $('btn-about').setAttribute('aria-expanded', String(!aboutPanel.hidden));
  };

  btnPause.onclick = () => setPaused(!paused);
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    if (on) fullscreenSince = performance.now();
    else if (fullscreenSince) {
      fullscreenMs += performance.now() - fullscreenSince;
      fullscreenSince = 0;
    }
    analytics.track('fullscreen', { on, running });
  });
  $('btn-restart').onclick = restart;
  // Shown under the results board once the race is over.
  const raceEnd = $('race-end');
  $('end-restart').onclick = restart;
  $('end-new-race').onclick = () => showMenu('new-race');
  // Once the race is over, clicking or tapping the results board switches between
  // WIN / PLACE / SHOW and each rat's place and time.
  const onBoard = (e: MouseEvent) => {
    const b = scene.boardRect;
    if (!running || !series.done || inspector.active || !b) return false;
    const dpr = devicePixelRatio || 1;
    const x = (e.clientX * dpr - vp.offsetX) / vp.scale;
    const y = (e.clientY * dpr - vp.offsetY) / vp.scale;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  };
  canvas.addEventListener('click', (e) => {
    if (onBoard(e)) {
      scene.showTimes = !scene.showTimes;
      analytics.track('board_toggle', { showTimes: scene.showTimes });
    }
  });
  canvas.addEventListener('pointermove', (e) => document.body.classList.toggle('board-clickable', onBoard(e)));
  const placeRaceEnd = () => {
    const show = running && series.done && !inspector.active && !!scene.boardRect;
    raceEnd.hidden = !show;
    if (!show) return;
    const b = scene.boardRect!;
    const dpr = devicePixelRatio || 1;
    raceEnd.style.left = `${((b.x + b.w / 2) * vp.scale + vp.offsetX) / dpr}px`;
    raceEnd.style.top = `${((b.y + b.h) * vp.scale + vp.offsetY) / dpr + 12}px`;
  };
  btnSound.onclick = toggleSound;
  $('btn-fullscreen').onclick = toggleFullscreen;
  $('btn-menu').onclick = () => showMenu();
  $('btn-about').onclick = () => toggleAbout();
  runRace.onclick = startRacing;
  volume.oninput = () => {
    settings.volume = Number(volume.value);
    audio.setVolume(settings.volume);
    commit();
  };
  competitive.onchange = () => {
    settings.competitive = competitive.checked;
    commit();
  };
  expanded.onchange = () => {
    settings.expandedNames = expanded.checked;
    commit();
    // Like Rats, only settable from the menu: redraw the names on the board behind it.
    if (!running) series = makeSeries();
  };
  // The speaker steps through the control panel's volume icons: off, 1, 2, 3, 5, 7.
  $('menu-volume').onclick = () => {
    const i = VOLUME_STEPS.indexOf(volumeStep(settings.sound, settings.volume) as (typeof VOLUME_STEPS)[number]);
    const next = VOLUME_STEPS[(i + 1) % VOLUME_STEPS.length];
    settings.sound = next > 0;
    if (next > 0) settings.volume = next / 7;
    audio.setEnabled(settings.sound);
    audio.setVolume(settings.volume);
    commit();
  };
  menuHelpBtn.onclick = () => {
    menuHelp.hidden = !menuHelp.hidden;
    if (!menuHelp.hidden) analytics.track('help_open');
    menuHelpBtn.setAttribute('aria-expanded', String(!menuHelp.hidden));
    $('module-controls').setAttribute('aria-hidden', String(!menuHelp.hidden));
    $('module-controls').inert = !menuHelp.hidden;
  };
  if (!running) runRace.focus();

  // ---------- idle hiding & audio unlock ----------
  let idleTimer = 0;
  const wake = () => {
    lastInput = performance.now();
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      const busy = document.activeElement && document.activeElement !== document.body && document.activeElement.closest('.panel, .controls');
      if (running && !busy && aboutPanel.hidden) document.body.classList.add('idle');
      else wake();
    }, IDLE_MS);
  };
  // Browsers differ on which event grants permission to start audio: Chrome
  // accepts a mouse press, Safari and touch screens only the release or click.
  // Try on all of them; unlock() is cheap and safe to repeat.
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown', 'keyup']) {
    addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
  }
  // Only moving the mouse or tapping the screen brings the control bar back; key
  // presses (Space, M, F, ...) act without showing it.
  addEventListener('pointerdown', wake);
  addEventListener('pointermove', wake);
  addEventListener('keydown', () => (lastInput = performance.now()), { capture: true, passive: true });
  addEventListener('keydown', (e) => {
    if (inspector.key(e)) {
      e.preventDefault();
      return;
    }
    // Leave browser shortcuts alone: Cmd+R should just reload, not restart the race first.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const typing = target.matches('input, select, textarea');
    const onButton = target.matches('button');
    if (!running) {
      // In the menu: Enter (or Return) presses the default button, as on the Mac.
      if (e.key === 'Enter' && !onButton && !target.matches('input')) {
        e.preventDefault();
        startRacing();
      }
      if ((e.key === 'f' || e.key === 'F') && !typing) toggleFullscreen();
      if ((e.key === 'i' || e.key === 'I') && DEBUG) inspector.active = !inspector.active;
      return;
    }
    switch (e.key) {
      case ' ':
        if (typing || onButton) return;
        e.preventDefault();
        setPaused(!paused);
        break;
      case 'r':
      case 'R':
        if (!typing) restart();
        break;
      case 'f':
      case 'F':
        if (!typing) toggleFullscreen();
        break;
      case 'm':
      case 'M':
        if (!typing) toggleSound();
        break;
      case 'i':
      case 'I':
        if (DEBUG) inspector.active = !inspector.active;
        break;
      case 'Escape':
        if (!aboutPanel.hidden) toggleAbout(false);
        else showMenu('escape');
        break;
    }
  });
  document.addEventListener('visibilitychange', () => {
    audio.setHidden(document.hidden);
    last = performance.now();
  });
  wake();

  // ---------- debug panel ----------
  // Sound is on but the browser hasn't let audio start yet (no click or key press so far).
  const soundHint = $<HTMLButtonElement>('sound-hint');
  soundHint.onclick = () => audio.unlock();
  const syncSoundHint = () => {
    soundHint.hidden = !running || !settings.sound || paused || audio.status === 'running';
  };

  const debugEl = $('debug');
  // Debug builds expose internals for inspection from the browser console.
  if (DEBUG) Object.assign(window, { ratRace: { audio, get series() { return series; } } });
  let fps = 0;
  if (DEBUG) {
    debugEl.hidden = false;
    debugEl.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).dataset.action;
      if (action === 'speed') speed = speed >= 16 ? 1 : speed * 4;
      if (action === 'inspect') inspector.active = !inspector.active;
      if (action === 'next') series.race.phase = 'done';
    });
  }
  const renderDebug = () => {
    const r = series.race;
    const text = [
      `seed ${series.seed}  race #${series.raceIndex + 1}  race seed ${r.seed}`,
      `phase ${r.phase} ${r.phaseTime.toFixed(1)}s  race ${r.raceTime.toFixed(1)}s  speed x${speed}  ${fps.toFixed(0)} fps`,
      `training ${settings.training} (${trainingLabel(settings.training)})${r.competitive ? '  competitive' : ''}`,
      `audio ${audio.status} nodes ${audio.activeNodes} music ${audio.currentMusic ?? '-'}`,
      `recolour cache ${scene.recolor.size}  view ${vp.width.toFixed(0)}x${vp.height.toFixed(0)} @${vp.scale.toFixed(2)}`,
      ...r.rats.map((x) => `L${x.lane + 1} ${x.mode.padEnd(11)} q${x.q.toFixed(2).padStart(6)} v${x.v.toFixed(2)} ${x.finished ? 'P' + (r.finishOrder.indexOf(x) + 1) : '  '} ${x.name}`),
    ].join('\n');
    debugEl.innerHTML = '';
    debugEl.append(text, document.createElement('br'));
    for (const [action, label] of [
      ['speed', 'speed'],
      ['inspect', 'inspector (I)'],
      ['next', 'end race'],
    ]) {
      const b = document.createElement('button');
      b.dataset.action = action;
      b.textContent = label;
      debugEl.append(b);
    }
  };

  // ---------- main loop ----------
  let last = performance.now();
  let debugTick = 0;
  const frame = (now: number) => {
    const real = (now - last) / 1000;
    last = now;
    if (real > 0) fps = fps * 0.9 + (1 / real) * 0.1;
    if (inspector.active) {
      inspector.update(Math.min(real, 0.25));
      inspector.render(ctx, scene, vp);
    } else {
      if (running && !paused) {
        const steps = stepper.advance(real, speed);
        for (let i = 0; i < steps; i++) {
          for (const e of series.step(STEP_SECONDS)) handle(e);
          stats?.observe();
        }
        if (stats && !statsSent && series.done) endStats(null);
        if (!document.hidden && real > 0 && real < 1) {
          perf.frames++;
          perf.ms += real * 1000;
          if (real > 0.05) perf.slow++;
        }
        // Left running as a screensaver: the longest stretch with no mouse, touch or key.
        longestUnattended = Math.max(longestUnattended, now - lastInput);
      }
      scene.render(series.race, vp);
    }
    // One race per run: once it's over, the board stays up with Restart and New Race under it.
    placeRaceEnd();
    syncSoundHint();
    debugEl.hidden = !DEBUG || inspector.active;
    menuLayer.hidden = running || inspector.active;
    if (DEBUG && now - debugTick > 250) {
      debugTick = now;
      renderDebug();
    }
    requestAnimationFrame(frame);
  };
  analytics.track('session_start', {
    ...settingsProps(),
    w: innerWidth,
    h: innerHeight,
    dpr: devicePixelRatio || 1,
    touch: matchMedia('(pointer: coarse)').matches,
    lang: navigator.language,
    referrer: (() => {
      try {
        return document.referrer ? new URL(document.referrer).hostname : null;
      } catch {
        return null;
      }
    })(),
    autorun: running,
  });
  if (running) beginStats('autorun');
  requestAnimationFrame(frame);
  reveal();
}

/** ?corners=1: compare corner animation styles (see corner-lab.ts). */
function runCornerLab(canvas: HTMLCanvasElement, scene: SceneRenderer): void {
  $('menu-layer').hidden = true;
  $('controls').hidden = true;
  const info = $('debug');
  info.hidden = false;
  let vp: Viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio || 1);
  const resize = () => {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(innerHeight * dpr));
    vp = computeViewport(innerWidth, innerHeight, dpr);
  };
  resize();
  addEventListener('resize', resize);
  const lab = new CornerLab(new Track(vp.width, vp.height));
  addEventListener('keydown', (e) => {
    if (lab.key(e)) e.preventDefault();
  });
  let last = performance.now();
  let shown = '';
  const frame = (now: number) => {
    lab.update(Math.min((now - last) / 1000, 0.25));
    last = now;
    lab.render(scene, vp);
    const text = lab.describe();
    if (text !== shown) info.textContent = shown = text;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
