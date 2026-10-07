// The game simulation (DESIGN.md §3–§7). Pure: no timers, sockets or randomness. The host
// calls tick() every TICK_MS and order methods when players act; orders return an error
// string when refused, null when done.
import {
  type BotDifficulty,
  type BuildingKind,
  BROKE_LOSS,
  BASE_RESEARCH,
  BROKE_TRAINING,
  bombardFortShare,
  BATTERY_BOMBARD,
  BATTERY_LANDING_BONUS,
  BUILD_NEEDS,
  BUILD_QUEUE,
  buildCost,
  CAPTURE_DECAY,
  canBuildOn,
  ECON_KINDS,
  econSlots,
  type EconKind,
  FOUND_CITY_MIN_HOPS,
  HINTERLAND_HOPS,
  MAX_CITY,
  maxLevel,
  NEUTRAL_CITY_LEVEL,
  ROAD_SUPPLY_HOP,
  slotsOf,
  START_CAPITAL_LEVEL,
  supplyReach,
  CROSS_SECONDS,
  AT_SEA_ATTACK,
  AT_SEA_DEFENSE,
  CUT_OFF_SECONDS,
  EMBARK_SECONDS,
  LANDING_ATTACK,
  SEA_SUPPLY_HOPS,
  TRANSPORT_SPEED,
  DISBAND_REFUND,
  DAMAGE_RATE,
  roadSpeed,
  drillCap,
  DRILL_RATE,
  ENEMY_LAND_MOVE,
  entrenchBonus,
  entrenchSeconds,
  FLANK_BONUS,
  FLANK_MAX_EXTRA,
  DOMINATION_SHARE,
  FORT_BONUS,
  FORT_SIEGE_POWER,
  FORT_MOVE_PENALTY,
  MAX_TRAINING,
  MERGE_MIN_STRENGTH,
  MERGE_PENALTY,
  MIN_STRENGTH,
  OUT_OF_SUPPLY_LOSS,
  OUT_OF_SUPPLY_TRAINING,
  PEACE_OFFER_SECONDS,
  type ProductionBuilding,
  REFILL_RATE,
  regionYield,
  RESOURCES,
  type Resources,
  RETREAT_STRENGTH_LOSS,
  RETREAT_TRAINING_LOSS,
  RIVER_BONUS,
  ROUT_HOPS,
  ROUT_LOSS,
  ROUT_ODDS,
  ROUT_SHARE,
  START_EXTRA_REGIONS,
  START_INFANTRY,
  storeOf,
  STARTING,
  STARTING_MULTIPLIER,
  type StartingResources,
  TERRAIN_DEFENSE,
  TERRAIN_MOVE,
  TICK_MS,
  TRAINING_DAMAGE,
  TRAINING_PROTECTION,
  TRUCE_SECONDS,
  unitsOf,
  UNIT_TECH,
  type TechId,
  type Techs,
  TECHS,
  techCost,
  whyNotResearch,
  unitStats,
  type UnitStats,
  type UnitType,
  UNITS,
  VETERANCY_RATE,
} from '../../shared/rules.ts';
import {
  type Blob,
  type Construction,
  type Front,
  emptyLine,
  pairKey,
  emptyRegion,
  NEUTRAL,
  type Player,
  type RegionState,
  type SimEvent,
  type SimState,
} from './state.ts';
import type { World } from './world.ts';

export interface PlayerSetup {
  name: string;
  country: string;
  color: string;
  control: 'human' | 'bot';
  difficulty: BotDifficulty;
}

/** The most production orders one building can hold. */
export const MAX_QUEUE = 5;
/** Path cost added for regions with enemy blobs in them, so routes go around fights. */
const FIGHT_PATH_PENALTY = 40;

const zero = (): Resources => ({ money: 0, manpower: 0, steel: 0, oil: 0, research: 0 });

export class Sim {
  readonly world: World;
  readonly state: SimState;
  /** Things that happened since the last drain (for the UI and bots). */
  events: SimEvent[] = [];

  constructor(world: World, players: PlayerSetup[], starting: StartingResources = 'normal') {
    this.world = world;
    this.state = {
      time: 0,
      players: [],
      regions: world.regions.map(() => emptyRegion()),
      blobs: new Map(),
      nextBlobId: 1,
      winner: null,
      wars: new Set(),
      warActivity: new Map(),
      truces: new Map(),
      peaceOffers: new Map(),
      roads: new Set(),
      fronts: [],
    };
    // Cities: real size in the countries being played, small elsewhere (no free metropolis).
    const played = new Set(players.map((p) => p.country));
    world.regions.forEach((r, i) => {
      if (r.city) this.state.regions[i].city = played.has(r.country) ? r.city : NEUTRAL_CITY_LEVEL;
    });
    const taken = new Set<number>();
    players.forEach((p, id) => {
      const country = world.map.countries.find((c) => c.id === p.country);
      if (!country || country.capital < 0) throw new Error(`country ${p.country} can't be played on ${world.map.id}`);
      const mult = STARTING_MULTIPLIER[starting];
      const player: Player = {
        id,
        name: p.name,
        country: p.country,
        color: p.color,
        control: p.control,
        difficulty: p.difficulty,
        alive: true,
        capital: country.capital,
        resources: {
          money: STARTING.money * mult,
          manpower: STARTING.manpower * mult,
          steel: STARTING.steel * mult,
          oil: STARTING.oil * mult,
          research: STARTING.research * mult,
        },
        broke: false,
        income: zero(),
        cap: zero(),
        techs: [],
        research: null,
        upkeep: 0,
      };
      this.state.players.push(player);
      taken.add(country.capital);
    });
    for (const p of this.state.players) this.setUpStart(p, taken);
    this.updateSupply();
  }

  private setUpStart(p: Player, taken: Set<number>): void {
    const owned = [p.capital];
    // The capital's neighbours: same country first, then the longest borders.
    const capital = this.world.regions[p.capital];
    const around = [...capital.neighbors]
      .filter((n) => !taken.has(n.id) && this.state.regions[n.id].owner === NEUTRAL)
      .sort((a, b) => {
        const sa = this.world.regions[a.id].country === p.country ? 1 : 0;
        const sb = this.world.regions[b.id].country === p.country ? 1 : 0;
        return sb - sa || b.border - a.border;
      });
    for (const n of around.slice(0, START_EXTRA_REGIONS)) owned.push(n.id);
    for (const r of owned) {
      this.state.regions[r].owner = p.id;
      taken.add(r);
    }
    const cap = this.state.regions[p.capital];
    cap.barracks = true;
    cap.city = Math.max(cap.city, START_CAPITAL_LEVEL);
    let placed = 0;
    for (const r of owned) {
      while (placed < START_INFANTRY && this.count(p.id, r) < this.stackCap(r)) {
        this.spawn(p.id, 'infantry', r);
        placed++;
      }
    }
  }

  // -- queries ----------------------------------------------------------------------------

  player(id: number): Player | undefined {
    return this.state.players[id];
  }

  /** Blobs by region, rebuilt only after one changed region, spawned or died. A unit on the
   * move is still in the region it's leaving (the hop is a timer): it fights, is shelled and
   * holds the region there. Ships in port are left out: they never fight on land. */
  private index: Map<number, Blob[]> | null = null;
  private indexSize = -1;
  /** Tokens per owner and region, for the stack cap (key: owner * regions + region). */
  private tokens = new Map<number, number>();

  private standing(): Map<number, Blob[]> {
    // The size check also catches blobs added or removed from outside (tests).
    if (this.index && this.indexSize === this.state.blobs.size) return this.index;
    const index = new Map<number, Blob[]>();
    const n = this.world.regions.length;
    this.tokens = new Map();
    for (const b of this.state.blobs.values()) {
      if (this.docked(b)) continue;
      const list = index.get(b.region);
      if (list) list.push(b);
      else index.set(b.region, [b]);
      const k = b.owner * n + b.region;
      this.tokens.set(k, (this.tokens.get(k) ?? 0) + 1);
    }
    this.index = index;
    this.indexSize = this.state.blobs.size;
    return index;
  }

  /** Takes on a whole state (a loaded save): caches are dropped and supply worked out again. */
  load(state: SimState): void {
    Object.assign(this.state, state);
    this.index = null;
    this.yields.length = 0;
    this.updateCaps();
    this.updateSupply();
  }

  /** Call after a blob changes region, spawns or leaves the game. */
  private touch(): void {
    this.index = null;
  }

  /** A ship in port: out of land fights, and it takes no room there. */
  private docked(b: Blob): boolean {
    return !!UNITS[b.type].naval && !this.world.isSea(b.region);
  }

  /** Blobs in a region (on the move out of it too), docked ships aside. */
  blobsIn(region: number): Blob[] {
    return [...(this.standing().get(region) ?? [])];
  }

  /**
   * An owner's tokens in a region, for the stack cap: every one, standing, leaving or
   * waiting to go on (ships in port take no room).
   */
  count(owner: number, region: number): number {
    this.standing();
    return this.tokens.get(owner * this.world.regions.length + region) ?? 0;
  }

  stackCap(region: number): number {
    const rs = this.state.regions[region];
    return this.world.stackCap(region, rs.city, rs.fort);
  }

  /** Owners with blobs standing in a region. */
  ownersIn(region: number): Set<number> {
    const s = new Set<number>();
    for (const b of this.standing().get(region) ?? []) s.add(b.owner);
    return s;
  }

