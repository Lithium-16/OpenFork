// Saving a game to a file and loading it back (one-person games). The file is JSON: the
// match's settings, who played what, and the simulation's whole state. A loaded file is
// untrusted (it's been on someone's disk): every field is checked and clamped, and anything
// that doesn't fit the map is refused, so a damaged or edited save can't break the server.
import type { GamePlayer } from '../../shared/protocol.ts';
import {
  BUILDING_KINDS,
  type BotDifficulty,
  type BotSetting,
  BOT_SETTINGS,
  type BuildingKind,
  ECON_KINDS,
  MAX_CITY,
  MAX_ECON_LEVEL,
  MAX_FORT,
  MAX_PLAYERS,
  maxLevel,
  RESOURCES,
  type Resources,
  type StartingResources,
  TECHS,
  type TechId,
  UNIT_TYPES,
  type UnitType,
} from '../../shared/rules.ts';
import { type Blob, type Construction, emptyLine, emptyRegion, type Player, type ProductionLine, type RegionState, type SimState } from './state.ts';
import type { World } from './world.ts';

export const SAVE_VERSION = 1;
/** Biggest save file accepted, in characters. */
export const MAX_SAVE_CHARS = 2_000_000;

export interface SaveFile {
  v: number;
  map: string;
  starting: StartingResources;
  bots: BotSetting;
  seed: number;
  players: GamePlayer[];
  /** The player index of the one person in the game. */
  human: number;
  sim: unknown;
}

/** The simulation's state as plain JSON (Maps and Sets as arrays). */
export function dumpState(st: SimState): unknown {
  return {
    time: st.time,
    players: st.players,
    regions: st.regions,
    blobs: [...st.blobs.values()],
    nextBlobId: st.nextBlobId,
    winner: st.winner,
    wars: [...st.wars],
    warActivity: [...st.warActivity],
    truces: [...st.truces],
    peaceOffers: [...st.peaceOffers],
    roads: [...st.roads],
  };
}

// -- checking --------------------------------------------------------------------------------

class Bad extends Error {}
const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Bad('not an object');
  return v as Record<string, unknown>;
};
const arr = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new Bad('bad list');
  return v;
};
const num = (v: unknown, min = -Infinity, max = Infinity): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Bad('not a number');
  return Math.min(max, Math.max(min, v));
};
const int = (v: unknown, min: number, max: number): number => {
  const n = num(v, min, max);
  if (!Number.isInteger(n)) throw new Bad('not a whole number');
  return n;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new Bad('not true/false');
  return v;
};
const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new Bad('bad text');
  return v;
};
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T => {
  if (!all.includes(v as T)) throw new Bad(`unknown ${String(v)}`);
  return v as T;
};
const resources = (v: unknown): Resources => {
  const o = obj(v);
  const out = { money: 0, manpower: 0, steel: 0, oil: 0, research: 0 };
  for (const k of RESOURCES) out[k] = num(o[k] ?? 0, -1e9, 1e9);
  return out;
};
const TECH_IDS = TECHS.map((t) => t.id);

