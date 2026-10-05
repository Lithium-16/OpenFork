// Every gameplay number lives here (DESIGN.md has the rules in words). Rates are per second
// unless they say otherwise; the server multiplies by the tick length.
import type { Region, RegionSize, Terrain } from './map.ts';

export const TICK_MS = 100;
/** How often clients get a full state snapshot. */
export const SNAPSHOT_EVERY_TICKS = 2;

// -- units ------------------------------------------------------------------------------------

export type UnitType = 'infantry' | 'tank' | 'artillery';
export const UNIT_TYPES: readonly UnitType[] = ['infantry', 'tank', 'artillery'];

export interface Resources {
  money: number;
  manpower: number;
  steel: number;
  oil: number;
}
export const RESOURCES: readonly (keyof Resources)[] = ['money', 'manpower', 'steel', 'oil'];

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
}

export const UNITS: Record<UnitType, UnitStats> = {
  infantry: {
    maxSize: 100,
    batch: 10,
    speed: 1,
    attack: 1,
    defense: 1.2,
    terrainAttack: { plains: 1, forest: 1, hills: 1, mountains: 1 },
    cost: { money: 50, manpower: 100, steel: 0, oil: 0 },
    buildTime: 20,
    upkeep: 0.02,
    refillCost: { money: 1, manpower: 5, steel: 0, oil: 0 },
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
    cost: { money: 90, manpower: 30, steel: 38, oil: 18 },
    buildTime: 30,
    upkeep: 0.06,
    refillCost: { money: 3, manpower: 1, steel: 3, oil: 1 },
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
    cost: { money: 80, manpower: 30, steel: 30, oil: 0 },
    buildTime: 30,
    upkeep: 0.04,
    refillCost: { money: 2, manpower: 3, steel: 2, oil: 0 },
    supplyNeed: 1.5,
    producedAt: 'factory',
    range: 2,
    bombard: 2,
  },
};

/** Shells hit dug-in units as hard as any (no digging-in bonus), and forts count this share. */
export const BOMBARD_FORT_SHARE = 0.5;

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
export const CAPTURE_SECONDS = 6.5;
export const CAPTURE_SIZE: Record<RegionSize, number> = { small: 0.7, medium: 1, large: 1.4 };
export const CAPTURE_TERRAIN: Record<Terrain, number> = { plains: 1, forest: 1.2, hills: 1.3, mountains: 1.6 };
/** Each fort level adds this share to capture time. */
export const CAPTURE_FORT = 0.5;
/** At 100 training, capture runs this much faster (1.5 = 50% faster). */
export const CAPTURE_TRAINING = 0.5;
/** Capture progress lost per second while nobody is capturing. */
export const CAPTURE_DECAY = 0.2;

// -- battles ----------------------------------------------------------------------------------

/** Strength removed per second per point of attack power. */
export const DAMAGE_RATE = 0.05;
export const FORT_BONUS = 0.5; // per fort level
export const ENTRENCH_BONUS = 0.5; // when fully dug in
export const ENTRENCH_SECONDS = 60;
export const RIVER_BONUS = 0.25;
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
/** Strength refilled per second while in supply (paid with UnitStats.refillCost). */
export const REFILL_RATE = 0.15;
/** A cut-off region with none of your blobs turns neutral after this many seconds. */
export const CUT_OFF_SECONDS = 5;
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
export const STARTING: Resources = { money: 150, manpower: 250, steel: 40, oil: 20 };
export const STARTING_MULTIPLIER: Record<StartingResources, number> = { low: 0.5, normal: 1, high: 2 };

// -- buildings --------------------------------------------------------------------------------

export type ProductionBuilding = 'barracks' | 'factory';
/** Economic buildings: each takes a slot and raises one resource. */
export type EconKind = 'farm' | 'mine' | 'well' | 'market';
export const ECON_KINDS: readonly EconKind[] = ['farm', 'mine', 'well', 'market'];
/** 'city' founds a city, or expands one that's there; 'road' is built across a border. */
export type BuildingKind = EconKind | 'city' | 'fort' | ProductionBuilding | 'road' | 'depot';
export const BUILDING_KINDS: readonly BuildingKind[] = ['farm', 'mine', 'well', 'market', 'city', 'fort', 'barracks', 'factory', 'road', 'depot'];
export const MAX_FORT = 3;
export const MAX_CITY = 5;
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
export const CITY_YIELD: Resources = { money: 0.8, manpower: 0.25, steel: 0, oil: 0 };
/** Your capital starts at least this big; cities of countries nobody plays start at 1. */
export const START_CAPITAL_LEVEL = 3;
export const NEUTRAL_CITY_LEVEL = 1;

