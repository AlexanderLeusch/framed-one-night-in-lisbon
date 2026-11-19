// ### Unit tests for the rules in room-2-chase/js/core.js: accepted actions, refused actions and edge cases. No browser is needed.
// Game rules: driving, damage, police, boundary and scoring (room-2-chase/js/core.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../room-2-chase/js/core.js');
const { MODES, VEH } = Core;

const idle = { up: false, down: false, left: false, right: false, brake: false };
// Drives for `secs` with the given pedals and returns the final speed
function drive(speed, keys, secs, m = MODES.city, v = VEH.car, damage = 0){
  const max = Core.topSpeed(m, v, damage, false);
  for (let t = 0; t < secs; t += 1 / 60) speed = Core.stepSpeed(speed, keys, 1 / 60, max, v);
  return speed;
}

test('tables: every map and vehicle has the fields the game reads', () => {
  for (const m of Object.values(MODES)){
    for (const f of ['max', 'police', 'time', 'gaugeMax', 'redline', 'radar', 'shards', 'kits', 'store']) assert.ok(m[f] !== undefined, `${m.key}.${f}`);
    assert.ok(m.police < m.max, `${m.key}: police must be slower than the top speed so escape is possible`);
    assert.ok(m.redline < m.gaugeMax, `${m.key}: redline inside the gauge`);
    if (m.linear) assert.ok(m.bonus > 0, `${m.key}: open-road maps give bonus seconds`);
  }
  for (const v of Object.values(VEH)){
    for (const f of ['speed', 'accel', 'handling', 'dmg', 'ram', 'r']) assert.ok(v[f] > 0, `${v.key}.${f}`);
    assert.ok(Array.isArray(v.samples) && v.samples.length > 0);
  }
});

test('menu stats match the brief: bike fastest and most agile, truck toughest and slowest', () => {
  const s = k => Core.vehStats(VEH[k]);
  const [car, bike, truck] = [s('car'), s('bike'), s('truck')];
  for (const st of [car, bike, truck]) st.forEach(x => assert.ok(Number.isInteger(x) && x >= 1 && x <= 5));
  assert.equal(bike[0], 5); assert.equal(bike[2], 5);
  assert.equal(truck[3], 5); assert.equal(truck[4], 5);
  assert.ok(truck[0] < car[0] && car[0] < bike[0], 'top speed: truck < car < bike');
  assert.ok(Core.zeroTo80(VEH.bike, MODES.city) < Core.zeroTo80(VEH.car, MODES.city));
  assert.ok(Core.zeroTo80(VEH.car, MODES.city) < Core.zeroTo80(VEH.truck, MODES.city));
});

test('0-80 km/h on the menu card equals what the physics really does', () => {
  for (const k of Object.keys(VEH)){
    const v = VEH[k], m = MODES.highway, max = Core.topSpeed(m, v, 0, false);
    let sp = 0, t = 0;
    while (sp < 22.2 && t < 20){ sp = Core.stepSpeed(sp, { ...idle, up: true }, 0.005, max, v); t += 0.005; }
    assert.ok(Math.abs(t - Core.zeroTo80(v, m)) < 0.25, `${k}: physics ${t.toFixed(2)} s vs card ${Core.zeroTo80(v, m).toFixed(2)} s`);
  }
});

test('throttle reaches but never exceeds the top speed of the map', () => {
  for (const mk of Object.keys(MODES)) for (const vk of Object.keys(VEH)){
    const top = Core.topSpeed(MODES[mk], VEH[vk], 0, false);
    const sp = drive(0, { ...idle, up: true }, 40, MODES[mk], VEH[vk]);
    assert.ok(sp <= top + 1e-9 && sp > top * 0.9, `${mk}/${vk}: ${sp} of ${top}`);
  }
  // City top speed is about 122 km/h for the car, the highway allows 200 km/h
  assert.equal(Math.round(Core.topSpeed(MODES.city, VEH.car, 0, false) * 3.6), 122);
  assert.equal(Math.round(Core.topSpeed(MODES.highway, VEH.car, 0, false) * 3.6), 200);
});

test('damage and off-road driving lower the top speed', () => {
  const full = Core.topSpeed(MODES.city, VEH.car, 0, false);
  assert.equal(Core.topSpeed(MODES.city, VEH.car, 100, false), full * 0.6);
  assert.equal(Core.topSpeed(MODES.city, VEH.car, 0, true), full * 0.55);
  // out-of-range damage is clamped
  assert.equal(Core.topSpeed(MODES.city, VEH.car, 250, false), full * 0.6);
  assert.equal(Core.topSpeed(MODES.city, VEH.car, -40, false), full);
});

test('brake stops the car, then reverses, but never faster than the reverse limit', () => {
  const stopped = drive(30, { ...idle, down: true }, 0.9);
  assert.ok(stopped < 0.5);
  const rev = drive(0, { ...idle, down: true }, 10);
  assert.equal(rev, Core.REV_SPEED);
});

test('coasting slows down to exactly zero and does not flip direction', () => {
  assert.equal(drive(20, idle, 30), 0);
  assert.equal(drive(-8, idle, 30), 0);
});

test('edge case: gas and brake together, zero and huge frame times', () => {
  const both = drive(10, { ...idle, up: true, down: true }, 5);
  assert.ok(Number.isFinite(both) && both >= Core.REV_SPEED);
  assert.equal(Core.stepSpeed(12, { ...idle, up: true }, 0, 34, VEH.car), 12);
  // a 3 second hitch is treated like one 50 ms frame, so nothing jumps
  const capped = Core.stepSpeed(0, { ...idle, up: true }, 3, 34, VEH.car);
  assert.equal(capped, Core.stepSpeed(0, { ...idle, up: true }, 0.05, 34, VEH.car));
});

test('frame time is never negative and capped at 50 ms', () => {
  assert.equal(Core.frameDt(16), 0.016);
  assert.equal(Core.frameDt(-5), 0);
  assert.equal(Core.frameDt(4000), 0.05);
  assert.equal(Core.frameDt(NaN), 0);
});

test('collisions: circles and boxes push out along the right normal', () => {
  assert.equal(Core.collidePoint(10, 0, 1, { t: 'c', x: 0, z: 0, r: 1 }), null);
  const [nx, nz, pen] = Core.collidePoint(1.5, 0, 1, { t: 'c', x: 0, z: 0, r: 1 });
  assert.deepEqual([nx, nz], [1, 0]); assert.ok(Math.abs(pen - 0.5) < 1e-9);
  const box = { x0: 0, x1: 10, z0: 0, z1: 4 };
  assert.equal(Core.collidePoint(-3, 2, 1, box), null);
  assert.deepEqual(Core.collidePoint(-0.5, 2, 1, box), [-1, 0, 0.5]);
  // centre inside the box: pushed out through the nearest side (the top, 1 m away)
  assert.deepEqual(Core.collidePoint(5, 3, 1, box), [0, 1, 2]);
  // exactly on top of a circle's centre still returns a finite push
  const same = Core.collidePoint(0, 0, 1, { t: 'c', x: 0, z: 0, r: 1 });
  assert.ok(same.every(Number.isFinite));
});

