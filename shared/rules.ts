// Every gameplay number lives here (DESIGN.md has the rules in words). Rates are per second
// unless they say otherwise; the server multiplies by the tick length.
import { type Region, type RegionSize, type Terrain, TERRAINS } from './map.ts';

export const TICK_MS = 100;
/** How often clients get a full state snapshot. */
export const SNAPSHOT_EVERY_TICKS = 2;

// -- units ------------------------------------------------------------------------------------

export type UnitType = 'infantry' | 'tank' | 'artillery' | 'warship';
export const UNIT_TYPES: readonly UnitType[] = ['infantry', 'tank', 'artillery', 'warship'];

export interface Resources {
  money: number;
  manpower: number;
  steel: number;
  oil: number;
  /** Research points: spent on techs (see TECHS), made by labs and cities. */
  research: number;
}
export const RESOURCES: readonly (keyof Resources)[] = ['money', 'manpower', 'steel', 'oil', 'research'];

export interface UnitStats {
  /** Most strength one blob can have; merging stops here. */
  maxSize: number;
  /** Size of a freshly produced blob. */
  batch: number;
  /** Movement speed multiplier (1 = infantry). */
  speed: number;
  attack: number;
  defense: number;
  /** Attack multiplier by the terrain of the region the battle is in. */
  terrainAttack: Record<Terrain, number>;
  /** Cost of one batch, paid when production starts. */
  cost: Resources;
  /** Seconds to produce one batch. */
  buildTime: number;
  /** Money per second per point of size. */
  upkeep: number;
  /** What one point of strength costs to refill. */
  refillCost: Resources;
  /** How much supply one point of size needs. */
  supplyNeed: number;
  /** Building that produces it. */
  producedAt: ProductionBuilding;
  /** Artillery: shells enemies this many regions away while standing still, at this attack
   * (its `attack` is only for close combat). It never joins an assault from the border. */
  range?: number;
  bombard?: number;
  /** A ship: it moves on sea regions and into its own ports, fights other ships and troops at
   * sea, and shells coasts next to it; it never fights on land. */
  naval?: boolean;
}

export const UNITS: Record<UnitType, UnitStats> = {
  infantry: {
    maxSize: 100,
    batch: 10,
    speed: 1,
    attack: 1,
    defense: 1.2,
    terrainAttack: { plains: 1, forest: 1, hills: 1, mountains: 1 },
    cost: { money: 50, manpower: 100, steel: 0, oil: 0, research: 0 },
    buildTime: 20,
    upkeep: 0.02,
    refillCost: { money: 1, manpower: 5, steel: 0, oil: 0, research: 0 },
    supplyNeed: 1,
    producedAt: 'barracks',
  },
  tank: {
    maxSize: 100,
    batch: 5,
    speed: 1.8,
    attack: 2.5,
    defense: 1.5,
    terrainAttack: { plains: 1.2, forest: 0.6, hills: 0.7, mountains: 0.4 },
    cost: { money: 90, manpower: 30, steel: 38, oil: 18, research: 0 },
    buildTime: 30,
    upkeep: 0.06,
    refillCost: { money: 3, manpower: 1, steel: 3, oil: 1, research: 0 },
    supplyNeed: 2,
    producedAt: 'factory',
  },
  artillery: {
    maxSize: 100,
    batch: 5,
    speed: 0.7,
    // Guns, not riflemen: next to useless up close, and it breaks fast.
    attack: 0.2,
    defense: 0.35,
    terrainAttack: { plains: 1, forest: 1, hills: 1, mountains: 1 },
    cost: { money: 80, manpower: 30, steel: 30, oil: 0, research: 0 },
    buildTime: 30,
    upkeep: 0.04,
    refillCost: { money: 2, manpower: 3, steel: 2, oil: 0, research: 0 },
    supplyNeed: 1.5,
    producedAt: 'factory',
    range: 2,
    bombard: 2,
  },
  warship: {
    maxSize: 100,
    batch: 5,
    speed: 1.6,
    attack: 2,
    defense: 1.5,
    terrainAttack: { plains: 1, forest: 1, hills: 1, mountains: 1 },
    cost: { money: 120, manpower: 20, steel: 60, oil: 15, research: 0 },
    buildTime: 40,
    upkeep: 0.06,
    refillCost: { money: 3, manpower: 1, steel: 3, oil: 1, research: 0 },
    // Supplied from ports, not from the land (see SEA_SUPPLY_HOPS).
    supplyNeed: 0,
    producedAt: 'port',
    naval: true,
    range: 1,
    bombard: 1,
  },
};

// -- the sea ------------------------------------------------------------------------------------

/** Troops board at their own ports: this long, on top of the trip. */
export const EMBARK_SECONDS = 8;
/** How fast troops are shipped (1 = infantry marching on plains). */
export const TRANSPORT_SPEED = 1.4;
/** Troops at sea: damage dealt and taken (they're packed in ships). */
export const AT_SEA_ATTACK = 0.25;
export const AT_SEA_DEFENSE = 0.5;
/** Storming a coast from the sea: the landing troops' attack. */
export const LANDING_ATTACK = 0.5;
/** Ships are supplied this many sea regions out from their country's ports. */
export const SEA_SUPPLY_HOPS = 3;
/** How many tokens of one country a sea region holds. */
export const SEA_STACK = 12;

