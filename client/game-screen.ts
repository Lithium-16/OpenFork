// The game: map view, mouse and keyboard orders, and the HUD panels.
import type { GameMap, Region } from '../shared/map.ts';
import type { BlobRow, GameEvent, GamePlayer, Order, ProductionView, Snapshot } from '../shared/protocol.ts';
import { BUILDING_INDEX, UNIT_INDEX } from '../shared/protocol.ts';
import {
  BASE_RESEARCH,
  BATTERY_LANDING_BONUS,
  BUILD_NEEDS,
  BUILD_QUEUE,
  type BuildingKind,
  buildCost,
  canBuildOn,
  captureSeconds,
  DISBAND_REFUND,
  ECON_KINDS,
  type EconKind,
  econYield,
  FOUND_CITY_MIN_HOPS,
  HINTERLAND_HOPS,
  MAX_CITY,
  MAX_FORT,
  regionYield,
  RESOURCES,
  type Resources,
  slotsOf,
  stackCap,
  supplyCapacity,
  supplyReach,
  STORE_PER_CITY_LEVEL,
  STORE_PER_DEPOT,
  storeOf,
  type Tech,
  TECH_ROOT,
  type TechId,
  TECHS,
  techCost,
  SEA_SUPPLY_HOPS,
  UNITS,
  type UnitType,
  unitStats,
  unitsOf,
  UNIT_TECH,
  whyNotResearch,
} from '../shared/rules.ts';
import { FrameMeter } from './fx.ts';
import { colorOf, MapView } from './map-view.ts';
import { Sfx } from './sfx.ts';
import type { Net } from './net.ts';
import { hudIcon, ICONS, spriteUrl } from './sprites.ts';
import { $, cellBar, classbar, confirmBox, el, fmt, toast } from './ui.ts';

const BUILD_LABEL: Record<BuildingKind, string> = {
  farm: 'Farm',
  mine: 'Mine',
  well: 'Oil well',
  market: 'Market',
  city: 'City',
  fort: 'Fort',
  barracks: 'Barracks',
  factory: 'Factory',
  road: 'Road',
  depot: 'Depot',
  lab: 'Lab',
  port: 'Port',
  battery: 'Coast guns',
};
/** The build bar's tabs; in the open one, keys 1-9 pick its buildings in this order. */
const TABS: Array<{ name: string; kinds: BuildingKind[] }> = [
  { name: 'Economy', kinds: ['farm', 'mine', 'well', 'market', 'lab', 'city', 'depot', 'road'] },
  { name: 'Military', kinds: ['fort', 'barracks', 'factory'] },
  { name: 'Naval', kinds: ['port', 'battery'] },
];
/** Region row fields of the economic buildings. */
const ECON_FIELD: Record<EconKind, number> = { farm: 9, mine: 10, well: 11, market: 12, lab: 14 };
const tech = (id: TechId): Tech => TECHS.find((t) => t.id === id) as Tech;
const UNIT_NAME: Record<UnitType, string> = { infantry: 'Infantry', tank: 'Tanks', artillery: 'Artillery', warship: 'Warships' };
/** The key that orders each unit at the selected region. */
const UNIT_KEY: Record<UnitType, string> = { infantry: 'q', tank: 'e', artillery: 'r', warship: 'f' };
/** A region with no traits or city, for the plain yield of a building. */
const PLAIN_REGION = { traits: [], terrain: 'plains', size: 'medium' } as unknown as Region;
const gives = (kind: EconKind, traits: Region['traits'] = [], city = 0) =>
  Object.values(econYield(kind, { ...PLAIN_REGION, traits }, city))[0] ?? 0;
/** What each building does, shown in the build bar. */
const BUILD_HELP: Record<BuildingKind, string> = {
  farm: `Farm: +${gives('farm')} manpower/s (+${gives('farm', ['farmland'])} on farmland). Farmland or plains, within ${HINTERLAND_HOPS} regions of your city.`,
  mine: `Mine: +${gives('mine')} steel/s (+${gives('mine', ['industry'])} on industry). Industry, hills or mountains, within ${HINTERLAND_HOPS} regions of your city.`,
  well: `Oil well: +${gives('well')} oil/s. Oil fields only, within ${HINTERLAND_HOPS} regions of your city.`,
  market: `Market: +${gives('market')} money/s (+${gives('market', [], 1)} in a city). Anywhere within ${HINTERLAND_HOPS} regions of your city.`,
  city: `City: found one (a supply hub that pays tax) or expand one: more tax and manpower, a slot, +1 stack cap, supply reaches further.`,
  fort: `Fort: defenders get a bonus, enemies move and capture slower here. Up to ${MAX_FORT} levels.`,
  barracks: 'Barracks: trains infantry (Q). In a city.',
  factory: 'Factory: builds tanks (E) and artillery (R). In a city.',
  port: 'Port: builds warships (F); your troops board here to cross the sea, and ships mend and resupply here. On a coast.',
  battery: `Coastal battery: shells enemy ships and troops at sea off this coast, and defenders get +${BATTERY_LANDING_BONUS * 100}% against landings. On a coast.`,
  road: 'Road: drag across your regions. Crossing is faster and supply reaches further.',
  lab: `Lab: +${gives('lab')} research points/s for the tech tree (without labs a country makes ${BASE_RESEARCH}/s). In a city.`,
  depot: `Depot: stores ${STORE_PER_DEPOT.money} more money and manpower, ${STORE_PER_DEPOT.steel} more steel and oil (cities store ${STORE_PER_CITY_LEVEL.money} / ${STORE_PER_CITY_LEVEL.steel} per level). Anywhere you own; if it's taken, the enemy takes its share of your stock.`,
};

export class GameScreen {
  private readonly net: Net;
  private readonly map: GameMap;
  private readonly view: MapView;
  private readonly you: number | null;
  private readonly players: GamePlayer[];
  private readonly onBack: () => void;
  private snap: Snapshot | null = null;
  private selected = new Set<number>();
  private region = -1;
  /** Placement mode: the building a click on one of your regions puts there. */
  private placing: BuildingKind | null = null;
  /** The region under the cursor. */
  private hover = -1;
  private buildbarKey = '';
  /** The build bar's open tab. */
  private tab = 0;
  private researchOpen = false;
  private researchKey = '';
  /** Where the building being placed can go: worked out once per snapshot. */
  private valid: { snap: Snapshot; kind: BuildingKind; set: Set<number> } | null = null;
  /** The country in the list whose actions are open. */
  private openCountry: number | null = null;
  /** The region panel's Details fold is open. */
  private detailsOpen = false;
  private slotCache: { snap: Snapshot; map: Map<number, [number, number]> } | null = null;
  private attackedCache: { snap: Snapshot; set: Set<number> } | null = null;
  private miniSnap: Snapshot | null = null;
  private miniCam = '';
  private miniAt = 0;
  /** Road tool: the regions dragged across so far. */
  private roadPath: number[] | null = null;
  private box: [number, number, number, number] | null = null;
  private feed: Array<{ time: string; text: string; group?: string; items: string[] }> = [];
  /** Game time each region last got a supply warning. */
  private readonly supplyWarned = new Map<number, number>();
  private raf = 0;
  private keys = new Set<string>();
  private readonly cleanup: Array<() => void> = [];
  private centred = false;
  finished = false;
  /** A HUD button is held down (since when): its panel waits to be redrawn. */
  private pressing = false;
  private pressedAt = 0;
  /** Repeat toggles clicked, shown at once until the server agrees (or 2 s pass). */
  private readonly repeatAsked = new Map<string, { on: boolean; until: number }>();
  private readonly minimap: HTMLCanvasElement;
  private readonly sfx = new Sfx();
  private readonly meter = new FrameMeter();
  /** The player picked full effects themselves: don't reduce them automatically again. */
  private fxChosen = false;

