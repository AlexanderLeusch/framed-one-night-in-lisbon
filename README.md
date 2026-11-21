# Framed: One Night in Lisbon

*Framed: One Night in Lisbon* is a two-room browser game (its working title was *Shard Heist*, which the repository carried until 20 November 2026; the code still uses it in the names of saved values). **Room 1, *Plot Twist: Cell Block D***, is a 3D prison escape room: find the code for the hatch in the washroom floor before the guard comes back. **Room 2, *The Chase***, is the 3D police chase that follows. A start page leads to both rooms.

| Page | Play |
|---|---|
| Start page (both rooms) | https://alexanderleusch.github.io/framed-one-night-in-lisbon/ |
| 1 · Escape room | https://alexanderleusch.github.io/framed-one-night-in-lisbon/room-1-escape/ |
| 2 · Police chase | https://alexanderleusch.github.io/framed-one-night-in-lisbon/room-2-chase/ |

Both rooms take place on the same night and share one design system (the same fonts, panels, buttons and cards), with orange as the accent of the prison and cyan as the accent of the chase. Room 2's story starts where room 1 ends: inmate 4471 is on the run, and Officer Hale helps over the radio.

Both are published automatically from `main` once all tests pass. The rules of both rooms are written out in plain English in [docs/rules/](docs/rules/README.md).

The folder `original-solo-project/` holds the original solo project *Plot Twist: The Missing Necklace* (Python and Streamlit), which room 1 rebuilds in 3D. It is kept for reference, and CI tests it, but it is not part of the deployed game. Run it with `cd original-solo-project && uv run streamlit run app.py`.

## Team

| Name | Student number | Main focus |
|---|---|---|
| Jasper Beyer | 70114 | Room 1 · Escape room |
| Louisa Roderer | 81845 | Room 2 · Police chase |
| Marco Pichler | 78786 | Room 1 · Escape room |
| Sarah Lock | 77952 | Room 1 · Escape room |
| Alexander Leusch | 80897 | Room 2 · Police chase |

## Room 1 · Plot Twist: Cell Block D

You were the detective on the Ashford necklace case; now you are inmate 4471, convicted of the theft. Officer Hale locks you in washroom 2 for ten minutes. A hatch in the floor is held shut by a four-digit combination lock, and the code is hidden in the room.

| | |
|---|---|
| Scenes (5) | The door, the sinks, the toilet stall, the hatch, the tunnel |
| Items (2) | The car key hidden behind the crooked tile (pried off by hand), and a mop (optional: jams the door) |
| Clues (3) | Steam on the mirror, graffiti in the stall, scratches in the wall beside the door. Together they give the year the "unsinkable" ship sank. The code is always the same |
| Endings (2) | **A:** the hatch opens in time, you climb down into the tunnel, walk through it yourself and open the creaking door at its far end. **B:** time runs out and Hale takes you back to your cell. The earlier choice to jam the door buys one extra minute before Ending B |
| Pressure | 10:00 clock, warnings at 5:00, 2:00, 1:00 and 0:30; every wrong code makes noise and costs 30 seconds |
| Look | Modelled on a photo of a real prison washroom: green glazed tiles under yellowed cream cinder blocks streaked with rust, caged red emergency lamps that begin to throb when time runs short, an old tube light that flickers now and then, puddles that mirror the lamps and the steel, a striped prison uniform on a hook (a jacket with the number patch 1356 and the trousers under it), toilet rolls kicked about. The sinks are one stainless prison unit of brushed steel with deep pressed bowls, perforated drains, push buttons for hot and cold, security bolts and a yellowed bead of silicone along the wall, worn by years of use (limescale where the water dries, rust round the drains, grime in the corners, scuffs on the apron), and a stream that runs while the hot tap is on; the polished steel mirror over them really mirrors the room, soft and hazy as steel is, with limescale and smears on it and you in it. The stall is powder-coated sheet steel, gently wavy as thin steel is, chipped to the bare metal at the edges, dented, scratched and scuffed by boots, held by brushed stainless hardware (an anti-grip headrail, a wall channel, round feet, pilaster shoes, wrap-around hinges and a lock that shows FREE), and its graffiti is scratched in by hand, stroke by stroke. The toilet is a stainless pan with a low-level cistern on the wall above it, both of the same polished steel with the scanned scratches: a pressed tank with rounded edges and a front that bows out a little as thin sheet does, a lid with a turned-down lip, a dual flush button, security screws, a stamped plate and soft runs of limescale and rust; its flush pipe runs down the wall, bends forward and slides into the pan's flush horn through a black rubber connector, and a stop valve feeds the water. Two security cameras watch: a bullet camera on a wall bracket in the corner (sunshield, dark glass, a ring of faintly glowing infrared LEDs, a blinking light, its cable running into a conduit) and a smoked dome camera over the stall. You see your own hands (real hand models with jointed fingers) in the striped sleeves of the prison uniform: relaxed and never quite still at rest, swinging a little differently with every step, reaching out when you use something; the head dips at every step and sways gently. Look down and you see your striped shirt, your legs and your boots, the feet planted on the floor and stepping in time with every footfall, the arms swinging at your sides, and your body's soft shadow on the floor |
| Controls | Arrow keys (or `W A S D`) to walk freely in the first person, drag to look around, click the pulsing markers or the objects (the first time a mini game comes up, a card explains its goal, steps and controls before its 30 seconds start), "Walk to" buttons only on touch screens (no arrow keys there), `P` / `Esc` pause, `M` sound, a volume slider on the pause card |