test('damage: soft bumps are free, the truck takes 55 %, damage stays within 0-100', () => {
  assert.equal(Core.crashDamage(2.9, VEH.car), 0);
  assert.equal(Core.crashDamage(3.9, VEH.car), 0, 'a bump under about 14 km/h is free');
  assert.equal(Core.crashDamage(13, VEH.car), 9);
  assert.ok(Math.abs(Core.crashDamage(13, VEH.truck) - 9 * 0.55) < 1e-9);
  assert.equal(Core.crashDamage(34, VEH.car), 30, 'a wall at 122 km/h costs the car 30 %, so it survives three such hits');
  assert.equal(Core.crashDamage(NaN, VEH.car), 0);
  // accepted and refused: one crash pays once, however many frames it touches
  const g = Core.newCrashGuard();
  assert.equal(Core.chargeCrash(g, 34, VEH.car, 10), Core.crashDamage(34, VEH.car), 'the first frame pays in full');
  assert.equal(Core.chargeCrash(g, 10.6, VEH.car, 10.016), 0, 'the rebound in the next frame is the same crash');
  assert.equal(Core.chargeCrash(g, 3.6, VEH.car, 10.033), 0);
  assert.ok(Math.abs(Core.chargeCrash(g, 44, VEH.car, 10.05) - Core.crashDamage(44, VEH.car) + Core.crashDamage(34, VEH.car)) < 1e-9, 'a harder hit pays the difference');
  assert.equal(Core.chargeCrash(g, 34, VEH.car, 10.1), 0, 'contact keeps the window open');
  assert.equal(Core.chargeCrash(g, 34, VEH.car, 10.1 + Core.CRASH_QUIET), Core.crashDamage(34, VEH.car), 'a later crash is a new one');
  // the dashboard word follows the damage stages
  assert.deepEqual([0, 24, 25, 74, 75, 100].map(Core.damageLevel), ['ok', 'ok', 'warn', 'warn', 'crit', 'crit']);
  // tilt steering: sideways only, with a dead zone, full lock at the limit, and mirrored when the phone is turned round
  assert.equal(Core.tiltSteer(20, 0), 0, 'refused upright');
  assert.equal(Core.tiltSteer(20, 180), 0, 'refused upside down');
  for (const bad of [NaN, null, undefined, Infinity, '20']) assert.equal(Core.tiltSteer(bad, 90), 0, 'refused: ' + bad);
  assert.equal(Core.tiltSteer(0, 90), 0);
  assert.equal(Core.tiltSteer(Core.TILT_DEAD, 90), 0, 'a steady hand does not steer');
  assert.equal(Core.tiltSteer(Core.TILT_FULL, 90), -1, 'right side down steers right');
  assert.equal(Core.tiltSteer(-Core.TILT_FULL, 90), 1, 'left side down steers left');
  assert.equal(Core.tiltSteer(Core.TILT_FULL, 270), 1, 'the phone turned round is mirrored');
  assert.equal(Core.tiltSteer(60, 90), -1, 'never more than full lock');
  assert.ok(Math.abs(Core.tiltSteer(10, 90)) < 1 && Math.abs(Core.tiltSteer(10, 90)) > 0, 'in between it is gradual');
  assert.ok(Math.abs(Core.tiltSteer(170, 90) - Core.tiltSteer(10, 90)) < 1e-9, 'past upright the sensor jumps, the steering does not');
  assert.equal(Core.parseSteer('pads'), 'pads');
  for (const bad of ['tilt', 'constructor', '', null]) assert.equal(Core.parseSteer(bad), 'tilt');
  // the shadow box moves in whole shadow pixels, along the two axes of the shadow map
  const off = [-90, 60, -40], cell = 120 / 4096, len = Math.hypot(...off), d = off.map(v => v / len);
  const flat = Math.hypot(d[0], d[2]), R = [-d[2] / flat, 0, d[0] / flat], U = [-R[2] * d[1], R[2] * d[0] - R[0] * d[2], R[0] * d[1]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(R, U)) < 1e-9 && Math.abs(dot(R, d)) < 1e-9 && Math.abs(dot(U, d)) < 1e-9, 'the axes are at right angles');
  for (const [x, y, z] of [[0, 0, 0], [-3.5, 3.01, -40], [12.345, 1.5, 3999.9], [-180, 5, 70.123]]){
    const s = Core.snapShadow(x, y, z, off, cell), t = Core.snapShadow(x, y, z + 0.4, off, cell);
    assert.ok(Math.hypot(s[0] - x, s[1] - y, s[2] - z) <= cell, 'it stays within one shadow pixel of the player');
    const step = [t[0] - s[0], t[1] - s[1], t[2] - s[2]];
    for (const axis of [R, U]){ const n = dot(step, axis) / cell; assert.ok(Math.abs(n - Math.round(n)) < 1e-6, 'moves in whole pixels: ' + n); }
    assert.deepEqual(Core.snapShadow(s[0], s[1], s[2], off, cell).map(v => +v.toFixed(6)), s.map(v => +v.toFixed(6)), 'a snapped point stays');
  }
  // the resolution follows the frame rate
  const play = (q, fps, secs) => { for (let i = 0; i < fps * secs; i++) Core.stepQuality(q, 1000 / fps); return q; };
  assert.equal(play(Core.newQuality(), 60, 30).level, 0, 'a smooth game keeps full resolution');
  assert.equal(play(Core.newQuality(), 50, 30).level, 0, 'a 50 Hz screen is left alone');
  let q = play(Core.newQuality(), 30, 2.1);
  assert.equal(q.level, 1, 'slow: one step down');
  play(q, 40, 2);
  assert.equal(q.level, 2, 'it helped but is still slow: the next step');
  q = play(Core.newQuality(), 30, 2.1);
  play(q, 30, 2);
  assert.deepEqual([q.level, q.locked], [0, true], 'refused: a 30 Hz screen gains nothing, so the step is taken back');
  play(q, 30, 60);
  assert.equal(q.level, 0, 'and it stays there');
  q = play(Core.newQuality(), 20, 2.1);
  for (const fps of [25, 32, 40, 45]) play(q, fps, 2);
  assert.equal(q.level, Core.QUALITY_SCALES.length - 1, 'never below the last step');
  q = play(Core.newQuality(), 30, 2.1);
  play(q, 60, 2);
  assert.equal(q.level, 1);
  play(q, 60, 16);
  assert.equal(q.level, 1, 'not up before 20 good seconds');
  play(q, 60, 4);
  assert.equal(q.level, 0, 'up again after them');
  // two stalls of a quarter second, as when a new map compiles its shaders, do not lower a smooth game
  const hitch = Core.newQuality();
  for (let i = 0; i < 125; i++) Core.stepQuality(hitch, i === 40 || i === 80 ? 240 : 1000 / 60);
  assert.equal(hitch.level, 0, 'a stall is not a slow game');
  for (const bad of [NaN, Infinity, -5, 0, 400, undefined]){
    const fresh = Core.newQuality();
    assert.deepEqual(Core.stepQuality(fresh, bad), Core.newQuality(), 'refused frame time: ' + bad);
  }
  // the volume: stored as text, each part refused on its own, squared for the ear
  assert.deepEqual(Core.parseVolume(null), { game: 1, music: 1 }, 'nothing stored: full volume');
  assert.deepEqual(Core.parseVolume('{"game":0.5,"music":0}'), { game: 0.5, music: 0 });
  assert.deepEqual(Core.parseVolume('{"game":7,"music":-2}'), { game: 1, music: 0 }, 'kept within 0 and 1');
  for (const bad of ['', 'loud', '[0.2,0.3]', '{"game":"0.2"}', '{"game":null}', 'null', '{"music":1e999}', 'x'.repeat(200)]){
    const v = Core.parseVolume(bad); assert.ok(v.game === 1 && v.music === 1, 'refused: ' + bad.slice(0, 20));
  }
  assert.deepEqual(Core.parseVolume('{"game":0.3}'), { game: 0.3, music: 1 }, 'a missing part stays full');
  assert.deepEqual([0, 0.5, 1].map(Core.volumeGain), [0, 0.25, 1]);
  assert.equal(Core.volumeGain(NaN), 1); assert.equal(Core.volumeGain(3), 1);
  // two keys for one action: it stays on until the last one is released
  assert.equal(Core.actionHeld(new Set(['KeyW', 'ArrowUp']), 'up'), true);
  assert.equal(Core.actionHeld(new Set(['KeyW']), 'up'), true);
  assert.equal(Core.actionHeld(new Set(['KeyS']), 'up'), false);
  assert.equal(Core.actionHeld(new Set(), 'up'), false);
  assert.equal(Core.addDamage(90, 30), 100);
  assert.equal(Core.addDamage(20, -50), 20, 'negative damage is rejected');
  assert.equal(Core.repairDamage(70), 30);
  assert.equal(Core.repairDamage(25), 0);
  assert.ok(Core.isWrecked(100)); assert.ok(!Core.isWrecked(99.9));
});

test('bust meter: fills only when slow next to a cop, drains otherwise, busts at 100 %', () => {
  let b = { bust: 0, busted: false };
  for (let i = 0; i < 60; i++) b = Core.bustStep(b.bust, 5, 2, 1 / 60);
  assert.ok(Math.abs(b.bust - 1 / Core.BUST.fill) < 0.01 && !b.busted, 'one second next to a cop fills 1 / BUST.fill of the meter');
  assert.ok(Core.BUST.fill >= 3, 'a short stop next to a cop is not the end');
  assert.equal(Core.bustStep(0.5, Core.BUST.radius + 0.5, 0, 0.05).bust < 0.5, true, 'a cop just outside the radius does not fill it');
  const fast = Core.bustStep(0.5, 5, 20, 0.05);
  assert.ok(fast.bust < 0.5, 'driving away drains the meter');
  const far = Core.bustStep(0.5, 30, 0, 0.05);
  assert.ok(far.bust < 0.5, 'no cop nearby drains the meter');
  assert.equal(Core.bustStep(0, 30, 0, 0.05).bust, 0, 'never below zero');
  for (let i = 0; i < 200 && !b.busted; i++) b = Core.bustStep(b.bust, 5, 0, 1 / 60);
  assert.deepEqual(b, { bust: 1, busted: true });
});

test('wanted stars rise with time or progress, never fall, stay within 1-5, and wrecks add to them', () => {
  assert.deepEqual([0, 35, 37, 73, 109, 145, 180, 999].map(t => Core.wantedStars(1, t, 180, 0, 0)), [1, 1, 2, 3, 4, 5, 5, 5]);
  assert.deepEqual([0, 0.2, 0.4, 0.6, 0.8, 1, 5].map(p => Core.wantedStars(1, 0, 180, p, 0)), [1, 2, 3, 4, 5, 5, 5]);
  assert.equal(Core.wantedStars(4, 0, 180, 0, 0), 4, 'stars never fall');
  assert.equal(Core.wantedStars(1, 0, 180, 0, 5), 2, 'five wrecks are worth a star');
  // rejected and odd input
  assert.equal(Core.wantedStars(undefined, -50, 180, -1, -3), 1);
  assert.equal(Core.wantedStars(1, 10, 0, NaN, NaN), 1);
  assert.equal(Core.wantedStars(99, 0, 180, 0, 0), 5);
});

test('bust meter: the witness head start stops it filling, but it still drains', () => {
  assert.ok(Core.WITNESS_RULE.grace >= 4, 'a few seconds to get going with the witness on board');
  assert.equal(Core.bustStep(0.5, 2, 0, 0.05, true).bust < 0.5, true, 'pinned next to a cop during the head start: the meter drains');
  assert.equal(Core.bustStep(0.5, 2, 0, 0.05, false).bust > 0.5, true, 'without the head start it fills');
  let b = { bust: 0.9, busted: false };
  for (let i = 0; i < 300; i++) b = Core.bustStep(b.bust, 2, 0, 1 / 60, true);
  assert.deepEqual(b, { bust: 0, busted: false }, 'five seconds pinned during the head start: never busted');
});

test('every star makes the chase at least as hard', () => {
  for (let s = 2; s <= Core.MAX_STARS; s++){
    const a = Core.pursuit(s - 1), b = Core.pursuit(s);
    assert.ok(b.cops >= a.cops && b.speed >= a.speed && b.spawn <= a.spawn && b.respawn <= a.respawn && b.hp >= a.hp, 'star ' + s);
  }
  assert.equal(Core.pursuit(1).cops, 1);
  assert.equal(Core.pursuit(0), Core.pursuit(1));
  assert.equal(Core.pursuit(40), Core.pursuit(5));
  assert.ok(Core.copTopSpeed(33, 5, 50, false) > Core.copTopSpeed(33, 1, 50, false));
  assert.ok(Core.copTopSpeed(33, 3, 50, true) > Core.copTopSpeed(33, 3, 50, false), 'the spotlight helps the police');
  assert.ok(Core.copTopSpeed(33, 1, 200, false) > Core.copTopSpeed(33, 1, 100, false), 'far behind they catch up');
});

test('the helicopter joins after 60 seconds, or sooner with the fifth star', () => {
  assert.equal(Core.HELI_AFTER, 60);
  assert.equal(Core.helicopterDue(0, 1), false);
  assert.equal(Core.helicopterDue(59.9, 4), false);
  assert.equal(Core.helicopterDue(60, 1), true);
  assert.equal(Core.helicopterDue(20, 5), true);
});

test('the searchlight moves at its speed limit, never overshoots, and catches only a point inside its radius', () => {
  assert.deepEqual(Core.trackStep(0, 0, 100, 0, 30, 0.05), [1.5, 0]);
  assert.deepEqual(Core.trackStep(0, 0, 1, 0, 30, 0.05), [1, 0], 'stops on the target');
  assert.deepEqual(Core.trackStep(5, 5, 5, 5, 30, 0.05), [5, 5]);
  assert.deepEqual(Core.trackStep(0, 0, 100, 0, 30, 9), [1.5, 0], 'a slow frame cannot teleport it');
  assert.equal(Core.inSpotlight(0, 0, Core.SPOT_RADIUS, 0), true);
  assert.equal(Core.inSpotlight(0, 0, Core.SPOT_RADIUS + 0.1, 0), false);
});

test('boundary distance shrinks towards every edge; the highway only has two ends', () => {
  const rect = [-100, 100, -50, 50];
  assert.equal(Core.edgeDistance(rect, 0, 0, 0, false), 50);
  assert.equal(Core.edgeDistance(rect, 95, 0, 0, false), 5);
  assert.equal(Core.edgeDistance(rect, 99, 0, 0, true), 50, 'sideways does not count on the highway');
  assert.ok(Core.edgeDistance(rect, 120, 0, 0, false) < 0, 'outside gives a negative distance');
});

test('scoring: drive time, stars and best time', () => {
  assert.equal(Core.driveTime('city', MODES.city, 100, 8), 80);
  assert.equal(Core.driveTime('highway', MODES.highway, 20, 5), 110, 'bonus seconds are added back');
  assert.equal(Core.runStars('city', MODES.city, 100, 80, 0), 3);
  assert.equal(Core.runStars('city', MODES.city, 50, 130, 0), 2);
  assert.equal(Core.runStars('city', MODES.city, 10, 170, 0), 1);
  assert.equal(Core.runStars('city', MODES.city, 100, 80, 60), 2, 'heavy damage costs a star');
  assert.equal(Core.runStars('city', MODES.city, 10, 170, 99), 1, 'but never the last one');
  assert.equal(Core.runStars('highway', MODES.highway, 0, 80, 0), 3);
  assert.equal(Core.runStars('country', MODES.country, 0, 140, 0), 1);
  assert.ok(Core.isNewBest(undefined, 90));
  assert.ok(Core.isNewBest(95, 90));
  assert.ok(!Core.isNewBest(85, 90));
  assert.ok(!Core.isNewBest(85, NaN));
  assert.ok(!Core.isNewBest(85, 0));
});

