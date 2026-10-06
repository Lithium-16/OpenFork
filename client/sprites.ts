// Pixel art: every graphic on the map and in the HUD is a tiny bitmap, built once into a
// canvas and drawn at a whole-number scale with smoothing off, so it stays crisp.
//
// Bitmaps are string art; each character picks a colour from the palette passed in
// ('.' is transparent). 'F' is the owner colour for recoloured sprites.

export const INK = '#0b0f13';

const BASE: Record<string, string> = {
  O: INK,
  W: '#f2f5f7',
  G: '#9aa7b1', // stone grey
  g: '#5d6973',
  Y: '#f1c232', // gold
  y: '#a8801a',
  R: '#d9534f',
  B: '#6fa8dc',
  b: '#3d6e99',
  T: '#8a9a5b', // canvas olive
  t: '#5c6a35',
  K: '#2b2f33', // oil black
  C: '#4fd1ff',
};

export type Sprite = HTMLCanvasElement;

const cache = new Map<string, Sprite>();

/** A sprite from string art. */
export function art(rows: string[], colors: Record<string, string> = {}): Sprite {
  const pal = { ...BASE, ...colors };
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const k = row[x];
      if (k === '.' || k === ' ') continue;
      ctx.fillStyle = pal[k] ?? '#ff00ff';
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

function cached(key: string, make: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) {
    s = make();
    cache.set(key, s);
  }
  return s;
}

/** Draws a sprite with its top-left at whole pixels, `scale` screen pixels per art pixel. */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, scale: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s, Math.round(x), Math.round(y), s.width * scale, s.height * scale);
}

/** Draws a sprite centred on (x, y). */
export function blitCentred(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, scale: number): void {
  blit(ctx, s, x - (s.width * scale) / 2, y - (s.height * scale) / 2, scale);
}

// -- colours ----------------------------------------------------------------------------------

export function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// -- NATO unit frames -------------------------------------------------------------------------

export const FRAME_W = 17;
export const FRAME_H = 15; // 3 rows of echelon marks, then a 17×12 frame

/** Echelon marks over the frame, by size: • •• | || (squad .. battalion, loosely). */
function echelon(size: number, max: number): string[] {
  const r = size / max;
  if (r <= 0.25) return ['........O........', '.......OWO.......', '........O........'];
  if (r <= 0.5) return ['......O...O......', '.....OWO.OWO.....', '......O...O......'];
  if (r <= 0.75) return ['.......OWO.......', '.......OWO.......', '.......OWO.......'];
  return ['.....OWO.OWO.....', '.....OWO.OWO.....', '.....OWO.OWO.....'];
}

/**
 * A NATO unit symbol: a rectangle in the owner's colour with a dark outline, a lighter top
 * edge, and the branch mark inside: infantry ✕, armour an oval, artillery a filled dot.
 */
export function unitFrame(type: 'infantry' | 'tank' | 'artillery' | 'warship', size: number, max: number, color: string): Sprite {
  const marks = echelon(size, max);
  const key = `unit:${type}:${marks[1]}:${color}`;
  return cached(key, () => {
    const W = FRAME_W;
    const H = 12;
    const grid: string[][] = Array.from({ length: H }, () => new Array<string>(W).fill('F'));
    for (let x = 0; x < W; x++) {
      grid[0][x] = 'O';
      grid[H - 1][x] = 'O';
      grid[1][x] = x > 0 && x < W - 1 ? 'L' : 'O';
      grid[H - 2][x] = x > 0 && x < W - 1 ? 'D' : 'O';
    }
    for (let y = 0; y < H; y++) {
      grid[y][0] = 'O';
      grid[y][W - 1] = 'O';
    }
    const ix0 = 2;
    const iy0 = 2;
    const iw = W - 4;
    const ih = H - 4;
    if (type === 'infantry') {
      // ✕ from corner to corner of the inner box.
      for (let i = 0; i < iw; i++) {
        const y = iy0 + Math.round((i * (ih - 1)) / (iw - 1));
        grid[y][ix0 + i] = 'S';
        grid[iy0 + ih - 1 - (y - iy0)][ix0 + i] = 'S';
      }
    } else if (type === 'artillery') {
      // A filled dot, 5×5, centred.
      const dot = ['.SSS.', 'SSSSS', 'SSSSS', 'SSSSS', '.SSS.'];
      const ox = Math.floor((W - 5) / 2);
      const oy = Math.floor((H - 5) / 2);
      dot.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === 'S') grid[oy + y][ox + x] = 'S';
      });
    } else if (type === 'warship') {
      // A hull with a funnel, 11×5, centred.
      const hull = ['....SS.....', '..SSSSSS...', 'SSSSSSSSSSS', '.SSSSSSSSS.', '..SSSSSSS..'];
      const ox = Math.floor((W - 11) / 2);
      const oy = Math.floor((H - 5) / 2);
      hull.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === 'S') grid[oy + y][ox + x] = 'S';
      });
    } else {
      // An oval (track outline), 9×5, centred.
      const oval = ['..SSSSS..', '.S.....S.', 'S.......S', '.S.....S.', '..SSSSS..'];
      const ox = Math.floor((W - 9) / 2);
      const oy = Math.floor((H - 5) / 2);
      oval.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === 'S') grid[oy + y][ox + x] = 'S';
      });
    }
    const rows = [...marks, ...grid.map((r) => r.join(''))];
    return art(rows, { F: color, L: shade(color, 1.35), D: shade(color, 0.7), S: INK });
  });
}

