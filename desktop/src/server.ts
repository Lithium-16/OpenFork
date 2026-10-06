// The game server inside the desktop app: the same server as online, run in its own process
// (so the windows never wait on the game) and on this computer only. It keeps an autosave of
// the game being played, which the launcher's Continue opens.
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { startServer } from '../../server/serve.ts';

interface ParentPort {
  postMessage(msg: unknown): void;
  on(event: 'message', fn: (e: { data: unknown }) => void): void;
}
const parent = (process as unknown as { parentPort: ParentPort }).parentPort;
const [publicDir, autosavePath] = process.argv.slice(2);
/** How often the game being played is written to the autosave. */
const AUTOSAVE_MS = 15_000;

async function main(): Promise<void> {
  const served = await startServer({
    port: 0,
    host: '127.0.0.1',
    publicDir,
    // No network in between: a fresh picture every tick.
    snapshotEvery: 1,
    log: () => {},
  });

  /** Writes the game being played to the autosave (or removes it once the game is over). */
  const autosave = (): void => {
    try {
      const save = served.game.soloSave();
      if (save === 'over') rmSync(autosavePath, { force: true });
      else if (save) {
        // Write beside it and swap in, so a crash mid-write never leaves half a file.
        writeFileSync(autosavePath + '.tmp', JSON.stringify(save));
        renameSync(autosavePath + '.tmp', autosavePath);
      }
    } catch (e) {
      console.error('autosave failed', e);
    }
  };
  setInterval(autosave, AUTOSAVE_MS);
  parent.on('message', (e) => {
    const msg = e.data as { t?: string; id?: number };
    if (msg?.t === 'save') {
      autosave();
      parent.postMessage({ t: 'saved', id: msg.id });
    }
  });
  parent.postMessage({ t: 'ready', port: served.port });
}

main().catch((e) => {
  parent.postMessage({ t: 'failed', error: String(e?.stack ?? e) });
});