test('time display never shows negative or NaN time', () => {
  assert.equal(Core.fmtTime(180), '3:00');
  assert.equal(Core.fmtTime(59.2), '1:00');
  assert.equal(Core.fmtTime(-3), '0:00');
  assert.equal(Core.fmtTime(NaN), '0:00');
  assert.equal(Core.fmtTimeExact(83.44), '1:23.4');
  assert.equal(Core.fmtTimeExact(Infinity), '0:00.0');
});

test('seeded random is repeatable, so maps are always built the same way', () => {
  const a = Core.mulberry32(2026), b = Core.mulberry32(2026);
  const xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
  assert.deepEqual(xs, ys);
  xs.forEach(x => assert.ok(x >= 0 && x < 1));
  assert.deepEqual(Core.shuffle([1, 2, 3, 4, 5], Core.mulberry32(1)).sort(), [1, 2, 3, 4, 5]);
  for (const a0 of [-10, -Math.PI, 0, 3, 10]){ const w = Core.wrapAngle(a0); assert.ok(w >= -Math.PI && w < Math.PI); }
});

test('the city map carries the real streets of the Baixa, in their real order', () => {
  assert.equal(Core.BAIXA.ns.length, 7);
  assert.equal(Core.BAIXA.ew.length, 7);
  // west to east and north to south, as on the map of Lisbon
  assert.deepEqual([Core.BAIXA.ns[0], Core.BAIXA.ns[3], Core.BAIXA.ns[6]], ['Rua do Crucifixo', 'Rua Augusta', 'Rua dos Fanqueiros']);
  assert.deepEqual([Core.BAIXA.ew[0], Core.BAIXA.ew[3], Core.BAIXA.ew[6]], ['Rua de Santa Justa', 'Rua da Conceição', 'Avenida Infante Dom Henrique']);
  assert.equal(Core.streetAt(-3.5, -30, 0), 'Rua Augusta');
  assert.equal(Core.streetAt(96, 20, 0), 'Rua da Prata');
  assert.equal(Core.streetAt(30, 0, Math.PI / 2), 'Rua da Conceição');
  assert.equal(Core.streetAt(0, 83, 0), 'Rua Augusta', 'the arch stands on Rua Augusta');
});

test('squares win over streets, a crossing follows your heading, and a pavement or bad input has no name', () => {
  assert.equal(Core.streetAt(0, 120, 0), 'Praça do Comércio');
  assert.equal(Core.streetAt(-24, -120, 0), 'Rossio');
  assert.equal(Core.streetAt(24, -120, 0), 'Praça da Figueira');
  assert.equal(Core.streetAt(0, 0, 0), 'Rua Augusta', 'driving north-south');
  assert.equal(Core.streetAt(0, 0, Math.PI / 2), 'Rua da Conceição', 'driving east-west');
  assert.equal(Core.streetAt(24, 24, 0), null, 'inside a block');
  assert.equal(Core.streetAt(1000, 0, 0), null, 'outside the map');
  assert.equal(Core.streetAt(NaN, 0, 0), null);
  assert.equal(Core.streetAt(0, undefined, 0), null);
  assert.equal(Core.streetAt(-3.5, -30), 'Rua Augusta', 'no heading is fine');
});

test('a tram never leaves its rails: from any crossing it stays on the loop and comes back round', () => {
  const T = Core.TRAM_LOOP, P = Core.BAIXA.pitch, right = (dx, dz) => [-dz, dx];
  const onLoop = (x, z) => x >= T.x0 && x <= T.x1 && z >= T.z0 && z <= T.z1 && (x === T.x0 || x === T.x1 || z === T.z0 || z === T.z1);
  let x = T.x0, z = T.z0, dx = 1, dz = 0;
  const start = x + ',' + z, seen = new Set();
  for (let i = 0; i < 12; i++){
    assert.ok(onLoop(x, z), x + ',' + z + ' is off the loop');
    seen.add(x + ',' + z);
    if (Core.tramNext(x, z, dx, dz) === 'r') [dx, dz] = right(dx, dz);
    x += dx * P; z += dz * P;
  }
  assert.equal(x + ',' + z, start, 'twelve crossings bring it back to the start');
  assert.equal(seen.size, 12, 'it passes every crossing of the loop once');
  // the tracks run through real streets: Rua da Conceição, Rua da Prata, Praça do Comércio, Rua Áurea
  assert.equal(Core.streetAt(0, T.z0, Math.PI / 2), 'Rua da Conceição');
  assert.equal(Core.streetAt(T.x1, 24, 0), 'Rua da Prata');
  assert.equal(Core.streetAt(24, T.z1, Math.PI / 2), 'Praça do Comércio');
  assert.equal(Core.streetAt(T.x0, 24, 0), 'Rua Áurea');
});

const VEHICLES = ['car', 'bike', 'truck'];
const rmsOf = d => Math.sqrt(d.reduce((t, v) => t + v * v, 0) / d.length);
const similarity = (d, lag) => { let a = 0, b = 0; for (let i = 0; i < d.length; i++){ a += d[i] * d[(i + lag) % d.length]; b += d[i] * d[i]; } return a / b; };

test('the gearbox shifts up only under power, drops down when slowing, and stays in first in reverse', () => {
  for (const key of VEHICLES){
    const E = Core.ENGINES[key], top = E.gears[0];
    assert.equal(Core.gearFor(E, 1, top, 1), 2, key + ' shifts up at the top of first');
    assert.equal(Core.gearFor(E, 1, top, 0), 1, key + ' does not shift up off the throttle');
    assert.equal(Core.gearFor(E, 1, top * 0.5, 1), 1, key + ' stays in gear below the top');
    assert.equal(Core.gearFor(E, 2, top * 0.2, 0), 1, key + ' shifts down when slow');
    assert.equal(Core.gearFor(E, 2, Core.REV_SPEED, 1), 1, key + ' reverses in first');
    assert.equal(Core.gearFor(E, E.gears.length, 500, 1), E.gears.length, key + ' has no gear above the last');
    // after a shift the next gear must not shift straight back down
    for (let g = 1; g < E.gears.length; g++) assert.equal(Core.gearFor(E, g + 1, E.gears[g - 1] * 0.97, 1), g + 1, key + ' gear ' + g);
  }
});

test('the rpm follows the road speed and stays between idle and the limit', () => {
  for (const key of VEHICLES){
    const E = Core.ENGINES[key];
    assert.equal(Core.engineTarget(E, 1, 0, 0), E.idle, key + ' idles when standing');
    assert.equal(Core.engineTarget(E, 1, 0, 1), E.launch, key + ' holds launch rpm on the clutch');
    assert.equal(Core.engineTarget(E, 1, E.gears[0], 0), E.max, key + ' reaches max rpm at the top of the gear');
    assert.equal(Core.engineTarget(E, 1, 500, 1), E.max, key + ' never passes the limit');
    assert.ok(Core.engineTarget(E, 1, Core.REV_SPEED, 1) < E.max, key + ' does not hit the limiter in reverse');
    assert.ok(Core.engineTarget(E, 2, E.gears[0], 1) < E.max * 0.9, key + ' revs fall in the next gear');
  }
});

test('engine loops are periodic at the firing frequency of each real engine', () => {
  const SR = Core.ENGINE_SR;
  for (const key of ['bike', 'truck']){
    const E = Core.ENGINES[key], rpm = E.refs[2], d = Core.engineLoop(E, rpm, 'load', SR, 7);
    const firing = rpm / 60 * E.cyl / 2, lag = Math.round(SR / firing);
    assert.ok(similarity(d, lag) > 0.45, key + ' repeats every firing: ' + similarity(d, lag));
    assert.ok(similarity(d, Math.round(lag * 0.5)) < similarity(d, lag), key + ' not at half the interval');
  }
  // the loop holds whole engine cycles, and the end joins the start without a click
  for (const key of VEHICLES){
    const E = Core.ENGINES[key], d = Core.engineLoop(E, E.refs[1], 'load', SR, 7), cycles = d.length / SR / (120 / E.refs[1]);
    assert.ok(Math.abs(cycles - Math.round(cycles)) < 0.01, key + ' whole cycles: ' + cycles);
    let steps = 0; for (let i = 1; i < d.length; i++) steps += (d[i] - d[i - 1]) ** 2;
    assert.ok(Math.abs(d[0] - d[d.length - 1]) < 5 * Math.sqrt(steps / d.length), key + ' joins without a jump');
  }
});

test('the V8 burbles: its two banks make each cycle repeat better than each firing, unlike the even four and six', () => {
  const SR = Core.ENGINE_SR, unevenness = key => {
    const E = Core.ENGINES[key], rpm = E.refs[1], d = Core.engineLoop(E, rpm, 'load', SR, 7), firing = rpm / 60 * E.cyl / 2;
    return similarity(d, Math.round(SR * 120 / rpm)) - similarity(d, Math.round(SR / firing));
  };
  assert.ok(unevenness('car') > 0.2, 'car ' + unevenness('car'));
  assert.ok(unevenness('car') > 2 * unevenness('truck'), 'truck ' + unevenness('truck'));
  assert.ok(unevenness('car') > 2 * unevenness('bike'), 'bike ' + unevenness('bike'));
});

test('engine loops: louder with rpm and under load, within range, the same for the same seed', () => {
  for (const key of VEHICLES){
    const E = Core.ENGINES[key], loops = Core.engineLoops(E, Core.ENGINE_SR, 3);
    assert.equal(loops.length, E.refs.length);
    loops.forEach((l, i) => {
      assert.ok(rmsOf(l.off) < rmsOf(l.on) * (i ? 0.75 : 1), key + ' overrun or idle is quieter at ' + l.rpm);
      if (i) assert.ok(rmsOf(l.on) > rmsOf(loops[i - 1].on), key + ' louder at ' + l.rpm);
      for (const d of [l.on, l.off]) assert.ok(d.every(v => Math.abs(v) <= 1 && Number.isFinite(v)), key + ' in range');
    });
    assert.ok(E.refs[0] <= E.idle * 1.1 && E.refs[E.refs.length - 1] >= E.max * 0.9, key + ' loops cover the rpm range');
  }
  const a = Core.engineLoop(Core.ENGINES.car, 1500, 'load', Core.ENGINE_SR, 9), b = Core.engineLoop(Core.ENGINES.car, 1500, 'load', Core.ENGINE_SR, 9);
  assert.deepEqual(a, b);
});

test('the rotor loop thumps at the blade-pass rate and repeats seamlessly', () => {
  const SR = Core.ENGINE_SR, R = Core.ROTOR, d = Core.rotorLoop(SR, 7);
  assert.equal(R.blades * R.rps, 24, 'four blades at six turns a second');
  assert.equal(d.length, Math.round(SR * R.revs / R.rps));
  assert.ok(d.every(v => Math.abs(v) <= 1 && Number.isFinite(v)));
  const lag = Math.round(SR / (R.blades * R.rps));
  assert.ok(similarity(d, lag) > 0.5, 'repeats at each blade pass: ' + similarity(d, lag));
  assert.ok(similarity(d, Math.round(lag / 2)) < similarity(d, lag), 'not at half a pass');
  let steps = 0; for (let i = 1; i < d.length; i++) steps += (d[i] - d[i - 1]) ** 2;
  assert.ok(Math.abs(d[0] - d[d.length - 1]) < 8 * Math.sqrt(steps / d.length), 'joins without a jump');
  assert.deepEqual(Core.rotorLoop(SR, 7), d, 'the same for the same seed');
});