Progress is saved in the browser after every accepted action, and a reload offers to continue.

## Room 2 · The Chase

A 3D police-chase driving game that runs in any modern browser. Pick a getaway vehicle and find the six pieces of evidence that prove you innocent in Lisbon, shake off up to four police cars and a helicopter and reach the gate before the clock runs out. Or play **The Necklace Job**, the same night as a story with three endings.

**Play:** https://alexanderleusch.github.io/framed-one-night-in-lisbon/room-2-chase/ (published automatically from `main` once all tests pass)

| | |
|---|---|
| Map | Lisbon's Baixa (real street names, Arco da Rua Augusta, traffic lights, 26 AI cars, 2 buses, 4 motorcycles, 3 trams) |
| Vehicles | Muscle coupe (balanced), Superbike in gloss black (fastest, most agile), Tractor unit (slowest, toughest, best at ramming) |
| Story mode | *The Necklace Job*, after the escape: one night in Lisbon, Officer Hale on the radio, a hidden letter, 3 endings. Which one you get depends on whether you found the letter |
| Systems | Seven synthesised radio stations, hills on every map, wanted stars and a police helicopter, visible damage, police AI with a bust meter, crash damage and repair kits, synthesised engine sounds, map-boundary force field, radar, Ultra/Balanced graphics |
| Controls | `W A S D` or arrow keys to drive, `Space` handbrake, hold `C` to look back, `E` nitro (a charge for every third pickup), `P` / `Esc` pause, `M` map (Lisbon), `N` sound, `R` radio, volume sliders for game and music in the menu and the pause, `Enter` confirms. On phones: touch pads (brake and gas together are the handbrake, the round button looks back, the flame button fires nitro), and steering by tilting the phone sideways |

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer. There is nothing to install.

```bash
npm start          # serves the start page and both rooms: http://localhost:8080
npm test           # rules, story, input, page and escape-room tests (about 1 s)
npm run test:sri   # checks the library files against their integrity hashes (needs internet)
npm run test:browser   # plays both rooms in headless Chrome or Edge (about 8 min; CI runs its three parts, test:browser:chase-drive, test:browser:chase-pages and test:browser:escape, side by side)
npm run test:all   # all of the above
cd original-solo-project && uv run pytest   # the 36 Python tests of the original Plot Twist project (needs uv)
```

Opening `index.html`, `room-1-escape/index.html` or `room-2-chase/index.html` directly from the folder also works.

## How it is built