  constructor(net: Net, map: GameMap, terrain: HTMLImageElement, you: number | null, players: GamePlayer[], onBack: () => void) {
    this.net = net;
    this.map = map;
    this.you = you;
    this.players = players;
    this.onBack = onBack;
    this.view = new MapView($('#map') as HTMLCanvasElement, map, terrain);
    this.minimap = $('#minimap') as HTMLCanvasElement;
    this.view.sounds = { gun: (v) => this.sfx.gun(v), boom: (v) => this.sfx.boom(v) };
    this.minimap.width = 240;
    this.minimap.height = Math.round((240 * map.height) / map.width);
    this.setOverlay(false);
    $('#over').classList.add('hidden');
    $('#panel').classList.add('hidden');
    $('#feed').replaceChildren();
    $('#feed').classList.add('hidden');
    $('#over-back').onclick = () => this.onBack();
    $('#over-menu').onclick = () => this.leave();
    $('#menu').classList.add('hidden');
    $('#menu-resume').onclick = () => this.toggleMenu(false);
    $('#menu-surrender').onclick = () => void this.surrender();
    $('#menu-leave').onclick = () => void this.leaveAsked();
    // UI size: one scale for every box on the map, remembered on this browser.
    this.setUiScale(Number(stored(UI_SCALE)) || 1);
    for (const b of document.querySelectorAll<HTMLButtonElement>('#menu-scale button')) {
      b.onclick = () => this.setUiScale(Number(b.dataset.scale));
    }
    // The system asks for less motion: start with effects reduced (the FX button still works).
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.view.fx.level = 'reduced';
      this.fxChosen = true;
    }
  }

  /** Sets the UI size; sizes that would leave the HUD less than 1150×600 to lay out on are
   * off (and a remembered one falls back) until the window is big enough. */
  private setUiScale(want: number, remember = true): void {
    const fits = (s: number) => s === 1 || (window.innerWidth / s >= 1150 && window.innerHeight / s >= 600);
    const scale = fits(want) ? want : [1.5, 1.25, 1].find(fits) ?? 1;
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    for (const b of document.querySelectorAll<HTMLButtonElement>('#menu-scale button')) {
      const s = Number(b.dataset.scale);
      b.classList.toggle('on', s === scale);
      b.setAttribute('aria-pressed', String(s === scale));
      b.disabled = !fits(s);
    }
    if (remember) store(UI_SCALE, String(want));
  }

  /** The only person in the game (the rest are bots): it can be paused. */
  private get solo(): boolean {
    return this.you !== null && this.players.filter((p) => p.human).length === 1;
  }

  /** The menu paused the game (and resumes it when it closes). */
  private menuPaused = false;

  /** Still in the game: alive, and it isn't over. */
  private get playing(): boolean {
    return !this.finished && this.you !== null && !!this.snap?.players[this.you]?.alive;
  }

  private toggleMenu(open = $('#menu').classList.contains('hidden')): void {
    $('#menu').classList.toggle('hidden', !open);
    // Alone in the game: the menu stops the clock while it's open.
    if (this.solo && this.playing) {
      if (open && !this.snap?.paused) {
        this.menuPaused = true;
        this.send({ o: 'pause', on: true });
      } else if (!open && this.menuPaused) {
        this.menuPaused = false;
        this.send({ o: 'pause', on: false });
      }
    }
    if (!open) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    $('#menu-resume').focus();
    const id = this.you !== null ? this.players[this.you]?.country : '';
    const country = this.map.countries.find((c) => c.id === id)?.name ?? 'your country';
    ($('#menu-surrender') as HTMLButtonElement).classList.toggle('hidden', !this.playing);
    $('#menu-note').textContent = this.playing
      ? `Leaving hands ${country} to a bot, which plays on. Surrendering ends ${country}: its land goes neutral and its units disband, and you watch the rest.`
      : 'You are watching. Leaving takes you back to the main menu.';
  }

  private async surrender(): Promise<void> {
    this.toggleMenu(false);
    if (!this.playing) return;
    const ok = await confirmBox('Surrender', 'Give up? Your land goes neutral and your units disband, as if your capital fell. You can watch the rest of the game.', 'Surrender');
    if (ok) this.send({ o: 'surrender' });
  }

  private async leaveAsked(): Promise<void> {
    this.toggleMenu(false);
    if (this.playing) {
      const ok = await confirmBox('Leave the game', 'Back to the main menu? A bot takes over your country and plays on.', 'Leave');
      if (!ok) return;
    }
    this.leave();
  }

  /** Back to the main menu: leaves the lobby (the server answers with no lobby). */
  private leave(): void {
    this.leaving = true;
    this.net.send({ t: 'lobby.leave' });
  }

  /** The player chose to leave (so the lobby going away is no surprise). */
  leaving = false;

  /** The same game as a fresh start message describes (a reconnect, not a new match). */
  sameGame(map: string, you: number | null, players: GamePlayer[]): boolean {
    return !this.finished && this.map.id === map && this.you === you && JSON.stringify(this.players) === JSON.stringify(players);
  }

  start(): void {
    // A small handle for automated browser tests and the console.
    (window as unknown as { openfork: unknown }).openfork = {
      you: this.you,
      snap: () => this.snap,
      unitAt: (id: number) => this.view.screenOfUnit(id),
      items: () => this.view.drawnItems(),
      artOffLand: () => this.view.artOffLand(),
      screenOf: (region: number) => {
        const r = this.map.regions[region];
        return this.view.toScreen(r.x, r.y);
      },
      focus: (region: number) => {
        const r = this.map.regions[region];
        this.view.focus(r.x, r.y, 1.3);
      },
    };
    this.view.resize();
    this.view.fit();
    this.bindInput();
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      this.panWithKeys();
      // A struggling machine: drop the ambient effects (once, unless the player chose them).
      if (this.meter.tick(performance.now()) && this.view.fx.level === 'full' && !this.fxChosen) {
        this.setEffects('reduced');
        toast('Effects reduced to keep the game smooth (change it in the menu)', 'info');
      }
      if (this.snap) {
        this.view.placement = this.placing ? { valid: this.validFor(this.placing), hover: this.hover } : null;
        this.view.slots = this.placing || this.view.yields ? this.slotMap() : null;
        this.view.draw(this.snap, this.players, this.you, this.selected, this.region, this.box);
        // The minimap: on news or a camera move, at most 5 times a second.
        const cam = `${this.view.cam.x}|${this.view.cam.y}|${this.view.cam.scale}`;
        const now = performance.now();
        if ((this.snap !== this.miniSnap || cam !== this.miniCam) && now - this.miniAt > 200) {
          this.view.drawMinimap(this.minimap, this.snap);
          this.miniSnap = this.snap;
          this.miniCam = cam;
          this.miniAt = now;
        }
      }
    };
    frame();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanup) c();
    this.sfx.close();
    delete (window as unknown as { openfork?: unknown }).openfork;
  }

  private send(order: Order): void {
    this.net.send({ t: 'order', order });
  }

  // -- server updates -----------------------------------------------------------------------

  onSnapshot(snap: Snapshot): void {
    if (this.snap) this.view.noteLosses(this.snap, snap);
    this.snap = snap;
    this.warnSupply(snap);
    // Stand-ins for orders on their way: gone once the server's routes show, or after half a second.
    const p = this.view.pending;
    const routed = new Set(snap.routes.map((r) => r[0]));
    if (p.move && (p.move.ids.some((id) => routed.has(id)) || snap.time > p.move.since + 0.5)) p.move = null;
    p.builds = p.builds.filter((b) => snap.time <= b.since + 0.5);
    const alive = new Set(snap.blobs.map((b) => b[0]));
    for (const id of this.selected) if (!alive.has(id)) this.selected.delete(id);
    if (!this.centred && this.you !== null) {
      this.centred = true;
      this.centreOnCapital();
    }
    for (const e of snap.events) this.addEvent(e);
    // A press held for long (or lost, say the pointer left the window) stops holding things up.
    if (this.pressing && performance.now() - this.pressedAt > 1000) this.pressing = false;
    if (!this.pressing) this.renderTopbar();
    this.renderPlayers();
    this.renderOffers();
    if (!this.pressing) this.renderPanel();
    this.renderBuildbar();
    if (!this.pressing) this.renderResearch();
  }

  /** Your techs (none when watching). */
  private myTechs(): TechId[] {
    return this.you === null ? [] : (this.snap?.players[this.you]?.techs ?? []);
  }

  /** Someone's techs, for numbers about their regions (none for neutral land). */
  private techsOf(owner: number): TechId[] {
    return owner >= 0 ? (this.snap?.players[owner]?.techs ?? []) : [];
  }

  private setResearchOpen(open: boolean): void {
    this.researchOpen = open && this.playing;
    this.researchKey = '';
    $('#research').classList.toggle('hidden', !this.researchOpen);
    this.renderResearch();
    this.renderTopbar();
  }

  /**
   * The research screen: the tech tree as nodes in a column per branch, tier by tier, joined
   * by lines from each tech to the ones it unlocks (green once researched). The tech under
   * way fills up as it goes; the header shows how far along the whole tree is.
   */
  private renderResearch(): void {
    const box = $('#research');
    const snap = this.snap;
    if (!this.researchOpen || !snap || this.you === null) return;
    const me = snap.players[this.you];
    const res = this.resources();
    const key = JSON.stringify([me.techs, me.research, RESOURCES.map((k) => Math.floor(res[k] / 10))]);
    if (key === this.researchKey) return;
    this.researchKey = key;

    const busy = me.research;
    const state = (id: TechId) =>
      me.techs.includes(id) ? 'done' : busy?.[0] === id ? 'active' : whyNotResearch(id, me.techs) ? 'locked' : busy ? 'wait' : 'open';
    // Layout: a tree growing down from the root, each parent centred over its children,
    // leaves side by side, a row per depth. In CSS pixels.
    const W = 150;
    const H = 104;
    const GX = 20;
    const GY = 58;
    const kids = (id: TechId | null) => TECHS.filter((t) => (t.needs[0] ?? null) === id);
    const centre = new Map<TechId | 'root', number>();
    let leaf = 0;
    const place = (id: TechId | null): number => {
      const xs = kids(id).map((c) => place(c.id));
      const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : leaf++ * (W + GX) + W / 2;
      centre.set(id ?? 'root', x);
      return x;
    };
    place(null);
    const depth = Math.max(...TECHS.map((t) => t.tier));
    const width = leaf * (W + GX) - GX;
    const height = (depth + 1) * (H + GY) - GY;
    const at = (id: TechId | 'root', tier: number) => ({ x: (centre.get(id) as number) - W / 2, y: tier * (H + GY) });

    // Lines, org-chart style: down from the parent, across under it, down into each child.
    const paths: string[] = [];
    for (const t of TECHS) {
      const parent = t.needs[0] ?? null;
      const a = at(parent ?? 'root', t.tier - 1);
      const b = at(t.id, t.tier);
      const parentDone = parent === null || me.techs.includes(parent);
      const st = state(t.id);
      const cls = !parentDone ? 'off' : st === 'done' ? 'done' : st === 'active' ? 'live' : 'ready';
      const mid = a.y + H + GY / 2;
      paths.push(`<path class="${cls}" d="M${a.x + W / 2},${a.y + H} V${mid} H${b.x + W / 2} V${b.y}"/>`);
    }
    // Lit lines last, so they sit on top where lines share a stretch.
    const rank = (p: string) => ['off', 'ready', 'live', 'done'].findIndex((c) => p.includes(`"${c}"`));
    paths.sort((x, y) => rank(x) - rank(y));
    const svg = el('div', { class: 'wires' });
    svg.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join('')}</svg>`;

    const box2 = (x: number, y: number) => `left:${x}px;top:${y}px;width:${W}px;height:${H}px`;
    const r = at('root', 0);
    const root = el('div', { class: 'node root done', style: box2(r.x, r.y) }, [el('b', {}, [TECH_ROOT.name]), el('span', { class: 'effect' }, [TECH_ROOT.effect]), el('span', { class: 'foot' }, ['Start'])]);
    // How long a tech takes from here: research points still owed, less the stock, over
    // what labs and cities make.
    const rate = me.income[4];
    const eta = (owed: number) => {
      const left = owed - res.research;
      if (left <= 0) return 'ready now';
      return rate > 0 ? `~${Math.ceil(left / rate)} s` : 'build labs';
    };
    const nodes = TECHS.map((t) => {
      const st = state(t.id);
      const cost = techCost(t.tier);
      const p = at(t.id, t.tier);
      const foot: Array<Node | string> =
        st === 'done'
          ? ['Researched']
          : st === 'active' && busy
            ? [`${Math.round(busy[1] * 100)}% · ${eta(cost * (1 - busy[1]))}`]
            : st === 'locked'
              ? [whyNotResearch(t.id, me.techs) ?? '']
              : [costChips({ research: cost }, res), ` · ${eta(cost)}`];
      return el('div', { class: `node ${st} b-${t.branch.toLowerCase()}`, style: box2(p.x, p.y), ...(st === 'open' ? { 'data-tech': t.id } : {}) }, [
        el('span', { class: 'tier' }, [t.branch]),
        el('b', {}, [t.name]),
        el('span', { class: 'effect' }, [t.effect]),
        el('span', { class: 'foot' }, foot),
        st === 'active' && busy ? el('i', { class: 'fill', style: `width:${Math.round(busy[1] * 100)}%` }) : '',
      ]);
    });

    const done = me.techs.length;
    const current = busy
      ? [
          `Researching ${tech(busy[0]).name}`,
          cellBar(busy[1]),
          `${Math.round(busy[1] * 100)}%`,
          el('button', { class: 'x', 'data-act': 'unresearch' }, ['Cancel (refund)']),
        ]
      : ['Nothing under way: pick a lit tech'];
    // Redrawn as resources come in: keep where the tree was scrolled to.
    const old = box.querySelector('.tscroll');
    const [sx, sy] = old ? [old.scrollLeft, old.scrollTop] : [0, 0];
    box.replaceChildren(
      el('div', { class: 'tscreen' }, [
        el('div', { class: 'thead' }, [
          el('h2', {}, ['Research']),
          el('div', { class: 'overall' }, [`${done} / ${TECHS.length} researched`, cellBar(done / TECHS.length)]),
          el('div', { class: 'current' }, current),
          el('button', { 'data-act': 'close' }, ['Close (T / Esc)']),
        ]),
        el('div', { class: 'tscroll' }, [el('div', { class: 'tplane', style: `width:${width}px;height:${height}px` }, [svg, root, ...nodes])]),
        el('div', { class: 'tlegend' }, [
          el('span', { class: 'k done' }, ['researched']),
          el('span', { class: 'k active' }, ['under way']),
          el('span', { class: 'k open' }, ['can research']),
          el('span', { class: 'k locked' }, ['needs the lines into it first']),
        ]),
      ]),
    );
    const scroll = box.querySelector('.tscroll');
    if (scroll) [scroll.scrollLeft, scroll.scrollTop] = [sx, sy];
  }

  onOver(winner: number | null): void {
    this.finished = true;
    this.setPlacing(null);
    this.setResearchOpen(false);
    const name = winner === null ? 'Nobody' : this.players[winner]?.name;
    $('#over-title').textContent = winner === this.you ? 'Victory! Every capital is yours.' : `${name} wins.`;
    $('#over').classList.remove('hidden');
  }

  private centreOnCapital(): void {
    if (this.you === null) return;
    const c = this.map.countries.find((x) => x.id === this.players[this.you as number].country);
    if (!c) return;
    const r = this.map.regions[c.capital];
    this.view.focus(r.x, r.y, 1.3);
  }

  // -- input ----------------------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.view.canvas;
    let down: { x: number; y: number; button: number; moved: boolean } | null = null;
    const pos = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const on = <K extends keyof WindowEventMap>(target: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };

    on(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    // Anywhere in the game (panels too): no browser menu, except in a text field.
    on(window, 'contextmenu', (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault();
    });
    // Audio may only start after a gesture.
    on(window, 'pointerdown', () => this.sfx.unlock());
    on(window, 'keydown', () => this.sfx.unlock());
    // A tick when the pointer comes onto a button (not again for the same one, even though
    // the HUD is redrawn under a still pointer).
    let lastHover = '';
    for (const sel of ['#buildbar', '#topbar', '#players']) {
      on($(sel), 'pointerover', (e: PointerEvent) => {
        const b = (e.target as HTMLElement).closest('button');
        const key = b ? `${sel}|${b.dataset.kind ?? b.dataset.tab ?? b.dataset.act ?? ''}|${b.textContent}` : '';
        if (b && key !== lastHover) this.sfx.tick();
        lastHover = key;
      });
      on($(sel), 'pointerleave', () => (lastHover = ''));
    }
    // While a button in the HUD is held down, the panels aren't redrawn under it (a snapshot
    // landing between press and release would swallow the click); they catch up after.
    for (const sel of ['#topbar', '#panel', '#research']) {
      on($(sel), 'pointerdown', () => {
        this.pressing = true;
        this.pressedAt = performance.now();
      });
    }
    const release = () => {
      if (!this.pressing) return;
      setTimeout(() => {
        this.pressing = false;
        this.renderTopbar();
        this.renderPanel();
        this.renderResearch();
      }, 0);
    };
    on(window, 'pointerup', release);
    on(window, 'pointercancel', release);
    on(window, 'blur', release);
    // The controls panel folds to its strip and back (remembered).
    on($('#help-fold'), 'click', () => this.foldHelp(!$('#help').classList.contains('folded')));
    // Open for a first game; folded to its "? Keys" strip after that, unless you chose.
    const chosen = stored(HELP_FOLDED);
    this.foldHelp(chosen !== null ? chosen === '1' : stored(PLAYED) === '1', false);
    store(PLAYED, '1');
    // Diplomacy buttons (ORBAT, peace offers): act on press, see diplomacyAction.
    for (const sel of ['#players', '#offers']) {
      on($(sel), 'pointerdown', (e: PointerEvent) => {
        const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
        if (b) {
          e.preventDefault();
          void this.diplomacyAction(b.dataset.act as string, Number(b.dataset.player));
          return;
        }
        // A country's row opens its actions (war, peace) under it; again closes them.
        const row = (e.target as HTMLElement).closest('[data-row]') as HTMLElement | null;
        if (!row) return;
        const id = Number(row.dataset.row);
        this.openCountry = this.openCountry === id ? null : id;
        this.renderPlayers();
      });
    }
    // Build bar and the region panel's cancel buttons: also act on press (redrawn often).
    on($('#buildbar'), 'pointerdown', (e: PointerEvent) => {
      const tab = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
      if (tab) {
        e.preventDefault();
        this.setTab(Number(tab.dataset.tab));
        return;
      }
      const b = (e.target as HTMLElement).closest('[data-kind]') as HTMLElement | null;
      if (!b) return;
      e.preventDefault();
      this.setPlacing(b.dataset.kind as BuildingKind);
    });
    // The research panel: pick a tech, cancel the one under way, or close.
    on($('#research'), 'pointerdown', (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      const tech = (t.closest('[data-tech]') as HTMLElement | null)?.dataset.tech;
      const act = (t.closest('[data-act]') as HTMLElement | null)?.dataset.act;
      if (!tech && !act) return;
      e.preventDefault();
      if (tech) this.send({ o: 'research', tech: tech as TechId });
      else if (act === 'unresearch') this.send({ o: 'unresearch' });
      else if (act === 'close') this.setResearchOpen(false);
    });
    on($('#panel'), 'pointerdown', (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      e.preventDefault();
      const region = Number(b.dataset.region);
      if (b.dataset.act === 'unbuild') this.send({ o: 'unbuild', region, index: Number(b.dataset.index) });
      else if (b.dataset.act === 'demolish') {
        const kind = b.dataset.kind as BuildingKind;
        void confirmBox('Demolish', `Knock down the ${BUILD_LABEL[kind].toLowerCase()} in ${this.map.regions[region].name}? Its slot is freed at once; nothing is refunded.`, 'Demolish').then(
          (ok) => ok && this.send({ o: 'demolish', region, kind }),
        );
      }
    });
    on(canvas, 'mousemove', (e: MouseEvent) => {
      const [x, y] = pos(e);
      const r = this.view.regionAt(x, y);
      if (r !== this.hover) {
        this.hover = r;
        this.renderBuildbar();
      }
    });
    // Double-click: a stack of yours (or one of its units) selects the whole stack; elsewhere,
    // all your units standing in that region.
    on(canvas, 'dblclick', (e: MouseEvent) => {
      if (this.placing) return;
      const [x, y] = pos(e);
      const item = this.view.itemAt(x, y);
      if (item && this.mine(item.ids[0])) {
        if (!e.shiftKey) this.selected.clear();
        for (const id of this.view.groupIds(item.group)) this.selected.add(id);
        this.view.expanded = null;
        this.region = -1;
      } else {
        const region = this.view.regionAt(x, y);
        if (region >= 0) this.selectRegionUnits(region, e.shiftKey);
      }
      this.renderPanel();
    });
    // Minimap: click or drag to move the camera.
    let miniDown = false;
    const miniJump = (e: MouseEvent) => {
      const r = this.minimap.getBoundingClientRect();
      this.view.focusMinimap(this.minimap, e.clientX - r.left, e.clientY - r.top);
    };
    on(this.minimap, 'mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      miniDown = true;
      miniJump(e);
    });
    on(this.minimap, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    on(window, 'mousemove', (e: MouseEvent) => {
      if (miniDown) miniJump(e);
    });
    on(window, 'mouseup', () => {
      miniDown = false;
    });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      const [x, y] = pos(e);
      down = { x, y, button: e.button, moved: false };
      if (this.placing === 'road' && e.button === 0) this.roadAt(x, y, true);
    });
    on(window, 'mousemove', (e: MouseEvent) => {
      if (!down) return;
      const [x, y] = pos(e);
      if (Math.hypot(x - down.x, y - down.y) > 5) down.moved = true;
      if (this.placing === 'road' && down.button === 0) this.roadAt(x, y, false);
      if (!down.moved) return;
      if (down.button === 0) {
        if (!this.placing) this.box = [down.x, down.y, x, y];
      }
      else {
        this.view.pan(e.movementX, e.movementY);
      }
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (!down) return;
      const [x, y] = pos(e);
      const d = down;
      down = null;
      if (this.placing === 'road' && d.button === 0) {
        this.finishRoad(e.shiftKey);
      } else if (this.placing) {
        if (d.button === 0 && !d.moved) this.place(x, y, e.shiftKey);
        else if (d.button === 2 && !d.moved) this.setPlacing(null);
      } else if (d.button === 0) {
        if (this.box) {
          this.selectBox(this.box, e.shiftKey);
          this.box = null;
        } else this.click(x, y, e.shiftKey);
      } else if (d.button === 2 && !d.moved) {
        void this.order(x, y, e.shiftKey);
      }
      this.renderPanel();
    });
    on(
      canvas,
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.view.zoomAt(x, y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
    on(window, 'resize', () => {
      this.view.resize();
      this.setUiScale(Number(stored(UI_SCALE)) || 1, false);
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT') return;
      // A confirm box has the keyboard to itself; Enter and Space press the focused button.
      if (!$('#confirm').classList.contains('hidden')) return;
      // (only when it was reached by keyboard: a clicked button keeps no claim on Space).
      const keyFocus = (e.target as HTMLElement).matches?.(':focus-visible');
      if ((tag === 'BUTTON' || tag === 'SUMMARY') && keyFocus && (e.key === 'Enter' || e.key === ' ')) return;
      // Browser shortcuts (Ctrl/Alt/Cmd) are the browser's.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Behind the menu or the game-over screen only Esc counts (Tab moves through its buttons).
      const overlay = !$('#menu').classList.contains('hidden') || !$('#over').classList.contains('hidden');
      if (overlay && e.key !== 'Escape') return;
      if (overlay && !$('#over').classList.contains('hidden')) return;
      this.keys.add(e.key.toLowerCase());
      // Held keys repeat only for panning (arrows, WASD); everything else is once per press.
      if (e.repeat) return;
      this.key(e);
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    // A button clicked with the mouse lets go of the focus, so Space and Enter stay game keys.
    on(window, 'pointerup', () => {
      const f = document.activeElement as HTMLElement | null;
      if (f && (f.tagName === 'BUTTON' || f.tagName === 'SUMMARY') && !f.matches(':focus-visible') && !f.closest('.overlay')) f.blur();
    });
    on(window, 'blur', () => this.keys.clear());

    // Touch: one finger taps/pans, two fingers zoom. Tap a unit, then tap a region to send it.
    let touch: { x: number; y: number; dist: number; moved: boolean } | null = null;
    on(
      canvas,
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        const t = e.touches;
        const r = canvas.getBoundingClientRect();
        const x = t[0].clientX - r.left;
        const y = t[0].clientY - r.top;
        const dist = t.length > 1 ? Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) : 0;
        touch = { x, y, dist, moved: false };
      },
      { passive: false },
    );
    on(
      canvas,
      'touchmove',
      (e: TouchEvent) => {
        e.preventDefault();
        if (!touch) return;
        const t = e.touches;
        const r = canvas.getBoundingClientRect();
        const x = t[0].clientX - r.left;
        const y = t[0].clientY - r.top;
        if (t.length > 1) {
          const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
          if (touch.dist > 0) this.view.zoomAt(x, y, dist / touch.dist);
          touch.dist = dist;
        } else {
          this.view.pan(x - touch.x, y - touch.y);
        }
        if (Math.hypot(x - touch.x, y - touch.y) > 4) touch.moved = true;
        touch.x = x;
        touch.y = y;
      },
      { passive: false },
    );
    on(canvas, 'touchend', (e: TouchEvent) => {
      if (touch && !touch.moved && e.touches.length === 0 && this.placing) {
        this.place(touch.x, touch.y, false);
      } else if (touch && !touch.moved && e.touches.length === 0) {
        const blob = this.view.blobAt(touch.x, touch.y);
        if (blob === null && this.selected.size > 0) void this.order(touch.x, touch.y);
        else this.click(touch.x, touch.y, false);
        this.renderPanel();
      }
      if (e.touches.length === 0) touch = null;
    });
  }

  private panWithKeys(): void {
    const k = this.keys;
    const step = 12;
    const dx = (k.has('a') || k.has('arrowleft') ? step : 0) - (k.has('d') || k.has('arrowright') ? step : 0);
    const dy = (k.has('w') || k.has('arrowup') ? step : 0) - (k.has('s') || k.has('arrowdown') ? step : 0);
    if (dx || dy) this.view.pan(dx, dy);
  }

  private blob(id: number): BlobRow | undefined {
    return this.snap?.blobs.find((b) => b[0] === id);
  }

  private mine(id: number): boolean {
    return this.you !== null && this.blob(id)?.[1] === this.you;
  }

  private click(x: number, y: number, shift: boolean): void {
    const item = this.view.itemAt(x, y);
    // Anywhere but the expanded stack's own tokens closes it.
    if (item?.group !== this.view.expanded || item?.stack) this.view.expanded = null;
    const b = item ? this.blob(item.ids[0]) : undefined;
    if (item && b) {
      // A stack (anyone's) opens up into its units; the selection stays as it is.
      if (item.stack) {
        this.view.expanded = item.group;
        this.region = b[6];
        return;
      }
      // One of your units: select it (Shift adds or removes it).
      if (this.mine(b[0])) {
        this.sfx.select();
        if (!shift) this.selected = new Set([b[0]]);
        else if (this.selected.has(b[0])) this.selected.delete(b[0]);
        else this.selected.add(b[0]);
        this.region = b[8] > 0 ? -1 : b[6];
        return;
      }
      // Someone else's: show where it is.
      this.region = b[6];
      return;
    }
    if (!shift) this.selected.clear();
    this.region = this.view.regionAt(x, y);
  }

  private selectBox(box: [number, number, number, number], shift: boolean): void {
    const ids = this.view.blobsIn(...box).filter((id) => this.mine(id));
    if (!shift) this.selected.clear();
    for (const id of ids) this.selected.add(id);
    if (ids.length) this.region = -1;
  }

  /** Sends the selected units to a region; with Shift, after the route they're on (a waypoint). */
  private async order(x: number, y: number, then = false): Promise<void> {
    let to = this.view.regionAt(x, y);
    // Only ships selected: a click on land (not your port) or open water means the sea nearby.
    const ships = [...this.selected].every((id) => this.snap?.blobs.find((b) => b[0] === id)?.[2] === UNIT_INDEX.indexOf('warship'));
    if (ships && this.snap && (to < 0 || (!this.map.regions[to].sea && !(this.snap.regions[to][0] === this.you && this.snap.regions[to][3] & 8)))) {
      to = this.view.seaNear(x, y);
    }
    if (to < 0 || this.selected.size === 0) return;
    const blobs = [...this.selected];
    const owner = this.snap?.regions[to][0] ?? -1;
    if (this.you !== null && owner >= 0 && owner !== this.you && !this.atWar(this.you, owner)) {
      const truce = this.truceLeft(this.you, owner);
      if (truce > 0) {
        toast(`Truce with ${this.nameOf(owner)} for ${truce} s`);
        return;
      }
      const ok = await confirmBox('Act of war', `${this.map.regions[to].name} belongs to ${this.nameOf(owner)}. Sending units in declares war on them.`, 'Attack');
      if (!ok) return;
    }
    this.send({ o: 'move', blobs, to, ...(then ? { then: true } : {}) });
    this.sfx.move();
    // Shown at once, until the server's routes for them arrive.
    this.view.pending.move = { ids: blobs, to, since: this.snap?.time ?? 0 };
  }

  // -- diplomacy ------------------------------------------------------------------------------

  private nameOf(id: number): string {
    return (this.players[id]?.name ?? 'Neutral').replace(/ \(bot\)$/, '');
  }

  private atWar(a: number, b: number): boolean {
    return !!this.snap?.wars.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  private truceLeft(a: number, b: number): number {
    const t = this.snap?.truces.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
    return t ? t[2] : 0;
  }

  /** ORBAT and offer buttons act on press: those panels are redrawn several times a second. */
  private async diplomacyAction(action: string, player: number): Promise<void> {
    if (action === 'war') {
      const ok = await confirmBox('Declaration of war', `Declare war on ${this.nameOf(player)}? Your units may then enter their land and fight theirs.`, 'Declare war');
      if (ok) this.send({ o: 'war', player });
    } else if (action === 'peace') {
      this.send({ o: 'peace', player });
    } else if (action === 'refuse') {
      this.send({ o: 'refuse', player });
    }
  }

  private renderOffers(): void {
    const snap = this.snap;
    const box = $('#offers');
    const mine = this.you === null ? [] : (snap?.offers ?? []).filter(([, to]) => to === this.you);
    box.classList.toggle('hidden', mine.length === 0);
    if (!mine.length) return;
    box.replaceChildren(
      classbar('Flash // Peace offer'),
      ...mine.map(([from, , left]) =>
        el('div', { class: 'offer' }, [
          el('span', {}, [`${this.nameOf(from)} offers peace (${left} s)`]),
          el('div', { class: 'row' }, [
            el('button', { class: 'primary', 'data-act': 'peace', 'data-player': String(from) }, ['Accept']),
            el('button', { 'data-act': 'refuse', 'data-player': String(from) }, ['Refuse']),
          ]),
        ]),
      ),
    );
  }

  private key(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const sel = [...this.selected];
    if (k === 'escape' && !$('#menu').classList.contains('hidden')) {
      this.toggleMenu(false);
    } else if (k === 'escape' && this.placing) {
      this.setPlacing(null);
    } else if (k === 'escape' && this.researchOpen) {
      this.setResearchOpen(false);
    } else if (k === 'escape' && (this.selected.size || this.region >= 0 || this.view.expanded !== null)) {
      this.selected.clear();
      this.region = -1;
      this.view.expanded = null;
    } else if (k === 'escape') {
      this.toggleMenu(true);
    } else if (k === 'x' && sel.length) {
      for (const id of sel) this.send({ o: 'split', blob: id });
    } else if (k === 'g' && sel.length > 1) {
      this.mergeSelected();
    } else if ((k === 'delete' || k === 'backspace') && sel.length) {
      this.disbandSelected();
    } else if (k === 'h' && sel.length) {
      this.send({ o: 'stop', blobs: sel });
    } else if (k === 'm') {
      this.setMuted(!this.sfx.muted);
    } else if (k === 'v') {
      this.setOverlay(!this.view.overlay);
    } else if (k === 'b') {
      this.setYields(!this.view.yields);
    } else if (k === '?' || k === '/') {
      this.foldHelp(!$('#help').classList.contains('folded'));
    } else if (k === 'p' && this.solo && this.playing) {
      this.menuPaused = false;
      this.send({ o: 'pause', on: !this.snap?.paused });
    } else if (k === 't') {
      this.setResearchOpen(!this.researchOpen);
    } else if (k === ' ') {
      e.preventDefault();
      this.centreOnCapital();
    } else if (k >= '1' && k <= '9' && k.length === 1) {
      const kind = TABS[this.tab].kinds[Number(k) - 1];
      if (kind) this.setPlacing(kind);
    } else if (k === 'tab') {
      e.preventDefault();
      this.setTab((this.tab + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length);
    } else if (k === 'q' && this.region >= 0) {
      this.send({ o: 'produce', region: this.region, building: 'barracks' });
    } else if (k === 'e' && this.region >= 0) {
      this.send({ o: 'produce', region: this.region, building: 'factory', unit: 'tank' });
    } else if (k === 'r' && this.region >= 0) {
      this.send({ o: 'produce', region: this.region, building: 'factory', unit: 'artillery' });
    } else if (k === 'f' && this.region >= 0) {
      this.send({ o: 'produce', region: this.region, building: 'port', unit: 'warship' });
    } else return;
    this.renderPanel();
  }

  /** The server turned an order down (its message is already on screen). */
  onRefused(): void {
    this.sfx.refuse();
  }

  /** The menu's sound and effects buttons, showing what's on. */
  private renderMenuOptions(): void {
    const sound = $('#menu-sound');
    sound.textContent = this.sfx.muted ? 'Off (M)' : 'On (M)';
    sound.classList.toggle('on', !this.sfx.muted);
    sound.setAttribute('aria-pressed', String(!this.sfx.muted));
    sound.onclick = () => this.setMuted(!this.sfx.muted);
    const full = this.view.fx.level === 'full';
    const fx = $('#menu-fx');
    fx.textContent = full ? 'Full' : 'Reduced';
    fx.classList.toggle('on', full);
    fx.setAttribute('aria-pressed', String(full));
    fx.onclick = () => {
      this.fxChosen = true;
      this.setEffects(full ? 'reduced' : 'full');
    };
  }

  private setEffects(level: 'full' | 'reduced'): void {
    this.view.fx.level = level;
    this.renderTopbar();
  }

  private setMuted(on: boolean): void {
    this.sfx.setMuted(on);
    this.renderTopbar();
  }

  // -- placement mode ---------------------------------------------------------------------------

  /** Opens a tab of the build bar (leaving placement mode for a building on another tab). */
  private setTab(tab: number): void {
    this.tab = tab;
    if (this.placing && !TABS[tab].kinds.includes(this.placing)) this.setPlacing(null);
    this.renderBuildbar();
  }

  /** Enters placement mode for a building, or leaves it (same building again, or null). */
  private setPlacing(kind: BuildingKind | null): void {
    if (kind) {
      const tab = TABS.findIndex((t) => t.kinds.includes(kind));
      if (tab >= 0) this.tab = tab;
    }
    this.placing = kind === this.placing ? null : kind;
    // Out of the game (watching, knocked out, or it's over): nothing to build.
    if (this.placing && !this.playing) this.placing = null;
    this.roadPath = null;
    this.view.roadPreview = null;
    this.view.canvas.classList.toggle('placing', this.placing !== null);
    this.renderBuildbar();
  }

  /** A click in placement mode: build there (Shift keeps the tool). */
  private place(x: number, y: number, shift: boolean): void {
    const kind = this.placing;
    if (!kind) return;
    const region = this.view.regionAt(x, y);
    if (kind === 'road') return;
    const why = this.whyNot(kind, region);
    if (why) {
      toast(why);
      this.sfx.refuse();
      return;
    }
    this.send({ o: 'build', region, kind });
    this.sfx.place();
    this.view.pending.builds.push({ region, kind, since: this.snap?.time ?? 0 });
    if (!shift) this.setPlacing(null);
  }

  /** Road tool: pressing starts a path in one of your regions; dragging adds neighbours. */
  private roadAt(x: number, y: number, start: boolean): void {
    const r = this.view.regionAt(x, y);
    if (start) this.roadPath = r >= 0 && this.snap?.regions[r][0] === this.you ? [r] : null;
    const path = this.roadPath;
    if (!path || r < 0 || r === path[path.length - 1]) return;
    const last = path[path.length - 1];
    if (!this.map.regions[last].neighbors.some((n) => n.id === r)) return;
    path.push(r);
    this.view.roadPreview = [...path];
  }

  /** Road tool released: one road per border crossed (Shift keeps the tool). */
  private finishRoad(shift: boolean): void {
    const path = this.roadPath;
    this.roadPath = null;
    this.view.roadPreview = null;
    if (!path || path.length < 2) {
      if (path) toast('drag across your regions to lay a road');
      return;
    }
    let sent = 0;
    let why = '';
    for (let i = 0; i + 1 < path.length; i++) {
      const reason = this.whyNot('road', path[i], path[i + 1]);
      if (reason) why ||= reason;
      else {
        this.send({ o: 'build', region: path[i], kind: 'road', target: path[i + 1] });
        sent++;
      }
    }
    toast(sent ? `${sent} road${sent > 1 ? 's' : ''} queued${why ? ` (some skipped: ${why})` : ''}` : why, sent ? 'info' : 'error');
    if (sent) this.sfx.place();
    else this.sfx.refuse();
    if (!shift && sent) this.setPlacing(null);
  }

  /** A region's builds: the one under way, then the waiting ones, as [kind, road target]. */
  private pending(region: number): Array<[BuildingKind, number]> {
    const rr = (this.snap as Snapshot).regions[region];
    const out: Array<[BuildingKind, number]> = rr[6] >= 0 ? [[BUILDING_INDEX[rr[6]], rr[8]]] : [];
    const row = this.snap?.builds.find((b) => b[0] === region);
    if (row) for (let i = 1; i + 1 < row.length; i += 2) out.push([BUILDING_INDEX[row[i]], row[i + 1]]);
    return out;
  }

  /** Slots taken in a region, counting builds under way and waiting (mirrors Sim.slotsUsed). */
  private slotsUsed(region: number): number {
    const rr = (this.snap as Snapshot).regions[region];
    let n = rr[9] + rr[10] + rr[11] + rr[12] + rr[13] + rr[14] + (rr[1] > 0 ? 1 : 0) + (rr[3] & 1 ? 1 : 0) + (rr[3] & 2 ? 1 : 0) + (rr[3] & 8 ? 1 : 0) + (rr[3] & 16 ? 1 : 0);
    let fort = rr[1] > 0;
    for (const [kind] of this.pending(region)) {
      if (kind === 'fort') {
        if (!fort) n++;
        fort = true;
      } else if (kind !== 'city' && kind !== 'road') n++;
    }
    return n;
  }

  /** The level the next fort or city build would reach, counting queued ones. */
  private nextLevel(kind: BuildingKind, region: number): number {
    const rr = (this.snap as Snapshot).regions[region];
    const pending = this.pending(region).filter(([k]) => k === kind).length;
    if (kind === 'fort') return rr[1] + pending + 1;
    if (kind === 'city') return rr[2] + pending + 1;
    return 1;
  }

  /** Regions within `hops` of a region (itself included). */
  private near(region: number, hops: number): number[] {
    const seen = new Map([[region, 0]]);
    const queue = [region];
    for (let q = 0; q < queue.length; q++) {
      const d = seen.get(queue[q]) as number;
      if (d >= hops) continue;
      for (const n of this.map.regions[queue[q]].neighbors) {
        if (!seen.has(n.id)) {
          seen.set(n.id, d + 1);
          queue.push(n.id);
        }
      }
    }
    return queue;
  }

  private resources(): Resources {
    const me = (this.snap as Snapshot).players[this.you as number];
    return { money: me.res[0], manpower: me.res[1], steel: me.res[2], oil: me.res[3], research: me.res[4] };
  }

  /** Why `kind` can't be built in a region right now, or null if it can (mirrors Sim.whyNotBuild). */
  private whyNot(kind: BuildingKind, region: number, target = -1): string | null {
    const snap = this.snap;
    if (!snap || this.you === null) return 'you are not playing';
    if (region < 0) return 'pick one of your regions';
    const rr = snap.regions[region];
    const map = this.map.regions[region];
    if (rr[0] !== this.you) return 'not your region';
    if (!(rr[3] & 4)) return 'region is out of supply';
    if (this.attacked().has(region)) return 'region is under attack';
    if (!canBuildOn(kind, map, rr[2])) return `a ${BUILD_LABEL[kind].toLowerCase()} needs ${BUILD_NEEDS[kind]}`;
    const pending = this.pending(region);
    if (ECON_KINDS.includes(kind as EconKind) && !this.near(region, HINTERLAND_HOPS).some((r) => snap.regions[r][0] === this.you && snap.regions[r][2] > 0)) {
      return `only within ${HINTERLAND_HOPS} regions of one of your cities`;
    }
    if (kind === 'fort' && this.nextLevel(kind, region) > MAX_FORT) return 'the fort is at its highest level';
    const flag: Partial<Record<BuildingKind, number>> = { barracks: 1, factory: 2, port: 8, battery: 16 };
    if (flag[kind] && (rr[3] & (flag[kind] as number) || pending.some(([k]) => k === kind))) {
      return `already has a ${BUILD_LABEL[kind].toLowerCase()}`;
    }
    if (kind === 'city') {
      const level = this.nextLevel(kind, region);
      if (level > MAX_CITY) return 'the city is at its highest level';
      const city = (r: number) => snap.regions[r][2] > 0 || this.pending(r).some(([k]) => k === 'city');
      if (level === 1 && this.near(region, FOUND_CITY_MIN_HOPS - 1).some((r) => r !== region && city(r))) return 'too close to another city';
    }
    if (kind === 'road' && target >= 0) {
      if (!map.neighbors.some((n) => n.id === target)) return 'a road needs a neighbouring region';
      if (snap.regions[target][0] !== this.you) return 'roads join two of your regions';
      const has = snap.roads.some(([a, b]) => (a === region && b === target) || (a === target && b === region));
      const queued = this.pending(region).some(([k, t]) => k === 'road' && t === target) || this.pending(target).some(([k, t]) => k === 'road' && t === region);
      if (has || queued) return 'there is a road already';
    }
    const needsSlot = kind !== 'city' && kind !== 'road' && !(kind === 'fort' && (rr[1] > 0 || pending.some(([k]) => k === 'fort')));
    if (needsSlot && this.slotsUsed(region) >= slotsOf(map, rr[2])) return 'no free slot';
    if (rr[6] >= 0 && pending.length - 1 >= BUILD_QUEUE) return 'build queue is full';
    const cost = buildCost(kind, this.nextLevel(kind, region)).cost;
    if (!afford(this.resources(), cost)) {
      // More than the stores hold: no amount of waiting will do.
      const cap = snap.players[this.you].cap;
      if (RESOURCES.some((k, i) => cost[k] > cap[i])) return 'costs more than your stores hold: build a depot';
      return 'not enough resources';
    }
    return null;
  }

  /** Regions fought over or being taken (no building there), once per snapshot. */
  private attacked(): Set<number> {
    const snap = this.snap as Snapshot;
    if (this.attackedCache?.snap === snap) return this.attackedCache.set;
    const set = new Set<number>();
    const atWar = (a: number, b: number) => snap.wars.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    snap.regions.forEach((rr, i) => {
      if (rr[4] >= 0 && rr[4] !== rr[0]) set.add(i);
    });
    for (const b of snap.blobs) {
      const owner = snap.regions[b[6]][0];
      if (owner >= 0 && atWar(b[1], owner)) set.add(b[6]);
      if (b[11] & 4 && b[7] >= 0 && snap.regions[b[7]][0] >= 0 && atWar(b[1], snap.regions[b[7]][0])) set.add(b[7]);
    }
    this.attackedCache = { snap, set };
    return set;
  }

  /** Slots of each of your regions, [used, all] (once per snapshot). */
  private slotMap(): Map<number, [number, number]> {
    const snap = this.snap as Snapshot;
    if (this.slotCache?.snap === snap) return this.slotCache.map;
    const map = new Map<number, [number, number]>();
    snap.regions.forEach((rr, i) => {
      if (rr[0] === this.you) map.set(i, [this.slotsUsed(i), slotsOf(this.map.regions[i], rr[2])]);
    });
    this.slotCache = { snap, map };
    return map;
  }

  private validFor(kind: BuildingKind): Set<number> {
    const snap = this.snap as Snapshot;
    if (this.valid?.snap !== snap || this.valid.kind !== kind) this.valid = { snap, kind, set: this.validRegions(kind) };
    return this.valid.set;
  }

  private validRegions(kind: BuildingKind): Set<number> {
    const out = new Set<number>();
    const regions = this.snap?.regions ?? [];
    for (let i = 0; i < regions.length; i++) {
      if (regions[i][0] !== this.you) continue;
      const ok = kind === 'road' ? this.map.regions[i].neighbors.some((n) => !this.whyNot('road', i, n.id)) : !this.whyNot(kind, i);
      if (ok) out.add(i);
    }
    return out;
  }

  /** What a building is called on the bar, for the region under the cursor. */
  private barName(kind: BuildingKind, region: number): string {
    if (kind === 'city') {
      if (region < 0) return 'City';
      const level = this.nextLevel(kind, region);
      return level === 1 ? 'Found city' : `City ${level}`;
    }
    if (kind === 'fort' && region >= 0) return `Fort ${this.nextLevel(kind, region)}`;
    return BUILD_LABEL[kind];
  }

  /** The build bar: groups of buttons with costs, exact for the region under the cursor. */
  private renderBuildbar(): void {
    const bar = $('#buildbar');
    const snap = this.snap;
    bar.classList.toggle('hidden', !snap || !this.playing);
    if (!snap || this.you === null || !this.playing) return;
    const res = this.resources();
    const mine = this.hover >= 0 && snap.regions[this.hover][0] === this.you ? this.hover : -1;
    // The dock doesn't depend on where the pointer is: press a key (or a button), then click a
    // region; the map shows where it can go. City and fort show their first level's cost.
    const cell = (kind: BuildingKind) => {
      const { cost, seconds } = buildCost(kind, 1);
      const poor = !afford(res, cost);
      return { kind, n: String(TABS[this.tab].kinds.indexOf(kind) + 1), name: BUILD_LABEL[kind], cost, seconds, poor };
    };
    const groups = [{ group: TABS[this.tab].name, cells: TABS[this.tab].kinds.map(cell) }];
    const slots = mine >= 0 ? `${mine}:${this.slotsUsed(mine)}/${slotsOf(this.map.regions[mine], snap.regions[mine][2])}` : '';
    // Redrawn only when something on it changed (what you can afford included).
    const can = RESOURCES.map((k) => groups.map((g) => g.cells.map((c) => res[k] >= c.cost[k])));
    // Only while placing: what it does, here, on one line above the dock (no hover popups).
    const about = this.placing;
    const key = `${this.tab}|${this.placing}|${about}|${slots}|${JSON.stringify(groups)}|${JSON.stringify(can)}`;
    if (key === this.buildbarKey) return;
    this.buildbarKey = key;
    // A dock of buttons, each with its cost under its name. While placing, one line above says
    // what the building does (its exact yield here) and how to place it.
    const strip: HTMLElement[] = [];
    if (about) {
      let text = BUILD_HELP[about].replace(/^[^:]+: /, '');
      if (mine >= 0 && !canBuildOn(about, this.map.regions[mine], snap.regions[mine][2])) text += ` Not here: needs ${BUILD_NEEDS[about]}.`;
      if (ECON_KINDS.includes(about as EconKind) && mine >= 0) {
        const y = econYield(about as EconKind, this.map.regions[mine], snap.regions[mine][2]);
        const here = RESOURCES.filter((k) => (y[k] ?? 0) > 0).map((k) => `+${round1(y[k] ?? 0)} ${k}/s`);
        if (here.length) text += ` Here: ${here.join(', ')}.`;
      }
      const how = this.placing === 'road' ? 'drag across your regions' : 'click a region';
      const level = mine >= 0 ? this.nextLevel(about, mine) : 1;
      const here = mine >= 0 && level > 1 ? buildCost(about, level).cost : null;
      strip.push(
        el('div', { class: 'strip' }, [
          el('b', {}, [mine >= 0 ? this.barName(about, mine) : BUILD_LABEL[about]]),
          ...(here ? [costChips(here, res)] : []),
          el('span', { class: 'what' }, [text]),
          ...(mine >= 0 ? [this.slotBoxes(mine)] : []),
          el('span', { class: 'how' }, [`${how} · shift: more · esc`]),
        ]),
      );
    }
    const slot = (c: (typeof groups)[number]['cells'][number]) =>
      el(
        'button',
        {
          class: `slot${this.placing === c.kind ? ' active' : ''}${c.poor ? ' poor' : ''}`,
          'data-kind': c.kind,
          'aria-label': `${c.name}${c.poor ? ' (short of resources)' : ''}`,
        },
        [
          el('img', { src: buildingIcon(c.kind), alt: '' }),
          el('span', { class: 'key' }, [c.n]),
          el('span', { class: 'name' }, [c.name]),
          costChips(c.cost, res),
          el('span', { class: 'time' }, [`${c.seconds}s`]),
        ],
      );
    const tabs = el(
      'div',
      { class: 'tabs', role: 'tablist' },
      TABS.map((t, i) =>
        el('button', { class: `tab${i === this.tab ? ' on' : ''}`, 'data-tab': String(i), role: 'tab', 'aria-selected': String(i === this.tab) }, [t.name]),
      ),
    );
    bar.replaceChildren(...strip, tabs, el('div', { class: 'slots' }, groups.flatMap((g) => g.cells.map(slot))));
  }

  /** A region's building slots drawn as boxes, as on the map: filled when used, hollow
   * green when free. */
  private slotBoxes(region: number): HTMLElement {
    const used = this.slotsUsed(region);
    const all = slotsOf(this.map.regions[region], (this.snap as Snapshot).regions[region][2]);
    const boxes = Array.from({ length: all }, (_, i) => el('i', { class: i < used ? 'used' : 'free' }));
    return el('span', { class: 'slotboxes', role: 'img', 'aria-label': `${this.map.regions[region].name}: ${used} of ${all} slots used` }, boxes);
  }

  /** Selects all your units standing in a region (Shift adds to the selection). */
  private selectRegionUnits(region: number, add: boolean): void {
    if (!add) this.selected.clear();
    for (const b of this.snap?.blobs ?? []) {
      if (b[1] === this.you && b[6] === region && b[8] === 0) this.selected.add(b[0]);
    }
    if (this.selected.size) this.region = -1;
  }

  private setOverlay(on: boolean): void {
    this.view.overlay = on && this.you !== null;
    $('#legend').classList.toggle('hidden', !this.view.overlay);
    this.renderTopbar();
  }

  private foldHelp(folded: boolean, remember = true): void {
    $('#help').classList.toggle('folded', folded);
    $('#help-fold').setAttribute('aria-expanded', String(!folded));
    $('#help-fold-title').textContent = folded ? '? Keys' : 'Controls';
    $('#help-fold-label').textContent = folded ? '' : 'Hide';
    if (remember) store(HELP_FOLDED, folded ? '1' : '0');
  }

  private setYields(on: boolean): void {
    this.view.yields = on && this.you !== null;
    this.renderTopbar();
  }

  /** Disbands the selected units, after asking, for part of their manpower back. */
  private disbandSelected(): void {
    const sel = [...this.selected].map((id) => this.blob(id)).filter((b): b is BlobRow => !!b);
    if (!sel.length) return;
    const back = sel.reduce((sum, b) => {
      const stats = UNITS[UNIT_INDEX[b[2]]];
      return sum + (b[3] * stats.cost.manpower * DISBAND_REFUND) / stats.batch;
    }, 0);
    const [what, its] = sel.length === 1 ? ['this unit', 'its'] : [`these ${sel.length} units`, 'their'];
    void confirmBox('Disband', `Disband ${what}? You get back ${Math.floor(back)} manpower (half of what ${its} strength cost). Units in a fight can't disband.`, 'Disband').then((ok) => {
      if (!ok) return;
      this.send({ o: 'disband', blobs: sel.map((b) => b[0]) });
      this.selected.clear();
      this.renderPanel();
    });
  }

  /** Merges selected units of the same type that stand in the same region. */
  private mergeSelected(): void {
    const groups = new Map<string, number[]>();
    for (const id of this.selected) {
      const b = this.blob(id);
      if (!b || b[8] > 0) continue;
      const k = `${b[6]}:${b[2]}`;
      groups.set(k, [...(groups.get(k) ?? []), id]);
    }
    let any = false;
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      any = true;
      ids.sort((a, b) => (this.blob(b)?.[4] ?? 0) - (this.blob(a)?.[4] ?? 0));
      this.send({ o: 'merge', blobs: ids });
    }
    if (!any) toast('Select units of the same type in the same region');
  }

  // -- HUD ------------------------------------------------------------------------------------

  private renderTopbar(): void {
    const snap = this.snap;
    if (!snap) return;
    const t = `T+${clock(snap.time)}`;
    const menu = el('button', { class: 'toggle' }, ['Menu', el('small', {}, ['Esc'])]);
    menu.onclick = () => this.toggleMenu(true);
    if (this.you === null) {
      $('#topbar').replaceChildren(el('span', { class: 'tag' }, ['Watching']), menu, el('span', { class: 'clock' }, [t]));
      return;
    }
    const p = snap.players[this.you];
    const parts: HTMLElement[] = RESOURCES.map((k, i) => {
      let rate = p.income[i];
      if (k === 'money') rate -= p.upkeep;
      // A thin gauge under the number: how full the stores are (orange and FULL near the top).
      const fill = p.cap[i] > 0 ? Math.min(1, p.res[i] / p.cap[i]) : 1;
      const full = fill >= 0.95;
      return el('span', { class: `res${full ? ' full' : ''}` }, [
        el('img', { src: hudIcon(k), alt: k }),
        el('span', { class: 'stock' }, [el('b', {}, [fmt(p.res[i])]), el('i', { class: 'gauge' }, [el('i', { style: `width:${Math.round(fill * 100)}%` })])]),
        el('small', { class: rate < 0 ? 'neg' : '' }, [full && rate > 0 ? 'FULL' : `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/s`]),
      ]);
    });
    if (p.broke) parts.push(el('span', { class: 'broke' }, ['BROKE: UNITS WITHERING']));
    if (!p.alive) parts.push(el('span', { class: 'broke' }, ['ELIMINATED // OBSERVING']));
    const supply = el('button', { class: `toggle${this.view.overlay ? ' on' : ''}` }, ['Supply', el('small', {}, ['V'])]);
    supply.onclick = () => this.setOverlay(!this.view.overlay);
    const yields = el('button', { class: `toggle${this.view.yields ? ' on' : ''}` }, ['Yield', el('small', {}, ['B'])]);
    yields.onclick = () => this.setYields(!this.view.yields);
    const busy = p.research;
    const tech = el('button', { class: `toggle${this.researchOpen ? ' on' : ''}` }, [busy ? `Tech ${Math.round(busy[1] * 100)}%` : 'Tech', el('small', {}, ['T'])]);
    tech.onclick = () => this.setResearchOpen(!this.researchOpen);
    parts.push(supply, yields, tech);
    parts.push(menu);
    const paused = snap.paused ? [el('span', { class: 'paused' }, [this.solo ? 'PAUSED (P)' : 'PAUSED'])] : [];
    $('#topbar').replaceChildren(el('span', { class: 'clock' }, [t]), ...paused, ...parts);
    this.renderMenuOptions();
  }

  private renderPlayers(): void {
    const snap = this.snap;
    if (!snap) return;
    const regions = new Map<number, number>();
    for (const r of snap.regions) if (r[0] >= 0) regions.set(r[0], (regions.get(r[0]) ?? 0) + 1);
    const strength = new Map<number, number>();
    for (const b of snap.blobs) strength.set(b[1], (strength.get(b[1]) ?? 0) + b[3]);
    const me = this.you;
    const mine = me !== null && !!snap.players[me]?.alive;
    // You first, then countries at war with you, then the rest by size; the knocked out last.
    const order = [...this.players].sort((a, b) => {
      const rank = (id: number) =>
        id === me ? 0 : !snap.players[id].alive ? 3 : me !== null && this.atWar(me, id) ? 1 : 2;
      return rank(a.id) - rank(b.id) || (regions.get(b.id) ?? 0) - (regions.get(a.id) ?? 0);
    });
    const rows: HTMLElement[] = [];
    for (const p of order) {
      const row = snap.players[p.id];
      const other = mine && p.id !== me && row.alive;
      const war = other && this.atWar(me as number, p.id);
      const truce = other ? this.truceLeft(me as number, p.id) : 0;
      const offered = other && snap.offers.some(([f, t]) => f === p.id && t === me);
      const pending = other && snap.offers.some(([f, t]) => f === me && t === p.id);
      // Only what's out of the ordinary: you, away, at war, a truce, an offer.
      const tag = p.id === me ? 'you' : !row.alive ? 'out' : p.human && row.bot ? 'away' : '';
      const rel = war ? el('span', { class: 'tag war' }, [offered ? 'offers peace' : pending ? 'war · offered' : 'war']) : truce > 0 ? el('span', { class: 'tag truce' }, [`truce ${truce}s`]) : '';
      const open = this.openCountry === p.id && other;
      rows.push(
        el('div', { class: `p${row.alive ? '' : ' dead'}${open ? ' open' : ''}${other ? ' pick' : ''}`, ...(other ? { 'data-row': String(p.id) } : {}) }, [
          el('span', { class: 'swatch', style: `background:${p.color}` }),
          el('span', { class: 'name' }, [p.name.replace(/ \(bot\)$/, '')]),
          tag ? el('span', { class: 'tag' }, [tag]) : '',
          rel,
          el('span', { class: 'num' }, [`${regions.get(p.id) ?? 0}`]),
          el('span', { class: 'num str' }, [fmt(strength.get(p.id) ?? 0)]),
        ]),
      );
      if (open) {
        const acts: HTMLElement[] = [];
        if (war && !pending) acts.push(el('button', { class: 'act peace', 'data-act': 'peace', 'data-player': String(p.id) }, [offered ? 'Accept peace' : 'Offer peace']));
        else if (!war && truce === 0) acts.push(el('button', { class: 'act war', 'data-act': 'war', 'data-player': String(p.id) }, ['Declare war']));
        rows.push(el('div', { class: 'acts' }, acts.length ? acts : [el('span', { class: 'tag' }, [war ? 'peace offered, waiting' : `truce for ${truce}s more`])]));
      }
    }
    $('#players').replaceChildren(classbar('Countries', 'Regions · Strength'), ...rows);
  }

  private addEvent(e: GameEvent): void {
    const name = (id: number) => (this.players[id]?.name ?? 'Neutral').replace(/ \(bot\)$/, '');
    const region = (id: number) => this.map.regions[id]?.name ?? '?';
    let text: string | null = null;
    // Effects and sounds first (they don't depend on the feed).
    switch (e.kind) {
      case 'built': {
        const row = this.snap?.regions[e.region];
        if (row) this.view.built(e.region, e.building, row);
        if (e.owner === this.you) this.sfx.built();
        break;
      }
      case 'routed':
        this.view.routed(e.region);
        break;
      case 'captured':
        if (e.by === this.you) this.sfx.captured();
        else if (e.from === this.you) this.sfx.lost();
        break;
      case 'war':
        if (e.by !== this.you && (e.a === this.you || e.b === this.you)) this.sfx.alarm();
        break;
      case 'peaceOffer':
        if (e.to === this.you) this.sfx.bell();
        break;
      case 'eliminated':
        if (e.player === this.you) this.sfx.jingle(false);
        break;
      case 'won':
        if (this.you !== null) this.sfx.jingle(e.player === this.you);
        break;
    }
    switch (e.kind) {
      case 'battle':
        if (this.you !== null && e.sides.includes(this.you)) text = `CONTACT at ${region(e.region)}`;
        break;
      case 'captured':
        if (e.by === this.you || e.from === this.you || e.from >= 0) {
          const from = e.from >= 0 ? ` from ${name(e.from)}` : '';
          this.say(`${name(e.by)} took ${region(e.region)}${from}`, [`took:${e.by}:${e.from}`, `${name(e.by)} took `, region(e.region), from]);
        }
        break;
      case 'routed':
        if (e.owner === this.you) text = `Our troops at ${region(e.region)} broke and fled`;
        else if (e.by === this.you) text = `${name(e.owner)}'s defenders at ${region(e.region)} broke and fled`;
        break;
      case 'looted': {
        const what = RESOURCES.filter((k) => e.got[k] >= 1).map((k) => `${Math.floor(e.got[k])} ${k}`).join(', ');
        if (what && e.by === this.you) text = `Seized ${what} in ${region(e.region)}`;
        else if (what && e.from === this.you) text = `Lost ${what} with ${region(e.region)}`;
        break;
      }
      case 'built':
        if (e.owner === this.you) {
          const what = `${BUILD_LABEL[e.building]}${e.level > 1 ? ` ${e.level}` : ''} finished at `;
          this.say(what + region(e.region), [`built:${what}`, what, region(e.region), '']);
        }
        break;
      case 'eliminated':
        text = e.surrendered ? `${name(e.player)} surrendered` : `${name(e.player)} knocked out by ${name(e.by)}`;
        break;
      case 'war': {
        const target = e.by === e.a ? e.b : e.a;
        text = target === this.you ? `!! ${name(e.by)} DECLARED WAR ON YOU` : `${name(e.by)} declared war on ${name(target)}`;
        break;
      }
      case 'peace':
        text = `Peace: ${name(e.a)} and ${name(e.b)}`;
        break;
      case 'peaceOffer':
        if (e.to === this.you) text = `${name(e.from)} offers peace`;
        break;
      case 'peaceRefused':
        if (e.from === this.you) text = `${name(e.to)} refused peace`;
        break;
      case 'won':
        text = `${name(e.player)} wins`;
        break;
    }
    if (text) this.say(text);
  }

  /** Your troops in a region against what it can feed (only your own regions feed them). */
  private load(region: number): { load: number; cap: number } {
    const snap = this.snap as Snapshot;
    let load = 0;
    for (const b of snap.blobs) if (b[1] === this.you && b[6] === region && b[8] === 0) load += b[4] * UNITS[UNIT_INDEX[b[2]]].supplyNeed;
    return { load, cap: supplyCapacity(this.map.regions[region], snap.regions[region][2], this.techsOf(snap.regions[region][0])) };
  }

  /** The region panel's supply line: reach, and for your regions your load against capacity. */
  private supplyLine(region: number): string {
    const row = (this.snap as Snapshot).regions[region];
    if (!(row[3] & 4)) return 'cut off';
    const { load, cap } = this.load(region);
    if (row[0] !== this.you) return `feeds ${Math.round(cap)}`;
    return `load ${Math.round(load)}/${Math.round(cap)}${load > cap ? ' (overloaded)' : ''}`;
  }

  /** Why a unit is short of supply ('' if it isn't). */
  private supplyWhy(b: BlobRow): string {
    if (b[10] >= 0.99 || !this.snap) return '';
    if (this.map.regions[b[6]]?.sea) return `over ${SEA_SUPPLY_HOPS} seas from a port`;
    const row = this.snap.regions[b[6]];
    if (row[0] !== b[1]) return 'short in foreign land';
    if (!(row[3] & 4)) return 'cut off';
    const { load, cap } = this.load(b[6]);
    return `overloaded ${Math.round(load)}/${Math.round(cap)}`;
  }

  /** Units losing strength to supply: say where and why, once a minute per region. */
  private warnSupply(snap: Snapshot): void {
    if (this.you === null || !snap.players[this.you]?.alive) return;
    const short = new Map<number, string>();
    for (const b of snap.blobs) {
      if (b[1] !== this.you || b[8] > 0 || b[10] >= 0.99) continue;
      if (!short.has(b[6])) short.set(b[6], this.supplyWhy(b));
    }
    for (const [region, why] of short) {
      const last = this.supplyWarned.get(region) ?? -Infinity;
      if (snap.time - last < 60) continue;
      this.supplyWarned.set(region, snap.time);
      const name = this.map.regions[region].name;
      this.say(
        why.startsWith('overloaded')
          ? `Too many troops at ${name} (${why.slice(11)} supply): they wither. Spread out or build a city.`
          : why === 'cut off'
            ? `${name} is CUT OFF: units there wither`
            : `Troops at ${name} are short of supply (from your land next door)`,
      );
    }
  }

  /**
   * A line in the sitrep (5 at most). `group` ([key, before, item, after]) merges a run of the
   * same news into one line: "Market finished at Aberdeen, Glasgow +2".
   */
  private say(text: string, group?: [string, string, string, string]): void {
    const now = clock(this.snap?.time ?? 0);
    const top = this.feed[0];
    if (group && top?.group === group[0]) {
      top.items.push(group[2]);
      top.time = now;
      const shown = top.items.slice(-2).reverse();
      const more = top.items.length - shown.length;
      top.text = `${group[1]}${shown.join(', ')}${more ? ` +${more}` : ''}${group[3]}`;
    } else {
      this.feed.unshift({ time: now, text, group: group?.[0], items: group ? [group[2]] : [] });
      this.feed.length = Math.min(this.feed.length, 5);
    }
    $('#feed').replaceChildren(classbar('Sitrep'), ...this.feed.map((f) => el('div', {}, [el('time', {}, [f.time]), f.text])));
    $('#feed').classList.toggle('hidden', this.feed.length === 0);
  }


  private renderPanel(): void {
    const panel = $('#panel');
    const snap = this.snap;
    if (!snap) return;
    // Typing a split amount: leave the panel alone until the field loses focus.
    // (Unless the unit it's for is gone.)
    if (document.activeElement?.id === 'split-amount' && panel.contains(document.activeElement) && this.selected.size > 0) return;
    const sel = [...this.selected].map((id) => this.blob(id)).filter((b): b is BlobRow => !!b);
    if (sel.length) {
      panel.replaceChildren(...this.unitsPanel(sel));
      panel.classList.remove('hidden');
    } else if (this.region >= 0) {
      panel.replaceChildren(...this.regionPanel(this.map.regions[this.region]));
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  /** One unit; `inRegion`: listed under that region, so standing there goes unsaid. */
  private unitRow(b: BlobRow, selectable: boolean, inRegion = -1): HTMLElement {
    const type = UNIT_INDEX[b[2]];
    // Attacking enemies next door, or taking empty land from the border.
    const fought = (r: number) => !!this.snap?.blobs.some((x) => x[6] === r && this.atWar(x[1], b[1]));
    const next = b[7] >= 0 ? this.map.regions[b[7]].name : '';
    const where =
      b[8] > 0
        ? `to ${next}`
        : b[11] & 4 && b[7] >= 0
          ? `${fought(b[7]) ? 'attacking' : 'taking'} ${next}`
          : b[13] >= 0
            ? `shelling ${this.map.regions[b[13]].name}`
            : b[11] & 1 && b[7] >= 0
              ? `waiting to go to ${next}`
              : b[6] === inRegion
                ? ''
                : this.map.regions[b[6]].name;
    // Only what's worth saying: full supply, no training and not dug in go unmentioned.
    const status: string[] = [];
    if (b[5] > 0) status.push(`trained ${b[5]}`);
    if (b[10] < 0.99) status.push(`supply ${Math.round(b[10] * 100)}%${this.supplyWhy(b) ? ` (${this.supplyWhy(b)})` : ''}`);
    if (!UNITS[type].naval && this.map.regions[b[6]]?.sea) status.push('at sea');
    else if (!UNITS[type].naval && b[9] > 0) status.push(b[9] >= 0.99 ? 'dug in' : `digging in ${Math.round(b[9] * 100)}%`);
    const row = el('div', { class: `unit${this.selected.has(b[0]) ? ' sel' : ''}` }, [
      el('span', { class: 'swatch', style: `background:${colorOf(this.players, b[1])}` }),
      el('span', {}, [`${UNIT_NAME[type]} ${Math.ceil(b[3])}/${b[4]}`]),
      el('span', { class: 'meta' }, [status.join(' · '), ...(status.length && where ? [el('br')] : []), where]),
    ]);
    if (selectable) {
      row.onclick = (e) => {
        if (e.shiftKey) this.selected.add(b[0]);
        else this.selected = new Set([b[0]]);
        this.renderPanel();
      };
    }
    return row;
  }

  private unitsPanel(sel: BlobRow[]): HTMLElement[] {
    const strength = sel.reduce((s, b) => s + b[3], 0);
    const btn = (label: string, fn: () => void) => {
      const b = el('button', {}, [label]);
      b.onclick = () => {
        fn();
        this.renderPanel();
      };
      return b;
    };
    return [
      classbar('Units selected', `${sel.length}`),
      el('div', { class: 'sub' }, [`Strength ${Math.round(strength)} · right-click a region to send`]),
      el('div', { class: 'sub' }, ['Split halves each unit (both keep their training) · merge joins one type in one region, for some training']),
      el('div', { class: 'buttons' }, [
        btn('Split (X)', () => sel.forEach((b) => this.send({ o: 'split', blob: b[0] }))),
        btn('Merge (G)', () => this.mergeSelected()),
        btn('Halt (H)', () => this.send({ o: 'stop', blobs: sel.map((b) => b[0]) })),
        btn('Disband (Del)', () => this.disbandSelected()),
      ]),
      ...this.splitRow(sel, btn),
      ...sel.slice(0, 30).map((b) => this.unitRow(b, true)),
    ];
  }

  /** One unit standing still: split off a batch, half, or any amount. */
  private splitRow(sel: BlobRow[], btn: (label: string, fn: () => void) => HTMLElement): HTMLElement[] {
    if (sel.length !== 1 || sel[0][8] > 0 || sel[0][4] < 2) return [];
    const b = sel[0];
    const size = b[4];
    const batch = UNITS[UNIT_INDEX[b[2]]].batch;
    const split = (amount: number) => this.send({ o: 'split', blob: b[0], amount: Math.max(1, Math.min(size - 1, Math.floor(amount))) });
    const field = el('input', { id: 'split-amount', type: 'number', min: '1', max: String(size - 1), value: String(Math.min(batch, size - 1)) }) as HTMLInputElement;
    field.onkeydown = (e) => {
      if (e.key === 'Enter') {
        split(Number(field.value));
        field.blur();
        this.renderPanel();
      } else if (e.key === 'Escape') field.blur();
    };
    return [
      el('div', { class: 'buttons split' }, [
        el('span', { class: 'label' }, ['Split off']),
        ...(size > batch ? [btn(String(batch), () => split(batch))] : []),
        btn('½', () => split(size / 2)),
        field,
        btn('Split', () => split(Number(field.value))),
      ]),
    ];
  }

  private regionPanel(region: Region): HTMLElement[] {
    const snap = this.snap as Snapshot;
    const rr = snap.regions[region.id];
    const owner = rr[0];
    const country = this.map.countries.find((c) => c.id === region.country)?.name ?? region.country;
    const out: HTMLElement[] = [
      classbar('Intel // Region', owner === this.you && this.you !== null ? 'Friendly' : owner >= 0 ? 'Hostile' : 'Neutral'),
      el('h4', {}, [region.name]),
      el('div', { class: 'sub' }, [`${country} · ${region.terrain} · ${region.size}${region.traits.length ? ` · ${region.traits.join(', ')}` : ''}`]),
    ];
    const here = snap.blobs.filter((b) => b[6] === region.id && b[8] === 0);
    if (region.sea) {
      // The sea: nobody's. Ships sail it and shell its coasts; troops cross it from a port.
      const mine = snap.blobs.filter((b) => b[6] === region.id && b[1] === this.you).length;
      out[0] = classbar('Intel // Sea', 'Open sea');
      out[2] = el('div', { class: 'sub' }, ['Open sea: nobody owns it']);
      const coasts = region.coast.map((c) => this.map.regions[c.id].name);
      out.push(
        el('div', { class: 'grid2' }, [
          el('span', {}, ['Coasts']),
          el('span', {}, [coasts.length > 6 ? `${coasts.slice(0, 6).join(', ')} +${coasts.length - 6}` : coasts.join(', ') || 'none']),
          el('span', {}, ['Stack']),
          el('span', {}, [`${mine} / ${stackCap(region, 0, 0)} of yours`]),
        ]),
        el('div', { class: 'sub' }, [
          'Warships fight here and shell the coasts and seas next to it. Troops sent across the sea board at your port and land on the far coast; enemy warships in the way stop and sink them.',
        ]),
      );
      if (here.length) {
        out.push(el('div', { class: 'line' }, ['Units here']));
        for (const b of here) out.push(this.unitRow(b, b[1] === this.you, region.id));
      }
      return out;
    }
    // The stack cap counts every token in the region, moving out or waiting included.
    const myCount = snap.blobs.filter((b) => b[6] === region.id && b[1] === this.you).length;
    const used = rr[9] + rr[10] + rr[11] + rr[12] + rr[13] + rr[14] + (rr[1] > 0 ? 1 : 0) + (rr[3] & 1 ? 1 : 0) + (rr[3] & 2 ? 1 : 0) + (rr[3] & 8 ? 1 : 0) + (rr[3] & 16 ? 1 : 0);
    // The essentials up front; the rest folds under Details (remembered while you play).
    const info: Array<[string, string]> = [
      ['Owner', owner >= 0 ? (this.players[owner]?.name ?? '?') : 'Neutral'],
      ['City', rr[2] > 0 ? `level ${rr[2]} / ${MAX_CITY}` : 'none'],
      ['Produces', this.yieldLine(region, rr)],
      ['Slots', `${used} / ${slotsOf(region, rr[2])} built`],
      ...(rr[1] > 0 ? [['Fort', `level ${rr[1]} / ${MAX_FORT}`] as [string, string]] : []),
    ];
    // Details, three lines at most: supply (and how far a city's reaches), what it stores, and
    // the stack (plus how long it takes to capture, for land that isn't yours).
    const reach = rr[2] > 0 ? ` · reaches ${supplyReach(rr[2], this.techsOf(owner))} regions` : '';
    const capture = owner !== this.you || this.you === null ? ` · capture ${Math.round(captureSeconds(region, rr[1], 0, owner < 0))} s` : '';
    const more: Array<[string, string | Node]> = [
      ['Supply', (owner >= 0 ? this.supplyLine(region.id) : 'none') + reach],
      ...(rr[2] > 0 || rr[13] > 0 ? [['Stores', costChips(storeOf(rr[2], rr[13], this.techsOf(owner)))] as [string, Node]] : []),
      ['Stack', `${myCount} / ${stackCap(region, rr[2], rr[1])} yours${capture}`],
    ];
    const grid = (rows: Array<[string, string | Node]>) => el('div', { class: 'grid2' }, rows.flatMap(([k, v]) => [el('span', {}, [k]), el('span', {}, [v])]));
    const details = el('details', this.detailsOpen ? { open: '' } : {}, [el('summary', {}, ['Details']), grid(more)]);
    details.addEventListener('toggle', () => (this.detailsOpen = (details as HTMLDetailsElement).open));
    out.push(grid(info), details);
    if (rr[4] >= 0) {
      out.push(el('div', {}, [`Being captured by ${this.players[rr[4]]?.name ?? '?'}`]), cellBar(rr[5]));
    }

    if (owner === this.you && this.you !== null) {
      const res = this.resources();
      // What's built (each can be knocked down to free its slot).
      const built: Array<[BuildingKind, string]> = [];
      for (const k of ECON_KINDS) for (let i = 0; i < rr[ECON_FIELD[k]]; i++) built.push([k, BUILD_LABEL[k]]);
      if (rr[1] > 0) built.push(['fort', `Fort ${rr[1]}`]);
      if (rr[3] & 1) built.push(['barracks', 'Barracks']);
      if (rr[3] & 2) built.push(['factory', 'Factory']);
      if (rr[3] & 8) built.push(['port', 'Port']);
      if (rr[3] & 16) built.push(['battery', 'Coast guns']);
      for (let i = 0; i < rr[13]; i++) built.push(['depot', 'Depot']);
      // One wrapped row: each building's name with × to demolish it.
      if (built.length) {
        out.push(
          el('div', { class: 'built' }, [
            el('span', { class: 'label' }, ['Built']),
            ...built.map(([kind, name]) =>
              el('button', { class: 'chipx', 'data-act': 'demolish', 'data-region': String(region.id), 'data-kind': kind, 'aria-label': `Demolish ${name}` }, [
                name,
                el('b', {}, ['×']),
              ]),
            ),
          ]),
        );
      }
      const pending = this.pending(region.id);
      if (pending.length) {
        // Under way, then what waits behind it; levels count up per kind.
        const levels = { fort: rr[1], city: rr[2] };
        const label = ([kind, target]: [BuildingKind, number]) => {
          if (kind === 'fort' || kind === 'city') {
            levels[kind] += 1;
            return kind === 'city' && levels.city === 1 ? 'Found city' : `${BUILD_LABEL[kind]} ${levels[kind]}`;
          }
          return kind === 'road' ? `Road to ${this.map.regions[target]?.name ?? '?'}` : BUILD_LABEL[kind];
        };
        const cancel = (index: number) =>
          el('button', { class: 'x', 'data-act': 'unbuild', 'data-region': String(region.id), 'data-index': String(index), 'aria-label': 'Cancel' }, ['×']);
        pending.forEach((p, i) => {
          out.push(el('div', { class: `line build${i ? ' queued' : ''}` }, [el('span', {}, [`${i ? 'Next' : 'Building'}: ${label(p)}`]), cancel(i)]));
          if (i === 0) out.push(cellBar(rr[7]));
        });
      }
      for (const line of snap.production.filter((p) => p.region === region.id)) out.push(...this.productionLine(line, res));
    }

    if (here.length) {
      out.push(el('div', { class: 'line' }, ['Units here']));
      for (const b of here) out.push(this.unitRow(b, b[1] === this.you, region.id));
    }
    return out;
  }

  /** What a region makes per second, or why it makes nothing. */
  private yieldLine(region: Region, rr: Snapshot['regions'][number]): string {
    const y = regionYield(region, rr[2], { farm: rr[9], mine: rr[10], well: rr[11], market: rr[12], lab: rr[14] }, this.techsOf(rr[0]));
    const parts = RESOURCES.filter((k) => y[k] > 0).map((k) => `+${Math.round(y[k] * 100) / 100} ${k}/s`);
    if (!parts.length) return 'nothing (build a farm, mine, oil well or market)';
    const idle = rr[0] >= 0 && !(rr[3] & 4) ? ' (stopped: out of supply)' : '';
    return parts.join(', ') + idle;
  }

  private productionLine(line: ProductionView, res: Resources): HTMLElement[] {
    // The building on one line (what it's doing, Repeat, × to cancel the last order), then one
    // button per unit it makes: hotkey, unit, how many are queued and the cost, filled from the
    // left as the one under way gets made.
    const waiting = line.queue.length > 0 && line.progress < 0;
    const status = line.queue.length ? (waiting ? 'waiting for resources' : `${line.queue.length} queued`) : 'idle';
    // Shown as clicked at once (the server's answer comes with the next snapshot).
    const key = `${line.region}:${line.building}`;
    const asked = this.repeatAsked.get(key);
    if (asked && (asked.on === line.repeat || performance.now() > asked.until)) this.repeatAsked.delete(key);
    const on = this.repeatAsked.get(key)?.on ?? line.repeat;
    const repeat = el('button', { class: `x${on ? ' on' : ''}`, 'aria-pressed': String(on) }, ['Repeat']);
    repeat.onclick = () => {
      this.repeatAsked.set(key, { on: !on, until: performance.now() + 2000 });
      this.send({ o: 'repeat', region: line.region, building: line.building, on: !on });
      this.renderPanel();
    };
    const cancel = el('button', { class: 'x', 'aria-label': 'Cancel last order' }, ['×']) as HTMLButtonElement;
    cancel.disabled = line.queue.length === 0;
    cancel.onclick = () => this.send({ o: 'cancel', region: line.region, building: line.building });
    const out: HTMLElement[] = [
      el('div', { class: 'prodhead' }, [el('b', {}, [BUILD_LABEL[line.building]]), el('span', { class: waiting ? 'warn' : '' }, [status]), repeat, cancel]),
    ];
    for (const type of unitsOf(line.building)) {
      const stats = unitStats(type, this.myTechs());
      const needs = UNIT_TECH[type];
      const locked = needs !== undefined && !this.myTechs().includes(needs);
      const queued = line.queue.filter((t) => t === type).length;
      const making = line.queue[0] === type ? Math.max(0, line.progress) : 0;
      const add = el(
        'button',
        { class: 'prod', style: `--p:${Math.round(making * 100)}%` },
        locked
          ? [`${UNIT_NAME[type]}: research ${tech(needs as TechId).name} first (T)`]
          : [
              el('b', {}, [UNIT_KEY[type].toUpperCase()]),
              `${stats.batch} ${UNIT_NAME[type].toLowerCase()}`,
              queued ? el('span', { class: 'n' }, [`×${queued}`]) : '',
              el('span', { class: 'right' }, [costChips(stats.cost, res), `${stats.buildTime}s`]),
            ],
      ) as HTMLButtonElement;
      add.disabled = locked || line.queue.length >= 5;
      add.onclick = () => this.send({ o: 'produce', region: line.region, building: line.building, unit: type });
      out.push(add);
    }
    return out;
  }


}

const HELP_FOLDED = 'openfork.helpFolded';
const UI_SCALE = 'openfork.uiScale';
/** Set once a game has been played on this browser. */
const PLAYED = 'openfork.played';

/** localStorage, or nothing when it's blocked. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: not remembered
  }
}

function clock(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function afford(res: Resources, cost: Resources): boolean {
  return RESOURCES.every((k) => res[k] >= cost[k]);
}

const buildingIcons = new Map<BuildingKind, string>();
function buildingIcon(kind: BuildingKind): string {
  let url = buildingIcons.get(kind);
  if (!url) {
    url = spriteUrl(ICONS[kind], 2);
    buildingIcons.set(kind, url);
  }
  return url;
}

/** A cost as resource icons and amounts; what you can't pay yet is marked short. */
function costChips(cost: Partial<Resources>, have?: Resources): HTMLElement {
  return el(
    'span',
    { class: 'cost' },
    RESOURCES.filter((k) => (cost[k] ?? 0) > 0).map((k) =>
      el('span', { class: `chip${have && have[k] < (cost[k] ?? 0) ? ' short' : ''}` }, [el('img', { src: hudIcon(k), alt: k }), fmt(cost[k] ?? 0)]),
    ),
  );
}

function round1(n: number): string {
  return String(Math.round(n * 100) / 100);
}
