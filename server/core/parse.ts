// Checks untrusted client messages. Anything malformed comes back as null.
import type { ClientMessage, LobbySettings, Order } from '../../shared/protocol.ts';
import { MAX_SAVE_CHARS } from './save.ts';
import { BOT_SETTINGS, type BotSetting, BUILDING_KINDS, type BuildingKind, MAX_PLAYERS, MIN_PLAYERS, type TechId, TECHS, UNIT_TYPES, type UnitType } from '../../shared/rules.ts';

const MAX_IDS = 64;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e9;
const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_IDS && v.every(isInt);
const isProd = (v: unknown): v is 'barracks' | 'factory' | 'port' => v === 'barracks' || v === 'factory' || v === 'port';

export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return name || null;
}

function order(v: unknown): Order | null {
  if (!isObj(v)) return null;
  switch (v.o) {
    case 'move':
      if (!isIds(v.blobs) || !isInt(v.to) || (v.then !== undefined && typeof v.then !== 'boolean')) return null;
      return { o: 'move', blobs: v.blobs, to: v.to, ...(v.then ? { then: true } : {}) };
    case 'stop':
      return isIds(v.blobs) ? { o: 'stop', blobs: v.blobs } : null;
    case 'aim':
      return isIds(v.blobs) && typeof v.buildings === 'boolean' ? { o: 'aim', blobs: v.blobs, buildings: v.buildings } : null;
    case 'split':
      if (!isInt(v.blob) || (v.amount !== undefined && (!isInt(v.amount) || (v.amount as number) < 1))) return null;
      return { o: 'split', blob: v.blob, ...(v.amount !== undefined ? { amount: v.amount as number } : {}) };
    case 'merge':
      return isIds(v.blobs) ? { o: 'merge', blobs: v.blobs } : null;
    case 'disband':
      return isIds(v.blobs) ? { o: 'disband', blobs: v.blobs } : null;
    case 'build':
      if (!isInt(v.region) || !BUILDING_KINDS.includes(v.kind as BuildingKind)) return null;
      if (v.target !== undefined && !isInt(v.target)) return null;
      return { o: 'build', region: v.region, kind: v.kind as BuildingKind, ...(v.target !== undefined ? { target: v.target as number } : {}) };
    case 'demolish':
      return isInt(v.region) && BUILDING_KINDS.includes(v.kind as BuildingKind)
        ? { o: 'demolish', region: v.region, kind: v.kind as BuildingKind }
        : null;
    case 'produce':
      if (!isInt(v.region) || !isProd(v.building)) return null;
      if (v.unit !== undefined && !UNIT_TYPES.includes(v.unit as UnitType)) return null;
      return { o: 'produce', region: v.region, building: v.building, ...(v.unit !== undefined ? { unit: v.unit as UnitType } : {}) };
    case 'repeat':
      return isInt(v.region) && isProd(v.building) && typeof v.on === 'boolean'
        ? { o: 'repeat', region: v.region, building: v.building, on: v.on }
        : null;
    case 'war':
    case 'peace':
    case 'refuse':
      return isInt(v.player) ? { o: v.o, player: v.player } : null;
    case 'surrender':
      return { o: 'surrender' };
    case 'research':
      return TECHS.some((t) => t.id === v.tech) ? { o: 'research', tech: v.tech as TechId } : null;
    case 'unresearch':
      return { o: 'unresearch' };
    case 'pause':
      return typeof v.on === 'boolean' ? { o: 'pause', on: v.on } : null;
    case 'cancel':
      return isInt(v.region) && isProd(v.building) ? { o: 'cancel', region: v.region, building: v.building } : null;
    case 'front':
      if (!isIds(v.blobs) || !isInt(v.enemy)) return null;
      if ((v.attack !== undefined && typeof v.attack !== 'boolean') || (v.target !== undefined && v.target !== -1 && !isInt(v.target))) return null;
      return {
        o: 'front',
        blobs: v.blobs,
        enemy: v.enemy,
        ...(v.attack !== undefined ? { attack: v.attack as boolean } : {}),
        ...(v.target !== undefined ? { target: v.target as number } : {}),
      };
    case 'plan':
      if (!isInt(v.enemy) || typeof v.attack !== 'boolean' || (v.target !== undefined && v.target !== -1 && !isInt(v.target))) return null;
      return { o: 'plan', enemy: v.enemy, attack: v.attack, ...(v.target !== undefined ? { target: v.target as number } : {}) };
    case 'unfront':
      return isInt(v.enemy) ? { o: 'unfront', enemy: v.enemy } : null;
    case 'unbuild':
      return isInt(v.region) && isInt(v.index) && v.index >= 0 ? { o: 'unbuild', region: v.region, index: v.index } : null;
    default:
      return null;
  }
}

function settings(v: unknown): Partial<LobbySettings> | null {
  if (!isObj(v)) return null;
  const out: Partial<LobbySettings> = {};
  if (v.map !== undefined) {
    if (typeof v.map !== 'string' || !/^[a-z0-9-]{1,32}$/.test(v.map)) return null;
    out.map = v.map;
  }
  if (v.size !== undefined) {
    if (!Number.isInteger(v.size) || (v.size as number) < MIN_PLAYERS || (v.size as number) > MAX_PLAYERS) return null;
    out.size = v.size as number;
  }
  if (v.starting !== undefined) {
    if (v.starting !== 'low' && v.starting !== 'normal' && v.starting !== 'high') return null;
    out.starting = v.starting;
  }
  if (v.pick !== undefined) {
    if (v.pick !== 'free' && v.pick !== 'random') return null;
    out.pick = v.pick;
  }
  if (v.difficulty !== undefined) {
    if (!BOT_SETTINGS.includes(v.difficulty as BotSetting)) return null;
    out.difficulty = v.difficulty as BotSetting;
  }
  return out;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'hello': {
      const name = cleanName(raw.name);
      if (!name) return null;
      const token = typeof raw.token === 'string' && raw.token.length <= 64 ? raw.token : undefined;
      return { t: 'hello', name, token };
    }
    case 'lobby.create':
    case 'lobby.leave':
    case 'lobby.start':
    case 'game.save':
      return { t: raw.t };
    case 'lobby.load':
      return typeof raw.data === 'string' && raw.data.length <= MAX_SAVE_CHARS ? { t: 'lobby.load', data: raw.data } : null;
    case 'lobby.join':
      return typeof raw.code === 'string' && /^[A-Z0-9]{4,8}$/i.test(raw.code)
        ? { t: 'lobby.join', code: raw.code.toUpperCase() }
        : null;
    case 'lobby.settings': {
      const s = settings(raw.settings);
      return s ? { t: 'lobby.settings', settings: s } : null;
    }
    case 'lobby.pick':
      return raw.country === null || (typeof raw.country === 'string' && /^[A-Z]{2}$/.test(raw.country))
        ? { t: 'lobby.pick', country: raw.country as string | null }
        : null;
    case 'order': {
      const o = order(raw.order);
      return o ? { t: 'order', order: o } : null;
    }
    default:
      return null;
  }
}
