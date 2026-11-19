// ### Unit tests for the nine Titanic mini games (room-1-escape/js/minigames.js): dealing, the bots, the fleets and the
// ### spot-the-difference circles. The drawing and the controls are played in the browser tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../room-1-escape/js/minigames.js');
const R = require('../../room-1-escape/js/rules.js');

// a small seeded random number generator, so every run of these tests sees the same numbers
const seeded = a => () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };

test('there are nine games, the same nine the rules know, each at most 30 seconds', () => {
  assert.deepEqual(M.GAMES, R.GAMES);
  assert.equal(M.TIME, 30);
  for (const g of M.GAMES) assert.ok(M.INFO[g].title && M.INFO[g].how && M.INFO[g].name, g);
});

test('every game has the words for the card that explains it before its first play', () => {
  for (const g of M.GAMES){
    const i = M.INFO[g];
    assert.ok(i.goal && i.keys && i.touch, g);
    assert.ok(Array.isArray(i.steps) && i.steps.length >= 2 && i.steps.every(t => typeof t === 'string' && t.length > 10), g);
    // the card is filled with esc(): no markup in these words
    assert.ok(![i.goal, i.keys, i.touch, ...i.steps].some(t => /[<>]/.test(t)), g);
  }
});

test('every new game deals three different mini games, and over many games all nine come up', () => {
  const seen = new Set(), rand = seeded(7);
  for (let i = 0; i < 200; i++){
    const g = M.pickGames(rand);
    assert.equal(g.length, 3);
    assert.equal(new Set(g).size, 3, 'no game twice in one round');
    g.forEach(x => seen.add(x));
    assert.ok(R.perform(R.newState(), 'start', g).ok, 'the rules accept every deal');
  }
  assert.equal(seen.size, 9);
});

