// ### Unit tests for input validation: saved data, menu choices and keys that are not allowed.
// Player input: menu actions, menu picks, keys and stored data (room-2-chase/js/core.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../room-2-chase/js/core.js');

const STATES = ['menu', 'play', 'pause', 'done', 'over'];
const allowedIn = (action, story) => STATES.filter(state => Core.actionAllowed(action, { state, story }));

test('accepted: each menu action works in the states whose cards show it', () => {
  assert.deepEqual(allowedIn('go', null), ['menu']);
  assert.deepEqual(allowedIn('resume', null), ['pause']);
  // drive out of the garage door at green: only while in the garage
  assert.equal(Core.actionAllowed('drive-out', { state: 'garage', story: null }), true);
  assert.deepEqual(allowedIn('drive-out', null), []);
  assert.deepEqual(allowedIn('again', null), ['pause', 'done', 'over']);
  assert.deepEqual(allowedIn('menu', null), ['menu', 'pause', 'done', 'over']);
  assert.deepEqual(allowedIn('story', null), ['menu']);
  const story = Core.newStory();
  assert.deepEqual(allowedIn('story', story), ['menu', 'done'], 'the story can be played again from its ending');
  assert.deepEqual(allowedIn('act', story), ['menu', 'done']);
  assert.deepEqual(allowedIn('retry-act', story), ['pause', 'over']);
  // after the whole night: everything again from room 1, or out to the start page; only from the end screen
  assert.deepEqual(allowedIn('night', null), ['done']);
  assert.deepEqual(allowedIn('exit', null), ['done']);
});

test('rejected: nothing on a card can run while driving', () => {
  for (const a of ['go', 'story', 'again', 'resume', 'menu', 'act', 'retry-act']) assert.equal(Core.actionAllowed(a, { state: 'play', story: Core.newStory() }), false, a);
});

test('rejected: story actions without a story, and there is no next act any more', () => {
  for (const a of ['act', 'retry-act']) assert.deepEqual(allowedIn(a, null), [], a);
  // the story has one act: the button of the acts that were removed does nothing in any state
  assert.deepEqual(allowedIn('next-act', Core.newStory()), []);
  assert.deepEqual(allowedIn('next-act', null), []);
});

test('rejected: unknown, empty or malformed actions', () => {
  for (const a of ['', 'delete', 'GO', 'constructor', '__proto__', undefined, null, 42]) assert.equal(Core.actionAllowed(a, { state: 'menu', story: null }), false, String(a));
  assert.equal(Core.actionAllowed('go', undefined), false);
  assert.equal(Core.actionAllowed('go', { state: 'loading' }), false);
});

test('menu picks: Lisbon and the three vehicles are accepted, everything else is rejected', () => {
  const sel = { mode: 'city', veh: 'car' };
  assert.ok(Core.applyPick(sel, 'mode', 'city'));
  assert.ok(Core.applyPick(sel, 'veh', 'truck'));
  assert.deepEqual(sel, { mode: 'city', veh: 'truck' });
  // the highway and the countryside are gone: they are refused like any map that does not exist
  for (const [field, val] of [['mode', 'highway'], ['mode', 'country'], ['mode', 'moon'], ['veh', 'tank'], ['veh', 'constructor'], ['mode', '__proto__'], ['mode', 'toString'], ['color', 'red'], ['__proto__', 'city'], ['mode', null], ['veh', 1]]){
    assert.equal(Core.applyPick(sel, field, val), false, `${field}=${val}`);
  }
  assert.deepEqual(sel, { mode: 'city', veh: 'truck' }, 'rejected picks change nothing');
  assert.equal(Object.getPrototypeOf(sel), Object.prototype);
});