/** Shells hit dug-in units as hard as any (no digging-in bonus), and forts count this share. */
export const BOMBARD_FORT_SHARE = 0.5;
/** A coastal battery shells enemy ships and troops at sea in the seas off its coast with this
 * much bombard power (about 10 strength of artillery), while its region is supplied and not fought over. */
export const BATTERY_BOMBARD = 20;
/** Defenders of a region with a coastal battery: extra defence against troops landing from the sea. */
export const BATTERY_LANDING_BONUS = 0.5;

/** What a production building makes: the first is what it makes unless told otherwise. */
export function unitsOf(building: ProductionBuilding): UnitType[] {
  return UNIT_TYPES.filter((t) => UNITS[t].producedAt === building);
}

// -- movement ---------------------------------------------------------------------------------

/** Seconds for a speed-1 blob to go between two regions a typical distance apart, on plains. */
export const CROSS_SECONDS = 5.5;
export const TERRAIN_MOVE: Record<Terrain, number> = { plains: 1, forest: 0.7, hills: 0.6, mountains: 0.4 };
/** Speed into enemy-owned land (zone of control), and how much each fort level there takes off. */
export const ENEMY_LAND_MOVE = 0.7;
export const FORT_MOVE_PENALTY = 0.1;
/** Leaving a battle costs this share of strength and this much training. */
export const RETREAT_STRENGTH_LOSS = 0.15;
export const RETREAT_TRAINING_LOSS = 10;

// -- capturing --------------------------------------------------------------------------------

/** Seconds to capture an empty medium plains region with untrained blobs, before modifiers. */
export const CAPTURE_SECONDS = 9.5;
export const CAPTURE_SIZE: Record<RegionSize, number> = { small: 0.7, medium: 1, large: 1.4 };
export const CAPTURE_TERRAIN: Record<Terrain, number> = { plains: 1, forest: 1.2, hills: 1.3, mountains: 1.6 };
/** Each fort level adds this share to capture time. */
export const CAPTURE_FORT = 0.5;
/** At 100 training, capture runs this much faster (1.5 = 50% faster). */
export const CAPTURE_TRAINING = 0.5;
/** Land nobody holds takes this much longer to take than an enemy's (the land grab lasts). */
export const CAPTURE_NEUTRAL = 1.3;
/** Each city level adds this share to capture time (towns hold out longer). */
export const CAPTURE_CITY = 0.15;
/** A country's capital takes this many times as long to take. */
export const CAPTURE_CAPITAL = 2;
/** Capture progress lost per second while nobody is capturing. */
export const CAPTURE_DECAY = 0.2;

// -- battles ----------------------------------------------------------------------------------

/** Strength removed per second per point of attack power. */
export const DAMAGE_RATE = 0.05;
export const FORT_BONUS = 0.5; // per fort level
/** Sieges: guns shelling an enemy fort wear it down, a level per this much shelling (shell
 * power, as for damage: a 20-strength battery of artillery takes a level in about 80 s). */
export const FORT_SIEGE_POWER = 160;
/** Holding this share of all the land wins outright (no need to take every capital). */
export const DOMINATION_SHARE = 0.7;
export const ENTRENCH_BONUS = 0.5; // when fully dug in
export const ENTRENCH_SECONDS = 60;
export const RIVER_BONUS = 0.25;
/** Units standing in rough ground take less damage in battles (added to the defence bonus). */
export const TERRAIN_DEFENSE: Record<Terrain, number> = { plains: 0, forest: 0.15, hills: 0.25, mountains: 0.4 };
/** Attacking a region from more than one neighbouring region: each attacking side's damage
 * there goes up this much per extra region it attacks from, up to FLANK_MAX_EXTRA extra regions. */
export const FLANK_BONUS = 0.15;
export const FLANK_MAX_EXTRA = 3;
/** Defenders rout (flee to their nearest region with room, losing ROUT_LOSS of their strength,
 * and the attackers take the region at once) when they are down to ROUT_SHARE of their
 * strength in the fight and outnumbered ROUT_ODDS to 1. Nowhere to flee: they're destroyed. */
export const ROUT_SHARE = 0.2;
export const ROUT_ODDS = 4;
export const ROUT_LOSS = 0.1;
/** How far (hops through their own land) routed units may flee. */
export const ROUT_HOPS = 3;
/** At 100 training: damage dealt ×(1 + this), damage taken ×(1 - this). */
export const TRAINING_DAMAGE = 0.5;
export const TRAINING_PROTECTION = 0.33;
/** Training gained per second in battle (veterancy). */
export const VETERANCY_RATE = 0.5;
/** A blob with less strength than this is destroyed. */
export const MIN_STRENGTH = 0.05;

