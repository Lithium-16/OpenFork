// What a map ("theatre") is made of: which countries and provinces, how the land is cropped,
// its scale and region count, who's playable, and where industry and oil are. The builder
// (scripts/build-map.ts) is the same for every theatre.

export interface Theatre {
  id: string;
  name: string;
  /** Centre of the equal-area projection (lon, lat). */
  centre: [number, number];
  /** The window projected before cropping to the land: x, y of its top-left and its size, km. */
  window: { x: number; y: number; width: number; height: number };
  /** km per pixel. */
  km: number;
  /** About this many land regions. */
  targetRegions: number;
  /** Open sea is split into regions about this many times a land region's median area... */
  seaAreaFactor: number;
  /** ...or about this many pixels each, when set. */
  seaRegionPx?: number;
  /** Sea farther than this (px) from land in play is left out. */
  seaReach: number;
  /** Bodies of water smaller than this (px) aren't sea regions. */
  seaMinPx: number;
  /** A body of water whose westernmost pixel is east of this longitude is left out (the
   * Caspian, for Europe); Infinity keeps all. */
  seaMaxWestLon: number;
  /** Countries whose provinces are on the map (ISO 3166-1 alpha-2). */
  include: Set<string>;
  /** Provinces of these counted as those of another (Hong Kong as China's). */
  partOf?: Record<string, string>;
  /** Keep this province? (by country, name and its Natural Earth properties) */
  keepProvince(iso: string, name: string, props: Record<string, unknown>): boolean;
  /** Keep this pixel of a province? */
  keepPixel(iso: string, lon: number, lat: number): boolean;
  /** Islands are kept from this many pixels up. */
  islandMinPx: number;
  /** Smaller islands kept anyway: any landmass containing one of these points (lon, lat). */
  keepIslands: Array<[string, number, number]>;
  /** Land whose middle is outside this box is left off. */
  keepBox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  /** Plains regions south of this latitude can be farmland. */
  farmlandMaxLat: number;
  /** More (above 1) or fewer (below) regions for a country than its area alone gives; with
   * this set, a region counts as too small to stand alone against its own country's average
   * (not the whole map's), so a country given small regions keeps them. */
  regionWeight?: Record<string, number>;
  /** A country's places count as this share of their population when deciding towns (a
   * region is a town from a million people): fewer, smaller towns for a very populous country,
   * so it doesn't start out far richer than everyone else. */
  popScale?: Record<string, number>;
  /** Playable countries get at least this many regions (one region is one capture from
   * being knocked out). */
  minPlayableRegions: number;
  /** Start countries and their capitals (lon, lat). */
  playable: Array<{ id: string; name: string; capital: [number, number] }>;
  /** The region containing each point gets the industry trait. */
  industry: Array<[string, number, number]>;
  /** The region containing each point gets the oil trait. */
  oil: Array<[string, number, number]>;
  /** Elevation tile zoom. */
  elevationZoom: number;
  attribution: string;
}