// -- storage ----------------------------------------------------------------------------------

/** What a country can stockpile: each city level stores this much, each depot this much more.
 * Income beyond it is lost. Taking a city or depot takes its share of the owner's stock. */
export const STORE_PER_CITY_LEVEL: Resources = { money: 250, manpower: 250, steel: 120, oil: 120 };
export const STORE_PER_DEPOT: Resources = { money: 1000, manpower: 1000, steel: 500, oil: 500 };

/** What one region stores. */
export function storeOf(city: number, depots: number, techs: Techs = []): Resources {
  const out = { money: 0, manpower: 0, steel: 0, oil: 0 };
  const more = techs.includes('warehouses') ? 1.5 : 1;
  for (const k of RESOURCES) out[k] = (STORE_PER_CITY_LEVEL[k] * city + STORE_PER_DEPOT[k] * depots) * more;
  return out;
}

export function usesSlot(kind: BuildingKind): boolean {
  return kind !== 'city' && kind !== 'road';
}

export function slotsOf(region: Region, city: number): number {
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
  }
}

/** Everything a region yields per second while it's supplied and not fought over: its city's
 * tax plus its economic buildings. */
export function regionYield(region: Region, city: number, econ: Record<EconKind, number>, techs: Techs = []): Resources {
  const out: Resources = { money: 0, manpower: 0, steel: 0, oil: 0 };
  const bank = techs.includes('banking') ? 1.25 : 1;
  out.money += CITY_YIELD.money * city * bank;
  out.manpower += CITY_YIELD.manpower * city;
  const boost: Record<EconKind, number> = {
    farm: techs.includes('farming') ? 1.3 : 1,
    mine: techs.includes('industry') ? 1.3 : 1,
    well: techs.includes('industry') ? 1.3 : 1,
    market: bank,
  };
  for (const kind of ECON_KINDS) {
    const y = econYield(kind, region, city);
    for (const k of RESOURCES) out[k] += (y[k] ?? 0) * econ[kind] * boost[kind];
  }
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
      return city > 0;
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
};

const res = (money: number, steel = 0): Resources => ({ money, manpower: 0, steel, oil: 0 });

/** Cost and build time. `level` is the level reached: fort 1-3; city 1 = found, 2-5 = expand. */
export function buildCost(kind: BuildingKind, level = 1): { cost: Resources; seconds: number } {
  switch (kind) {
    case 'farm':
      return { cost: res(60), seconds: 60 };
    case 'mine':
      return { cost: res(80), seconds: 75 };
    case 'well':
      return { cost: res(90, 10), seconds: 75 };
    case 'market':
      return { cost: res(70), seconds: 60 };
    case 'city':
      return level <= 1 ? { cost: res(1600, 240), seconds: 240 } : { cost: res(240 * level, 40 * (level - 1)), seconds: 60 * level };
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
}
export const OPPORTUNISM: Record<BotDifficulty, Opportunism | null> = {
  defensive: null,
  easy: null,
  normal: { after: 300, ratio: 2, chance: 0.15, maxWars: 1 },
  hard: { after: 180, ratio: 1.6, chance: 0.35, maxWars: 2 },
};
export const BOT_DIPLOMACY_SECONDS = 45;
/** Bots offer peace when they're this much weaker than the enemy, or after a long stalemate. */
export const BOT_PEACE_WHEN_WEAKER = 0.7;
export const BOT_PEACE_STALEMATE_SECONDS = 240;
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
  return Math.max(STACK_MIN, STACK_SIZE[region.size] + STACK_TERRAIN[region.terrain]) + city + fort;
}

export function supplyCapacity(region: Region, city: number, techs: Techs = []): number {
  return SUPPLY_BASE * SUPPLY_TERRAIN[region.terrain] * (1 + SUPPLY_PER_CITY_LEVEL * city) * (techs.includes('kitchens') ? 1.3 : 1);
}

/** How many hops a city of this level supplies. */
export function supplyReach(city: number, techs: Techs = []): number {
  return SUPPLY_REACH_BASE + city + (techs.includes('railways') ? 1 : 0);
}

// -- research -------------------------------------------------------------------------------

export type TechId =
  | 'rifles' | 'trenches' | 'conscription'
  | 'engines' | 'armour' | 'fuel'
  | 'shells' | 'rangefinders' | 'longGuns'
  | 'farming' | 'industry' | 'banking'
  | 'warehouses' | 'railways' | 'kitchens';
/** A country's researched techs. */
export type Techs = readonly TechId[];