// -- training ---------------------------------------------------------------------------------

export const MAX_TRAINING = 100;
/** Idle, supplied blobs drill up to this; only combat goes higher. */
export const DRILL_CAP = 50;
export const DRILL_RATE = 1 / 6;
export const MERGE_PENALTY = 10;
/** A unit merges only with at least this share of its full strength (no patching up wrecks). */
export const MERGE_MIN_STRENGTH = 0.25;
/** Disbanding gives back this share of the manpower its remaining strength cost. */
export const DISBAND_REFUND = 0.5;

// -- supply -----------------------------------------------------------------------------------

/** Every city is a supply hub: it reaches this many hops through your land, plus its level
 * (a level-3 capital reaches 6). A border with a road counts as half a hop. */
export const SUPPLY_REACH_BASE = 3;
export const ROAD_SUPPLY_HOP = 0.5;
/** Supply capacity of a region, by terrain, and how much a city in it adds per level. */
export const SUPPLY_BASE = 90;
export const SUPPLY_TERRAIN: Record<Terrain, number> = { plains: 1, forest: 0.9, hills: 0.8, mountains: 0.6 };
export const SUPPLY_PER_CITY_LEVEL = 0.25;
/** Out of supply: share of size lost per second, and training lost per second. */
export const OUT_OF_SUPPLY_LOSS = 0.005;
export const OUT_OF_SUPPLY_TRAINING = 0.2;
/** Strength refilled per second while in supply (paid with UnitStats.refillCost)... */
export const REFILL_RATE = 0.15;
/** ...plus this share of the unit's size, so a big unit mends about as quickly as a small one. */
export const REFILL_SHARE = 0.012;
/** Refilling this much faster at home: troops in their own town or port, ships in port or in
 * the sea off one of their ports. */
export const HOME_REFILL = 1.5;
/** A cut-off region with none of your blobs in or next to it turns neutral after this many
 * seconds. */
export const CUT_OFF_SECONDS = 15;
/** Broke (upkeep beyond money): share of size lost per second, and training lost per second. */
export const BROKE_LOSS = 0.003;
export const BROKE_TRAINING = 0.2;

// -- stacking ---------------------------------------------------------------------------------

/** Tokens one player may have standing in a region, by size and terrain, plus one per fort
 * level and per city level. Units only passing through their own land don't count. */
export const STACK_SIZE: Record<RegionSize, number> = { small: 2, medium: 3, large: 4 };
export const STACK_TERRAIN: Record<Terrain, number> = { plains: 0, forest: 0, hills: 0, mountains: -1 };
export const STACK_MIN = 2;

// -- economy ----------------------------------------------------------------------------------

// Land on its own yields nothing: cities (tax) and economic buildings do. A region's traits
// make the matching building yield more (see econYield).

export type StartingResources = 'low' | 'normal' | 'high';
export const STARTING: Resources = { money: 150, manpower: 250, steel: 40, oil: 20, research: 0 };
export const STARTING_MULTIPLIER: Record<StartingResources, number> = { low: 0.5, normal: 1, high: 2 };

// -- buildings --------------------------------------------------------------------------------

export type ProductionBuilding = 'barracks' | 'factory' | 'port';
/** Economic buildings: each takes a slot and raises one resource. */
export type EconKind = 'farm' | 'mine' | 'well' | 'market' | 'lab';
export const ECON_KINDS: readonly EconKind[] = ['farm', 'mine', 'well', 'market', 'lab'];
/** 'city' founds a city, or expands one that's there; 'road' is built across a border. */
export type BuildingKind = EconKind | 'city' | 'fort' | ProductionBuilding | 'road' | 'depot' | 'battery';
/** Order matters: snapshots send a building's index here (new kinds go at the end). */
export const BUILDING_KINDS: readonly BuildingKind[] = ['farm', 'mine', 'well', 'market', 'city', 'fort', 'barracks', 'factory', 'road', 'depot', 'lab', 'port', 'battery'];
export const MAX_FORT = 3;
export const MAX_CITY = 5;
/** Mines and markets: one per region, upgraded in place up to this level (one slot at any level). */
export const MAX_ECON_LEVEL = 3;
/** Economic buildings that level up instead of being built again (the rest: one per slot). */
export const LEVELLED_ECON: readonly EconKind[] = ['mine', 'market'];

/** The highest level of a building that's upgraded in place; 1 for the rest. */
export function maxLevel(kind: BuildingKind): number {
  if (kind === 'fort') return MAX_FORT;
  if (kind === 'city') return MAX_CITY;
  return LEVELLED_ECON.includes(kind as EconKind) ? MAX_ECON_LEVEL : 1;
}

