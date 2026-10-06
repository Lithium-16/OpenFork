// Draws the app icon (desktop/build/icon.png, 256×256): the capital star from the map, on the
// game's dark panel. Run once after changing it: node desktop/make-icon.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { PNG } = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))('pngjs');
const STAR = ['....O....', '...OYO...', '...OYO...', 'OOOOYOOOO', 'OYYYYYYYO', '.OYYYYYO.', '..OYYYO..', '.OYYOYYO.', '.OYO.OYO.', '.OO...OO.'];
const COLORS = { O: [11, 15, 19], Y: [241, 194, 50] };
const SIZE = 256;
const SCALE = 20;
const png = new PNG({ width: SIZE, height: SIZE });
const set = (x, y, [r, g, b]) => {
  const i = (y * SIZE + x) * 4;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = 255;
};
// Panel with a cyan frame (the game's accent), 8 px.
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
  set(x, y, edge < 8 ? [79, 209, 255] : edge < 16 ? [11, 15, 19] : [22, 28, 34]);
}
const w = STAR[0].length * SCALE;
const h = STAR.length * SCALE;
const ox = Math.floor((SIZE - w) / 2);
const oy = Math.floor((SIZE - h) / 2) - 4;
STAR.forEach((row, ty) => {
  for (let tx = 0; tx < row.length; tx++) {
    const c = COLORS[row[tx]];
    if (!c) continue;
    for (let y = 0; y < SCALE; y++) for (let x = 0; x < SCALE; x++) set(ox + tx * SCALE + x, oy + ty * SCALE + y, c);
  }
});
writeFileSync(fileURLToPath(new URL('build/icon.png', import.meta.url)), PNG.sync.write(png));
console.log('wrote desktop/build/icon.png');