The repository has one folder per room, and one folder for each kind of supporting work. Each room is a complete web page on its own.

```
shard-heist/
├── index.html               START PAGE: the whole heist, then each room on its own (no script)
├── heist/                   THE HEIST PAGE: the driver name for both rooms, then both rooms on one page
│   ├── index.html           the name box and the place for the two frames
│   ├── heist.js             the driver (room 2's online account), room 1 in a frame, room 2 loaded ahead under it
│   └── heist.css            the few styles of its own (the rest is room 2's stylesheet)
├── README.md                this file
├── AGENTS.md / CLAUDE.md    working rules for the team and its coding agents
│
├── room-1-escape/           ROOM 1 · Plot Twist: Cell Block D (3D escape room)
│   ├── index.html           page structure: HUD, markers, cards, error screen
│   ├── styles.css           the prison look
│   ├── js/rules.js          the rules: scenes, items, clues, lock, clock, saved games (pure functions)
│   ├── js/minigames.js      the nine mini games behind the three clue spots
│   ├── js/room.js           the 3D washroom, camera, markers, cards, sound
│   ├── js/boot.js           error screen (load failures, no WebGL, unexpected errors)
│   ├── textures/            CC0 scans from Poly Haven: concrete, cinder blocks, scratched steel, the vault HDRI, the tunnel's brick, stone and wood, the uniforms' fabrics, the fire extinguisher's painted steel
│   ├── models/              the two hand models (MIT, WebXR Input Profiles) and the fire extinguisher (CC0, Poly Haven), with their licences
│   ├── sounds/              CC0 recordings: the hot tap, the air vent, footsteps (steps/) and the climb down the ladder (ladder.mp3), with their credits
│   └── fonts/               the two fonts with their licences
│
├── room-2-chase/            ROOM 2 · The Chase (3D police chase through Lisbon)
│   ├── index.html           page structure: HUD, cockpit, menu, error screen; loads the scripts in order
│   ├── styles.css           the chase look (also used by the start page)
│   ├── js/core.js           the rules: driving, damage, police, scoring, story, input checks (pure functions)
│   ├── js/online.js         the online leaderboard and driver accounts (Supabase, plain fetch)
│   ├── js/game.js           everything visual and real-time: worlds, the garage, vehicles, AI, sound, HUD, story scenes
│   ├── js/boot.js           error screen
│   └── fonts/               the two fonts with their licences
│
├── tests/                   all automated tests
│   ├── room-1/              rules and mini games of room 1
│   ├── room-2/              rules, story, menu input and the online leaderboard of room 2
│   ├── project/             both pages, security, the dev server, documents
│   └── browser/             plays both rooms and the start page in a real (headless) browser
│
├── docs/                    documents
│   ├── rules/               the rules of both rooms and all settings (Markdown, HTML, Rules.pdf)
│   ├── code-guide/          the Code Guide: architecture and every code section (HTML, PDF)
│   └── course-guides.md     how the project follows the course guides
│
├── tools/                   serve.js (dev server), check-sri.js (library hashes), build-rules.js (rules → HTML)
├── original-solo-project/   the original Plot Twist solo project (Python/Streamlit) that room 1 rebuilds; tested by CI
└── .github/workflows/       CI: all tests on every push and pull request; deploy to GitHub Pages only when they pass
```

**Where to find what.**

| You look for | It is in | Its tests |
|---|---|---|
| The screens | `index.html` (start page), `heist/index.html` with `heist.js` (the heist page), `room-1-escape/index.html` with `js/room.js`, `room-2-chase/index.html` with `js/game.js` | `tests/browser/`, `tests/project/page.test.js` |
| The rules | `room-1-escape/js/rules.js`, `room-1-escape/js/minigames.js`, `room-2-chase/js/core.js`; in plain English in `docs/rules/` | `tests/room-1/`, `tests/room-2/rules.test.js`, `story.test.js`, `input.test.js` |
| The storage | In the browser (`localStorage`): room 1's saved game, written by `room.js` (`save`) and checked by `rules.js` (`restore`), room 2's settings and best times in `core.js` (the `parse…` functions). Online: the leaderboard and driver accounts in `room-2-chase/js/online.js` (Supabase) | `tests/room-1/rules.test.js`, `tests/room-2/input.test.js`, `tests/room-2/online.test.js` |
| The tests | `tests/`, one folder per room, plus `project/` and `browser/`; run by `.github/workflows/ci.yml` | |