// -- map icons --------------------------------------------------------------------------------

export const ICONS = {
  capital: art(
    [
      '....O....',
      '...OYO...',
      '...OYO...',
      'OOOOYOOOO',
      'OYYYYYYYO',
      '.OYYYYYO.',
      '..OYYYO..',
      '.OYYOYYO.',
      '.OYO.OYO.',
      '.OO...OO.',
    ],
  ),
  city: art(
    [
      '......O......',
      '......Y......',
      '.....OLO.....',
      '....OLGGO....',
      '..O.OLYGO.O..',
      '.OROOLGGOORO.',
      'ORRROLYGORRRO',
      'OLYLOLGGOLYLO',
      'OLLLOLYGOLLLO',
      'OLYLOLGGOLYLO',
      'OOOOOOOOOOOOO',
    ],
    { R: '#b5653a', L: '#c9d2d9' },
  ),
  farm: art(
    ['OOOOOOOOO', 'OYYYYYYYO', 'OTTTTTTTO', 'OYYYYYYYO', 'OTTTTTTTO', 'OYYYYYYYO', 'OOOOOOOOO'],
    { Y: '#d6b64a', T: '#7f9c43' },
  ),
  /** Mine: a cart heaped with ore. */
  mine: art(
    [
      '..OOO.OO.',
      '.OrsrOsrO',
      'OOOOOOOOO',
      'OGGGGGGGO',
      '.OGgGgGO.',
      '.OGGGGGO.',
      '.OOOOOOO.',
      '..OO.OO..',
    ],
    { r: '#8c5a3c', s: '#b08a6a' },
  ),
  /** Oil well: a steel derrick over a pool of oil. */
  well: art(
    [
      '....O....',
      '...OGO...',
      '...OGO...',
      '..OGOGO..',
      '..OGOGO..',
      '.OGGGGGO.',
      '.OGO.OGO.',
      'OGO...OGO',
      'OKKKKKKKO',
      'OOOOOOOOO',
    ],
    { K: '#2b2f33' },
  ),
  market: art(['OOOOOOOOO', 'ORWRWRWRO', 'OOOOOOOOO', '.OWWWWWO.', '.OWOOOWO.', '.OWOYOWO.', '.OOOOOOO.']),
  road: art(
    ['...OyO...', '...OyO...', '..OyWyO..', '..OyyyO..', '.OyyWyyO.', '.OyyyyyO.', 'OyyyWyyyO', 'OOOOOOOOO'],
    { y: '#b59a6a' },
  ),
  lab: art(
    [
      '...OOO...',
      '..OWWWO..',
      '.OWBBBWO.',
      'OOOOOOOOO',
      'OGGGGGGGO',
      'OGBOOOBGO',
      'OGGOyOGGO',
      'OOOOOOOOO',
    ],
    { y: '#c19a5b' },
  ),
  /** Port: a white anchor, outlined (reads on land and sea alike). */
  port: art(
    [
      '...OOO...',
      '...OWO...',
      '.OOOWOOO.',
      '.OWWWWWO.',
      '.OOOWOOO.',
      'OO.OWO.OO',
      'OWOOWOOWO',
      '.OWWWWWO.',
      '..OOOOO..',
    ],
    { W: '#e3edf5' },
  ),
  /** Troops aboard transports: a little boat on the unit's corner. */
  afloat: art(['....OO.....', '....OWO....', 'OOOOOWOOOOO', 'OWWWWWWWWWO', '.OBBBBBBBO.', '..OOOOOOO..'], { B: '#3f6f9e' }),
  depot: art(
    [
      '...OOO...',
      '..OrrrO..',
      '.OrrrrrO.',
      'OrrrrrrrO',
      'OOOOOOOOO',
      'OGGOOOGGO',
      'OGGOyOGGO',
      'OGGOyOGGO',
      'OOOOOOOOO',
    ],
    { r: '#b5653a', y: '#c19a5b' },
  ),
  /** Units waiting to go on: an hourglass. */
  hourglass: art(['OOOOO', 'OYYYO', '.OYO.', '..O..', '.OYO.', 'OYYYO', 'OOOOO'], { Y: '#ffd166' }),
  /** A city nobody holds yet: a flag on a pole, white (unclaimed). */
  flag: art(
    [
      'OOO......',
      'OgOOO....',
      'OgOWWOO..',
      'OgOWWWWOO',
      'OgOWWWWWO',
      'OgOWWWOO.',
      'OgOWOO...',
      'OgOO.....',
      'OgO......',
      'OgO......',
      'OOO......',
    ],
    { W: '#e6edf2', g: '#9aa7b1' },
  ),
  /** Coastal battery: a big gun on a concrete emplacement, over the waves. */
  /** Coastal battery: a concrete bunker with firing slits, its long gun raised seaward. */
  battery: art(
    [
      '.........OO',
      '.......OOWO',
      '.....OOGOO.',
      '...OOGGO...',
      '..OgggggO..',
      'OOOOOOOOOOO',
      'OcccccccccO',
      'OcOOcccOOcO',
      'OOOOOOOOOOO',
    ],
    { c: '#b9bcb4', W: '#e3edf5' },
  ),
  fort: art([
    'OOO.OOO.OOO',
    'OGO.OGO.OGO',
    'OGOOOGOOOGO',
    'OGGGGGGGGGO',
    'OGgGGGGGgGO',
    'OGGGGGGGGGO',
    'OGGGOOOGGGO',
    'OGGGOyOGGGO',
    'OOOOOOOOOOO',
  ]),
  barracks: art([
    '....O....',
    '...OTO...',
    '..OTTTO..',
    '.OTTtTTO.',
    'OTTtOtTTO',
    'OTtO.OtTO',
    'OTtO.OtTO',
    'OOOOOOOOO',
  ]),
  factory: art([
    'OOO......',
    'OgO......',
    'OgO.O..O.',
    'OgOOGOOGO',
    'OgGGGGGGO',
    'OGYGGYGGO',
    'OGGGGGGGO',
    'OOOOOOOOO',
  ]),
  crate: art(
    [
      'OOOOOOOOO',
      'OyYYYYYyO',
      'OYyYYYyYO',
      'OYYyYyYYO',
      'OYYYyYYYO',
      'OYYyYyYYO',
      'OYyYYYyYO',
      'OyYYYYYyO',
      'OOOOOOOOO',
    ],
    { Y: '#c19a5b', y: '#6e5230' },
  ),
  swords: [
    art([
      'W.......W',
      'WW.....WW',
      '.WW...WW.',
      '..WW.WW..',
      '...WWW...',
      '..YYWYY..',
      '.YO...OY.',
      'YO.....OY',
      'O.......O',
    ]),
    art(
      [
        'W.......W',
        'WW.....WW',
        '.WW...WW.',
        '..WW.WW..',
        '...WWW...',
        '..YYWYY..',
        '.YO...OY.',
        'YO.....OY',
        'O.......O',
      ],
      { W: '#ff5a5a' },
    ),
  ],
};