test('idling is its own sound: at the idle rpm, each cycle different, through a closed-down muffler', () => {
  const SR = Core.ENGINE_SR;
  for (const key of VEHICLES){
    const E = Core.ENGINES[key], cycle = Math.round(SR * 120 / E.idle);
    assert.equal(E.refs[0], E.idle, key + ' has a loop at its exact idle rpm');
    const idle = Core.engineLoop(E, E.idle, 'idle', SR, 5);
    assert.ok(E.idling.lowpass < E.lowpass, key + ' a darker sound than under load');
    assert.ok(similarity(idle, cycle) < 0.995, key + ' no two cycles are the same');
    assert.ok(idle.length / SR >= E.loop * 1.9, key + ' the idle loop is long enough not to be heard repeating');
  }
  assert.ok(similarity(Core.engineLoop(Core.ENGINES.car, 750, 'idle', SR, 5), Math.round(SR * 120 / 750)) < similarity(Core.engineLoop(Core.ENGINES.truck, 600, 'idle', SR, 5), Math.round(SR * 120 / 600)), 'the V8 lopes more than the diesel six');
});

test('brake lights: on while braking in either direction, off when reversing or standing still', () => {
  assert.equal(Core.isBraking(20, true, false, false), true, 'pedal while rolling forward');
  assert.equal(Core.isBraking(-5, false, true, false), true, 'W while rolling backward');
  assert.equal(Core.isBraking(20, false, false, true), true, 'handbrake while moving');
  assert.equal(Core.isBraking(20, false, true, false), false, 'accelerating');
  assert.equal(Core.isBraking(0, true, false, false), false, 'S at a standstill is reverse');
  assert.equal(Core.isBraking(-5, true, false, false), false, 'reversing');
  assert.equal(Core.isBraking(0, false, false, true), false, 'handbrake at a standstill');
  assert.equal(Core.isBraking(20, false, false, false), false, 'coasting');
});