**Where to start reading.** For a room's rules, open its rules file (`room-1-escape/js/rules.js`, `room-2-chase/js/core.js`) and the matching tests. For what the player sees, open its page and its big script (`room.js`, `game.js`). The plain-English rules in `docs/rules/` describe the same things without code.

**Room 1 in one sentence.** `rules.js` holds the state as one plain object; `perform(state, action, target)` returns a new state for an accepted action and the same, unchanged state plus a message for a refused one; `tick()` runs the clock; `room.js` only draws the state and turns clicks into actions. This is the structure of the original Plot Twist project, in JavaScript and 3D.

**The frame loop (room 2).** `frame()` in `game.js` runs once per screen refresh: player physics → police → pickups, timer, story → traffic and signals → particles, boundary, camera → engine sound → HUD and radar → render. The time step is capped at 50 ms (`Core.frameDt`), so a slow frame never moves a car through a wall.

**The state machine.** `menu → (garage →) play ⇄ pause → done | over`; a run in Lisbon begins on foot in the garage. Every button on a card has a `data-action`, and `Core.actionAllowed(action, state)` decides whether it may run, so a stale click is ignored.

**Rules vs. presentation.** `core.js` contains only pure functions: numbers in, numbers out, no DOM, no 3D, no randomness of its own. `game.js` calls it for every decision that affects the outcome (top speed, braking, damage, bust meter, stars, best times, which ending you get) and does everything else itself. Every section of `game.js` starts with a `// ###` comment that explains it.

## Why it is built this way

