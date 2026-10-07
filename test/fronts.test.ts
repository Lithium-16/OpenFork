import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FrontCommand } from '../server/core/fronts.ts';
import { readSave, dumpState } from '../server/core/save.ts';
import type { Sim } from '../server/core/sim.ts';
import { World } from '../server/core/world.ts';
import { clearBlobs, makeMap, place, sim } from './helpers.ts';

/**
 * A 3 × 4 grid, region = row * 4 + column. A holds columns 0-1, B columns 2-3: the border
 * runs between A's 1, 5, 9 and B's 2, 6, 10. Twelve more regions out of reach, so taking a
 * few doesn't win the game by holding most of the land.
 */
function grid() {
  const edges: Array<[number, number]> = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const id = r * 4 + c;
      if (c < 3) edges.push([id, id + 1]);
      if (r < 2) edges.push([id, id + 4]);
    }
  }
  const map = makeMap(
    Array.from({ length: 24 }, (_, i) => (i < 12 ? { country: i % 4 < 2 ? 'A' : 'B', city: i === 4 || i === 7 ? 3 : undefined } : {})),
    edges,
    [
      { id: 'A', capital: 4 },
      { id: 'B', capital: 7 },
    ],
  );
  const s = sim(map, ['A', 'B']);
  clearBlobs(s);
  s.state.regions.forEach((rs, i) => (rs.owner = i >= 12 ? -1 : i % 4 < 2 ? 0 : 1));
  s.tick(0.1);
  return { s, map };
}

/** Runs the sim with fronts commanded, like the game does. */
function play(s: Sim, seconds: number, fronts = new FrontCommand()): void {
  for (let i = 0; i < seconds * 10; i++) {
    fronts.act(s);
    s.tick(0.1);
  }
}

const LINE = [1, 5, 9];

describe('fronts', () => {
  it('spread out along the border and hold it', () => {
    const { s } = grid();
    const units = Array.from({ length: 3 }, () => place(s, 0, 'infantry', 4, 10));
    assert.equal(s.setFront(0, units.map((b) => b.id), 1), null);
    play(s, 60);
    for (const r of LINE) assert.equal(s.blobsIn(r).filter((b) => b.owner === 0).length, 1, `one on R${r}`);
    assert.ok(units.every((b) => b.entrench > 0), 'dug in');
    assert.equal(s.state.regions[2].owner, 1, "holding, not attacking: B's land stays B's");
  });

  it('put more where the enemy presses, and guns one region back', () => {
    const { s } = grid();
    place(s, 1, 'infantry', 2, 60);
    const units = Array.from({ length: 5 }, () => place(s, 0, 'infantry', 4, 10));
    const gun = place(s, 0, 'artillery', 5, 10);
    s.setFront(0, [...units, gun].map((b) => b.id), 1);
    play(s, 60);
    const mine = (r: number) => s.blobsIn(r).filter((b) => b.owner === 0 && b.type === 'infantry').length;
    assert.ok(mine(1) > mine(9), `facing the big army: ${mine(1)} vs ${mine(9)}`);
    assert.ok([0, 4, 8].includes(gun.region), `the gun stands back, in R${gun.region}`);
  });

  it("a battle plan waits for war, then pushes toward its target and holds once it's taken", () => {
    const { s } = grid();
    const units = Array.from({ length: 6 }, () => place(s, 0, 'infantry', 5, 10));
    place(s, 1, 'infantry', 6, 3);
    assert.equal(s.setFront(0, units.map((b) => b.id), 1, true, 7), null);
    play(s, 20);
    assert.equal(s.state.regions[6].owner, 1, 'at peace: it only holds');
    s.declareWar(0, 1);
    play(s, 240);
    assert.equal(s.state.players[1].alive, false, "the target was B's capital");
    // (B is out: its land is neutral and the front is gone with it.)
    assert.equal(s.state.fronts.length, 0);
  });

  it("doesn't throw units at a region it can't take", () => {
    const { s } = grid();
    s.declareWar(0, 1);
    const units = Array.from({ length: 2 }, () => place(s, 0, 'infantry', 5, 10));
    place(s, 1, 'infantry', 6, 200);
    s.setFront(0, units.map((b) => b.id), 1, true, 6);
    play(s, 30);
    assert.ok(units.every((b) => b.strength === 10 && s.state.regions[b.region].owner === 0), 'they hold instead');
    assert.equal(s.state.regions[6].owner, 1);
  });

  it('units leave their front when given orders by hand, and an empty front goes', () => {
    const { s } = grid();
    const [a, b] = [place(s, 0, 'infantry', 4, 10), place(s, 0, 'infantry', 4, 10)];
    s.setFront(0, [a.id, b.id], 1);
    s.leaveFronts(0, [a.id]);
    assert.deepEqual(s.state.fronts[0].units, [b.id]);
    s.leaveFronts(0, [b.id]);
    assert.equal(s.state.fronts.length, 0);
    assert.match(s.setFront(0, [a.id], 0) ?? '', /another country/);
    assert.match(s.setFront(0, [], 1) ?? '', /land units/);
  });

  it('a unit is on one front at most', () => {
    const { s } = grid();
    const a = place(s, 0, 'infantry', 4, 10);
    s.setFront(0, [a.id], 1);
    // A third country isn't on this map: a front with B again just keeps it.
    s.setFront(0, [a.id], 1, true, 6);
    assert.equal(s.state.fronts.length, 1);
    assert.deepEqual(s.state.fronts[0], { owner: 0, enemy: 1, units: [a.id], attack: true, target: 6 });
  });

  it('are kept in save files', () => {
    const { s, map } = grid();
    const a = place(s, 0, 'infantry', 4, 10);
    s.setFront(0, [a.id], 1, true, 7);
    const file = JSON.stringify({
      v: 1,
      map: 'test',
      starting: 'normal',
      bots: 'normal',
      seed: 1,
      players: s.state.players.map((p) => ({ name: p.name, country: p.country, color: p.color, human: p.id === 0 })),
      human: 0,
      sim: dumpState(s.state),
    });
    const read = readSave(file, () => new World(map));
    assert.ok(typeof read !== 'string', String(read));
    assert.deepEqual(read.state.fronts, [{ owner: 0, enemy: 1, units: [a.id], attack: true, target: 7 }]);
  });
});
