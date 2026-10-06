// The desktop app: a small launcher window, the game in its own window, and the game server
// running on this computer (desktop/src/server.ts), so no internet is needed to play. Updates
// come from the repo's GitHub releases (built by .github/workflows/desktop.yml).
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, utilityProcess, type UtilityProcess } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

/** Where a friend downloads the game (always the newest installer). */
const SHARE_LINK = 'https://github.com/Lithium-16/OpenFork/releases/latest/download/OpenFork-Setup.exe';
/** The biggest save file opened (the server refuses bigger ones anyway). */
const MAX_SAVE_BYTES = 2_000_000;
const BACKGROUND = '#101418';

if (!app.requestSingleInstanceLock()) app.exit(0);
Menu.setApplicationMenu(null);

const DIST = __dirname;
const publicDir = app.isPackaged ? join(process.resourcesPath, 'public') : join(DIST, 'public');
const autosavePath = join(app.getPath('userData'), 'autosave.json');
const settingsPath = join(app.getPath('userData'), 'settings.json');
const savesDir = join(app.getPath('documents'), 'OpenFork');

// -- settings ---------------------------------------------------------------------------------

interface Settings {
  fullscreen: boolean;
}
let settings: Settings = { fullscreen: false };
try {
  settings = { ...settings, ...JSON.parse(readFileSync(settingsPath, 'utf8')) };
} catch {
  // first run
}
function saveSettings(): void {
  try {
    writeFileSync(settingsPath, JSON.stringify(settings));
  } catch {
    // not worth bothering anyone over
  }
}

// -- the game server --------------------------------------------------------------------------

let server: UtilityProcess | null = null;
let port = 0;
let quitting = false;
let nextSaveId = 1;
/** Server restarts after it stopped on its own (a few at most, so a broken install can't loop). */
let restarts = 0;
const saveWaits = new Map<number, () => void>();

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(join(DIST, 'server.cjs'), [publicDir, autosavePath], { serviceName: 'OpenFork game', stdio: 'inherit' });
    server = child;
    child.on('message', (m: { t: string; port?: number; error?: string; id?: number }) => {
      if (m.t === 'ready') resolve(m.port as number);
      else if (m.t === 'failed') reject(new Error(m.error));
      else if (m.t === 'saved') saveWaits.get(m.id as number)?.();
    });
    child.on('exit', () => {
      if (server !== child || quitting) return;
      server = null;
      for (const done of saveWaits.values()) done();
      // Shouldn't happen; if it does, the game goes back to the launcher (the autosave
      // keeps the game) and a fresh server starts.
      if (gameWin) {
        lastError = 'The game stopped unexpectedly. Continue picks up from the last autosave.';
        gameWin.destroy();
      }
      if (++restarts > 3) {
        dialog.showErrorBox('OpenFork', 'The game keeps stopping. Try reinstalling it.');
        app.exit(1);
        return;
      }
      startServer().then(
        (p) => (port = p),
        () => app.exit(1),
      );
    });
  });
}

/** Has the server write the autosave now (the game being played, before it's left). */
function flushSave(): Promise<void> {
  if (!server) return Promise.resolve();
  const id = nextSaveId++;
  return new Promise((resolve) => {
    const done = () => {
      saveWaits.delete(id);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2000);
    saveWaits.set(id, done);
    server?.postMessage({ t: 'save', id });
  });
}

/** What Continue opens: the autosave's country and time played, or null when there's none. */
function continueLabel(): string | null {
  try {
    if (statSync(autosavePath).size > MAX_SAVE_BYTES) return null;
    const save = JSON.parse(readFileSync(autosavePath, 'utf8'));
    const code = save.players?.[save.human]?.country;
    const minutes = Math.floor((save.sim?.time ?? 0) / 60);
    return `${countryName(save.map, code)} · ${minutes} min`;
  } catch {
    return null;
  }
}

