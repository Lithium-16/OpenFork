import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCost,
  CITY_YIELD,
  CROSS_SECONDS,
  CUT_OFF_SECONDS,
  DISBAND_REFUND,
  DRILL_CAP,
  econYield,
  ENTRENCH_SECONDS,
  MERGE_MIN_STRENGTH,
  MERGE_PENALTY,
  RETREAT_STRENGTH_LOSS,
  START_INFANTRY,
  STORE_PER_CITY_LEVEL,
  STORE_PER_DEPOT,
  START_CAPITAL_LEVEL,
  supplyReach,
  techCost,
  TECHS,
  type TechId,
  UNITS,
  unitStats,
} from '../shared/rules.ts';
import { type Blob, NEUTRAL } from '../server/core/state.ts';
import { chain, clearBlobs, makeMap, place, rich, run, sim } from './helpers.ts';

/** A: capital 0; B: capital 7; a chain of 8 plains regions in between. */
function duel() {
  const map = makeMap(
    Array.from({ length: 8 }, (_, i) => ({ country: i < 4 ? 'A' : 'B' })),
    chain(8),
    [
      { id: 'A', capital: 0 },
      { id: 'B', capital: 7 },
    ],
  );
  return sim(map, ['A', 'B']);
}

describe('the start', () => {
  it('gives each country its capital, neighbours, a barracks and infantry', () => {
    const s = duel();
    const [a, b] = s.state.players;
    assert.equal(a.capital, 0);
    assert.equal(b.capital, 7);
    assert.equal(s.state.regions[0].owner, 0);
    assert.equal(s.state.regions[1].owner, 0); // the only neighbour of 0
    assert.equal(s.state.regions[7].owner, 1);
    assert.equal(s.state.regions[6].owner, 1);
    assert.equal(s.state.regions[3].owner, NEUTRAL);
    assert.ok(s.state.regions[0].barracks);
    const mine = [...s.state.blobs.values()].filter((x) => x.owner === 0);
    assert.equal(mine.length, START_INFANTRY);
    assert.ok(mine.every((x) => x.type === 'infantry'));
  });
});

describe('movement', () => {
  it('takes CROSS_SECONDS per plains hop for infantry, faster for tanks', () => {
    const s = duel();
    clearBlobs(s);
    const inf = place(s, 0, 'infantry', 0);
    const tank = place(s, 0, 'tank', 0);
    assert.equal(s.move(0, [inf.id, tank.id], 1), null);
    run(s, CROSS_SECONDS / UNITS.tank.speed + 0.2);
    assert.equal(tank.region, 1);
    assert.equal(inf.region, 0);
    run(s, CROSS_SECONDS - CROSS_SECONDS / UNITS.tank.speed);
    assert.equal(inf.region, 1);
  });

  it('is slower into forest, and into enemy land with forts', () => {
    const map = makeMap([{}, { terrain: 'forest' }, {}, {}], chain(4), [
      { id: 'A', capital: 0 },
      { id: 'B', capital: 3 },
    ]);
    const s = sim(map, ['A', 'B']);
    const plains = s.travelSeconds('infantry', 0, 0, 1);
    assert.ok(plains > CROSS_SECONDS, 'forest is slower than plains');
    s.state.regions[2].owner = NEUTRAL;
    const t0 = s.travelSeconds('infantry', 0, 1, 2);
    s.state.regions[2].owner = 1; // B's
    assert.equal(s.travelSeconds('infantry', 0, 1, 2), t0, 'zones of control only at war');
    s.declareWar(0, 1);
    const enemy = s.travelSeconds('infantry', 0, 1, 2);
    s.state.regions[2].fort = 2;
    const forted = s.travelSeconds('infantry', 0, 1, 2);
    assert.ok(enemy > t0 && forted > enemy);
  });

  it('steps into neutral regions on the way, takes each from inside, then goes on', () => {
    const s = duel();
    clearBlobs(s);
    const b = place(s, 0, 'infantry', 1);
    s.move(0, [b.id], 4);
    run(s, 3);
    assert.equal(b.region, 1, 'on its way in');
    assert.ok(b.progress > 0);
    const capture = () => s.state.regions[2].capture;
    assert.equal(capture(), null, 'nothing is taken from next door');
    run(s, CROSS_SECONDS - 2);
    assert.equal(b.region, 2, 'steps in');
    assert.equal(s.state.regions[2].owner, -1);
    run(s, 1);
    assert.ok((capture()?.progress ?? 0) > 0, 'and takes it from inside');
    assert.deepEqual(b.path, [3, 4], 'staying until it is taken');
    assert.equal(b.region, 2);
    run(s, 13); // neutral land: 30% slower than an enemy's
    assert.equal(s.state.regions[2].owner, 0);
    run(s, 60);
    assert.equal(b.region, 4);
    assert.equal(s.state.regions[3].owner, 0);
    assert.equal(s.state.regions[4].owner, 0);
  });

  it('waypoints: a move "then" goes on from the end of the route it is on, taking land region by region', () => {
    const s = duel();
    clearBlobs(s);
    for (const r of [1, 2]) s.state.regions[r].owner = 0;
    const b = place(s, 0, 'infantry', 0);
    assert.equal(s.move(0, [b.id], 2), null);
    assert.deepEqual(b.path, [1, 2]);
    assert.equal(s.move(0, [b.id], 4, true), null);
    assert.deepEqual(b.path, [1, 2, 3, 4], 'queued after the first leg');
    run(s, 80);
    assert.equal(s.state.regions[3].owner, 0, 'took 3 on the way');
    assert.equal(s.state.regions[4].owner, 0);
    assert.equal(b.region, 4);
    // With no route under way, a waypoint is just a move.
    assert.equal(s.move(0, [b.id], 3, true), null);
    assert.deepEqual(b.path, [3]);
  });

  it('turns back mid-hop at once instead of finishing the hop', () => {
    const s = duel();
    clearBlobs(s);
    for (const r of [1, 2, 3]) s.state.regions[r].owner = 0;
    const b = place(s, 0, 'infantry', 2);
    s.move(0, [b.id], 3);
    run(s, CROSS_SECONDS / 2);
    assert.equal(b.region, 2);
    assert.ok(b.progress > 0.3 && b.progress < 0.7);
    // Back where it is: it just stops.
    assert.equal(s.move(0, [b.id], 2), null);
    assert.equal(b.progress, 0);
    assert.deepEqual(b.path, []);
    // The other way: it heads there without stepping into 3 first.
    s.move(0, [b.id], 3);
    run(s, CROSS_SECONDS / 2);
    s.move(0, [b.id], 1);
    assert.equal(b.progress, 0);
    run(s, CROSS_SECONDS * 1.5);
    assert.equal(b.region, 1);
    assert.equal(b.from, 2, 'came straight from 2, never via 3');
  });

  it('a new route the same way keeps the hop going; halting stops mid-hop', () => {
    const s = duel();
    clearBlobs(s);
    for (const r of [1, 2, 3]) s.state.regions[r].owner = 0;
    const b = place(s, 0, 'infantry', 1);
    s.move(0, [b.id], 2);
    run(s, CROSS_SECONDS / 2);
    const p = b.progress;
    s.move(0, [b.id], 3);
    assert.equal(b.progress, p);
    assert.deepEqual(b.path, [2, 3]);
    assert.equal(s.stop(0, [b.id]), null);
    assert.equal(b.region, 1);
    assert.equal(b.progress, 0);
    assert.deepEqual(b.path, []);
  });

  it('waits at home while the next region is full, and goes once there is room', () => {
    const s = duel();
    clearBlobs(s);
    const cap = s.stackCap(1);
    const there = Array.from({ length: cap }, () => place(s, 0, 'infantry', 1));
    const late = place(s, 0, 'infantry', 0);
    s.move(0, [late.id], 1);
    run(s, CROSS_SECONDS * 2);
    assert.equal(late.region, 0);
    assert.equal(late.progress, 0, 'stands in its region (it can fight and be shelled there)');
    assert.equal(late.waiting, true);
    s.move(0, [there[0].id], 0);
    s.move(0, [late.id], 1);
    run(s, CROSS_SECONDS * 2.5);
    assert.equal(late.region, 1);
  });

  it('every token counts toward the cap: passing through a full region of your own waits too', () => {
    const s = duel();
    clearBlobs(s);
    for (const r of [1, 2]) s.state.regions[r].owner = 0;
    const cap = s.stackCap(1);
    for (let i = 0; i < cap; i++) place(s, 0, 'infantry', 1);
    const late = place(s, 0, 'infantry', 0);
    s.move(0, [late.id], 2);
    run(s, CROSS_SECONDS * 3);
    assert.equal(late.region, 0, 'no slipping through a full region');
    // Waiting at the edge, it still takes a place where it is.
    assert.equal(s.count(0, 0), 1);
  });

  it('a unit waiting to leave still counts, so the region has no room for more', () => {
    const s = duel();
    clearBlobs(s);
    s.state.regions[1].owner = 0;
    s.state.regions[2].owner = 0;
    const cap = s.stackCap(2);
    for (let i = 0; i < cap; i++) place(s, 0, 'infantry', 2);
    for (let i = 0; i < s.stackCap(1); i++) place(s, 0, 'infantry', 1);
    const [leaving, other] = [...s.state.blobs.values()].filter((b) => b.region === 1);
    s.move(0, [leaving.id], 2);
    run(s, CROSS_SECONDS * 2);
    assert.equal(leaving.region, 1);
    assert.equal(leaving.waiting, true);
    assert.match(s.split(0, other.id) ?? '', /no room/);
  });

  it('full regions swapping units do not jam', () => {
    const s = duel();
    clearBlobs(s);
    s.state.regions[1].owner = 0;
    s.state.regions[2].owner = 0;
    for (let i = 0; i < s.stackCap(1); i++) place(s, 0, 'infantry', 1);
    for (let i = 0; i < s.stackCap(2); i++) place(s, 0, 'infantry', 2);
    const a = [...s.state.blobs.values()].find((b) => b.region === 1) as Blob;
    const b = [...s.state.blobs.values()].find((x) => x.region === 2) as Blob;
    s.move(0, [a.id], 2);
    s.move(0, [b.id], 1);
    run(s, CROSS_SECONDS * 2);
    assert.equal(a.region, 2);
    assert.equal(b.region, 1);
  });
});

