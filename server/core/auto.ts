// Auto: land units set to take land on their own. An idle auto unit goes for the nearest
// region it can take: neutral or at-war enemy land with nobody in it, or an enemy region it
// can win at a battle plan's odds. Only land next to its country's supplied land, so it
// doesn't run off and starve; and never where another auto unit of ours is already going.
// It moves with ordinary orders (sim.move), so capturing from inside, border attacks and
// stack caps work as for anyone. Any order given by hand turns it off (see Game.order).
import { UNITS } from '../../shared/rules.ts';
import { defence, PLAN_ODDS } from './fronts.ts';
import type { Sim } from './sim.ts';
import { type Blob, NEUTRAL } from './state.ts';

/** Seconds between decisions. */
const THINK_SECONDS = 1;

export class AutoCommand {
  private next = 0;

  act(sim: Sim): void {
    if (sim.state.time < this.next) return;
    this.next = sim.state.time + THINK_SECONDS;
    const autos = [...sim.state.blobs.values()].filter((b) => b.auto && !UNITS[b.type].naval && sim.state.players[b.owner]?.alive);
    if (!autos.length) return;
    // Where our auto units already are going, or taking land: nobody else goes there.
    const claimed = new Map<number, Set<number>>();
    const claim = (owner: number, r: number) => {
      const set = claimed.get(owner) ?? new Set<number>();
      set.add(r);
      claimed.set(owner, set);
    };
    for (const b of autos) {
      if (b.path.length) claim(b.owner, b.path[b.path.length - 1]);
      else if (sim.taking(b)) claim(b.owner, b.region);
    }
    for (const b of autos) {
      if (b.path.length || b.progress > 0 || sim.taking(b) || sim.inFight(b) || sim.besieged(b.region, b.owner)) continue;
      const target = pick(sim, b, claimed.get(b.owner) ?? new Set());
      if (target < 0 || sim.move(b.owner, [b.id], target) !== null) continue;
      claim(b.owner, target);
    }
  }
}

/** The nearest region `b` should take, or -1. */
export function pick(sim: Sim, b: Blob, claimed: Set<number>): number {
  const regions = sim.state.regions;
  const me = b.owner;
  const takeable = (r: number) => regions[r].owner !== me && (regions[r].owner === NEUTRAL || sim.atWar(me, regions[r].owner));
  // Next to our own supplied land: it stays in supply once it's taken.
  const nearSupply = (r: number) => sim.world.neighbors(r).some((e) => regions[e.id].owner === me && regions[e.id].supplied);
  const odds = (r: number) => {
    const attack = b.strength * sim.statsOf(b.type, me).attack * UNITS[b.type].terrainAttack[sim.world.regions[r].terrain];
    return attack / defence(sim, r, me);
  };
  // Over land, nearest first, through our own land and land we may take (not through enemy
  // units: they'd be a fight on the way).
  const seen = new Set([b.region]);
  const queue = [b.region];
  for (let q = 0; q < queue.length; q++) {
    for (const e of sim.world.neighbors(queue[q])) {
      const r = e.id;
      if (seen.has(r) || sim.world.isSea(r)) continue;
      seen.add(r);
      if (regions[r].owner !== me && !takeable(r)) continue;
      const hostile = sim.hostileIn(r, me);
      if (takeable(r) && !claimed.has(r) && nearSupply(r) && (!hostile || odds(r) >= PLAN_ODDS)) return r;
      if (!hostile) queue.push(r);
    }
  }
  return -1;
}
