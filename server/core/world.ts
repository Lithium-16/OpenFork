// The map as the simulation sees it: regions, neighbours and the per-region numbers from
// the rules (stack caps, supply capacity, capture times).
import type { GameMap, Neighbor, Region } from '../../shared/map.ts';
import { captureSeconds, stackCap, supplyCapacity, type Techs } from '../../shared/rules.ts';

export class World {
  readonly map: GameMap;
  readonly regions: Region[];
  /** Typical distance between neighbouring label points; one CROSS_SECONDS hop. */
  readonly hop: number;
  private readonly edges: Map<number, Neighbor>[];

  constructor(map: GameMap) {
    this.map = map;
    this.regions = map.regions;
    // Neighbours and coasts alike (a coast is never a river).
    this.edges = map.regions.map(
      (r) => new Map<number, Neighbor>([...r.neighbors.map((n) => [n.id, n] as const), ...(r.coast ?? []).map((c) => [c.id, { ...c, river: false }] as const)]),
    );
    // Land hops only: sea regions are much bigger and would slow every march.
    const d = map.regions.filter((r) => !r.sea).flatMap((r) => r.neighbors.map((n) => n.dist)).sort((a, b) => a - b);
    this.hop = d.length ? d[Math.floor(d.length / 2)] : 1;
  }

  /** The border or coast between two regions, if they touch. */
  edge(from: number, to: number): Neighbor | undefined {
    return this.edges[from]?.get(to);
  }

  isSea(id: number): boolean {
    return !!this.regions[id]?.sea;
  }

  neighbors(id: number): Neighbor[] {
    return this.regions[id].neighbors;
  }

  stackCap(id: number, city: number, fort: number): number {
    return stackCap(this.regions[id], city, fort);
  }

  supplyCapacity(id: number, city: number, techs: Techs = []): number {
    return supplyCapacity(this.regions[id], city, techs);
  }

  captureSeconds(id: number, fort: number, training: number, neutral = false, city = 0, capital = false): number {
    return captureSeconds(this.regions[id], fort, training, neutral, city, capital);
  }
}