/** Slots a region's economic buildings take: one each, a levelled one one at any level. */
export function econSlots(econ: Record<EconKind, number>): number {
  return ECON_KINDS.reduce((n, k) => n + (LEVELLED_ECON.includes(k) ? Math.min(1, econ[k]) : econ[k]), 0);
}
/** Builds a region can have waiting behind the one under way. */
export const BUILD_QUEUE = 3;
/** Building slots of a region, by size; a city adds one per level. */
export const SLOTS: Record<RegionSize, number> = { small: 1, medium: 1, large: 2 };
/** Economic buildings only go this many hops from one of your cities. */
export const HINTERLAND_HOPS = 2;
/** A new city can't be founded closer than this many hops to another city. */
export const FOUND_CITY_MIN_HOPS = 2;
/** Crossing a border with a road takes this share of the time. */
export const ROAD_SPEED = 0.6;
/** What a city gives per level, every second (tax and manpower). */
export const CITY_YIELD: Resources = { money: 0.8, manpower: 0.25, steel: 0, oil: 0, research: 0 };
/** Research points every country makes without labs: enough to crawl up the tree. */
export const BASE_RESEARCH = 0.1;
/** Your capital starts at least this big; cities of countries nobody plays start at 1. */
export const START_CAPITAL_LEVEL = 3;
export const NEUTRAL_CITY_LEVEL = 1;

// -- storage ----------------------------------------------------------------------------------

/** What a country can stockpile: each city level stores this much, each depot this much more.
 * Income beyond it is lost. Taking a city or depot takes its share of the owner's stock. */
export const STORE_PER_CITY_LEVEL: Resources = { money: 250, manpower: 250, steel: 120, oil: 120, research: 100 };
export const STORE_PER_DEPOT: Resources = { money: 1000, manpower: 1000, steel: 500, oil: 500, research: 200 };

/** What one region stores. */
export function storeOf(city: number, depots: number, techs: Techs = []): Resources {
  const out = { money: 0, manpower: 0, steel: 0, oil: 0, research: 0 };
  const more = techs.includes('warehouses') ? 1.5 : 1;
  for (const k of RESOURCES) out[k] = (STORE_PER_CITY_LEVEL[k] * city + STORE_PER_DEPOT[k] * depots) * more;
  return out;
}

export function usesSlot(kind: BuildingKind): boolean {
  return kind !== 'city' && kind !== 'road';
}

export function slotsOf(region: Region, city: number): number {
  if (region.sea) return 0; // nothing is built at sea
  return SLOTS[region.size] + city;
}

/** What one economic building yields per second in a region: farmland, industry and
 * (for markets) a city make theirs yield more. */
export function econYield(kind: EconKind, region: Region, city = 0): Partial<Resources> {
  switch (kind) {
    case 'farm':
      return { manpower: region.traits.includes('farmland') ? 0.6 : 0.4 };
    case 'mine':
      return { steel: region.traits.includes('industry') ? 0.6 : 0.3 };
    case 'well':
      return { oil: 0.5 };
    case 'market':
      return { money: city > 0 ? 0.6 : 0.4 };
    case 'lab':
      return { research: 0.5 };
  }
}

/** Everything a region yields per second while it's supplied and not fought over: its city's
 * tax plus its economic buildings. */
export function regionYield(region: Region, city: number, econ: Record<EconKind, number>, techs: Techs = []): Resources {
  const out: Resources = { money: 0, manpower: 0, steel: 0, oil: 0, research: 0 };
  const bank = techs.includes('banking') ? 1.25 : 1;
  const men = techs.includes('totalWar') ? 1.25 : 1;
  out.money += CITY_YIELD.money * city * bank;
  out.manpower += CITY_YIELD.manpower * city;
  const boost: Record<EconKind, number> = {
    farm: techs.includes('farming') ? 1.3 : 1,
    mine: techs.includes('industry') ? 1.3 : 1,
    well: techs.includes('industry') ? 1.3 : 1,
    market: bank,
    lab: 1,
  };
  for (const kind of ECON_KINDS) {
    const y = econYield(kind, region, city);
    for (const k of RESOURCES) out[k] += (y[k] ?? 0) * econ[kind] * boost[kind];
  }
  out.manpower *= men;
  if (techs.includes('exchange')) out.money *= 1.15;
  return out;
}

/** Where a building may go by the region alone (the sim also checks owner, slots, reach). */
export function canBuildOn(kind: BuildingKind, region: Region, city: number): boolean {
  const t = region.traits;
  switch (kind) {
    case 'farm':
      return t.includes('farmland') || region.terrain === 'plains';
    case 'mine':
      return t.includes('industry') || region.terrain === 'hills' || region.terrain === 'mountains';
    case 'well':
      return t.includes('oil');
    case 'barracks':
    case 'factory':
    case 'lab':
      return city > 0;
    case 'port':
    case 'battery':
      return region.coast.length > 0;
    default:
      return true;
  }
}

/** Why `canBuildOn` says no, for the UI. */
export const BUILD_NEEDS: Partial<Record<BuildingKind, string>> = {
  farm: 'farmland or plains',
  mine: 'industry, hills or mountains',
  well: 'an oil field',
  barracks: 'a city',
  factory: 'a city',
  lab: 'a city',
  port: 'a coast',
  battery: 'a coast',
};

const res = (money: number, steel = 0): Resources => ({ money, manpower: 0, steel, oil: 0, research: 0 });