test('tic-tac-toe: lines, draws, and a bot that always wins when it can and can be beaten', () => {
  assert.equal(M.tttWinner(['X', 'X', 'X', '', '', '', '', '', '']), 'X');
  assert.equal(M.tttWinner(['O', '', '', '', 'O', '', '', '', 'O']), 'O');
  assert.equal(M.tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw');
  assert.equal(M.tttWinner(Array(9).fill('')), null);
  assert.equal(M.tttBot(['O', 'O', '', 'X', 'X', '', '', '', ''], () => .99), 2, 'takes the win instead of blocking');
  assert.equal(M.tttBot(['X', 'X', '', '', 'O', '', '', '', ''], () => 0), 2, 'blocks when it decides to');
  assert.equal(M.tttBot(Array(9).fill('X'), Math.random), -1, 'no move on a full board');
  // a player who plays the first free cell that wins, else blocks, else the centre, else the first free: wins some games
  const rand = seeded(3); let wins = 0;
  for (let n = 0; n < 200; n++){
    const b = Array(9).fill('');
    while (!M.tttWinner(b)){
      const free = b.map((c, i) => c ? -1 : i).filter(i => i >= 0);
      const fin = who => free.find(i => { const t = b.slice(); t[i] = who; return M.tttWinner(t) === who; });
      let m = fin('X'); if (m === undefined) m = fin('O'); if (m === undefined) m = !b[4] ? 4 : free[0];
      b[m] = 'X';
      if (M.tttWinner(b)) break;
      const bm = M.tttBot(b, rand);
      assert.equal(b[bm], '', 'the bot plays a free cell');
      b[bm] = 'O';
    }
    if (M.tttWinner(b) === 'X') wins++;
  }
  assert.ok(wins > 40, `the bot can be beaten (${wins} of 200)`);
});

test('battleship: fleets of three straight ships that never overlap or touch, and a bot that only fires at new cells', () => {
  const rand = seeded(11);
  for (let i = 0; i < 100; i++){
    const f = M.placeFleet(6, [3, 2, 2], rand);
    assert.deepEqual(f.map(s => s.length), [3, 2, 2]);
    const all = f.flat();
    assert.equal(new Set(all).size, 7, 'no two ships on one cell');
    assert.ok(all.every(c => c >= 0 && c < 36));
    for (const s of f){
      const rows = new Set(s.map(c => Math.floor(c / 6))), cols = new Set(s.map(c => c % 6));
      assert.ok(rows.size === 1 || cols.size === 1, 'straight');
      const step = rows.size === 1 ? 1 : 6;
      s.slice(1).forEach((c, k) => assert.equal(c - s[k], step, 'no gaps'));
    }
    // the real rule: ships never touch, not even at a corner
    for (const sh of f) for (const c of sh) for (const nb of M.around(6, c)) assert.ok(sh.includes(nb) || !all.includes(nb), 'ships touch at cell ' + c);
    const shots = new Set();
    while (!M.fleetSunk(f, shots)){ const c = M.bsBot(6, f, shots, rand); assert.ok(!shots.has(c) && c >= 0 && c < 36); shots.add(c); }
    assert.ok(shots.size <= 36);
  }
});

test('battleship: the water around a sunk ship is marked, and only around sunk ships', () => {
  assert.deepEqual(M.around(6, 0).sort((a, b) => a - b), [1, 6, 7], 'a corner has three neighbours');
  assert.equal(M.around(6, 14).length, 8);
  const ships = [[0, 1, 2], [20, 26]];
  assert.equal(M.waterAround(6, ships, new Set([0, 1])).size, 0, 'nothing while the ship still floats');
  assert.deepEqual([...M.waterAround(6, ships, new Set([0, 1, 2]))].sort((a, b) => a - b), [3, 6, 7, 8, 9]);
});

test('deck climb: four levels to climb from the engine room, first class the longest, and the boat deck is the goal', () => {
  assert.deepEqual(M.CLIMB_LEVELS.map(l => l.name), ['Engine room', 'Crew quarters', 'Second class', 'First class', 'Boat deck']);
  const [engine, crew, second, first, deck] = M.CLIMB_LEVELS.map(l => l.h);
  assert.ok(first > Math.max(engine, crew, second), 'first class is the longest level');
  assert.equal(deck, 0, 'nothing to climb above the boat deck: landing on it wins');
});

test('the icebergs on the pictures are hit by their outline', () => {
  const berg = M.icebergPoly(0, 300, 54, 100);
  assert.ok(M.inPoly(berg, 25, 290), 'inside near the base');
  assert.ok(M.inPoly(berg, 24, 205), 'just under the peak');
  assert.ok(!M.inPoly(berg, 3, 220), 'not in the empty corner beside the peak');
  assert.ok(!M.inPoly(berg, 25, 195), 'not above the peak');
});

// ### Lifeboat jump: a player who lets the game run, and one who jumps and steers like a person would.
const J = M.JUMP;
// where the flier lands (on the top of a boat) without more steering, and in how many seconds
function landing(p){ const top = J.SEA - J.DECK, t = (-p.vy + Math.sqrt(p.vy * p.vy + 2 * J.G * (top - p.y))) / J.G; return { x: p.x + p.vx * t, t }; }
function jumpPlay(seed, { noise, steer }){
  const rand = seeded(seed), aim = seeded(seed * 7 + 1), s = M.jumpNew(rand);
  let time = 0, want = null;
  while (!s.done && time < 60){
    const input = {};
    if (s.phase === 'aim'){
      if (want === null){
        // the power that lands where the boat will be, then a timing error of up to `noise`
        const st = M.jumpShip(s.n), b = s.boats[s.n];
        let best = 0, miss = Infinity;
        for (let pw = 0; pw <= 1; pw += .005){
          const l = landing({ x: st.sx, y: st.sy, vx: J.VMIN + pw * (J.VMAX - J.VMIN), vy: J.VY }), d = Math.abs(l.x - (b.x + b.vx * l.t));
          if (d < miss){ miss = d; best = pw; }
        }
        want = Math.max(0, Math.min(1, best + (aim() * 2 - 1) * noise));
      }
      if (s.t > .5 && Math.abs(s.power - want) < .02){ assert.ok(M.jumpAct(s, 'jump')); want = null; }
    } else if (s.phase === 'fly' && steer){
      const l = landing(s.p), b = s.boats[s.n], bx = b.x + b.vx * l.t;
      if (l.x < bx - 3) input.right = true; else if (l.x > bx + 3) input.left = true;
    }
    M.jumpStep(s, 1 / 60, input); time += 1 / 60;
  }
  return { s, time };
}

test('lifeboat jump: three boats, each smaller, the stern rising higher above the sea every jump, clear of the boats', () => {
  const sizes = J.BOATS.map(b => b.w);
  assert.equal(J.BOATS.length, J.JUMPS);
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], 'lifeboat, then collapsible, then raft');
  let last = Infinity;
  for (let n = 0; n < J.JUMPS; n++){
    const st = M.jumpShip(n);
    assert.ok(st.sy < last && st.sy > 40 && st.sy < J.SEA - 80, `the stern at jump ${n + 1} is high above the sea and higher than before`);
    assert.ok(st.sx > 20 && st.sx < J.LEFT - 100, 'the stern stands well left of the boats');
    last = st.sy;
  }
  const rand = seeded(3);
  for (let i = 0; i < 200; i++){
    const s = M.jumpNew(rand);
    for (let k = 0; k < 600; k++) M.jumpStep(s, 1 / 60, {});
    for (const b of s.boats) assert.ok(b.x - b.w / 2 >= J.LEFT - 1e-9 && b.x + b.w / 2 <= J.RIGHT + 1e-9, 'the boats drift but stay in the sea in front of the ship');
  }
});

