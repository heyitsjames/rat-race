import fs from 'node:fs';
import { PNG } from 'pngjs';
import { defineConfig, type Plugin } from 'vite';

const ICON = 'public/assets/rat-race/images/icon-color.png';
const BACKGROUND = [0x1e, 0x4c, 0x05];

/**
 * Home-screen icons (apple-touch-icon.png, icon-192.png, icon-512.png): the module's
 * 32x32 icon scaled up with crisp pixels onto the grass colour. Made at build time
 * because the icon is original artwork, which stays out of git.
 */
function appIcons(): Plugin {
  return {
    name: 'app-icons',
    apply: 'build',
    generateBundle() {
      const src = PNG.sync.read(fs.readFileSync(ICON));
      for (const [fileName, size, scale] of [
        ['apple-touch-icon.png', 180, 5],
        ['icon-192.png', 192, 5],
        ['icon-512.png', 512, 14],
      ] as const) {
        const out = new PNG({ width: size, height: size });
        const pad = Math.floor((size - src.width * scale) / 2);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const sx = Math.floor((x - pad) / scale);
            const sy = Math.floor((y - pad) / scale);
            const inside = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height;
            const si = (sy * src.width + sx) * 4;
            const a = inside ? src.data[si + 3] / 255 : 0;
            const o = (y * size + x) * 4;
            for (let c = 0; c < 3; c++) out.data[o + c] = Math.round((inside ? src.data[si + c] : 0) * a + BACKGROUND[c] * (1 - a));
            out.data[o + 3] = 255;
          }
        }
        this.emitFile({ type: 'asset', fileName, source: PNG.sync.write(out) });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [appIcons()],
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 1000 },
  test: { environment: 'node' },
} as never);
