# OpenFork: game design

OpenFork is a browser strategy game inspired by OpenFront and written from scratch. Instead of
free pixel borders and a troop flood, it has **provinces you fight over with movable unit
tokens**, and the focus is on **defense**: forts, digging in, slow enemy ground and supply.
It's played with friends, with bots filling the empty countries.

The numbers in "Starting tunables" are first guesses for playtesting; they all live in
`shared/rules.ts`.

## 1. Match
- Real-time and continuous. Target length is 20–40 min (bot-only matches end in 19–36). No time limit. A game with one person
  in it (the rest bots) can be **paused** (P; the menu pauses it while open); games with more
  people can't.
- A one-person game can be **saved to a file** (Menu: Save game) and **loaded** from the main
  screen (Load a saved game): it opens where it was, paused, with you in your country again.
  A save holds the whole game (land, units, buildings, research, diplomacy); bots pick up
  afresh. Loaded files are checked, so a damaged or edited one is refused, not played.
- 4–15 countries per match. Humans join a **private lobby link**; bots fill the rest. The host
  sets lobby size, starting resources (low/normal/high), country pick (free or random) and
  bots (defensive/easy/normal/hard, or **none: pure PvP**).
- **Pure PvP:** one country per person in the lobby (2–15), no bots; every other country
  starts as neutral land. Someone who drops or leaves is held by a defensive bot.
- Spectating is allowed for eliminated players and visitors.
- On disconnect a **bot takes over** the country until the player rejoins (alone in the game,
  it pauses instead and waits for them).
- **Win:** hold every capital, or **hold 70% of all the land** (a domination win, with two or
  more countries in the game). Alliances come after v1; allies who hold all remaining
  capitals will win together.
- **Losing your capital** eliminates you: your land goes neutral and empty, and your blobs
  disband.
- **Surrender** (Menu / Esc) does the same at once; you watch the rest of the game.
- **Back to menu** leaves the lobby; in a game you're still alive in, a bot plays your
  country on. A game nobody is connected to **stands still** and waits for them; after 10
  minutes with nobody back it ends with no winner.

## 2. Map
- v1 map: **Europe, modern countries, Atlantic to the Urals**, with Britain, Ireland and the
  bigger islands (Sicily, Sardinia, Corsica, Crete, the Baltic islands...; not Iceland, the
  Atlantic islands or the Arctic). About 350 land regions built from **real provinces**, with
  admin borders merged or split to that count (denser in the west, coarser in Russia).
- **The sea** is split into about 50 named **sea regions** (North Sea, English Channel,
  Tyrrhenian Sea, ...). Nobody owns them. See §4a.
- A map has **more start countries than lobby slots**: Europe has 19 (Austria, Belarus,
  Bulgaria, Czech Republic, Finland, France, Germany, Greece, Hungary, Italy, Norway,
  Poland, Portugal, Romania, Russia, Spain, Sweden, Ukraine, United Kingdom). Humans pick, bots fill up to
  the lobby size, and the other countries start as empty neutral land.
- **Spawn spacing** can't keep 15 capitals 600 km apart; past that, each new country goes
  as far as it can from the ones already taken.
- **Spawn spacing:** bots and randomly dealt countries keep their capitals at least 600 km
  from the ones already taken. Countries people pick themselves aren't restricted.
- **Small start:** capital + about 4 neighbouring regions, 2–3 infantry blobs, and a barracks in
  the capital. Neutral land is empty.
- Each region has:
  - **Terrain:** plains, forest, hills or mountains. Borders crossing a **river** give the
    defender a bonus.
  - **Traits:** city, industry, oil field and farmland. Cities are supply hubs.
  - **Size:** affects capture time and the stack cap.
- Procedural maps come after v1.
- **Look:** like OpenFront's detailed pixel map, with **terrain clearly visible**, territory
  tinted in the owner's colour, and province borders and blob counters drawn on top.

