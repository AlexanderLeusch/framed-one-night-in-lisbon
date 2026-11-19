# Room 1 · Plot Twist: Cell Block D

> This document describes the rules in `room-1-escape/js/rules.js`. Values marked **(open)** are not decided yet.

## Goal

Open the hatch in the floor of the toilet stall and climb out **before the clock reaches zero**.

## Story

The briefing is a short series of cards; **Next** and **Back** move between them.

1. **The front page.** *The Lisbon Times* of Monday 16 April 2012: the **Starfall necklace**, lent by the Ashford family to the Museu de Marinha for an exhibition marking 100 years since the Titanic sank, vanished from its glass case on the night of the centenary. No alarm sounded, and a detective was put on the case.
2. **Who you are.** Three weeks ago you were that detective. The trail ended at your own door: the necklace's velvet box was hidden in your car. Tonight you are **inmate 4471**, convicted of the theft: someone framed you. Your oldest friend on the force kept digging and found the proof that clears your name, but the people who framed you came after him. Before he disappeared from Lisbon, he hid the evidence across the city, in places only you would know to look.
3. **The door.** Officer Hale walks you to washroom 2. In a short scene in the room you turn round to the open door, see him in the corridor light, and watch him swing the door shut and lock it. Through the door he says: "Your ten minutes have begun. Not a second more." He waits outside.
4. **The rumour.** Inmates whisper about a hatch in the floor of this washroom, locked with a four-digit code. Three spots in the room hide a car key, the first two digits and the last two digits of the code, each behind a short Titanic mini game.
5. **How to play:** the controls.

The clock only starts when the player presses **Start the clock** after the briefing.

## Time

| Rule | Value |
|---|---|
| Time limit | **10:00** (open: 10 or 15 minutes; `TIME_LIMIT`) |
| Warnings from Hale | at 5:00, 2:00, 1:00 and 0:30, each only once |
| Wrong code | costs **30 seconds** (`WRONG_CODE_PENALTY`), never below 0:00 |
| Jammed door | when the clock hits 0:00 the first time, you get **one extra minute** (`WEDGE_GRACE`), once only |
| The clock stops | in the briefing, in the pause menu (which also opens when the browser tab is hidden or the window loses focus), and after an ending |
| The clock keeps running | while reading a clue, while reading how a mini game works, while playing it and while turning the lock |

## Scenes and how to move

| Scene | What is there | You can walk to |
|---|---|---|
| **The Door** (start) | Steel door with a barred window, Hale outside; scratches in the wall beside it; mop in a bucket | Sinks, Stall |
| **The Sinks** | Two steel sinks, a polished metal mirror, an empty soap dish, a hot tap | Door, Stall |
| **The Stall** | Steel toilet, scratches on the wall, a crooked tile, the hatch in the floor | Door, Sinks, Hatch |
| **The Hatch** | The trapdoor with a four-wheel combination lock (you kneel down) | Stall |
| **The Tunnel** | Only reached through Ending A: a ladder down, a vaulted passage and an old door at its far end | – |

You walk freely through the washroom in the first person. Where you stand decides your scene: the stall (inside it or right in front of its doorway), the sinks (the west end of the room) or the door (everywhere else). You have to be well inside a new part of the room before it counts, so walking along a border never switches back and forth. The description of a scene is shown the first time you walk in. The Hatch is the only scene you do not walk into: in the stall you click the hatch (or its marker) to kneel down at the lock, and any step stands you up again. Walls, the sink counter, the bin, the bucket, the stall partitions, its open door and the toilet block your way.

You see your own hands at the bottom of the picture: real hand models with a joint in every finger, in the black and sand stripes of the prison uniform. At rest they hang relaxed and never quite still: they breathe, drift a little, and now and then make a small gesture of their own (a loose fist, a tap of the index finger, a stretch of the fingers, the thumb rubbing the fingertips). As you walk, the arms swing like in a real walk, opposite to each other, every swing a little different; the wrists trail behind the arms and the fingers close a little on the back swing and open on the forward swing. Your head dips at every footfall, a little more or less with each step, and sways gently from one foot to the other. You hear every footfall: real recordings of hard shoes on the concrete floor (the heel, then the sole), a splash when you step into a puddle and boots on the wooden rungs of the ladder, each step a little different, with the echo of the bare concrete room. The arms trail behind when you turn your head, and the right hand opens and reaches out whenever you use something. If the hand models cannot load (for example when the page is opened straight from the folder), simpler drawn hands stand in. They never disappear into a wall, and they are hidden during the endings, except while you walk through the tunnel after Ending A. They change nothing in the rules.