test('lifeboat jump: 100 points in the middle, 30 on the edge, nothing in the sea; the meter swings from 0 to 1 and back', () => {
  assert.equal(M.jumpPoints(0, 80), 100);
  assert.equal(M.jumpPoints(40, 80), 30);
  assert.equal(M.jumpPoints(-40, 80), 30);
  assert.equal(M.jumpPoints(40.5, 80), 0);
  assert.equal(M.jumpPoints(20, 80), 65);
  assert.equal(M.jumpPower(0), 0);
  assert.ok(Math.abs(M.jumpPower(J.METER / 2) - 1) < 1e-9);
  assert.ok(M.jumpPower(J.METER * .99) < .05);
});

test('lifeboat jump: jumping is refused in the air, and landing in the middle of the boat scores 100', () => {
  const s = M.jumpNew(seeded(5));
  assert.equal(M.jumpAct(s, 'fly'), false, 'only "jump" is an action');
  M.jumpStep(s, .5, {});
  assert.ok(M.jumpAct(s, 'jump'));
  assert.equal(s.phase, 'fly');
  assert.equal(M.jumpAct(s, 'jump'), false, 'no second jump in the air');
  // put the flier right above the middle of the boat, falling
  const b = s.boats[0];
  b.vx = 0; s.p = { x: b.x, y: J.SEA - J.DECK - 20, vx: 0, vy: 200, dx: 0 };
  for (let k = 0; k < 30 && s.phase === 'fly'; k++) M.jumpStep(s, 1 / 60, {});
  assert.equal(s.phase, 'landed');
  assert.deepEqual(s.scores, [100]);
  assert.equal(s.total, 100);
});

test('lifeboat jump: a fair player wins in time, one who never steers mostly does not, and doing nothing loses', () => {
  let fair = 0, careless = 0, slowest = 0;
  for (let i = 1; i <= 200; i++){
    const a = jumpPlay(i, { noise: .1, steer: true });
    if (a.s.done === 'win') fair++;
    slowest = Math.max(slowest, a.time);
    if (jumpPlay(i, { noise: .1, steer: false }).s.done === 'win') careless++;
  }
  assert.ok(fair >= 190, `a fair player wins (${fair} of 200)`);
  assert.ok(slowest < M.TIME - 10, `with time to spare (${slowest.toFixed(1)} s)`);
  assert.ok(careless < 120, `steering matters (${careless} of 200 win without it)`);
  // jumping with the meter at zero every time lands in the sea; the game ends as soon as 180 is out of reach
  const s = M.jumpNew(seeded(11));
  let steps = 0;
  while (!s.done && steps++ < 5000){ if (s.phase === 'aim') M.jumpAct(s, 'jump'); M.jumpStep(s, 1 / 60, {}); }
  assert.equal(s.done, 'lose');
  assert.deepEqual(s.scores, [0, 0], 'over after two misses: one jump cannot make 180');
});

