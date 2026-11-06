import animations from '../data/animations.json';
import palette from '../data/palette-mappings.json';
import type { AnimName } from './simulation/rat';
import { sceneTransform, type SceneRenderer, type Viewport } from './render/scene';
import { animFrame, drawFrame } from './render/sprites';

const NAMES = Object.keys(animations.states) as AnimName[];

/**
 * Frame / anchor inspector. Shows one animation state at a time with the
 * anchor cross-hair, bounding box, resource ID and frame index, plus a faint
 * onion skin of the previous frame so anchor jumps are easy to spot.
 * Keys: Up/Down = state, Left/Right = frame, Space = play, X/Y = mirror,
 * C = cycle fur/silk colours.
 */
export class Inspector {
  active = false;
  state = 0;
  frame = 0;
  playing = true;
  flipX = false;
  flipY = false;
  colour = 0;
  private time = 0;

  get anim(): AnimName {
    return NAMES[this.state];
  }

  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const n = animations.states[this.anim].frames.length;
    switch (e.key) {
      case 'ArrowUp':
        this.state = (this.state + NAMES.length - 1) % NAMES.length;
        this.frame = 0;
        break;
      case 'ArrowDown':
        this.state = (this.state + 1) % NAMES.length;
        this.frame = 0;
        break;
      case 'ArrowLeft':
        this.playing = false;
        this.frame = (this.frame + n - 1) % n;
        break;
      case 'ArrowRight':
        this.playing = false;
        this.frame = (this.frame + 1) % n;
        break;
      case ' ':
        this.playing = !this.playing;
        break;
      case 'x':
        this.flipX = !this.flipX;
        break;
      case 'y':
        this.flipY = !this.flipY;
        break;
      case 'c':
        this.colour = (this.colour + 1) % (palette.furs.length * palette.silks.length);
        break;
      default:
        return false;
    }
    return true;
  }

  update(dt: number): void {
    if (!this.active || !this.playing) return;
    const s = animations.states[this.anim];
    this.time += dt * 1000;
    if (this.time >= s.ms) {
      this.time = 0;
      this.frame = (this.frame + 1) % s.frames.length;
    }
  }

  render(ctx: CanvasRenderingContext2D, scene: SceneRenderer, vp: Viewport): void {
    const zoom = 3;
    sceneTransform(ctx, vp);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#2b3a2b';
    ctx.fillRect(0, 0, vp.width, vp.height);
    const s = animations.states[this.anim];
    this.frame %= s.frames.length;
    const fur = this.colour % palette.furs.length;
    const silk = Math.floor(this.colour / palette.furs.length);
    const cx = vp.width / 2;
    const cy = vp.height / 2 + 20;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    // Sniff fronts are drawn over their still rump, as in the race.
    const rump = this.anim === 'sniff-front' ? 'sniff-rump' : this.anim === 'sniff-front-up' ? 'sniff-rump-up' : null;
    const draw = (f: number, alpha: number) => {
      const { sheet, rect } = animFrame(this.anim, f);
      ctx.globalAlpha = alpha;
      if (rump && alpha === 1) {
        const r = animFrame(rump, 0);
        drawFrame(ctx, scene.recolor.sheet(r.sheet, fur, silk), r.rect, 0, 0, { flipX: this.flipX, flipY: this.flipY });
      }
      drawFrame(ctx, scene.recolor.sheet(sheet, fur, silk), rect, 0, 0, { flipX: this.flipX, flipY: this.flipY });
      ctx.globalAlpha = 1;
      return { sheet, rect };
    };
    if (s.frames.length > 1) draw((this.frame + s.frames.length - 1) % s.frames.length, 0.25);
    const { sheet, rect } = draw(this.frame, 1);
    // bounding box
    const ax = rect.ax ?? rect.w / 2;
    const ay = rect.ay ?? rect.h / 2;
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 1 / zoom;
    const bx = this.flipX ? -(rect.w - Math.round(ax)) : -Math.round(ax);
    const by = this.flipY ? -(rect.h - Math.round(ay)) : -Math.round(ay);
    ctx.strokeRect(bx, by, rect.w, rect.h);
    // anchor
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(6, 0);
    ctx.moveTo(0, -6);
    ctx.lineTo(0, 6);
    ctx.stroke();
    ctx.restore();

    const lines = [
      `INSPECTOR  ${this.state + 1}/${NAMES.length}  ${this.anim}`,
      `frame ${this.frame + 1}/${s.frames.length}  RLEP ${sheet}/${String(rect.i).padStart(3, '0')}  ${rect.w}x${rect.h}`,
      `anchor ${ax},${ay}  ${s.ms}ms ${s.loop ? 'loop' : 'once'}  ${this.flipX ? 'mirrorX ' : ''}${this.flipY ? 'mirrorY' : ''}`,
      `fur ${palette.furNames[fur]}  silk ${palette.silkNames[silk]}`,
      'Up/Down state  Left/Right frame  Space play  X/Y mirror  C colour  I exit',
    ];
    lines.forEach((l, i) => scene.font.draw(ctx, l, 10, 10 + i * 13, i === 0 ? '#ffd400' : '#ffffff'));
  }
}