test('stored selection: valid data is restored, tampered data falls back to defaults', () => {
  assert.deepEqual(Core.parsePick('{"mode":"city","veh":"bike"}'), { mode: 'city', veh: 'bike' });
  assert.deepEqual(Core.parsePick('{"mode":"city","veh":"jet"}'), { mode: 'city', veh: 'car' });
  // a selection saved when the highway and the countryside still existed falls back to Lisbon and keeps its vehicle
  assert.deepEqual(Core.parsePick('{"mode":"country","veh":"bike"}'), { mode: 'city', veh: 'bike' });
  assert.deepEqual(Core.parsePick('{"mode":"highway","veh":"truck"}'), { mode: 'city', veh: 'truck' });
  const fallback = { mode: 'city', veh: 'car' };
  for (const raw of [null, undefined, '', 'not json', '{', '[]', '"city"', '42', 'null', '{"mode":"constructor","veh":"__proto__"}', '{"mode":"hasOwnProperty"}', '{"__proto__":{"mode":"x"}}', 'x'.repeat(5000)]){
    assert.deepEqual(Core.parsePick(raw), fallback, String(raw).slice(0, 40));
  }
});

test('stored best times: only plausible positive seconds are accepted', () => {
  assert.equal(Core.parseBest('83.4'), 83.4);
  assert.equal(Core.parseBest(' 120 '), 120);
  for (const raw of [null, '', 'abc', '-5', '0', '0.01', '9.9', '901', '3599', 'NaN', 'Infinity', '1e9', '99999', '12abc', '0x10', '[]']) assert.equal(Core.parseBest(raw), null, String(raw));
});

test('keys: WASD and arrows drive, space is the handbrake, other keys do nothing', () => {
  assert.equal(Core.KEY_MAP.KeyW, 'up');
  assert.equal(Core.KEY_MAP.ArrowDown, 'down');
  assert.equal(Core.KEY_MAP.KeyA, 'left');
  assert.equal(Core.KEY_MAP.ArrowRight, 'right');
  assert.equal(Core.KEY_MAP.Space, 'brake');
  const own = k => Object.prototype.hasOwnProperty.call(Core.KEY_MAP, k);
  for (const k of ['KeyQ', 'Enter', 'KeyP', 'toString', 'constructor', '__proto__']) assert.equal(own(k), false, k);
  assert.deepEqual([...new Set(Object.values(Core.KEY_MAP))].sort(), ['brake', 'down', 'left', 'right', 'up']);
});

test('the rules module is frozen so the game cannot change it by accident', () => {
  assert.ok(Object.isFrozen(Core));
  assert.throws(() => { 'use strict'; Core.parsePick = () => ({}); });
});

// ---------- Drivers and leaderboard ----------
test('driver names: letters, digits and a few signs stay, everything else is dropped, at most 16 characters', () => {
  assert.equal(Core.cleanName('  Alex  '), 'Alex');
  assert.equal(Core.cleanName('Zoë  Müller-Lopes'), 'Zoë Müller-Lopes');
  assert.equal(Core.cleanName("O'Neil_2.0"), "O'Neil_2.0");
  assert.equal(Core.cleanName('<img src=x onerror=alert(1)>'), 'img srcx onerror');
  assert.equal(Core.cleanName('a"b&c<d>e`f'), 'abcdef');
  assert.equal(Core.cleanName('x'.repeat(40)).length, Core.NAME_MAX);
  for (const raw of [null, undefined, 42, {}, [], '', '   ', '<<>>', '\n\t']) assert.equal(Core.cleanName(raw), '', String(raw));
  assert.ok(Core.sameName('alex', 'ALEX'));
  assert.ok(!Core.sameName('alex', 'alexa'));
});

test('drivers: a name is created once (any case), the newest is last, and at most 12 are kept', () => {
  let b = Core.newBoard(), r = Core.addDriver(b, 'Alex');
  assert.equal(r.name, 'Alex'); b = r.board;
  r = Core.addDriver(b, '  alex '); assert.equal(r.name, 'Alex', 'the existing spelling is kept'); b = r.board;
  assert.deepEqual(b.drivers, ['Alex']);
  r = Core.addDriver(b, '<>'); assert.equal(r.name, ''); assert.equal(r.board, b, 'an empty name changes nothing');
  for (let i = 0; i < 20; i++) b = Core.addDriver(b, 'Driver ' + i).board;
  assert.equal(b.drivers.length, Core.DRIVERS_MAX);
  assert.equal(b.drivers.at(-1), 'Driver 19');
  b = Core.addDriver(b, 'Driver 10').board;
  assert.equal(b.drivers.at(-1), 'Driver 10', 'picking a driver again makes it the newest');
});

