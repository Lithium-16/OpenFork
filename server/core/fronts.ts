// Fronts and battle plans, run for their owner the way a bot runs its army. Units on a front
// spread along their country's border with the enemy and dig in: more where the enemy is
// stronger, guns one region back. A battle plan, at war, also attacks across the line where
// its units have the odds, nearest its target first, and holds the new line once the target
// is taken. Any order given to a unit by hand takes it off its front (see Game.order).
import { UNITS } from '../../shared/rules.ts';
import type { Sim } from './sim.ts';
import type { Blob, Front } from './state.ts';

/** Seconds between a front's decisions. */
const THINK_SECONDS = 1;
/** A battle plan attacks a region only with at least these odds (attack against defence). */
export const PLAN_ODDS = 1.3;

export class FrontCommand {
  private next = 0;

  act(sim: Sim): void {
    if (sim.state.time < this.next || !sim.state.fronts.length) return;
    this.next = sim.state.time + THINK_SECONDS;
    for (const front of sim.state.fronts) runFront(sim, front);
    sim.state.fronts = sim.state.fronts.filter((f) => f.units.length > 0);
  }
}

/** The land regions next to a region. */
function land(sim: Sim, region: number): number[] {
  return sim.world.neighbors(region).flatMap((e) => (sim.world.isSea(e.id) ? [] : [e.id]));
}