## 3. Economy
- Resources: **money, manpower, oil, steel and research points**. Research points pay for
  the tech tree: every country makes 0.1/s, and each **lab** (a building, in cities only,
  $150 + 30 steel, 60 s) makes 0.5/s more. They're stored like the rest (100 per city level,
  200 per depot) and taken with a captured city or depot like the rest.
- **Yields:** land yields nothing by itself. Cities pay tax (+0.8 money and +0.25 manpower
  per level, every second) and economic buildings make the rest. Traits make the matching
  building better: farmland → farms, industry → mines, oil field → oil wells (only there).
  The yield overlay (B) shows what each of your regions makes; the region panel says it too.
- **Storage:** each resource has a store size: every city level stores 250 money and
  manpower and 120 steel and oil, every **depot** 1000 / 500 more. Income past it is lost (a
  gauge under each stock in the top bar turns orange and says FULL), and so is stock past
  it when the stores shrink: losing a city or depot region loses what no longer fits. A depot is a building
  (a slot, $120 + 20 steel, 45 s) for any region you hold in supply. **Taking a region with
  a city or depots takes its share of the owner's stock**: what it stores out of all their
  storage, up to the captor's own room.
- **Research** (T, its own screen): a tech tree, one tech at a time. Every country starts at
  the root (Modern State), which splits into five lines, and each tech opens one or two more;
  a tech needs only its parent. It costs **research points** by depth: 60 / 150 / 300 / 480 / 700. They're
  paid in as research goes, from the stock first and then as they're made, so more labs mean
  faster research and a saved-up stock finishes a tech at once; cancelling gives back what was
  paid in. The screen draws it as a tree growing down, lines green once researched and
  moving into the tech under way, which fills up (with the time left at the current rate);
  the header shows how much of the tree is done.
  - Army: Rifles (+20% infantry attack) → Trenches (dig in twice as fast, dug in +50%) and
    Heavy shells (+30% shelling). Trenches → Storm troops (infantry +15%, land taken 25% faster)
    → Mountain troops (infantry +30% in forest, hills, mountains) → General staff (all troops
    +10% attack, drill to 75). Heavy shells → Rangefinders (forts no help against shells) and
    Long guns (range 3) → Creeping barrage (+25% shelling).
  - Armour: **Tanks (factories can build tanks: nobody can before it)** → Engines (+20%
    speed) and Armour plate (+30% defence). Engines → Blitzkrieg (tanks +20% attack) →
    Mechanized infantry (infantry +25% speed). Armour plate → Synthetic fuel (−50% oil) →
    Heavy tanks (+30% defence, rough ground hurts half as much) → Combined arms (infantry and
    tanks +15% attack).
  - Economy: Farming (farms +30%) → Conscription (infantry −30% manpower) and Industry
    (mines and wells +30%). Conscription → Total war (manpower +25%). Industry → Banking
    (markets and city tax +25%) → Mass production (units made 25% faster) and Stock exchange
    (money +15%). Mass production → Assembly lines (units −15% money).
  - Logistics: Warehouses (storage +50%) → Railways (supply +1 region) → Field kitchens
    (regions feed +30% troops) and Motor pool (roads cut crossing time 55%). Field kitchens →
    Supply corps (out of supply, units wither half as fast) → Field hospitals (refill twice as
    fast). Motor pool → Radio (supply +1 region).
  - Naval: Shipyards (warships built 30% faster, −25% steel) → Naval guns (warships +25%
    attack and shelling) and Coastal defence (batteries +50% shelling, +25% against landings).
    Naval guns → Fleet train (ships supplied 2 more seas out, and mend at sea) → Dreadnoughts
    (+30% defence, +15% speed) → Naval aviation (warships shell 2 regions out). Coastal
    defence → Amphibious assault (landings hit at 80%, boarding twice as fast).
- **Upkeep:** each blob costs money per second, scaled by its strength and type. Once the
  money runs out, **blobs wither**: they lose strength and training, which also lowers their
  upkeep, until you're back in the plus.