describe('surrender', () => {
  it('ends the country like a fallen capital; the last one standing wins', () => {
    const s = duel();
    assert.equal(s.surrender(0), null);
    assert.equal(s.state.players[0].alive, false);
    assert.ok(s.state.regions.every((r) => r.owner !== 0));
    assert.ok([...s.state.blobs.values()].every((b) => b.owner !== 0));
    assert.equal(s.state.winner, 1);
    assert.ok(s.drainEvents().some((e) => e.kind === 'eliminated' && e.player === 0 && e.surrendered));
    assert.match(s.surrender(0) ?? '', /already out/);
  });
});

/** A at 0..2, B at 3..7, at war; edge 2-3 is a river if asked. */
function front(river = false) {
  const map = makeMap(
    Array.from({ length: 8 }, (_, i) => ({ country: i < 4 ? 'A' : 'B' })),
    chain(8).map(([a, b]) => (a === 2 && river ? [a, b, { river: true }] : [a, b])) as Array<[number, number] | [number, number, { river: boolean }]>,
    [
      { id: 'A', capital: 0 },
      { id: 'B', capital: 7 },
    ],
  );
  const s = sim(map, ['A', 'B']);
  clearBlobs(s);
  s.state.regions.forEach((r, i) => (r.owner = i <= 2 ? 0 : 1));
  s.declareWar(0, 1);
  return s;
}

describe('border battles', () => {
  it('attacks a defended neighbour from home; the broken defenders rout, and it takes the region and steps in', () => {
    const s = front();
    const a = place(s, 0, 'infantry', 2, 40);
    const d = place(s, 1, 'infantry', 3, 5);
    assert.equal(s.move(0, [a.id], 3), null);
    run(s, 2);
    assert.equal(a.region, 2, 'stays home while it fights');
    assert.equal(a.progress, 0);
    assert.equal(a.attacking, 3);
    assert.ok(a.strength < 40 && d.strength < 5, 'both sides take damage');
    assert.ok(s.drainEvents().some((e) => e.kind === 'battle' && e.region === 3));
    run(s, 4);
    const events = s.drainEvents();
    assert.ok(events.some((e) => e.kind === 'routed' && e.region === 3), 'down to a quarter and outnumbered 3:1: they rout');
    assert.ok(events.some((e) => e.kind === 'captured' && e.region === 3), 'the region falls at once');
    assert.equal(d.region, 4, 'they fled to their own land');
    assert.ok(d.strength < 5);
    run(s, CROSS_SECONDS + 1);
    assert.equal(a.region, 3, 'advanced after the win');
    assert.equal(s.state.regions[3].owner, 0);
  });

  it('routed defenders with nowhere to go are destroyed', () => {
    const s = front();
    s.state.regions[4].owner = 0; // cut off: no land of theirs to flee to
    const a = place(s, 0, 'infantry', 2, 40);
    const d = place(s, 1, 'infantry', 3, 5);
    s.move(0, [a.id], 3);
    run(s, 6);
    assert.ok(!s.state.blobs.has(d.id));
    assert.equal(s.state.regions[3].owner, 0);
  });

  it('attacking from more than one region hits harder (flanking)', () => {
    const dealt = (sides: number) => {
      const map = makeMap([{}, {}, {}, {}], [[0, 1], [2, 1], [3, 1], [0, 2], [0, 3]], [{ id: 'A', capital: 0 }, { id: 'B', capital: 1 }]);
      const s = sim(map, ['A', 'B']);
      clearBlobs(s);
      for (const r of [0, 2, 3]) s.state.regions[r].owner = 0;
      s.declareWar(0, 1);
      const d = place(s, 1, 'infantry', 1, 100);
      const from = [0, 2, 3].slice(0, sides);
      const each = 30 / sides;
      for (const r of from) s.move(0, [place(s, 0, 'infantry', r, each).id], 1);
      run(s, 1);
      return 100 - d.strength;
    };
    const one = dealt(1);
    assert.ok(Math.abs(dealt(2) / one - 1.15) < 0.03, 'two sides: +15%');
    assert.ok(Math.abs(dealt(3) / one - 1.3) < 0.03, 'three sides: +30%');
  });

  it('rough ground covers its defenders', () => {
    const lost = (terrain: 'plains' | 'mountains') => {
      const map = makeMap([{}, { terrain }], [[0, 1]], [{ id: 'A', capital: 0 }, { id: 'B', capital: 1 }]);
      const s = sim(map, ['A', 'B']);
      clearBlobs(s);
      s.declareWar(0, 1);
      const d = place(s, 1, 'infantry', 1, 50);
      s.move(0, [place(s, 0, 'infantry', 0, 20).id], 1);
      run(s, 1);
      return 50 - d.strength;
    };
    assert.ok(lost('mountains') < lost('plains') / 1.3);
  });

  it('forts and a river between help the defenders', () => {
    const hit = (fort: number, river: boolean) => {
      const s = front(river);
      s.state.regions[3].fort = fort;
      const a = place(s, 0, 'infantry', 2, 20);
      const d = place(s, 1, 'infantry', 3, 20);
      s.move(0, [a.id], 3);
      run(s, 3);
      return 20 - d.strength;
    };
    assert.ok(hit(2, false) < hit(0, false));
    assert.ok(hit(0, true) < hit(0, false));
  });

  it('attacking each other across a border: both fight, neither goes in', () => {
    const s = front();
    const a = place(s, 0, 'infantry', 2, 20);
    const b = place(s, 1, 'infantry', 3, 20);
    s.move(0, [a.id], 3);
    s.move(1, [b.id], 2);
    run(s, 3);
    assert.equal(a.region, 2);
    assert.equal(b.region, 3);
    assert.ok(a.strength < 20 && b.strength < 20);
  });

  it('enemies getting there mid-hop call the hop off at once: it attacks from the border', () => {
    const s = front();
    s.state.regions[3].owner = 0;
    const a = place(s, 0, 'infantry', 2);
    s.move(0, [a.id], 3);
    run(s, CROSS_SECONDS / 2);
    assert.ok(a.progress > 0);
    place(s, 1, 'infantry', 3);
    run(s, 0.2);
    assert.equal(a.region, 2);
    assert.equal(a.progress, 0);
    assert.equal(a.attacking, 3);
  });

  it('units on the move still hold their region: they fight there and stop captures', () => {
    const s = front();
    const leaving = place(s, 1, 'infantry', 3, 20);
    s.state.regions[4].owner = 1;
    s.move(1, [leaving.id], 4);
    run(s, 1);
    assert.ok(leaving.progress > 0);
    const a = place(s, 0, 'infantry', 2, 20);
    s.move(0, [a.id], 3);
    run(s, 1);
    assert.equal(a.attacking, 3);
    assert.ok(leaving.strength < 20, 'still in 3: it is attacked there');
    assert.equal(s.state.regions[3].capture, null);
  });

  it('defenders attacked from next door are pinned; attackers break off for free', () => {
    const s = front();
    s.state.regions[4].owner = NEUTRAL;
    const a = place(s, 0, 'infantry', 2, 20);
    const d = place(s, 1, 'infantry', 3, 20);
    s.move(0, [a.id], 3);
    run(s, 1);
    // No slipping away into land that isn't theirs.
    assert.match(s.move(1, [d.id], 4) ?? '', /only retreat/);
    // Hitting back at the attackers is allowed, and free: it stays put.
    const before = d.strength;
    assert.equal(s.move(1, [d.id], 2), null);
    assert.equal(d.strength, before);
    // Retreating to their own land costs.
    s.state.regions[4].owner = 1;
    const now = d.strength;
    assert.equal(s.move(1, [d.id], 4), null);
    assert.ok(d.strength <= now * (1 - RETREAT_STRENGTH_LOSS) + 1e-9);
    // The attacker just stops, losing nothing.
    const mine = a.strength;
    assert.equal(s.stop(0, [a.id]), null);
    assert.equal(a.strength, mine);
  });
});

