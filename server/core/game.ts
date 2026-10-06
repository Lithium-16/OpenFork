// One running match: the simulation, the bots, who is playing which country, and the
// snapshots sent to clients.
import {
  BUILDING_INDEX,
  type BlobRow,
  type GameEvent,
  type GamePlayer,
  type Order,
  type PlayerRow,
  type ProductionView,
  type RegionRow,
  type Snapshot,
  UNIT_INDEX,
} from '../../shared/protocol.ts';
import { type BotDifficulty, type BotSetting, DISCONNECT_BOT_SECONDS, type StartingResources, unitStats } from '../../shared/rules.ts';
import { Bot } from './bot.ts';
import { mulberry32 } from './rng.ts';
import { dumpState, SAVE_VERSION, type SaveFile } from './save.ts';
import { type PlayerSetup, Sim } from './sim.ts';
import type { SimState } from './state.ts';
import type { World } from './world.ts';

export interface Seat {
  setup: PlayerSetup;
  /** Identity of the person playing it, or null for a bot country. */
  human: string | null;
}

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

export class Game {
  readonly sim: Sim;
  readonly mapId: string;
  readonly players: GamePlayer[];
  readonly startedAt: number;
  /** identity id → player index */
  readonly humans = new Map<string, number>();
  private readonly bots = new Map<number, Bot>();
  /** player index → sim time they dropped */
  private readonly away = new Map<number, number>();
  /** Bots that play a country for good (empty seats, people who left). */
  private readonly difficulty: BotDifficulty;
  /** Bots standing in for someone who dropped, until they're back. */
  private readonly standIn: BotDifficulty;
  private readonly seed: number;
  private pending: GameEvent[] = [];
  over = false;

  private readonly starting: StartingResources;
  private readonly botSetting: BotSetting;

  constructor(world: World, seats: Seat[], starting: StartingResources, bots: BotSetting, seed: number, now: number) {
    this.mapId = world.map.id;
    this.starting = starting;
    this.botSetting = bots;
    // Pure PvP: no bot ever attacks anyone; a defensive one only holds the land of a person
    // who dropped or left.
    this.difficulty = bots === 'none' ? 'defensive' : bots;
    this.standIn = bots === 'none' ? 'defensive' : 'normal';
    this.seed = seed;
    this.startedAt = now;
    this.sim = new Sim(
      world,
      seats.map((s) => s.setup),
      starting,
    );
    this.players = seats.map((s, id) => ({
      id,
      name: s.setup.name,
      country: s.setup.country,
      color: s.setup.color,
      human: s.human !== null,
    }));
    seats.forEach((s, id) => {
      if (s.human) this.humans.set(s.human, id);
      else this.bots.set(id, this.makeBot(id, this.difficulty));
    });
  }

  private makeBot(player: number, difficulty: BotDifficulty, standIn = false): Bot {
    return new Bot(player, difficulty, mulberry32(this.seed * 31 + player), standIn);
  }

  playerOf(identity: string): number | null {
    return this.humans.get(identity) ?? null;
  }

  /** A person dropped or came back. Away too long, and a bot plays for them. */
  setConnected(identity: string, connected: boolean): void {
    const id = this.humans.get(identity);
    if (id === undefined) return;
    const p = this.sim.state.players[id];
    if (connected) {
      // A one-person game that stood still while they were gone goes on.
      if (this.autoPaused) this.paused = this.autoPaused = false;
      this.away.delete(id);
      if (p.control === 'bot') {
        this.bots.delete(id);
        p.control = 'human';
      }
    } else if (!this.away.has(id)) {
      // Alone in it: the game waits for them rather than a bot taking over.
      if (this.solo && !this.paused) this.paused = this.autoPaused = true;
      this.away.set(id, this.sim.state.time);
    }
  }

  /** The person left the lobby for good: a bot plays their country from now on. */
  abandon(identity: string): void {
    const id = this.humans.get(identity);
    if (id === undefined) return;
    this.humans.delete(identity);
    this.away.delete(id);
    this.sim.state.players[id].control = 'bot';
    if (!this.bots.has(id)) this.bots.set(id, this.makeBot(id, this.difficulty, true));
  }

