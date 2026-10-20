import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../server/core/game.ts';
import { World } from '../server/core/world.ts';
import { chain, makeMap, players } from './helpers.ts';

/** A (person) at 0..2, B (bot) far away at 7..9, on a chain of ten regions. */
function game() {
  const map = makeMap(
    Array.from({ length: 10 }, (_, i) => ({ country: i < 5 ? 'A' : 'B' })),
    chain(10),
    [
      { id: 'A', capital: 0 },
      { id: 'B', capital: 9 },
    ],
  );
  const [a, b] = players('A', 'B');
  const g = new Game(new World(map), [{ setup: a, human: 'ann' }, { setup: { ...b, control: 'bot' }, human: null }], 'normal', 'normal', 1, 0);
  const s = g.sim;
  s.state.blobs.clear();
  s.state.regions.forEach((r, i) => (r.owner = i <= 2 ? 0 : i >= 7 ? 1 : -1));
  return g;
}

describe('fog of war', () => {
  it('sees your land and units plus one region around them', () => {
    const g = game();
    g.sim.spawn(0, 'infantry', 4);
    assert.deepEqual([...g.visionOf(0)].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5]);
  });

  it('hides units, fights, new units and captures out of sight; spectators see all', () => {
    const g = game();
    const s = g.sim;
    s.spawn(1, 'infantry', 8); // out of sight
    const near = s.spawn(1, 'infantry', 3); // next to A's land
    s.state.regions[6].capture = { by: 1, progress: 0.5 };
    const shared = g.sharedSnapshot([
      { kind: 'battle', region: 8, sides: [1] },
      { kind: 'battle', region: 3, sides: [1] },
      { kind: 'produced', region: 8, owner: 1, type: 'infantry' },
    ]);
    const mine = g.viewFor(shared, 0);
    assert.deepEqual(
      mine.blobs.map((b) => b[0]),
      [near.id],
    );
    assert.deepEqual(
      mine.events.map((e) => (e.kind === 'battle' || e.kind === 'produced' ? e.region : -1)),
      [3],
    );
    assert.equal(mine.regions[6][4], -1, 'a capture out of sight is hidden');
    assert.equal(mine.regions[6][0], shared.regions[6][0], 'owners stay visible');
    const watcher = g.viewFor(shared, null);
    assert.equal(watcher.blobs.length, 2);
    assert.equal(watcher.events.length, 3);
  });
});