test('deck run: every obstacle is a plain box, so what you see is exactly what knocks you down', () => {
  for (const [k, b] of Object.entries(M.RUN_KINDS)){
    assert.ok(Number.isInteger(b.w) && Number.isInteger(b.h) && b.w > 0 && b.h > 0, k);
    assert.ok(b.h <= 30, `${k} can be jumped`);
  }
});

test('deck run: first the portholes along the side of the ship, then the open deck with its rings, and the bow after the finish', () => {
  const { PROMENADE_END: PE, LEN, BOW0, BOW } = M.RUN;
  for (const seed of [1, 2, 3]){
    const L = M.runLayout(seeded(seed));
    assert.ok(L.portholes.length > 20 && L.portholes.every(x => x < PE), 'portholes only along the covered side');
    for (const k of ['rings', 'benches', 'vents', 'bollards', 'boats']){
      assert.ok(L[k].length > 0 && L[k].every(x => x > PE && x < LEN), `${k} on the open deck`);
    }
    assert.ok(L.funnel > PE && L.mast > PE && L.mast < LEN, 'funnel and mast on the open deck');
  }
  // the deck only narrows to the stem beyond the finish, so the sailor never runs out over the sea
  assert.ok(BOW0 > LEN && BOW > BOW0);
});

// a fair pinball player: flips a flipper when the ball is just above it and coming down
function pinPlayer(s){
  const b = s.ball, keys = { left: false, right: false };
  s.hold = s.hold || [0, 0];
  M.PIN_TABLE.flippers.forEach((f, i) => {
    if (s.hold[i] > 0){ s.hold[i] -= 1 / 60; return; }
    if (!b || b.ready) return;
    const along = i ? f.x - b.x : b.x - f.x, surf = f.y + Math.tan(i ? Math.PI - s.flip[i].a : s.flip[i].a) * along;
    if (along > 8 && along < f.len + 4 && b.y > surf - 26 && b.y < surf && b.vy > -50) s.hold[i] = .16;
  });
  keys.left = s.hold[0] > 0; keys.right = s.hold[1] > 0;
  return keys;
}
// plays one pinball game for up to 30 s; returns the score and whether the goal was reached in time
function pinGame(seed, player){
  const s = M.pinNew(seeded(seed));
  let lost = false;
  for (let t = 0; t < 30 && !s.gone && s.score < M.PIN.GOAL; t += 1 / 60){
    M.pinStep(s, 1 / 60, player ? player(s) : {});
    if (s.ball && !s.ball.ready && (s.ball.x < 16 || s.ball.x > 352 || s.ball.y < 60)) lost = true;
    s.events.length = 0;
  }
  return { score: s.score, won: s.score >= M.PIN.GOAL, lost };
}

test('pinball: the goal can be reached in 30 seconds by playing the flippers, but hardly ever without them', () => {
  const games = 60, played = [], idle = [];
  for (let seed = 1; seed <= games; seed++){ played.push(pinGame(seed, pinPlayer)); idle.push(pinGame(seed, null)); }
  assert.ok(played.concat(idle).every(g => !g.lost), 'the ball never leaves the table except down the drain');
  assert.ok(played.filter(g => g.won).length >= games * .9, 'a fair player makes it in nine games out of ten');
  assert.ok(idle.filter(g => g.won).length <= games * .1, 'without touching the flippers you almost never make it');
});

test('pinball: the flippers swing between rest and up, and rolling through R, M and S gives the bonus', () => {
  const s = M.pinNew(seeded(3));
  M.pinStep(s, 1 / 60, {});
  for (let i = 0; i < 10; i++) M.pinStep(s, 1 / 60, { left: true });
  assert.equal(s.flip[0].a, M.PIN_TABLE.flippers[0].up);
  assert.equal(s.flip[1].a, M.PIN_TABLE.flippers[1].rest);
  for (let i = 0; i < 10; i++) M.pinStep(s, 1 / 60, {});
  assert.equal(s.flip[0].a, M.PIN_TABLE.flippers[0].rest);
  // roll the ball down through each of the three lanes in turn
  const before = s.score;
  for (const lane of M.PIN_TABLE.lanes){
    s.ball = { x: lane.x, y: 100, vx: 0, vy: 30 }; s.out = true;
    M.pinStep(s, 1 / 60, {});
    s.ball = { x: lane.x, y: 200, vx: 0, vy: 0 }; M.pinStep(s, 1 / 60, {});
  }
  assert.ok(s.score - before >= 3 * M.PIN.SCORE.lane + M.PIN.SCORE.bonus, 'three lanes and the bonus');
  assert.deepEqual(s.lit, [false, false, false], 'the lanes light up again from the start');
});