test('damage shows in four stages, and the smoke thickens and darkens up to flames', () => {
  assert.deepEqual([0, 24.9, 25, 49.9, 50, 74.9, 75, 100].map(Core.damageStage), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(Core.smokeFor(0).rate, 0, 'a clean vehicle does not smoke');
  assert.equal(Core.smokeFor(24).rate, 0);
  let prev = Core.smokeFor(25);
  for (let d = 26; d <= 100; d++){
    const s = Core.smokeFor(d);
    assert.ok(s.rate >= prev.rate && s.opacity >= prev.opacity && s.rise >= prev.rise, 'at ' + d);
    assert.ok(s.color <= prev.color, 'darker at ' + d);
    prev = s;
  }
  assert.ok(Core.smokeFor(100).color < 0x202020, 'near black at the end');
  assert.equal(Core.smokeFor(87).fire, false);
  assert.equal(Core.smokeFor(88).fire, true);
});

test('hills: smooth and bounded on every map, level at the Arco, the river and the ends of the highway', () => {
  for (const key of ['city', 'highway', 'country']){
    let steepest = 0, highest = 0;
    const span = key === 'highway' ? [[0, 0], [0, 4000]] : [[-300, 300], [-300, 300]];
    for (let x = span[0][0]; x <= span[0][1]; x += 13) for (let z = span[1][0]; z <= span[1][1]; z += 11){
      for (const h of [0, Math.PI / 2, Math.PI / 4]) steepest = Math.max(steepest, Math.abs(Core.gradeAt(key, x, z, h)));
      highest = Math.max(highest, Math.abs(Core.hillHeight(key, x, z)));
    }
    assert.ok(steepest < 0.24 && steepest > 0.05, key + ' grade ' + steepest);
    assert.ok(highest > 6 && highest < 30, key + ' height ' + highest);
  }
  assert.equal(Core.hillHeight('city', 0, 83), 0, 'level at the Arco');
  assert.equal(Core.hillHeight('city', 0, 120), 0, 'level at the river');
  assert.equal(Core.hillHeight('city', 300, 0), 0, 'level outside the old town');
  assert.equal(Core.hillHeight('highway', -7, 5), 0, 'level at the start');
  assert.equal(Core.hillHeight('highway', -7, 4000), 0, 'level at the finish');
  assert.equal(Core.hillHeight('nowhere', 3, 3), 0);
});

test('the guide arrow points the right way: ahead, right, left, behind, from any heading', () => {
  const deg = (h, tx, tz) => Math.round(Core.guideTurn(0, 0, h, tx, tz) * 180 / Math.PI);
  assert.equal(deg(0, 0, 50), 0, 'straight ahead');
  assert.equal(deg(0, -50, 0), 90, 'to the right of a car facing +z (the screen right is -x)');
  assert.equal(deg(0, 50, 0), -90, 'to the left');
  assert.equal(Math.abs(deg(0, 0, -50)), 180, 'behind');
  assert.equal(deg(Math.PI / 2, 50, 0), 0, 'ahead after turning');
  assert.equal(deg(Math.PI / 2, 0, 50), 90, 'facing +x, the +z side is on the right');
  for (const h of [-7, -1, 0.3, 4, 12]) assert.ok(Math.abs(Core.guideTurn(3, 4, h, 10, -20)) <= Math.PI, 'always between -180° and 180°');
});

test('Lisbon holds the six pieces of evidence that prove the detective innocent, each once', () => {
  assert.deepEqual(Core.EVIDENCE.map(e => e.key), ['photos', 'prints', 'torch', 'lockpick', 'clothes', 'balaclava']);
  assert.equal(Core.MODES.city.shards, Core.EVIDENCE.length, 'one of each in the city, and the gate opens after the last');
  assert.equal(new Set(Core.EVIDENCE.map(e => e.name)).size, 6, 'six different names');
  for (const e of Core.EVIDENCE) assert.ok(e.found.length > 20 && Object.isFrozen(e), e.key + ' explains what it proves, and cannot be changed');
  assert.ok(Object.isFrozen(Core.EVIDENCE));
  assert.equal(Core.MODES.highway.mission, 'Bonus Shards', 'the open roads keep their bonus shards');
});

test('slopes: uphill is slower, downhill faster, a heavy truck feels it most, and brakes still hold', () => {
  const VEH = Core.VEH, idle = { up: false, down: false, brake: false };
  const pull = (grade, v) => { let s = 0; for (let t = 0; t < 12; t += 1 / 60) s = Core.stepSpeed(s, { ...idle, up: true }, 1 / 60, Core.slopeTop(34 * v.speed, grade, v), v, grade); return s; };
  for (const key of ['car', 'bike', 'truck']){
    const v = VEH[key];
    assert.ok(pull(0.08, v) < pull(0, v) * 0.95 && pull(0.08, v) > pull(0, v) * 0.85, key + ' a little slower uphill');
    assert.ok(pull(-0.08, v) > pull(0, v) * 1.05, key + ' faster downhill');
  }
  assert.ok(Core.slopeTop(30, 0.08, VEH.truck) < Core.slopeTop(30, 0.08, VEH.bike), 'the truck loses more uphill');
  assert.equal(Core.slopeTop(30, 0, VEH.car), 30);
  assert.equal(Core.slopeTop(30, undefined, VEH.car), 30);
  assert.ok(Core.slopeTop(30, 9, VEH.car) >= 25.19, 'never below 84 %');
  assert.ok(Core.slopeTop(30, -9, VEH.car) <= 36.61, 'never above 122 %');
  // rolling and holding on a hill
  assert.equal(Core.stepSpeed(0, idle, 1 / 60, 30, VEH.car, 0.1), 0, 'a stopped vehicle does not creep');
  assert.ok(Core.stepSpeed(10, idle, 1 / 60, 30, VEH.car, -0.1) > Core.stepSpeed(10, idle, 1 / 60, 30, VEH.car, 0), 'it coasts on downhill');
  assert.ok(Core.stepSpeed(10, idle, 1 / 60, 30, VEH.car, 0.1) < Core.stepSpeed(10, idle, 1 / 60, 30, VEH.car, 0), 'and stops sooner uphill');
});

test('radio: seven stations, the dial wraps both ways, and junk from storage means off', () => {
  assert.equal(Object.keys(Core.RADIO).length, 7);
  assert.deepEqual(Core.RADIO_ORDER, ['off', 'reggae', 'techno', 'hardstyle', 'schlager', 'pop', 'classical', 'metal']);
  let k = 'off'; const seen = []; for (let i = 0; i < 8; i++){ k = Core.radioNext(k, 1); seen.push(k); }
  assert.equal(seen[7], 'off', 'round the dial and back');
  assert.equal(Core.radioNext('off', -1), 'metal');
  assert.equal(Core.radioNext('reggae', -1), 'off');
  for (const bad of [null, undefined, '', 'polka', 42, {}, '__proto__', 'constructor']) assert.equal(Core.parseRadio(bad), 'off');
  assert.equal(Core.parseRadio('techno'), 'techno');
  assert.deepEqual(Core.radioBar('polka', 0), [], 'no such station plays nothing');
  assert.deepEqual(Core.radioBar('constructor', 0).length, 0);
});

test('radio: every bar is valid, in time and the same each time', () => {
  for (const key of Object.keys(Core.RADIO)){
    for (let bar = 0; bar < 40; bar++){
      const ev = Core.radioBar(key, bar);
      assert.ok(ev.length > 0, key + ' bar ' + bar + ' has notes');
      for (const e of ev){
        assert.ok(e.t >= 0 && e.t < 4.2, key + ' note inside the bar: ' + e.t);
        assert.ok(e.d > 0 && e.v > 0 && e.v <= 1.2, key + ' sane length and level');
        assert.ok(Number.isFinite(e.n) && e.n >= 0 && e.n < 110, key + ' sane pitch: ' + e.n);
        assert.ok(typeof e.i === 'string');
      }
    }
    assert.deepEqual(Core.radioBar(key, 3), Core.radioBar(key, 3), key + ' is the same each time');
    assert.deepEqual(Core.radioBar(key, -5), Core.radioBar(key, 0), key + ' bad bar numbers start at the top');
  }
});

test('radio: each station plays by the rules of its genre', () => {
  const at = (key, bar, inst) => Core.radioBar(key, bar).filter(e => e.i === inst).map(e => e.t);
  const bpm = k => Core.RADIO[k].bpm;
  assert.ok(bpm('reggae') < 90 && bpm('techno') >= 125 && bpm('techno') <= 140 && bpm('hardstyle') >= 145 && bpm('metal') >= 160 && bpm('classical') < 90);
  assert.deepEqual(at('reggae', 0, 'kick'), [2], 'reggae: one drop, the kick only on the third beat');
  assert.ok(at('reggae', 0, 'skank').every(t => t % 1 === 0.5), 'reggae: chords on the off-beats');
  assert.deepEqual(at('techno', 0, 'kick'), [0, 1, 2, 3], 'techno: four on the floor');
  assert.deepEqual(at('hardstyle', 0, 'hkick'), [0, 1, 2, 3], 'hardstyle: distorted kick on every beat');
  assert.deepEqual(at('schlager', 0, 'kick'), [0, 1, 2, 3], 'schlager: disco foxtrot');
  assert.deepEqual(at('schlager', 0, 'snare'), [1, 3]);
  assert.ok(at('metal', 0, 'chug').length > 3 && at('metal', 0, 'guitar').length > 0, 'metal: chugs and power chords');
  assert.equal(Core.radioBar('classical', 0).some(e => ['kick', 'snare', 'hat', 'clap'].includes(e.i)), false, 'classical: no drums');
  // the prelude follows Bach's notes
  const bar0 = Core.radioBar('classical', 0).filter(e => e.t < 2).map(e => e.n);
  assert.deepEqual(bar0, [60, 64, 67, 72, 76, 67, 72, 76]);
});

test('audit: a stopped vehicle holds on the steepest street, and rolling needs a running start', () => {
  const idle = { up: false, down: false, brake: false };
  let s = 0; for (let t = 0; t < 5; t += 1 / 60) s = Core.stepSpeed(s, idle, 1 / 60, 30, VEH.car, 0.2);
  assert.equal(s, 0, 'no creeping at 20 %');
  s = 10; for (let t = 0; t < 6; t += 1 / 60) s = Core.stepSpeed(s, idle, 1 / 60, 30, VEH.car, 0.2);
  assert.equal(s, 0, 'coasting uphill ends at rest, and stays there');
  s = 10; for (let t = 0; t < 2; t += 1 / 60) s = Core.stepSpeed(s, idle, 1 / 60, 30, VEH.car, -0.2);
  assert.ok(s > 10, 'rolling downhill keeps going');
});

test('audit: the top gear and the gauge fit the fastest speed a hill allows', () => {
  for (const key of VEHICLES){
    const E = Core.ENGINES[key], v = VEH[key];
    for (const m of Object.values(MODES)){
      const fastest = Core.slopeTop(Core.topSpeed(m, v, 0, false), -0.2, v);
      assert.ok(E.gears[E.gears.length - 1] >= fastest, key + ' on ' + m.key + ': top gear reaches ' + fastest);
      assert.ok(m.gaugeMax / 3.6 >= fastest, key + ' on ' + m.key + ': gauge reaches ' + fastest);
    }
  }
  const E = Core.ENGINES.car;
  assert.equal(Core.gearFor(E, 1, E.gears[0] * 1.05, 0), 2, 'overspeed down a hill shifts up without throttle');
});

test('audit: every vehicle can earn three stars and beat the clock on the highway, hills included', () => {
  const M = MODES.highway, keys = { up: true, down: false, brake: false };
  for (const key of VEHICLES){
    const V = VEH[key]; let z = 5, s = 0, t = 0;
    while (z < 4000 && t < 400){
      const g = Core.gradeAt('highway', -7, z, 0);
      s = Core.stepSpeed(s, keys, 1 / 60, Core.slopeTop(Core.topSpeed(M, V, 0, false), g, V), V, g);
      z += s / 60; t += 1 / 60;
    }
    assert.ok(t < M.time - 5, key + ' finishes with time to spare: ' + t);
    assert.equal(Core.runStars('highway', M, M.time - t, t, 0, V), 3, key + ' three stars for a clean run');
  }
  assert.equal(Core.runStars('highway', M, 0, 100, 0), 2, 'without a vehicle the limits are the car\'s');
});

test('audit: police slow down uphill, and times never read 0:60.0', () => {
  assert.ok(Core.copTopSpeed(33, 1, 50, false, 0.1) < Core.copTopSpeed(33, 1, 50, false, 0));
  assert.ok(Core.copTopSpeed(33, 1, 50, false, -0.1) > Core.copTopSpeed(33, 1, 50, false, 0));
  // the police lose exactly as much on a hill as the player does
  for (const g of [0.05, 0.1, 0.3, -0.05, -0.3]){
    const cop = Core.copTopSpeed(30, 1, 50, false, g) / 30, car = Core.slopeTop(30, g, { accel: 1 }) / 30;
    assert.ok(Math.abs(cop - car) < 1e-9, 'grade ' + g + ': police ' + cop + ', player ' + car);
  }
  assert.equal(Core.fmtTimeExact(59.96), '1:00.0');
  assert.equal(Core.fmtTimeExact(119.97), '2:00.0');
  assert.equal(Core.fmtTimeExact(61.24), '1:01.2');
});

test('the drawn ground matches the hills, is continuous, and is flat outside them', () => {
  for (const key of ['city', 'highway', 'country']){
    const L = Core.HILL_GRID[key], span = key === 'highway' ? [0, 0, 0, 4000] : [-170, 170, -170, 170];
    let worst = 0;
    for (let x = span[0]; x <= span[1]; x += 3.7) for (let z = span[2]; z <= span[3]; z += 3.3){
      worst = Math.max(worst, Math.abs(Core.hillMesh(key, x, z) - Core.hillHeight(key, x, z)));
      // no step between two points a millimetre apart, also across grid lines and diagonals
      const step = Math.abs(Core.hillMesh(key, x + 0.001, z + 0.001) - Core.hillMesh(key, x, z));
      assert.ok(step < 0.001, key + ' jump at ' + x + ',' + z);
    }
    assert.ok(worst < 0.3, key + ' within 30 cm of the smooth hill: ' + worst);
    assert.equal(Core.hillMesh(key, L * 2, L * 2), Core.hillHeight(key, key === 'highway' ? 0 : L * 2, L * 2), key + ' exact on a grid point');
  }
  assert.equal(Core.hillMesh('city', 0, 83), 0, 'level at the Arco');
  assert.equal(Core.hillMesh('city', 400, 0), 0);
  assert.equal(Core.hillMesh('nowhere', 3, 3), 0);
  assert.equal(Core.hillMesh('constructor', 3, 3), 0);
  // the edge of the hills must be on the grid and at height zero, so the flat land joins without a step
  for (const key of ['city', 'highway']){
    const [x0, x1, z0, z1] = Core.HILL_BOX[key], L = Core.HILL_GRID[key];
    for (const v of [x0, x1, z0, z1]) if (Number.isFinite(v)) assert.equal(Math.abs(v % L), 0, key + ' box on the grid: ' + v);
    for (const z of [z0, z1]) assert.equal(Core.hillHeight(key, 0, z), 0, key + ' level at the edge');
  }
});

test('idling is low and round: most of its sound is below 400 Hz', () => {
  const SR = Core.ENGINE_SR;
  for (const key of ['car', 'truck']){
    const E = Core.ENGINES[key], d = Core.engineLoop(E, E.idle, 'idle', SR, 5);
    let low = 0, high = 0, lp = 0; for (let i = 0; i < d.length; i++){ lp += 0.075 * (d[i] - lp); low += lp * lp; high += (d[i] - lp) ** 2; }
    assert.ok(low > high, key + ' low ' + low + ' high ' + high);
  }
});

test('skid marks: hard braking, the handbrake and very fast corners slide; normal driving does not', () => {
  assert.equal(Core.skidAmount(30, true, false, 0), 0.8, 'hard braking');
  assert.equal(Core.skidAmount(10, false, true, 0), 1, 'handbrake');
  assert.equal(Core.skidAmount(-10, false, true, 0), 1, 'handbrake in reverse');
  assert.equal(Core.skidAmount(30, false, false, 1), 0.45, 'very fast corner');
  assert.equal(Core.skidAmount(30, false, false, -1), 0.45, 'either way');
  assert.equal(Core.skidAmount(30, false, false, 0), 0, 'straight on');
  assert.equal(Core.skidAmount(8, true, false, 0), 0, 'gentle braking at low speed');
  assert.equal(Core.skidAmount(10, true, false, 0), 0.8, 'braking at speed');
  assert.equal(Core.skidAmount(-10, true, false, 0), 0, 'S while reversing is throttle');
  assert.equal(Core.skidAmount(3, false, true, 0), 0, 'handbrake when nearly stopped');
  assert.equal(Core.skidAmount(5, false, true, 0), 1, 'handbrake while rolling');
  assert.equal(Core.skidAmount(15, false, false, 1), 0, 'a normal corner');
  assert.equal(Core.skidAmount(0, false, false, 0), 0);
});

test('reversing lights: on only while rolling backwards', () => {
  assert.equal(Core.isReversing(-3), true);
  assert.equal(Core.isReversing(-0.4), false, 'not while stopping');
  assert.equal(Core.isReversing(0), false);
  assert.equal(Core.isReversing(20), false);
});

// ---------- Tram rails ----------
test('tram rails: the track runs along the trams\' lane, round the corners, and nowhere else', () => {
  const { RAIL, TRAM_LOOP: T } = Core;
  // north side, driven towards +x: the lane is 3.5 m to the right (+z)
  assert.ok(Math.abs(Core.trackOffset(0, T.lane)) < 1e-9);
  assert.ok(Math.abs(Core.trackOffset(-40, T.lane + RAIL.half) - RAIL.half) < 1e-9);
  assert.ok(Math.abs(Core.trackOffset(40, T.lane - RAIL.half) + RAIL.half) < 1e-9);
  // east side, driven towards +z: the lane is 3.5 m to the left of the edge (x = 92.5)
  assert.ok(Math.abs(Core.trackOffset(T.x1 - T.lane, 50)) < 1e-9);
  // the corner curve after the north-east corner, round the trams' turning centre (89, 7)
  for (const a of [-1.4, -0.8, -0.2]) assert.ok(Math.abs(Core.trackOffset(89 + 3.5 * Math.cos(a), 7 + 3.5 * Math.sin(a))) < 1e-9, String(a));
  // away from the track: other streets, the middle of the loop, outside the city, bad input
  for (const [x, z] of [[0, -50], [0, 50], [-200, 3.5], [0, 10], [NaN, 3.5], [0, Infinity]]) assert.ok(Number.isNaN(Core.trackOffset(x, z)), `${x},${z}`);
});

test('tram rails: a wheel that crosses a rail is a jolt that grows with speed; standing still or missing the rails is not', () => {
  assert.equal(Core.railCrossings(-1.5, 1.5), 2, 'across the whole track');
  assert.equal(Core.railCrossings(0.5, 0.9), 1);
  assert.equal(Core.railCrossings(0.1, 0.3), 0, 'between the rails');
  assert.equal(Core.railCrossings(0.72, 0.72), 0, 'not moving');
  assert.equal(Core.railCrossings(NaN, 0.72), 0, 'just arrived on the track');
  const slow = Core.railShake(1, 5, true), fast = Core.railShake(1, 20, true);
  assert.ok(slow.jolt > 0 && fast.jolt > slow.jolt, 'faster is harder');
  assert.ok(Core.railShake(4, 40, true).jolt <= 0.3, 'capped');
  assert.deepEqual(Core.railShake(2, 0.5, true), { jolt: 0, rumble: 0 }, 'creeping over the rails');
  assert.equal(Core.railShake(0, 15, false).rumble, 0, 'off the track bed');
  assert.ok(Core.railShake(0, 15, true).rumble > 0 && Core.railShake(0, 15, true).jolt === 0, 'rolling along the bed only rumbles');
  assert.deepEqual(Core.railShake(1, NaN, true), { jolt: 0, rumble: 0 });
});

// ---------- The route to the gate ----------
test('route to the gate: along the streets, turning at a crossing, from wherever the car is', () => {
  const P = Core.BAIXA.pitch, gate = [-144, 144];
  // on a north-south street: stay on it to the gate's row, then turn
  assert.deepEqual(Core.routeTo(-3.5, -6, 0, ...gate), [[0, -6], [0, 144], [-144, 144]]);
  // on an east-west street: along it to the gate's column, then turn
  assert.deepEqual(Core.routeTo(30, 50, Math.PI / 2, ...gate), [[30, 48], [-144, 48], [-144, 144]]);
  // on a crossing the car's direction chooses the first street
  assert.deepEqual(Core.routeTo(0, 0, 0, ...gate), [[0, 0], [0, 144], [-144, 144]]);
  assert.deepEqual(Core.routeTo(0, 0, -Math.PI / 2, ...gate), [[0, 0], [-144, 0], [-144, 144]]);
  // from the middle of a block: to the nearest crossing first
  assert.deepEqual(Core.routeTo(20, 20, 0, ...gate), [[20, 20], [0, 0], [0, 144], [-144, 144]]);
  // already on the gate's street: one straight line
  assert.deepEqual(Core.routeTo(-144, 100, 0, ...gate), [[-144, 100], [-144, 144]]);
  // every corner is a crossing of the grid, and bad input gives no route
  for (const p of Core.routeTo(70, -90, 1, ...gate).slice(1)) assert.ok(p[0] % P === 0 && p[1] % P === 0, String(p));
  for (const bad of [[NaN, 0], [0, Infinity]]) assert.deepEqual(Core.routeTo(bad[0], bad[1], 0, ...gate), []);
});

test('route arrows: evenly spaced in the driving lane, pointing along the street, never more than asked for', () => {
  const pts = Core.routeTo(0, 0, 0, -144, 144), marks = Core.routeMarks(pts, 5, 3.5, 8, 100);
  assert.ok(marks.length > 40 && marks.length <= 100);
  const south = marks.filter(m => Math.abs(m.h) < 1e-9), west = marks.filter(m => Math.abs(m.h + Math.PI / 2) < 1e-9);
  assert.equal(south.length + west.length, marks.length, 'each arrow points south or west');
  assert.ok(south.every(m => Math.abs(m.x + 3.5) < 1e-9), 'heading south, the right-hand lane is at x = -3.5');
  assert.ok(west.every(m => Math.abs(m.z - 140.5) < 1e-9), 'heading west, the right-hand lane is on the north side');
  assert.equal(south[0].z, 8, 'the first arrow is ahead of the car');
  for (let i = 1; i < south.length; i++) assert.ok(Math.abs(south[i].z - south[i - 1].z - 5) < 1e-9);
  assert.ok(Math.min(...west.map(m => m.x)) >= -144 && Math.max(...south.map(m => m.z)) < 144, 'none beyond a corner or the gate');
  assert.equal(Core.routeMarks(pts, 5, 3.5, 8, 7).length, 7);
  assert.deepEqual(Core.routeMarks([], 5, 3.5, 8, 100), []);
});

test('steering: tight at walking pace, a wide arc at speed, never more sideways pull than the tyres grip', () => {
  const radius = (v, sp, hb) => sp / Core.turnRate(1, sp, v, hb);
  assert.ok(radius(VEH.car, 30) > 2 * radius(VEH.car, 10), 'the faster, the wider the arc: ' + radius(VEH.car, 10).toFixed(1) + ' m at 36 km/h, ' + radius(VEH.car, 30).toFixed(1) + ' m at 108 km/h');
  for (const key of ['car', 'bike', 'truck']){
    const v = VEH[key];
    for (const hb of [false, true]) for (let sp = 1; sp <= 70; sp += 0.5){
      const pull = sp * Math.abs(Core.turnRate(1, sp, v, hb));
      assert.ok(pull <= Core.GRIP[key] * v.handling * (hb ? 1.5 : 1) + 1e-9, `${key} at ${sp} m/s pulls ${pull.toFixed(2)} m/s² sideways`);
    }
  }
  assert.ok(radius(VEH.bike, 20) < radius(VEH.car, 20) && radius(VEH.car, 20) < radius(VEH.truck, 20), 'the motorcycle turns tightest, the truck widest');
  assert.ok(radius(VEH.car, 25, true) < radius(VEH.car, 25), 'the handbrake turns tighter');
  assert.equal(Core.turnRate(-1, 15, VEH.car, false), -Core.turnRate(1, 15, VEH.car, false), 'left and right are the same');
  assert.equal(Core.turnRate(1, 15, VEH.car, false), Core.turnRate(1, -15, VEH.car, false), 'reversing turns as tightly (the game flips the direction)');
});

test('rejected: a vehicle that does not move does not turn, and no steering gives no turn', () => {
  for (const key of ['car', 'bike', 'truck']) assert.equal(Core.turnRate(1, 0, VEH[key], false), 0, key);
  assert.equal(Core.turnRate(0, 30, VEH.car, true), 0);
});

test('steering builds up and fades smoothly: the wheel turns in within about 0.15 s, comes back faster, and the turn rate never overshoots', () => {
  let s = 0; for (let t = 0; t < 0.15; t += 1 / 60) s = Core.stepSteer(s, 1, 1 / 60);
  assert.ok(s > 0.6 && s < 1, 'in after 0.15 s: ' + s.toFixed(2));
  let back = 1; for (let t = 0; t < 0.15; t += 1 / 60) back = Core.stepSteer(back, 0, 1 / 60);
  assert.ok(back < 1 - s, 'it lets go faster than it turns in');
  const long = Core.stepSteer(0.3, 1, 1000);
  assert.ok(long > 0.3 && long <= 1, 'a hiccup of a frame counts as one short step (MAX_DT) and never steers past the input: ' + long);
  let yaw = 0; const want = Core.turnRate(1, 20, VEH.car, false);
  for (let i = 0; i < 120; i++){ yaw = Core.stepYaw(yaw, want, 1 / 60, VEH.car); assert.ok(yaw <= want + 1e-12, 'never past the turn it asks for'); }
  assert.ok(Math.abs(yaw - want) < 1e-6, 'and gets there');
  const after = (v, n) => { let y = 0; for (let i = 0; i < n; i++) y = Core.stepYaw(y, 1, 1 / 60, v); return y; };
  assert.ok(after(VEH.truck, 6) < after(VEH.car, 6), 'the heavy truck turns in more slowly');
});

test('the witness gets in only when you stop right next to her, and waits again if you drive off', () => {
  assert.equal(Core.WITNESS.name, 'Marta Silva');
  assert.ok(Object.isFrozen(Core.WITNESS) && Object.isFrozen(Core.WITNESS_RULE));
  assert.equal(Core.witnessGetsIn(5, 1), true, 'stopped beside her');
  assert.equal(Core.witnessGetsIn(6.9, -2.9), true, 'rolling slowly backwards counts too');
  assert.equal(Core.witnessGivesUp(11.9), false, 'still close enough while she walks to the door');
  assert.equal(Core.witnessGivesUp(12.1), true, 'driven off: she goes back to wait');
});

test('rejected: the witness does not get in from too far away, at speed, or from nonsense values', () => {
  assert.equal(Core.witnessGetsIn(7, 0), false, 'too far: 7 m');
  assert.equal(Core.witnessGetsIn(3, 3), false, 'too fast: 3 m/s');
  assert.equal(Core.witnessGetsIn(3, -4), false, 'too fast backwards');
  for (const bad of [NaN, Infinity, undefined, '2']) assert.equal(Core.witnessGetsIn(bad, 0), false, String(bad));
  assert.equal(Core.witnessGetsIn(2, NaN), false);
  assert.equal(Core.witnessGivesUp(NaN), true, 'an unknown distance counts as driven off');
});

test('the witness waits 70 to 200 m away and inside the map, never next to the player or at the edge', () => {
  const L = 150;
  assert.equal(Core.witnessSpotOk(0, 100, 0, 0, L), true);
  assert.equal(Core.witnessSpotOk(0, 69, 0, 0, L), false, 'rejected: too close');
  assert.equal(Core.witnessSpotOk(140, -140, -100, 100, L), false, 'rejected: too far');
  assert.equal(Core.witnessSpotOk(145, 0, 0, 0, L), false, 'rejected: at the edge of the map');
  assert.equal(Core.witnessSpotOk(0, -141.5, 0, 0, L), true, 'just inside the edge (8 m in from it)');
});

test('shoving: momentum is shared by weight, so a motorcycle flies off a car and a bus hardly moves', () => {
  const { MASS, PLAYER_MASS } = Core, hit = (who, target) => Core.shoveImpulse(30, PLAYER_MASS[who], MASS[target]);
  assert.ok(hit('car', 'moto').dv > hit('car', 'sedan').dv && hit('car', 'sedan').dv > hit('car', 'bus').dv, 'lighter flies further');
  assert.ok(hit('truck', 'sedan').dv > hit('car', 'sedan').dv && hit('car', 'sedan').dv > hit('bike', 'sedan').dv, 'a heavier hitter pushes harder');
  assert.equal(hit('car', 'sedan').share, 0.5, 'two cars share the push equally');
  for (const who of ['car', 'bike', 'truck']) for (const t of ['sedan', 'suv', 'moto', 'bus', 'coach', 'truck']){
    const r = hit(who, t), m = PLAYER_MASS[who], M = MASS[t];
    assert.ok(Math.abs(r.dv * M - 30 * Core.SHOVE.boost * m * M / (m + M)) < 1e-9, `${who} into ${t}: the push follows the weights`);
  }
  assert.ok(Core.keepSpeed(hit('car', 'moto').share) > Core.keepSpeed(hit('car', 'sedan').share) && Core.keepSpeed(hit('car', 'sedan').share) > Core.keepSpeed(hit('car', 'bus').share), 'you keep more speed the lighter the vehicle you hit');
  for (const s of [0, 0.3, 1]) assert.ok(Core.keepSpeed(s) >= 0.25 && Core.keepSpeed(s) <= 0.95);
});

test('rejected: a tram on its rails is not pushed, and bad values push nothing', () => {
  assert.deepEqual(Core.shoveImpulse(30, 1, Core.MASS.tram), { share: 0, dv: 0 }, 'a tram does not move');
  for (const bad of [0, -5, NaN, Infinity, undefined, '30']) assert.deepEqual(Core.shoveImpulse(bad, 1, 1), { share: 0, dv: 0 }, 'impact ' + String(bad));
  assert.deepEqual(Core.shoveImpulse(30, 0, 1), { share: 0, dv: 0 }, 'no hitter weight');
  assert.deepEqual(Core.shoveImpulse(30, 1, -1), { share: 0, dv: 0 }, 'no negative weight');
  assert.equal(Core.keepSpeed(NaN), 0.25);
});

test('parked cars: the handbrake makes them heavier than traffic, and a turned car keeps a box that holds it', () => {
  const { MASS, PARKED } = Core, car = Core.shoveImpulse(20, 1, MASS.sedan * PARKED.brake), moving = Core.shoveImpulse(20, 1, MASS.sedan);
  assert.ok(car.dv > 0 && car.dv < moving.dv, 'a parked car moves, but less than one that is driving');
  assert.ok(PARKED.grip > Core.SHOVE.grip && PARKED.max > 0 && PARKED.max < Core.SHOVE.max, 'it stops sooner and stays near its place');
  assert.deepEqual(Core.parkedBox(2.3, 0.95, 0), [2.3, 0.95], 'not turned: its own box');
  const q = Core.parkedBox(2.3, 0.95, Math.PI / 2);
  assert.ok(Math.abs(q[0] - 0.95) < 1e-9 && Math.abs(q[1] - 2.3) < 1e-9, 'a quarter turn swaps the sides');
  const d = Core.parkedBox(2.3, 0.95, Math.PI / 4);
  assert.ok(d[0] > 0.95 && d[0] < 2.3 * Math.SQRT2 && d[1] > 0.95, 'half way the box is wider, but trimmed at the corners');
  assert.deepEqual(Core.parkedBox(2.3, 0.95, NaN), [2.3, 0.95], 'a bad turn keeps the box');
});

test('shoving: a hit off the middle turns the vehicle, a centred hit does not, and heavy vehicles turn less', () => {
  // a vehicle facing +z, hit at its nose and pushed towards +x: the nose swings to +x, so its heading grows
  assert.ok(Core.shoveSpin(0, 2, 1, 0, 10, 1) > 0, 'nose pushed to +x turns towards +x');
  assert.ok(Core.shoveSpin(0, -2, 1, 0, 10, 1) < 0, 'tail pushed to +x turns the other way');
  assert.equal(Math.abs(Core.shoveSpin(0, 0, 1, 0, 10, 1)), 0, 'a centred hit only pushes');
  assert.ok(Math.abs(Core.shoveSpin(0, 2, 1, 0, 10, 4)) < Math.abs(Core.shoveSpin(0, 2, 1, 0, 10, 1)), 'a bus turns less than a car');
});

test('scraping: sliding along a wall scrapes, the faster the harder; driving straight into it does not', () => {
  const { SCRAPE } = Core;
  assert.equal(Core.scrapeLevel(0, 20, 1, 0) > 0, true, 'along a wall at 20 m/s');
  assert.ok(Core.scrapeLevel(0, 20, 1, 0) > Core.scrapeLevel(0, 8, 1, 0), 'faster scrapes harder');
  assert.equal(Core.scrapeLevel(0, 40, 1, 0), 1, 'full at speed, never more');
  assert.equal(Core.scrapeLevel(-20, 0, 1, 0), 0, 'rejected: straight into the wall is a crash, not a scrape');
  assert.equal(Core.scrapeLevel(0, SCRAPE.min * 0.9, 1, 0), 0, 'rejected: too slow to scrape');
  assert.ok(Math.abs(Core.scrapeLevel(14, 14, 0, -2) - Core.scrapeLevel(14, 14, 0, -1)) < 1e-12, 'the length of the normal does not matter');
});

test('scraping: rejected for bad values, and the sparks follow the scrape and the frame time', () => {
  assert.equal(Core.scrapeLevel(NaN, 20, 1, 0), 0);
  assert.equal(Core.scrapeLevel(0, 20, 0, 0), 0, 'rejected: no surface direction');
  assert.equal(Core.scrapeLevel(0, Infinity, 1, 0), 0);
  assert.ok(Core.sparkCount(1, 1 / 60) > Core.sparkCount(0.3, 1 / 60), 'more sparks for a harder scrape');
  assert.ok(Math.abs(Core.sparkCount(1, 1 / 30) - 2 * Core.sparkCount(1, 1 / 60)) < 1e-9, 'the same sparks per second at any frame rate');
  assert.equal(Core.sparkCount(0, 1 / 60), 0, 'no scrape, no sparks');
  assert.equal(Core.sparkCount(1, -1), 0, 'rejected: negative time');
  assert.equal(Core.sparkCount(2, 1 / 60), 0, 'rejected: a level above 1');
  assert.ok(Core.sparkCount(1, 10) <= Core.SCRAPE.sparks, 'a long frame is capped');
});

test('looking back: only while the key is held during a run', () => {
  assert.equal(Core.LOOK.key, 'KeyC');
  assert.equal(Core.lookingBack(true, 'play'), true);
  assert.equal(Core.lookingBack(false, 'play'), false, 'rejected: key not held');
  for (const st of ['menu', 'pause', 'over', 'done', 'finale']) assert.equal(Core.lookingBack(true, st), false, 'rejected in ' + st);
  assert.equal(Core.lookingBack('yes', 'play'), false, 'rejected: not a real key state');
});

test('looking back: the camera sits ahead of the vehicle, above it, and looks back down the road', () => {
  const cam = [7, 3], h = 0.7, fx = Math.sin(h), fz = Math.cos(h), v = Core.lookBackView(10, 2, -5, h, cam);
  assert.ok((v.px - 10) * fx + (v.pz + 5) * fz > 0, 'ahead of the vehicle');
  assert.ok((v.tx - 10) * fx + (v.tz + 5) * fz < -20, 'looking at the road behind');
  assert.ok(v.py > 2 + 1 && v.py > v.ty, 'above the vehicle, looking slightly down');
  assert.ok(Math.abs((v.px - 10) * fz - (v.pz + 5) * fx) < 1e-9, 'straight ahead, not to one side');
  const truck = Core.lookBackView(10, 2, -5, h, [9, 4]);
  assert.ok(Math.hypot(truck.px - 10, truck.pz + 5) > Math.hypot(v.px - 10, v.pz + 5), 'further out for a vehicle with a longer chase camera');
  assert.equal(Core.lookBackView(NaN, 0, 0, 0, cam), null, 'rejected: bad position');
  assert.equal(Core.lookBackView(0, 0, 0, Infinity, cam), null, 'rejected: bad heading');
  assert.equal(Core.lookBackView(0, 0, 0, 0, [0, 3]), null, 'rejected: no camera distance');
  assert.equal(Core.lookBackView(0, 0, 0, 0, null), null, 'rejected: no camera');
});

test('nitro: every third pickup fills a charge, up to three', () => {
  const n = Core.newNitro();
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(() => Core.nitroPickup(n)), [false, false, true, false, false, true], 'in Lisbon after the 3rd and the 6th piece');
  assert.equal(n.charges, 2);
  for (let i = 0; i < 9; i++) Core.nitroPickup(n);
  assert.equal(n.charges, Core.NITRO.max, 'never more than the tank holds');
  assert.equal(n.fill, 0);
  assert.equal(Core.nitroPickup(null), false, 'rejected: no nitro state');
});