/** Reads a save file; returns why it's refused, or the save. */
export function readSave(text: string, world: (id: string) => World | undefined): { save: SaveFile; state: SimState } | string {
  if (text.length > MAX_SAVE_CHARS) return 'that save file is too big';
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'that isn\'t an OpenFork save file';
  }
  try {
    const f = obj(raw);
    if (f.v !== SAVE_VERSION) return 'that save is from another version of the game';
    const w = world(str(f.map, 32));
    if (!w) return 'that save is for a map this server doesn\'t have';
    const nRegions = w.regions.length;
    const region = (v: unknown) => int(v, 0, nRegions - 1);
    const players = arr(f.players, MAX_PLAYERS).map((p, i) => {
      const o = obj(p);
      return { id: i, name: str(o.name, 40), country: str(o.country, 8), color: str(o.color, 16), human: bool(o.human) } as GamePlayer;
    });
    if (players.length < 1) throw new Bad('no players');
    const n = players.length;
    const player = (v: unknown) => int(v, 0, n - 1);
    const owner = (v: unknown) => int(v, -1, n - 1);
    const human = player(f.human);
    const s = obj(f.sim);

    const simPlayers: Player[] = arr(s.players, n).map((p, i) => {
      const o = obj(p);
      const research = o.research === null ? null : obj(o.research);
      return {
        id: i,
        name: players[i].name,
        country: players[i].country,
        color: players[i].color,
        control: i === human ? 'human' : 'bot',
        difficulty: oneOf(o.difficulty, ['defensive', 'easy', 'normal', 'hard'] as BotDifficulty[]),
        alive: bool(o.alive),
        capital: region(o.capital),
        resources: resources(o.resources),
        broke: bool(o.broke),
        income: resources(o.income),
        cap: resources(o.cap),
        techs: [...new Set(arr(o.techs, TECH_IDS.length).map((t) => oneOf(t, TECH_IDS)))],
        research: research
          ? { tech: oneOf(research.tech, TECH_IDS) as TechId, paid: num(research.paid, 0, 1e6), cost: num(research.cost, 1, 1e6) }
          : null,
        upkeep: num(o.upkeep ?? 0, 0, 1e6),
      };
    });
    if (simPlayers.length !== n) throw new Bad('players don\'t match');

    const construction = (v: unknown): Construction => {
      const o = obj(v);
      return {
        kind: oneOf(o.kind, BUILDING_KINDS) as BuildingKind,
        level: int(o.level, 1, Math.max(MAX_CITY, MAX_FORT, MAX_ECON_LEVEL)),
        progress: num(o.progress, 0, 1e5),
        seconds: num(o.seconds, 1, 1e5),
        cost: resources(o.cost),
        target: int(o.target, -1, nRegions - 1),
      };
    };
    const line = (v: unknown): ProductionLine => {
      if (v === undefined) return emptyLine();
      const o = obj(v);
      return {
        queue: arr(o.queue, 20).map((u) => oneOf(u, UNIT_TYPES) as UnitType),
        progress: num(o.progress, -1, 1e5),
        repeat: bool(o.repeat),
        ...(o.paid ? { paid: resources(o.paid) } : {}),
      };
    };
    const rawRegions = arr(s.regions, nRegions);
    if (rawRegions.length !== nRegions) throw new Bad('regions don\'t match the map');
    const regions: RegionState[] = rawRegions.map((r) => {
      const o = obj(r);
      const e = obj(o.econ);
      const base = emptyRegion();
      const prod = obj(o.production);
      const capture = o.capture === null ? null : obj(o.capture);
      return {
        ...base,
        owner: owner(o.owner),
        fort: int(o.fort, 0, MAX_FORT),
        city: int(o.city, 0, MAX_CITY),
        // Mines and markets have levels now (older saves could have several of one).
        econ: Object.fromEntries(ECON_KINDS.map((k) => [k, Math.min(maxLevel(k) > 1 ? maxLevel(k) : 50, int(e[k] ?? 0, 0, 50))])) as RegionState['econ'],
        barracks: bool(o.barracks),
        factory: bool(o.factory),
        port: bool(o.port),
        battery: bool(o.battery ?? false),
        depots: int(o.depots, 0, 50),
        production: { barracks: line(prod.barracks), factory: line(prod.factory), port: line(prod.port) },
        construction: o.construction === null ? null : construction(o.construction),
        buildQueue: arr(o.buildQueue, 10).map(construction),
        capture: capture ? { by: player(capture.by), progress: num(capture.progress, 0, 1) } : null,
        supplied: bool(o.supplied),
        cutOff: num(o.cutOff, 0, 1e6),
        siege: num(o.siege ?? 0, 0, 1),
      };
    });

    const blobs = new Map<number, Blob>();
    let maxId = 0;
    for (const b of arr(s.blobs, 5000)) {
      const o = obj(b);
      const id = int(o.id, 1, 1e9);
      if (blobs.has(id)) throw new Bad('two units with one id');
      const size = num(o.size, 0.05, 1000);
      const blob: Blob = {
        id,
        owner: player(o.owner),
        type: oneOf(o.type, UNIT_TYPES) as UnitType,
        strength: num(o.strength, 0, size),
        size,
        training: num(o.training, 0, 100),
        region: region(o.region),
        path: arr(o.path, 400).map(region),
        progress: num(o.progress, 0, 1),
        entrench: num(o.entrench, 0, 1),
        waiting: bool(o.waiting ?? false),
        through: owner(o.through ?? -1),
        crossedRiver: bool(o.crossedRiver),
        from: int(o.from, -1, nRegions - 1),
        supply: num(o.supply, 0, 1),
        attacking: -1,
        bombarding: -1,
      };
      if (!blob.path.length) blob.progress = 0;
      blobs.set(id, blob);
      maxId = Math.max(maxId, id);
    }

    const pairs = (v: unknown, sep: string, max: number) =>
      arr(v, max).map((k) => {
        const parts = str(k, 16).split(sep).map(Number);
        if (parts.length !== 2 || parts.some((x) => !Number.isInteger(x) || x < 0)) throw new Bad('bad pair');
        return parts as [number, number];
      });
    const timed = (v: unknown, sep: string) =>
      arr(v, n * n).map((e) => {
        const [k, t] = arr(e, 2);
        pairs([k], sep, 1);
        return [str(k, 16), num(t, 0, 1e9)] as [string, number];
      });
    const wars = pairs(s.wars, ':', n * n);
    for (const [a, b] of wars) if (a >= n || b >= n) throw new Bad('war with nobody');
    const roads = pairs(s.roads, ':', nRegions * 8);
    for (const [a, b] of roads) if (a >= nRegions || b >= nRegions) throw new Bad('road off the map');

    const state: SimState = {
      time: num(s.time, 0, 1e8),
      players: simPlayers,
      regions,
      blobs,
      nextBlobId: Math.max(maxId + 1, int(s.nextBlobId, 1, 1e9)),
      winner: s.winner === null ? null : player(s.winner),
      wars: new Set(arr(s.wars, n * n).map((k) => str(k, 16))),
      warActivity: new Map(timed(s.warActivity, ':')),
      truces: new Map(timed(s.truces, ':')),
      peaceOffers: new Map(timed(s.peaceOffers, '>')),
      roads: new Set(arr(s.roads, nRegions * 8).map((k) => str(k, 16))),
    };
    if (!simPlayers[human].alive || state.winner !== null) return 'that game is already over';
    const save: SaveFile = {
      v: SAVE_VERSION,
      map: w.map.id,
      starting: oneOf(f.starting, ['low', 'normal', 'high'] as StartingResources[]),
      bots: oneOf(f.bots, BOT_SETTINGS),
      seed: int(f.seed, 0, 2 ** 31),
      players,
      human,
      sim: null,
    };
    return { save, state };
  } catch (e) {
    if (e instanceof Bad) return `that save file is damaged (${e.message})`;
    throw e;
  }
}