/** Cost and build time. `level` is the level reached: fort 1-3; city 1 = found, 2-5 = expand. */
export function buildCost(kind: BuildingKind, level = 1): { cost: Resources; seconds: number } {
  switch (kind) {
    case 'farm':
      return { cost: res(60), seconds: 60 };
    case 'mine':
      // Each level up costs more (and some steel), and takes longer.
      return { cost: res(80 * level, 15 * (level - 1)), seconds: 75 + 30 * (level - 1) };
    case 'well':
      return { cost: res(90, 10), seconds: 75 };
    case 'market':
      return { cost: res(70 * level, 10 * (level - 1)), seconds: 60 + 30 * (level - 1) };
    case 'city':
      return level <= 1 ? { cost: res(700, 160), seconds: 240 } : { cost: res(240 * level, 40 * (level - 1)), seconds: 60 * level };
    case 'fort':
      return { cost: res(60 * level, 10 * level), seconds: 60 * level };
    case 'barracks':
      return { cost: res(80), seconds: 60 };
    case 'factory':
      return { cost: res(150, 40), seconds: 120 };
    case 'road':
      return { cost: res(30, 5), seconds: 30 };
    case 'depot':
      return { cost: res(120, 20), seconds: 45 };
    case 'lab':
      return { cost: res(150, 30), seconds: 60 };
    case 'port':
      return { cost: res(150, 40), seconds: 90 };
    case 'battery':
      return { cost: res(120, 40), seconds: 75 };
  }
}

// -- the start --------------------------------------------------------------------------------

/** Regions around the capital owned at the start (besides the capital). */
export const START_EXTRA_REGIONS = 4;
export const START_INFANTRY = 3;

// -- diplomacy --------------------------------------------------------------------------------

/** After making peace, neither side may declare war for this long. */
export const TRUCE_SECONDS = 180;
/** A peace offer stands this long. */
export const PEACE_OFFER_SECONDS = 30;

/** When bots start wars nobody provoked: against a bordering country this much weaker. */
export interface Opportunism {
  /** Not before this many seconds into the match. */
  after: number;
  /** Our strength must be at least this many times theirs. */
  ratio: number;
  /** Chance per diplomacy check (every BOT_DIPLOMACY_SECONDS) that it acts on it. */
  chance: number;
  /** Wars it will fight at once (it never starts one beyond this). */
  maxWars: number;
  /** The lowest `ratio` falls to: the longer at peace, in the endgame, or with full stores. */
  boldest: number;
}
export const OPPORTUNISM: Record<BotDifficulty, Opportunism | null> = {
  defensive: null,
  easy: null,
  normal: { after: 300, ratio: 2, chance: 0.15, maxWars: 1, boldest: 1.1 },
  hard: { after: 180, ratio: 1.6, chance: 0.35, maxWars: 2, boldest: 0.9 },
};
/** How much the odds a bot needs to start a war drop per minute it has been at peace. */
export const BOT_BOLDER_PER_MINUTE = 0.1;
/** The endgame: with this many countries left (or fewer), bots fight it out. They start wars
 * at their boldest, don't make peace over a quiet front, and take peace only when losing. */
export const BOT_ENDGAME_COUNTRIES = 3;
/** Stores this full of money: a bot is as bold as it gets (it has nothing better to spend on). */
export const BOT_HOARD_SHARE = 0.7;
/** ...but only with this much money and this far into the match (early stores are small and
 * fill at once: that's no sign of a war chest). */
export const BOT_HOARD_MONEY = 1500;
export const BOT_HOARD_AFTER = 900;
/** Countries across this many sea regions (or fewer) count as neighbours a bot may pick on;
 * it wants a bigger edge for them (a landing is harder than a march). */
export const BOT_SEA_NEIGHBOUR_HOPS = 2;
export const BOT_SEA_ODDS = 1.3;
export const BOT_DIPLOMACY_SECONDS = 45;
/** Bots offer peace when they're this much weaker than the enemy, or after a long stalemate. */
export const BOT_PEACE_WHEN_WEAKER = 0.7;
export const BOT_PEACE_STALEMATE_SECONDS = 240;
/** A bot at war this long may take an offer of peace even when winning. */
export const BOT_LONG_WAR_SECONDS = 600;
/** Wars last at least this long before a bot offers peace. */
export const BOT_MIN_WAR_SECONDS = 180;

// -- lobby ------------------------------------------------------------------------------------

/** Bot fill and random deals keep capitals at least this far apart (spawn spacing). */
export const MIN_CAPITAL_KM = 600;
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 15;
/** Bot play styles. Defensive: never starts a war or takes new land; builds its economy
 * and forts, and at war only fights to take back its own land. */
export type BotDifficulty = 'defensive' | 'easy' | 'normal' | 'hard';
/** The lobby's bot setting: a difficulty for the bots that fill empty seats, or none at all
 * (pure PvP: one country per person). */