Look down and you see yourself, the way you would in real life: the front of the striped shirt with its buttons, your belt line, your legs in the striped trousers and your leather work boots on the floor, and your hands hanging at your sides. Your head bends forward on your neck as you look down, so your eyes come forward over your chest, and you breathe. The feet stay planted where they stand: as you walk, one foot swings past the other at every footfall you hear, rolling off the ball of the foot and landing on the heel, the knees bend and the arms swing opposite to the legs; a step back or to the side steps that way, and turning on the spot makes you shuffle your feet round. Kneeling at the hatch you sit back on your heels with your knees on the floor and your hands on your thighs, and the right hand still reaches out to the lock. Your body throws a soft shadow on the floor away from the tube light (and from the stall lamp inside the stall), sharp at the boots and blurred higher up. The steel mirror only shows your hands, as before. All of this changes nothing in the rules.

On a laptop or desktop you only walk with the arrow keys; there are no buttons for it. A touch screen has no arrow keys, so there (and only there) "Walk to" buttons glide you to a fixed spot in another scene. Walking anywhere else is refused: "You cannot get there from here."

## Items (you can carry two)

| Item | Where | What it does |
|---|---|---|
| **Mop** | Bucket by the door | Optional. Used at the door ("Jam the door with the mop") it is placed under the door handle and leaves your inventory. This buys the extra minute. |
| **Car key** | In a hollow behind the crooked tile, once you have won the tile's mini game | Optional. A car key on a worn leather fob that someone hid there for you, a hint at the car waiting after Ending A. It opens nothing in this room. |

## Clues and the code

There are exactly **three clues**, one behind each of three spots. Clicking a spot opens a **mini game of at most 30 seconds**. Winning it gives the clue; losing it (or running out of the 30 seconds) gives nothing, and the same game can be tried again at once. Giving up (Esc or **Give up**), pausing or an ending stops the game without a result.

The **first time** a mini game comes up, a card explains it before it starts: the goal, how it works step by step, the controls (mouse and keyboard, or touch on a touch screen), the 30 seconds and the prize. The game and its 30 seconds start only with **Start the game** (or Enter); **Back to the room** (or Esc) closes the card, and it comes up again next time. The game clock keeps running while you read. After you have started a game once, it opens at once: when you try again after a loss or come back after giving up. A new game shows every card again.

| Spot | Where | Condition | Clue when won |
|---|---|---|---|
| **The crooked tile** | The Stall | – | The tile comes off and the **car key** lies behind it (take it with "Car key behind the tile") |
| **Writing on the mirror** | The Sinks | Only while the **hot tap** runs and steams the mirror up. Without steam you only see your face, and no game opens. | The **first two digits**: "UNSINKABLE? 19 _ _" appears in the steam |
| **Scratches by the door** | The Door | – | The **last two digits**: "_ _ 1 2" is gouged into the wall |

- The code is **1912**, the year the Titanic sank. It is the **same in every game**.
- A won clue is kept in your clue notes and can be read again at its spot; its mini game cannot be played again.
- The **graffiti** on the stall wall ("She was unsinkable. She sailed only once. The year opens the floor.") is a hint, not one of the three clues.

### The nine mini games

At the start of every game, **three different games out of nine** are dealt at random to the three spots (tile, mirror, scratches), so every round plays differently. The rules check that the three are different; the room deals them (`MiniGames.pickGames` in `room-1-escape/js/minigames.js`).