export interface Tech {
  id: TechId;
  branch: string;
  /** 1-3: its row in the tree. */
  tier: number;
  name: string;
  effect: string;
  /** Techs it needs first (its own branch's tier before, and sometimes another branch's). */
  needs: TechId[];
}

/** The tech tree: five branches of three, researched one at a time. Most top-tier techs
 * also need a middle-tier tech from another branch, so the branches join up. */
export const TECHS: readonly Tech[] = [
  { id: 'rifles', branch: 'Infantry', tier: 1, name: 'Rifles', effect: 'Infantry +20% attack', needs: [] },
  { id: 'trenches', branch: 'Infantry', tier: 2, name: 'Trenches', effect: 'Dig in twice as fast; dug in +50% stronger', needs: ['rifles'] },
  { id: 'conscription', branch: 'Infantry', tier: 3, name: 'Conscription', effect: 'Infantry −30% manpower', needs: ['trenches', 'industry'] },
  { id: 'engines', branch: 'Armour', tier: 1, name: 'Engines', effect: 'Tanks +20% speed', needs: [] },
  { id: 'armour', branch: 'Armour', tier: 2, name: 'Armour plate', effect: 'Tanks +30% defence', needs: ['engines'] },
  { id: 'fuel', branch: 'Armour', tier: 3, name: 'Synthetic fuel', effect: 'Tanks −50% oil', needs: ['armour', 'industry'] },
  { id: 'shells', branch: 'Artillery', tier: 1, name: 'Heavy shells', effect: 'Artillery +30% shelling', needs: [] },
  { id: 'rangefinders', branch: 'Artillery', tier: 2, name: 'Rangefinders', effect: 'Forts no help against shells', needs: ['shells'] },
  { id: 'longGuns', branch: 'Artillery', tier: 3, name: 'Long guns', effect: 'Artillery range 3', needs: ['rangefinders', 'railways'] },
  { id: 'farming', branch: 'Economy', tier: 1, name: 'Farming', effect: 'Farms +30%', needs: [] },
  { id: 'industry', branch: 'Economy', tier: 2, name: 'Industry', effect: 'Mines and oil wells +30%', needs: ['farming'] },
  { id: 'banking', branch: 'Economy', tier: 3, name: 'Banking', effect: 'Markets and city tax +25%', needs: ['industry', 'railways'] },
  { id: 'warehouses', branch: 'Logistics', tier: 1, name: 'Warehouses', effect: 'Storage +50%', needs: [] },
  { id: 'railways', branch: 'Logistics', tier: 2, name: 'Railways', effect: 'Supply reaches 1 region further', needs: ['warehouses'] },
  { id: 'kitchens', branch: 'Logistics', tier: 3, name: 'Field kitchens', effect: 'Regions feed +30% troops', needs: ['railways'] },
];
export const TECH_BRANCHES = ['Infantry', 'Armour', 'Artillery', 'Economy', 'Logistics'];

/** What researching a tier costs, paid when it starts (refunded if cancelled). */
export function techCost(tier: number): { cost: Resources; seconds: number } {
  if (tier <= 1) return { cost: res(250, 30), seconds: 60 };
  if (tier === 2) return { cost: res(500, 80), seconds: 90 };
  return { cost: res(900, 150), seconds: 120 };
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

/** A unit type's stats for a country, its techs counted. */
export function unitStats(type: UnitType, techs: Techs = []): UnitStats {
  const base = UNITS[type];
  if (!techs.length) return base;
  const s = { ...base, cost: { ...base.cost } };
  if (type === 'infantry') {
    if (techs.includes('rifles')) s.attack *= 1.2;
    if (techs.includes('conscription')) s.cost.manpower = Math.round(s.cost.manpower * 0.7);
  }
  if (type === 'tank') {
    if (techs.includes('engines')) s.speed *= 1.2;
    if (techs.includes('armour')) s.defense *= 1.3;
    if (techs.includes('fuel')) s.cost.oil = Math.round(s.cost.oil * 0.5);
  }
  if (type === 'artillery') {
    if (techs.includes('shells') && s.bombard) s.bombard *= 1.3;
    if (techs.includes('longGuns') && s.range) s.range += 1;
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
export function bombardFortShare(techs: Techs = []): number {
  return techs.includes('rangefinders') ? 0 : BOMBARD_FORT_SHARE;
}

/** Seconds to capture a region with blobs of the given (best) training. */
export function captureSeconds(region: Region, fort: number, training: number): number {
  const base = CAPTURE_SECONDS * CAPTURE_SIZE[region.size] * CAPTURE_TERRAIN[region.terrain] * (1 + CAPTURE_FORT * fort);
  return base / (1 + (CAPTURE_TRAINING * training) / MAX_TRAINING);
}