export type BotSetting = BotDifficulty | 'none';
export const BOT_SETTINGS: readonly BotSetting[] = ['none', 'defensive', 'easy', 'normal', 'hard'];
/** Pure PvP needs at least this many people. */
export const MIN_PVP_PLAYERS = 2;
/** A human who drops is replaced by a bot after this many seconds (until they come back). */
export const DISCONNECT_BOT_SECONDS = 10;

/** Muted military colours, one per country, picked to stay apart on the terrain. */
export const PLAYER_COLORS = [
  '#c0504d',
  '#4f81bd',
  '#9bbb59',
  '#e0a33a',
  '#8064a2',
  '#4bacc6',
  '#d46f3b',
  '#2f6b5a',
  '#d9c24a',
  '#d27fb4',
  '#8c5a3c',
  '#2e4a8a',
  '#7a2e3a',
  '#a99be0',
  '#3fa36b',
];

// -- per-region numbers -----------------------------------------------------------------------

export function stackCap(region: Region, city: number, fort: number): number {
  if (region.sea) return SEA_STACK;
  return Math.max(STACK_MIN, STACK_SIZE[region.size] + STACK_TERRAIN[region.terrain]) + city + fort;
}

export function supplyCapacity(region: Region, city: number, techs: Techs = []): number {
  return SUPPLY_BASE * SUPPLY_TERRAIN[region.terrain] * (1 + SUPPLY_PER_CITY_LEVEL * city) * (techs.includes('kitchens') ? 1.3 : 1);
}

/** How many hops a city of this level supplies. */
export function supplyReach(city: number, techs: Techs = []): number {
  return SUPPLY_REACH_BASE + city + (techs.includes('railways') ? 1 : 0) + (techs.includes('radio') ? 1 : 0);
}

// -- research -------------------------------------------------------------------------------

export type TechId =
  | 'rifles' | 'trenches' | 'conscription'
  | 'tanks' | 'engines' | 'armour' | 'fuel'
  | 'shells' | 'rangefinders' | 'longGuns'
  | 'farming' | 'industry' | 'banking'
  | 'warehouses' | 'railways' | 'kitchens'
  | 'stormtroops' | 'mountaineers' | 'barrage' | 'generalStaff'
  | 'blitz' | 'mechanized' | 'heavyTanks' | 'combinedArms'
  | 'massProduction' | 'assemblyLines' | 'totalWar' | 'exchange'
  | 'motorPool' | 'radio' | 'supplyCorps' | 'hospitals'
  | 'shipyards' | 'navalGuns' | 'coastalDefence' | 'fleetTrain' | 'amphibious' | 'dreadnoughts' | 'navalAviation';
/** A country's researched techs. */
export type Techs = readonly TechId[];

export interface Tech {
  id: TechId;
  branch: string;
  /** 1-5: its row in the tree. */
  tier: number;
  name: string;
  effect: string;
  /** Techs it needs first (its own branch's tier before, and sometimes another branch's). */
  needs: TechId[];
}

/** The tech tree: one root (what every country starts with) splits into five lines, and
 * each tech opens one or two more. Every tech has a single parent; `tier` is its depth. */
