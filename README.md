# OpenFork

A real-time browser strategy game about fighting over provinces with movable unit tokens,
inspired by OpenFront but written from scratch. Friends play together in a private lobby,
and bots take the other countries. The rules are in **[DESIGN.md](DESIGN.md)**.

Status: first playable. Everyone starts at peace; bots go to war when attacked or when they
see a weak neighbour (by difficulty). You can play a war over Europe with Britain, Ireland and the big islands (348 land regions
from real provinces and 51 sea regions), or a naval war over the Asia–Pacific: Japan, the
Koreas, coastal China, Taiwan, the Philippines and Southeast Asia (281 land regions and 147
sea regions), with infantry, tanks, artillery and warships, ports
and troops shipped across the sea, forts, entrenchment, supply, storage and depots,
labs and research points,
a tech tree, production, and
defensive/easy/normal/hard bots, or pure PvP with no bots. Fog of war hides other countries' units outside your vision. Air and alliances come later.

## Run it

```bash
npm install
npm start          # serves http://localhost:8090 (same as `node server/main.ts`)
npm test           # rules, bots, lobbies
npm run typecheck
```

Requires Node 22.18+ (the server runs `.ts` files directly through Node's type stripping).
The server bundles the browser game (`client/` → `public/app.js`, not in git) every time it
starts, however it's started, so after `git pull` a restart is all it takes; run
`npm install` too when dependencies changed. If it can't build (esbuild missing), it says
so at startup when the bundle is out of date.
Set `PORT` and `HOST` to change where it listens.

Open the page, enter a name and **Create a private lobby**. **Copy invite link** and send it
to your friends, pick countries, and start. Bots fill the empty seats.

## Desktop app (Windows, offline)

**Get it:** <https://github.com/Lithium-16/OpenFork/releases/latest/download/OpenFork-Setup.exe>.
Run it and the game installs and opens: no admin rights, no internet needed to play. That
link always gives the newest version, so it's the one to send friends (the launcher's
**Share** button copies it). The app isn't code-signed, so Windows may say it protected
your PC: *More info*, then *Run anyway*.

- **Launcher:** Continue (the game you were playing, autosaved every 15 s and when you
  close or leave it), New game, Load a saved game, fullscreen, the saves folder
  (Documents\OpenFork) and Share.
- **Offline:** the app runs the same game server as online, on this computer only
  (`desktop/src/server.ts` in its own process), with a snapshot every tick since there's no
  network in between. Games are against bots, as solo games online.
- **Updates:** every change merged to `main` that touches the game builds a new release
  (`.github/workflows/desktop.yml`, versions `1.0.<run>`). The launcher checks for it on
  start and every hour, downloads it in the background and offers *Restart to update*
  (or installs it when the app is next closed). Pull requests build the installer too: it's
  under the run's artifacts, to try before merging.
- **Building it yourself:** `npm install` at the root, then in `desktop/`: `npm install`,
  `npm start` (run it), or `npm run dist` (the installer, into `desktop/release/`).
  The icon is drawn by `node desktop/make-icon.mjs`.

## Controls