test('pinball: a lost ball comes back on the plunger until all three are gone', () => {
  const s = M.pinNew(seeded(5));
  for (let n = 3; n > 0; n--){
    M.pinStep(s, 1 / 60, {});
    assert.equal(s.balls, n);
    s.ball = { x: 171, y: M.PIN.H + 30, vx: 0, vy: 100 }; s.out = true;
    M.pinStep(s, 1 / 60, {});
  }
  assert.equal(s.balls, 0); assert.ok(s.gone);
});

test('spot the difference: five differences each game, found only once and only near the right place', () => {
  const d = M.pickDiffs(seeded(5));
  assert.equal(d.length, 5);
  assert.equal(new Set(d.map(x => x.id)).size, 5);
  const found = d.map(() => false);
  assert.equal(M.hitDiff(d, found, d[2].x + 3, d[2].y - 3), 2);
  found[2] = true;
  assert.equal(M.hitDiff(d, found, d[2].x, d[2].y), -1, 'a found difference does not count twice');
  assert.equal(M.hitDiff(d, found, -100, -100), -1, 'a click far away is wrong');
  assert.ok(M.DIFFS.every(x => x.x - x.r >= 0 && x.x + x.r <= 310 && x.y - x.r >= 0 && x.y + x.r <= 290), 'every circle lies inside the picture');
});

test('overlap of two boxes, used by the three action games', () => {
  assert.ok(M.overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!M.overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), 'touching edges do not count');
});

// a hacker who takes `think` seconds to size up each part and `press` seconds for each key press after that
function hackPlayer(s, think, press){
  const wait = sec => { for (let k = 0; k < Math.round(sec * 60) && !s.lost; k++) M.hackStep(s, 1 / 60); };
  let layer = -1;
  while (!s.won && !s.lost){
    const L = s.layers[s.layer];
    if (s.layer !== layer){ layer = s.layer; wait(think); if (s.lost) break; }
    let a;
    if (L.kind === 'wave') a = L.f < L.tf ? 'freq+' : L.f > L.tf ? 'freq-' : L.a < L.ta ? 'amp+' : L.a > L.ta ? 'amp-' : 'lock';
    else a = L.options.findIndex(o => o.join('') === L.target.join(''));
    M.hackAct(s, a);
    wait(press);
  }
  return s;
}

test('hacking: two parts, each played once: a wave that starts off the target, then a key plate', () => {
  for (let seed = 1; seed <= 200; seed++){
    const s = M.hackNew(seeded(seed));
    assert.deepEqual(s.layers.map(l => l.kind), ['wave', 'fragment']);
    for (const L of s.layers){
      if (L.kind === 'wave'){
        assert.ok(L.f !== L.tf && L.a !== L.ta, 'frequency and amplitude both start wrong');
        assert.ok(L.f >= 1 && L.f <= M.HACK.FREQS && L.tf >= 1 && L.tf <= M.HACK.FREQS && L.a >= 1 && L.a <= M.HACK.AMPS && L.ta >= 1 && L.ta <= M.HACK.AMPS);
        assert.ok(M.hackSync(L) < 1);
      } else {
        const keys = L.options.map(o => o.join(''));
        assert.equal(L.options.length, 4); assert.equal(new Set(keys).size, 4, 'four different plates');
        assert.equal(keys.filter(k => k === L.target.join('')).length, 1, 'exactly one matches');
        assert.equal(keys[L.answer], L.target.join(''));
        assert.equal(L.target.length, L.n * L.n);
      }
    }
  }
});

