import labels from '../public/assets/rat-race/rat-names-and-labels.json';
import { AudioEngine } from './audio';
import { CornerLab } from './corner-lab';
import { Inspector } from './debug';
import { computeViewport, SceneRenderer, type Viewport } from './render/scene';
import { loadAssets } from './render/sprites';
import helpText from '../public/assets/rat-race/module-help.txt?raw';
import { MacSlider, VOLUME_STEPS, volumeIcon, volumeStep } from './menu';
import { loadSettings, saveSettings, type Settings } from './settings';
import { RaceSeries, type RaceEvent } from './simulation/race';
import { FixedStepper, STEP_SECONDS } from './simulation/session';
import { MAX_LANES, MIN_LANES, Track } from './simulation/track';
import { TRAINING_LEVELS, trainingLabel } from './simulation/training';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const IDLE_MS = 1500;
/** How long the finished race stays on screen before the menu comes back. */
const BACK_TO_MENU_SECONDS = 10;
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
    loading.textContent = `Rat Race module has a problem. ${(err as Error).message}`;
    loading.classList.add('error');
    return;
  }
  loading.remove();

  const settings: Settings = loadSettings();
  const scene = new SceneRenderer(ctx, assets);
  if (params.has('corners')) {
    runCornerLab(canvas, scene);
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
  let lanes = settings.rats;
  let vp: Viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio || 1, lanes);
  const makeSeries = () => {
    lanes = settings.rats;
    vp = computeViewport(innerWidth, innerHeight, devicePixelRatio || 1, lanes);
    return new RaceSeries(newSeed(), labels['2000'], () => settings.training, new Track(vp.width, vp.height, lanes), {
      once: true,
      introPlaying: () => audio.currentMusic === 'intro',
      competitive: () => settings.competitive,
    });
  };
  let series = makeSeries();
  const stepper = new FixedStepper(STEP_SECONDS);
  let speed = Math.max(0.25, Number(params.get('speed') ?? 1) || 1);
  let paused = false;
  // The start menu shows first; ?run=1 skips straight to racing.
  let running = params.has('run');
  /** Seconds since the race ended (race time, so pause and speed apply). */
  let doneSeconds = 0;

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
  /** Fresh races. */
  const restart = () => {
    doneSeconds = 0;
    audio.stopAll();
    series = makeSeries();
    stepper.reset();
    setPaused(false);
  };
  const startRacing = () => {
    audio.unlock();
    running = true;
    restart();
    wake();
  };
  const showMenu = () => {
    running = false;
    doneSeconds = 0;
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
    audio.setEnabled(settings.sound);
    commit();
  };
  const toggleAbout = (open?: boolean) => {
    aboutPanel.hidden = !(open ?? aboutPanel.hidden);
    $('btn-about').setAttribute('aria-expanded', String(!aboutPanel.hidden));
  };

  btnPause.onclick = () => setPaused(!paused);
  $('btn-restart').onclick = restart;
  btnSound.onclick = toggleSound;
  $('btn-fullscreen').onclick = toggleFullscreen;
  $('btn-menu').onclick = showMenu;
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
    menuHelpBtn.setAttribute('aria-expanded', String(!menuHelp.hidden));
    $('module-controls').setAttribute('aria-hidden', String(!menuHelp.hidden));
    $('module-controls').inert = !menuHelp.hidden;
  };
  if (!running) runRace.focus();

  // ---------- idle hiding & audio unlock ----------
  let idleTimer = 0;
  const wake = () => {
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
  addEventListener('pointerdown', wake);
  addEventListener('pointermove', wake);
  addEventListener('keydown', (e) => {
    wake();
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
        else showMenu();
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
          // One race per run: once it's over, the board stays up for a while, then the menu returns.
          if (series.done) doneSeconds += STEP_SECONDS;
        }
        if (doneSeconds >= BACK_TO_MENU_SECONDS) showMenu();
      }
      scene.render(series.race, vp);
    }
    syncSoundHint();
    debugEl.hidden = !DEBUG || inspector.active;
    menuLayer.hidden = running || inspector.active;
    if (DEBUG && now - debugTick > 250) {
      debugTick = now;
      renderDebug();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
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