  order(identity: string, order: Order): string | null {
    const id = this.humans.get(identity);
    if (id === undefined) return 'you are watching this game';
    if (this.sim.state.players[id].control === 'bot') this.setConnected(identity, true);
    const s = this.sim;
    switch (order.o) {
      case 'move':
        return s.move(id, order.blobs, order.to, order.then ?? false);
      case 'stop':
        return s.stop(id, order.blobs);
      case 'split':
        return s.split(id, order.blob, order.amount);
      case 'merge':
        return s.merge(id, order.blobs);
      case 'disband':
        return s.disband(id, order.blobs);
      case 'build':
        return s.build(id, order.region, order.kind, order.target ?? -1);
      case 'demolish':
        return s.demolish(id, order.region, order.kind);
      case 'produce':
        return s.produce(id, order.region, order.building, order.unit);
      case 'repeat':
        return s.setRepeat(id, order.region, order.building, order.on);
      case 'cancel':
        return s.cancel(id, order.region, order.building);
      case 'unbuild':
        return s.unbuild(id, order.region, order.index);
      case 'war':
        return s.declareWar(id, order.player);
      case 'peace':
        return s.offerPeace(id, order.player);
      case 'refuse':
        return s.refusePeace(id, order.player);
      case 'surrender':
        return s.surrender(id);
      case 'research':
        return s.research(id, order.tech);
      case 'unresearch':
        return s.unresearch(id);
      case 'pause':
        if (!this.solo) return 'only a game with one person in it can be paused';
        this.paused = order.on;
        this.autoPaused = false;
        return null;
    }
  }

  /** Paused by its one player (time stands still). */
  paused = false;
  /** Paused because its one player dropped (it goes on when they're back). */
  private autoPaused = false;

  /** One person plays; the rest are bots. */
  get solo(): boolean {
    return this.humans.size === 1;
  }

  /** The game as a save file (a one-person game), or null if it can't be saved. */
  save(): SaveFile | null {
    if (!this.solo || this.over) return null;
    const human = [...this.humans.values()][0];
    if (!this.sim.state.players[human].alive) return null;
    return {
      v: SAVE_VERSION,
      map: this.mapId,
      starting: this.starting,
      bots: this.botSetting,
      seed: this.seed,
      players: this.players,
      human,
      sim: dumpState(this.sim.state),
    };
  }

  /** A saved game, back again: `identity` plays the saved person's country. It starts paused. */
  static restore(world: World, save: SaveFile, state: SimState, identity: string, now: number): Game {
    const seats: Seat[] = save.players.map((p, i) => ({
      human: i === save.human ? identity : null,
      setup: { name: p.name, country: p.country, color: p.color, control: i === save.human ? 'human' : 'bot', difficulty: state.players[i].difficulty },
    }));
    const game = new Game(world, seats, save.starting, save.bots, save.seed, now);
    game.sim.load(state);
    // Bots for countries already out of the game have nothing to do.
    for (const [id] of game.bots) if (!state.players[id].alive) game.bots.delete(id);
    game.paused = true;
    return game;
  }

  /** Stops the game with no winner (nobody left to play or watch it). */
  end(): void {
    this.over = true;
  }

  tick(): void {
    if (this.over || this.paused) return;
    for (const [id, since] of this.away) {
      const p = this.sim.state.players[id];
      if (p.control === 'human' && this.sim.state.time - since >= DISCONNECT_BOT_SECONDS) {
        p.control = 'bot';
        this.bots.set(id, this.makeBot(id, this.standIn, true));
      }
    }
    for (const bot of this.bots.values()) bot.act(this.sim);
    this.sim.tick();
    this.pending.push(...this.sim.drainEvents());
    if (this.sim.state.winner !== null) this.over = true;
  }

  /** Events since the last call (they go out with the next snapshots). */
  takeEvents(): GameEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  /**
   * What one person may see of the shared snapshot: their own stocks, income, upkeep, stores
   * and research, but nobody else's; offers of peace and looting only between others are
   * left out. (Techs stay: they change what everyone's units can do.)
   */
  viewFor(shared: Omit<Snapshot, 'production' | 'routes' | 'builds'>, you: number | null): Omit<Snapshot, 'production' | 'routes' | 'builds'> {
    const hidden = { res: [0, 0, 0, 0, 0], income: [0, 0, 0, 0, 0], upkeep: 0, cap: [0, 0, 0, 0, 0], research: null, broke: false };
    const players = shared.players.map((p, i) => (i === you ? p : { ...p, ...hidden }) as PlayerRow);
    const mine = (a: number, b: number) => you !== null && (a === you || b === you);
    const offers = shared.offers.filter(([a, b]) => mine(a, b));
    const events = shared.events.filter((e) => {
      if (e.kind === 'peaceOffer' || e.kind === 'peaceRefused') return mine(e.from, e.to);
      if (e.kind === 'looted') return mine(e.by, e.from);
      return true;
    });
    return { ...shared, players, offers, events };
  }