// -- map art ----------------------------------------------------------------------------------
// Drawn into the map itself, one sprite pixel per map pixel (3 km), in muted colours that sit
// in the terrain: towns, fields, mines, derricks, market halls, roads.

const LAND = {
  R: '#9a5a43', // roof
  r: '#7d5444',
  H: '#d9cdb3', // wall
  d: '#5a4a3c',
  S: '#a7a9a6', // stone
  s: '#6f7372',
  Y: '#cdb35c', // wheat
  T: '#86a04a', // green crop
  K: '#3b3b3b',
  k: '#8c8173', // spoil
  A: '#b5483e', // awning
};

/** City buildings: small, each type its own colour so they tell apart without standing out. */
const CITY = {
  o: '#262b31', // outline
  R: '#b0533a', // roof tiles
  r: '#7d4a3a',
  H: '#eadfc6', // house wall
  d: '#3a3226', // door
  W: '#4a6276', // window
  w: '#f0d77a', // lit window
  B: '#e2d3b0', // apartment concrete (warm sand)
  f: '#7d7468', // flat roof
  S: '#5f6a74', // office steel
  L: '#c4e4ef', // office window band
  G: '#6fb0e0', // tower glass
  g: '#3d6f99', // mullion
  Y: '#f1c232', // spire
};