/** Hops over land from `from` to every region (-1: no way there on foot). */
function hops(sim: Sim, from: number): Int32Array {
  const dist = new Int32Array(sim.world.regions.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    for (const n of land(sim, queue[q])) {
      if (dist[n] < 0) {
        dist[n] = dist[queue[q]] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/** What it would take to win a region: the enemy strength in it, forts and digging in counted. */
export function defence(sim: Sim, region: number, owner: number): number {
  const rs = sim.state.regions[region];
  let d = 0.5;
  for (const x of sim.blobsIn(region)) {
    if (x.owner === owner) continue;
    const home = x.owner === rs.owner ? 1 + 0.5 * rs.fort + 0.5 * x.entrench : 1;
    d += x.strength * sim.statsOf(x.type, x.owner).defense * home;
  }
  return d;
}

/** Enemy strength in and next to a region (how hard the line is pressed there). */
function pressure(sim: Sim, region: number, enemy: number): number {
  let s = 0;
  for (const r of [region, ...land(sim, region)]) for (const x of sim.blobsIn(r)) if (x.owner === enemy) s += x.strength;
  return s;
}

function runFront(sim: Sim, f: Front): void {
  const regions = sim.state.regions;
  const units = f.units.map((id) => sim.state.blobs.get(id)).filter((b): b is Blob => !!b && b.owner === f.owner);
  f.units = units.map((b) => b.id);
  if (!units.length) return;
  // The plan's target is ours: the push is done, hold the new line.
  if (f.attack && f.target >= 0 && regions[f.target].owner === f.owner) {
    f.attack = false;
    f.target = -1;
  }
  // The line: our land with the enemy's land next to it.
  const line = regions.flatMap((rs, i) => (rs.owner === f.owner && !sim.world.isSea(i) && land(sim, i).some((n) => regions[n].owner === f.enemy) ? [i] : []));
  if (!line.length) return; // no border with them (any more): wait where they are
  const onLine = new Set(line);
  const attacking = f.attack && sim.atWar(f.owner, f.enemy);
  const toTarget = f.target >= 0 ? hops(sim, f.target) : null;
  // Moving (not held up at a full region), at sea, or taking land it stands in: leave it be.
  const busy = (b: Blob) => (b.path.length > 0 && !b.waiting) || sim.world.isSea(b.region) || sim.taking(b);
  const sent = new Set<Blob>();

  if (attacking) {
    // Across the line, nearest the target first, then the weakest.
    const across = [...new Set(line.flatMap((r) => land(sim, r).filter((n) => regions[n].owner === f.enemy)))];
    const near = (c: number) => (toTarget && toTarget[c] >= 0 ? toTarget[c] : 99);
    across.sort((a, b) => near(a) - near(b) || defence(sim, a, f.owner) - defence(sim, b, f.owner));
    for (const c of across) {
      const from = land(sim, c).filter((r) => onLine.has(r));
      const group: Blob[] = [];
      for (const r of from) {
        const here = units.filter((b) => b.region === r && !busy(b) && !sent.has(b) && !UNITS[b.type].range).sort((a, b) => b.strength - a.strength);
        // A region pressed from elsewhere too keeps one back to hold it.
        const elsewhere = land(sim, r).some((n) => n !== c && sim.blobsIn(n).some((x) => x.owner === f.enemy));
        group.push(...(elsewhere ? here.slice(0, -1) : here));
      }
      if (!group.length) continue;
      const terrain = sim.world.regions[c].terrain;
      const power = group.reduce((s, b) => s + b.strength * sim.statsOf(b.type, b.owner).attack * UNITS[b.type].terrainAttack[terrain], 0);
      if (power / defence(sim, c, f.owner) < PLAN_ODDS) continue;
      if (sim.move(f.owner, group.map((b) => b.id), c) !== null) continue;
      for (const b of group) sent.add(b);
    }
  }

  // Everyone else holds the line: shares by how hard each stretch is pressed (and, for a
  // plan, how near it is to the target); guns one region back.
  const weight = (r: number) => 1 + pressure(sim, r, f.enemy) / 20 + (attacking && toTarget && toTarget[r] >= 0 ? 3 / (1 + toTarget[r]) : 0);
  const behind = [...new Set(line.flatMap((r) => land(sim, r).filter((n) => regions[n].owner === f.owner && !onLine.has(n))))];
  const where = (b: Blob) => (b.path.length ? b.path[b.path.length - 1] : b.region);
  const free = units.filter((b) => !sent.has(b) && !busy(b));

  // Guns: in place one region back (or on the line when there's no "back"), else go there.
  const gunSpots = behind.length ? behind : line;
  for (const g of free.filter((b) => UNITS[b.type].range)) {
    if (gunSpots.includes(g.region)) continue;
    const dist = hops(sim, g.region);
    const spot = gunSpots.filter((r) => dist[r] >= 0 && sim.count(f.owner, r) < sim.stackCap(r)).sort((a, b) => dist[a] - dist[b])[0];
    if (spot !== undefined) sim.move(f.owner, [g.id], spot);
  }

  const troops = units.filter((b) => !UNITS[b.type].range && !sent.has(b));
  const total = line.reduce((s, r) => s + weight(r), 0);
  const quota = new Map(line.map((r) => [r, Math.max(1, Math.round((troops.length * weight(r)) / total))]));
  const held = new Map<number, number>();
  for (const b of troops) {
    const at = where(b);
    if (onLine.has(at)) held.set(at, (held.get(at) ?? 0) + 1);
  }
  for (const b of free.filter((x) => !UNITS[x.type].range)) {
    const at = b.region;
    const here = onLine.has(at) ? (held.get(at) ?? 0) : 0;
    // On the line where it's needed: stay.
    if (onLine.has(at) && here <= (quota.get(at) ?? 1)) continue;
    const dist = hops(sim, at);
    let best = -1;
    let bestScore = -Infinity;
    for (const r of line) {
      if (dist[r] < 0 || r === at) continue;
      const short = (quota.get(r) ?? 1) - (held.get(r) ?? 0);
      if (short <= 0 || sim.count(f.owner, r) >= sim.stackCap(r)) continue;
      const score = short * 3 - dist[r];
      if (score > bestScore) [best, bestScore] = [r, score];
    }
    // Off the line with nowhere short: the nearest stretch with room.
    if (best < 0 && !onLine.has(at)) {
      best = line.filter((r) => dist[r] >= 0 && sim.count(f.owner, r) < sim.stackCap(r)).sort((a, c) => dist[a] - dist[c])[0] ?? -1;
    }
    if (best < 0 || sim.move(f.owner, [b.id], best) !== null) continue;
    if (onLine.has(at)) held.set(at, here - 1);
    held.set(best, (held.get(best) ?? 0) + 1);
  }
}