test('nitro: fires once per charge, only during a run, one at a time and not in reverse', () => {
  const n = Core.newNitro();
  assert.equal(Core.nitroFire(n, 'play', 20), false, 'rejected: no charge');
  n.charges = 2;
  assert.equal(Core.nitroFire(n, 'pause', 20), false, 'rejected: paused');
  assert.equal(Core.nitroFire(n, 'menu', 20), false, 'rejected: in the menu');
  assert.equal(Core.nitroFire(n, 'play', -5), false, 'rejected: reversing');
  assert.equal(n.charges, 2, 'a refused press uses nothing');
  assert.equal(Core.nitroFire(n, 'play', 20), true);
  assert.equal(Core.nitroOn(n), true);
  assert.equal(Core.nitroFire(n, 'play', 20), false, 'rejected: one is already burning');
  assert.equal(n.charges, 1);
  for (let t = 0; t < Core.NITRO.time + 0.1; t += 0.05) Core.nitroStep(n, 0.05);
  assert.equal(Core.nitroOn(n), false, 'burns out after NITRO.time');
  assert.equal(Core.nitroFire(n, 'play', 0), true, 'the next one from standing');
});

test('nitro: raises the top speed and pushes forward while it burns, the same at any frame rate', () => {
  const n = Core.newNitro();
  assert.equal(Core.nitroTop(30, n), 30, 'nothing without a burning charge');
  assert.equal(Core.nitroPush(20, n, 1 / 60, 39), 20);
  n.charges = 1; Core.nitroFire(n, 'play', 20);
  assert.equal(Core.nitroTop(30, n), 30 * Core.NITRO.top);
  const max = Core.nitroTop(30, n);
  assert.ok(Core.nitroPush(20, n, 1 / 60, max) > 20, 'pushes forward');
  assert.equal(Core.nitroPush(max, n, 1 / 60, max), max, 'never past the raised top speed');
  assert.equal(Core.nitroPush(-3, n, 1 / 60, max), -3, 'never while rolling backwards');
  const a = Core.nitroPush(Core.nitroPush(20, n, 1 / 60, max), n, 1 / 60, max), b = Core.nitroPush(20, n, 1 / 30, max);
  assert.ok(Math.abs(a - b) < 1e-9, 'two short frames push as far as one long one');
  assert.equal(Core.nitroPush(20, n, NaN, max), 20, 'rejected: bad frame time');
  // a whole burn from 25 m/s with the gas down passes the normal top speed of 30 m/s
  let sp = 25;
  const keys = { up: true, down: false, brake: false };
  const m = Core.newNitro(); m.charges = 1; Core.nitroFire(m, 'play', sp);
  for (let t = 0; t < 2; t += 1 / 60){ const top = Core.nitroTop(30, m); sp = Core.nitroPush(Core.stepSpeed(sp, keys, 1 / 60, top, Core.VEH.car), m, 1 / 60, top); Core.nitroStep(m, 1 / 60); }
  assert.ok(sp > 30 && sp <= 30 * Core.NITRO.top, 'faster than the top speed, within the raised one');
});