describe('battles', () => {
  it('units in a fight can only retreat, never slip past the enemy', () => {
    const s = duel();
    clearBlobs(s);
    s.declareWar(1, 0);
    s.state.regions[2].owner = 0;
    s.state.regions[3].owner = 1;
    place(s, 0, 'infantry', 2);
    const attacker = place(s, 1, 'infantry', 2);
    attacker.from = 3;
    assert.ok(s.contested(2));
    assert.match(s.move(1, [attacker.id], 0) ?? '', /only retreat/);
    assert.deepEqual(attacker.path, [], 'it stays and fights');
    const before = attacker.strength;
    assert.equal(s.move(1, [attacker.id], 3), null, 'back the way it came');
    assert.deepEqual(attacker.path, [3]);
    assert.ok(attacker.strength < before, 'retreating costs');
  });

  it('a unit pulling out of a fight can change its way out, but not turn forward', () => {
    const s = duel();
    clearBlobs(s);
    s.declareWar(1, 0);
    s.state.regions[2].owner = 0;
    s.state.regions[3].owner = 1;
    place(s, 0, 'infantry', 2);
    const attacker = place(s, 1, 'infantry', 2);
    attacker.from = 3;
    assert.equal(s.move(1, [attacker.id], 3), null);
    run(s, 0.5);
    assert.ok(attacker.progress > 0);
    assert.match(s.move(1, [attacker.id], 0) ?? '', /only retreat/);
    assert.deepEqual(attacker.path, [3], 'still pulling out');
    assert.ok(attacker.progress > 0);
  });

  it('a fort lets an equal defender win', () => {
    const s = duel();
    clearBlobs(s);
    for (const r of [3, 4, 5]) s.state.regions[r].owner = 1; // supplied from B's capital
    s.state.regions[3].fort = 2;
    const def = place(s, 1, 'infantry', 3);
    const att = place(s, 0, 'infantry', 2);
    s.state.regions[2].owner = 0;
    s.move(0, [att.id], 3);
    run(s, 120);
    assert.ok(!s.state.blobs.has(att.id), 'attacker destroyed');
    assert.ok(s.state.blobs.has(def.id));
    assert.equal(s.state.regions[3].owner, 1);
  });

  it('the winner captures the region afterwards', () => {
    const s = duel();
    clearBlobs(s);
    s.state.regions[3].owner = 1;
    const def = place(s, 1, 'infantry', 3, 4);
    const att = place(s, 0, 'infantry', 2, 20);
    s.state.regions[2].owner = 0;
    s.move(0, [att.id], 3);
    run(s, 90);
    assert.ok(!s.state.blobs.has(def.id));
    assert.equal(s.state.regions[3].owner, 0);
  });

  it('defenders behind a river take less damage', () => {
    const lose = (river: boolean) => {
      const map = makeMap([{}, {}], [[0, 1, { river }]], [{ id: 'A', capital: 0 }, { id: 'B', capital: 1 }]);
      const s = sim(map, ['A', 'B']);
      clearBlobs(s);
      const def = place(s, 1, 'infantry', 1, 10);
      const att = place(s, 0, 'infantry', 0, 10);
      s.move(0, [att.id], 1);
      run(s, CROSS_SECONDS + 5);
      return def.size - def.strength;
    };
    assert.ok(lose(true) < lose(false));
  });

  it('three sides spread their damage by strength', () => {
    const map = makeMap([{}], [], [{ id: 'A', capital: 0 }]);
    const s = sim(map, ['A']);
    clearBlobs(s);
    // Owners 0, 1, 2 (only 0 is a set-up player; the rules don't care for damage).
    s.state.players.push({ ...s.state.players[0], id: 1 }, { ...s.state.players[0], id: 2 });
    s.state.regions[0].owner = NEUTRAL;
    s.declareWar(0, 1);
    s.declareWar(0, 2);
    s.declareWar(1, 2);
    const a = place(s, 0, 'infantry', 0, 10);
    const b = place(s, 1, 'infantry', 0, 20);
    const c = place(s, 2, 'infantry', 0, 10);
    for (const x of [a, b, c]) x.supply = 1;
    // Damage only (no supply effects): run the battle step directly.
    (s as unknown as { battles(dt: number): void }).battles(0.1);
    const lossA = 10 - a.strength;
    const lossB = 20 - b.strength;
    const lossC = 10 - c.strength;
    // b is hit by a and c, which each send 2/3 of their damage to it (20 of 30 enemy strength).
    assert.ok(lossB > lossA && lossB > lossC);
    assert.ok(Math.abs(lossA - lossC) < 1e-9);
  });

  it('units killed in a fight are gone before the guns fire (no coming back from the dead)', () => {
    const s = front();
    s.state.regions[4].owner = 1;
    const tanks = place(s, 0, 'tank', 2, 117);
    const gun = place(s, 0, 'artillery', 1, 30);
    const art = place(s, 1, 'artillery', 3, 0.3);
    const inf = place(s, 1, 'infantry', 3, 0.4);
    s.move(0, [tanks.id], 3);
    run(s, 1);
    for (const b of [art, inf, gun, tanks]) if (s.state.blobs.has(b.id)) assert.ok(b.strength <= b.size + 1e-9 && b.strength >= 0, `${b.type} ${b.strength}/${b.size}`);
  });

  it('a refused order declares no war', () => {
    const s = duel();
    clearBlobs(s);
    s.state.regions[3].owner = 1;
    const b = place(s, 0, 'infantry', 0);
    s.state.blobs.delete(b.id);
    assert.match(s.move(0, [b.id], 3) ?? '', /not your unit/);
    assert.equal(s.atWar(0, 1), false);
  });

  it('retreating costs strength', () => {
    const s = duel();
    clearBlobs(s);
    s.state.regions[3].owner = 1;
    s.declareWar(0, 1);
    place(s, 1, 'infantry', 3);
    const att = place(s, 0, 'infantry', 3);
    att.from = 2;
    s.tick(0.1);
    const before = att.strength;
    assert.equal(s.move(0, [att.id], 2), null);
    assert.ok(att.strength <= before * (1 - RETREAT_STRENGTH_LOSS) + 1e-9);
  });
});