test('hacking: a right lock finishes the part, a wrong one feeds the firewall, and a full firewall locks you out', () => {
  const s = M.hackNew(seeded(4)), w = s.layers[0];
  assert.equal(M.hackAct(s, 'lock'), true);
  assert.equal(s.layer, 0, 'refused: the wave does not match');
  assert.equal(s.fire, M.HACK.WRONG);
  w.f = w.tf; w.a = w.ta;
  assert.equal(M.hackSync(w), 1);
  M.hackAct(s, 'lock');
  assert.equal(s.layer, 1, 'the matching wave finishes part 1');
  const f = s.layers[1], wrong = (f.answer + 1) % 4;
  M.hackAct(s, wrong);
  assert.equal(s.layer, 1, 'refused: a decoy plate'); assert.ok(!s.won);
  assert.ok(Math.abs(s.fire - 2 * M.HACK.WRONG) < 1e-9);
  M.hackAct(s, 'right'); assert.equal(f.sel, (wrong + 1) % 4, 'the arrows move the selection');
  assert.equal(M.hackAct(s, 'freq+'), false, 'refused: no wave on the key plate part');
  M.hackAct(s, f.answer);
  assert.ok(s.won, 'the right plate finishes part 2, and with it the game');
  assert.equal(M.hackAct(s, 'lock'), false, 'refused: nothing to do once won');
  // the firewall fills by itself in 16 seconds
  const idle = M.hackNew(seeded(9));
  for (let t = 0; t < 15.9; t += 1 / 60) M.hackStep(idle, 1 / 60);
  assert.ok(!idle.lost);
  for (let t = 0; t < .2; t += 1 / 60) M.hackStep(idle, 1 / 60);
  assert.ok(idle.lost);
  assert.equal(M.hackAct(idle, 'lock'), false, 'refused: nothing to do once locked out');
  // every wrong lock costs 15 %, so seven in a row fill the firewall
  const rush = M.hackNew(seeded(2));
  for (let i = 0; i < 7; i++) M.hackAct(rush, 'lock');
  assert.ok(rush.lost, 'seven wrong locks fill the firewall');
});

test('hacking: the frequency and amplitude stay in range', () => {
  const s = M.hackNew(seeded(6)), w = s.layers[0];
  for (let i = 0; i < 20; i++) M.hackAct(s, 'freq+');
  assert.equal(w.f, M.HACK.FREQS);
  assert.equal(M.hackAct(s, 'freq+'), false, 'refused: already at the top');
  for (let i = 0; i < 20; i++) M.hackAct(s, 'amp-');
  assert.equal(w.a, 1);
  assert.equal(s.fire, 0, 'turning the knobs costs nothing');
});

test('hacking: a fair player makes it in time, a slow or guessing one does not', () => {
  let fair = 0, slow = 0, guess = 0;
  for (let seed = 1; seed <= 100; seed++){
    if (hackPlayer(M.hackNew(seeded(seed)), 3, .3).won) fair++;
    if (hackPlayer(M.hackNew(seeded(seed)), 8, .4).won) slow++;
    // a guesser locks at once on every part without looking
    const g = M.hackNew(seeded(seed));
    for (let k = 0; k < 40 && !g.won && !g.lost; k++){ M.hackAct(g, 'lock'); M.hackStep(g, .5); }
    if (g.won) guess++;
  }
  assert.equal(fair, 100, 'three seconds to read each part always makes it');
  assert.ok(slow <= 10, 'eight seconds per part hardly ever does');
  assert.equal(guess, 0, 'guessing never does');
});

// ### Conducting: a player who strokes the baton on every beat, off by `late` seconds plus a random spread of up to
// ### `spread` either way, starting with the first conducted beat; every `skip`-th beat left out.
function conductor(late, spread, rand, skip){
  const s = M.condNew();
  for (let i = M.COND.COUNT; i < M.COND.BEATS && !s.won && !s.lost; i++){
    if (skip && (i - M.COND.COUNT) % skip === skip - 1) continue;
    const t = M.condBeat(i) + late + (rand() * 2 - 1) * spread;
    M.condStep(s, t); M.condTap(s, t);
  }
  M.condStep(s, 99);
  return s;
}