| Decision | Why | Trade-off |
|---|---|---|
| Static website, no build step, no server of our own | Runs anywhere, free hosting on GitHub Pages, nothing to install or keep running, no server to attack | Anything shared between players needs a hosted service: the online leaderboard uses Supabase |
| Online leaderboard on Supabase, called with plain `fetch` (`room-2-chase/js/online.js`) | One service gives login and a database; the rules for who may write what live in the database (Row Level Security), so a changed page can't cheat them; no library to load | A free project pauses after a week without use; the run time is still measured by the player's browser |
| three.js r128 from a CDN, pinned to one version, with SRI hashes | A proven 3D engine instead of raw WebGL; the hashes make the browser refuse any file that is not exactly the one we tested | r128 is from 2021; upgrading means re-testing the post-processing add-ons |
| Everything procedural (buildings, textures, vehicles, sounds), except twelve CC0 scans from Poly Haven and CC0 recordings (the hot tap, the air vent, the climb down the ladder) in the escape room | Almost no image or audio files to license or download; the scans (concrete, cinder blocks, scratched steel and one HDRI for the steel's reflections, plus old brick, stone blocks, brick pavers and rough wood for the tunnel and its ladder, coarse linen for the prisoner's uniform, and wool, poplin and leather for Officer Hale's, 3.8 MB) make the washroom and the tunnel photo-real where it matters, and the recordings (230 kB) make it sound like a real washroom | Stylised elsewhere |
| Puddles in the escape room are real mirrors: the room is drawn a second time, smaller, from a camera under the floor | Reflections of what is really there (lamps, steel, the red glow) that move with you, instead of a fixed shine | A second, smaller drawing of the room while you move or look round; standing still it is not redrawn |
| The steel mirror over the sinks is a real mirror too: the room is drawn once more from a camera behind the wall, then blurred and dulled like polished steel; a simple figure of you stands where you stand for that picture only, and your real hands are drawn into it | You see the room, the steam and yourself in it as you move, which is what a mirror is for | One more smaller drawing of the room while the mirror is in view (at most 20 a second when you stand still); the figure of you is simple, which the hazy steel hides |
| Rules split out into `core.js` | They can be tested in Node in milliseconds, and the rules are in one place | `game.js` still shares state between its sections |
| Arcade physics (speed along the heading, collision circles) | Predictable, fun handling at 60 fps on modest hardware | No real tyre grip or weight transfer |
| Engine sound from a small physical model: a pressure pulse per firing, a reflecting exhaust pipe, fixed muffler resonances, separate loops for load and overrun | Follows every rpm and gear change, each vehicle has its real engine layout, and the model can be tested in Node | Approximates real engines, it is not a recording; we checked it by measurement, and the group should judge it by ear |
| Story as data (`STORY` acts and radio timeline) plus rules in `core.js` | Texts and timing can change without touching the logic; the ending logic is tested | Branching is simple (one decision, three endings) |
| Hills by bending finished flat worlds over one height field | The layouts, collisions and radar stay simple 2D; every layer is cut on one grid, so layers cannot pass through each other | Building fronts follow the slope instead of stepping |
| Radio composed and synthesised at run time | No music files, so no licences; each bar is a tested list of notes | Stylised, without vocals |

## Testing

`npm test` runs 207 tests in Node (47 of them for the escape room), and `npm run test:browser` runs 24 more in headless Chrome (8 of them in the escape room, 1 on the start page, 1 on the heist page). CI runs all of them, plus the SRI check and the 36 pytest checks of `original-solo-project/`, on every push to `main` and on every pull request. They cover:

- **Escape room:** both endings and the jammed-door grace minute; refused actions (walking where there is no exit, taking an item twice, the car key before the tile is off, the door without the mop, lock wheels that do not exist, anything before the briefing or after an ending) return the unchanged state; wrong codes cost 30 s but never take the clock below zero; warnings sound once; tampered saved games are rejected; in the browser: briefing, refused action, save and continue after a reload, a wrong code and then Ending A (down the ladder, the door refused from the foot of it, the walk to it and the door opened).
- **Accepted actions:** each menu action in the states whose cards show it; valid map and vehicle picks; restoring a valid saved selection; finishing every story act; both story endings.
- **Rejected actions:** card buttons while driving; story buttons without a story; the "next act" button of the removed acts; unknown actions; picks such as `"tank"`, `"constructor"` or `"__proto__"`, and the maps that were removed (highway, countryside); any act but the story's one; tampered saved data; dev-server requests for `.git`, for paths outside the folder, and with methods other than GET or HEAD.
- **Edge cases:** gas and brake held together, zero-length and 3-second frames, negative frame times, NaN impacts, damage above 100 or below 0, coasting to exactly zero, a letter found in an attempt that then failed, radio lines that must not repeat, time displays that must never show negative or NaN.
- **Consistency:** the 0–80 km/h figure and the top speed on the menu card match the physics; every element id the game looks up exists in the page; every button action is reachable.
- **Real browser:** the menu loads without errors, picking a vehicle updates the card, a run starts and the throttle moves the car, pause and resume work, story act 1 starts, and the error screen appears when a library is blocked or WebGL is missing.

Writing the tests found two real bugs. Both are fixed:
1. Saved data like `{"mode":"constructor"}` passed the old check `if (MODES[s.mode])`, because every object inherits a `constructor` property. That would have crashed the game on the next load.
2. The car could go about 5 km/h faster than the top speed shown on the menu card, because the throttle pushed past the limit every frame before it was pulled back. Now the throttle stops at the top speed.

## Security

- **Online accounts with the least data.** The quick way onto the online leaderboard is a driver name only: Supabase makes an anonymous account for this browser, with no email and no password. Players who want the same driver on every device can use email and password instead; Supabase keeps the passwords, the game never sees or stores them. The page holds only the **publishable** Supabase key, which is meant to be public: what anyone may do is decided by the rules in the database ([supabase/schema.sql](supabase/schema.sql)). Everybody may read the boards; a signed-in player may add only their own driver name and their own runs; nobody can change or delete a run; the database refuses impossible times, unknown maps or vehicles, a second run within 10 seconds, and a name that is taken (without case). [supabase/rule-check.sql](supabase/rule-check.sql) tries all of these against the real database and rolls everything back. The page may connect only to itself and this one Supabase address (`connect-src`). Names are cleaned and escaped before they are shown. Besides that, the game stores your last map and vehicle, best times, the drivers and leaderboards of this device, your online login, the radio station, the graphics setting, the steering choice, the volumes and the saved escape-room game, all in your browser's `localStorage` (the full list is in [docs/rules/settings.md](docs/rules/settings.md)). The game has no server of its own. The fonts ship with the game; only the three.js library comes from cdnjs and jsDelivr, so those two services see your IP address. In the escape room, the air vent asks the Openverse API once (a fixed search, no key and nothing about you; the answer is kept for 30 days) and plays the recording from Freesound, so those two see your IP address too. No page sends a referrer. There are no credentials anywhere in the repository; a test scans every file for keys and tokens.
- **Input validation.** Everything read back from `localStorage` is checked (`parsePick`, `parseBest`, `parseRadio`, `parseSteer`, `parseVolume`, and `restore` and `parseVolume` in room 1) and replaced by defaults when it is invalid. Menu picks and actions are checked against fixed lists using own properties only. Error messages are inserted as text, never as HTML.
- **Access control.** Nothing on the site needs a login. Cards accept only the actions allowed in the current state, and the dev server only serves known file types from the project folder (no `.git`, no path traversal, GET and HEAD only).
- **Dependencies.** No npm packages at all. The two fonts ship in each room's `fonts/` folder with their licences, so no font service is needed. The Python project pins every package in `uv.lock`, and CI audits them with `pip-audit` on every push; a known vulnerability fails the build and stops the deploy. GitHub's Dependabot alerts are on for the repository, so a newly published vulnerability in a pinned version is reported even when nobody pushes. The only runtime library is three.js 0.128.0 (9 files), pinned by exact URL, checked by SRI hashes (`npm run test:sri`) and loaded with `crossorigin="anonymous"`. `npm audit` reports 0 known vulnerabilities for `three@0.128.0` (checked 3 November 2026). GitHub Actions are pinned to commit hashes.
- **Content Security Policy.** Scripts may only come from this site and the two pinned CDNs; there are no inline scripts, plugins, forms or foreign base URLs. In the escape room the page may also call `api.openverse.org` and play audio from `cdn.freesound.org`, nothing else; the API's answer is checked in `rules.js` (`pickVent`, `parseVent`: CC0 only, an MP3 on Freesound's server, 20 s to 10 min, titles shown as text).