export const TECHS: readonly Tech[] = [
  { id: 'rifles', branch: 'Army', tier: 1, name: 'Rifles', effect: 'Infantry +20% attack', needs: [] },
  { id: 'trenches', branch: 'Army', tier: 2, name: 'Trenches', effect: 'Dig in twice as fast; dug in +50% stronger', needs: ['rifles'] },
  { id: 'shells', branch: 'Army', tier: 2, name: 'Heavy shells', effect: 'Artillery +30% shelling', needs: ['rifles'] },
  { id: 'rangefinders', branch: 'Army', tier: 3, name: 'Rangefinders', effect: 'Forts no help against shells', needs: ['shells'] },
  { id: 'longGuns', branch: 'Army', tier: 3, name: 'Long guns', effect: 'Artillery range 3', needs: ['shells'] },
  { id: 'stormtroops', branch: 'Army', tier: 3, name: 'Storm troops', effect: 'Infantry +15% attack; land taken 25% faster', needs: ['trenches'] },
  { id: 'mountaineers', branch: 'Army', tier: 4, name: 'Mountain troops', effect: 'Infantry +30% attack in forest, hills and mountains', needs: ['stormtroops'] },
  { id: 'barrage', branch: 'Army', tier: 4, name: 'Creeping barrage', effect: 'Artillery +25% shelling', needs: ['longGuns'] },
  { id: 'generalStaff', branch: 'Army', tier: 5, name: 'General staff', effect: 'All troops +10% attack; drill up to 75 training', needs: ['mountaineers'] },
  { id: 'tanks', branch: 'Armour', tier: 1, name: 'Tanks', effect: 'Factories can build tanks', needs: [] },
  { id: 'engines', branch: 'Armour', tier: 2, name: 'Engines', effect: 'Tanks +20% speed', needs: ['tanks'] },
  { id: 'armour', branch: 'Armour', tier: 2, name: 'Armour plate', effect: 'Tanks +30% defence', needs: ['tanks'] },
  { id: 'fuel', branch: 'Armour', tier: 3, name: 'Synthetic fuel', effect: 'Tanks −50% oil', needs: ['armour'] },
  { id: 'blitz', branch: 'Armour', tier: 3, name: 'Blitzkrieg', effect: 'Tanks +20% attack', needs: ['engines'] },
  { id: 'mechanized', branch: 'Armour', tier: 4, name: 'Mechanized infantry', effect: 'Infantry +25% speed', needs: ['blitz'] },
  { id: 'heavyTanks', branch: 'Armour', tier: 4, name: 'Heavy tanks', effect: 'Tanks +30% defence; rough ground hurts them half as much', needs: ['fuel'] },
  { id: 'combinedArms', branch: 'Armour', tier: 5, name: 'Combined arms', effect: 'Infantry and tanks +15% attack', needs: ['heavyTanks'] },
  { id: 'farming', branch: 'Economy', tier: 1, name: 'Farming', effect: 'Farms +30%', needs: [] },
  { id: 'conscription', branch: 'Economy', tier: 2, name: 'Conscription', effect: 'Infantry −30% manpower', needs: ['farming'] },
  { id: 'industry', branch: 'Economy', tier: 2, name: 'Industry', effect: 'Mines and oil wells +30%', needs: ['farming'] },
  { id: 'banking', branch: 'Economy', tier: 3, name: 'Banking', effect: 'Markets and city tax +25%', needs: ['industry'] },
  { id: 'totalWar', branch: 'Economy', tier: 3, name: 'Total war', effect: 'Manpower +25%', needs: ['conscription'] },
  { id: 'massProduction', branch: 'Economy', tier: 4, name: 'Mass production', effect: 'Units are made 25% faster', needs: ['banking'] },
  { id: 'exchange', branch: 'Economy', tier: 4, name: 'Stock exchange', effect: 'Money +15%', needs: ['banking'] },
  { id: 'assemblyLines', branch: 'Economy', tier: 5, name: 'Assembly lines', effect: 'Units cost 15% less money', needs: ['massProduction'] },
  { id: 'warehouses', branch: 'Logistics', tier: 1, name: 'Warehouses', effect: 'Storage +50%', needs: [] },
  { id: 'railways', branch: 'Logistics', tier: 2, name: 'Railways', effect: 'Supply reaches 1 region further', needs: ['warehouses'] },
  { id: 'kitchens', branch: 'Logistics', tier: 3, name: 'Field kitchens', effect: 'Regions feed +30% troops', needs: ['railways'] },
  { id: 'motorPool', branch: 'Logistics', tier: 3, name: 'Motor pool', effect: 'Roads cut crossing time by 55% (not 40%)', needs: ['railways'] },
  { id: 'radio', branch: 'Logistics', tier: 4, name: 'Radio', effect: 'Supply reaches 1 more region', needs: ['motorPool'] },
  { id: 'supplyCorps', branch: 'Logistics', tier: 4, name: 'Supply corps', effect: 'Units out of supply wither half as fast', needs: ['kitchens'] },
  { id: 'hospitals', branch: 'Logistics', tier: 5, name: 'Field hospitals', effect: 'Units refill twice as fast', needs: ['supplyCorps'] },
  { id: 'shipyards', branch: 'Naval', tier: 1, name: 'Shipyards', effect: 'Warships built 30% faster, −25% steel', needs: [] },
  { id: 'navalGuns', branch: 'Naval', tier: 2, name: 'Naval guns', effect: 'Warships +25% attack and shelling', needs: ['shipyards'] },
  { id: 'coastalDefence', branch: 'Naval', tier: 2, name: 'Coastal defence', effect: 'Coastal batteries +50% shelling; +25% more against landings', needs: ['shipyards'] },
  { id: 'fleetTrain', branch: 'Naval', tier: 3, name: 'Fleet train', effect: 'Ships supplied 2 more sea regions out, and mend at sea', needs: ['navalGuns'] },
  { id: 'amphibious', branch: 'Naval', tier: 3, name: 'Amphibious assault', effect: 'Landings hit at 80% (not 50%); boarding takes half as long', needs: ['coastalDefence'] },
  { id: 'dreadnoughts', branch: 'Naval', tier: 4, name: 'Dreadnoughts', effect: 'Warships +30% defence, +15% speed', needs: ['fleetTrain'] },
  { id: 'navalAviation', branch: 'Naval', tier: 5, name: 'Naval aviation', effect: 'Warships shell 2 regions out', needs: ['dreadnoughts'] },
];
/** What every country starts with: the root of the tree. */
export const TECH_ROOT = { name: 'Modern State', effect: 'Where every country starts' };

/** Research points a tech of a tier takes. They're paid in as research goes: from the stock
 * first, then as labs and cities make them, so more labs mean faster research. */
export function techCost(tier: number): number {
  return [0, 60, 150, 300, 480, 700][Math.min(5, Math.max(1, tier))];
}

