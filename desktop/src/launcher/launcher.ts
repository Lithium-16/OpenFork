// The launcher window: Continue / New game / Load, settings, sharing and updates.

type Update =
  | { state: 'dev' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'offline' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string };

interface State {
  version: string;
  continue: string | null;
  fullscreen: boolean;
  update: Update;
  error: string | null;
}

interface LauncherApi {
  state(): Promise<State | null>;
  play(kind: 'new' | 'continue'): Promise<string | null>;
  load(): Promise<string | null>;
  fullscreen(on: boolean): void;
  share(): void;
  saves(): void;
  install(): void;
  minimize(): void;
  quit(): void;
  onUpdate(fn: (u: Update) => void): void;
  onRefresh(fn: () => void): void;
}

const api = (window as unknown as { launcher: LauncherApi }).launcher;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// The capital star from the map, as the logo.
const LOGO = ['....O....', '...OYO...', '...OYO...', 'OOOOYOOOO', 'OYYYYYYYO', '.OYYYYYO.', '..OYYYO..', '.OYYOYYO.', '.OYO.OYO.', '.OO...OO.'];
const logo = ($<HTMLCanvasElement>('logo').getContext('2d')) as CanvasRenderingContext2D;
LOGO.forEach((row, y) => {
  for (let x = 0; x < row.length; x++) {
    if (row[x] === '.') continue;
    logo.fillStyle = row[x] === 'Y' ? '#f1c232' : '#0b0f13';
    logo.fillRect(x, y, 1, 1);
  }
});

let noteTimer = 0;
function note(text: string, bad = false): void {
  const el = $('note');
  el.textContent = text && text[0].toUpperCase() + text.slice(1);
  el.classList.toggle('bad', bad);
  clearTimeout(noteTimer);
  if (text) noteTimer = window.setTimeout(() => (el.textContent = ''), 6000);
}

function showUpdate(u: Update): void {
  const text: Record<Update['state'], string> = {
    dev: 'Development build',
    checking: 'Checking for updates…',
    none: 'Up to date',
    offline: 'Offline · updates when you’re back online',
    downloading: u.state === 'downloading' ? `Downloading ${u.version}… ${u.percent}%` : '',
    ready: u.state === 'ready' ? `Version ${u.version} is ready` : '',
  };
  $('update').textContent = text[u.state];
  $('install').classList.toggle('hidden', u.state !== 'ready');
}

/** Buttons that start a game stay pressed once until the game window takes over. */
let busy = false;
async function act(fn: () => Promise<string | null>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const err = await fn();
    if (err) note(err, true);
  } finally {
    // The launcher hides once the game shows; let it be pressed again after that.
    setTimeout(() => (busy = false), 800);
  }
}

async function refresh(): Promise<void> {
  const s = await api.state();
  if (!s) return;
  $('version').textContent = `v${s.version}`;
  $<HTMLInputElement>('fullscreen').checked = s.fullscreen;
  const cont = $('continue');
  cont.classList.toggle('hidden', !s.continue);
  $('continue-label').textContent = s.continue ?? '';
  // The first button is the one to press: Continue when there's a game to go back to.
  $('new').classList.toggle('primary', !s.continue);
  (s.continue ? cont : $('new')).focus();
  showUpdate(s.update);
  note(s.error ?? '', !!s.error);
}

$('continue').onclick = () => void act(() => api.play('continue'));
$('new').onclick = () => void act(() => api.play('new'));
$('load').onclick = () => void act(() => api.load());
$<HTMLInputElement>('fullscreen').onchange = (e) => api.fullscreen((e.target as HTMLInputElement).checked);
$('saves').onclick = () => api.saves();
$('share').onclick = () => {
  api.share();
  note('Download link copied: send it to a friend');
};
$('install').onclick = () => api.install();
$('min').onclick = () => api.minimize();
$('close').onclick = () => api.quit();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.minimize();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

api.onUpdate(showUpdate);
api.onRefresh(() => void refresh());
void refresh();