- **Cities** (levels 1–5) are the heart of development.
  - The map's cities are the real ones with a million people or more (about 50); their
    starting level comes from the population (1–2M: 1 … 8M+: 4, so Paris, Moscow and
    Istanbul start at 4). Level 5 only comes from expanding.
  - Your capital starts at level 3 or more; cities of countries nobody plays start at 1, so
    nobody gets a free metropolis.
  - **Expand city** (a build, cost and time grow with the level) gives more tax, a slot, +1
    stack cap and one more hop of supply reach.
  - **Found a city** in a region of yours that's in supply and not next to another city
    ($700, 160 steel, 4 minutes): a rare, big decision. It starts at level 1 and is a
    supply hub. Expanding to level L costs $240·L and 40·(L−1) steel and takes L minutes.
- **Slots:** a land region has 1 (2 if large), plus its city level (sea regions have none). Every
  building but cities and roads takes one (a fort takes one for all its levels). Choosing
  what a region is for is the trade-off; demolishing frees a slot at once, with no refund.
  Your regions show their slots as boxes (filled = used, hollow green = free) while you place
  and with the yield overlay. To demolish, click the region and use Demolish next to the
  building in its panel.
- **Economic buildings** go only within 2 regions of one of your cities:
  - Farm (+0.4 manpower/s, +0.6 on farmland): farmland or plains.
  - Mine (+0.6 steel/s on industry, +0.3 on hills or mountains).
  - Oil well (+0.5 oil/s): oil fields.
  - Market (+0.4 money/s, +0.6 in a city): anywhere.
  Farms, wells and labs: several of the same kind per region are fine, a slot each. **Mines
  and markets** are one per region and **level up in place, I to III** (one slot at any
  level; each level yields as much again). A level costs more each time: mine $80 / $160 +
  15 steel / $240 + 30 steel (75 / 105 / 135 s), market $70 / $140 + 10 / $210 + 20
  (60 / 90 / 120 s). Their level shows in roman numerals beside them on the map, as forts and
  cities do, and in the region panel and build bar. Demolishing one takes every level.
- **Military buildings:** fort (levels 1–3) anywhere you own; barracks and factory in cities;
  on a coast, a port and a **coastal battery** (a slot, $120 + 40 steel, 75 s): it shells
  enemy ships and troops at sea in the seas off its coast (about as hard as 10 strength of
  artillery) while the region is supplied and not fought over, and its region's defenders
  get +50% against troops landing from the sea.
- Nothing is built in, or knocked down in, a region under attack (enemies in it, attacking it,
  or taking it): what's there goes to whoever takes it.
- **Roads** join two of your regions across their border: crossing is 40% faster (for
  anyone, invaders too) and the border counts as half a hop for supply. Paint them by
  dragging across regions.
- You pick what and where, pay, and it **builds over time in the background**. No builder
  units.
  - **Placement mode:** the build bar has three tabs, Economy (farm, mine, well, market, lab,
    city, depot, road), Military (fort, barracks, factory) and Naval (port, coastal battery);
    Tab cycles them. Pick a building (or 1–9 in the open tab), then click one of your
    regions (roads: drag); Shift places more. Valid regions light up green, and the bar
    shows the exact cost of the next level and the free slots in the region under the
    cursor.
  - **Build queue:** a busy region queues up to 3 more builds behind the one under way. Each
    is paid when placed and can be cancelled for a full refund, into the stores like income
    (what doesn't fit is lost; cancelling a fort or city level also cancels the higher levels
    queued after it). A captured region's queue is lost; one that goes neutral, cut off,
    gives back what was paid. A city being founded counts as a city for "not next to another
    city", so two can't be founded side by side.
  - Towns, fields, mines, derricks, market halls and roads are drawn into the map itself.
  - Above each region: its capital or city (a city nobody holds yet shows as a white flag
    until someone takes it), fort and port as icons; other buildings as "+N".
  - A captured region's buildings go **intact to the captor**.

## 4. Units (blobs)
- A blob is a token with a **type**, a **strength** (new ones come in batches: infantry 10,
  the rest 5; merging takes a blob up to 100) and a **training** level. Types: **infantry, tanks, artillery and warships** (§4a). Air
  comes later.