  /** The parts of a snapshot that are the same for everyone. */
  sharedSnapshot(events: GameEvent[]): Omit<Snapshot, 'production' | 'routes' | 'builds'> {
    const st = this.sim.state;
    const players: PlayerRow[] = st.players.map((p) => ({
      alive: p.alive,
      res: [round(p.resources.money, 1), round(p.resources.manpower, 1), round(p.resources.steel, 1), round(p.resources.oil, 1), round(p.resources.research, 1)],
      income: [round(p.income.money, 2), round(p.income.manpower, 2), round(p.income.steel, 2), round(p.income.oil, 2), round(p.income.research, 2)],
      upkeep: round(p.upkeep, 2),
      cap: [Math.round(p.cap.money), Math.round(p.cap.manpower), Math.round(p.cap.steel), Math.round(p.cap.oil), Math.round(p.cap.research)],
      techs: [...p.techs],
      research: p.research ? [p.research.tech, round(p.research.paid / p.research.cost, 3)] : null,
      broke: p.broke,
      bot: p.control === 'bot',
    }));
    const regions: RegionRow[] = st.regions.map((r) => [
      r.owner,
      r.fort,
      r.city,
      (r.barracks ? 1 : 0) | (r.factory ? 2 : 0) | (r.supplied ? 4 : 0) | (r.port ? 8 : 0) | (r.battery ? 16 : 0),
      r.capture ? r.capture.by : -1,
      r.capture ? round(r.capture.progress, 2) : 0,
      r.construction ? BUILDING_INDEX.indexOf(r.construction.kind) : -1,
      r.construction ? round(r.construction.progress / r.construction.seconds, 2) : 0,
      r.construction ? r.construction.target : -1,
      r.econ.farm,
      r.econ.mine,
      r.econ.well,
      r.econ.market,
      r.depots,
      r.econ.lab,
    ]);
    const blobs: BlobRow[] = [];
    for (const b of st.blobs.values()) {
      blobs.push([
        b.id,
        b.owner,
        UNIT_INDEX.indexOf(b.type),
        round(b.strength, 1),
        b.size,
        Math.round(b.training),
        b.region,
        b.path.length ? b.path[0] : -1,
        round(b.progress, 3),
        round(b.entrench, 2),
        round(b.supply, 2),
        (b.waiting ? 1 : 0) | (b.crossedRiver ? 2 : 0) | (b.attacking >= 0 ? 4 : 0),
        b.from,
        b.bombarding,
      ]);
    }
    const pair = (key: string, sep: string) => key.split(sep).map(Number) as [number, number];
    const wars = [...st.wars].map((k) => pair(k, ':'));
    const offers = [...st.peaceOffers].map(([k, until]) => [...pair(k, '>'), Math.ceil(until - st.time)] as [number, number, number]);
    const truces = [...st.truces]
      .filter(([, until]) => until > st.time)
      .map(([k, until]) => [...pair(k, ':'), Math.ceil(until - st.time)] as [number, number, number]);
    const roads = [...st.roads].map((k) => pair(k, ':'));
    const shelling = [...this.sim.batteryTargets];
    return { time: round(st.time, 1), players, regions, blobs, events, wars, offers, truces, roads, shelling, paused: this.paused };
  }

  /** The remaining route of each of `player`'s moving units: [blob id, ...regions]. */
  routesFor(player: number | null): number[][] {
    if (player === null) return [];
    const out: number[][] = [];
    for (const b of this.sim.state.blobs.values()) if (b.owner === player && b.path.length) out.push([b.id, ...b.path]);
    return out;
  }

  /** The builds waiting in each of `player`'s regions: [region, building index...]. */
  buildsFor(player: number | null): number[][] {
    if (player === null) return [];
    const out: number[][] = [];
    this.sim.state.regions.forEach((r, i) => {
      if (r.owner === player && r.buildQueue.length) out.push([i, ...r.buildQueue.flatMap((c) => [BUILDING_INDEX.indexOf(c.kind), c.target])]);
    });
    return out;
  }

  productionFor(player: number | null): ProductionView[] {
    if (player === null) return [];
    const out: ProductionView[] = [];
    this.sim.state.regions.forEach((r, i) => {
      if (r.owner !== player) return;
      for (const building of ['barracks', 'factory', 'port'] as const) {
        if (!r[building]) continue;
        const line = r.production[building];
        const head = line.queue[0];
        out.push({
          region: i,
          building,
          queue: [...line.queue],
          progress: head && line.progress >= 0 ? round(line.progress / unitStats(head, this.sim.techsOf(player)).buildTime, 2) : -1,
          repeat: line.repeat,
        });
      }
    });
    return out;
  }
}
