import { ASSET_BASE } from './render/sprites';

/**
 * Sound effects (module snd 1000 "click", snd 1001 gate dropping) and music
 * (shared AD 3.0 Sound SONG 30/40/45, rendered offline from the original
 * MIDI and instrument samples by tools/render_music.py).
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is
 * created lazily on the first pointer/key event. Only one music source and
 * one instance of each effect play at a time, so long unattended runs never
 * pile up nodes.
 */
type Clip = 'click' | 'gate' | 'intro' | 'loop' | 'end';

const FILES: Record<Clip, string> = {
  click: 'audio/click.wav',
  gate: 'audio/gate-dropping.wav',
  intro: 'audio/music/william-tell-intro.wav',
  loop: 'audio/music/william-tell-loop.wav',
  end: 'audio/music/william-tell-end.wav',
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Clip, AudioBuffer>();
  private music: AudioBufferSourceNode | null = null;
  private musicClip: Clip | null = null;
  private effects = new Map<Clip, AudioBufferSourceNode>();
  private enabled = true;
  private volume = 0.7;
  /** Music wanted for the current race (set by the app from the Music setting). */
  private musicWanted = false;
  private racing = false;
  private paused = false;
  private hidden = false;

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** For diagnostics: 'locked' before the first click, then the AudioContext state. */
  get status(): string {
    return this.ctx ? this.ctx.state : 'locked';
  }

  get activeNodes(): number {
    return this.effects.size + (this.music ? 1 : 0);
  }

  get currentMusic(): Clip | null {
    return this.musicClip;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyGain();
      // Whenever the context actually starts running, catch up on music that
      // should already be playing (the gesture that unlocked it may have come
      // after the race event that asked for music).
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx?.state === 'running') this.catchUpMusic();
      });
      void this.loadAll();
    }
    this.syncRunning();
  }

  /** Start the music the current race wants, if none is playing and audio can play. */
  private catchUpMusic(): void {
    if (!this.musicWanted || this.music || this.ctx?.state !== 'running') return;
    if (this.racing) this.playMusic('loop', true);
    else {
      this.playMusic('intro', false, () => {
        if (this.musicWanted && this.racing) this.playMusic('loop', true);
      });
    }
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      (Object.keys(FILES) as Clip[]).map(async (clip) => {
        try {
          const res = await fetch(ASSET_BASE + FILES[clip]);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(clip, buf);
        } catch (err) {
          console.warn(`audio: could not load ${clip}`, err);
        }
      }),
    );
    // Audio became available part-way through: join in where the race is.
    this.catchUpMusic();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyGain();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.02);
  }

  /** Paused by the viewer. Audio stays silent until resumed, whatever else is clicked. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncRunning();
  }

  /** Tab hidden (background). Kept separate so returning to the tab doesn't undo a pause. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.syncRunning();
  }

  /** Audio runs only when neither paused nor hidden. */
  private syncRunning(): void {
    if (!this.ctx) return;
    // Always issue the call: suspend/resume are async and queue in order, and the
    // state can lag behind a quick pause-then-resume. Both are no-ops if already there.
    // resume() is refused outside a user gesture in some browsers; a later gesture retries.
    if (!this.paused && !this.hidden) this.ctx.resume().catch(() => undefined);
    else this.ctx.suspend().catch(() => undefined);
  }

  private play(clip: Clip, loop = false, onEnded?: () => void): AudioBufferSourceNode | null {
    const buf = this.buffers.get(clip);
    if (!this.ctx || !this.master || !buf || this.ctx.state !== 'running') return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.master);
    src.onended = () => {
      src.disconnect();
      onEnded?.();
    };
    src.start();
    return src;
  }

  effect(clip: 'click' | 'gate'): void {
    this.effects.get(clip)?.stop();
    const src = this.play(clip, false, () => {
      if (this.effects.get(clip) === src) this.effects.delete(clip);
    });
    if (src) this.effects.set(clip, src);
  }

  private stopMusic(): void {
    const m = this.music;
    this.music = null;
    this.musicClip = null;
    if (m) {
      m.onended = null;
      try {
        m.stop();
      } catch {
        /* already stopped */
      }
      m.disconnect();
    }
  }

  private playMusic(clip: Clip, loop: boolean, then?: () => void): void {
    this.stopMusic();
    const src = this.play(clip, loop, () => {
      if (this.music !== src) return;
      this.music = null;
      this.musicClip = null;
      then?.();
    });
    if (src) {
      this.music = src;
      this.musicClip = clip;
    }
  }

  // ---- race hooks ----

  /** New race staging: intro (SONG 30), then the body (SONG 40) loops while racing. */
  raceStaging(withMusic: boolean): void {
    this.musicWanted = withMusic;
    this.racing = false;
    this.stopMusic();
    if (withMusic) this.playMusic('intro', false, () => {
      if (this.musicWanted && this.racing) this.playMusic('loop', true);
    });
  }

  /** Stage 2: the gates drop with the gate/gun sound (snd 1001, RR_D1 0x4D5E message 3). */
  gatesOpen(): void {
    this.effect('gate');
  }

  /** Rats released: the race music (SONG 40) loops (RR_D1 0x4E0A message 5). */
  release(): void {
    this.racing = true;
    if (this.musicWanted) this.playMusic('loop', true);
  }

  /** Winner crossed: the ending (SONG 45) (RR_D1 0x506C message 6). */
  firstFinish(): void {
    this.racing = false;
    if (this.musicWanted) this.playMusic('end', false);
  }

  /** Photo finish: the camera click (snd 1000, RR_D1 0x5182 message 2). */
  photo(): void {
    this.effect('click');
  }

  stopAll(): void {
    this.stopMusic();
    for (const e of this.effects.values()) e.stop();
    this.effects.clear();
  }
}