describe('training, digging in, merging', () => {
  it('idle supplied blobs drill up to the cap and dig in', () => {
    const s = duel();
    clearBlobs(s);
    const b = place(s, 0, 'infantry', 0);
    run(s, ENTRENCH_SECONDS);
    assert.ok(b.entrench > 0.99);
    run(s, DRILL_CAP * 6 + 10);
    assert.equal(b.training, DRILL_CAP);
    s.move(0, [b.id], 1);
    s.tick(0.1);
    assert.equal(b.entrench, 0);
  });

  it('merging averages training by strength, minus a penalty, up to the size cap', () => {
    const s = duel();
    clearBlobs(s);
    const a = place(s, 0, 'infantry', 0, 10);
    const b = place(s, 0, 'infantry', 0, 15);
    a.training = 40;
    b.training = 20;
    assert.equal(s.merge(0, [a.id, b.id]), null);
    assert.equal(a.size, 25);
    assert.ok(!s.state.blobs.has(b.id), 'uneven units merge whole');
    const expected = (40 * 10 + 20 * 15) / 25 - MERGE_PENALTY;
    assert.ok(Math.abs(a.training - expected) < 1e-9);
    // Up to the cap, the rest stays behind; a full unit takes no more.
    const big = place(s, 0, 'infantry', 0, 95);
    const c = place(s, 0, 'infantry', 0, 10);
    assert.equal(s.merge(0, [big.id, c.id]), null);
    assert.equal(big.size, UNITS.infantry.maxSize);
    assert.equal(c.size, 5);
    assert.match(s.merge(0, [big.id, c.id]) ?? '', /already full/);
  });

  it('units in a fight, or below a quarter of their strength, do not merge', () => {
    const s = duel();
    clearBlobs(s);
    s.declareWar(1, 0);
    s.state.regions[2].owner = 0;
    s.state.regions[3].owner = 1;
    const a = place(s, 0, 'infantry', 2);
    const b = place(s, 0, 'infantry', 2);
    const enemy = place(s, 1, 'infantry', 2);
    s.tick(0.1);
    assert.ok(s.inFight(a));
    assert.match(s.merge(0, [a.id, b.id]) ?? '', /in a fight/);
    s.state.blobs.delete(enemy.id);
    s.tick(0.1);
    assert.ok(!s.inFight(a));
    b.strength = b.size * (MERGE_MIN_STRENGTH - 0.01);
    assert.match(s.merge(0, [a.id, b.id]) ?? '', /below 25%/);
    b.strength = b.size * MERGE_MIN_STRENGTH;
    assert.equal(s.merge(0, [a.id, b.id]), null);
  });

  it('disbanding gives back part of the manpower, never in a fight', () => {
    const s = duel();
    clearBlobs(s);
    const p = s.state.players[0];
    const a = place(s, 0, 'infantry', 0);
    a.strength = a.size / 2;
    const before = p.resources.manpower;
    assert.equal(s.disband(0, [a.id]), null);
    assert.ok(!s.state.blobs.has(a.id));
    const refund = (a.strength * UNITS.infantry.cost.manpower * DISBAND_REFUND) / UNITS.infantry.batch;
    assert.ok(Math.abs(p.resources.manpower - before - refund) < 1e-9);
    s.declareWar(1, 0);
    s.state.regions[2].owner = 0;
    const b = place(s, 0, 'infantry', 2);
    place(s, 1, 'infantry', 2);
    s.tick(0.1);
    assert.match(s.disband(0, [b.id]) ?? '', /in a fight/);
    assert.match(s.disband(1, [b.id]) ?? '', /./, 'only your own units');
  });

  it('only same-type blobs merge; split halves keep their training', () => {
    const s = duel();
    clearBlobs(s);
    const a = place(s, 0, 'infantry', 0);
    const t = place(s, 0, 'tank', 0);
    assert.match(s.merge(0, [a.id, t.id]) ?? '', /same type/);
    s.state.blobs.delete(t.id);
    a.training = 30;
    assert.equal(s.split(0, a.id), null);
    const parts = [...s.state.blobs.values()];
    assert.equal(parts.length, 2);
    assert.deepEqual(
      parts.map((p) => p.size),
      [5, 5],
    );
    assert.ok(parts.every((p) => p.training === 30));
  });

  it('splits off any amount, kept between 1 and the size less one', () => {
    const s = duel();
    clearBlobs(s);
    const a = place(s, 0, 'infantry', 0);
    assert.equal(s.split(0, a.id, 3), null);
    assert.deepEqual([...s.state.blobs.values()].map((p) => p.size), [7, 3]);
    assert.equal(s.split(0, a.id, 50), null);
    assert.deepEqual([...s.state.blobs.values()].map((p) => p.size), [1, 3, 6]);
  });
});

describe('supply', () => {
  it('a city supplies 3 + its level regions away (the capital starts at level 3)', () => {
    const SUPPLY_RANGE = supplyReach(START_CAPITAL_LEVEL);
    const n = SUPPLY_RANGE + 3;
    const map = makeMap(Array.from({ length: n }, () => ({})), chain(n), [{ id: 'A', capital: 0 }]);
    const s = sim(map, ['A']);
    for (let i = 0; i < n; i++) s.state.regions[i].owner = 0;
    s.tick(0.1);
    assert.ok(s.state.regions[SUPPLY_RANGE].supplied);
    assert.ok(!s.state.regions[SUPPLY_RANGE + 1].supplied);
  });

  it('cut-off empty regions go neutral; cut-off blobs wither', () => {
    const s = duel();
    clearBlobs(s);
    // A owns 0..1 and an island of 3..5 it can't reach (2 is neutral).
    for (const r of [3, 4, 5]) s.state.regions[r].owner = 0;
    const b = place(s, 0, 'infantry', 5);
    run(s, CUT_OFF_SECONDS + 1);
    assert.equal(s.state.regions[3].owner, NEUTRAL);
    assert.equal(s.state.regions[4].owner, 0, 'held while a blob is next door');
    assert.equal(s.state.regions[5].owner, 0, 'held while a blob is there');
    assert.equal(b.supply, 0);
    assert.ok(b.strength < b.size);
  });

  it('too many blobs for the capacity get partial supply; a bigger city helps', () => {
    const s = duel();
    clearBlobs(s);
    const cap = s.stackCap(0);
    for (let i = 0; i < cap; i++) place(s, 0, 'tank', 0, UNITS.tank.maxSize);
    s.tick(0.1);
    const b = [...s.state.blobs.values()][0];
    const before = b.supply;
    assert.ok(before > 0 && before < 1);
    s.state.regions[0].city += 2;
    s.tick(0.1);
    assert.ok(b.supply > before);
  });
});

describe('economy', () => {
  it('land yields nothing by itself: cities and buildings do, and traits make buildings better', () => {
    const map = makeMap([{ traits: ['industry'] }, { traits: ['oil'] }, { terrain: 'hills' }], chain(3), [{ id: 'A', capital: 0 }]);
    const s = sim(map, ['A']);
    clearBlobs(s);
    const p = s.state.players[0];
    const regions = s.state.regions;
    regions[2].owner = 0;
    s.tick(0.1);
    // Only the capital's tax: no steel or oil from the industry and oil field alone.
    assert.ok(Math.abs(p.income.money - CITY_YIELD.money * regions[0].city) < 1e-9);
    assert.ok(Math.abs(p.income.manpower - CITY_YIELD.manpower * regions[0].city) < 1e-9);
    assert.equal(p.income.steel, 0);
    assert.equal(p.income.oil, 0);
    regions[0].econ.mine = 1;
    regions[1].econ.well = 1;
    regions[2].econ.mine = 1;
    s.tick(0.1);
    assert.ok(Math.abs(p.income.steel - (econYield('mine', map.regions[0]).steel ?? 0) - (econYield('mine', map.regions[2]).steel ?? 0)) < 1e-9);
    assert.ok((econYield('mine', map.regions[0]).steel ?? 0) > (econYield('mine', map.regions[2]).steel ?? 0));
    assert.ok(p.income.oil > 0);
    place(s, 0, 'infantry', 0);
    s.tick(0.1);
    assert.ok(p.upkeep > 0);
  });

  it('broke countries see their blobs wither', () => {
    const s = duel();
    clearBlobs(s);
    const p = s.state.players[0];
    for (let i = 0; i < 20; i++) place(s, 0, 'tank', 0, UNITS.tank.maxSize).supply = 1;
    p.resources.money = 0;
    s.tick(0.1);
    assert.ok(p.broke);
  });

  it('builds over time, and factories only where industry or a city is', () => {
    const s = duel();
    rich(s);
    assert.match(s.build(0, 1, 'factory') ?? '', /needs a city/);
    assert.equal(s.build(0, 1, 'fort'), null);
    run(s, buildCost('fort', 1).seconds - 1);
    assert.equal(s.state.regions[1].fort, 0);
    run(s, 2);
    assert.equal(s.state.regions[1].fort, 1);
  });

  it('queues builds behind the one under way, paid up front, levels counting up', () => {
    const s = duel();
    rich(s);
    const p = s.state.players[0];
    const rs = s.state.regions[0];
    const money = p.resources.money;
    assert.equal(s.build(0, 0, 'fort'), null);
    assert.equal(s.build(0, 0, 'fort'), null);
    assert.equal(s.build(0, 0, 'fort'), null);
    assert.deepEqual([rs.construction?.level, ...rs.buildQueue.map((c) => c.level)], [1, 2, 3]);
    const paid = [1, 2, 3].reduce((sum, l) => sum + buildCost('fort', l).cost.money, 0);
    assert.equal(money - p.resources.money, paid);
    assert.match(s.build(0, 0, 'fort') ?? '', /highest level/);
    assert.equal(s.build(0, 0, 'market'), null);
    assert.match(s.build(0, 0, 'road', 1) ?? '', /queue is full/);
    run(s, buildCost('fort', 1).seconds + 0.5);
    assert.equal(rs.fort, 1);
    assert.equal(rs.construction?.level, 2);
    assert.equal(rs.buildQueue.length, 2);
  });

  it('cancelling a build refunds it and the later levels it led to, then starts the next', () => {
    const s = duel();
    rich(s);
    const p = s.state.players[0];
    const rs = s.state.regions[0];
    s.build(0, 0, 'fort');
    s.build(0, 0, 'market');
    s.build(0, 0, 'fort');
    p.resources.money = 0; // refunds go back into the stores, up to their size
    run(s, 5);
    const money = p.resources.money;
    assert.equal(s.unbuild(0, 0, 0), null);
    assert.equal(p.resources.money - money, buildCost('fort', 1).cost.money + buildCost('fort', 2).cost.money);
    assert.equal(rs.construction?.kind, 'market');
    assert.equal(rs.construction?.progress, 0);
    assert.equal(rs.buildQueue.length, 0);
    assert.match(s.unbuild(0, 0, 1) ?? '', /nothing to cancel/);
    assert.match(s.unbuild(1, 0, 0) ?? '', /not your region/);
  });

  it('a captured region loses its builds', () => {
    const s = duel();
    rich(s);
    s.build(0, 1, 'fort');
    s.build(0, 1, 'market');
    s.declareWar(1, 0);
    clearBlobs(s);
    place(s, 1, 'infantry', 1);
    run(s, 30);
    assert.equal(s.state.regions[1].owner, 1);
    assert.equal(s.state.regions[1].construction, null);
    assert.deepEqual(s.state.regions[1].buildQueue, []);
  });

  it('produces queued blobs, with repeat', () => {
    const s = duel();
    clearBlobs(s);
    rich(s);
    assert.equal(s.produce(0, 0, 'barracks'), null);
    assert.equal(s.setRepeat(0, 0, 'barracks', true), null);
    run(s, UNITS.infantry.buildTime + 0.5);
    assert.equal(s.count(0, 0), 1);
    run(s, UNITS.infantry.buildTime);
    assert.equal(s.count(0, 0), 2);
    assert.match(s.produce(0, 1, 'barracks') ?? '', /no barracks/);
  });

  it('a big unit refills about as quickly as a small one', () => {
    const s = duel();
    clearBlobs(s);
    rich(s);
    const small = place(s, 0, 'infantry', 0, 5);
    small.size = 10;
    const big = place(s, 0, 'infantry', 0, 50);
    big.size = 100;
    run(s, 3);
    // Shares of their size, not equal points.
    assert.ok(big.strength - 50 > 3 * (small.strength - 5), `${big.strength} vs ${small.strength}`);
  });

  it('refills strength in supply, paying manpower', () => {
    const s = duel();
    clearBlobs(s);
    const b = place(s, 0, 'infantry', 0);
    b.strength = 5;
    const mp = s.state.players[0].resources.manpower;
    run(s, 5);
    assert.ok(b.strength > 5);
    assert.ok(s.state.players[0].resources.manpower < mp + 5 * 0.3 * 2);
  });
});