export const MAP_ART = {
  /** Houses (3×3): the edge of every town. */
  houses: [art(['RRR', 'HHH', 'HdH'], CITY), art(['rrr', 'HHH', 'HHd'], CITY), art(['.R.', 'RRR', 'HdH'], CITY)],
  /** Apartment blocks (4×4): sand walls, windows, a flat roof. From level 2. */
  blocks: [art(['ffff', 'BWBW', 'BBBB', 'BWBd'], CITY), art(['ffff', 'WBWB', 'BBBB', 'WBwB'], CITY)],
  /** Office towers (3×6): dark steel with light window bands. From level 3. */
  office: [art(['SSS', 'LLL', 'SSS', 'LLL', 'SSS', 'LdL'], CITY)],
  /** Skyscrapers (3×9): blue glass. From level 4. */
  skyscraper: [art(['.g.', 'GgG', 'GwG', 'GgG', 'GgG', 'GwG', 'GgG', 'GgG', 'GdG'], CITY)],
  /** The landmark tower (3×12), gold spire, at the heart of a level 5 city. */
  landmark: art(['.Y.', '.Y.', '.g.', 'GgG', 'GwG', 'GgG', 'GgG', 'GwG', 'GgG', 'GgG', 'GwG', 'GdG'], CITY),
  farm: art(['YYYYYY', 'TTTTTT', 'YYYYYY', 'TTTTTT'], LAND),
  mine: art(['.KKK.', '.K.K.', 'KKKKK', 'kkkkk'], LAND),
  well: art(['.K.', '.K.', 'KKK', 'K.K', 'KKK'], LAND),
  market: art(['AHAH', 'AHAH', 'HHHH', 'HdHH'], LAND),
  lab: art(['.SS.', 'SSSS', 'HHHH', 'HdHH'], LAND),
  /** A port's warehouse on the quay, and a boat moored at the end of its pier. */
  warehouse: art(['.rrr.', 'rrrrr', 'HdHdH'], LAND),
  boat: art(['..H..', '..HH.', '..HHH', 'ddddd', '.ddd.'], LAND),
  /** Construction: scaffolding with a crane whose arm swings between two frames. */
  scaffold: [
    art(['KKKKK.', '..K...', 'Y.K...', 'YYKYY.', 'Y.K.Y.', 'YYYYY.'], { ...LAND, Y: '#d9a441' }),
    art(['.KKKKK', '...K..', 'Y..K..', 'YYYKY.', 'Y..KY.', 'YYYYY.'], { ...LAND, Y: '#d9a441' }),
  ],
};
export const ROAD_COLOR = '#c9b38a';
export const ROAD_SHADE = '#6e5f48';
export const PIER_COLOR = '#8a6a48';
export const PIER_SHADE = '#5a4632';

// -- HUD icons ----------------------------------------------------------------------------------

