import animations from '../../data/animations.json';
import palette from '../../data/palette-mappings.json';
import type { AnimName } from '../simulation/rat';

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/rat-race/`;

export type SheetId = '1001' | '1100' | '1101' | '1102' | '1150' | '1200' | '1300' | '1400';
export const SHEETS: SheetId[] = ['1001', '1100', '1101', '1102', '1150', '1200', '1300', '1400'];
/** Sheets that carry fur and silk colours and can be recoloured. */
const RAT_SHEETS: SheetId[] = ['1100', '1101', '1102', '1150'];

export interface FrameRect {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number | null;
  ay: number | null;
}

type Source = HTMLImageElement | HTMLCanvasElement;

export interface Assets {
  sheets: Record<SheetId, HTMLImageElement>;
  grass: HTMLImageElement;
  track: HTMLImageElement;
  font: HTMLImageElement;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

export async function loadAssets(): Promise<Assets> {
  const sheetImgs = await Promise.all(SHEETS.map((id) => loadImage(`${ASSET_BASE}atlases/${id}.png`)));
  const [grass, track, font] = await Promise.all(
    ['grass', 'track', 'ratvetica'].map((n) => loadImage(`${ASSET_BASE}images/${n}.png`)),
  );
  const sheets = Object.fromEntries(SHEETS.map((id, k) => [id, sheetImgs[k]])) as Record<SheetId, HTMLImageElement>;
  return { sheets, grass, track, font };
}

export function frameRect(sheet: SheetId | number, index: number): FrameRect {
  return (animations.sheets as Record<string, FrameRect[]>)[String(sheet)][index];
}

export function animFrame(anim: AnimName, frame: number): { sheet: SheetId; rect: FrameRect } {
  const [sheet, index] = animations.states[anim].frames[frame] as [number, number];
  return { sheet: String(sheet) as SheetId, rect: frameRect(sheet, index) };
}

const key = (c: number[]) => (c[0] << 16) | (c[1] << 8) | c[2];

/**
 * Recolours rat artwork by exact colour substitution using the Furs n Silks
 * colour table (clut 1100): ramp 0 / silk 0 are the colours stored in the
 * sprite palettes, so every pixel of those colours is swapped for the same
 * shade in the chosen ramp. Alpha and all other colours are untouched.
 */
export class Recolorer {
  private cache = new Map<string, Record<string, HTMLCanvasElement>>();
  constructor(
    private readonly assets: Assets,
    private readonly maxEntries = 16,
  ) {}

  sheet(sheet: SheetId, fur: number, silk: number): Source {
    if (!RAT_SHEETS.includes(sheet) || (fur === 0 && silk === 0)) return this.assets.sheets[sheet];
    const k = `${fur}:${silk}`;
    let entry = this.cache.get(k);
    if (entry) {
      // refresh LRU position
      this.cache.delete(k);
      this.cache.set(k, entry);
    } else {
      entry = {};
      this.cache.set(k, entry);
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    }
    if (!entry[sheet]) entry[sheet] = this.build(sheet, fur, silk);
    return entry[sheet];
  }

  get size(): number {
    return this.cache.size;
  }

  private build(sheet: SheetId, fur: number, silk: number): HTMLCanvasElement {
    const img = this.assets.sheets[sheet];
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const map = new Map<number, number[]>();
    palette.sourceFur.forEach((src, i) => map.set(key(src), palette.furs[fur][i]));
    palette.sourceSilk.forEach((src, i) => map.set(key(src), palette.silks[silk][i]));
    const d = data.data;
    for (let o = 0; o < d.length; o += 4) {
      if (!d[o + 3]) continue;
      const to = map.get((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
      if (to) {
        d[o] = to[0];
        d[o + 1] = to[1];
        d[o + 2] = to[2];
      }
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }
}

/**
 * Draws one frame with its anchor at (x, y) in the current transform's
 * logical units. `snap` is the device pixels per logical pixel, used to land
 * the sprite on whole device pixels so pixel art stays crisp.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  src: Source,
  rect: FrameRect,
  x: number,
  y: number,
  opts: { flipX?: boolean; flipY?: boolean; snap?: number; rotate?: number } = {},
): void {
  const ax = rect.ax ?? rect.w / 2;
  const ay = rect.ay ?? rect.h / 2;
  const s = opts.snap ?? 1;
  const px = Math.round(x * s) / s;
  const py = Math.round(y * s) / s;
  if (!opts.flipX && !opts.flipY && !opts.rotate) {
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, px - Math.round(ax), py - Math.round(ay), rect.w, rect.h);
    return;
  }
  ctx.save();
  ctx.translate(px, py);
  // degrees anticlockwise on screen; canvas y points down, so negate
  if (opts.rotate) ctx.rotate((-opts.rotate * Math.PI) / 180);
  ctx.scale(opts.flipX ? -1 : 1, opts.flipY ? -1 : 1);
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, -Math.round(ax), -Math.round(ay), rect.w, rect.h);
  ctx.restore();
}
