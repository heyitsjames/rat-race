/**
 * Start menu widgets, after the After Dark 3.0 control panel.
 *
 * Sliders use the control panel's own thumb: THUM 128 lists the small icons
 * 128, 130, 131, 132, 128, a flying toaster that flaps its wings while the
 * thumb is dragged. The frame interval (THUM header word 30) is not decoded;
 * 80 ms per frame is a guess.
 */

const PANEL = './assets/rat-race/panel/';
const THUMB_FRAMES = [128, 130, 131, 132, 128].map((id) => `${PANEL}thumb-${id}.png`);
const THUMB_FRAME_MS = 80;
const THUMB_SIZE = 16;

/** Speaker icons ICON 128-133, "Volume 0/1/2/3/5/7". */
export const VOLUME_STEPS = [0, 1, 2, 3, 5, 7] as const;
export const volumeIcon = (step: number) => `${PANEL}volume-${step}.png`;

/** Nearest speaker step for a 0-1 volume (0 means sound off). */
export function volumeStep(sound: boolean, volume: number): number {
  if (!sound || volume <= 0) return 0;
  let best: number = VOLUME_STEPS[1];
  for (const s of VOLUME_STEPS.slice(1)) if (Math.abs(s / 7 - volume) < Math.abs(best / 7 - volume)) best = s;
  return best;
}

// Warm the cache so the first flap doesn't flicker.
if (typeof Image !== 'undefined') for (const src of THUMB_FRAMES) new Image().src = src;

/** Index of the stop a value falls in: the last stop at or below it. */
export function stopIndex(stops: readonly number[], value: number): number {
  let i = 0;
  stops.forEach((s, j) => {
    if (value >= s) i = j;
  });
  return i;
}

/**
 * A slider with one detent per setting (the sUnt stops), evenly spaced. The
 * thumb snaps to the nearest stop while dragging, and the value reported is
 * that stop's sUnt value.
 */
export class MacSlider {
  private readonly thumb: HTMLElement;
  private index = 0;
  private flap = 0;
  private flapTimer = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly stops: readonly number[],
    private readonly onInput: (value: number) => void,
    private readonly describe: (value: number) => string,
  ) {
    this.thumb = el.querySelector('.mac-thumb')!;
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(stops.length - 1));
    this.thumb.style.backgroundImage = `url(${THUMB_FRAMES[0]})`;
    // Tick marks below the knob, one per stop, centred on the knob's positions. They start
    // under the knob's bottom edge: the thumb art has a black seam at its centre column that
    // would otherwise line up with the tick and look see-through.
    const ticks = document.createElement('div');
    ticks.className = 'mac-ticks';
    for (let i = 0; i < stops.length; i++) {
      const t = document.createElement('i');
      t.style.left = this.offset(i, THUMB_SIZE / 2);
      ticks.append(t);
    }
    el.prepend(ticks);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      this.startFlap();
      this.fromPointer(e.clientX);
    });
    el.addEventListener('pointermove', (e) => {
      if (el.hasPointerCapture(e.pointerId)) this.fromPointer(e.clientX);
    });
    const end = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      this.stopFlap();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const last = this.stops.length - 1;
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -1, PageUp: 1 }[e.key];
      let next: number | undefined;
      if (step !== undefined) next = this.index + step;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = last;
      if (next === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      this.commit(Math.min(last, Math.max(0, next)));
      this.startFlap();
      window.clearTimeout(this.flapTimer);
      this.flapTimer = window.setTimeout(() => this.stopFlap(), 400);
    });
  }

  /** CSS left for stop i, plus a pixel offset. */
  private offset(i: number, px = 0): string {
    const frac = this.stops.length > 1 ? i / (this.stops.length - 1) : 0;
    return `calc(${frac} * (100% - ${THUMB_SIZE}px) + ${px}px)`;
  }

  /** Show a saved value (snapped to its stop). */
  set(value: number): void {
    this.index = stopIndex(this.stops, value);
    this.thumb.style.left = this.offset(this.index);
    this.el.setAttribute('aria-valuenow', String(this.index));
    this.el.setAttribute('aria-valuetext', this.describe(this.stops[this.index]));
  }

  private commit(index: number): void {
    if (index === this.index) return;
    this.set(this.stops[index]);
    this.onInput(this.stops[index]);
  }

  private fromPointer(clientX: number): void {
    const r = this.el.getBoundingClientRect();
    // getBoundingClientRect is in screen pixels; the menu may be scaled up.
    const scale = r.width / this.el.offsetWidth || 1;
    const usable = r.width - THUMB_SIZE * scale;
    const frac = Math.min(1, Math.max(0, (clientX - r.left - (THUMB_SIZE * scale) / 2) / usable));
    this.commit(Math.round(frac * (this.stops.length - 1)));
  }

  private startFlap(): void {
    if (this.flap) return;
    let i = 0;
    this.flap = window.setInterval(() => {
      i = (i + 1) % (THUMB_FRAMES.length - 1);
      this.thumb.style.backgroundImage = `url(${THUMB_FRAMES[i]})`;
    }, THUMB_FRAME_MS);
  }

  private stopFlap(): void {
    window.clearInterval(this.flap);
    this.flap = 0;
    this.thumb.style.backgroundImage = `url(${THUMB_FRAMES[0]})`;
  }
}