const countryNames = new Map<string, Map<string, string>>();
function countryName(map: string, code: string): string {
  if (!countryNames.has(map)) {
    try {
      const data = JSON.parse(readFileSync(join(publicDir, 'maps', `${map}.json`), 'utf8'));
      countryNames.set(map, new Map(data.countries.map((c: { id: string; name: string }) => [c.id, c.name])));
    } catch {
      countryNames.set(map, new Map());
    }
  }
  return countryNames.get(map)?.get(code) ?? code;
}

// -- windows ----------------------------------------------------------------------------------

let launcher: BrowserWindow | null = null;
let gameWin: BrowserWindow | null = null;
/** A save to open when the game window asks (Continue, or a file picked in the launcher). */
let pendingLoad: string | null = null;
/** Something to tell the person when the launcher shows again. */
let lastError: string | null = null;

function createLauncher(): void {
  launcher = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    title: 'OpenFork',
    backgroundColor: BACKGROUND,
    webPreferences: { preload: join(DIST, 'preload-launcher.cjs'), sandbox: true, contextIsolation: true, spellcheck: false },
  });
  lockDown(launcher);
  void launcher.loadFile(join(DIST, 'launcher', 'index.html'));
  launcher.once('ready-to-show', () => launcher?.show());
  launcher.on('closed', () => {
    launcher = null;
    if (!gameWin) app.quit();
  });
}

function showLauncher(): void {
  if (!launcher) return createLauncher();
  launcher.webContents.send('launcher:refresh');
  launcher.show();
  launcher.focus();
}

function openGame(load: string | null): void {
  if (gameWin || !port) return;
  pendingLoad = load;
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'OpenFork',
    backgroundColor: BACKGROUND,
    fullscreen: settings.fullscreen,
    // No spellchecker: it would download dictionaries, and there's nothing to spell here.
    webPreferences: { preload: join(DIST, 'preload-game.cjs'), sandbox: true, contextIsolation: true, spellcheck: false },
  });
  gameWin = win;
  lockDown(win, `http://127.0.0.1:${port}`);
  void win.loadURL(`http://127.0.0.1:${port}/`);
  win.once('ready-to-show', () => {
    if (!settings.fullscreen) win.maximize();
    win.show();
    launcher?.hide();
  });
  // F11 or Alt+Enter: fullscreen on and off (remembered for next time).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      e.preventDefault();
      settings.fullscreen = !win.isFullScreen();
      win.setFullScreen(settings.fullscreen);
      saveSettings();
    }
  });
  // Closing the window keeps the game (autosaved first) and goes back to the launcher.
  let closing = false;
  win.on('close', (e) => {
    if (closing || quitting) return;
    e.preventDefault();
    closing = true;
    void flushSave().finally(() => win.destroy());
  });
  win.on('closed', () => {
    if (gameWin === win) gameWin = null;
    pendingLoad = null;
    if (!quitting) showLauncher();
  });
}

/** No navigating away and no pop-ups; web links open in the browser. */
function lockDown(win: BrowserWindow, origin?: string): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (origin && url.startsWith(origin + '/')) return;
    e.preventDefault();
  });
}

