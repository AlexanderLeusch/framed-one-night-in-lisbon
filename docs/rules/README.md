# Game rules

> These documents describe what the game does, as implemented in the code. When a rule changes, update the document, the code and the tests together, then run `npm run docs` to rebuild the printable version.

The game has two rooms that are played one after the other. Until the group connects them, each room is its own page.

| Room | Document | Code with the rules | Tests |
|---|---|---|---|
| 1 · Plot Twist: Cell Block D (escape room) | [room-1-escape-room.md](room-1-escape-room.md) | `room-1-escape/js/rules.js` | `tests/room-1/rules.test.js` |
| 2 · The Chase (police chase) | [room-2-shard-heist.md](room-2-shard-heist.md) | `room-2-chase/js/core.js` (rules), `room-2-chase/js/game.js` (pickups, police AI) | `tests/room-2/rules.test.js`, `tests/room-2/story.test.js`, `tests/room-2/input.test.js` |
| Both rooms: every setting and option | [settings.md](settings.md) | `room-2-chase/js/core.js`, `room-1-escape/js/rules.js` (checks of stored values) | `tests/room-2/rules.test.js`, `tests/room-1/rules.test.js`, `tests/browser/browser.test.js` |

## The whole game in one paragraph

In April 2012 the Starfall necklace, lent by the Ashford family to Lisbon's naval museum for the centenary of the Titanic, vanished from its case. You were the detective on the case, until the trail ended at your own door. Now you are inmate 4471, convicted of stealing it. **Room 1:** you have ten minutes in a prison washroom to find the code for a hatch in the floor. If you get out (Ending A), a note shows that the guard wanted you out, and a car is waiting at the end of the tunnel. **Room 2:** the police chase begins. You drive a getaway vehicle through Lisbon's Baixa, collecting the evidence that proves you innocent while up to four police cars and a helicopter hunt you, and get out over the 25 de Abril bridge.

## One night, one look

- **Time:** both rooms are set on the same night: room 1 around 02:15, room 2 from about 02:30.
- **Design:** both rooms share one design system: the same background, glass panels, fonts, buttons and cards. Each room keeps its own accent colour: **orange** in the prison, **cyan** on the run. Hale's radio messages in room 2 are orange because he comes from room 1.
- A test (`tests/project/page.test.js`) checks that the shared design tokens and the story links between the rooms stay in place.

## How the two rooms connect: the heist

- The start page has one button, **Start the game**, which opens the **heist page** (`heist/`). Beside it a monitor shows four pictures of the real game, which take turns. The rooms are not offered on their own there any more; their own addresses (`room-1-escape/`, `room-2-chase/`) still work.
- The heist page shows the **heist leaderboard** before anything is played: the heists of this device at once, then everybody's best heist from the online board.
- **The driver name comes first, and it counts in both rooms.** The heist page asks for a driver name before anything is played: type a name and press **Let's start**, and you are on the online leaderboards of room 2 and of the heist, with no email and no password (the same account and the same rules for names as in room 2; a name someone else has is refused). If the online board can't be reached, the name becomes a driver of this device. A name from an earlier visit is offered again (**Not you?** asks for another). **Play without a name** starts at once; room 2 then asks for a name on its end screen.
- **Both rooms are on that one page.** Room 1 is played in a frame, and while you play it, room 2 is loaded in a second frame under it, out of sight, down to the garage, and then stands still. When you leave room 1 through the tunnel door, room 2 is simply shown: no page is loaded at that moment, so there is nothing to wait for. A phone has too little memory for both 3D worlds at once: there the heist page only takes the name and then opens room 1 as its own page, and room 2 loads when room 1 is left, behind the light of the headlights. The same happens on a computer if room 2 should not be ready in time.
- **Ending A** of room 1 hands over the **escape time** (the time used on the clock, wrong codes included) and leads into room 2 without a stop: when the door at the end of the tunnel swings open, the headlights behind it fill the screen and room 2 opens by itself in the same light. There is no card and nothing to click. Ending B stays in room 1 (try again).
- Room 2 then skips its menu: the light clears and the old plank door of the tunnel swings open and you walk out into the garage, with the three vehicles across the hall. A message shows the escape time. From there it is a free ride through Lisbon.
- When that drive is finished, **heist time = escape time + drive time**. The escape does not change the drive in any way.
- The heist time goes on the **heist leaderboard** (each driver's best heist, fastest first), on this device and, when signed in, online. See room 2, *The whole heist*.
- The two pages stay separate. The escape time travels in the browser's storage and is checked by the rules when it is read: a broken, impossible or old one (over six hours) is refused and room 2 opens its menu as usual.

## Words used in these documents

| Word | Meaning |
|---|---|
| **Accepted action** | The player did something allowed. The state changes and is saved. |
| **Refused action** | The player tried something not allowed. Nothing changes, and the player is told why. |
| **State** | Everything the game remembers at one moment: where you are, items, time left, and so on. |
| **Scene** | A place you can stand in room 1 (the door, the sinks, ...). |
| **Hotspot** | Something you can use in a scene, shown as a pulsing marker (or, on a touch screen, a "Walk to" button). |
| **Tick** | One step of the clock, many times per second. |