test('kit guide: points at the nearest repair kit left, only from KIT_GUIDE_AT % damage on', () => {
  const kits = [{ x: 100, z: 0, taken: false }, { x: 0, z: 30, taken: false }, { x: 5, z: 5, taken: true }];
  assert.equal(Core.kitToGuide(kits, 0, 0, Core.KIT_GUIDE_AT - 1), null, 'not below the threshold');
  assert.equal(Core.kitToGuide(kits, 0, 0, 0), null);
  assert.equal(Core.kitToGuide(kits, 0, 0, Core.KIT_GUIDE_AT), kits[1], 'the nearest kit not yet taken');
  assert.equal(Core.kitToGuide(kits, 90, 0, 80), kits[0]);
  assert.equal(Core.kitToGuide(kits.map(k => ({ ...k, taken: true })), 0, 0, 80), null, 'none when every kit is taken');
  assert.equal(Core.kitToGuide([], 0, 0, 80), null);
  assert.equal(Core.kitToGuide(null, 0, 0, 80), null, 'rejected: no kit list');
  assert.equal(Core.kitToGuide(kits, NaN, 0, 80), null, 'rejected: bad position');
  assert.equal(Core.kitToGuide(kits, 0, 0, NaN), null, 'rejected: bad damage');
  assert.equal(Core.kitToGuide([{ x: NaN, z: 0 }, kits[0]], 0, 0, 80), kits[0], 'a broken kit entry is skipped');
});

