import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AutoCommand } from '../server/core/auto.ts';
import { Game } from '../server/core/game.ts';
import { dumpState, readSave } from '../server/core/save.ts';
import type { Sim } from '../server/core/sim.ts';
import { World } from '../server/core/world.ts';
import { chain, clearBlobs, makeMap, place, players, sim } from './helpers.ts';

/** A chain of ten: A holds 0-1 (capital 0), 2-6 are neutral, B holds 7-9 (capital 9). */
function line() {
  const map = makeMap(
    Array.from({ length: 10 }, (_, i) => (i < 2 ? { country: 'A', city: i === 0 ? 3 : undefined } : i > 6 ? { country: 'B', city: i === 9 ? 3 : undefined } : {})),
    chain(10),
    [
      { id: 'A', capital: 0 },
      { id: 'B', capital: 9 },
    ],
  );
  const s = sim(map, ['A', 'B']);
  clearBlobs(s);
  s.state.regions.forEach((rs, i) => (rs.owner = i < 2 ? 0 : i > 6 ? 1 : -1));
  s.tick(0.1);
  return { s, map };
}

/** Runs the sim with auto units commanded, like the game does. */
function play(s: Sim, seconds: number, autos = new AutoCommand()): void {
  for (let i = 0; i < seconds * 10; i++) {
    autos.act(s);
    s.tick(0.1);
  }
}

describe('auto', () => {
  it('takes neutral land one region after another, staying in supply', () => {
    const { s } = line();
    const a = place(s, 0, 'infantry', 1, 20);
    assert.equal(s.setAuto(0, [a.id], true), null);
    play(s, 150);
    assert.equal(s.state.regions[2].owner, 0);
    assert.equal(s.state.regions[3].owner, 0);
    assert.ok(a.auto, 'still on Auto');
    // Never further than next to our supplied land.
    for (let r = 2; r <= 6; r++) {
      if (s.state.regions[r].owner !== 0) continue;
      assert.ok(s.state.regions[r - 1].owner === 0, `region ${r} is joined to our land`);
    }
  });

  it('attacks a weakly held enemy region, but not a strongly held one', () => {
    const weak = line();
    weak.s.state.regions.forEach((rs, i) => (rs.owner = i < 7 ? 0 : 1));
    weak.s.declareWar(0, 1);
    weak.s.tick(0.1);
    const a = place(weak.s, 0, 'infantry', 6, 60);
    place(weak.s, 1, 'infantry', 7, 5);
    weak.s.setAuto(0, [a.id], true);
    play(weak.s, 3);
    assert.equal(a.attacking, 7, 'it attacks the weak defenders');

    const strong = line();
    strong.s.state.regions.forEach((rs, i) => (rs.owner = i < 7 ? 0 : 1));
    strong.s.declareWar(0, 1);
    strong.s.state.regions[7].fort = 3;
    strong.s.tick(0.1);
    const b = place(strong.s, 0, 'infantry', 6, 20);
    place(strong.s, 1, 'infantry', 7, 60);
    strong.s.setAuto(0, [b.id], true);
    play(strong.s, 3);
    assert.equal(b.attacking, -1);
    assert.deepEqual(b.path, [], 'it stays put');
  });

  it('two auto units go for different regions', () => {
    // A star: A's 0 in the middle, neutral 1, 2 and 3 around it.
    const map = makeMap(
      [{ country: 'A', city: 3 }, {}, {}, {}],
      [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
      [{ id: 'A', capital: 0 }],
    );
    const s = sim(map, ['A']);
    clearBlobs(s);
    s.state.regions.forEach((rs, i) => (rs.owner = i === 0 ? 0 : -1));
    s.tick(0.1);
    const a = place(s, 0, 'infantry', 0, 20);
    const b = place(s, 0, 'infantry', 0, 20);
    s.setAuto(0, [a.id, b.id], true);
    new AutoCommand().act(s);
    assert.equal(a.path.length, 1);
    assert.equal(b.path.length, 1);
    assert.notEqual(a.path[0], b.path[0]);
  });

  it('an order by hand turns it off; it is kept in save files', () => {
    const { s, map } = line();
    const a = place(s, 0, 'infantry', 1, 20);
    s.setAuto(0, [a.id], true);
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
    assert.equal(read.state.blobs.get(a.id)?.auto, true);

    const [pa, pb] = players('A', 'B');
    const g = new Game(new World(map), [{ setup: pa, human: 'ann' }, { setup: { ...pb, control: 'bot' }, human: null }], 'normal', 'normal', 1, 0);
    const unit = [...g.sim.state.blobs.values()].find((x) => x.owner === 0);
    assert.ok(unit);
    assert.equal(g.order('ann', { o: 'auto', blobs: [unit.id], on: true }), null);
    assert.equal(unit.auto, true);
    g.order('ann', { o: 'stop', blobs: [unit.id] });
    assert.equal(unit.auto, false);
  });
});
