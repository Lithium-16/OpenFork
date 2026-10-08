// The simulation's state. Plain data, so it can be snapshotted and tested directly.
import type {
  BotDifficulty,
  BuildingKind,
  EconKind,
  ProductionBuilding,
  Resources,
  TechId,
  UnitType,
} from '../../shared/rules.ts';

export const NEUTRAL = -1;

export interface Blob {
  id: number;
  owner: number;
  type: UnitType;
  /** Current strength; at most `size`. */
  strength: number;
  /** Establishment: what refills aim for and upkeep is paid on. */
  size: number;
  training: number;
  /** Region it is in, or is leaving while on the move. */
  region: number;
  /** Regions still to go to, next first. Empty when not moving. */
  path: number[];
  /** 0..1 along the edge from `region` to `path[0]`; 0 while waiting in a region. */
  progress: number;
  /** 0..1, grows while it holds still in its own region. */
  entrench: number;
  /** Has orders but is waiting in its region: the next region is full, or (troops) enemy
   * warships hold the sea ahead, or (artillery) enemies stand there and it shells them instead. */
  waiting: boolean;
  /** Going home through this country's land after peace (-1: none). */
  through: number;
  /** Came into its region across a river (the defender there gets the river bonus). */
  crossedRiver: boolean;
  /** The region it came into its region from (-1: it started there). A unit in a fight may
   * only retreat: back there, or to its own land. */
  from: number;
  /** 0..1, set by the supply pass. */
  supply: number;
  /** The neighbouring region it is attacking, or taking, from its own (-1: none). Set each tick. */
  attacking: number;
  /** Artillery: the region it shells this tick, or -1. */
  bombarding: number;
  /** Guns (artillery, warships): shell the enemy's buildings instead of their troops. */
  hitBuildings: boolean;
  /** Auto: it takes nearby neutral and enemy land on its own (see auto.ts) until given an order. */
  auto: boolean;
}

export interface ProductionLine {
  queue: UnitType[];
  /** Seconds done on the head of the queue; -1 until it is paid for. */
  progress: number;
  repeat: boolean;
  /** What the head of the queue cost when it was paid for (refunded if cancelled). */
  paid?: Resources;
}

export interface Construction {
  kind: BuildingKind;
  level: number;
  progress: number;
  seconds: number;
  /** What was paid, refunded in full if cancelled. */
  cost: Resources;
  /** A road's other end; -1 for everything else. */
  target: number;
}

export interface RegionState {
  owner: number;
  fort: number;
  /** City level (0: no city). */
  city: number;
  /** Economic buildings by kind. */
  econ: Record<EconKind, number>;
  barracks: boolean;
  factory: boolean;
  /** A port (coastal regions only): ships are built and dock here, troops board here. */
  port: boolean;
  /** A coastal battery: shells enemy ships and troops at sea off this coast. */
  battery: boolean;
  /** Depots: storage (see STORE_PER_DEPOT). */
  depots: number;
  production: Record<ProductionBuilding, ProductionLine>;
  construction: Construction | null;
  /** Builds waiting behind the one under way (paid for already). */
  buildQueue: Construction[];
  capture: { by: number; progress: number } | null;
  /** In supply for its owner (set by the supply pass). */
  supplied: boolean;
  /** Seconds it has been cut off with none of its owner's blobs in it. */
  cutOff: number;
  /** How far enemy shelling has worn its fort toward losing a level (0 to 1). */
  siege: number;
  /** How far shelling and fighting have worn its buildings toward losing a level (0 to 1). */
  damage: number;
  /** When it was last shelled or fought over (damage mends only some time after). */
  hitAt: number;
}