test('leaderboard: one best entry per driver and map, fastest first, slower runs never replace a best', () => {
  let b = Core.newBoard(), r = Core.recordRun(b, 'city', 'Alex', 95.2, 'bike', 2);
  assert.deepEqual([r.rank, r.personalBest, r.prev], [1, true, null]); b = r.board;
  r = Core.recordRun(b, 'city', 'alex', 101, 'car', 3);
  assert.deepEqual([r.rank, r.personalBest, r.prev], [1, false, 95.2]); b = r.board;
  assert.equal(b.runs.city.length, 1); assert.equal(b.runs.city[0].time, 95.2);
  r = Core.recordRun(b, 'city', 'Sarah', 80, 'car', 3); b = r.board; assert.equal(r.rank, 1);
  r = Core.recordRun(b, 'city', 'Alex', 80, 'truck', 3); b = r.board;
  assert.deepEqual([r.rank, r.personalBest, r.prev], [2, true, 95.2], 'a tie goes behind the time that was there first');
  assert.deepEqual(b.runs.city.map(x => x.name), ['Sarah', 'Alex']);
  assert.deepEqual(Object.keys(b.runs), ['city'], 'Lisbon is the only board');
  // nothing impossible gets on the board, and nothing on the boards of the maps that were removed
  for (const [m, n, t] of [['highway', 'A', 90], ['country', 'A', 90], ['moon', 'A', 90], ['city', '', 90], ['city', 'A', 5], ['city', 'A', 9999], ['city', 'A', NaN], ['__proto__', 'A', 90]]){
    const x = Core.recordRun(b, m, n, t, 'car', 1); assert.equal(x.board, b, `${m} ${n} ${t}`); assert.equal(x.rank, 0);
  }
});

test('leaderboard rows: the top five, plus the driver further down after a gap', () => {
  let b = Core.newBoard();
  for (let i = 0; i < 8; i++) b = Core.recordRun(b, 'city', 'P' + i, 60 + i, 'car', 3).board;
  let rows = Core.boardRows(b, 'city', 'P7');
  assert.deepEqual(rows.map(r => r.place), [1, 2, 3, 4, 5, 8]);
  assert.ok(rows[5].me && rows[5].gap);
  rows = Core.boardRows(b, 'city', 'P5');
  assert.ok(rows[5].me && !rows[5].gap, 'sixth place follows straight on');
  rows = Core.boardRows(b, 'city', 'p2');
  assert.equal(rows.length, 5); assert.ok(rows[2].me);
  assert.deepEqual(Core.boardRows(b, 'nope', 'P1'), []);
  assert.deepEqual(Core.boardRows(b, 'highway', 'P1'), [], 'no board for a map that was removed');
});

test('a saved leaderboard is read back exactly, and broken or changed data is cleaned', () => {
  let b = Core.addDriver(Core.newBoard(), 'Alex').board;
  b = Core.recordRun(b, 'city', 'Alex', 120.4, 'truck', 2).board;
  assert.deepEqual(Core.parseBoard(JSON.stringify(b)), b);
  for (const raw of [null, '', 'not json', '[]', '42', 'null', '{"runs":7}', 'x'.repeat(30000)]) assert.deepEqual(Core.parseBoard(raw), Core.newBoard(), String(raw).slice(0, 20));
  const bad = Core.parseBoard(JSON.stringify({
    drivers: ['Alex', 'alex', '<b>', 7, 'Sarah'],
    runs: { city: [{ name: 'Alex', time: 99 }, { name: 'ALEX', time: 90, veh: 'tank', stars: 9 }, { name: '<script>', time: 'x' }, { name: 'Eve', time: 2 }, null, 'x'], moon: [{ name: 'A', time: 50 }], highway: 'no' }
  }));
  assert.deepEqual(bad.drivers, ['Alex', 'b', 'Sarah']);
  assert.deepEqual(bad.runs.city, [{ name: 'ALEX', time: 90, veh: 'car', stars: 1 }]);
  assert.deepEqual(Object.keys(bad.runs), ['city'], 'saved runs of unknown maps, and of the highway and the countryside, are dropped');
  const old = Core.parseBoard(JSON.stringify({ drivers: ['Alex'], runs: { city: [{ name: 'Alex', time: 99 }], highway: [{ name: 'Alex', time: 70 }], country: [{ name: 'Alex', time: 120 }] } }));
  assert.deepEqual(old.runs, { city: [{ name: 'Alex', time: 99, veh: 'car', stars: 1 }] }, 'a board saved before the two maps were removed keeps its Lisbon times');
});