- **Stat-based:** each type has attack, defense, speed, cost and upkeep. **Terrain matters
  a lot:** tanks are strong on plains and weak in forest and mountains.
- **Production:** you order a blob at a barracks (infantry) or factory (artillery, and tanks
  once the Tanks tech is researched),
  and a "repeat" toggle keeps producing. A new blob appears in the building's region; if the
  region is full, the finished unit waits (paid for) until there's room.
- **Artillery:** standing still and in supply, it shells enemy units on land up to **2
  regions away** (its own side's fights first, else the strongest enemy force). Shells ignore
  digging in and count forts half. It never shells ships or anything at sea, and guns being
  shipped can't fire. It never storms a region: sent at enemies, it waits at the border and
  shells (digging in meanwhile). It can take empty land. Up close it barely hits back and
  breaks fast. Bots keep it one region behind the front.
- **Training:**
  - **Gained** from combat veterancy and from drilling: any idle blob in supply slowly trains
    up to a cap.
  - **Effect:** more damage dealt, less damage taken, faster capture.
- **Merging and splitting:**
  - Only same-type blobs merge, in any amounts (a 5 and a 10 make a 15). The merged blob's
    training is the size-weighted average minus a penalty, and it stops at 100 strength
    (the rest stays behind). Units in a fight can't merge, nor can a unit below 25% of its
    full strength (no patching wrecks together).
  - **Disband** (Del): the units go, and half the manpower their remaining strength cost
    comes back. Not in a fight.
  - Splitting is free and takes any amount: half (X), one batch, or a number typed in the
    unit panel. Both parts keep their training.
  - Bots keep units around two batches, and merge bigger only when a region is full.
- **Refill:** a damaged blob in supply slowly refills, paying money and manpower (plus steel
  and oil for tanks, at the prices techs set). Not at sea.
- **Stack cap:** each region holds a limited number of tokens per player. The cap depends on
  region size and terrain and goes up by 1 per fort level and per city level. **Every token
  counts:** standing, leaving, or waiting to go on (ships in port take no room). A unit whose
  next region is full **waits at home**, standing in its region (it fights and is shelled
  there), and goes as soon as there's room; two full regions swapping units trade places,
  so they can't jam each other. Merge to make room.

## 4a. The sea
- **Sea regions** belong to nobody and are never captured. Land regions touching one are
  **coastal**; only they can have a **port** (a building: a slot, 150 money and 40 steel, 90 s).
- **Warships** are built at a port (5 per order: 120 money, 20 manpower, 60 steel, 15 oil,
  40 s). They sail sea regions and into their own country's ports, never onto land, and
  hold up to 12 tokens per side per sea region.
  - **Fighting:** ships fight enemy ships and troops at sea, at full strength, and a fleet in
    port sails out at full strength against enemies in the sea off it. Ships never fight on
    land: docked ships take no part in a fight over their port and don't stop it being taken;
    when their port is lost (or knocked down) they put out to the sea off it, or are lost if
    it's blockaded. Ships don't take land stack room in port. In port they mend.
  - **Shelling:** a ship standing still in supply shells enemies on the coasts of its sea
    region and in the neighbouring sea regions (so transports waiting next to a fleet get
    sunk), like artillery with a range of 1.
  - **Supply:** full within 3 sea regions of one of its country's supplied ports, none
    beyond (it slowly wastes away). Ships refill only in port.
  - Seas cut off by straits too narrow for the map (the Black Sea, through the Bosporus and
    Dardanelles) are joined to the rest, so fleets can sail out.
- **Troops cross the sea on their own:** send land units to a region across the water and
  they march to the nearest of your ports, **board** (8 s), sail (slower than ships), and
  **land** on the far coast. There are no transport units to manage. Without a port of your
  own there is no way across.
  - At sea they are **easy to hurt** (half defence) and hit back at a quarter. They can't
    refill or drill at sea.
  - **Blockade:** troops never sail into a sea region with enemy warships in it; they wait
    (and the enemy fleet shells them there). Bots turn back. Enemy troops at sea don't block.
  - **Landing:** attacking a defended coast straight from the sea hits at half strength; an
    empty coast is taken from the sea like any land (see §5), and they land once it's taken.
  - Troops can't be sent to a sea region itself. Ordering a mix of ships and troops sends
    each where it can go (ships to sea or your port, troops to land); with only ships
    selected, a click on land or open water means the sea nearest it.
- **On screen:** sea names in blue, a hull symbol for warships, a boat beside troops that are
  at sea, an anchor icon on ports; clicking a sea shows its coasts and who's there.

## 5. Movement
- **RTS controls:** click or box-select blobs, right-click a region to send them, and use keys
  for split, merge and build. **Shift + right-click adds a waypoint**: the units go on there
  after the route they're on, so a chain of clicks queues moves, and queues captures (each
  region is taken from the border in turn).