  /** Two sides at war stand in this region. */
  contested(region: number): boolean {
    const owners = [...this.ownersIn(region)];
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) if (this.atWar(owners[i], owners[j])) return true;
    }
    return false;
  }

  /** Units of someone at war with `owner` stand in this region. */
  hostileIn(region: number, owner: number): boolean {
    for (const b of this.standing().get(region) ?? []) if (this.atWar(b.owner, owner)) return true;
    return false;
  }

  /** Warships of someone at war with `owner` are in this sea (troops can't sail in: a blockade). */
  blockaded(sea: number, owner: number): boolean {
    for (const b of this.standing().get(sea) ?? []) if (UNITS[b.type].naval && this.atWar(b.owner, owner)) return true;
    return false;
  }

  // -- diplomacy --------------------------------------------------------------------------

  atWar(a: number, b: number): boolean {
    return a !== b && a >= 0 && b >= 0 && this.state.wars.has(pairKey(a, b));
  }

  /** Another player's land is closed to `owner` while they're at peace. */
  private closedTo(owner: number, region: number): boolean {
    const o = this.state.regions[region].owner;
    return o !== NEUTRAL && o !== owner && !this.atWar(o, owner);
  }

  inTruce(a: number, b: number): boolean {
    return (this.state.truces.get(pairKey(a, b)) ?? -1) > this.state.time;
  }

  /** `by` goes to war with `target` (attacking someone does this too). */
  declareWar(by: number, target: number): string | null {
    const a = this.player(by);
    const b = this.player(target);
    if (!a?.alive || !b?.alive || by === target) return 'no such country';
    if (this.atWar(by, target)) return null;
    if (this.inTruce(by, target)) return `truce with ${b.name} for ${Math.ceil((this.state.truces.get(pairKey(by, target)) ?? 0) - this.state.time)} s`;
    const key = pairKey(by, target);
    this.state.wars.add(key);
    this.state.warActivity.set(key, this.state.time);
    this.state.peaceOffers.delete(`${by}>${target}`);
    this.state.peaceOffers.delete(`${target}>${by}`);
    this.events.push({ kind: 'war', a: by, b: target, by });
    return null;
  }

  /** "from>to" → sim time until which `from` may not offer `to` peace again (refused). */
  private readonly refusedUntil = new Map<string, number>();

  /** Offers peace, or accepts it if the other side already offered. */
  offerPeace(from: number, to: number): string | null {
    if (!this.player(from)?.alive || !this.player(to)?.alive) return 'no such country';
    if (!this.atWar(from, to)) return 'not at war';
    if (this.state.peaceOffers.has(`${to}>${from}`)) {
      this.makePeace(from, to);
      return null;
    }
    if (this.state.peaceOffers.has(`${from}>${to}`)) return 'peace already offered';
    const wait = Math.ceil((this.refusedUntil.get(`${from}>${to}`) ?? 0) - this.state.time);
    if (wait > 0) return `they just refused: wait ${wait} s`;
    this.state.peaceOffers.set(`${from}>${to}`, this.state.time + PEACE_OFFER_SECONDS);
    this.events.push({ kind: 'peaceOffer', from, to });
    return null;
  }

  /** Turns down an offer of peace. */
  refusePeace(by: number, from: number): string | null {
    if (!this.state.peaceOffers.delete(`${from}>${by}`)) return 'no offer to refuse';
    // No asking again straight away.
    this.refusedUntil.set(`${from}>${by}`, this.state.time + PEACE_OFFER_SECONDS);
    this.events.push({ kind: 'peaceRefused', from, to: by });
    return null;
  }

  /** Ends a war: a truce starts, and each side's units in the other's land go home. */
  private makePeace(a: number, b: number): void {
    const key = pairKey(a, b);
    this.state.wars.delete(key);
    this.state.peaceOffers.delete(`${a}>${b}`);
    this.state.peaceOffers.delete(`${b}>${a}`);
    this.state.truces.set(key, this.state.time + TRUCE_SECONDS);
    this.state.regions.forEach((rs) => {
      if (rs.capture && ((rs.capture.by === a && rs.owner === b) || (rs.capture.by === b && rs.owner === a))) rs.capture = null;
    });
    for (const blob of [...this.state.blobs.values()]) {
      const other = blob.owner === a ? b : blob.owner === b ? a : -1;
      if (other < 0) continue;
      if (this.state.regions[blob.region].owner === other) this.sendHome(blob);
      else if (blob.path.some((r) => this.state.regions[r].owner === other)) {
        // On its way into their land: stays where it is.
        blob.path = [];
        blob.progress = 0;
      }
    }
    this.events.push({ kind: 'peace', a, b });
  }

  /** A unit in the land of a country it's at peace with goes home through that land (or, with
   * no way home, is interned: it leaves the game). */
  private sendHome(blob: Blob): void {
    const through = this.state.regions[blob.region].owner;
    const home = this.nearestOwn(blob);
    const path = home === null ? null : this.route(blob.type, blob.owner, blob.training, blob.region, home, through);
    if (!path?.length) {
      this.remove(blob.id);
      return;
    }
    blob.path = path;
    blob.progress = 0;
    blob.through = through;
  }

  /** The nearest region its owner holds (by hops), for sending units home. */
  private nearestOwn(b: Blob): number | null {
    const seen = new Set([b.region]);
    const queue = [b.region];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      if (this.state.regions[u].owner === b.owner) return u;
      // The way it can move: over land, or by sea from an island.
      for (const v of this.links(b.type, b.owner, u)) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    return null;
  }

  /** Seconds for a blob of `type` owned by `owner` to go from one region to its neighbour. */
  travelSeconds(type: UnitType, owner: number, from: number, to: number): number {
    const edge = this.world.edge(from, to);
    if (!edge) return Infinity;
    // At sea: ships at their own speed; troops shipped, boarding at a port first.
    if (this.world.isSea(from) || this.world.isSea(to)) {
      const naval = !!UNITS[type].naval;
      const t = (CROSS_SECONDS * (edge.dist / this.world.hop)) / (naval ? this.statsOf(type, owner).speed : TRANSPORT_SPEED);
      // Boarding: half as long with Amphibious assault.
      const embark = EMBARK_SECONDS * (this.has(owner, 'amphibious') ? 0.5 : 1);
      return t + (!naval && !this.world.isSea(from) ? embark : 0);
    }
    const dest = this.state.regions[to];
    let speed = this.statsOf(type, owner).speed * TERRAIN_MOVE[this.world.regions[to].terrain];
    if (this.hasRoad(from, to)) speed /= roadSpeed(this.techsOf(owner));
    if (dest.owner === owner) {
      // Home ground: no penalty.
    } else if (this.atWar(dest.owner, owner)) speed *= Math.max(0.3, ENEMY_LAND_MOVE - FORT_MOVE_PENALTY * dest.fort);
    return (CROSS_SECONDS * (edge.dist / this.world.hop)) / speed;
  }

  /**
   * Cheapest route (excluding `from`), counting travel, captures and fights on the way.
   * Land of countries at peace with `owner` is closed, except `through`'s (going home) and
   * `attacking`'s (an order into it declares war).
   */
  route(type: UnitType, owner: number, training: number, from: number, to: number, through = -1, attacking = -1): number[] | null {
    if (from === to) return [];
    const n = this.world.regions.length;
    const cost = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    cost[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (u === -1 || cost[i] < cost[u])) u = i;
      if (u === -1 || u === to) break;
      done[u] = true;
      for (const v of this.links(type, owner, u)) {
        if (done[v]) continue;
        const rs = this.state.regions[v];
        if (this.closedTo(owner, v) && rs.owner !== through && rs.owner !== attacking) continue;
        let c = this.travelSeconds(type, owner, u, v);
        if (rs.owner !== owner && !this.world.isSea(v)) c += this.world.captureSeconds(v, rs.fort, training, rs.owner === NEUTRAL);
        if (this.hostileIn(v, owner)) c += FIGHT_PATH_PENALTY;
        if (cost[u] + c < cost[v]) {
          cost[v] = cost[u] + c;
          prev[v] = u;
        }
      }
    }
    if (cost[to] === Infinity) return null;
    const path: number[] = [];
    for (let v = to; v !== from; v = prev[v]) path.unshift(v);
    return path;
  }

  /**
   * Where a unit can go in one hop. Troops: neighbouring land, out to sea from their own
   * ports, from sea to sea and ashore on any coast. Ships: from sea to sea, out of and into
   * their own ports only.
   */
  links(type: UnitType, owner: number, u: number): number[] {
    const r = this.world.regions[u];
    const ownPort = (id: number) => this.state.regions[id].port && this.state.regions[id].owner === owner;
    if (UNITS[type].naval) {
      if (!r.sea) return r.coast.map((c) => c.id);
      return [...r.neighbors.map((n) => n.id), ...r.coast.filter((c) => ownPort(c.id)).map((c) => c.id)];
    }
    if (r.sea) return [...r.neighbors.map((n) => n.id), ...r.coast.map((c) => c.id)];
    const out = r.neighbors.map((n) => n.id);
    if (ownPort(u)) for (const c of r.coast) out.push(c.id);
    return out;
  }

  // -- orders -----------------------------------------------------------------------------

  private own(playerId: number, blobIds: number[]): Blob[] | string {
    const p = this.player(playerId);
    if (!p?.alive) return 'you are not in the game';
    const blobs: Blob[] = [];
    for (const id of new Set(blobIds)) {
      const b = this.state.blobs.get(id);
      if (!b || b.owner !== playerId) return 'not your unit';
      blobs.push(b);
    }
    return blobs.length ? blobs : 'no units';
  }

  /** Sends units to a region; `then`: after the route they're on (a waypoint), not instead. */
  move(playerId: number, blobIds: number[], target: number, then = false): string | null {
    const all = this.own(playerId, blobIds);
    if (typeof all === 'string') return all;
    if (!this.world.regions[target]) return 'no such region';
    // Ships go to sea regions and your own ports, troops to land: a mixed selection sends
    // whichever of them can go there.
    const sea = this.world.isSea(target);
    const port = this.state.regions[target].port && this.state.regions[target].owner === playerId;
    const blobs = all.filter((b) => (UNITS[b.type].naval ? sea || port : !sea));
    if (!blobs.length) {
      return all.some((b) => UNITS[b.type].naval)
        ? 'ships go to sea regions and your own ports'
        : 'troops cross the sea from a port; send them to the far coast';
    }
    // Every route first: a refused order changes nothing (and declares no war).
    const victim = this.closedTo(playerId, target) ? this.state.regions[target].owner : -1;
    const routes = new Map<Blob, number[]>();
    const cache = new Map<string, number[] | null>();
    for (const b of blobs) {
      // Units left in the land of a country at peace may go out through it.
      const through = this.closedTo(b.owner, b.region) ? this.state.regions[b.region].owner : -1;
      // A waypoint goes on from where the route it's on ends.
      const start = then && b.path.length ? b.path[b.path.length - 1] : b.region;
      const key = `${b.type}:${start}:${through}`;
      if (!cache.has(key)) cache.set(key, this.route(b.type, b.owner, b.training, start, target, through, victim));
      const route = cache.get(key);
      if (route) routes.set(b, then && b.path.length ? [...b.path, ...route] : [...route]);
    }
    if (!routes.size) return 'no route';
    // Sending units into a country you're at peace with is an attack: war.
    if (victim >= 0) {
      const err = this.declareWar(playerId, victim);
      if (err) return err;
    }
    let refused: string | null = null;
    for (const [b, route] of routes) {
      // A unit mid-hop is still in its region (the hop is a timer): a new route the same way
      // keeps the hop's progress; any other route, or staying, turns it back at once.
      const leaving = b.progress > 0;
      b.through = this.closedTo(b.owner, b.region) ? this.state.regions[b.region].owner : -1;
      // Going on the way it was already going (a hop under way, or a waypoint added on):
      // nothing about the current step changes.
      if ((leaving || then) && route.length && route[0] === b.path[0]) {
        b.path = route;
        continue;
      }
      // Under attack here (enemies in the region, or attacking it from next door): no slipping
      // away past them. It may hit back at a neighbour with enemies in it (it stays put), or
      // retreat (back where it came from, to its own land, or, afloat, to any sea), which
      // costs (once: changing the way out is free). Attackers whose own region isn't under
      // attack stop for free.
      if (route.length && this.besieged(b.region, b.owner) && !this.hostileIn(route[0], b.owner)) {
        const out = route[0];
        const afloat = this.world.isSea(out) && (UNITS[b.type].naval || this.world.isSea(b.region));
        if (out !== b.from && this.state.regions[out].owner !== b.owner && !afloat) {
          refused = 'in a fight: units can only retreat to your own land';
          continue;
        }
        if (!leaving) {
          b.strength *= 1 - RETREAT_STRENGTH_LOSS;
          b.training = Math.max(0, b.training - RETREAT_TRAINING_LOSS);
        }
      }
      b.progress = 0;
      b.path = route;
      b.waiting = false;
    }
    return refused;
  }

  stop(playerId: number, blobIds: number[]): string | null {
    const blobs = this.own(playerId, blobIds);
    if (typeof blobs === 'string') return blobs;
    for (const b of blobs) {
      // Halts at once, mid-hop too (the hop is a timer; the unit hasn't left yet).
      b.path = [];
      b.progress = 0;
      b.waiting = false;
      b.through = -1;
    }
    return null;
  }

  /** Splits `amount` off a unit (half if not given), kept between 1 and its size − 1. */
  split(playerId: number, blobId: number, amount?: number): string | null {
    const blobs = this.own(playerId, [blobId]);
    if (typeof blobs === 'string') return blobs;
    const [b] = blobs;
    if (b.progress > 0) return 'units on the move can\'t split';
    if (b.size < 2) return 'too small to split';
    if (this.count(b.owner, b.region) >= this.stackCap(b.region)) return 'no room in this region';
    const half = Math.max(1, Math.min(b.size - 1, Math.floor(amount ?? b.size / 2)));
    const share = half / b.size;
    const other = this.spawn(b.owner, b.type, b.region);
    other.size = half;
    other.strength = b.strength * share;
    other.training = b.training;
    other.entrench = b.entrench;
    other.supply = b.supply;
    other.from = b.from;
    b.size -= half;
    b.strength -= other.strength;
    return null;
  }

  merge(playerId: number, blobIds: number[]): string | null {
    const blobs = this.own(playerId, blobIds);
    if (typeof blobs === 'string') return blobs;
    if (blobs.length < 2) return 'pick at least two units';
    const [into, ...rest] = blobs;
    for (const b of rest) {
      if (b.type !== into.type) return 'only units of the same type merge';
      if (b.region !== into.region || b.progress > 0 || into.progress > 0) return 'units must be in the same region';
    }
    if (blobs.some((b) => this.inFight(b))) return 'units in a fight can\'t merge';
    if (blobs.some((b) => b.strength < MERGE_MIN_STRENGTH * b.size)) return `units below ${MERGE_MIN_STRENGTH * 100}% strength can't merge`;
    const max = UNITS[into.type].maxSize;
    if (into.size >= max) return 'already full';
    for (const b of rest) {
      const room = max - into.size;
      if (room <= 0) break;
      const take = Math.min(room, b.size);
      const share = take / b.size;
      const str = b.strength * share;
      into.training = Math.max(
        0,
        (into.training * into.strength + b.training * str) / Math.max(MIN_STRENGTH, into.strength + str) - MERGE_PENALTY,
      );
      into.size += take;
      into.strength += str;
      into.entrench = Math.min(into.entrench, b.entrench);
      b.size -= take;
      b.strength -= str;
      if (b.size <= 0 || b.strength < MIN_STRENGTH) this.remove(b.id);
    }
    return null;
  }

  /** Starts researching a tech (one at a time). Research points are paid in as it goes. */
  research(playerId: number, tech: TechId): string | null {
    const p = this.player(playerId);
    if (!p?.alive) return 'you are not in the game';
    if (p.research) return 'already researching';
    const why = whyNotResearch(tech, p.techs);
    if (why) return why;
    p.research = { tech, paid: 0, cost: techCost(TECHS.find((t) => t.id === tech)?.tier ?? 1) };
    return null;
  }

  /** Stops the research under way; the points paid in come back. */
  unresearch(playerId: number): string | null {
    const p = this.player(playerId);
    if (!p?.research) return 'nothing being researched';
    this.refund(p, { ...zero(), research: p.research.paid });
    p.research = null;
    return null;
  }

  /** A country's techs (none for neutral land). */
  /** `owner` has researched `tech`. */
  private has(owner: number, tech: TechId): boolean {
    return owner >= 0 && this.techsOf(owner).includes(tech);
  }

  techsOf(owner: number): Techs {
    return this.state.players[owner]?.techs ?? [];
  }

  /** A unit type's stats for its owner, techs counted. */
  statsOf(type: UnitType, owner: number): UnitStats {
    return unitStats(type, this.techsOf(owner));
  }

  /** Disbands units, giving back part of the manpower their remaining strength cost. */
  disband(playerId: number, blobIds: number[]): string | null {
    const blobs = this.own(playerId, blobIds);
    if (typeof blobs === 'string') return blobs;
    if (blobs.some((b) => this.inFight(b))) return 'units in a fight can\'t disband';
    const p = this.state.players[playerId];
    for (const b of blobs) {
      const stats = this.statsOf(b.type, b.owner);
      this.refund(p, { ...zero(), manpower: (b.strength * stats.cost.manpower * DISBAND_REFUND) / stats.batch });
      this.remove(b.id);
    }
    this.touch();
    return null;
  }

  /** In a battle as of the last pass: dealing or taking damage. */
  inFight(b: Blob): boolean {
    return this.fighting.has(b.id);
  }

  /** Builds a region has: the one under way, then the ones waiting. */
  pending(rs: RegionState): Construction[] {
    return rs.construction ? [rs.construction, ...rs.buildQueue] : [];
  }

  hasRoad(a: number, b: number): boolean {
    return this.state.roads.has(pairKey(a, b));
  }

  /** Slots taken in a region, counting builds under way and waiting. A fort, mine or market
   * takes one at any level (an upgrade takes none). */
  slotsUsed(rs: RegionState): number {
    let n = econSlots(rs.econ) + (rs.fort > 0 ? 1 : 0) + (rs.barracks ? 1 : 0) + (rs.factory ? 1 : 0) + (rs.port ? 1 : 0) + (rs.battery ? 1 : 0) + rs.depots;
    const counted = new Set<BuildingKind>();
    for (const c of this.pending(rs)) {
      if (c.kind === 'city' || c.kind === 'road') continue;
      if (maxLevel(c.kind) > 1) {
        if (counted.has(c.kind) || this.levelOf(rs, c.kind) > 0) continue;
        counted.add(c.kind);
      }
      n++;
    }
    return n;
  }

  /** What stands of a building that has levels (fort, city, mine, market): its level. */
  levelOf(rs: RegionState, kind: BuildingKind): number {
    if (kind === 'fort') return rs.fort;
    if (kind === 'city') return rs.city;
    return ECON_KINDS.includes(kind as EconKind) ? rs.econ[kind as EconKind] : 0;
  }

  /** The level the next build of a levelled building would reach, counting queued ones. */
  nextLevel(rs: RegionState, kind: BuildingKind): number {
    if (maxLevel(kind) <= 1) return 1;
    return this.levelOf(rs, kind) + this.pending(rs).filter((c) => c.kind === kind).length + 1;
  }

  /** Regions within `hops` of `region` (itself included), by hop count through any land. */
  near(region: number, hops: number): number[] {
    const seen = new Map([[region, 0]]);
    const queue = [region];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      const d = seen.get(u) as number;
      if (d >= hops) continue;
      for (const e of this.world.neighbors(u)) {
        if (!seen.has(e.id)) {
          seen.set(e.id, d + 1);
          queue.push(e.id);
        }
      }
    }
    return queue;
  }

  /** Within reach of one of `player`'s cities (economic buildings go only there). */
  nearCity(player: number, region: number): boolean {
    return this.near(region, HINTERLAND_HOPS).some((r) => this.state.regions[r].owner === player && this.state.regions[r].city > 0);
  }

  /** Why a build would be refused, resources aside; null if it's allowed. */
  whyNotBuild(playerId: number, region: number, kind: BuildingKind, target = -1): string | null {
    const p = this.player(playerId);
    const rs = this.state.regions[region];
    if (!p?.alive) return 'you are not in the game';
    if (!rs || rs.owner !== playerId) return 'not your region';
    if (!rs.supplied) return 'region is out of supply';
    if (this.hostileIn(region, playerId) || this.underAttack(region) || rs.capture) return 'region is under attack';
    const map = this.world.regions[region];
    if (!canBuildOn(kind, map, rs.city)) return `a ${kind} needs ${BUILD_NEEDS[kind]}`;
    const pending = this.pending(rs);
    if (ECON_KINDS.includes(kind as EconKind) && !this.nearCity(playerId, region)) {
      return `only within ${HINTERLAND_HOPS} regions of one of your cities`;
    }
    if (kind !== 'city' && maxLevel(kind) > 1 && this.nextLevel(rs, kind) > maxLevel(kind)) return `the ${kind} is at its highest level`;
    if ((kind === 'barracks' || kind === 'factory' || kind === 'port' || kind === 'battery') && (rs[kind] || pending.some((c) => c.kind === kind))) {
      return `already has a ${kind === 'battery' ? 'coastal battery' : kind}`;
    }
    if (kind === 'city') {
      const level = this.nextLevel(rs, kind);
      if (level > MAX_CITY) return 'the city is at its highest level';
      // Cities being founded count too.
      const city = (r: number) => this.state.regions[r].city > 0 || this.pending(this.state.regions[r]).some((c) => c.kind === 'city');
      const tooClose = this.near(region, FOUND_CITY_MIN_HOPS - 1).some((r) => r !== region && city(r));
      if (level === 1 && tooClose) return 'too close to another city';
    }
    if (kind === 'road') {
      if (!this.world.edge(region, target)) return 'a road needs a neighbouring region';
      if (this.state.regions[target]?.owner !== playerId) return 'roads join two of your regions';
      const queued = (r: number, t: number) => this.pending(this.state.regions[r]).some((c) => c.kind === 'road' && c.target === t);
      if (this.hasRoad(region, target) || queued(region, target) || queued(target, region)) return 'there is a road already';
    }
    // An upgrade (or a level queued on one under way) takes no new slot.
    const upgrade = maxLevel(kind) > 1 && (this.levelOf(rs, kind) > 0 || pending.some((c) => c.kind === kind));
    const needsSlot = kind !== 'city' && kind !== 'road' && !upgrade;
    if (needsSlot && this.slotsUsed(rs) >= slotsOf(map, rs.city)) return 'no free slot';
    if (rs.construction && rs.buildQueue.length >= BUILD_QUEUE) return 'build queue is full';
    return null;
  }

  build(playerId: number, region: number, kind: BuildingKind, target = -1): string | null {
    const why = this.whyNotBuild(playerId, region, kind, target);
    if (why) return why;
    const p = this.state.players[playerId];
    const rs = this.state.regions[region];
    const level = this.nextLevel(rs, kind);
    const { cost, seconds } = buildCost(kind, level);
    if (!this.pay(p, cost)) return 'not enough resources';
    const c: Construction = { kind, level, progress: 0, seconds, cost, target: kind === 'road' ? target : -1 };
    if (rs.construction) rs.buildQueue.push(c);
    else rs.construction = c;
    return null;
  }

  /**
   * Cancels a build (0: the one under way, 1+: waiting), refunded in full. Cancelling a level
   * (fort, city, mine, market) also cancels the higher levels queued after it.
   */
  unbuild(playerId: number, region: number, index: number): string | null {
    const rs = this.state.regions[region];
    if (!this.player(playerId)?.alive) return 'you are not in the game';
    if (!rs || rs.owner !== playerId) return 'not your region';
    const all = this.pending(rs);
    const target = all[index];
    if (!target) return 'nothing to cancel';
    const levelled = maxLevel(target.kind) > 1;
    const drop = new Set(all.filter((c, i) => c === target || (levelled && i > index && c.kind === target.kind)));
    for (const c of drop) this.refund(this.state.players[playerId], c.cost);
    const keep = all.filter((c) => !drop.has(c));
    if (rs.construction && drop.has(rs.construction)) {
      rs.construction = keep.shift() ?? null;
      if (rs.construction) rs.construction.progress = 0;
    } else keep.shift();
    rs.buildQueue = keep;
    return null;
  }

  /** Knocks a building down at once, with no refund, freeing its slot (a fort goes entirely). */
  demolish(playerId: number, region: number, kind: BuildingKind): string | null {
    const rs = this.state.regions[region];
    if (!this.player(playerId)?.alive) return 'you are not in the game';
    if (!rs || rs.owner !== playerId) return 'not your region';
    // No scorched earth: what's there goes to whoever takes the region.
    if (this.besieged(region, playerId) || rs.capture) return 'not while the region is under attack';
    if (ECON_KINDS.includes(kind as EconKind) && maxLevel(kind) <= 1) {
      const k = kind as EconKind;
      if (rs.econ[k] <= 0) return `no ${kind} here`;
      rs.econ[k]--;
    } else if (kind === 'fort' || ECON_KINDS.includes(kind as EconKind)) {
      // A fort, mine or market goes entirely, every level.
      if (this.levelOf(rs, kind) <= 0) return `no ${kind} here`;
      if (kind === 'fort') rs.fort = 0;
      else rs.econ[kind as EconKind] = 0;
      // Queued levels were built on this one.
      const levels = this.pending(rs).filter((c) => c.kind === kind);
      for (const c of levels) this.refund(this.state.players[playerId], c.cost);
      const keep = this.pending(rs).filter((c) => c.kind !== kind);
      if (rs.construction?.kind === kind) {
        rs.construction = keep.shift() ?? null;
        if (rs.construction) rs.construction.progress = 0;
      } else keep.shift();
      rs.buildQueue = keep;
    } else if (kind === 'barracks' || kind === 'factory' || kind === 'port') {
      if (!rs[kind]) return `no ${kind} here`;
      rs[kind] = false;
      // A unit already paid for is given back.
      const line = rs.production[kind];
      if (line.queue.length && line.progress >= 0) this.refund(this.state.players[playerId], line.paid ?? this.statsOf(line.queue[0], playerId).cost);
      rs.production[kind] = emptyLine();
      if (kind === 'port') this.evictShips(region);
    } else if (kind === 'battery') {
      if (!rs.battery) return 'no coastal battery here';
      rs.battery = false;
    } else if (kind === 'depot') {
      if (rs.depots <= 0) return 'no depot here';
      rs.depots--;
    } else return `a ${kind} can't be demolished`;
    return null;
  }

  produce(playerId: number, region: number, building: ProductionBuilding, unit?: UnitType): string | null {
    const rs = this.state.regions[region];
    if (!this.player(playerId)?.alive) return 'you are not in the game';
    if (!rs || rs.owner !== playerId) return 'not your region';
    if (!rs[building]) return `no ${building} here`;
    const line = rs.production[building];
    if (line.queue.length >= MAX_QUEUE) return 'queue is full';
    const p = this.state.players[playerId];
    // Unless told otherwise, the first unit the building makes that we can build.
    const type = unit ?? unitsOf(building).find((t) => !UNIT_TECH[t] || p.techs.includes(UNIT_TECH[t] as TechId)) ?? unitsOf(building)[0];
    if (UNITS[type].producedAt !== building) return `a ${building} can't make ${type}`;
    const needs = UNIT_TECH[type];
    if (needs && !p.techs.includes(needs)) return `research ${TECHS.find((t) => t.id === needs)?.name} first`;
    line.queue.push(type);
    return null;
  }

  setRepeat(playerId: number, region: number, building: ProductionBuilding, repeat: boolean): string | null {
    const rs = this.state.regions[region];
    if (!rs || rs.owner !== playerId) return 'not your region';
    rs.production[building].repeat = repeat;
    return null;
  }

  /** Removes the last order in a building's queue, refunding it if it was paid for. */
  cancel(playerId: number, region: number, building: ProductionBuilding): string | null {
    const rs = this.state.regions[region];
    if (!rs || rs.owner !== playerId) return 'not your region';
    const line = rs.production[building];
    const type = line.queue.pop();
    if (!type) return 'nothing queued';
    if (line.queue.length === 0 && line.progress >= 0) {
      this.refund(this.state.players[playerId], line.paid ?? this.statsOf(type, playerId).cost);
      line.progress = -1;
    }
    return null;
  }

  // -- the tick ---------------------------------------------------------------------------

  tick(dt = TICK_MS / 1000): void {
    if (this.state.winner !== null) return;
    this.state.time += dt;
    for (const [key, until] of this.state.peaceOffers) if (until <= this.state.time) this.state.peaceOffers.delete(key);
    this.updateSupply();
    this.moveBlobs(dt);
    const fighting = this.battles(dt);
    this.bombard(dt, fighting);
    this.fighting = fighting;
    this.captures(dt);
    this.economy(dt);
    this.blobUpkeep(dt, fighting);
    this.cutOffRegions(dt);
  }

  // -- supply -----------------------------------------------------------------------------

  private updateSupply(): void {
    const regions = this.state.regions;
    for (const rs of regions) rs.supplied = false;
    // Every city is a hub reaching 3 + its level hops through its owner's land; a road
    // border counts half a hop. Work in half hops: the best reach left wins.
    const left = new Array<number>(regions.length).fill(-1);
    const buckets: number[][] = [];
    regions.forEach((rs, i) => {
      if (rs.owner === NEUTRAL || rs.city <= 0 || !this.state.players[rs.owner]?.alive) return;
      const reach = supplyReach(rs.city, this.techsOf(rs.owner)) * 2;
      if (reach > left[i]) {
        left[i] = reach;
        (buckets[reach] ??= []).push(i);
      }
    });
    for (let r = buckets.length - 1; r >= 0; r--) {
      for (const u of buckets[r] ?? []) {
        if (left[u] !== r) continue;
        regions[u].supplied = true;
        for (const e of this.world.neighbors(u)) {
          if (regions[e.id].owner !== regions[u].owner) continue;
          const next = r - (this.hasRoad(u, e.id) ? ROAD_SUPPLY_HOP * 2 : 2);
          if (next >= 0 && next > left[e.id]) {
            left[e.id] = next;
            (buckets[next] ??= []).push(e.id);
          }
        }
      }
    }
    // Supply level per region: capacity over what the units there need (on the move too).
    // Units in foreign land draw on the best neighbouring region of their owner's, and load it.
    const n = this.world.regions.length;
    const need = new Map<number, number>();
    const load = (owner: number, r: number, amount: number) => need.set(owner * n + r, (need.get(owner * n + r) ?? 0) + amount);
    const foreign: Blob[] = [];
    for (const b of this.state.blobs.values()) {
      if (UNITS[b.type].naval || this.world.isSea(b.region)) continue;
      if (regions[b.region].owner === b.owner) load(b.owner, b.region, b.size * UNITS[b.type].supplyNeed);
      else foreign.push(b);
    }
    const level = (owner: number, r: number): number => {
      const rs = regions[r];
      if (rs.owner !== owner || !rs.supplied) return 0;
      const want = need.get(owner * n + r) ?? 0;
      return want <= 0 ? 1 : Math.min(1, this.world.supplyCapacity(r, rs.city, this.techsOf(rs.owner)) / want);
    };
    const drawsOn = new Map<Blob, number>();
    for (const b of foreign) {
      let best = -1;
      let bestLevel = 0;
      for (const e of this.world.neighbors(b.region)) {
        const l = level(b.owner, e.id);
        if (l > bestLevel) [best, bestLevel] = [e.id, l];
      }
      if (best < 0) continue;
      drawsOn.set(b, best);
      load(b.owner, best, b.size * UNITS[b.type].supplyNeed);
    }
    // Ships are supplied a few sea regions out from their country's ports.
    const seaReach = new Map<number, Set<number>>();
    const reachOf = (owner: number) => {
      let set = seaReach.get(owner);
      if (set) return set;
      set = new Set();
      const dist = new Map<number, number>();
      const queue: number[] = [];
      regions.forEach((rs, i) => {
        if (rs.owner !== owner || !rs.port || !rs.supplied) return;
        for (const c of this.world.regions[i].coast) if (!dist.has(c.id)) {
          dist.set(c.id, 1);
          queue.push(c.id);
        }
      });
      for (let q = 0; q < queue.length; q++) {
        const d = dist.get(queue[q]) as number;
        set.add(queue[q]);
        if (d >= SEA_SUPPLY_HOPS + (this.has(owner, 'fleetTrain') ? 2 : 0)) continue;
        for (const n of this.world.neighbors(queue[q])) if (!dist.has(n.id)) {
          dist.set(n.id, d + 1);
          queue.push(n.id);
        }
      }
      seaReach.set(owner, set);
      return set;
    };
    for (const b of this.state.blobs.values()) {
      if (this.world.isSea(b.region)) {
        // Troops at sea carry what they need for the trip (but can't refill or drill there).
        b.supply = !UNITS[b.type].naval || reachOf(b.owner).has(b.region) ? 1 : 0;
      } else if (UNITS[b.type].naval) {
        b.supply = regions[b.region].owner === b.owner && regions[b.region].supplied ? 1 : 0;
      } else if (regions[b.region].owner === b.owner) {
        b.supply = level(b.owner, b.region);
      } else {
        const from = drawsOn.get(b);
        b.supply = from === undefined ? 0 : level(b.owner, from);
      }
    }
  }

  private cutOffRegions(dt: number): void {
    this.state.regions.forEach((rs, i) => {
      if (rs.owner === NEUTRAL || rs.supplied || this.count(rs.owner, i) > 0) {
        rs.cutOff = 0;
        return;
      }
      rs.cutOff += dt;
      if (rs.cutOff < CUT_OFF_SECONDS) return;
      // Lost to nobody: what was paid for and not finished comes back.
      const p = this.state.players[rs.owner];
      for (const c of this.pending(rs)) this.refund(p, c.cost);
      for (const line of Object.values(rs.production)) if (line.queue.length && line.progress >= 0 && line.paid) this.refund(p, line.paid);
      this.setOwner(i, NEUTRAL);
    });
  }

  // -- movement ---------------------------------------------------------------------------

  /**
   * What a unit with orders does about the next region on its way: go (hop there), attack the
   * enemies standing there from where it is, take it from where it is (someone else's empty
   * land: it steps in once it's taken), wait (the region is full, enemy warships block the
   * sea, or, for artillery, enemies stand there and it shells them instead), or stop (it
   * can't go there any more).
   */
  private stepOf(b: Blob, next: number): 'go' | 'attack' | 'take' | 'wait' | 'full' | 'stop' {
    const naval = !!UNITS[b.type].naval;
    const sea = this.world.isSea(next);
    const rs = this.state.regions[next];
    if (!sea && rs.owner !== b.owner && this.closedTo(b.owner, next) && rs.owner !== b.through) return 'stop';
    if (naval) {
      // Ships: sea regions and their own ports only; they never fight on land.
      if (!sea && !(rs.port && rs.owner === b.owner)) return 'stop';
      if (this.hostileIn(next, b.owner)) return sea ? 'attack' : 'wait';
    } else if (sea) {
      if (this.blockaded(next, b.owner)) return 'wait';
    } else if (this.hostileIn(next, b.owner)) {
      // Artillery never storms a region: it waits at the border and shells (see bombard).
      return UNITS[b.type].range ? 'wait' : 'attack';
    } else if (rs.owner !== b.owner && !this.closedTo(b.owner, next)) return 'take';
    if (this.count(b.owner, next) >= this.stackCap(next) && !this.swapWith(b, next)) return 'full';
    return 'go';
  }

  /** One of our units in a full region `next`, waiting to come our way: the two swap places
   * (so two full regions can't jam each other). */
  private swapWith(b: Blob, next: number): Blob | undefined {
    for (const o of this.standing().get(next) ?? []) {
      if (o !== b && o.owner === b.owner && o.path[0] === b.region && !!UNITS[o.type].naval === !!UNITS[b.type].naval) return o;
    }
    return undefined;
  }

  private moveBlobs(dt: number): void {
    for (const b of [...this.state.blobs.values()]) {
      if (!this.state.blobs.has(b.id)) continue;
      b.attacking = -1;
      b.waiting = false;
      // Left in the land of a country at peace with no orders: it goes home.
      if (!b.path.length && this.closedTo(b.owner, b.region)) this.sendHome(b);
      if (!b.path.length || !this.state.blobs.has(b.id)) {
        b.progress = 0;
        continue;
      }
      const next = b.path[0];
      const step = this.stepOf(b, next);
      if (step === 'stop') {
        b.path = [];
        b.progress = 0;
        b.through = -1;
        continue;
      }
      if (step === 'attack' || step === 'take' || step === 'wait') {
        // From where it stands (a hop under way is called off at once).
        b.progress = 0;
        if (step === 'wait') b.waiting = true;
        // A unit whose own region is fought over fights there instead.
        else if (!this.contested(b.region)) {
          b.attacking = next;
          b.entrench = 0;
        }
        continue;
      }
      if (step === 'full') {
        // Waits in its region; a hop under way finishes and waits at the edge.
        b.waiting = true;
        if (b.progress > 0) b.progress = Math.min(1, b.progress + dt / this.travelSeconds(b.type, b.owner, b.region, next));
        continue;
      }
      if (b.progress === 0) b.entrench = 0;
      b.progress = Math.min(1, b.progress + dt / this.travelSeconds(b.type, b.owner, b.region, next));
      if (b.progress < 1) continue;
      if (this.count(b.owner, next) >= this.stackCap(next)) {
        const other = this.swapWith(b, next);
        if (other) this.enter(other);
      }
      this.enter(b);
    }
  }

  /** Moves a unit that reached the end of its hop into the next region. */
  private enter(b: Blob): void {
    const to = b.path[0];
    const edge = this.world.edge(b.region, to);
    const rs = this.state.regions[to];
    b.path.shift();
    b.from = b.region;
    b.region = to;
    b.progress = 0;
    this.touch();
    b.entrench = 0;
    b.crossedRiver = !!edge?.river && rs.owner !== b.owner && !this.world.isSea(to);
    if (rs.owner === b.owner) b.through = -1;
  }

  // -- battles ----------------------------------------------------------------------------

  /**
   * Runs every fight; returns the ids of blobs that fought. A battle is about a region: the
   * units standing in it, and the units attacking it from neighbouring regions (border
   * battles: attackers stay in their own region until the defenders are gone). Each unit
   * deals damage in one battle (the region it attacks, else its own) and takes it in every
   * battle it's part of: a unit attacking out while its own region is attacked is flanked.
   */
  private battles(dt: number): Set<number> {
    const fighting = new Set<number>();
    const standing = this.standing();
    // Who attacks where: units attacking a neighbouring region with enemies in it (set by
    // moveBlobs; units taking empty land aren't in a fight).
    const attackersOf = new Map<number, Blob[]>();
    const assaulting = new Set<Blob>();
    for (const b of this.state.blobs.values()) {
      if (b.attacking < 0 || !this.hostileIn(b.attacking, b.owner)) continue;
      assaulting.add(b);
      const list = attackersOf.get(b.attacking);
      if (list) list.push(b);
      else attackersOf.set(b.attacking, [b]);
    }
    this.attackers = attackersOf;
    const regions = new Set([...attackersOf.keys()]);
    for (const region of standing.keys()) if (this.contested(region)) regions.add(region);
    for (const region of regions) {
      if (this.battleRegions.has(region)) continue;
      const sides = new Set([...this.ownersIn(region), ...(attackersOf.get(region) ?? []).map((b) => b.owner)]);
      this.events.push({ kind: 'battle', region, sides: [...sides] });
    }
    for (const region of this.defenderPeak.keys()) if (!regions.has(region)) this.defenderPeak.delete(region);
    this.battleRegions = regions;

    const damage = new Map<Blob, number>();
    const strengthOf = (list: Blob[]) => list.reduce((s, b) => s + b.strength, 0);
    const fights: Array<{ region: number; sides: Map<number, Blob[]> }> = [];
    for (const region of regions) {
      const attacking = attackersOf.get(region) ?? [];
      const members = [...(standing.get(region) ?? []), ...attacking];
      const sides = new Map<number, Blob[]>();
      for (const b of members) sides.set(b.owner, [...(sides.get(b.owner) ?? []), b]);
      const foes = (s: number) => [...sides.keys()].filter((t) => this.atWar(s, t));
      if (![...sides.keys()].some((s) => foes(s).length)) continue;
      fights.push({ region, sides });
      const rs = this.state.regions[region];
      const terrain = this.world.regions[region].terrain;
      const atSea = this.world.isSea(region);
      // The region's owner holding it: remember its biggest strength in the fight (for routing).
      const held = sides.get(rs.owner);
      if (held && !atSea) this.defenderPeak.set(region, Math.max(this.defenderPeak.get(region) ?? 0, strengthOf(held)));
      // Across a river: attackers coming over a river edge, or units that crossed one to get in.
      const overRiver = (b: Blob) => (b.region === region ? b.crossedRiver : !!this.world.edge(b.region, region)?.river);
      for (const [s, list] of sides) {
        // Each unit hits in one fight: the region it attacks, else its own.
        const dealers = list.filter((b) => (b.region === region ? !assaulting.has(b) : b.attacking === region));
        // Flanking: attacking from more than one neighbouring region.
        const from = new Set(dealers.filter((b) => b.region !== region).map((b) => b.region));
        const flank = 1 + FLANK_BONUS * Math.min(FLANK_MAX_EXTRA, Math.max(0, from.size - 1));
        const power =
          DAMAGE_RATE *
          flank *
          dealers.reduce(
            (sum, b) =>
              sum +
              b.strength *
                this.statsOf(b.type, b.owner).attack *
                (atSea ? 1 : UNITS[b.type].terrainAttack[terrain]) *
                this.fightFactor(b) *
                (1 + (TRAINING_DAMAGE * b.training) / MAX_TRAINING) *
                (0.5 + 0.5 * b.supply),
            0,
          );
        const total = strengthOf(dealers);
        const riverShare = total > 0 ? strengthOf(dealers.filter(overRiver)) / total : 0;
        const landingShare = total > 0 ? strengthOf(dealers.filter((b) => b.region !== region && this.troopsAtSea(b))) / total : 0;
        const mine = foes(s);
        let enemies = 0;
        for (const t of mine) enemies += strengthOf(sides.get(t) as Blob[]);
        if (enemies <= 0 || power <= 0) continue;
        for (const t of mine) {
          const targets = sides.get(t) as Blob[];
          const st = strengthOf(targets);
          const share = (power * dt * st) / enemies;
          for (const d of targets) {
            let taken = (share * d.strength) / st / (this.statsOf(d.type, d.owner).defense * (this.troopsAtSea(d) ? AT_SEA_DEFENSE : 1));
            taken *= 1 - (TRAINING_PROTECTION * d.training) / MAX_TRAINING;
            // Standing in the region: rough ground covers anyone; its owner also has its fort,
            // dug-in positions, the river and a coastal battery against landings.
            if (d.region === region && !atSea) {
              let bonus = TERRAIN_DEFENSE[terrain];
              if (rs.owner === t) {
                bonus += FORT_BONUS * rs.fort + entrenchBonus(this.techsOf(t)) * d.entrench + RIVER_BONUS * riverShare;
                if (rs.battery) bonus += (BATTERY_LANDING_BONUS + (this.has(t, 'coastalDefence') ? 0.25 : 0)) * landingShare;
              }
              taken /= 1 + bonus;
            }
            damage.set(d, (damage.get(d) ?? 0) + taken);
          }
        }
      }
      for (const [s, list] of sides) if (foes(s).length) for (const b of list) fighting.add(b.id);
    }
    for (const [b, d] of damage) b.strength -= Math.max(0, d);
    for (const id of fighting) {
      const b = this.state.blobs.get(id) as Blob;
      b.training = Math.min(MAX_TRAINING, b.training + VETERANCY_RATE * dt);
    }
    this.reap();
    for (const f of fights) this.maybeRout(f.region, f.sides);
    return fighting;
  }

  /** Removes units with no strength left (right after damage, so nothing dead fights on). */
  private reap(): void {
    for (const b of [...this.state.blobs.values()]) if (b.strength < MIN_STRENGTH) this.remove(b.id);
  }

  /** Regions fought over in the last battle pass. */
  private battleRegions = new Set<number>();
  /** Region → the most strength its owner has had holding it in the current fight. */
  private defenderPeak = new Map<number, number>();

  /**
   * Defenders broken (down to ROUT_SHARE of their strength in the fight) and outnumbered
   * ROUT_ODDS to 1 rout: each flees to the nearest region of theirs with room (losing some
   * strength; with nowhere to go it's destroyed), and the strongest attacker takes the region.
   */
  private maybeRout(region: number, sides: Map<number, Blob[]>): void {
    const rs = this.state.regions[region];
    if (this.world.isSea(region) || rs.owner === NEUTRAL) return;
    const alive = (list: Blob[] | undefined) => (list ?? []).filter((b) => this.state.blobs.has(b.id));
    const held = alive(sides.get(rs.owner)).filter((b) => b.region === region);
    const peak = this.defenderPeak.get(region) ?? 0;
    const mine = held.reduce((s, b) => s + b.strength, 0);
    if (!held.length || mine >= ROUT_SHARE * peak) return;
    let enemies = 0;
    let by = -1;
    let best = 0;
    for (const [s, list] of sides) {
      if (!this.atWar(s, rs.owner)) continue;
      const st = alive(list).reduce((sum, b) => sum + b.strength, 0);
      enemies += st;
      // Only troops can take land.
      if (st > best && alive(list).some((b) => !UNITS[b.type].naval)) [best, by] = [st, s];
    }
    if (by < 0 || enemies < ROUT_ODDS * mine) return;
    for (const d of held) {
      const to = this.fallBack(d, region);
      if (to < 0) {
        this.remove(d.id);
        continue;
      }
      d.from = region;
      d.region = to;
      d.path = [];
      d.progress = 0;
      d.entrench = 0;
      d.attacking = -1;
      d.strength *= 1 - ROUT_LOSS;
      this.touch();
    }
    this.defenderPeak.delete(region);
    this.events.push({ kind: 'routed', region, owner: rs.owner, by });
    if (!this.hostileIn(region, by)) this.take(region, by);
  }

  /** Where a routed unit flees: the nearest region of its owner's with room and no enemies,
   * through its owner's land, at most ROUT_HOPS away (-1: nowhere, it's cut off). */
  private fallBack(b: Blob, region: number): number {
    const seen = new Map([[region, 0]]);
    const queue = [region];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      const d = seen.get(u) as number;
      if (u !== region && this.count(b.owner, u) < this.stackCap(u) && !this.hostileIn(u, b.owner)) return u;
      if (d >= ROUT_HOPS) continue;
      for (const e of this.world.neighbors(u)) {
        if (seen.has(e.id) || this.state.regions[e.id].owner !== b.owner) continue;
        seen.set(e.id, d + 1);
        queue.push(e.id);
      }
    }
    return -1;
  }

  /**
   * Artillery standing still, in supply and not in a fight itself shells enemy units on land
   * up to its range away: where its own side is fighting first, else the strongest enemy
   * force. Ships shell coasts and neighbouring seas; coastal batteries shell the seas off
   * their coast. Shells ignore digging in and count forts half; whoever is hit counts as in
   * a fight.
   */
  private bombard(dt: number, fighting: Set<number>): void {
    const standing = this.standing();
    const damage = new Map<Blob, number>();
    const shell = (owner: number, target: number, power: number, fortShare: number, siege: boolean) => {
      const enemies = (standing.get(target) ?? []).filter((x) => this.atWar(owner, x.owner) && x.strength > 0);
      const total = enemies.reduce((s, x) => s + x.strength, 0);
      if (total <= 0) return;
      const rs = this.state.regions[target];
      // A siege: guns wear an enemy's fort down, a level at a time.
      if (siege && rs.fort > 0 && this.atWar(owner, rs.owner)) {
        rs.siege += power / FORT_SIEGE_POWER;
        if (rs.siege >= 1) {
          rs.siege = 0;
          rs.fort--;
          this.events.push({ kind: 'breached', region: target, owner: rs.owner, by: owner, level: rs.fort });
          this.touch();
        }
      }
      for (const x of enemies) {
        let taken = (power * x.strength) / total / (this.statsOf(x.type, x.owner).defense * (this.troopsAtSea(x) ? AT_SEA_DEFENSE : 1));
        taken *= 1 - (TRAINING_PROTECTION * x.training) / MAX_TRAINING;
        if (rs.owner === x.owner) taken /= 1 + FORT_BONUS * fortShare * rs.fort;
        damage.set(x, (damage.get(x) ?? 0) + taken);
      }
    };
    for (const b of this.state.blobs.values()) {
      b.bombarding = -1;
      const stats = this.statsOf(b.type, b.owner);
      // Guns being shipped can't fire.
      if (!stats.range || !stats.bombard || b.progress > 0 || b.supply <= 0 || fighting.has(b.id) || this.troopsAtSea(b)) continue;
      const target = this.bombardTarget(b, stats.range, standing);
      if (target < 0) continue;
      b.bombarding = target;
      const power = DAMAGE_RATE * dt * b.strength * stats.bombard * (1 + (TRAINING_DAMAGE * b.training) / MAX_TRAINING) * (0.5 + 0.5 * b.supply);
      shell(b.owner, target, power, bombardFortShare(this.techsOf(b.owner)), true);
    }
    // Coastal batteries: the sea off the coast with the most enemy strength in it.
    this.batteryTargets.clear();
    this.state.regions.forEach((rs, i) => {
      if (!rs.battery || rs.owner === NEUTRAL || !rs.supplied || this.hostileIn(i, rs.owner) || this.underAttack(i)) return;
      let best = -1;
      let most = 0;
      for (const c of this.world.regions[i].coast) {
        const st = (standing.get(c.id) ?? []).filter((x) => this.atWar(rs.owner, x.owner)).reduce((s, x) => s + x.strength, 0);
        if (st > most) [best, most] = [c.id, st];
      }
      if (best < 0) return;
      this.batteryTargets.set(i, best);
      shell(rs.owner, best, DAMAGE_RATE * dt * BATTERY_BOMBARD * (this.has(rs.owner, 'coastalDefence') ? 1.5 : 1), 0, false);
    });
    for (const [x, d] of damage) {
      x.strength -= d;
      fighting.add(x.id);
    }
    this.reap();
  }

  /** Coastal battery region → the sea it shelled in the last pass. */
  readonly batteryTargets = new Map<number, number>();

  /** Where a gun shells: an enemy-held spot within range, own fights first, then the
   * strongest enemy force, then the nearest. -1 if there's nothing to hit. Artillery reaches
   * over land only; ships hit the coasts and the seas next to their sea region. */
  private bombardTarget(b: Blob, range: number, standing: Map<number, Blob[]>): number {
    const dist = new Map([[b.region, 0]]);
    if (UNITS[b.type].naval) {
      dist.delete(b.region);
      if (!this.world.isSea(b.region)) return -1;
      const r = this.world.regions[b.region];
      for (const c of [...r.coast, ...r.neighbors]) dist.set(c.id, 1);
    }
    const queue = UNITS[b.type].naval ? [] : [b.region];
    for (let q = 0; q < queue.length; q++) {
      const d = dist.get(queue[q]) as number;
      if (d >= range) continue;
      for (const n of this.world.regions[queue[q]].neighbors) {
        if (!dist.has(n.id) && !this.world.isSea(n.id)) {
          dist.set(n.id, d + 1);
          queue.push(n.id);
        }
      }
    }
    let best = -1;
    let bestScore = -Infinity;
    for (const [r, d] of dist) {
      const here = standing.get(r) ?? [];
      const enemy = here.filter((x) => this.atWar(b.owner, x.owner)).reduce((s, x) => s + Math.max(0, x.strength), 0);
      if (enemy <= 0) continue;
      const ours = here.some((x) => x.owner === b.owner) || (this.attackers.get(r) ?? []).some((x) => x.owner === b.owner);
      const score = (ours ? 1e6 : 0) + enemy - d;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  /** How hard a unit hits where it is: ships only at sea (or sailing out of port into a fight
   * at sea), troops weakly from ships, and storming a coast from the sea at half strength. */
  private fightFactor(b: Blob): number {
    const atSea = this.world.isSea(b.region);
    if (UNITS[b.type].naval) return atSea || (b.attacking >= 0 && this.world.isSea(b.attacking)) ? 1 : 0;
    if (!atSea) return 1;
    if (b.attacking >= 0 && !this.world.isSea(b.attacking)) return this.has(b.owner, 'amphibious') ? 0.8 : LANDING_ATTACK;
    return AT_SEA_ATTACK;
  }

  /** Troops being shipped (packed in transports: easy to hurt). */
  troopsAtSea(b: Blob): boolean {
    return !UNITS[b.type].naval && this.world.isSea(b.region);
  }

  /** Units attacking each region from next door, as of the last battle pass. */
  private attackers = new Map<number, Blob[]>();
  /** Units that fought in the last battle pass. */
  private fighting = new Set<number>();

  /** Someone attacks this region from next door. */
  private underAttack(region: number): boolean {
    return this.attackers.has(region);
  }

  /** Units of `owner` in this region are under attack: enemies stand in it, or attack it from next door. */
  besieged(region: number, owner: number): boolean {
    if (this.hostileIn(region, owner)) return true;
    return (this.attackers.get(region) ?? []).some((b) => this.state.blobs.has(b.id) && this.atWar(b.owner, owner));
  }

  // -- capturing --------------------------------------------------------------------------

  private captures(dt: number): void {
    // Units taking a region from next door (its empty land; see moveBlobs).
    const fromNextDoor = new Map<number, Blob[]>();
    for (const b of this.state.blobs.values()) {
      if (b.attacking < 0 || UNITS[b.type].naval || this.hostileIn(b.attacking, b.owner)) continue;
      fromNextDoor.set(b.attacking, [...(fromNextDoor.get(b.attacking) ?? []), b]);
    }
    this.state.regions.forEach((rs, i) => {
      if (this.world.isSea(i)) return; // the sea is nobody's
      if (this.contested(i) || this.underAttack(i)) return; // fighting: capture waits
      // Who could take it: anyone in it, or taking it from next door, who isn't the owner
      // (peaceful neighbours share neutral land; whoever started capturing first keeps going,
      // and on a tie the strongest). Ships don't.
      const capturers = [...this.blobsIn(i), ...(fromNextDoor.get(i) ?? [])].filter(
        (b) => !UNITS[b.type].naval && b.owner !== rs.owner && (rs.owner === NEUTRAL || this.atWar(b.owner, rs.owner)),
      );
      const strength = new Map<number, number>();
      for (const b of capturers) strength.set(b.owner, (strength.get(b.owner) ?? 0) + b.strength);
      let by = rs.capture && strength.has(rs.capture.by) ? rs.capture.by : undefined;
      if (by === undefined) for (const [o, st] of strength) if (by === undefined || st > (strength.get(by) as number)) by = o;
      if (by === undefined) {
        if (rs.capture) {
          rs.capture.progress -= CAPTURE_DECAY * dt;
          if (rs.capture.progress <= 0) rs.capture = null;
        }
        return;
      }
      if (!rs.capture || rs.capture.by !== by) rs.capture = { by, progress: 0 };
      const training = Math.max(...capturers.filter((b) => b.owner === by).map((b) => b.training));
      // Storm troops take land a quarter faster.
      const storm = this.has(by, 'stormtroops') ? 1.25 : 1;
      rs.capture.progress += (dt * storm) / this.world.captureSeconds(i, rs.fort, training, rs.owner === NEUTRAL);
      if (rs.capture.progress >= 1) this.take(i, by);
    });
  }

  /** `by` takes a region: its stores' share of the loser's stock goes with it, and taking a
   * capital knocks its country out. */
  private take(i: number, by: number): void {
    const rs = this.state.regions[i];
    const from = rs.owner;
    if (from !== NEUTRAL) this.state.warActivity.set(pairKey(by, from), this.state.time);
    const got = from !== NEUTRAL ? this.loot(i, from) : null;
    this.setOwner(i, by);
    this.events.push({ kind: 'captured', region: i, by, from });
    if (got) {
      const p = this.state.players[by];
      this.updateCaps();
      for (const k of RESOURCES) {
        got[k] = Math.max(0, Math.min(got[k], p.cap[k] - p.resources[k]));
        p.resources[k] += got[k];
      }
      if (RESOURCES.some((k) => got[k] > 0)) this.events.push({ kind: 'looted', region: i, by, from, got });
    }
    const lost = this.state.players.find((p) => p.alive && p.capital === i && p.id !== by);
    if (lost) this.eliminate(lost.id, by);
    this.checkDomination(by);
  }

  /** Land regions on the map (the domination win counts these). */
  private landCount = -1;

  /** Holding most of the land wins outright. */
  private checkDomination(player: number): void {
    // Only with someone to win against.
    if (this.state.winner !== null || !this.state.players[player]?.alive || this.state.players.length < 2) return;
    if (this.landCount < 0) this.landCount = this.world.regions.filter((r) => !r.sea).length;
    let held = 0;
    for (const rs of this.state.regions) if (rs.owner === player) held++;
    if (held < DOMINATION_SHARE * this.landCount) return;
    this.state.winner = player;
    this.events.push({ kind: 'won', player, domination: true });
  }

  /** Sets every player's storage size from the cities and depots they hold. */
  private updateCaps(): void {
    for (const p of this.state.players) p.cap = zero();
    this.state.regions.forEach((rs) => {
      if (rs.owner === NEUTRAL || (!rs.city && !rs.depots)) return;
      add(this.state.players[rs.owner].cap, storeOf(rs.city, rs.depots, this.techsOf(rs.owner)));
    });
  }

  /** Takes a region's share of its owner's stock (what its city and depots hold, out of all
   * their storage), or null if it stores nothing. */
  private loot(region: number, from: number): Resources | null {
    const rs = this.state.regions[region];
    if (!rs.city && !rs.depots) return null;
    this.updateCaps();
    const p = this.state.players[from];
    const here = storeOf(rs.city, rs.depots, p.techs);
    const got = zero();
    for (const k of RESOURCES) {
      if (p.cap[k] <= 0) continue;
      got[k] = p.resources[k] * Math.min(1, here[k] / p.cap[k]);
      p.resources[k] -= got[k];
    }
    return got;
  }

  /** Hands a region over. Buildings stay; queued work belonged to the old owner. */
  private setOwner(region: number, owner: number): void {
    const rs = this.state.regions[region];
    rs.owner = owner;
    rs.capture = null;
    rs.cutOff = 0;
    rs.supplied = false;
    rs.construction = null;
    rs.buildQueue = [];
    rs.production = { barracks: emptyLine(), factory: emptyLine(), port: emptyLine() };
    this.evictShips(region);
  }

  /** Ships docked in a region that's no longer their own port put out to sea (to the sea
   * off it with no enemy warships and room); blockaded in, they're lost. */
  private evictShips(region: number): void {
    const rs = this.state.regions[region];
    for (const b of [...this.state.blobs.values()]) {
      if (b.region !== region || !UNITS[b.type].naval || (rs.port && rs.owner === b.owner)) continue;
      const out = this.world.regions[region].coast.find((c) => !this.blockaded(c.id, b.owner) && this.count(b.owner, c.id) < this.stackCap(c.id));
      if (!out) {
        this.remove(b.id);
        continue;
      }
      b.from = region;
      b.region = out.id;
      b.path = [];
      b.progress = 0;
      b.entrench = 0;
      this.touch();
    }
  }

  // -- fronts (fronts.ts runs them) ----------------------------------------------------------

  /** The front a unit is on, if any. */
  frontOf(blobId: number): Front | undefined {
    return this.state.fronts.find((f) => f.units.includes(blobId));
  }

  /**
   * Hands units to the front on the border with `enemy` (made if there's none yet), taking them
   * off any other. With `attack` given, it also sets the front's plan: push toward `target`
   * (-1: anywhere along the line), or hold.
   */
  setFront(playerId: number, ids: number[], enemy: number, attack?: boolean, target = -1): string | null {
    if (!this.player(playerId)?.alive) return 'you are not in the game';
    if (enemy === playerId || !this.player(enemy)?.alive) return 'pick another country';
    const units = [...new Set(ids)].filter((id) => {
      const b = this.state.blobs.get(id);
      return !!b && b.owner === playerId && !UNITS[b.type].naval;
    });
    let front = this.state.fronts.find((f) => f.owner === playerId && f.enemy === enemy);
    if (!units.length && !front) return 'pick land units for the front';
    if (target >= 0 && (!this.world.regions[target] || this.world.isSea(target))) return 'a battle plan needs a target on land';
    this.leaveFronts(playerId, units);
    front = this.state.fronts.find((f) => f.owner === playerId && f.enemy === enemy);
    if (!front) {
      front = { owner: playerId, enemy, units: [], attack: false, target: -1 };
      this.state.fronts.push(front);
    }
    front.units.push(...units);
    if (attack !== undefined) {
      front.attack = attack;
      front.target = attack ? target : -1;
    }
    return null;
  }

  /** Takes units off their fronts (they've been given orders by hand); a front left with
   * nobody on it goes. */
  leaveFronts(playerId: number, ids: number[]): void {
    const gone = new Set(ids);
    for (const f of this.state.fronts) if (f.owner === playerId) f.units = f.units.filter((id) => !gone.has(id));
    this.state.fronts = this.state.fronts.filter((f) => f.units.length > 0);
  }

  /** Dissolves a front: its units stay where they are, under orders by hand again. */
  dropFront(playerId: number, enemy: number): string | null {
    const before = this.state.fronts.length;
    this.state.fronts = this.state.fronts.filter((f) => !(f.owner === playerId && f.enemy === enemy));
    return this.state.fronts.length < before ? null : 'no front there';
  }

  /** Gives up: the country goes the way of one whose capital fell. */
  surrender(playerId: number): string | null {
    const p = this.state.players[playerId];
    if (!p?.alive) return 'already out of the game';
    if (this.state.winner !== null) return 'the game is over';
    this.eliminate(playerId, playerId, true);
    return null;
  }

  private eliminate(playerId: number, by: number, surrendered = false): void {
    const p = this.state.players[playerId];
    p.alive = false;
    this.state.fronts = this.state.fronts.filter((f) => f.owner !== playerId && f.enemy !== playerId);
    this.state.regions.forEach((rs, i) => {
      if (rs.owner === playerId) this.setOwner(i, NEUTRAL);
    });
    for (const b of [...this.state.blobs.values()]) if (b.owner === playerId) this.remove(b.id);
    for (const key of [...this.state.wars]) if (key.split(':').map(Number).includes(playerId)) this.state.wars.delete(key);
    for (const key of [...this.state.peaceOffers.keys()]) if (key.split('>').map(Number).includes(playerId)) this.state.peaceOffers.delete(key);
    this.events.push({ kind: 'eliminated', player: playerId, by, ...(surrendered ? { surrendered } : {}) });
    const alive = this.state.players.filter((x) => x.alive);
    if (alive.length === 1) {
      this.state.winner = alive[0].id;
      this.events.push({ kind: 'won', player: alive[0].id });
    }
  }

  // -- economy ----------------------------------------------------------------------------

  private economy(dt: number): void {
    const players = this.state.players;
    for (const p of players) {
      p.income = zero();
      p.income.research = BASE_RESEARCH;
      p.upkeep = 0;
    }
    this.state.regions.forEach((rs, i) => {
      if (rs.owner === NEUTRAL || !rs.supplied || this.hostileIn(i, rs.owner)) return;
      add(players[rs.owner].income, this.yieldOf(i, rs, players[rs.owner].techs));
    });
    // Upkeep on what's left of each unit, so an army withering for lack of money costs less.
    for (const b of this.state.blobs.values()) players[b.owner].upkeep += b.strength * UNITS[b.type].upkeep;
    this.updateCaps();
    for (const p of players) {
      if (!p.alive) continue;
      // Income fills the stores up to their size; the rest is lost. Stores shrink with the
      // cities and depots that hold them: losing one loses what no longer fits.
      for (const k of RESOURCES) p.resources[k] = Math.min(p.cap[k], p.resources[k] + p.income[k] * dt);
      // Research takes its points from the stock as they come.
      if (p.research) {
        const pay = Math.min(p.resources.research, p.research.cost - p.research.paid);
        p.research.paid += pay;
        p.resources.research -= pay;
        if (p.research.paid >= p.research.cost - 1e-9) {
          p.techs.push(p.research.tech);
          this.events.push({ kind: 'researched', player: p.id, tech: p.research.tech });
          p.research = null;
        }
      }
      p.resources.money -= p.upkeep * dt;
      p.broke = p.resources.money < -1e-6;
      if (p.broke) p.resources.money = 0;
    }
    this.state.regions.forEach((rs, i) => {
      if (rs.owner === NEUTRAL || !rs.supplied || this.hostileIn(i, rs.owner)) return;
      this.construct(rs, i, dt);
      this.produceIn(rs, i, 'barracks', dt);
      this.produceIn(rs, i, 'factory', dt);
      this.produceIn(rs, i, 'port', dt);
    });
  }

  /** A region's yield, worked out again only when its city, buildings or its owner's techs change. */
  private readonly yields: Array<{ key: number; y: Resources } | undefined> = [];
  private yieldOf(i: number, rs: RegionState, techs: Techs): Resources {
    const e = rs.econ;
    // Techs only ever grow, so the owner and how many they have pin them down.
    const key = rs.city + 10 * (e.farm + 20 * (e.mine + 20 * (e.well + 20 * (e.market + 20 * (e.lab + 20 * (techs.length + 32 * (rs.owner + 1)))))));
    const hit = this.yields[i];
    if (hit && hit.key === key) return hit.y;
    const y = regionYield(this.world.regions[i], rs.city, rs.econ, techs);
    this.yields[i] = { key, y };
    return y;
  }

  private construct(rs: RegionState, region: number, dt: number): void {
    const c = rs.construction;
    if (!c) return;
    c.progress += dt;
    if (c.progress < c.seconds) return;
    rs.construction = rs.buildQueue.shift() ?? null;
    if (c.kind === 'fort') {
      // One level up from what stands (a siege may have knocked it down meanwhile).
      rs.fort = Math.min(c.level, rs.fort + 1);
      rs.siege = 0;
    }
    else if (c.kind === 'city') rs.city = c.level;
    else if (c.kind === 'barracks' || c.kind === 'factory' || c.kind === 'port' || c.kind === 'battery') rs[c.kind] = true;
    else if (c.kind === 'depot') rs.depots++;
    else if (c.kind === 'road') {
      // The other end changed hands meanwhile: give the money back instead.
      if (this.state.regions[c.target].owner !== rs.owner) {
        this.refund(this.state.players[rs.owner], c.cost);
        return;
      }
      this.state.roads.add(pairKey(region, c.target));
    } else if (maxLevel(c.kind) > 1) {
      // A level up from what stands (one may have been knocked down meanwhile).
      rs.econ[c.kind] = Math.min(c.level, rs.econ[c.kind] + 1);
    } else rs.econ[c.kind]++;
    this.events.push({ kind: 'built', region, owner: rs.owner, building: c.kind, level: c.level });
  }

  private produceIn(rs: RegionState, region: number, building: ProductionBuilding, dt: number): void {
    const line = rs.production[building];
    if (!rs[building] || line.queue.length === 0) return;
    const type = line.queue[0];
    const p = this.state.players[rs.owner];
    if (line.progress < 0) {
      const cost = this.statsOf(type, rs.owner).cost;
      if (!this.pay(p, cost)) return;
      line.paid = { ...cost };
      line.progress = 0;
    }
    const buildTime = this.statsOf(type, rs.owner).buildTime;
    line.progress = Math.min(buildTime, line.progress + dt);
    if (line.progress < buildTime) return;
    if (this.count(rs.owner, region) >= this.stackCap(region)) return; // done, waiting for room
    this.spawn(rs.owner, type, region);
    this.events.push({ kind: 'produced', region, owner: rs.owner, type });
    line.queue.shift();
    line.progress = -1;
    if (line.repeat) line.queue.push(type);
  }

  // -- blobs over time --------------------------------------------------------------------

  private blobUpkeep(dt: number, fighting: Set<number>): void {
    for (const b of [...this.state.blobs.values()]) {
      const p = this.state.players[b.owner];
      const still = b.progress === 0 && b.path.length === 0;
      const inBattle = fighting.has(b.id);
      // Digging in: holding still in its own land (waiting, or shelling from the border, too),
      // not on the move and not attacking.
      if (b.progress === 0 && b.attacking < 0 && this.state.regions[b.region].owner === b.owner) {
        b.entrench = Math.min(1, b.entrench + dt / entrenchSeconds(p.techs));
      }
      // Ships repair only in port (at sea too, slowly, with a fleet train); troops at sea can't
      // refill or drill.
      const atSea = this.world.isSea(b.region);
      const mendAtSea = atSea && !!UNITS[b.type].naval && p.techs.includes('fleetTrain');
      if (!inBattle && b.supply > 0 && (!atSea || mendAtSea)) {
        const cap = drillCap(p.techs);
        if (still && !atSea && b.training < cap) b.training = Math.min(cap, b.training + DRILL_RATE * dt * b.supply);
        const rate = REFILL_RATE * (p.techs.includes('hospitals') ? 2 : 1) * (mendAtSea ? 0.5 : 1);
        const want = Math.min(b.size - b.strength, rate * dt * b.supply);
        if (want > 0) {
          const cost = this.statsOf(b.type, b.owner).refillCost;
          if (this.pay(p, { money: cost.money * want, manpower: cost.manpower * want, steel: cost.steel * want, oil: cost.oil * want, research: 0 })) {
            b.strength += want;
          }
        }
      }
      if (b.supply < 1) {
        b.strength -= (1 - b.supply) * OUT_OF_SUPPLY_LOSS * (p.techs.includes('supplyCorps') ? 0.5 : 1) * b.size * dt;
        b.training = Math.max(0, b.training - (1 - b.supply) * OUT_OF_SUPPLY_TRAINING * dt);
      }
      if (p.broke) {
        b.strength -= BROKE_LOSS * b.size * dt;
        b.training = Math.max(0, b.training - BROKE_TRAINING * dt);
      }
      if (b.strength < MIN_STRENGTH) this.remove(b.id);
    }
  }

  // -- helpers ----------------------------------------------------------------------------

  spawn(owner: number, type: UnitType, region: number): Blob {
    const b: Blob = {
      id: this.state.nextBlobId++,
      owner,
      type,
      strength: UNITS[type].batch,
      size: UNITS[type].batch,
      training: 0,
      region,
      path: [],
      progress: 0,
      entrench: 0,
      crossedRiver: false,
      from: -1,
      supply: 1,
      waiting: false,
      through: -1,
      attacking: -1,
      bombarding: -1,
    };
    this.state.blobs.set(b.id, b);
    this.touch();
    return b;
  }

  private remove(id: number): void {
    this.state.blobs.delete(id);
    this.touch();
  }

  canAfford(p: Player, cost: Resources): boolean {
    return RESOURCES.every((k) => p.resources[k] >= cost[k]);
  }

  private pay(p: Player, cost: Resources): boolean {
    if (!this.canAfford(p, cost)) return false;
    for (const k of RESOURCES) p.resources[k] -= cost[k];
    return true;
  }

  /** Gives resources back, into the stores like income: what doesn't fit is lost. */
  private refund(p: Player, cost: Resources): void {
    this.updateCaps();
    for (const k of RESOURCES) p.resources[k] = Math.max(p.resources[k], Math.min(p.cap[k], p.resources[k] + cost[k]));
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function add(into: Resources, from: Partial<Resources>, times = 1): void {
  for (const k of RESOURCES) into[k] += (from[k] ?? 0) * times;
}
