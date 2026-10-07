import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { decodeGrid, encodeGrid, type GameMap, WATER } from '../shared/map.ts';

describe('map grid encoding', () => {
  it('round-trips region ids above 255 and long runs', () => {
    const cells = new Uint16Array(70_000);
    cells.fill(WATER, 0, 1000);
    cells.fill(300, 1000, 1001);
    cells.fill(12, 1001, 66_000);
    cells.fill(65_000, 66_000);
    assert.deepEqual(decodeGrid(encodeGrid(cells), cells.length), cells);
  });

  for (const id of ['europe', 'asia']) {
    it(`the ${id} map decodes, and every region has pixels: land in the grid, sea in the sea grid`, () => {
      const map = load(id);
      const grid = decodeGrid(map.grid, map.width * map.height);
      const sea = decodeGrid(map.seaGrid, map.width * map.height);
      const land = new Set<number>();
      const seas = new Set<number>();
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] !== WATER) land.add(grid[i]);
        if (sea[i] !== WATER) seas.add(sea[i]);
        assert.ok(grid[i] === WATER || sea[i] === WATER, 'a pixel is land or sea, not both');
      }
      assert.equal(land.size, map.regions.filter((r) => !r.sea).length);
      assert.equal(seas.size, map.regions.filter((r) => r.sea).length);
      for (const id of seas) assert.ok(map.regions[id].sea);
      assert.ok(map.regions.length > 255, 'needs 16-bit ids');
    });

    it(`the ${id} map: coasts go both ways, land neighbours are land and sea neighbours are sea, and everything can be reached`, () => {
      const map = load(id);
      for (const r of map.regions) {
        for (const n of r.neighbors) assert.equal(!!map.regions[n.id].sea, !!r.sea, `${r.name} -> ${map.regions[n.id].name}`);
        for (const c of r.coast) {
          assert.notEqual(!!map.regions[c.id].sea, !!r.sea);
          assert.ok(map.regions[c.id].coast.some((b) => b.id === r.id));
        }
      }
      // Every region by land or sea from any other.
      const seen = new Set([0]);
      const queue = [0];
      for (let q = 0; q < queue.length; q++) {
        const r = map.regions[queue[q]];
        for (const n of [...r.neighbors, ...r.coast]) if (!seen.has(n.id)) seen.add(n.id), queue.push(n.id);
      }
      assert.equal(seen.size, map.regions.length);
      // Every playable country has a few regions, its capital among them.
      for (const c of map.countries.filter((x) => x.playable)) {
        assert.equal(map.regions[c.capital].country, c.id, c.name);
        assert.ok(map.regions.filter((r) => r.country === c.id).length >= 3, c.name);
      }
    });
  }

  it('Europe: Britain and the islands are there, reached only by sea', () => {
    const map = load('europe');
    const gb = map.countries.find((c) => c.id === 'GB');
    assert.ok(gb?.playable && map.regions[gb.capital].coast.length > 0);
    assert.ok(map.regions.some((r) => !r.sea && r.neighbors.length === 0 && r.coast.length > 0), 'an island');
  });

  it('Asia–Pacific: a naval theatre; Japan, Taiwan and the Philippines only by sea, Korea on the mainland', () => {
    const map = load('asia');
    const capital = (id: string) => map.countries.find((c) => c.id === id)?.capital as number;
    const onFoot = (from: number) => {
      const seen = new Set([from]);
      const queue = [from];
      for (let q = 0; q < queue.length; q++) for (const n of map.regions[queue[q]].neighbors) if (!seen.has(n.id)) seen.add(n.id), queue.push(n.id);
      return seen;
    };
    const mainland = onFoot(capital('CN'));
    for (const id of ['JP', 'TW', 'PH']) assert.ok(!mainland.has(capital(id)), id);
    for (const id of ['KR', 'KP', 'VN', 'TH', 'RU']) assert.ok(mainland.has(capital(id)), id);
    const sea = map.regions.filter((r) => r.sea).length;
    assert.ok(sea >= 0.3 * map.regions.length, `${sea} sea regions of ${map.regions.length}`);
    const count = (id: string) => map.regions.filter((r) => r.country === id).length;
    assert.ok(count('JP') >= count('CN'), 'Japan in as much detail as China');
  });
});

function load(id: string): GameMap {
  return JSON.parse(readFileSync(new URL(`../public/maps/${id}.json`, import.meta.url), 'utf8'));
}