## When something is unavailable

The game needs no server of its own. The outside services are the CDN for three.js and, in the escape room, the free Openverse sound API (no key) that finds the air vent's recording on Freesound. Each thing that can be missing has a defined behaviour:

| Missing | What happens |
|---|---|
| three.js or one of its effect files (cdnjs, jsDelivr), offline or blocked, or a file that fails its integrity check | The error screen in `room-2-chase/js/boot.js` says which file could not load and offers *Reload*, instead of a black page. A browser test blocks the library on purpose and checks this card |
| WebGL (old or locked-down browser) | The same error screen explains how to turn on hardware acceleration. A browser test removes WebGL and checks it |
| `localStorage` (private mode, blocked storage) | Every read and write is wrapped, so the game runs with the defaults and simply does not remember settings, best times, drivers or the escape-room save |
| The motion sensor on a phone (missing or refused) | Steering stays on the buttons |
| The Openverse API or Freesound (offline, blocked, over the API's limit of a few searches per hour without a key, or no fitting CC0 recording), or an iPhone or iPad (a page cannot set an `<audio>` volume there) | The escape room's air vent keeps playing its bundled recording; nothing else changes |

## Limits

- **Lisbon:** the map is a simplified Baixa: square blocks, 7 streets each way, and some real streets left out. It has hills, which the real Baixa does not: a game decision. The houses follow the Pombaline pattern and the landmarks are modelled freely from descriptions, not from plans. It is recognisable, not surveyed. The other two maps are not Lisbon yet.
- **Look and sound:** procedural geometry, synthesised engines and the radio are stylised; they do not look or sound like photos or recordings. Sound was checked by measurement (frequency, level, spectrum), so it should also be judged by ear.
- **Performance:** Ultra graphics (bloom, large shadow maps) needs a decent GPU; phones start in Balanced. When the frame rate stays under 48 per second, the resolution drops by itself, down to 60 %. Frame rates were only measured in software rendering, not on a real phone.
- **AI:** traffic never changes lanes and keeps its speed on hills; police ignore traffic lights and can take detours in the city.
- **Physics:** arcade model with collision circles; no tyre grip or mass transfer.
- **Structure:** `game.js` is one large closure (about 5,100 lines) whose sections share variables, so it is harder to work on in parallel than separate modules would be.
- **Testing:** the browser test checks the main workflows, but not long play sessions, every map end to end, or sound quality, and the CI browser renders in software.
- **Online leaderboard:** the run time is measured in the player's browser, so a player who changes the page could send a fast time that the game did not really drive; the database only refuses impossible times. Proving a time would need the server to check the run itself. A name-only driver lives in one browser: clearing the site data or signing out ends it (its times stay on the board). The free Supabase project pauses after a week without use and must be woken in its dashboard before a demo.
- **Persistence:** best times and the boards of this device live in one browser only and can be edited by the player.

The street names and their order were checked against [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL). The game ships no map data and calls no map service.

## How it could change

- Split `game.js` into ES modules (world, traffic, police, physics, audio, ui, story) behind a common map interface (`build`, `reset`, `update`, `progress`).
- Move police steering and traffic following into `core.js` so they can be tested too.
- **Planned: online multiplayer (getaway vs. police).** One player drives the getaway vehicle, the other a police car. This needs a small server (for example Node.js with WebSockets) that pairs players in a room and relays positions about 20 times a second. To stop cheating, the server should decide the bust and the finish, using the same `core.js` rules (`bustStep`, `finishOpen`), and accept only validated messages from each player. `core.js` already runs in Node, so the server can reuse it without changes.
- The online leaderboard could check run times on the server (an Edge Function that replays the checkpoints of a run) and let a name-only driver add an email later to keep it on other devices.
- Load real glTF vehicle models and recorded engine loops for more realism; add lane changes for traffic.
- Longer browser tests that drive whole runs and story acts with scripted inputs.

## Working as a team

The team's working rules for people and coding agents are in [AGENTS.md](AGENTS.md): the stack, the run and test commands, branches and reviews, what to do when `main` breaks, and what an agent must never do. `CLAUDE.md` points there, so every agent follows the same rules. [docs/course-guides.md](docs/course-guides.md) checks the project against the course's team project page and its ten guides, with the points that are still open.

## Credits

All radio music is composed and synthesised by the game at run time, so there are no music files or licences. The tunes are generated from seeded random walks. The classical station plays J. S. Bach's Prelude in C (BWV 846) and the Ode to Joy from Beethoven's Ninth Symphony, both in the public domain.


Escape-room scans from [Poly Haven](https://polyhaven.com) (CC0, fetched through its public API and kept in `room-1-escape/textures/`): the textures *Hangar Concrete Floor*, *Concrete Wall 004* and *Blue Metal Plate* (Rob Tuytel; also, greyed and cut between its seams, the dark steel of the cell door and its frame), and the HDRI *Bank Vault*; for the tunnel under the hatch *Castle Brick 07* (Rob Tuytel), *Stone Brick Wall 001* (Dimitrios Savva, Rico Cilliers), *Worn Brick Floor* (Amal Kumar) and, for the ladder, *Rough Wood* (Rob Tuytel); for Officer Hale's uniform *Poly Wool Herringbone* and *Stretch Poplin* (colormass, Rico Cilliers) and, dyed black for his boots, belt and cap visor, *Brown Leather* (Rob Tuytel); the prisoner's uniform is woven of *Rough Linen* (colormass, Rico Cilliers). The cobwebs and the dust are painted and animated in code. CC0 asks for no credit; we give it anyway.

Escape-room recordings (CC0, kept in `room-1-escape/sounds/` with their sources in `CREDITS.md`): the hot tap is *tap-water-1* from Owlish Media's *Sound Effects Pack* on OpenGameArt, and the air vent is *Fan* by lllBabaBooeylll on Freesound (536942). The footsteps (`room-1-escape/sounds/steps/`) are Owlish Media's hard shoe steps on concrete, rubberduck's wet steps for the puddles and Kenney's *Impact Sounds* wood steps for the ladder, all CC0. The rest of the climb down the ladder (`ladder.mp3`: creaking wood, hands on the rungs, clothes, a boot on stone) joins seven short recordings by rubberduck and Owlish Media from the CC0 collection *Free-SFX* on GitHub. They are bundled with the game. When it can, the air vent instead plays a CC0 ventilation recording from Freesound that the game finds through the [Openverse](https://openverse.org) API (no key); the pause card names it and its creator.

The fire extinguisher by the door is Poly Haven's model *Korean Fire Extinguisher 01* (Um Joorin, CC0), fetched through its public API: the body and gauge glass are in `room-1-escape/models/fire-extinguisher.glb` (the paper tag left off), its painted-steel scans in `room-1-escape/textures/fire-extinguisher-*.jpg`, with the Korean word on its stand repainted in English; see `LICENSE-fire-extinguisher.txt`.

The two fluorescent lamps hang in Poly Haven's scanned batten *Mounted Fluorescent Lights* (Ulan Cabanilla, CC0, `room-1-escape/models/fluorescent-fitting.glb` and `textures/fluorescent-fitting-*.jpg`, see `LICENSE-fluorescent-fitting.txt`). The tube in it is built in `room.js`: clear, physically based glass (three.js `MeshPhysicalMaterial` with transmission) with the glowing gas inside and, at each end, the glass stem, the lead-in wires and the coiled filament, aluminium caps with brass pins, and a guard of the scanned steel wire round it.

The escape room's hands are the *generic-hand* models of the [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) (© 2019 Amazon, MIT licence; copied unchanged into `room-1-escape/models/` with the licence in `LICENSE-hands.txt`). They are files, not an npm package: nothing is installed.

Officer Hale in the briefing scene is a real human body, made from the [MakeHuman](http://www.makehumancommunity.org) base mesh with its body targets, skeleton and eyes (CC0 since 2020): `room-1-escape/models/hale.glb` (1.2 MB), a man in his fifties with 66 bones, his uniform, belt, cap and boots fitted to the body. His skin is painted by us (`room-1-escape/models/hale-skin.jpg` and its bump map: stubble, cropped grey hair, eyebrows, the lines of his face); the uniform uses the same wool, poplin and leather scans as before. He turns his head to you and reaches for the door as it swings shut. Until the file has loaded, or if it cannot be, the figure built in code stands in. See `LICENSE-hale.txt`.

You, inmate 4471, are made the same way: `room-1-escape/models/inmate.glb` (1.1 MB), a man in his late thirties with 66 bones, the striped prison uniform with its collar and the 4471 patch, and leather work boots fitted to the body, his skin painted by us (`inmate-skin.jpg` and its bump map: a buzz cut, dark stubble and eyebrows). In room 1 it is your body when you look down and on the ladder (your head and arms are left out, the view and your real hands are already there), and all of you in the steel mirror; in room 2 it is the rider on the motorcycle, without a helmet. Until the file has loaded, or if it cannot be, the figures built in code stand in. See `LICENSE-inmate.txt`.

Built with three.js r128 (MIT licence). Fonts: Big Shoulders Display and JetBrains Mono (SIL Open Font License 1.1; the font files and their licences are in `room-1-escape/fonts/` and `room-2-chase/fonts/`). Code written with the help of Claude (Anthropic).