test('the garage: on foot you can run, and the way out leads through the door into the eastbound lane', () => {
  const G = Core.GARAGE, way = Core.garageWay();
  assert.ok(G.walk > 1.7 && G.run > G.walk, 'walking is brisk and running is faster');
  // the way begins at the top of the ramp, on the middle line, and stays there up to the door
  assert.deepEqual(way[0], [0, -G.top]);
  assert.ok(way.filter(p => p[1] <= 0).every(p => p[0] === 0), 'straight through the door');
  for (let i = 1; i < way.length; i++) assert.ok(Math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]) < 1.6, 'no gap in the way at ' + i);
  // in the city: the door is in the south wall of a house (13.5 m from the middle of its block), the way ends on the cross
  // street (7 m to each side of z = 0) in the lane to the east, heading east, before the next crossing
  const [sx, sz] = G.street, block = (Math.floor(sx / 48) + 0.5) * 48, wallZ = (Math.floor(sz / 48) + 0.5) * 48 + 13.5;
  assert.ok(Math.abs(sx - block) + G.door + 1 < 13.5, 'the door fits into the wall of the house');
  assert.ok(sz > wallZ && sz - wallZ <= 1, 'the frame of the door stands just out of the wall');
  const last = way[way.length - 1], before = way[way.length - 2];
  assert.ok(sz + last[1] > 0.5 && sz + last[1] < 4, 'in the eastbound lane, clear of the cars parked at the kerb');
  assert.ok(last[0] > before[0] && last[1] === before[1], 'heading east at the end');
  // following it: from anywhere on the level stretch the aim moves on along the way and it ends at the last point
  let [i, ax, az, done] = Core.wayAim(way, 0, 2, -G.top + 2, 4);
  assert.ok(az > -G.top + 2 && Math.hypot(ax - 2, az + G.top - 2) >= 4 && !done, 'aims at least 4 m ahead');
  assert.ok(Core.wayAim(way, i, 2, -G.top + 4, 4)[0] >= i, 'never back');
  assert.equal(Core.wayAim(way, 0, last[0] - 1, last[1], 4)[3], false, 'the search starts at i: the first point is far away, so it stays the aim');
  [i, ax, az, done] = Core.wayAim(way, way.length - 4, last[0] - 1, last[1], 4);
  assert.ok(done && i === way.length - 1 && ax === last[0], 'done at the end of the way');
  // a vehicle that steers for the aim comes out through the door without touching its frame and ends on the way
  let x = 3, z = -G.top + 2, h = 0.3, wi = 0, out = false, n = 0;
  while (!out && n++ < 3000){
    const a = Core.wayAim(way, wi, x, z, 4); wi = a[0]; out = a[3];
    const turn = Math.atan2(Math.sin(Math.atan2(a[1] - x, a[2] - z) - h), Math.cos(Math.atan2(a[1] - x, a[2] - z) - h));
    h += Math.max(-1.1, Math.min(1.1, turn * 3)) / 60; x += Math.sin(h) * G.out / 60; z += Math.cos(h) * G.out / 60;
    if (Math.abs(z) < 1) assert.ok(Math.abs(x) < G.door - 1.5, 'through the middle of the door');
  }
  assert.ok(out && Math.abs(z - last[1]) < 0.6 && Math.abs(h - Math.PI / 2) < 0.2, 'ends in the lane, heading east');
  // the vehicle stops following 4 m short of the last point: that is still before the next crossing (7 m to each side of x = 48)
  assert.ok(sx + x < Math.ceil(sx / 48) * 48 - 7, 'before the next crossing');
});

test('the garage: a level hall, a ramp that climbs to the street, and walls all round', () => {
  const G = Core.GARAGE, top = G.z1 + G.ramp;
  assert.equal(Core.garageFloor(0, G.z0), G.y, 'the hall is level');
  assert.equal(Core.garageFloor(9, G.z1), G.y, 'up to the foot of the ramp');
  assert.ok(Math.abs(Core.garageFloor(0, G.z1 + G.ramp / 2) - (G.y + G.rise / 2)) < 1e-9, 'halfway up the ramp');
  assert.equal(Core.garageFloor(0, top), G.y + G.rise);
  assert.equal(Core.garageFloor(0, top + G.top), G.y + G.rise, 'level again at the top');
  assert.equal(Core.garageGrade(0, 0), 0, 'no slope in the hall');
  assert.ok(Math.abs(Core.garageGrade(G.z1 + 5, 0) - G.rise / G.ramp) < 1e-9, 'uphill, driving up the ramp');
  assert.ok(Core.garageGrade(G.z1 + 5, Math.PI) < 0, 'downhill, driving back down');
  assert.equal(Core.garageOut(top), false, 'still on the ramp');
  assert.equal(Core.garageOut(top + 2), true, 'over the top: the street begins');
  assert.ok(G.y < -10, 'well under the city');
  // every vehicle stands inside the hall, clear of the walls and pillars, and can climb the ramp from a standstill at its foot
  const walls = Core.garageWalls();
  for (const k of G.order){
    const [x, z, h] = G.bays[k], V = Core.VEH[k];
    for (const s of V.samples) for (const c of walls) assert.equal(Core.collidePoint(x + Math.sin(h) * s, z + Math.cos(h) * s, V.r, c), null, k + ' is clear of the walls');
    let sp = 0, zz = G.z1, t = 0;
    while (zz < top && t < 30){ sp = Core.stepSpeed(sp, { up: true }, 1 / 60, Math.min(G.speed, Core.topSpeed(Core.MODES.city, V, 0, false)), V, Core.garageGrade(zz, 0)); zz += sp / 60; t += 1 / 60; }
    assert.ok(t < 10, k + ' climbs the ramp in ' + t.toFixed(1) + ' s');
  }
  // the walls hold: a point pushed against each side of the hall is pushed back in, and the only way out is the opening to the ramp
  assert.ok(Core.collidePoint(G.x, 0, 1, walls[2]), 'east wall');
  assert.ok(Core.collidePoint(-G.x, 0, 1, walls[1]), 'west wall');
  assert.ok(Core.collidePoint(0, G.z0, 1, walls[0]), 'back wall');
  assert.ok(walls.every(c => !Core.collidePoint(0, G.z1 + 0.5, 1, c)), 'the opening is free');
  assert.ok(walls.some(c => Core.collidePoint(G.door + 2, G.z1 + 0.5, 1, c)), 'beside the opening is wall');
  assert.ok(walls.some(c => Core.collidePoint(0, top + G.top, 1, c)), 'the far end of the ramp is closed');
});

test('the heist: the escape time from room 1 is read only when it is possible and fresh, and the drive is added to it', () => {
  const R1 = require('../../room-1-escape/js/rules.js');
  assert.equal(Core.HEIST.key, R1.HEIST_KEY, 'both rooms use the same place in the storage');
  const now = 1.8e12, ok = JSON.stringify({ escape: 200.456, at: now - 60000 });
  assert.deepEqual(Core.parseHeist(ok, now), { escape: 200.46, at: now - 60000 });
  // what room 1 writes is what room 2 reads
  assert.deepEqual(Core.parseHeist(R1.handover({ ending: 'A', time: 400, graceUsed: false }, now), now), { escape: 200, at: now });
  const bad = [null, '', '{', '[]', '42', JSON.stringify({ escape: 0.5, at: now }), JSON.stringify({ escape: 661, at: now }), JSON.stringify({ escape: '200', at: now }),
    JSON.stringify({ escape: 200 }), JSON.stringify({ escape: 200, at: now + 120000 }), JSON.stringify({ escape: 200, at: now - Core.HEIST.maxAge - 1 }), 'x'.repeat(300)];
  for (const b of bad) assert.equal(Core.parseHeist(b, now), null, String(b).slice(0, 40));
  assert.equal(Core.parseHeist(ok, NaN), null);
  assert.equal(Core.heistTotal(200.46, 99.5), 299.96);
  for (const [e, d] of [[0, 60], [661, 60], [200, 9], [200, 901], [NaN, 60], [200, '60']]) assert.equal(Core.heistTotal(e, d), null, e + ' + ' + d);
});

test('the heist leaderboard keeps each driver\'s best heist, fastest first, and drops what cannot be', () => {
  let r = Core.recordHeist([], ' Alex ', 200, 100, 'bike');
  assert.deepEqual(r.list, [{ name: 'Alex', escape: 200, drive: 100, time: 300, veh: 'bike' }]);
  assert.deepEqual([r.rank, r.best, r.prev], [1, true, null]);
  r = Core.recordHeist(r.list, 'Bea', 150, 120, 'car');
  assert.deepEqual(r.list.map(x => x.name), ['Bea', 'Alex']); assert.equal(r.rank, 1);
  // a slower heist never replaces the best one; a faster one does, under the name as first written
  let s = Core.recordHeist(r.list, 'alex', 300, 100, 'car');
  assert.deepEqual([s.rank, s.best, s.prev, s.list[1].time], [2, false, 300, 300]);
  s = Core.recordHeist(r.list, 'alex', 100, 100, 'truck');
  assert.deepEqual(s.list.map(x => [x.name, x.time, x.veh]), [['Alex', 200, 'truck'], ['Bea', 270, 'car']]);
  // a tie goes behind the heist that was there first
  assert.deepEqual(Core.recordHeist(r.list, 'Cy', 170, 100, 'car').list.map(x => x.name), ['Bea', 'Cy', 'Alex']);
  // refused: no name, impossible parts
  for (const [n, e, d] of [['', 200, 100], ['<>', 200, 100], ['Dan', 0, 100], ['Dan', 200, 5], ['Dan', 700, 100]]) assert.deepEqual(Core.recordHeist(r.list, n, e, d, 'car'), { list: r.list, rank: 0, best: false, prev: null });
  // a saved board is cleaned when read: the total is always worked out again from the two parts
  const saved = JSON.stringify([{ name: 'Alex', escape: 200, drive: 100, time: 1, veh: 'ufo' }, { name: 'alex', escape: 100, drive: 50 }, { name: 'Bad', escape: 9999, drive: 50 }, { name: '<>', escape: 100, drive: 50 }, null, 7]);
  assert.deepEqual(Core.parseHeistBoard(saved), [{ name: 'alex', escape: 100, drive: 50, time: 150, veh: 'car' }]);
  for (const bad of [null, '', '{', '{}', '42', 'x'.repeat(50000)]) assert.deepEqual(Core.parseHeistBoard(bad), []);
  // the rows on the end screen: the top five, and the driver's own row when it is further down
  let list = [];
  for (let i = 0; i < 8; i++) list = Core.recordHeist(list, 'D' + i, 100 + i * 10, 60, 'car').list;
  const rows = Core.heistRows(list, 'd7');
  assert.deepEqual(rows.map(x => x.place), [1, 2, 3, 4, 5, 8]);
  assert.deepEqual([rows[5].me, rows[5].gap, rows[0].me], [true, true, false]);
  assert.equal(Core.heistRows(list, 'D1')[1].me, true);
  assert.equal(Core.heistRows(list, 'D1').length, 5);
});

test('the garage: you come in through the tunnel door, in the wall opposite the vehicles, and stand clear of every wall and pillar', () => {
  const G = Core.GARAGE, [x, z] = G.start;
  // the door is in the wall of the ramp, beside its opening, and the player stands just inside it
  assert.ok(Math.abs(G.entry) > G.door + 1.5 && Math.abs(G.entry) < G.x - 1.5, 'the door is in the wall beside the opening, clear of the corner');
  assert.equal(x, G.entry);
  assert.ok(G.z1 - z > 0.8 && G.z1 - z < 2.5, 'just inside the door');
  // every vehicle stands across the hall, at least 15 m away, on the far side
  for (const k of G.order) assert.ok(z - G.bays[k][1] > 15, k + ' stands on the other side');
  // not inside a wall or a pillar, with room to turn
  for (const c of Core.garageWalls()) assert.ok(x < c.x0 - 0.5 || x > c.x1 + 0.5 || z < c.z0 - 0.5 || z > c.z1 + 0.5, 'clear of ' + JSON.stringify(c));
  assert.equal(Core.garageFloor(x, z), G.y, 'on the level floor of the hall');
});