export const HUD = {
  money: art([
    '..OOOOO..',
    '.OYYYYYO.',
    'OYYyyyYYO',
    'OYyYYYYYO',
    'OYYyyyYYO',
    'OYYYYYyYO',
    'OYYyyyYYO',
    '.OYYYYYO.',
    '..OOOOO..',
  ]),
  manpower: art([
    '..OOOOO..',
    '.OTTTTTO.',
    'OTTTTTTTO',
    'OOOOOOOOO',
    '..OWWWO..',
    '..OWWWO..',
    '.OTTTTTO.',
    'OTTTTTTTO',
    'OOOOOOOOO',
  ]),
  steel: art([
    'OOOOOOOOO',
    'OGGGGGGGO',
    'OOOOGOOOO',
    '...OGO...',
    '...OGO...',
    '...OGO...',
    'OOOOGOOOO',
    'OGGGGGGGO',
    'OOOOOOOOO',
  ]),
  research: art(
    [
      '..OOOOO..',
      '...OWO...',
      '...OWO...',
      '..OWWWO..',
      '.OWBBBWO.',
      'OWBBBBBWO',
      'OBBCBBBBO',
      'OBBBBCBBO',
      '.OOOOOOO.',
    ],
    { B: '#7fd0c4', C: '#e8fff9' },
  ),
  oil: art(
    [
      '....O....',
      '...OKO...',
      '..OKKKO..',
      '.OKKKKKO.',
      'OKKKKKKKO',
      'OKWKKKKKO',
      'OKKWKKKKO',
      '.OKKKKKO.',
      '..OOOOO..',
    ],
    { K: '#3a3f45' },
  ),
};

/** A sprite as an image URL, for the DOM. */
export function spriteUrl(s: Sprite, scale = 2): string {
  const c = document.createElement('canvas');
  c.width = s.width * scale;
  c.height = s.height * scale;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s, 0, 0, c.width, c.height);
  return c.toDataURL();
}

const urls = new Map<string, string>();

/** HUD icons as image URLs. */
export function hudIcon(name: keyof typeof HUD, scale = 2): string {
  const key = `${name}:${scale}`;
  let url = urls.get(key);
  if (!url) {
    url = spriteUrl(HUD[name], scale);
    urls.set(key, url);
  }
  return url;
}

// -- roman numerals ---------------------------------------------------------------------------

const ROMAN_GLYPHS: Record<string, string[]> = {
  I: ['#', '#', '#', '#'],
  V: ['#.#', '#.#', '#.#', '.#.'],
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** A level (1-5) as roman numerals, as on the map: "II". */
export function roman(level: number): string {
  return ROMAN[level] ?? String(level);
}

/** A level (1-5) as a roman numeral sprite: white on a dark outline. */
export function romanSprite(level: number): Sprite {
  return cached(`roman:${level}`, () => {
    const text = ROMAN[level] ?? String(level);
    const glyphs = [...text].map((ch) => ROMAN_GLYPHS[ch] ?? ROMAN_GLYPHS.I);
    const w = glyphs.reduce((sum, g) => sum + g[0].length, 0) + glyphs.length - 1;
    const h = glyphs[0].length;
    const ink: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));
    let x = 0;
    for (const g of glyphs) {
      g.forEach((row, y) => [...row].forEach((ch, dx) => (ink[y][x + dx] ||= ch === '#')));
      x += g[0].length + 1;
    }
    // One pixel of outline all round.
    const rows = Array.from({ length: h + 2 }, (_, y) =>
      Array.from({ length: w + 2 }, (_, x) => {
        if (ink[y - 1]?.[x - 1]) return 'W';
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ink[y - 1 + dy]?.[x - 1 + dx]) return 'O';
        return '.';
      }).join(''),
    );
    return art(rows);
  });
}

// -- digits -------------------------------------------------------------------------------------

/** Classic 3×5 pixel digits: unambiguous at any scale (a font's 2 can look like an 8). */
const DIGITS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
};

/** Width in screen pixels of a number drawn with pixelDigits. */
export function digitsWidth(text: string, scale: number): number {
  return text.length * 4 * scale - scale;
}

/** Draws a number in 3×5 pixel digits, centred on (x, y). */
export function pixelDigits(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string): void {
  const x0 = Math.round(x - digitsWidth(text, scale) / 2);
  const y0 = Math.round(y - (5 * scale) / 2);
  ctx.fillStyle = color;
  [...text].forEach((ch, i) => {
    const rows = DIGITS[ch];
    if (!rows) return;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < 3; rx++) {
        if (row[rx] === '#') ctx.fillRect(x0 + (i * 4 + rx) * scale, y0 + ry * scale, scale, scale);
      }
    });
  });
}