| | |
|---|---|
| Left click / drag | select a unit or region / box-select your units (Shift adds) |
| Click a stack | expand it into its units, to pick single ones (click elsewhere closes it) |
| Double-click | a stack of yours: all of its units; elsewhere: all your units in that region |
| Right click | send the selected units to a region (they path there, attacking enemy troops from across the border and stepping into land to capture it; across the sea they board at your port and land on the far coast; warships go to sea regions and your ports) |
| Right drag, WASD, arrows | pan |
| Wheel | zoom |
| X / G / H | split in half / merge (any amounts, up to 100; not in a fight or below 25% strength) / halt the selected units; the unit panel splits off a batch or any number |
| A | **auto** for the selected land units: they take the nearest neutral or empty enemy land on their own (and weakly held enemy regions), only next to your supplied land; any order turns it off |
| C / Z | **front** / **battle plan** for the selected land units: click another country's land (for a plan, the region to push toward). A front holds your whole border with that country; a plan also attacks across it (once at war) where the odds are good, and holds the new line when its target falls. Click a front's badge to select its units; the unit panel switches Attack / Hold or dissolves it. Ordering a unit by hand takes it off its front |
| Del | disband the selected units (asks first; half the manpower of their strength back; not in a fight) |
| 1–9, -, =, P or the build dock (bottom) | placement mode (pointing at a building in the dock shows its cost, build time and what it does): farm, mine, oil well, market, lab, city (found or expand), fort, barracks, factory, road (-), depot (=), port (P, on a coast). Click one of your regions (roads: drag across regions); Shift places more, Esc / right click stops; a busy region queues it. Your regions show their slots as boxes (hollow green = free) |
| Q / E / R / F | queue infantry / tanks / artillery / warships at the selected region's barracks / factory / port |
| T / Tech button | research screen: the tech tree with its lines and progress (one tech at a time; the button shows progress too) |
| V | supply overlay: hubs, reach, cut-off regions, load per region |
| B | yield overlay: what each of your regions makes per second (grey while it's stopped) |
| Esc / Menu button | menu: surrender, back to the main menu (a bot plays your country on), and UI size (100/125/150%, as far as the window allows; remembered); Esc first clears a selection or placement |
| ? | show or hide the Controls box (open in your first game, folded to "? Keys" after that) |
| M / menu | sound on or off (remembered) |
| Menu: Effects | effects full or reduced (reduced drops the ambient water, clouds, smoke, traffic and the pennant flutter; it starts reduced when the system asks for less motion, and switches itself on a struggling machine) |
| Minimap (bottom right) | click or drag to move the view |
| Countries (top right) | click a country to declare war, or offer or accept peace |
| Space | back to your capital |

On phones: tap a unit, then tap a region to send it; drag to pan, pinch to zoom.

## Layout

```
shared/            used by client and server
  rules.ts         every gameplay number (tune here)
  map.ts           map format (region grid + region table)
  protocol.ts      every WebSocket message
server/
  core/            game logic: no sockets, no timers
    sim.ts         the rules: movement, battles, capture, supply, economy, production
    bot.ts         bots
    game.ts        one match: sim + bots + snapshots, bot stand-ins for dropped players
    game-server.ts sessions, private lobbies, starting games
    parse.ts       checks client messages
    ports.ts       what a host must provide (transport, auth, clock)
  adapters/        guest identities in memory
  main.ts          standalone HTTP + WebSocket host
client/            browser game (bundled to public/app.js by esbuild)
public/            index.html, style.css, maps/
scripts/
  build-map.ts     builds a map (public/maps/<id>.*) from open data: npm run build:map [europe|asia]
  map/             the theatres: what each map is made of (europe.ts, asia.ts)
  preview-map.ts   debug picture of a built map
  bot-match.ts     a headless all-bot match, for balancing
test/
```

The server is authoritative: it runs the simulation at 10 ticks/s and sends each client a
snapshot 5 times a second (plus its own production queues). Clients only send orders.

## Hosting it elsewhere (e.g. as a Kernel module)

`server/core` has no I/O. Implement the ports in [`server/core/ports.ts`](server/core/ports.ts)
and drive `GameServer`:

```ts
const game = new GameServer({ transport, auth, clock: { now: () => Date.now() }, maps, matches });
onConnect(id)        -> game.handleConnect(id)
onMessage(id, json)  -> game.handleMessage(id, JSON.parse(json))
onClose(id)          -> game.handleDisconnect(id)
setInterval(() => game.tick(), TICK_MS);
```

`matches.recordMatch(result)` is told about every finished match.

## Map data

`public/maps/` is generated and committed; `npm run build:map` rebuilds the Europe map and
`npm run build:map asia` the Asia–Pacific one (each downloads its source data into `.cache/`;
about 330 MB for Europe). A new theatre is a file in `scripts/map/` listed in `THEATRES`. Sources:

- Borders, rivers, lakes, places and land cover: [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen), built from
  SRTM, GMTED2010 and ETOPO1 (public domain) and EU-DEM (produced using Copernicus data and
  information funded by the European Union).

## Font

[Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) by the Pixelify Sans Project Authors,
under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`).

## Known limits / next steps

- Balance is first-pass. Bot-only matches (normal and hard) end in 19–36 minutes, by
  domination or the last capital; easy bots never start wars, so an all-easy match only ends
  by someone conquering. Tune `shared/rules.ts` from real games (`node scripts/bot-match.ts
  [seed] [countries] [difficulty]`).
- Guest identities live in memory: a server restart forgets who was who (and running games).
- Not built yet: air, alliances, procedural maps, the Kernel module.
