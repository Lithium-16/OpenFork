// Builds the desktop app into dist/: the game page (client bundle + public/ files), the game
// server, the Electron main process, the preloads and the launcher.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// esbuild comes from the game's own dependencies (npm install at the repo root).
const esbuild = createRequire(join(root, 'package.json'))('esbuild');
const dist = join(here, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = { bundle: true, logLevel: 'warning', legalComments: 'none' };

// The game page: everything in public/ but the online build of the client, then this one.
cpSync(join(root, 'public'), join(dist, 'public'), {
  recursive: true,
  filter: (src) => !/app\.js(\.map)?$/.test(src),
});
await esbuild.build({
  ...common,
  entryPoints: [join(root, 'client', 'main.ts')],
  format: 'esm',
  target: 'chrome130',
  minify: true,
  outfile: join(dist, 'public', 'app.js'),
});

// The game server and the main process (Node inside Electron).
const node = { ...common, platform: 'node', target: 'node20', format: 'cjs' };
await esbuild.build({
  ...node,
  entryPoints: [join(here, 'src', 'server.ts')],
  outfile: join(dist, 'server.cjs'),
  // ws can use these native helpers when installed; it works fine without them.
  external: ['bufferutil', 'utf-8-validate'],
});
await esbuild.build({
  ...node,
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(dist, 'main.cjs'),
  external: ['electron', 'electron-updater'],
});
for (const name of ['preload-game', 'preload-launcher']) {
  await esbuild.build({ ...node, entryPoints: [join(here, 'src', `${name}.ts`)], outfile: join(dist, `${name}.cjs`), external: ['electron'] });
}

// The launcher: its page, styles, script and the game's font.
const launcher = join(dist, 'launcher');
cpSync(join(here, 'src', 'launcher', 'index.html'), join(launcher, 'index.html'));
cpSync(join(here, 'src', 'launcher', 'launcher.css'), join(launcher, 'launcher.css'));
for (const f of ['pixelify-sans-latin-400-normal.woff2', 'pixelify-sans-latin-700-normal.woff2', 'OFL.txt']) {
  cpSync(join(root, 'public', 'fonts', f), join(launcher, 'fonts', f));
}
await esbuild.build({
  ...common,
  entryPoints: [join(here, 'src', 'launcher', 'launcher.ts')],
  format: 'iife',
  target: 'chrome130',
  minify: true,
  outfile: join(launcher, 'launcher.js'),
});

console.log('Built the desktop app into desktop/dist');