test('leaderboard of the month: its own board per calendar month, which starts empty when a new month begins', () => {
  const nov = new Date(2026, 10, 11, 12).getTime(), nov2 = new Date(2026, 10, 28, 9).getTime(), dec = new Date(2026, 11, 1, 0, 5).getTime();
  assert.equal(Core.monthKey(nov), '2026-11');
  assert.equal(Core.monthName('2026-11'), 'November 2026');
  for (const bad of [NaN, -1, 0, Infinity, 'x', undefined]) assert.equal(Core.monthKey(bad), '', String(bad));
  for (const bad of ['', '2026-13', '2026-00', 'abc', null]) assert.equal(Core.monthName(bad), '', String(bad));
  let b = Core.newBoard(), r = Core.recordRun(b, 'city', 'Alex', 90, 'car', 3, nov); b = r.board;
  assert.deepEqual([r.rank, r.monthRank, r.personalBest, r.monthBest], [1, 1, true, true]);
  r = Core.recordRun(b, 'city', 'Sarah', 80, 'bike', 3, nov2); b = r.board;
  assert.deepEqual([r.rank, r.monthRank], [1, 1]);
  assert.deepEqual(Core.boardList(b, 'city', '2026-11').map(x => x.name), ['Sarah', 'Alex']);
  // December: the monthly board starts again, the all-time board stays
  assert.deepEqual(Core.boardList(b, 'city', Core.monthKey(dec)), [], 'nobody has driven in December yet');
  r = Core.recordRun(b, 'city', 'Alex', 95, 'car', 2, dec); b = r.board;
  assert.deepEqual([r.rank, r.personalBest, r.monthRank, r.monthBest], [2, false, 1, true], 'slower than his best, but the leader of December');
  assert.equal(b.month.key, '2026-12');
  assert.deepEqual(Core.boardList(b, 'city', '2026-12').map(x => [x.name, x.time]), [['Alex', 95]]);
  assert.deepEqual(Core.boardList(b, 'city').map(x => [x.name, x.time]), [['Sarah', 80], ['Alex', 90]]);
  assert.deepEqual(Core.boardRows(b, 'city', 'alex', '2026-12').map(x => [x.place, x.me]), [[1, true]]);
  // saved and read back; a tampered month is dropped, the all-time board is kept
  assert.deepEqual(Core.parseBoard(JSON.stringify(b)), b);
  const bad = Core.parseBoard(JSON.stringify({ drivers: ['Alex'], runs: b.runs, month: { key: '<b>', runs: { city: [{ name: 'Eve', time: 20 }] } } }));
  assert.equal(bad.month.key, ''); assert.deepEqual(bad.month.runs.city, []); assert.equal(bad.runs.city.length, 2);
  // without a valid clock the run still counts all time
  r = Core.recordRun(Core.newBoard(), 'city', 'Alex', 70, 'car', 3);
  assert.deepEqual([r.rank, r.monthRank, r.board.month.key], [1, 0, '']);
});

test('the garage card: get in and skip only work in the garage, and the menu can be reached from there', () => {
  const all = [...STATES, 'garage'];
  for (const a of ['board', 'street']) assert.deepEqual(all.filter(state => Core.actionAllowed(a, { state, story: null })), ['garage'], a);
  assert.equal(Core.actionAllowed('menu', { state: 'garage', story: null }), true);
  assert.equal(Core.actionAllowed('menu', { state: 'garage', story: Core.newStory() }), true);
  // rejected: nothing else on a stale card can run down there
  for (const a of ['go', 'again', 'resume', 'story', 'act', 'retry-act']) assert.equal(Core.actionAllowed(a, { state: 'garage', story: Core.newStory() }), false, a);
});