function focusApp(): void {
  const win = gameWin ?? launcher;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// -- updates ----------------------------------------------------------------------------------

type Update =
  | { state: 'dev' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'offline' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string };
let update: Update = { state: app.isPackaged ? 'checking' : 'dev' };
function setUpdate(u: Update): void {
  update = u;
  launcher?.webContents.send('launcher:update', u);
}

function startUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let version = '';
  autoUpdater.on('checking-for-update', () => {
    if (update.state !== 'downloading' && update.state !== 'ready') setUpdate({ state: 'checking' });
  });
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'none' }));
  autoUpdater.on('update-available', (info) => {
    version = info.version;
    setUpdate({ state: 'downloading', version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', version, percent: Math.floor(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setUpdate({ state: 'ready', version: info.version }));
  // No internet (or GitHub unreachable): play on, and look again later.
  autoUpdater.on('error', () => {
    if (update.state !== 'ready') setUpdate({ state: 'offline' });
  });
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 60 * 60 * 1000);
}

// -- messages from the windows ----------------------------------------------------------------

function fromGame(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return !!gameWin && e.sender === gameWin.webContents;
}
function fromLauncher(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return !!launcher && e.sender === launcher.webContents;
}

function playerName(): string {
  try {
    const name = userInfo().username.trim().slice(0, 24);
    if (name) return name;
  } catch {
    // no user name to be had
  }
  return 'Commander';
}

ipcMain.handle('game:start', (e) => {
  if (!fromGame(e)) return null;
  const load = pendingLoad;
  pendingLoad = null;
  return { name: playerName(), load };
});
ipcMain.handle('game:flush', (e) => (fromGame(e) ? flushSave() : undefined));
ipcMain.on('game:launcher', (e, error: unknown) => {
  if (!fromGame(e)) return;
  if (typeof error === 'string') lastError = error.slice(0, 200);
  gameWin?.close();
});
ipcMain.handle('game:save-file', async (e, name: unknown, data: unknown) => {
  if (!fromGame(e) || !gameWin || typeof name !== 'string' || typeof data !== 'string') return null;
  mkdirSync(savesDir, { recursive: true });
  const safe = name.replace(/[^\w.-]/g, '_');
  const r = await dialog.showSaveDialog(gameWin, {
    title: 'Save game',
    defaultPath: join(savesDir, safe),
    filters: [{ name: 'OpenFork save', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, data);
  return r.filePath;
});

ipcMain.handle('launcher:state', (e) => {
  if (!fromLauncher(e)) return null;
  const error = lastError;
  lastError = null;
  return { version: app.getVersion(), continue: continueLabel(), fullscreen: settings.fullscreen, update, error };
});
ipcMain.handle('launcher:play', (e, kind: unknown) => {
  if (!fromLauncher(e)) return 'nope';
  if (kind === 'continue') {
    const label = continueLabel();
    if (!label) return 'There is no game to continue.';
    openGame(readFileSync(autosavePath, 'utf8'));
  } else openGame(null);
  return null;
});
ipcMain.handle('launcher:load', async (e) => {
  if (!fromLauncher(e) || !launcher) return null;
  mkdirSync(savesDir, { recursive: true });
  const r = await dialog.showOpenDialog(launcher, {
    title: 'Load a saved game',
    defaultPath: savesDir,
    properties: ['openFile'],
    filters: [{ name: 'OpenFork save', extensions: ['json'] }],
  });
  const file = r.filePaths[0];
  if (r.canceled || !file) return null;
  if (statSync(file).size > MAX_SAVE_BYTES) return 'That file is too big to be a save.';
  openGame(readFileSync(file, 'utf8'));
  return null;
});
ipcMain.on('launcher:fullscreen', (e, on: unknown) => {
  if (!fromLauncher(e)) return;
  settings.fullscreen = on === true;
  saveSettings();
});
ipcMain.on('launcher:share', (e) => {
  if (fromLauncher(e)) clipboard.writeText(SHARE_LINK);
});
ipcMain.on('launcher:saves', (e) => {
  if (!fromLauncher(e)) return;
  mkdirSync(savesDir, { recursive: true });
  void shell.openPath(savesDir);
});
ipcMain.on('launcher:install', (e) => {
  if (!fromLauncher(e) || update.state !== 'ready') return;
  quitting = true;
  autoUpdater.quitAndInstall(true, true);
});
ipcMain.on('launcher:minimize', (e) => {
  if (fromLauncher(e)) launcher?.minimize();
});
ipcMain.on('launcher:quit', (e) => {
  if (fromLauncher(e)) app.quit();
});

// -- start and stop ---------------------------------------------------------------------------

app.on('second-instance', focusApp);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  server?.kill();
});

void app.whenReady().then(async () => {
  try {
    port = await startServer();
  } catch (e) {
    dialog.showErrorBox('OpenFork', `The game couldn't start.\n\n${e instanceof Error ? e.message : e}`);
    app.exit(1);
    return;
  }
  createLauncher();
  startUpdates();
});