| Game | How to win in 30 seconds |
|---|---|
| **Battleship** | Two 6 × 6 grids, three ships each (3, 2 and 2 cells). As in the real game, ships never touch, not even at a corner; once a ship is sunk, the water around it is marked and cannot be fired at. Fire at the enemy waters; a hit lets you fire again. Sink all enemy ships before the bot sinks yours. The bot fires at random or, half the time, next to one of its hits. |
| **Spot the difference** | Two pictures of the Titanic at night; the right one has 5 changes, chosen from 9. Click all five, in either picture. A wrong click costs 2 seconds. |
| **Tic-tac-toe** | Your anchors against the bot's icebergs, you start. Three in a row wins, a draw starts a new round. The bot always takes a winning cell, blocks three times out of four, likes the centre, otherwise plays at random. |
| **Deck run** | As a sailor of the Titanic, run to the bow on the icy night of 14 April 1912: first along the side of the ship past its round portholes, then out on the open deck past the railing with its life rings, the lifeboats, a funnel and the foremast. Jump (Space, ↑ or a click) over crates, steamer trunks, barrels and blocks of ice. Each obstacle knocks you down exactly where it is drawn. Three knocks and you are out. |
| **Deck climb** | As the same sailor, bounce up through the Titanic: the engine room (boilers, furnaces, pipes), the crew quarters (bunks and lockers), second class (oak-panelled corridors and the library) and first class, the longest level, twice as tall as the others (the Grand Staircase with its glass dome, chandeliers, the clock "Honour and Glory" and the bronze cherub). The game is won the moment you land on the boat deck with its funnels and lifeboats above first class; there is nothing to climb above it. Steer with ← → or the mouse. Lifebuoys bounce you higher. Falling back down loses. |
| **Lifeboat jump** | The Titanic goes down by the bow and her stern rises out of the sea. As the same sailor as in the deck run and the deck climb, jump from the stern **three times**, onto a lifeboat, a collapsible boat and a cork raft, each smaller than the last, while the stern rises higher with every jump. A power meter swings from short to far; Space, ↑ or a click (a tap) stops it and you jump. In the air, steer a little with ← → (A D) or by pressing the left or right half of the picture. The boats drift slowly; a lantern on a pole marks the middle of each. A landing in the middle scores 100 points, on the edge 30, in the sea 0. **180 points** win; the game ends as soon as 180 can no longer be reached. A fair player is done in about 11 seconds. |
| **Pinball** | A vintage White Star Line table in walnut, cream, brass and burgundy. Score **1,500 points** with three balls. Flippers: ← and → (A and D), Space for both, or press the left or right half of the table; the ball shoots by itself (or with Space). Points: pop bumper 150, lifebuoy target 250, slingshot 10, each R-M-S lane 100 and all three lanes 1,000 more, and 250 for every flipper shot that reaches the crow's nest bell at the top. A fair player gets there in about 15 seconds; losing all three balls loses. |
| **Hacking** | Break into an old control machine in the Titanic's engine room, a riveted steel panel with brass plates, lamps and leaking steam: **two parts**, each played once, before the **firewall** burning in its furnace locks you out. Part 1: on the indicator card (cream paper on a brass drum) change the frequency (← →, A D) and the amplitude (↑ ↓, W S) of your red ink line until it lies on the dashed blue master line (a sync reading shows how close you are), then lock it with Space; on a touch screen tap the brass buttons under the card. Part 2: four key plates with brass pegs (6 × 6), only one matches the master key plate peg for peg, each decoy has two pegs changed; choose with ← → and Space or click it. The firewall burns up by itself in 16 seconds and every wrong lock or wrong plate adds 15 %; full means locked out. Winning shows FULL AHEAD. A fair player gets in in about 8 seconds. |
| **Conducting** | The night the Titanic sank, her band played on to the end. You conduct it in the **first-class dining saloon** (white Jacobean panelling, leaded windows glowing amber, tables laid with white cloths and rose-shaded lamps), which tilts more and more as the ship goes down while its chandeliers still hang plumb. The five musicians are sailors in the style of the deck run and the deck climb (navy jumpers with the square striped collar, round caps with ribbons): two violins and a viola on the left, a cello and a double bass on the right, you in tails in front, seen from behind with the baton. The band plays the opening of Bach's *Brandenburg Concerto No. 3* (a CC0 recording, `room-1-escape/sounds/orchestra.mp3`, a steady 117 beats a minute). The first **four beats are counted in** (1, 2, 3, 4, strokes there are free); then bring the baton down on **every beat** with Space, ↑ (W), a click or a tap, just as the golden ring closes on the baton's tip. A stroke within **0.18 s** of the beat counts (within 0.08 s it is PERFECT); a beat with no stroke, or a stroke off the music (too early, or a second one), puts the band out of time. **24 beats in time win** (about 15 seconds without a miss); **12 out of time lose**. If the recording has not loaded, a plain plucked beat at the same tempo plays instead; the volume and mute of the room apply. |