- **Pathing:** blobs path through any region. Infantry takes about 5.5 s to cross one plains
  region; terrain changes that, and roads make it faster.
- **Changing orders mid-hop:** a hop is a timer, and the unit stays in its region until it
  ends. A new order the same way keeps the progress; any other order, or Halt, turns the
  unit back at once (it never has to step into the next region first). Pulling out of a
  fight costs once, however often the way out changes.
- **Attacking and taking land from where you stand:** a blob never walks into land that
  isn't its country's. Sent at a neighbouring region with enemies in it, it stays in its own
  region and **attacks across the border** at once. Sent at someone else's empty land
  (neutral, or an enemy's), it **takes it from the border**: the capture timer runs while it
  stands on its side, and once the region is taken it steps in (the normal hop) and goes on.
  A longer route does this region by region. If enemies (or a change of owner) get to the
  next region while a unit is on its way there, the hop is called off at once and it
  attacks or takes it from the border instead.
- **A unit on the move is still in its region** until the hop ends: it defends it, is
  attacked and shelled there, and stops captures of it.
- **Capturing:** the time scales with the region's size and terrain, forts make it longer,
  and training makes it shorter. Land nobody holds takes 30% longer than an enemy's, so the
  opening land grab lasts a while. The capture waits while the region is fought over.
- **Reading the map:** a solid arrow is an attack on enemies; a dashed one is taking empty
  land. Guns shelling show a dotted arc from the guns to the target, shells running along
  it, and a reticle round the units being shelled; shelled land erupts in fire, debris and
  smoke (shells into the sea throw up spray). Defenders that rout go up in white puffs. A unit
  waiting to go on (the next region is full, or a fleet blocks the sea) shows an hourglass.
- **How a fight looks:** units in their own region hold the middle (with a shield showing
  their fort level, whether they're dug in, and a river crossed by the attackers); units
  attacking a region from next door, or taking an empty one, get an arrow in their colour
  sitting halfway across the border, pointing in, one per border; the units stand on their
  own side just behind its tail. One crossed swords per fight, beside the main arrow. Borders between countries at war show as two-colour front lines; units
  pulling out of a fight get a grey arrow back.
- **Retreat:** a blob under attack (enemies in its region, or attacking it from next door)
  is pinned: it can hit back at a neighbour with enemies in it (it stays put), or retreat,
  only backwards: to the region it came from or to a neighbouring region its owner holds,
  never on past the enemy. Retreating costs strength and training (once, however often the
  way out changes). **Attackers break off for free**: they never left home.

## 6. Battles
- **A battle is about a region:** the blobs standing in it, and the blobs attacking it from
  neighbouring regions. Fights inside a region still happen when both sides end up in it
  (war declared while sharing neutral land, or arriving in the same instant). Fighting is
  **continuous attrition**: every tick each side deals damage = strength × attack ×
  training × terrain (of the region fought over) × supply.
- **Each blob deals damage in one battle** (the region it attacks, else its own) and takes
  it in every battle it's part of: attacking out while your own region is attacked means
  being hit at home while hitting only forward. Two sides attacking each other across a
  border both hit, and each defends with its own region's fort.
- **Defender bonus = terrain + fort + entrenchment + river crossing (+ coastal battery
  against landings)**, added together. Terrain covers anyone standing in the region fought
  over (forest +15%, hills +25%, mountains +40%); the rest is for the region owner's blobs
  standing in it. The river bonus counts the attackers coming over a river edge.
  **Entrenchment** builds up while a blob holds still in its own land (waiting, or
  shelling from the border, too) and is lost when it moves, attacks or takes land. A shield beside the token fills with earth as it digs in and stays full once it's
  dug in (under attack, the same shield also shows the fort level and a river crossed).
- **Capturing waits** while a region is fought over, inside or from next door.
- **Sieges:** artillery and warships shelling an enemy-held region with a fort, at war, wear
  the fort down a level at a time (a 20-strength battery of artillery takes a level in about
  40 s; Rangefinders doesn't change this). The feed says when a fort is knocked down.
  Building a new level resets the wear.
- **Flanking:** attacking a region from more than one neighbouring region: +15% damage
  there for each extra region attacked from, up to +45%.
- Anyone can reinforce either side mid-battle. With 3 or more sides, **each side spreads its
  damage over all hostile sides in proportion to their strength**.
- **Routing:** defenders down to a fifth of their strength in the fight and outnumbered
  4 to 1 break: each flees to the nearest region of theirs with room and no enemies (at most
  3 regions away through their own land), losing 10% of its strength; with nowhere to go it
  is destroyed. The strongest attacker takes the region at once.
- Otherwise the battle ends when only one side has blobs left. If the winner isn't the owner,
  the capture timer starts. Units killed in a fight are gone at once (before shelling, so
  nothing comes back from the dead).

## 7. Supply
- **Hubs:** every **city** you own (your capital is one). A city reaches 3 + its level
  regions through your land (a level-3 capital: 6); a border with a road counts as half.
- **Capacity:** each region feeds 90 by terrain (plains 1, forest 0.9, hills 0.8,
  mountains 0.6), +25% per city level; infantry needs 1 per strength point, tanks 2. More
  troops than that means partial supply: the units **overloaded** there slowly wither.
  The supply overlay shows overloaded regions in orange (the same orange as the cube on
  their tokens), the region panel shows load against capacity, the unit panel says why a
  unit is short (overloaded, cut off, or short in foreign land), and the sitrep warns
  once a minute per region.
- **Out of supply:**
  - blobs weaken and slowly die;
  - they can't refill or drill;
  - the region gives no income or production;
  - a cut-off region with 0 units turns **neutral**.
- Otherwise empty regions stay yours until an enemy captures them.

## 8. War and peace
- **Everyone starts at peace.** Units of countries at peace never fight; they can share
  neutral land (whoever started capturing a region first takes it).
- **A peaceful country's land is closed:** routes go around it. Sending units into it is an
  attack and declares war (the game asks you to confirm). You can also declare war from the
  player list.
- Sending units into it is only refused (and declares nothing) if there's no way there.
- **Peace:** either side can offer it; the other accepts or refuses, and the offer lapses
  after 30 s. Peace starts a **3-minute truce** (no war between the two) and sends each
  side's units home through the other's land; attacks under way are called off. A unit left
  standing in a peaceful country's land with no orders always heads home (with no way home
  it's interned: it leaves the game), so no army waits inside for the truce to end.
- Zones of control (slow movement) apply only in the land of countries you're at war with.

## 9. Bots
Bots have **defensive, easy, normal and hard** difficulty. They use the same orders as humans.

**Defensive** bots stay home: they never declare war and never take new land (not even
neutral), build their economy, cities and forts, and make no new units. At war they only
attack to take back their own land (what they held when they started), never the enemy's.

The others:
- expand into neutral land;
- guard their borders and dig in with forts, also in peacetime;
- produce blobs;
- fight only countries they're at war with, and defend their capital;
- build a port on the coast (early when there's no land left to take on foot), keep a small
  fleet (more at war) that waits off their port in peacetime and at war hunts enemy ships it
  outguns or shells enemy coasts within supply reach, and ship idle troops to the nearest
  neutral coast, or all together to an enemy coast they can take (up to 10 hops away).

**When bots go to war:** when they're attacked, or by difficulty against a bordering
country much weaker than them:
- **easy:** never;
- **normal:** from minute 5, against a neighbour with less than half their strength,
  sometimes;
- **hard:** from minute 3, against one with about 60% of their strength or less, more often.

They grow **bolder the longer they're at peace**: the edge they need falls by 0.1× a minute
(normal from 2× down to 1.1×, hard from 1.6× down to 0.9×). They're at their boldest at once
when their money stores are 70% full (nothing better to spend it on) or in the **endgame**
(3 countries left or fewer), when they also act on it far more often.

Bots offer peace when a war goes badly or stalls, and accept offers when the war isn't
going their way. In the endgame they don't make peace over a quiet front: they offer it only
when losing badly and take it only when weaker. A bot playing for a disconnected person
never starts a war. Mines and markets they upgrade rather than fill new slots, when it fits.

## Later (not in v1)
- **Air:** air blobs that are fast, ignore terrain and ZoC, and return to airfields.
  Bombers hit forts, buildings and supply; fighters and AA defenses counter them.
- **Alliances** (shared win; peace and war exist already) and **fog of war** (see your own regions and their neighbours,
  last-known state elsewhere).
- Procedural maps, other real-world maps.
- The Kernel module (copy of flowrace: install/update from GitHub, kernel-host.ts,
  `/kernel/status`, Tailscale share, `openfork.match.*` events).

---

## Starting tunables (proposed; all in `shared/rules.ts`)
| Thing | Start value |
|---|---|
| Server tick | 10/s |
| Infantry: max strength / speed / attack / defense | 100 / 1.0 / 1.0 / 1.2 |
| Tanks: max strength / speed / attack / defense | 100 / 1.8 / 2.5 / 1.5 |
| Crossing one plains region (speed 1.0) | 5.5 s |
| Terrain move ×: plains / forest / hills / mountains | 1 / 0.7 / 0.6 / 0.4 |
| Tank attack ×: plains / forest / hills / mountains | 1.2 / 0.6 / 0.7 / 0.4 |
| Enemy-land move × / per fort level | 0.7 / −0.1 |
| Fort levels / defender bonus each | 3 / +0.5 |
| Entrenchment: max / time to full | +0.5 / 60 s |
| River defender bonus | +0.25 |
| Training range / drill rate / cap from drill | 0–100 / +1 per 6 s / 50 (combat can go to 100) |
| Training effect at 100 | ×1.5 damage dealt, ×0.67 damage taken |
| Merge penalty | −10 training |
| Capture time, empty plains, medium size | 6.5 s (× terrain/size/fort, ÷ training) |
| Infantry / tank production | 20 s / 30 s |
| Infantry / tank batch cost | $50 + 100 manpower (10 strength) / $90 + 30 manpower + 38 steel + 18 oil (5 strength) |
| Warships | 5 per order: $120 + 20 manpower + 60 steel + 15 oil, 40 s, at a port; speed 1.6, attack 2, defense 1.5 |
| Sea | troops board 8 s, sail at speed 1.4, hit at ×0.25 at sea (×0.5 landing), defend at ×0.5; ships supplied 3 sea regions from a port; 12 tokens per side per sea region |
| Truce after peace / peace offer stands | 180 s / 30 s |
| Supply reach from a city | 3 + its level (roads: half a hop) |
| Supply capacity of a region | 90 × terrain × (1 + 0.25 × city level); infantry needs 1 per point, tanks 2 |
| Yield of land without buildings | none (city tax: 0.8 money, 0.25 manpower per level per s) |
| Starting resources (normal) | $150, 250 manpower, 40 steel, 20 oil |
| Build times | farm, market 60 s; mine, oil well 75 s (mine and market levels II, III: +30 s each); fort 60 s per level; barracks 60 s; factory 120 s; road 30 s |
| Stack cap | 2–4 tokens by size/terrain, +1 per fort level, +1 per city level |
| Slots | 1 (large: 2), + city level |
| Retreat cost | −15% strength, −10 training |