export interface Player {
  id: number;
  name: string;
  country: string;
  color: string;
  /** Who is playing it right now. A human's country is played by a bot while they're away. */
  control: 'human' | 'bot';
  /** Bot strength when control is 'bot'. */
  difficulty: BotDifficulty;
  alive: boolean;
  capital: number;
  resources: Resources;
  broke: boolean;
  /** Per-second rates, for the HUD. */
  income: Resources;
  /** Most it can stockpile (cities and depots; set each tick). */
  cap: Resources;
  /** Techs researched, and the one under way (paid for). */
  techs: TechId[];
  /** The tech under way: research points paid in so far, out of what it takes. */
  research: { tech: TechId; paid: number; cost: number } | null;
  upkeep: number;
}

export type SimEvent =
  | { kind: 'war'; a: number; b: number; by: number }
  | { kind: 'peace'; a: number; b: number }
  | { kind: 'peaceOffer'; from: number; to: number }
  | { kind: 'peaceRefused'; from: number; to: number }
  | { kind: 'battle'; region: number; sides: number[] }
  | { kind: 'captured'; region: number; by: number; from: number }
  | { kind: 'routed'; region: number; owner: number; by: number }
  | { kind: 'looted'; region: number; by: number; from: number; got: Resources }
  | { kind: 'researched'; player: number; tech: TechId }
  | { kind: 'built'; region: number; owner: number; building: BuildingKind; level: number }
  | { kind: 'produced'; region: number; owner: number; type: UnitType }
  | { kind: 'eliminated'; player: number; by: number; surrendered?: boolean }
  | { kind: 'won'; player: number; domination?: boolean }
  /** Shelling knocked a fort down a level (to `level`). */
  | { kind: 'breached'; region: number; owner: number; by: number; level: number }
  /** Shelling or fighting knocked a building down a level (to `level`; 0: gone). `by` is -1
   * when nobody in particular did it. */
  | { kind: 'wrecked'; region: number; owner: number; by: number; building: WreckKind; level: number };

/** What shelling and fighting knock down, in this order. */
export type WreckKind = 'port' | 'factory' | 'barracks' | 'mine' | 'market' | 'well' | 'farm' | 'city';

export interface SimState {
  /** Seconds since the start. */
  time: number;
  players: Player[];
  regions: RegionState[];
  blobs: Map<number, Blob>;
  nextBlobId: number;
  winner: number | null;
  /** Diplomacy between players (keys from pairKey). Everyone starts at peace. */
  wars: Set<string>;
  /** Pair → sim time a war began, or the last capture between them. */
  warActivity: Map<string, number>;
  /** Pair → sim time until which neither may declare war (after making peace). */
  truces: Map<string, number>;
  /** "from>to" → sim time the offer of peace expires. */
  peaceOffers: Map<string, number>;
  /** Borders with a road (keys from pairKey on the two regions). */
  roads: Set<string>;
  /** Fronts and battle plans (see fronts.ts): units a country has handed to hold, or push
   * across, its border with another. */
  fronts: Front[];
}

/** A front: units holding a country's border with another, or (a battle plan) pushing into
 * it toward a target. One per pair of countries; a unit is on one front at most. */
export interface Front {
  owner: number;
  /** The country across the line. */
  enemy: number;
  units: number[];
  /** A battle plan: attack (when at war with them), else hold. */
  attack: boolean;
  /** Where the plan pushes toward; -1: anywhere along the line. */
  target: number;
}

/** Key for an unordered pair (of players, or of regions for roads). */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function emptyLine(): ProductionLine {
  return { queue: [], progress: -1, repeat: false };
}

export function emptyRegion(): RegionState {
  return {
    owner: NEUTRAL,
    fort: 0,
    city: 0,
    econ: { farm: 0, mine: 0, well: 0, market: 0, lab: 0 },
    depots: 0,
    barracks: false,
    port: false,
    battery: false,
    factory: false,
    production: { barracks: emptyLine(), factory: emptyLine(), port: emptyLine() },
    construction: null,
    buildQueue: [],
    capture: null,
    supplied: false,
    cutOff: 0,
    siege: 0,
    damage: 0,
    hitAt: -1e9,
  };
}