## The lock

- Four wheels, each showing 0–9. Up after 9 is 0, down after 0 is 9.
- You can only turn the wheels and try the code while kneeling at the hatch.
- **Try the code:**
  - Right code: the hatch opens, Ending A.
  - Wrong code: "Clunk. The lock holds." Hale hears the noise, and you lose 30 seconds. The number of wrong codes is counted.

## Endings

| Ending | When | What happens |
|---|---|---|
| **A · Out below** | The right code before time runs out | You climb down the ladder. A note is taped to it: "Took you long enough. A car is waiting at the end of the tunnel. — H." The guard wanted you out. That is the plot twist that leads to room 2. At the bottom you walk through the tunnel yourself (the arrow keys; on a touch screen a "Walk to the door" button) to the old door at its far end. The clock has stopped: the walk costs no time. The door only opens from right in front of it; clicked from further away it is refused: "The door is at the far end of the tunnel. Walk up to it first." Opened, it creaks and swings out: behind it the car waits in a garage, its headlights shining at you. Then the ending card shows. |
| **B · Back to the cell** | The clock reaches 0:00 (after the extra minute, if the door was jammed) | The door bangs open and Hale and two officers take you back to cell 4471. |

**The earlier decision:** jamming the door early gives one more minute at the very end. That can turn Ending B into Ending A.

After an ending, every action is refused except **Play again / Try again**, which starts a new game from the briefing.

## Refused actions (nothing changes, the player is told why)

| The player tries to... | Message (short) |
|---|---|
| do anything before the briefing is finished | "Read the briefing first." |
| walk where there is no way | "You cannot get there from here." |
| take an item that is not here, or twice | "There is no ... here." / "You already have the ..." |
| jam the door without the mop, or a second time | "You need something long and solid..." / "The door is already jammed." |
| take the car key while the tile is still on | "The tile is still in place." |
| play the mirror's mini game while it is dry | No game opens: "Just your own tired face in the scratched metal..." |
| play a mini game that is already won, or from another place | "You already have this clue..." / "You cannot reach that from here." |
| read a clue before its mini game is won | "You have not won this clue yet. Try the mini game first." |
| use the tap away from the sinks, the lock away from the hatch | "There is no tap here." / "Kneel down at the hatch to reach the lock." |
| turn a wheel that does not exist | "The lock only has four wheels." |
| do anything after an ending | "The story is over. Start a new game to play again." |

## Saving

- The game is saved in the browser after **every accepted action** and every few seconds while the clock runs.
- After a reload, the player can **Continue** (with the time that was left) or start a **New game**, which asks for confirmation first.
- A saved game is checked field by field when loaded. Anything that is not a real save is ignored, and a new game starts.

## Controls

| Input | Action |
|---|---|
| Arrow keys (or `W A S D`) | Walk: up and down forwards and backwards, left and right sideways |
| Drag the mouse or a finger | Look around, all the way round |
| Click a pulsing marker or the object itself | Use it (the tile, the mirror and the scratches open their mini game) |
| Enter / Esc on a mini game's first card | Start the game / back to the room |
| Space, arrow keys, mouse | Play a mini game (see each game); while a game is open you do not walk |
| "Walk to" buttons (touch screens only) | Glide to another scene |
| "Clues" button (bottom left) | Read your clue notes |
| `P` / `Esc` | Pause (Esc also closes a card) |
| `M` | Sound on or off |
| Volume slider | On the pause card, 0 to 100 %. It is kept for the next visit |
| `Enter` | Confirm the main button on a card |
