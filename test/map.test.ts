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

  it('the Europe map decodes, and every region has pixels: land in the grid, sea in the sea grid', () => {
    const map: GameMap = JSON.parse(readFileSync(new URL('../public/maps/europe.json', import.meta.url), 'utf8'));
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

  it('coasts go both ways, land neighbours are land and sea neighbours are sea', () => {
    const map: GameMap = JSON.parse(readFileSync(new URL('../public/maps/europe.json', import.meta.url), 'utf8'));
    for (const r of map.regions) {
      for (const n of r.neighbors) assert.equal(!!map.regions[n.id].sea, !!r.sea, `${r.name} -> ${map.regions[n.id].name}`);
      for (const c of r.coast) {
        assert.notEqual(!!map.regions[c.id].sea, !!r.sea);
        assert.ok(map.regions[c.id].coast.some((b) => b.id === r.id));
      }
    }
    // Britain and the islands are there, reached only by sea.
    const gb = map.countries.find((c) => c.id === 'GB');
    assert.ok(gb?.playable && map.regions[gb.capital].coast.length > 0);
    assert.ok(map.regions.some((r) => !r.sea && r.neighbors.length === 0 && r.coast.length > 0), 'an island');
  });
});
