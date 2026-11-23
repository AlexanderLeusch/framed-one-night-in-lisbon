// End-to-end: plays the real game in headless Chrome and checks the main workflows, rejected input and the error screen.
// ### Talks to Chrome over the DevTools protocol with Node's built-in WebSocket, so it needs no npm packages. 3D runs on
// ### Chrome's software renderer (SwiftShader), so it also works on a CI machine without a graphics card. If no Chrome
// ### or Edge is installed the whole file is skipped. Set CHROME_PATH to use a specific browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { createServer } = require('../../tools/serve.js');

function findChrome(){
  const list = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']){
    try { list.push(execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (e) {}
  }
  return list.find(p => p && fs.existsSync(p));
}

const CHROME = findChrome();
const LOAD_MS = 120000;
// which part of the workflows to run: 'chase' (room 2), its two halves 'chase-drive' and 'chase-pages', 'escape', or everything
// when it is not set (see the small files beside this one, one per part)
const PART = process.env.BROWSER_PART || '';
if (!['', 'chase', 'chase-drive', 'chase-pages', 'escape'].includes(PART)) throw new Error('BROWSER_PART must be chase, chase-drive, chase-pages or escape, not ' + PART);
let chrome, server, base, ws, profile, seq = 0;
const pending = new Map(), errors = [];
// ### The escape room asks the Openverse API for its air vent and plays the answer from Freesound's server. Both hosts are
// ### answered here by stand-ins (a fixed answer, and the room's own vent recording as the "Freesound" file), so the test
// ### needs no internet, is the same every time and never counts against the API's limit.
const VENT_HOSTS = ['https://api.openverse.org/', 'https://cdn.freesound.org/'], ventCalls = { api: 0, file: 0 };
const VENT_ANSWER = { result_count: 2, results: [
  { license: 'by', url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', duration: 60000, title: 'Ventilation (CC BY)', creator: 'not this one' },
  { license: 'cc0', url: 'https://cdn.freesound.org/previews/536/536942_1-hq.mp3', duration: 60000, title: 'Ventilation hum (test)', creator: 'stand-in',
    foreign_landing_url: 'https://freesound.org/people/stand-in/sounds/536942', tags: [{ name: 'hvac' }] }] };
function standIn(p){
  const api = p.request.url.startsWith(VENT_HOSTS[0]);
  ventCalls[api ? 'api' : 'file']++;
  const body = api ? Buffer.from(JSON.stringify(VENT_ANSWER)) : fs.readFileSync(path.join(__dirname, '../../room-1-escape/sounds/air-vent.mp3'));
  send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, body: body.toString('base64'),
    responseHeaders: [{ name: 'Content-Type', value: api ? 'application/json' : 'audio/mpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }] });
}

// ### The online leaderboard (Supabase) is answered by a stand-in too: a tiny fake that keeps driver names and board rows in
// ### memory. So the test never touches the real database, and it can switch the "internet" off (supa.down).
const SUPA = 'https://nqjeonoudywpdwivfuyp.supabase.co/', SUPA_UID = '11111111-2222-4333-8444-555555555555';
const supa = { down: false, names: [], mine: null, rows: [], calls: [] };
function supaStandIn(p){
  const u = new URL(p.request.url), m = p.request.method, key = m + ' ' + u.pathname;
  supa.calls.push(key);
  if (supa.down) return send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' });
  let status = 200, body = '[]';
  if (m === 'OPTIONS'){ status = 204; body = ''; }
  else if (key === 'GET /rest/v1/drivers'){
    const q = u.searchParams.get('name');
    body = JSON.stringify(q ? supa.names.filter(n => n.toLowerCase() === q.replace(/^ilike\./, '').replace(/\\(.)/g, '$1').toLowerCase()).map(name => ({ name })) : supa.mine ? [{ name: supa.mine }] : []);
  } else if (key === 'POST /auth/v1/signup') body = JSON.stringify({ access_token: 't'.repeat(40), refresh_token: 'r', expires_in: 3600, user: { id: SUPA_UID, is_anonymous: true } });
  else if (key === 'POST /rest/v1/drivers'){ const n = JSON.parse(p.request.postData).name; supa.names.push(n); supa.mine = n; status = 201; body = ''; }
  else if (key === 'GET /rest/v1/board_all' || key === 'GET /rest/v1/board_month') body = JSON.stringify(supa.rows);
  else if (key === 'POST /auth/v1/logout'){ status = 204; body = ''; supa.mine = null; }
  send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, body: Buffer.from(body).toString('base64'),
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' }] });
}

function send(method, params = {}){
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression){
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, ms = 30000, label = expression){
  const end = Date.now() + ms;
  while (Date.now() < end){
    try { if (await evaluate(expression)) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('timed out waiting for: ' + label);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (type, code) => evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true })), true`);
const click = sel => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ${sel.replace(/'/g, '')}'); b.click(); return true; })()`);
const text = sel => evaluate(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const menuReady = "!document.getElementById('overlay').hidden && !!document.querySelector('[data-action=\"go\"]')";
const playing = "document.getElementById('overlay').hidden && !document.getElementById('hud').classList.contains('off')";
// A Lisbon run begins in the garage and then shows the map of the evidence; this takes the short way to the street
// ("Skip the garage"), presses "Start driving" and waits until the car can move
const inGarage = "!!document.querySelector('#card.garage [data-action=\"board\"]')";
async function startDriving(label){
  await waitFor(inGarage + " || !!document.getElementById('ovMap') || (" + playing + ")", 30000, label);
  if (await evaluate(inGarage)) await click('[data-action="street"]');
  await waitFor("!!document.getElementById('ovMap') || (" + playing + ")", 30000, label);
  if (await evaluate("!!document.getElementById('ovMap')")) await click('[data-action="resume"]');
  await waitFor(playing, 30000, label);
}
async function load(){
  errors.length = 0;
  await send('Page.navigate', { url: base + 'room-2-chase/' });
  await waitFor(menuReady, LOAD_MS, 'main menu');
}

test('CI really runs the browser tests', { skip: !process.env.CI && 'only on the CI server' }, () => {
  assert.ok(CHROME, 'no browser on the CI server: the browser tests would be skipped and the deploy would go ahead untested');
});

test('browser workflows', { skip: !CHROME && 'no Chrome or Edge found (set CHROME_PATH)', timeout: 1200000 }, async t => {
  server = createServer().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-heist-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,800', '--force-device-scale-factor=0.5', '--autoplay-policy=no-user-gesture-required',
    // (--force-device-scale-factor=0.5: the page keeps its 1280 x 800 layout but is drawn with a quarter of the pixels; without a
    // graphics card every pixel is worked out by the processor, and the game's clock moves at most 50 ms per drawn frame)
    // a desktop with a mouse on every machine: on a laptop with a touchscreen, headless Chrome (no mouse) would report a touch
    // device, and the escape room would rightly show its touch controls instead of the arrow keys the tests use
    '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2',
    // Ubuntu CI machines block Chrome's sandbox; the page is our own local game, so running without it there is fine
    ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank']);
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) resolve(m[1]); });
    chrome.once('exit', c => reject(new Error('Chrome exited with ' + c + '\n' + buf)));
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)){ const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    else if (msg.method === 'Fetch.requestPaused') (msg.params.request.url.startsWith(SUPA) ? supaStandIn : standIn)(msg.params);
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    // CSP violations, blocked or failed requests (the browser asks for a favicon on its own, which this game does not have)
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon.ico/.test(msg.params.entry.url || '')) errors.push(msg.params.entry.text);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: VENT_HOSTS.concat(SUPA).map(h => ({ urlPattern: h + '*' })) });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Software rendering is slow, so start in Balanced graphics unless a test sets something else on purpose
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (!localStorage.getItem('shard-heist-gfx')) localStorage.setItem('shard-heist-gfx', 'balanced'); } catch (e) {}" });

  // ### The workflows come in three parts that do not depend on each other: the drive in room 2 (the menu, a run from the
  // ### garage to the street, pause, the story), the pages of room 2 (saved data, the heist, error screens, volumes, the online
  // ### driver, the phone), and, from the start page on, the escape room (room 1). PART picks one of them, so CI can run the
  // ### three side by side; 'chase' runs both parts of room 2, and without PART (as with `npm run test:browser`) everything
  // ### runs, one after the other. A part that is left out is not run at all, and not counted.
  const part = (...on) => (name, fn) => PART === '' || on.includes(PART) ? t.test(name, fn) : undefined;
  const chase = part('chase', 'chase-drive'), pages = part('chase', 'chase-pages'), escape = part('escape');

  try {
    await chase('the menu loads with Lisbon as the only map, three vehicles and the story mode', async () => {
      await load();
      assert.equal(await evaluate("document.querySelectorAll('[data-pick=\"mode\"]').length"), 0, 'there is no choice of map');
      assert.match(await text('#missionEye'), /^(Rua|Praça|Baixa) /, 'the HUD names a street of Lisbon');
      assert.equal(await evaluate("document.querySelectorAll('[data-pick=\"veh\"]').length"), 3);
      assert.equal(await evaluate("[...document.querySelectorAll('.vtab img')].filter(i => i.src.startsWith('data:image/png') && i.complete && i.naturalWidth > 100).length"), 3, 'the previews are pictures of the real models');
      assert.ok(await evaluate("!!document.querySelector('[data-action=\"story\"]')"));
      assert.ok(await evaluate("document.getElementById('fatal').hidden"), 'no error screen');
      assert.deepEqual(errors, []);
    });

    await chase('the radio chips change the station and refuse nothing silently', async () => {
      assert.equal(await evaluate("document.querySelectorAll('[data-radio]').length"), 8);
      await click('[data-radio="techno"]');
      assert.equal(await evaluate("document.getElementById('radioTag').textContent"), 'Techno');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-radio')"), 'techno');
      await click('[data-radio="off"]');
      assert.equal(await evaluate("document.getElementById('radioTag').hidden"), true);
      assert.deepEqual(errors, []);
    });

    await chase('choosing a vehicle updates the stats card', async () => {
      await click('[data-pick="veh"][data-val="bike"]');
      assert.equal(await evaluate("document.querySelector('[data-pick=\"veh\"][data-val=\"bike\"]').getAttribute('aria-pressed')"), 'true');
      assert.match(await text('#vehDetail'), /Superbike/);
      await click('[data-pick="veh"][data-val="car"]');
      assert.match(await text('#vehDetail'), /Muscle coupe/);
    });

    await chase('a run starts, the timer runs and the throttle moves the car', async () => {
      await click('[data-action="go"]');
      // the run begins on foot in the garage: no clock, no HUD, the three vehicles to choose from
      await waitFor(inGarage, 30000, 'the garage');
      assert.match(await text('#card h2'), /Choose your getaway vehicle/);
      assert.ok(await evaluate("document.getElementById('hud').classList.contains('off')"), 'no HUD in the garage');
      assert.equal(await evaluate("document.querySelectorAll('#card.garage [data-pick=\"veh\"]').length"), 3);
      await click('#card.garage [data-pick="veh"][data-val="bike"]');
      assert.equal(await evaluate("document.querySelector('#card.garage [data-pick=\"veh\"][aria-pressed=\"true\"]').dataset.val"), 'bike');
      assert.match(await text('#garNote'), /agile/);
      // get in (the walk to the door, the seat), then hold the gas: the motorcycle stands nose to the ramp and drives up to the street
      await click('[data-action="board"]');
      await waitFor("document.getElementById('overlay').hidden", 10000, 'the garage card to go away');
      await key('keydown', 'KeyW');
      // about 15 s of game time (the walk, getting in, 50 m up the ramp, then the vehicle drives itself to the traffic light
      // before the roller door); a slow CI machine draws only a few frames a second, and fewer still once the city is drawn.
      // CI machines differ: the same drive took 231 s on one and more than 300 s on a slower one, so it gets 10 minutes
      await waitFor("!!document.getElementById('ovMap')", 600000, 'the map of the evidence at the garage door');
      assert.ok(await evaluate("!document.getElementById('hud').classList.contains('off')"), 'the HUD is back at the door');
      await key('keyup', 'KeyW');
      assert.match(await text('#card h2'), /Where the evidence is/);
      assert.match(await evaluate("document.getElementById('ovMap').getAttribute('aria-label')"), /Photos.*Fingerprints.*Torch.*Lockpick.*Clothes.*Balaclava/);
      assert.match(await text('#garWait'), /Green in \d+ s|Almost ready|Green: the door opens/, 'the traffic light at the door');
      const clock0 = await text('#time'); await sleep(1500);
      assert.equal(await text('#time'), clock0, 'the clock waits while the map is open');
      // drive out: at green the roller door rolls up and the vehicle drives itself out into the street, then the run begins
      await click('[data-action="drive-out"]');
      await waitFor(playing, 30000, 'the map to close');
      await waitFor("!document.getElementById('guide').hidden", 600000, 'driven out onto the street: the guide arrow');
      assert.match(await text('#guideName'), /Photos|Fingerprints|Torch|Lockpick|Clothes|Balaclava/);
      const t0 = await text('#time');
      await key('keydown', 'KeyW');
      await waitFor("parseInt(document.getElementById('speed').textContent) > 20", 30000, 'speed above 20 km/h');
      await key('keyup', 'KeyW');
      // the clock advances at most 50 ms per frame, so on a slow software renderer this can take a while
      await waitFor(`document.getElementById('time').textContent !== ${JSON.stringify(t0)}`, 120000, 'timer to count down');
      assert.deepEqual(errors, []);
    });

    await chase('rejected: a card button cannot act while driving', async () => {
      await evaluate("const c = document.getElementById('card'); c.innerHTML = '<button class=\"btn\" data-action=\"menu\">x</button><button class=\"btn\" data-action=\"next-act\">y</button>'; c.querySelectorAll('button').forEach(b => b.click()); true");
      await sleep(300);
      assert.ok(await evaluate(playing), 'still driving');
    });

    await chase('pause and resume with the keyboard', async () => {
      await key('keydown', 'KeyP');
      await waitFor("!document.getElementById('overlay').hidden", 5000, 'pause card');
      assert.equal(await text('#card h2'), 'Paused');
      const t0 = await text('#time');
      await sleep(1500);
      assert.equal(await text('#time'), t0, 'the clock stops while paused');
      await key('keydown', 'Enter');
      await waitFor(playing, 5000, 'resume');
    });

    await chase('story mode: prologue, then the story starts in Lisbon', async () => {
      await key('keydown', 'KeyP');
      await waitFor("!document.getElementById('overlay').hidden", 5000);
      await click('[data-action="menu"]');
      await waitFor(menuReady, 30000);
      await click('[data-action="story"]');
      assert.match(await text('#card h1'), /Necklace/);
      assert.equal(await evaluate("document.querySelectorAll('.acts > div').length"), 1, 'the story is one act, in Lisbon');
      await click('[data-action="act"]');
      await startDriving('the story to start');
      assert.match(await text('#missionEye'), /Story · The Evidence/);
      assert.equal(await evaluate("[...document.querySelectorAll('#chips .chip.ev')].map(c => c.getAttribute('aria-label')).join()"), 'Photos,Fingerprints,Torch,Lockpick,Clothes,Balaclava', 'six pieces of evidence to find in Lisbon');
      assert.deepEqual(errors, []);
    });

    // the pages of room 2 start from the loaded menu, whether or not the drive ran before them
    if (PART === 'chase-pages') await load();
    await pages('rejected: tampered saved data falls back to the defaults', async () => {
      await evaluate("localStorage.setItem('shard-heist-pick', '{\"mode\":\"constructor\",\"veh\":\"__proto__\"}'); localStorage.setItem('shard-heist-city-best', 'NaN'); localStorage.setItem('shard-heist-gfx', 'toString'); true");
      await load();
      assert.match(await text('#missionEye'), /^(Rua|Praça|Baixa) /, 'an unknown map falls back to Lisbon: the HUD names one of its streets');
      assert.equal(await evaluate("document.querySelector('[data-pick=\"veh\"][aria-pressed=\"true\"]').dataset.val"), 'car');
      assert.match(await text('.m-foot'), /Lisbon no run yet/);
      assert.deepEqual(errors, []);
      await evaluate('localStorage.clear(), true');
    });

    await pages('the heist: from room 1 with an escape time you stand in the garage at once, with no menu and no card; rejected: a tampered or missing escape time opens the menu', async () => {
      await evaluate("localStorage.setItem('shard-heist-handover', JSON.stringify({ escape: 187.7, at: Date.now() })), true");
      errors.length = 0;
      await send('Page.navigate', { url: base + 'room-2-chase/?heist=1#arrive' });
      await waitFor(inGarage, LOAD_MS, 'the garage, straight from the tunnel');
      assert.equal(await evaluate("!!document.querySelector('[data-action=\"go\"]')"), false, 'the menu is skipped');
      assert.match(await text('#toast'), /Escape time 3:07\.7, the drive is added/, 'the escape time from room 1 is shown');
      await waitFor("document.getElementById('arrive').classList.contains('gone')", 10000, 'the glare of the headlights clears');
      assert.deepEqual(errors, []);
      // rejected: an impossible escape time is not a heist (old and broken ones are covered by the unit tests), and the glare still clears
      await evaluate("localStorage.setItem('shard-heist-handover', JSON.stringify({ escape: 5000, at: Date.now() })), true");
      await send('Page.navigate', { url: base + 'room-2-chase/?heist=1#arrive' });
      await send('Page.reload');
      await waitFor(menuReady, LOAD_MS, 'main menu for an impossible escape time');
      await waitFor("document.getElementById('arrive').classList.contains('gone')", 10000, 'no glare over the menu');
      // a valid escape time alone is not enough: only the way from room 1 (?heist=1) starts a heist
      await evaluate("localStorage.setItem('shard-heist-handover', JSON.stringify({ escape: 187.7, at: Date.now() })), true");
      await load();
      assert.equal(await evaluate(inGarage), false);
      await evaluate('localStorage.clear(), true');
    });
    await pages('error screen: a blocked library shows a clear message instead of a black page', async () => {
      await send('Network.setBlockedURLs', { urls: ['*cdnjs.cloudflare.com*'] });
      await send('Page.navigate', { url: base + 'room-2-chase/' });
      await waitFor("!document.getElementById('fatal').hidden", 30000, 'error screen');
      assert.equal(await text('#fatalTitle'), 'The game could not load');
      assert.match(await text('#fatalText'), /cdnjs\.cloudflare\.com/);
      assert.ok(await evaluate("document.getElementById('fatalDismiss').hidden"), 'a load failure can only be fixed by reloading');
      await send('Network.setBlockedURLs', { urls: [] });
    });

    await pages('error screen: no WebGL shows how to fix it', async () => {
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: "const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(k, o){ return /webgl/.test(k) ? null : g.call(this, k, o); };" });
      await send('Page.navigate', { url: base + 'room-2-chase/' });
      await waitFor("!document.getElementById('fatal').hidden", 30000, 'error screen');
      assert.equal(await text('#fatalTitle'), '3D graphics are not available');
      assert.match(await text('#fatalText'), /WebGL/);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    });

    // ---------- Room 1: the escape room ----------
    const hs = k => click(`[data-hotspot="${k}"]`);
    // ### The first time a mini game comes up, a card explains it; the game and its 30 s start with "Start the game".
    const startMini = async () => {
      await waitFor("!!document.querySelector('#card [data-do=\"mini-start\"]')", 5000, 'the card that explains the mini game');
      assert.equal(await evaluate("!!document.querySelector('#card .mg')"), false, 'no game and no 30 s while the rules are read');
      await click('[data-do="mini-start"]');
    };
    const seconds = async () => { const [m, sec] = (await text('#time')).split(':').map(Number); return m * 60 + sec; };

    await pages('the game, music and police volumes are set in the menu, kept, and refused when tampered with', async () => {
      await load();
      const slide = (k, v) => evaluate(`(() => { const r = document.querySelector('[data-vol="${k}"]'); r.value = ${v}; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      assert.equal(await evaluate("document.querySelectorAll('#card [data-vol]').length"), 3, 'three sliders in the menu');
      await slide('game', 40); await slide('music', 15); await slide('police', 35);
      assert.equal(await evaluate("localStorage.getItem('shard-heist-volume')"), '{"game":0.4,"music":0.15}');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-police-volume')"), '0.35', 'the police volume is kept on its own');
      await load();
      assert.equal(await evaluate("document.querySelector('[data-vol=\"game\"]').value + '/' + document.querySelector('[data-vol=\"music\"]').value"), '40/15', 'kept after a reload');
      assert.equal(await evaluate("document.querySelector('[data-vol=\"police\"]').value"), '35', 'the police volume is kept after a reload');
      await click('[data-action="go"]');
      await startDriving('a run');
      await key('keydown', 'KeyP');
      await waitFor("document.querySelectorAll('#card [data-vol]').length === 3", 10000, 'sliders on the pause card');
      await click('[data-action="menu"]');
      await evaluate("localStorage.setItem('shard-heist-volume', '{\"game\":\"loud\"}'), localStorage.setItem('shard-heist-police-volume', 'loud'), true");
      await load();
      assert.equal(await evaluate("document.querySelector('[data-vol=\"game\"]').value"), '100', 'rejected: tampered volume falls back to full');
      assert.equal(await evaluate("document.querySelector('[data-vol=\"police\"]').value"), '100', 'rejected: tampered police volume falls back to full');
      await evaluate("localStorage.removeItem('shard-heist-volume'), localStorage.removeItem('shard-heist-police-volume'), true");
      assert.deepEqual(errors, []);
    });

    await pages('online driver: a name alone puts you on the online board; taken, empty and HTML names are refused; offline falls back to this device', async () => {
      await evaluate(`localStorage.setItem('shard-heist-board', JSON.stringify({ drivers: ['Sarah'], runs: { city: [{ name: '<b>Eve</b>', time: 99 }] } })), localStorage.removeItem('shard-heist-session'), true`);
      Object.assign(supa, { down: false, names: ['Taken'], mine: null, rows: [{ name: '<img src=x onerror=window.__xss=1>', time: '70.00', veh: 'car', stars: 3, driver_id: 'x' }], calls: [] });
      await load();
      const acc = () => text('#card [data-account]');
      const board = () => text('#card [data-lb-menu]');
      assert.match(await acc(), /No email, no password/);
      assert.match(await board(), /This device only/);
      assert.match(await board(), /bEveb/, 'rejected: HTML in a saved name is cleaned away');
      assert.equal(await evaluate("!document.querySelector('#card [data-lb-menu] .lb-name b')"), true);
      const play = (v, how) => evaluate(`(() => { const i = document.querySelector('#card [data-acc-field="play"]'); i.value = ${JSON.stringify(v)}; ${how === 'enter' ? "i.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }))" : "document.querySelector('#card [data-acc=\"play\"]').click()"}; return true; })()`);
      await play('<>', 'click');
      assert.match(await acc(), /Enter a driver name/, 'rejected: a name that is empty after cleaning');
      assert.equal(supa.calls.length, 0, 'nothing was sent');
      await play('taken', 'click');
      await waitFor("/taken/.test(document.querySelector('#card [data-account]').innerText)", 5000, 'taken message');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-session')"), null, 'rejected: no account is made for a taken name');
      await play('  Alex  ', 'enter');
      await waitFor("/Online as Alex/.test(document.querySelector('#card [data-account]').innerText)", 5000, 'signed in as Alex');
      assert.ok(await evaluate(menuReady), 'Enter in the name field does not start a run');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-driver')"), 'Alex');
      await waitFor("/Online/.test(document.querySelector('#card [data-lb-menu]').textContent) && /img src/.test(document.querySelector('#card [data-lb-menu]').textContent)", 5000, 'online board');
      assert.equal(await evaluate("!document.querySelector('#card img[src=\"x\"]') && !window.__xss"), true, 'rejected: HTML in an online name is shown as text');
      assert.ok(!supa.calls.some(c => c.startsWith('POST /auth/v1/signup') && supa.calls.indexOf(c) < supa.calls.indexOf('GET /rest/v1/drivers')), 'the name is checked before an account is made');
      await load();
      await waitFor("/Online as Alex/.test(document.querySelector('#card [data-account]').innerText)", 60000, 'still signed in after a reload');
      await click('#card [data-acc="out"]');
      await waitFor("!!document.querySelector('#card [data-acc-field=\"play\"]')", 5000, 'signed out');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-session')"), '');
      supa.down = true;
      await play('Bea', 'click');
      await waitFor("/not reachable/.test(document.querySelector('#card [data-account]').innerText)", 10000, 'offline message');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-driver')"), 'Bea', 'offline: the name becomes a driver of this device');
      supa.down = false;
      // the failed requests of the offline step are expected; anything else would still fail the test
      for (let i = errors.length - 1; i >= 0; i--) if (/supabase\.co|ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(errors[i])) errors.splice(i, 1);
      await evaluate("localStorage.removeItem('shard-heist-board'), localStorage.removeItem('shard-heist-driver'), localStorage.removeItem('shard-heist-session'), true");
      assert.deepEqual(errors, []);
    });

    await pages('phone: tilt steering is offered, hides the steering buttons sideways, and is refused upright', async () => {
      await load();
      // the choice is offered exactly when the browser reports a touch screen and a motion sensor (a mouse-only desktop is refused)
      assert.equal(await evaluate("document.querySelectorAll('[data-steer]').length > 0"), await evaluate("matchMedia('(pointer: coarse)').matches && typeof DeviceOrientationEvent !== 'undefined'"), 'tilt is offered only to touch devices with a sensor');
      const phone = (width, height, type, angle) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenOrientation: { type, angle } });
      await phone(844, 390, 'landscapePrimary', 90);
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 15, gamma: -70 });
      await load();
      assert.equal(await evaluate("document.querySelector('[data-steer=\"tilt\"]').getAttribute('aria-pressed')"), 'true', 'a phone starts with tilt');
      await click('[data-action="go"]');
      await startDriving('run on the phone');
      await waitFor("document.getElementById('touch').classList.contains('tilt')", 20000, 'tilt to take over');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-key=\"left\"]')).visibility"), 'hidden');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-key=\"up\"]')).visibility"), 'visible', 'gas stays');
      await phone(390, 844, 'portraitPrimary', 0);
      await waitFor("!document.getElementById('touch').classList.contains('tilt')", 20000, 'buttons to come back upright');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-key=\"left\"]')).visibility"), 'visible');
      await phone(844, 390, 'landscapePrimary', 90);
      await key('keydown', 'KeyP');
      await waitFor("!!document.querySelector('[data-steer=\"pads\"]')", 20000, 'choice on the pause card');
      await click('[data-steer="pads"]');
      await click('[data-action="resume"]');
      await waitFor("!document.getElementById('touch').classList.contains('tilt')", 20000, 'buttons when chosen');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-steer')"), 'pads');
      await evaluate("localStorage.removeItem('shard-heist-steer'), true");
      assert.deepEqual(errors, []);
      await send('DeviceOrientation.clearDeviceOrientationOverride');
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.clearDeviceMetricsOverride');
    });

    await escape('the start page has one way in, the heist page, shows the game on its monitor and runs no script', async () => {
      errors.length = 0;
      await send('Page.navigate', { url: base });
      await waitFor("!!document.querySelector('.start-heist')", 15000, 'start page');
      // the stylesheet may arrive a moment after the markup
      await waitFor("getComputedStyle(document.querySelector('.start-heist')).fontFamily.includes('Big Shoulders')", 10000, 'start page stylesheet').catch(() => {});
      assert.equal(await evaluate("[...document.querySelectorAll('main a')].map(a => a.getAttribute('href')).join()"), 'heist/,https://github.com/AlexanderLeusch/framed-one-night-in-lisbon', 'one button, and the link to the source');
      assert.match(await text('.start-heist'), /Start the game/);
      assert.equal(await evaluate("document.scripts.length"), 0, 'no script on the start page');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.start-heist')).fontFamily.includes('Big Shoulders')"), true, 'the shared fonts load');
      // the four pictures of the game have loaded and lie in the monitor
      await waitFor("[...document.querySelectorAll('.peek img')].every(i => i.complete)", 15000, 'the pictures');
      assert.equal(await evaluate("[...document.querySelectorAll('.peek img')].filter(i => i.naturalWidth === 1600 && i.naturalHeight === 900).length"), 4);
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, 'nothing sticks out sideways');
      // the button leads to the heist page
      await click('.start-heist');
      await waitFor("location.pathname.endsWith('/heist/') && !!document.getElementById('boardBox')", 15000, 'the heist page');
      assert.deepEqual(errors, []);
    });

    // ### Math.random is fixed for the escape room, so the mini games are dealt as battleship (the tile), spot the difference
    // ### (the mirror) and tic-tac-toe (the scratches), and the tic-tac-toe bot always takes the last free cell.
    let fixedRandom;
    await escape('the heist page: a driver name for both rooms, room 2 is loaded under room 1, and it is there the moment room 1 is left', async () => {
      // room 1 would tell the heist page itself at Ending A (see the last test here); to leave it at once, this stand-in does the
      // same from inside its frame: the escape time into the storage, then the message
      const { identifier: leaver } = await send('Page.addScriptToEvaluateOnNewDocument', { source: "if (/heist=frame/.test(location.search)) window.__leaveRoom1 = () => { localStorage.setItem('shard-heist-handover', JSON.stringify({ escape: 187.7, at: Date.now() })); parent.postMessage({ shardHeist: 'leave' }, location.origin); };" });
      Object.assign(supa, { down: false, names: ['Sarah'], mine: null, calls: [] });
      await evaluate("localStorage.removeItem('shard-heist-session'), localStorage.removeItem('shard-heist-driver'), localStorage.removeItem('shard-heist-board'), true").catch(() => {});
      errors.length = 0;
      await send('Page.navigate', { url: base + 'heist/' });
      await waitFor("!!document.getElementById('whoName')", 30000, 'the field for the driver name');
      // rejected: a name that is taken, and one that is nothing but markup
      const give = name => evaluate("(() => { const i = document.getElementById('whoName'); i.value = " + JSON.stringify(name) + "; document.querySelector('[data-do=\"name\"]').click(); return true; })()");
      await give('sarah');
      await waitFor("/taken/.test((document.querySelector('.heist-msg') || {}).textContent || '')", 15000, 'a taken name is refused');
      await give('<>');
      await waitFor("/Enter a driver name/.test((document.querySelector('.heist-msg') || {}).textContent || '')", 5000, 'an empty name is refused');
      assert.equal(await evaluate("document.querySelectorAll('#rooms iframe').length"), 0, 'no room is loaded before the heist is started');
      // the heist leaderboard is there before anything is played (the stand-in's online board is empty)
      await waitFor("/Online/.test((document.querySelector('#boardBox .lb-where') || {}).textContent || '')", 15000, 'the online heist board');
      assert.match(await text('#boardBox'), /No time yet/);
      assert.ok(supa.calls.includes('GET /rest/v1/heist_board'), 'the board was asked for');
      // accepted: the name goes online, becomes the driver of this device, and room 1 opens in its frame
      await give('Alex');
      await waitFor("document.querySelectorAll('#rooms iframe').length >= 1", 15000, 'room 1 in its frame');
      assert.equal(supa.mine, 'Alex', 'the name is on the online board');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-driver')"), 'Alex');
      // the game loads behind the heist page, out of sight; the bar says how far it is, and "Start now" need not wait for it
      assert.equal(await evaluate("document.getElementById('who').hidden"), false, 'the heist page stays while the game loads');
      assert.equal(await evaluate("getComputedStyle(document.getElementById('rooms')).visibility"), 'hidden', 'the rooms load out of sight');
      assert.equal(await evaluate("document.getElementById('load').hidden"), false, 'the loading bar is shown');
      assert.match(await text('#whoBox'), /game starts by itself as soon as it has loaded/);
      assert.equal(await evaluate("!!document.querySelector('[data-do=\"now\"]')"), true, '"Start now" is offered');
      // room 2 is loaded under room 1, and says when it is ready: then the bar is full and the heist starts by itself
      await waitFor("document.getElementById('rooms').dataset.ready === '1'", 240000, 'room 2 ready under room 1');
      await waitFor("document.getElementById('who').hidden", 5000, 'the heist starts by itself');
      assert.equal(await evaluate("document.getElementById('loadBar').value"), 100, 'the bar is full');
      assert.equal(await evaluate("getComputedStyle(document.getElementById('rooms')).visibility"), 'visible', 'room 1 is shown');
      assert.equal(await evaluate("document.querySelectorAll('#rooms iframe').length"), 2);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#rooms iframe.under')).visibility"), 'hidden', 'room 2 is out of sight');
      assert.match(await evaluate("document.querySelector('#rooms iframe.under').contentWindow.location.search"), /heist=wait/);
      assert.equal(await evaluate("document.querySelector('#rooms iframe.under').contentDocument.querySelector('#card.garage') !== null"), true, 'it is already down in the garage');
      // room 1 is left: room 2 is shown at once, with no page to load, and the player arrives with the escape time
      await evaluate("document.querySelector('#rooms iframe:not(.under)').contentWindow.__leaveRoom1(), true");
      await waitFor("document.getElementById('rooms').dataset.left === 'ahead' && !document.querySelector('#rooms iframe.under')", 5000, 'room 2 shown at once');
      const two = "document.querySelector('#rooms iframe[title^=\"Room 2\"]').contentDocument";
      assert.match(await evaluate(two + ".getElementById('toast').textContent"), /Escape time 3:07\.7, the drive is added/);
      assert.match(await evaluate("document.querySelector('#rooms iframe[title^=\"Room 2\"]').contentWindow.location.search"), /heist=wait/, 'the page that was loaded ahead is the one being played: nothing was loaded again');
      await waitFor(two + ".getElementById('arrive').classList.contains('gone')", 10000, 'the glare clears on the garage');
      await waitFor("document.querySelectorAll('#rooms iframe').length === 1", 5000, 'room 1 is gone');
      assert.deepEqual(errors, []);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: leaver });
      await evaluate('localStorage.clear(), true');
    });

    await escape('escape room: the briefing explains who, where and how, then the clock starts', async () => {
      fixedRandom = (await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Math.random = () => .99;' })).identifier;
      await send('Page.navigate', { url: base + 'room-1-escape/' });
      await waitFor("!!document.querySelector('#card h1')", LOAD_MS, 'briefing');
      await evaluate("localStorage.removeItem('escape-room-save'), true");
      errors.length = 0;
      await send('Page.navigate', { url: base + 'room-1-escape/' });
      await waitFor("!!document.querySelector('#card h1')", LOAD_MS, 'briefing');
      assert.match(await text('#card'), /Museu de Marinha/);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('btnNotes')).visibility"), 'hidden', 'rejected: the clue button cannot be reached during the briefing');
      await click('[data-do="next"]');
      assert.match(await text('#card'), /inmate 4471/);
      await click('[data-do="next"]');
      assert.ok(await evaluate("document.getElementById('overlay').classList.contains('cine')"), 'card 3 is a scene in the room: Hale shuts the door');
      // Hale's scene is drawn frame by frame; a slow CI machine needed more than a minute for it, so the waits here are generous
      await waitFor("/ten minutes have begun/.test(document.getElementById('cineLine').textContent)", 240000, 'Hale says the ten minutes have begun');
      for (let i = 0; i < 2; i++) await click('[data-do="next"]');
      assert.ok(!(await evaluate("document.getElementById('overlay').classList.contains('cine')")), 'the scene ends with card 3');
      assert.match(await text('#card'), /Drag/);
      assert.match(await text('#card'), /Arrow keys up and down: walk forwards and backwards/, 'the card explains walking with the arrow keys');
      assert.doesNotMatch(await text('#card'), /Buttons at the bottom/, 'no walk buttons on a computer with a keyboard');
      await click('[data-do="start"]');
      await waitFor("document.getElementById('overlay').hidden && !document.getElementById('hud').classList.contains('off')", 60000, 'clock to start');
      assert.equal(await text('#place'), 'The Door');
      assert.equal(await evaluate("document.getElementById('goBar').hidden"), true, 'the "Walk to" buttons are only shown on touch screens');
      await waitFor("document.getElementById('time').textContent !== '10:00'", 120000, 'clock to run');
      assert.deepEqual(errors, []);
    });

    await escape('escape room: the arrow keys walk you through the room; while a card is open they do not', async () => {
      // the clock starts at the door, facing it: walking backwards takes you to the sinks without any button
      await key('keydown', 'ArrowDown');
      await waitFor("document.getElementById('place').textContent === 'The Sinks'", 180000, 'walking backwards into the sinks');
      await key('keyup', 'ArrowDown');
      await key('keydown', 'KeyP');
      await waitFor("!document.getElementById('overlay').hidden", 5000, 'pause card');
      await key('keydown', 'ArrowUp'); await sleep(2500); await key('keyup', 'ArrowUp');
      assert.equal(await text('#place'), 'The Sinks', 'rejected: no walking while the pause card is open');
      await key('keydown', 'KeyP');
      await waitFor("document.getElementById('overlay').hidden", 5000, 'resumed');
      assert.deepEqual(errors, []);
    });

    await escape('escape room: the air vent comes from the Openverse API, is asked for once, kept, and credited on the pause card', async () => {
      await waitFor("!!localStorage.getItem('escape-room-vent')", 30000, 'the choice from the API is kept');
      const kept = JSON.parse(await evaluate("localStorage.getItem('escape-room-vent')"));
      assert.equal(kept.url, VENT_ANSWER.results[1].url, 'the CC0 recording, not the CC BY one');
      let card = '';
      for (let i = 0; i < 30 && !/Openverse/.test(card); i++){
        await key('keydown', 'KeyP'); await waitFor("!document.getElementById('overlay').hidden", 5000, 'pause card');
        card = await text('#card'); await key('keydown', 'KeyP'); await waitFor("document.getElementById('overlay').hidden", 5000, 'resumed');
        if (!/Openverse/.test(card)) await sleep(1000);
      }
      assert.match(card, /Air vent: “Ventilation hum \(test\)” by stand-in \(Freesound, CC0\), found through the Openverse API/);
      assert.equal(ventCalls.api, 1, 'one search of the API');
      assert.ok(ventCalls.file >= 1, 'the recording is played from Freesound');
      assert.deepEqual(errors, []);
    });

    // ### From here on the tests move between the parts of the room with the touch-screen "Walk to" buttons (hidden on a
    // ### computer, but still in the page), so they do not have to steer a walk with the arrow keys every time.
    await escape('escape room rejected: the vehicle key cannot be taken while the tile is on, and the sinks have nothing to take', async () => {
      await hs('go:stall');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"take:carkey\"]')"), false);
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"play:tile\"]')"), true);
      // the tile opens its mini game; the first time a card explains it (closing it unread shows it again next time)
      await hs('play:tile');
      await waitFor("!!document.querySelector('#card [data-do=\"mini-start\"]')", 5000, 'the card that explains battleship');
      assert.match(await text('#card'), /Sink all three/);
      assert.match(await text('#card'), /Controls/);
      assert.match(await text('#card'), /vehicle key/);
      await key('keydown', 'Escape');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'Esc closes the card');
      await hs('play:tile');
      await startMini();
      // giving the game up (Esc) gives nothing
      await waitFor("!!document.querySelector('#card .mg[data-game=\"battleship\"] .bs-grid.theirs button')", 5000, 'battleship');
      assert.match(await text('#card'), /vehicle key/);
      assert.equal(await text('#card .mg-secs'), '30');
      await key('keydown', 'Escape');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'Esc closes the mini game');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"take:carkey\"]')"), false, 'rejected: no vehicle key without winning');
      await hs('go:sinks');
      assert.equal(await evaluate("[...document.querySelectorAll('[data-hotspot^=\"take:\"]')].length"), 0);
      assert.equal(await evaluate("document.querySelectorAll('.slot.full').length"), 0);
      assert.equal(await text('#place'), 'The Sinks');
    });

    await escape('escape room: progress is saved and offered after a reload', async () => {
      await hs('go:door');
      await hs('take:mop');
      await send('Page.navigate', { url: base + 'room-1-escape/' });
      await waitFor("!!document.querySelector('[data-do=\"resume\"]')", LOAD_MS, 'continue card');
      assert.match(await text('#card'), /Mop/);
      await click('[data-do="resume"]');
      assert.equal(await text('#place'), 'The Door');
      assert.equal(await evaluate("document.querySelectorAll('.slot.full').length"), 1);
      assert.equal(ventCalls.api, 1, 'after the reload the kept air vent is used: the API is not asked again');
    });

    await escape('escape room rejected: real keys on a lock wheel never try the code', async () => {
      await hs('go:stall'); await hs('go:hatch'); await hs('lock');
      await waitFor("!!document.getElementById('lockUi')", 5000, 'lock card');
      const realKey = async (code, key, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: vk, text: type === 'keyDown' && code === 'Enter' ? '\r' : undefined }); };
      await realKey('Tab', 'Tab', 9);
      await evaluate("document.querySelector('[data-turn=\"3,1\"]').focus(), true");
      const wheel = await evaluate("document.activeElement.dataset.turn || ''");
      assert.equal(wheel, '3,1', 'the wheel has the focus');
      const before = await evaluate("[...document.querySelectorAll('#lockUi output')].map(o => o.textContent).join('')");
      const clock = await seconds();
      await realKey('Enter', 'Enter', 13); await realKey('Enter', 'Enter', 13);
      assert.equal(await evaluate("document.activeElement.dataset.turn || ''"), wheel, 'the wheel keeps the focus');
      assert.notEqual(await evaluate("[...document.querySelectorAll('#lockUi output')].map(o => o.textContent).join('')"), before, 'the wheel turned');
      assert.ok(clock - await seconds() < 10, 'no 30 s penalty');
      assert.match(await text('#tries'), /Each wrong code/);
      for (let i = 0; i < 2; i++) await click('[data-turn="3,-1"]');
      await click('[data-do="close"]');
      await hs('go:stall');
      await hs('go:sinks');
    });

    await escape('escape room: the mirror plays only when steamed up, and a won mini game gives its digits', async () => {
      assert.equal(await text('#place'), 'The Sinks');
      await hs('play:mirror');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'rejected: no mini game at the dry mirror');
      await hs('tap'); await hs('play:mirror');
      await startMini();
      await waitFor("!!document.querySelector('#card .mg[data-game=\"spotdiff\"] canvas')", 5000, 'spot the difference');
      await click('[data-do="close"]');
      // started once, the game now opens at once
      await hs('play:mirror');
      await waitFor("!!document.querySelector('#card .mg[data-game=\"spotdiff\"] canvas')", 5000, 'spot the difference again');
      assert.equal(await evaluate("!!document.querySelector('#card [data-do=\"mini-start\"]')"), false, 'no rules card the second time');
      await click('[data-do="close"]');
      await hs('go:door'); await hs('play:scratches');
      await startMini();
      await waitFor("!!document.querySelector('#card .mg[data-game=\"tictactoe\"] .ttt-cell')", 5000, 'tic-tac-toe');
      for (const c of [0, 1, 2]){
        await waitFor(`!document.querySelector('.ttt-cell[data-cell="${c}"]').disabled`, 5000, 'the player’s turn');
        await click(`.ttt-cell[data-cell="${c}"]`);
      }
      await waitFor("/Clue found/.test((document.querySelector('#card .eyebrow') || {}).textContent || '')", 10000, 'the clue card');
      assert.match(await text('#card .paper'), /_ _ 1 2/);
      await click('[data-do="close"]');
      assert.equal(await text('#clueCount'), '1 / 3');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"play:scratches\"]')"), false, 'rejected: a won spot cannot be played again');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"read:scratches\"]')"), true, 'but its clue can be read again');
      assert.deepEqual(errors, []);
    });

    await escape('escape room: a wrong code costs 30 s, the right one (1912) is Ending A', async () => {
      await hs('go:stall');
      await hs('go:hatch');
      await hs('lock');
      await waitFor("!!document.getElementById('lockUi')", 5000, 'lock card');
      const before = await seconds();
      await click('[data-do="try"]');
      const after = await seconds();
      assert.ok(before - after >= 30 && before - after <= 32, `wrong code cost ${before - after} s`);
      for (const [w, n, d] of [[0, 1, 1], [1, 1, -1], [2, 1, 1], [3, 2, 1]]) for (let k = 0; k < n; k++) await click(`[data-turn="${w},${d}"]`);
      assert.equal(await evaluate("[...document.querySelectorAll('#lockUi output')].map(o => o.textContent).join('')"), '1912');
      await click('[data-do="try"]');
      // on the ladder Hale's note asks for the key. No: back up into the washroom, the hatch shut and the clock running again
      await waitFor("!!document.querySelector('[data-do=\"key-no\"]')", 120000, 'the note on the ladder asks for the key');
      assert.match(await text('#card'), /Do you have the key?/);
      const stopped = await seconds();
      await click('[data-do="key-no"]');
      await waitFor("/Back up for the key/.test(document.getElementById('say').textContent)", 120000, 'back up the ladder');
      await waitFor(`(() => { const t = document.getElementById('time').textContent.split(':'); return t[0] * 60 + +t[1] < ${stopped}; })()`, 20000, 'the clock runs again');
      // the lock kept its code: one try opens the hatch again, and this time the answer is yes
      await hs('lock');
      await waitFor("!!document.getElementById('lockUi')", 5000, 'lock card again');
      await click('[data-do="try"]');
      await waitFor("!!document.querySelector('[data-do=\"key-yes\"]')", 120000, 'the note asks again');
      await click('[data-do="key-yes"]');
      // down the ladder there is no card yet: you walk through the tunnel yourself and open the door at its far end
      await waitFor("/Walk through the tunnel to the door/.test(document.getElementById('say').textContent)", 120000, 'down the ladder, told to walk to the door');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'no ending card at the foot of the ladder');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"open:door\"]')"), false, 'rejected: the door cannot be opened from the foot of the ladder');
      await key('keydown', 'ArrowUp');
      await waitFor("!!document.querySelector('[data-hotspot=\"open:door\"]')", 120000, 'walking up to the door');
      await key('keyup', 'ArrowUp');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'still no card while the door is shut');
      await hs('open:door');
      // Ending A has no card: the headlights fill the screen and room 2 opens by itself, in the garage, with the escape time
      await waitFor("location.pathname.endsWith('/room-2-chase/') && " + inGarage, 240000, 'room 2 opens in the garage after Ending A');
      assert.equal(await evaluate("location.search + location.hash"), '?heist=1#arrive');
      const handed = JSON.parse(await evaluate("localStorage.getItem('shard-heist-handover')"));
      assert.ok(handed.escape >= 30 && handed.escape <= 600, 'the escape time went along: ' + handed.escape);
      assert.match(await text('#toast'), /Out of the tunnel\. Escape time/);
      assert.deepEqual(errors, []);
      await evaluate("localStorage.removeItem('shard-heist-handover'), true");
      await evaluate("localStorage.removeItem('escape-room-save'), true");
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixedRandom });
    });
  } finally {
    try { ws.close(); } catch (e) {}
    chrome.kill();
    server.close();
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
});