describe('development', () => {
  /** A chain of `n` medium plains regions, all A's; the capital (region 0) is a city. */
  function land(n: number, specs: Array<Parameters<typeof makeMap>[0][number]> = []) {
    const map = makeMap(
      Array.from({ length: n }, (_, i) => ({ country: 'A', ...specs[i] })),
      chain(n),
      [{ id: 'A', capital: 0 }],
    );
    const s = sim(map, ['A']);
    clearBlobs(s);
    for (let i = 0; i < n; i++) s.state.regions[i].owner = 0;
    s.tick(0.1);
    rich(s); // after the tick: stock past the stores' size is lost on the next one
    return s;
  }
  /** Runs until builds are done; land cut off meanwhile (and so lost) is given back. */
  const finish = (s: ReturnType<typeof land>) => {
    run(s, 400);
    for (const rs of s.state.regions) rs.owner = 0;
    s.tick(0.1);
  };

  it('slots come from region size, plus the city level', () => {
    const s = land(3, [{}, { size: 'small' }, { size: 'large' }]);
    assert.equal(s.build(0, 1, 'market'), null);
    assert.match(s.build(0, 1, 'farm') ?? '', /no free slot/);
    assert.equal(s.build(0, 2, 'market'), null);
    assert.equal(s.build(0, 2, 'farm'), null);
    assert.match(s.build(0, 2, 'farm') ?? '', /no free slot/);
    // Capital: medium (2) + city level 3, minus the barracks.
    assert.equal(s.state.regions[0].city, START_CAPITAL_LEVEL);
    assert.equal(s.slotsUsed(s.state.regions[0]), 1);
  });

  it('economic buildings only near your cities, and only on fitting land', () => {
    const s = land(5, [{}, { terrain: 'hills' }, {}, {}, {}]);
    assert.equal(s.build(0, 2, 'market'), null);
    assert.match(s.build(0, 3, 'market') ?? '', /within 2 regions/);
    assert.match(s.build(0, 1, 'farm') ?? '', /farmland or plains/);
    assert.equal(s.build(0, 1, 'mine'), null);
    assert.match(s.build(0, 2, 'well') ?? '', /oil field/);
    assert.match(s.build(0, 2, 'barracks') ?? '', /needs a city/);
  });

  it('markets raise income', () => {
    const s = land(2);
    const before = s.state.players[0].income.money;
    s.build(0, 1, 'market');
    finish(s);
    assert.equal(s.state.regions[1].econ.market, 1);
    assert.ok(Math.abs(s.state.players[0].income.money - before - (econYield('market', s.world.regions[1]).money ?? 0)) < 1e-9);
  });

  it('expanding a city raises tax, slots, stack cap and supply reach; forts raise stack cap', () => {
    const s = land(2);
    const p = s.state.players[0];
    const cap0 = s.stackCap(0);
    const money0 = p.income.money;
    assert.equal(s.build(0, 0, 'city'), null);
    finish(s);
    assert.equal(s.state.regions[0].city, START_CAPITAL_LEVEL + 1);
    assert.equal(s.stackCap(0), cap0 + 1);
    assert.ok(Math.abs(p.income.money - money0 - CITY_YIELD.money) < 1e-9);
    assert.equal(supplyReach(s.state.regions[0].city), supplyReach(START_CAPITAL_LEVEL) + 1);
    const cap1 = s.stackCap(1);
    s.build(0, 1, 'fort');
    s.build(0, 1, 'fort');
    finish(s);
    assert.equal(s.stackCap(1), cap1 + 2);
  });

  it('cities of countries nobody plays start small; capitals start at least at 3', () => {
    const map = makeMap(
      [{ country: 'A', city: 1 }, { country: 'A', city: 4 }, { country: 'C', city: 4 }],
      chain(3),
      [{ id: 'A', capital: 0 }],
    );
    const s = sim(map, ['A']);
    assert.deepEqual(s.state.regions.map((r) => r.city), [START_CAPITAL_LEVEL, 4, 1]);
  });

  it('founds a city away from others, which becomes a supply hub', () => {
    const s = land(14);
    assert.match(s.build(0, 1, 'city') ?? '', /too close/);
    // Region 6 is at the edge of the capital's reach; 7 and beyond are cut off.
    assert.ok(s.state.regions[6].supplied);
    assert.ok(!s.state.regions[7].supplied);
    assert.equal(s.build(0, 6, 'city'), null);
    finish(s);
    assert.equal(s.state.regions[6].city, 1);
    assert.ok(s.state.regions[10].supplied, 'a level-1 city reaches 4');
    assert.ok(!s.state.regions[11].supplied);
  });

  it('roads speed up the crossing and carry supply further', () => {
    const s = land(9);
    const slow = s.travelSeconds('infantry', 0, 1, 2);
    assert.ok(!s.state.regions[7].supplied);
    for (let i = 0; i < 6; i++) assert.equal(s.build(0, i, 'road', i + 1), null);
    assert.match(s.build(0, 1, 'road', 0) ?? '', /road already/);
    finish(s);
    assert.ok(Math.abs(s.travelSeconds('infantry', 0, 1, 2) - slow * 0.6) < 1e-9);
    assert.ok(s.state.regions[7].supplied && s.state.regions[8].supplied, 'six road hops cost three');
  });

  it('demolishing frees the slot at once, with no refund', () => {
    const s = land(2, [{}, { size: 'large' }]);
    s.build(0, 1, 'farm');
    s.build(0, 1, 'farm');
    finish(s);
    const money = s.state.players[0].resources.money;
    assert.equal(s.demolish(0, 1, 'farm'), null);
    assert.equal(s.state.regions[1].econ.farm, 1);
    assert.ok(s.state.players[0].resources.money <= money);
    assert.equal(s.build(0, 1, 'farm'), null);
    assert.match(s.demolish(0, 1, 'city') ?? '', /can't be demolished/);
  });

  it('mines and markets level up in place (I to III) in one slot', () => {
    const s = land(2, [{}, { size: 'small', terrain: 'hills' }]);
    const p = s.state.players[0];
    const before = p.income.money;
    assert.equal(s.build(0, 1, 'market'), null);
    assert.equal(s.build(0, 1, 'market'), null, 'level II queued on it: no new slot');
    assert.equal(s.build(0, 1, 'market'), null);
    assert.match(s.build(0, 1, 'market') ?? '', /highest level/);
    assert.match(s.build(0, 1, 'mine') ?? '', /no free slot/, 'the one slot is the market');
    assert.deepEqual(s.pending(s.state.regions[1]).map((c) => c.level), [1, 2, 3]);
    assert.ok(buildCost('market', 3).cost.money > buildCost('market', 2).cost.money && buildCost('market', 2).cost.money > buildCost('market', 1).cost.money);
    finish(s);
    assert.equal(s.state.regions[1].econ.market, 3);
    assert.equal(s.slotsUsed(s.state.regions[1]), 1);
    assert.ok(Math.abs(p.income.money - before - 3 * (econYield('market', s.world.regions[1]).money ?? 0)) < 1e-9, 'each level yields as much again');
    // Demolishing takes the whole building, every level.
    assert.equal(s.demolish(0, 1, 'market'), null);
    assert.equal(s.state.regions[1].econ.market, 0);
    assert.equal(s.build(0, 1, 'mine'), null);
  });

  it('cancelling a mine level cancels the levels queued on it, refunded', () => {
    const s = land(2, [{}, { terrain: 'hills' }]);
    const p = s.state.players[0];
    // Within the stores (a refund past their size would be lost).
    p.resources.money = 700;
    p.resources.steel = 300;
    assert.equal(s.build(0, 1, 'mine'), null);
    const [money, steel] = [p.resources.money, p.resources.steel];
    for (let i = 0; i < 2; i++) assert.equal(s.build(0, 1, 'mine'), null);
    assert.equal(s.unbuild(0, 1, 1), null);
    assert.deepEqual(s.pending(s.state.regions[1]).map((c) => c.level), [1]);
    assert.ok(Math.abs(p.resources.money - money) < 1e-6 && Math.abs(p.resources.steel - steel) < 1e-6, 'levels II and III refunded');
  });

  it('captured land keeps its buildings', () => {
    const s = duel();
    rich(s);
    s.build(0, 1, 'market');
    run(s, buildCost('market').seconds + 5);
    s.declareWar(1, 0);
    clearBlobs(s);
    place(s, 1, 'infantry', 1);
    run(s, 30);
    assert.equal(s.state.regions[1].owner, 1);
    assert.equal(s.state.regions[1].econ.market, 1);
  });
});

describe('capitals', () => {
  it('taking a capital eliminates its country and ends a two-player game', () => {
    const s = duel();
    clearBlobs(s);
    s.state.regions[6].owner = 0;
    const b = place(s, 0, 'infantry', 6);
    s.move(0, [b.id], 7);
    run(s, 40);
    const p1 = s.state.players[1];
    assert.equal(p1.alive, false);
    assert.equal(s.state.regions[7].owner, 0);
    assert.equal(s.state.winner, 0);
    assert.ok(![...s.state.blobs.values()].some((x) => x.owner === 1));
    const events = s.drainEvents().map((e) => e.kind);
    assert.ok(events.includes('eliminated') && events.includes('won'));
  });
});

describe('domination', () => {
  it('holding most of the land wins outright, capitals or not', () => {
    const s = duel();
    clearBlobs(s);
    // A holds 5 of the 8 regions (62%); taking a sixth (75%) is enough.
    s.state.regions.forEach((rs, i) => (rs.owner = i < 5 ? 0 : 1));
    s.declareWar(0, 1);
    const b = place(s, 0, 'infantry', 4);
    s.move(0, [b.id], 5);
    run(s, 40);
    assert.equal(s.state.regions[5].owner, 0);
    assert.equal(s.state.players[1].alive, true, 'B still has its capital');
    assert.equal(s.state.winner, 0);
    const won = s.drainEvents().find((e) => e.kind === 'won');
    assert.ok(won && won.kind === 'won' && won.domination);
  });
});

describe('artillery', () => {
  /** A at war with B on the duel chain; A owns 0-3, B owns 4-7. */
  function war() {
    const s = duel();
    clearBlobs(s);
    s.declareWar(1, 0);
    s.state.regions.forEach((rs, i) => (rs.owner = i < 4 ? 0 : 1));
    return s;
  }

  it('shells enemies up to two regions away, not three', () => {
    const s = war();
    const gun = place(s, 0, 'artillery', 2, 10);
    const near = place(s, 1, 'infantry', 4, 10);
    s.tick(0.1);
    assert.equal(gun.bombarding, 4);
    assert.ok(near.strength < 10);
    s.state.blobs.delete(near.id);
    const far = place(s, 1, 'infantry', 5, 10);
    s.tick(0.1);
    assert.equal(gun.bombarding, -1);
    assert.equal(far.strength, 10);
  });

  it('waits at the border and shells instead of storming in', () => {
    const s = war();
    const gun = place(s, 0, 'artillery', 3, 10);
    const enemy = place(s, 1, 'infantry', 4, 10);
    assert.equal(s.move(0, [gun.id], 4), null);
    run(s, 2);
    assert.equal(gun.region, 3);
    assert.equal(gun.attacking, -1);
    assert.equal(gun.strength, 10, 'nobody shoots back at it from next door');
    assert.ok(enemy.strength < 10);
  });

  it('breaks fast up close', () => {
    const s = war();
    s.state.regions[2].owner = 1;
    const gun = place(s, 0, 'artillery', 1, 10);
    const rifles = place(s, 0, 'infantry', 3, 10);
    s.state.regions[3].owner = 1;
    const a = place(s, 1, 'infantry', 1, 10);
    const b = place(s, 1, 'infantry', 3, 10);
    run(s, 5);
    assert.ok(10 - gun.strength > 2 * (10 - rifles.strength), `gun lost ${10 - gun.strength}, rifles ${10 - rifles.strength}`);
    assert.ok(a.strength > b.strength, 'and hits back weakly');
  });

  it("keeps to its target while there's something to hit there", () => {
    const s = war();
    const gun = place(s, 0, 'artillery', 3, 10);
    place(s, 1, 'infantry', 4, 10);
    s.tick(0.1);
    assert.equal(gun.bombarding, 4);
    // A bigger force turns up in range: the gun stays on what it was shelling.
    const big = place(s, 1, 'infantry', 5, 40);
    for (let i = 0; i < 20; i++) {
      s.tick(0.1);
      assert.equal(gun.bombarding, 4);
    }
    // Nothing left at 4: it moves on.
    for (const x of s.blobsIn(4)) s.state.blobs.delete(x.id);
    s.tick(0.1);
    assert.equal(gun.bombarding, 5);
    assert.ok(big.strength < 40);
  });

  it('shells ignore digging in', () => {
    const hit = (entrench: number) => {
      const s = war();
      place(s, 0, 'artillery', 2, 10);
      const target = place(s, 1, 'infantry', 4, 10);
      target.entrench = entrench;
      s.tick(0.1);
      return 10 - target.strength;
    };
    assert.ok(hit(0) > 0);
    assert.ok(Math.abs(hit(1) - hit(0)) < 1e-9);
  });

  it('wears an enemy fort down a level at a time (a siege), even with Rangefinders', () => {
    for (const techs of [[], ['shells', 'rangefinders']] as TechId[][]) {
      const s = war();
      s.state.players[0].techs = techs;
      s.state.regions[4].fort = 2;
      place(s, 0, 'artillery', 2, 20);
      const held = place(s, 1, 'infantry', 4, 1000);
      // Defenders kept at full strength: something stays there to shell.
      const shell = (seconds: number) => {
        for (let t = 0; t < seconds; t++) {
          run(s, 1);
          held.strength = 1000;
        }
      };
      shell(85);
      assert.equal(s.state.regions[4].fort, 1, `one level gone in 85 s (${techs.join(',') || 'no techs'})`);
      const breached = s.drainEvents().filter((e) => e.kind === 'breached');
      assert.deepEqual(breached.map((e) => e.kind === 'breached' && e.level), [1]);
      shell(85);
      assert.equal(s.state.regions[4].fort, 0, 'and the next');
    }
  });

  it("doesn't wear forts down when not at war, or with nobody in them", () => {
    const s = war();
    s.state.regions[4].fort = 2;
    place(s, 0, 'artillery', 2, 20);
    run(s, 60);
    assert.equal(s.state.regions[4].fort, 2, 'nobody there: nothing to shell');
  });

  it('comes from the factory, not the barracks', () => {
    const s = duel();
    rich(s);
    s.state.regions[0].factory = true;
    s.state.regions[0].barracks = true;
    assert.match(s.produce(0, 0, 'barracks', 'artillery') ?? '', /can't make/);
    assert.equal(s.produce(0, 0, 'factory', 'artillery'), null);
    assert.deepEqual(s.state.regions[0].production.factory.queue, ['artillery']);
  });
});

describe('storage', () => {
  it('stores fill up to what cities and depots hold; the rest is lost, and losing storage loses stock', () => {
    const s = duel();
    clearBlobs(s);
    const p = s.state.players[0];
    s.tick(0.1);
    const city = s.state.regions[0].city;
    assert.equal(p.cap.money, STORE_PER_CITY_LEVEL.money * city);
    p.resources.money = p.cap.money - 0.01;
    run(s, 5);
    assert.equal(p.resources.money, p.cap.money);
    s.state.regions[1].depots = 1;
    s.tick(0.1);
    assert.equal(p.cap.money, STORE_PER_CITY_LEVEL.money * city + STORE_PER_DEPOT.money);
    run(s, 2);
    assert.ok(p.resources.money > STORE_PER_CITY_LEVEL.money * city, 'room again');
    // The depot's region is lost: what it held goes with it.
    p.resources.manpower = p.cap.manpower;
    s.state.regions[1].owner = 1;
    s.tick(0.1);
    assert.equal(p.resources.manpower, STORE_PER_CITY_LEVEL.manpower * city);
    assert.equal(p.resources.money, STORE_PER_CITY_LEVEL.money * city);
  });

  it('depots take a slot, can be built anywhere you hold and knocked down', () => {
    const s = duel();
    rich(s);
    assert.equal(s.build(0, 1, 'depot'), null);
    run(s, buildCost('depot').seconds + 1);
    assert.equal(s.state.regions[1].depots, 1);
    assert.equal(s.slotsUsed(s.state.regions[1]), 1);
    assert.equal(s.demolish(0, 1, 'depot'), null);
    assert.equal(s.state.regions[1].depots, 0);
  });

  it('taking a depot takes its share of the stock', () => {
    const s = duel();
    clearBlobs(s);
    s.declareWar(1, 0);
    s.state.regions[1].owner = 0;
    s.state.regions[1].depots = 1;
    s.tick(0.1);
    const a = s.state.players[0];
    const b = s.state.players[1];
    a.resources.steel = 400;
    b.resources.steel = 0;
    const share = STORE_PER_DEPOT.steel / a.cap.steel;
    place(s, 1, 'infantry', 1);
    s.drainEvents();
    run(s, 30);
    assert.equal(s.state.regions[1].owner, 1);
    assert.ok(Math.abs(a.resources.steel - 400 * (1 - share)) < 1, `left ${a.resources.steel}`);
    assert.ok(Math.abs(b.resources.steel - 400 * share) < 1, `took ${b.resources.steel}`);
    assert.ok(s.drainEvents().some((e) => e.kind === 'looted'));
  });
});

describe('research', () => {
  it('one tech at a time, each after its parent, paid in research points as they come', () => {
    const s = duel();
    rich(s);
    const p = s.state.players[0];
    p.resources.research = 0;
    assert.match(s.research(0, 'trenches') ?? '', /needs Rifles/);
    assert.equal(s.research(0, 'rifles'), null);
    assert.match(s.research(0, 'farming') ?? '', /already researching/);
    // Only what the capital makes: slow.
    run(s, 10);
    assert.ok(p.research && p.research.paid > 0 && p.research.paid < techCost(1));
    // A stock of points finishes it at once.
    p.resources.research = techCost(1);
    s.tick(0.1);
    assert.deepEqual(p.techs, ['rifles']);
    assert.equal(s.research(0, 'trenches'), null);
    s.tick(0.1);
    const paid = p.research?.paid ?? 0;
    const stock = p.resources.research;
    assert.equal(s.unresearch(0), null);
    assert.equal(p.research, null);
    assert.ok(Math.abs(p.resources.research - stock - paid) < 1e-9, 'points paid in come back');
  });

  it('labs make research points, in cities only', () => {
    const s = duel();
    rich(s);
    s.tick(0.1);
    const before = s.state.players[0].income.research;
    assert.match(s.build(0, 1, 'lab') ?? '', /needs a city/);
    assert.equal(s.build(0, 0, 'lab'), null);
    run(s, buildCost('lab').seconds + 1);
    assert.equal(s.state.regions[0].econ.lab, 1);
    assert.ok(Math.abs(s.state.players[0].income.research - before - (econYield('lab', s.world.regions[0]).research ?? 0)) < 1e-9);
  });

  it('techs change the numbers: rifles hit harder, warehouses store more, long guns reach further', () => {
    const fight = (techs: TechId[]) => {
      const s = duel();
      clearBlobs(s);
      s.declareWar(1, 0);
      s.state.regions.forEach((rs, i) => (rs.owner = i < 4 ? 0 : 1));
      s.state.players[0].techs = techs;
      place(s, 0, 'infantry', 3, 10);
      const enemy = place(s, 1, 'infantry', 3, 10);
      s.tick(0.1);
      return 10 - enemy.strength;
    };
    assert.ok(fight(['rifles']) > fight([]) * 1.19);
    const s = duel();
    s.tick(0.1);
    const cap = s.state.players[0].cap.money;
    s.state.players[0].techs = ['warehouses'];
    s.tick(0.1);
    assert.equal(s.state.players[0].cap.money, cap * 1.5);
    assert.equal(unitStats('artillery', ['shells', 'rangefinders', 'longGuns']).range, 3);
  });
});

describe('the longer tree', () => {
  it('has five lines, five tiers deep, each tech after its parent', () => {
    assert.equal(new Set(TECHS.map((t) => t.branch)).size, 5);
    assert.equal(Math.max(...TECHS.map((t) => t.tier)), 5);
    for (const t of TECHS) for (const n of t.needs) assert.equal(TECHS.find((x) => x.id === n)?.tier, t.tier - 1, `${t.id} needs ${n}`);
    assert.ok(techCost(5) > techCost(4) && techCost(4) > techCost(3));
  });

  it('naval and later techs change the numbers', () => {
    assert.ok(unitStats('warship', ['shipyards']).buildTime < UNITS.warship.buildTime);
    assert.ok(unitStats('warship', ['shipyards', 'navalGuns']).attack > UNITS.warship.attack);
    assert.equal(unitStats('warship', ['navalAviation']).range, (UNITS.warship.range ?? 0) + 1);
    assert.ok(unitStats('infantry', ['mountaineers']).terrainAttack.hills > UNITS.infantry.terrainAttack.hills);
    assert.ok(unitStats('tank', ['heavyTanks']).terrainAttack.mountains > UNITS.tank.terrainAttack.mountains);
    assert.ok(unitStats('infantry', ['massProduction']).buildTime < UNITS.infantry.buildTime);
    const s = duel();
    clearBlobs(s);
    s.state.players[0].techs.push('massProduction');
    rich(s);
    s.produce(0, 0, 'barracks');
    run(s, UNITS.infantry.buildTime * 0.8);
    assert.equal([...s.state.blobs.values()].filter((b) => b.owner === 0).length, 1, 'made a quarter faster');
  });

  it('coastal defence makes batteries hit harder', () => {
    const lost = (tech: boolean) => {
      const map = makeMap([{ country: 'A' }, { sea: true }, { country: 'B' }], [[0, 1], [1, 2]], [{ id: 'A', capital: 0 }, { id: 'B', capital: 2 }]);
      const s = sim(map, ['A', 'B']);
      clearBlobs(s);
      s.declareWar(0, 1);
      if (tech) s.state.players[0].techs.push('coastalDefence');
      s.state.regions[0].battery = true;
      const ship = place(s, 1, 'warship', 1, 50);
      s.tick(0.1);
      return 50 - ship.strength;
    };
    // (Both include the same small loss from the ship being out of supply.)
    assert.ok(lost(true) > lost(false) * 1.3);
  });
});

describe('tanks need research', () => {
  it('a factory makes tanks only after Tanks is researched', () => {
    const s = duel();
    rich(s);
    s.state.regions[0].factory = true;
    assert.match(s.produce(0, 0, 'factory', 'tank') ?? '', /research Tanks first/);
    assert.equal(s.produce(0, 0, 'factory'), null, 'unspecified: artillery, which needs nothing');
    assert.deepEqual(s.state.regions[0].production.factory.queue, ['artillery']);
    s.state.players[0].techs = ['tanks'];
    assert.equal(s.produce(0, 0, 'factory', 'tank'), null);
    assert.equal(s.research(0, 'engines'), null, 'and Engines opens up');
  });
});

describe('the sea', () => {
  /** A's coast 0 - sea 1 - sea 2 - B's coast 3, plus A's inland 4 behind 0. */
  function strait() {
    const map = makeMap(
      [{ country: 'A' }, { sea: true }, { sea: true }, { country: 'B' }, { country: 'A' }],
      [[0, 1], [1, 2], [2, 3], [4, 0]],
      [{ id: 'A', capital: 4 }, { id: 'B', capital: 3 }],
    );
    const s = sim(map, ['A', 'B']);
    clearBlobs(s);
    return s;
  }

  it('builds ports only on a coast', () => {
    const s = strait();
    rich(s);
    assert.match(s.build(0, 4, 'port') ?? '', /coast/);
    assert.equal(s.build(0, 0, 'port'), null);
  });

  it('makes warships at a port', () => {
    const s = strait();
    rich(s);
    s.state.regions[0].port = true;
    assert.equal(s.produce(0, 0, 'port', 'warship'), null);
    assert.deepEqual(s.state.regions[0].production.port.queue, ['warship']);
    assert.match(s.produce(0, 0, 'port', 'infantry') ?? '', /can't make/);
  });

  it('ships troops across from their own port, and only from one', () => {
    const s = strait();
    s.declareWar(0, 1);
    const inf = place(s, 0, 'infantry', 4, 10);
    assert.equal(s.move(0, [inf.id], 3), 'no route', 'no port, no crossing');
    s.state.regions[0].port = true;
    assert.equal(s.move(0, [inf.id], 3), null);
    assert.deepEqual(inf.path, [0, 1, 2, 3]);
    assert.match(s.move(0, [inf.id], 1) ?? '', /troops cross the sea/);
    run(s, 120);
    assert.equal(s.state.regions[3].owner, 0, 'landed and took it');
  });

  it('never makes the sea anyone\'s', () => {
    const s = strait();
    s.state.regions[0].port = true;
    const ship = place(s, 0, 'warship', 0, 10);
    assert.equal(s.move(0, [ship.id], 2), null);
    run(s, 60);
    assert.equal(ship.region, 2);
    assert.equal(s.state.regions[2].owner, -1);
    assert.match(s.move(0, [ship.id], 3) ?? '', /ships go to sea regions/);
  });

  it('enemy ships block transports and sink them', () => {
    const s = strait();
    s.declareWar(0, 1);
    s.state.regions[0].port = true;
    s.state.regions[3].port = true;
    const ship = place(s, 1, 'warship', 2, 20);
    const inf = place(s, 0, 'infantry', 0, 10);
    assert.equal(s.move(0, [inf.id], 3), null);
    run(s, 60);
    assert.ok(inf.region !== 3 && s.state.regions[3].owner === 1, 'never landed');
    assert.ok(!s.state.blobs.has(inf.id) || inf.strength < 5, `troops at sea took a beating (${inf.strength})`);
    assert.ok(ship.strength > 15, `the ship barely noticed (${ship.strength})`);
  });

  it('landings hit weaker than attacks over land', () => {
    const lost = (fromSea: boolean) => {
      const s = strait();
      s.declareWar(0, 1);
      const def = place(s, 1, 'infantry', 3, 10);
      def.entrench = 0;
      const atk = place(s, 0, 'infantry', fromSea ? 2 : 3, 10);
      if (fromSea) {
        atk.path = [3];
      } else {
        // The same fight on land: the attacker next door in A's region 0 would be across the
        // sea, so stand it in the defender's region instead (both fight at full strength).
        atk.path = [];
      }
      run(s, 3);
      return 10 - def.strength;
    };
    assert.ok(lost(true) > 0, 'a landing still hurts');
    assert.ok(lost(true) < lost(false), `landing ${lost(true)} vs land ${lost(false)}`);
  });

  it('warships shell the coast and the seas next to theirs', () => {
    const s = strait();
    s.declareWar(0, 1);
    s.state.regions[0].port = true;
    const ship = place(s, 0, 'warship', 2, 10);
    const target = place(s, 1, 'infantry', 3, 10);
    s.tick(0.1);
    assert.equal(ship.bombarding, 3);
    assert.ok(target.strength < 10);
  });

  it('artillery never shells ships or troops at sea, and guns being shipped never fire', () => {
    const s = strait();
    s.declareWar(0, 1);
    s.state.regions[0].port = true;
    const gun = place(s, 0, 'artillery', 0, 20);
    const ship = place(s, 1, 'warship', 1, 20);
    const boats = place(s, 1, 'infantry', 1, 10);
    s.tick(0.1);
    assert.equal(gun.bombarding, -1);
    assert.equal(boats.strength, 10);
    const afloat = place(s, 0, 'artillery', 2, 20);
    place(s, 1, 'infantry', 3, 10);
    s.tick(0.1);
    assert.equal(afloat.bombarding, -1, 'no firing from the transports');
    assert.ok(ship.strength > 0);
  });

  it('ships never fight on land: docked ships don\'t defend, and they put to sea when the port falls', () => {
    const s = strait();
    s.declareWar(0, 1);
    s.state.regions[3].port = true;
    s.state.players[1].capital = -1; // so taking 3 doesn't knock B out
    const fleet = place(s, 1, 'warship', 3, 100);
    const inf = place(s, 0, 'infantry', 2, 20);
    inf.path = [3];
    s.tick(0.1);
    assert.equal(s.inFight(inf), false, 'nothing to fight: the coast is empty but for ships');
    run(s, 20);
    assert.equal(s.state.regions[3].owner, 0, 'taken from the sea');
    assert.equal(fleet.region, 2, 'the fleet put out to sea');
    // Ships don't storm their own port when enemy troops are in it.
    s.state.regions[0].port = true;
    s.state.regions[0].owner = 1;
    place(s, 0, 'infantry', 0, 10);
    const ships = place(s, 1, 'warship', 1, 20);
    assert.match(s.move(1, [ships.id], 0) ?? 'ok', /ok/);
    run(s, 1);
    assert.equal(ships.attacking, -1);
    assert.equal(ships.region, 1);
  });

  it('a fleet in port sails out to fight a fleet off its coast, at full strength', () => {
    const s = strait();
    s.declareWar(0, 1);
    s.state.regions[0].port = true;
    const mine = place(s, 0, 'warship', 0, 20);
    const theirs = place(s, 1, 'warship', 1, 20);
    s.move(0, [mine.id], 1);
    run(s, 3);
    assert.equal(mine.attacking, 1);
    assert.ok(theirs.strength < 18, `it hits back (${theirs.strength})`);
  });

  it('a coastal battery shells enemy ships and troops off its coast', () => {
    const s = strait();
    rich(s);
    s.declareWar(0, 1);
    assert.match(s.build(0, 4, 'battery') ?? '', /coast/);
    s.state.regions[0].battery = true;
    const ship = place(s, 1, 'warship', 1, 20);
    s.tick(0.1);
    assert.ok(ship.strength < 20);
    assert.deepEqual([...s.batteryTargets], [[0, 1]]);
  });

  it('a mixed selection sends the ships to sea and the troops ashore', () => {
    const s = strait();
    s.state.regions[0].port = true;
    const ship = place(s, 0, 'warship', 0, 10);
    const inf = place(s, 0, 'infantry', 0, 10);
    assert.equal(s.move(0, [ship.id, inf.id], 1), null);
    assert.deepEqual(ship.path, [1]);
    assert.deepEqual(inf.path, []);
  });

  it('troops at sea neither refill nor drill', () => {
    const s = strait();
    const inf = place(s, 0, 'infantry', 1, 10);
    inf.size = 20;
    run(s, 30);
    assert.equal(inf.strength, 10);
    assert.equal(inf.training, 0);
  });

  it('ships mend in the sea off their own port, not further out', () => {
    const s = strait();
    rich(s);
    s.state.regions[0].port = true;
    const near = place(s, 0, 'warship', 1, 40);
    const far = place(s, 0, 'warship', 2, 40);
    near.size = far.size = 100;
    run(s, 10);
    assert.equal(far.strength, 40, 'no fleet train: no mending out at sea');
    // Off its port, at home: about (0.15 + 1.2) × 1.5 a second.
    assert.ok(near.strength > 55, `mended to ${near.strength}`);
  });

  it('ships are supplied near their own ports only', () => {
    const s = strait();
    const ship = place(s, 0, 'warship', 2, 10);
    s.tick(0.1);
    assert.equal(ship.supply, 0, 'no port anywhere');
    s.state.regions[0].port = true;
    s.tick(0.1);
    assert.equal(ship.supply, 1);
  });
});