/** Why a tech can't be researched (given what's done), or null. */
export function whyNotResearch(id: TechId, techs: Techs): string | null {
  const t = TECHS.find((x) => x.id === id);
  if (!t) return 'no such tech';
  if (techs.includes(id)) return 'already researched';
  const missing = t.needs.filter((n) => !techs.includes(n)).map((n) => TECHS.find((x) => x.id === n)?.name ?? n);
  if (missing.length) return `needs ${missing.join(' and ')} first`;
  return null;
}

/** Units that need a tech before anyone can build them. */
export const UNIT_TECH: Partial<Record<UnitType, TechId>> = { tank: 'tanks' };

/** A unit type's stats for a country, its techs counted. */
export function unitStats(type: UnitType, techs: Techs = []): UnitStats {
  const base = UNITS[type];
  if (!techs.length) return base;
  const s = { ...base, cost: { ...base.cost }, refillCost: { ...base.refillCost }, terrainAttack: { ...base.terrainAttack } };
  const has = (t: TechId) => techs.includes(t);
  // Every unit: cheaper and quicker to make with the economy line, harder hitting troops.
  if (has('massProduction')) s.buildTime *= 0.75;
  if (has('assemblyLines')) s.cost.money = Math.round(s.cost.money * 0.85);
  if (has('generalStaff') && !base.naval) s.attack *= 1.1;
  if (type === 'infantry') {
    if (has('stormtroops')) s.attack *= 1.15;
    if (has('combinedArms')) s.attack *= 1.15;
    if (has('mechanized')) s.speed *= 1.25;
    if (has('mountaineers')) for (const t of ['forest', 'hills', 'mountains'] as const) s.terrainAttack[t] *= 1.3;
  }
  if (type === 'infantry') {
    if (techs.includes('rifles')) s.attack *= 1.2;
    if (techs.includes('conscription')) {
      s.cost.manpower = Math.round(s.cost.manpower * 0.7);
      s.refillCost.manpower *= 0.7;
    }
  }
  if (type === 'tank') {
    if (techs.includes('engines')) s.speed *= 1.2;
    if (techs.includes('armour')) s.defense *= 1.3;
    if (techs.includes('fuel')) {
      s.cost.oil = Math.round(s.cost.oil * 0.5);
      s.refillCost.oil *= 0.5;
    }
    if (has('blitz')) s.attack *= 1.2;
    if (has('combinedArms')) s.attack *= 1.15;
    if (has('heavyTanks')) {
      s.defense *= 1.3;
      for (const t of TERRAINS) if (s.terrainAttack[t] < 1) s.terrainAttack[t] = 1 - (1 - s.terrainAttack[t]) / 2;
    }
  }
  if (type === 'artillery') {
    if (techs.includes('shells') && s.bombard) s.bombard *= 1.3;
    if (techs.includes('longGuns') && s.range) s.range += 1;
    if (has('barrage') && s.bombard) s.bombard *= 1.25;
  }
  if (type === 'warship') {
    if (has('shipyards')) {
      s.buildTime *= 0.7;
      s.cost.steel = Math.round(s.cost.steel * 0.75);
    }
    if (has('navalGuns')) {
      s.attack *= 1.25;
      if (s.bombard) s.bombard *= 1.25;
    }
    if (has('dreadnoughts')) {
      s.defense *= 1.3;
      s.speed *= 1.15;
    }
    if (has('navalAviation') && s.range) s.range += 1;
  }
  return s;
}

/** How long digging in fully takes, and what being fully dug in is worth. */
export function entrenchSeconds(techs: Techs = []): number {
  return techs.includes('trenches') ? ENTRENCH_SECONDS / 2 : ENTRENCH_SECONDS;
}
export function entrenchBonus(techs: Techs = []): number {
  return techs.includes('trenches') ? ENTRENCH_BONUS * 1.5 : ENTRENCH_BONUS;
}
/** The share of a fort's bonus that counts against a country's shells. */
/** Crossing a border with a road takes this share of the time. */
export function roadSpeed(techs: Techs = []): number {
  return techs.includes('motorPool') ? 0.45 : ROAD_SPEED;
}

/** Highest training drilling reaches (combat goes higher). */
export function drillCap(techs: Techs = []): number {
  return techs.includes('generalStaff') ? 75 : DRILL_CAP;
}

export function bombardFortShare(techs: Techs = []): number {
  return techs.includes('rangefinders') ? 0 : BOMBARD_FORT_SHARE;
}

/** Seconds to capture a region with blobs of the given (best) training. */
export function captureSeconds(region: Region, fort: number, training: number, neutral = false, city = 0, capital = false): number {
  const base =
    CAPTURE_SECONDS *
    CAPTURE_SIZE[region.size] *
    CAPTURE_TERRAIN[region.terrain] *
    (1 + CAPTURE_FORT * fort + CAPTURE_CITY * city) *
    (neutral ? CAPTURE_NEUTRAL : 1) *
    (capital ? CAPTURE_CAPITAL : 1);
  return base / (1 + (CAPTURE_TRAINING * training) / MAX_TRAINING);
}
