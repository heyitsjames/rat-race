import font from '../../data/font.json';

/**
 * Ratvetica, the module's own bitmap font (PiCT 110 strip + STFT 110 metrics).
 * The strip is 1-bit: dark pixels are ink. Glyphs are tinted per colour and
 * cached. Characters outside 33..126 fall back to a space.
 */
export class BitmapFont {
  private tinted = new Map<string, HTMLCanvasElement>();
  readonly height = font.rows;

  constructor(private readonly strip: HTMLImageElement) {}

  private sheet(color: string): HTMLCanvasElement {
    let c = this.tinted.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = this.strip.width;
    c.height = font.rows;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.strip, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    const d = img.data;
    for (let o = 0; o < d.length; o += 4) {
      const ink = d[o] < 128;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = ink ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    this.tinted.set(color, c);
    return c;
  }

  private glyph(ch: string): { x: number; w: number } | null {
    return (font.glyphs as Record<string, { x: number; w: number }>)[ch] ?? null;
  }

  measure(text: string): number {
    let w = 0;
    for (const ch of text) w += this.glyph(ch)?.w ?? font.spaceWidth;
    return w;
  }

  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#fff'): number {
    const src = this.sheet(color);
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch of text) {
      const g = this.glyph(ch);
      if (!g) {
        cx += font.spaceWidth;
        continue;
      }
      ctx.drawImage(src, g.x, 0, g.w, font.rows, cx, cy, g.w, font.rows);
      cx += g.w;
    }
    return cx - x;
  }

  drawCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = '#fff'): void {
    this.draw(ctx, text, cx - this.measure(text) / 2, y, color);
  }

  /** Greedy word wrap to at most `maxLines` lines no wider than `width`. */
  wrap(text: string, width: number, maxLines = 2): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (this.measure(next) <= width || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = lines.slice(maxLines - 1).join(' ');
      return kept;
    }
    return lines;
  }
}
