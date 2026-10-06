// Standalone server: serves the client from public/ and the game over a WebSocket at /ws
// (see server/serve.ts). All game logic lives in server/core.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.ts';

const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

await buildClient();
await startServer({ port: PORT, host: HOST, publicDir: PUBLIC_DIR });
console.log(`OpenFork on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);

/**
 * Bundles the browser game (client/ → public/app.js) on every start, so a server started any
 * way at all (not only `npm start`) never serves a page older than its own code. Without
 * esbuild installed, it says loudly if the bundle is missing or older than the sources.
 */
async function buildClient(): Promise<void> {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const out = join(PUBLIC_DIR, 'app.js');
  try {
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [join(root, 'client', 'main.ts')],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      sourcemap: true,
      outfile: out,
      logLevel: 'warning',
    });
    console.log('Built the client (public/app.js)');
  } catch (err) {
    const newest = (dir: string): number =>
      Math.max(0, ...readdirSync(join(root, dir)).filter((f) => f.endsWith('.ts')).map((f) => statSync(join(root, dir, f)).mtimeMs));
    let built = 0;
    try {
      built = statSync(out).mtimeMs;
    } catch {
      // no bundle at all
    }
    const stale = built < Math.max(newest('client'), newest('shared'));
    const why = err instanceof Error ? err.message : String(err);
    if (stale) console.error(`!! public/app.js is ${built ? 'older than the code' : 'missing'} and couldn't be built (${why}). Run \`npm install\`, then restart, or run \`npm run build\`.`);
    else console.warn(`Couldn't build the client (${why}); serving the existing public/app.js, which is up to date.`);
  }
}
