// What goes on the Asia–Pacific map: East and Southeast Asia from Myanmar to Japan, Manchuria
// and the Russian Far East down to Java, with the seas between them (the Sea of Japan, the
// Yellow and East China Seas, the South China Sea, the Philippine Sea, the Java Sea) and the
// island chains that hold them: Japan, Taiwan, the Philippines, Borneo, Okinawa, Guam.
import type { Theatre } from './theatre.ts';

/** Countries whose provinces are on the map (ISO 3166-1 alpha-2). */
const INCLUDE = new Set('JP KR KP CN TW HK MO PH VN LA KH TH MY SG BN ID TL RU GU'.split(' '));

/** China without its far west (Xinjiang, Tibet, Qinghai): the map is about the coast. */
const CHINA_DROP = new Set(['Xinjiang', 'Xizang', 'Qinghai']);
const CHINA_MIN_LON = 105;
/** Western New Guinea is left off: the map is about the seas around Japan and China. */
const INDONESIA_MAX_LON = 134;
/** Of Russia, only the Far East on the Pacific. */
const RUSSIA_KEEP = new Set(['Amur', 'Yevrey', 'Khabarovsk', "Primor'ye", 'Sakhalin']);
/** Nothing north of this (the Okhotsk coast and north Sakhalin). */
const MAX_LAT = 54;

export const asia: Theatre = {
  id: 'asia',
  name: 'Asia–Pacific',
  centre: [120, 22],
  window: { x: -3600, y: 4000, width: 7200, height: 8300 },
  km: 4.5,
  targetRegions: 300,
  // Japan, the Koreas, Taiwan and the Philippines in finer detail; China's interior coarser.
  regionWeight: { JP: 2.6, KR: 1.8, KP: 1.5, TW: 3, PH: 1.6, CN: 0.45, ID: 0.75, RU: 0.7 },
  // China's million-people cities would make most of its regions towns: count its places at
  // two fifths, so it starts strong but not three times as rich as Japan. Japan's
  // half-million cities (Sendai, Hiroshima, Niigata...) count as towns.
  popScale: { CN: 0.4, JP: 1.4 },
  // A naval theatre: more, smaller sea regions, reaching further out.
  seaAreaFactor: 2.5,
  // About 100,000 km² each: some 150 sea regions.
  seaRegionPx: 4800,
  seaReach: 100,
  seaMinPx: 600,
  seaMaxWestLon: Infinity,
  include: INCLUDE,
  partOf: { HK: 'CN', MO: 'CN', SG: 'MY' },
  keepProvince: (iso, name) => {
    if (iso === 'CN' && CHINA_DROP.has(name)) return false;
    if (iso === 'RU' && !RUSSIA_KEEP.has(name)) return false;
    return true;
  },
  keepPixel: (iso, lon, lat) => lat <= MAX_LAT && !(iso === 'CN' && lon < CHINA_MIN_LON) && !(iso === 'ID' && lon > INDONESIA_MAX_LON),
  // About 2400 km² and up.
  islandMinPx: 120,
  keepIslands: [
    ['Okinawa', 127.85, 26.45],
    ['Jeju', 126.55, 33.38],
    ['Guam', 144.79, 13.44],
    ['Tsushima', 129.32, 34.42],
  ],
  keepBox: { minLon: 96, maxLon: 150, minLat: -12, maxLat: 55 },
  farmlandMaxLat: 50,
  minPlayableRegions: 3,
  playable: [
    { id: 'JP', name: 'Japan', capital: [139.69, 35.69] },
    { id: 'KR', name: 'South Korea', capital: [126.98, 37.57] },
    { id: 'KP', name: 'North Korea', capital: [125.75, 39.03] },
    { id: 'CN', name: 'China', capital: [116.4, 39.9] },
    { id: 'TW', name: 'Taiwan', capital: [121.56, 25.04] },
    { id: 'PH', name: 'Philippines', capital: [120.98, 14.6] },
    { id: 'VN', name: 'Vietnam', capital: [105.85, 21.03] },
    { id: 'TH', name: 'Thailand', capital: [100.5, 13.75] },
    { id: 'MY', name: 'Malaysia', capital: [101.69, 3.14] },
    { id: 'ID', name: 'Indonesia', capital: [106.85, -6.21] },
    { id: 'RU', name: 'Russia', capital: [131.89, 43.12] },
  ],
  industry: [
    ['Kanto', 139.7, 35.7],
    ['Osaka', 135.5, 34.69],
    ['Nagoya', 136.9, 35.18],
    ['Kitakyushu', 130.88, 33.88],
    ['Hiroshima', 132.46, 34.4],
    ['Seoul-Incheon', 126.7, 37.47],
    ['Ulsan-Busan', 129.3, 35.4],
    ['Pyongyang', 125.75, 39.03],
    ['Hamhung', 127.54, 39.92],
    ['Shanghai', 121.47, 31.23],
    ['Tianjin', 117.2, 39.12],
    ['Shenyang-Anshan', 123.43, 41.8],
    ['Harbin', 126.63, 45.75],
    ['Wuhan', 114.3, 30.59],
    ['Guangzhou', 113.26, 23.13],
    ['Chongqing', 106.55, 29.56],
    ['Taiyuan', 112.55, 37.87],
    ['Kaohsiung', 120.3, 22.62],
    ['Haiphong', 106.68, 20.86],
    ['Bangkok', 100.5, 13.75],
    ['Surabaya', 112.75, -7.25],
    ['Manila', 120.98, 14.6],
    ['Vladivostok', 131.89, 43.12],
  ],
  // Japan, Korea and Taiwan had little oil, but a navy needs some: their small fields count.
  oil: [
    ['Niigata', 138.9, 37.9],
    ['Akita', 140.1, 39.7],
    ['Miaoli', 120.82, 24.56],
    ['Pohang', 129.36, 36.02],
    ['Palawan', 118.74, 9.74],
    ['Daqing', 125.0, 46.6],
    ['Shengli', 118.5, 37.45],
    ['Liaohe', 122.07, 41.13],
    ['Sakhalin', 142.9, 52.9],
    ['Seria (Brunei)', 114.32, 4.6],
    ['Miri', 114.0, 4.39],
    ['Palembang', 104.75, -2.98],
    ['Balikpapan', 116.83, -1.24],
    ['Riau (Duri)', 101.2, 1.25],
    ['Vung Tau', 107.08, 10.35],
  ],
  elevationZoom: 6,
  attribution:
    'Borders, rivers, lakes and places: Natural Earth (public domain). Land cover: Natural Earth II (public domain). ' +
    'Elevation: AWS Terrain Tiles (Mapzen/Tilezen) from SRTM, GMTED2010 and ETOPO1.',
};