test('conducting: the beats lie where the recording has them, and the game fits in its 30 seconds', () => {
  assert.ok(Math.abs(60 / M.COND.BEAT - 117) < .1, 'Bach at 117 beats a minute');
  assert.ok(M.condBeat(M.COND.COUNT + M.COND.GOAL - 1) < 20, 'a player who never misses wins well within the 30 s');
  assert.ok(M.condBeat(M.COND.BEATS - 1) > M.TIME, 'the music never runs out before the clock');
  assert.ok(fs.statSync(path.join(__dirname, '../../room-1-escape/sounds/orchestra.mp3')).size > 100000, 'the recording is there');
});

test('conducting: a stroke on the beat counts, a stroke off it or a missed beat counts against you', () => {
  const s = M.condNew(), b = M.condBeat(M.COND.COUNT);
  assert.equal(M.condTap(s, M.condBeat(1)), 'count', 'the count-in is free');
  assert.equal(s.misses, 0);
  assert.equal(M.condTap(s, b + .03), 'perfect');
  assert.equal(M.condTap(s, b + .1), 'early', 'refused: a second stroke right after the beat is off the music');
  assert.equal(s.misses, 1);
  assert.equal(M.condTap(s, M.condBeat(M.COND.COUNT + 1) - .12), 'good', 'a little early still counts');
  assert.equal(M.condTap(s, M.condBeat(M.COND.COUNT + 2) - .3), 'early', 'refused: too early');
  M.condStep(s, M.condBeat(M.COND.COUNT + 2) + M.COND.GOOD + .01);
  assert.equal(s.misses, 3, 'a beat with no stroke is missed');
  assert.equal(s.last.kind, 'missed');
  assert.deepEqual([s.hits, s.perfect, s.next], [2, 1, M.COND.COUNT + 3]);
  // doing nothing loses after ten beats
  const idle = M.condNew();
  M.condStep(idle, M.condBeat(M.COND.COUNT + M.COND.MISSES - 1) + M.COND.GOOD - .01);
  assert.ok(!idle.lost);
  M.condStep(idle, M.condBeat(M.COND.COUNT + M.COND.MISSES - 1) + M.COND.GOOD + .01);
  assert.ok(idle.lost, 'twelve missed beats and the band falls apart');
  assert.equal(M.condTap(idle, 20), null, 'refused: nothing to conduct once it is lost');
});

test('conducting: a fair player keeps the band in time, a guessing or hurried one does not', () => {
  const rand = seeded(11);
  for (let k = 0; k < 50; k++){
    assert.ok(conductor(0, .06, rand).won, 'within 60 ms always wins');
    assert.ok(conductor(.08, .05, rand).won, 'a steady player a little late wins too');
    assert.ok(conductor(0, .15, rand).won, 'an unsteady player up to 0.15 s off wins as well');
    assert.ok(conductor(.1, .06, rand).won, 'so does a player who is always a tenth of a second late');
  }
  let half = 0, sloppy = 0, mash = 0, random = 0;
  for (let k = 0; k < 50; k++){
    if (conductor(0, .02, rand, 2).won) half++;            // only every other beat
    if (conductor(0, .4, rand).won) sloppy++;              // up to 0.4 s off, almost a whole beat of guessing
    // mashing the button eight times a second, or stroking at random about twice a second
    const m = M.condNew(); for (let t = 0; t < 30 && !m.won && !m.lost; t += .125) M.condTap(m, t); if (m.won) mash++;
    const r = M.condNew(); for (let t = 0; t < 30 && !r.won && !r.lost; t += .2 + rand() * .6) M.condTap(r, t); if (r.won) random++;
  }
  assert.equal(half, 0, 'half the beats is not enough');
  assert.ok(sloppy <= 5, `four tenths of a second off hardly ever does (${sloppy} of 50)`);
  assert.equal(mash, 0, 'mashing never does');
  assert.ok(random <= 20, `random strokes win well under half the time (${random} of 50)`);
  assert.ok(conductor(0, .02, rand, 8).won, 'missing a beat now and then is fine');
});
