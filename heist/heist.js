/* Framed: One Night in Lisbon. The heist page: one driver name for both rooms, and both rooms on one page.
   ### 1. The driver. The name the player gives here is the one on the leaderboards of room 2 and of the whole heist. It uses the
   ###    same online account as room 2 (room-2-chase/js/online.js: a name is enough, no email and no password) and the same
   ###    rules for names (Core.cleanName). When the online board can't be reached, the name becomes a driver of this device, as
   ###    in room 2. A player may also start without a name; room 2 then asks for one at the end.
   ### 0. Loading. The whole game is loaded behind this page, both rooms in their frames, out of sight, and a bar says how far
   ###    it is. With a driver known from an earlier visit it begins when the page opens; otherwise when the name is given
   ###    (room 2 reads the driver as it loads). "Let's start" before the bar is full waits for it and then starts by itself;
   ###    "Start now" does not wait: the rest then loads while the briefing of room 1 is read, as it did before.
   ### 2. The rooms. Room 1 is played in a frame. While it is played, room 2 is loaded in a second frame under it (in its waiting
   ###    mode, ?heist=wait: it builds its world and then stands still). When room 1 is left through the tunnel door (it tells
   ###    this page, see showEnding in its room.js), room 2 is shown at once and told to begin: no page is loaded at that moment,
   ###    so there is nothing to wait for. If room 2 is still loading by then, it is shown as it is, in the glare of the headlights,
   ###    and begins the moment it is ready: what has been loaded is never thrown away. Only a phone, which has too little
   ###    memory for both worlds at once, loads room 2 after room 1. Both frames share the window's time, so while room 2
   ###    builds its world, room 1 is told so ('busy', then 'calm' once room 2 is ready): its opening scene, where Officer
   ###    Hale shuts the door, waits for that and then plays without a stutter.
   ### 3. The leaderboard. The heist board is shown beside the name, before anything is played: the heists of this device at
   ###    once, then everybody's best heist from the online board when it answers. The player's own row is marked.
   ### The two rooms stay separate pages that know nothing of each other's files: only this page holds both. */
(function (){
  'use strict';
  const Core = window.ShardCore, Online = window.ShardOnline;
  const $ = id => document.getElementById(id);
  const readStore = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const net = Online && typeof fetch === 'function' ? Online.createClient({ fetch: (u, o) => fetch(u, o), store: { get: readStore, set: writeStore } }) : null;
  const box = $('whoBox'), rooms = $('rooms'), boardBox = $('boardBox');
  // the heist board as shown: the heists of this device, replaced by the online board once it has answered
  const board = { rows: [], online: false };
  // a phone (a touch screen that is small, or very little memory) keeps one 3D world in memory at a time; everything else,
  // touch-screen laptops and tablets included, loads room 2 ahead
  const PHONE = (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600) || (navigator.deviceMemory && navigator.deviceMemory < 4);
  const AHEAD = !PHONE;
  const ROOM1 = '../room-1-escape/?heist=frame', ROOM2_WAIT = '../room-2-chase/?heist=wait#arrive', ROOM2 = '../room-2-chase/?heist=1#arrive';
  const state = { name: '', online: false, busy: false, msg: '', bad: false, started: false, ready: false, left: false,
    loading: false, want: false, done: false, pct: 0 };
  const loadBox = $('load'), loadBar = $('loadBar'), loadText = $('loadText');
  let frame1 = null, frame2 = null;

  // ---------- The driver ----------
  // ### The driver of this device as room 2 keeps it: the name in 'shard-heist-driver', if the saved board knows it.
  function localDriver(){
    const board = Core.parseBoard(readStore('shard-heist-board')), name = Core.cleanName(readStore('shard-heist-driver') || '');
    return board.drivers.find(d => Core.sameName(d, name)) || '';
  }
  // ### Makes a name the driver of this device (room 2 reads it from the same two places).
  function setLocalDriver(raw){
    const r = Core.addDriver(Core.parseBoard(readStore('shard-heist-board')), raw);
    if (!r.name) return '';
    writeStore('shard-heist-board', JSON.stringify(r.board)); writeStore('shard-heist-driver', r.name);
    return r.name;
  }
  // ### Draws the box: who is driving and the button that starts the heist, or the field for a name.
  function draw(){
    const dis = state.busy ? ' disabled' : '';
    // "Let's start" was pressed while the game is still loading: it starts by itself when the bar is full
    if (state.want && !state.started){
      const who = state.name ? 'Driving as <b>' + esc(state.name) + '</b> · the' : 'The';
      box.innerHTML = '<div class="acc on"><p>' + who + ' game starts by itself as soon as it has loaded.</p><button type="button" class="drv" data-do="now">Start now</button></div>';
      drawBoard();
      return;
    }
    const msg = state.msg ? `<p class="heist-msg${state.bad ? ' bad' : ''}" role="status">${esc(state.msg)}</p>` : '';
    if (state.name){
      box.innerHTML = `<div class="acc on"><p>${state.online ? 'Online as' : 'Driving as'} <b>${esc(state.name)}</b> · ${state.online ? 'your times go on the online leaderboards of room 2 and of the whole night.' : 'your times stay on this device.'}</p><button type="button" class="drv" data-do="other"${dis}>Not you?</button></div>
        ${msg}<div class="heist-go"><button type="button" class="btn" data-do="start"${dis}>Let's start <small>Enter</small></button></div>`;
    } else {
      box.innerHTML = `<div class="acc"><p>Type a driver name and you are on the online leaderboard. No email, no password. The name counts in both rooms.</p>
        <span class="drv-new"><input type="text" class="drv-input" id="whoName" maxlength="${Core.NAME_MAX}" placeholder="Your driver name" aria-label="Your driver name" autocomplete="nickname" spellcheck="false"><button type="button" class="drv-add" data-do="name"${dis}>Let's start</button></span>${msg}</div>
        <div class="heist-go"><button type="button" class="drv" data-do="start"${dis}>Play without a name</button></div>`;
    }
    const first = box.querySelector(state.name ? '.btn' : '#whoName');
    if (first && !state.busy) first.focus({ preventScroll: true });
    drawBoard();
  }
  // ### Draws the heist leaderboard: the top five, and the driver's own row when it is further down (Core.heistRows, as on
  // ### the end screen of room 2). Every name is escaped; times and vehicle names come from the rules.
  function drawBoard(){
    if (!boardBox) return;
    const rows = Core.heistRows(board.rows, state.name), lead = rows.length ? rows[0].time : 0;
    const line = r => '<li class="' + (r.me ? 'me' : '') + (r.gap ? ' gap' : '') + (r.place <= 3 ? ' p' + r.place : '') + '"><span class="lb-place">' + r.place + '</span>'
      + '<span class="lb-who"><span class="lb-name">' + esc(r.name) + '</span><span class="lb-meta">Escape ' + Core.fmtTimeExact(r.escape) + ' · Drive ' + Core.fmtTimeExact(r.drive) + ' · ' + esc(Core.VEH[r.veh].name) + '</span></span>'
      + '<span class="lb-time"><b>' + Core.fmtTimeExact(r.time) + '</b>' + (r.place > 1 ? '<small>+' + (r.time - lead).toFixed(1) + ' s</small>' : '') + '</span></li>';
    const where = '<p class="lb-where' + (board.online ? ' on' : '') + '">' + (board.online ? 'Online · everybody\'s best night' : 'This device only') + '</p>';
    const list = rows.length ? '<ol class="lb-list">' + rows.map(line).join('') + '</ol>' : '<p class="heist-wait">No time yet. Yours can be the first.</p>';
    boardBox.innerHTML = where + list;
  }
  // ### Loads the board: what this device has kept comes first, the online board takes its place when it can be reached.
  async function loadBoard(){
    board.rows = Core.parseHeistBoard(readStore(Core.HEIST.store) || '');
    drawBoard();
    if (!net) return;
    const r = await net.heistBoard();
    if (r.ok){ board.rows = r.rows; board.online = true; drawBoard(); }
  }
  // ### What is known when the page opens: an online account from an earlier visit (its name is asked for), or the driver of
  // ### this device.
  async function init(){
    if (!Core || !rooms){ box.textContent = 'The game could not be loaded. Please load the page again.'; return; }
    loadBoard();
    if (net && net.user){
      const r = await net.driverName();
      if (r.ok && r.name){ state.name = r.name; state.online = true; setLocalDriver(r.name); draw(); load(); return; }
    }
    state.name = localDriver();
    draw();
    // a driver from an earlier visit: the game loads while the leaderboard is looked at
    if (state.name) load();
  }
  // ### The name from the field: checked by the same rules as in room 2, then put on the online board (an account for this
  // ### browser is made, with no email); a taken name is refused; with no connection it becomes a driver of this device.
  async function takeName(){
    const input = $('whoName'), name = Core.cleanName(input ? input.value : '');
    if (!name){ state.msg = 'Enter a driver name: letters, digits, spaces and . _ \' - are kept.'; state.bad = true; draw(); return; }
    if (!net){ state.name = setLocalDriver(name); start(); return; }
    state.busy = true; state.msg = 'Checking the name…'; state.bad = false; draw();
    const r = await net.playAs(name);
    state.busy = false;
    if (r.ok){ state.name = r.name; state.online = true; setLocalDriver(r.name); start(); return; }
    if (r.status === 0){ state.name = setLocalDriver(name); state.online = false; start(); return; }
    state.msg = r.error; state.bad = true; draw();
    const again = $('whoName'); if (again){ again.value = name; again.select(); }
  }
  // ### "Not you?": signs the online driver of this browser out and asks for a name again.
  async function other(){
    state.busy = true; draw();
    if (net && net.user) await net.signOut();
    writeStore('shard-heist-driver', '');
    // room 2 has read the driver as it loaded: with another driver the page, and with it the game, is loaded again
    if (state.loading){ location.reload(); return; }
    Object.assign(state, { name: '', online: false, busy: false, msg: '', bad: false });
    draw();
  }

  // ---------- The rooms ----------
  const makeFrame = (src, title, under) => {
    const f = document.createElement('iframe');
    f.src = src; f.title = title; f.allow = 'accelerometer; gyroscope; fullscreen';
    if (under) f.className = 'under';
    rooms.appendChild(f);
    return f;
  };
  // ### How far the loading is, on the bar: room 1 opened (5), loaded (25) and made ready (45), room 2 loaded (55) and made
  // ### ready step by step (up to 100).
  function progress(pct, text){
    state.pct = Math.max(state.pct, Math.min(100, Math.round(pct)));
    loadBar.value = state.pct;
    loadText.textContent = text || (state.done ? 'The game has loaded' : 'Loading the game… ' + state.pct + ' %');
    loadBox.classList.toggle('done', state.done);
  }
  // ### Loads the game behind this page: room 1 in its frame, then room 2 under it, both out of sight until the heist starts.
  // ### (A phone loads one room at a time, as a page of its own: nothing is loaded here.)
  function load(){
    if (!AHEAD || state.loading) return;
    state.loading = true;
    loadBox.hidden = false; rooms.hidden = false; rooms.classList.add('behind');
    progress(5);
    frame1 = makeFrame(ROOM1, 'Room 1 · Plot Twist: Cell Block D', false);
    frame1.addEventListener('load', () => {
      progress(25);
      // (room 2 goes under room 1: the frame that comes first on the page lies below)
      setTimeout(() => {
        if (state.left || frame2 || !frame1) return;
        tellRoomOne('busy');
        frame2 = makeFrame(ROOM2_WAIT, 'Room 2 · The chase', true); rooms.insertBefore(frame2, frame1);
        // room 2 says when it is ready (everything loaded, the whole world drawn once): room 1 may play its scenes then.
        // Should it never say so (it failed to load), room 1 is told a while after the page has loaded
        frame2.addEventListener('load', () => { progress(55); setTimeout(() => tellRoomOne('calm'), 30000); }, { once: true });
      }, 300);
    }, { once: true });
    // whatever happens to the loading, the heist can start: after a minute and a half the bar no longer holds it back
    setTimeout(loaded, 90000);
  }
  // ### All of the game has loaded: the heist starts if "Let's start" was pressed, otherwise the bar says so.
  function loaded(){
    if (state.done) return;
    state.done = true; progress(100);
    if (state.want) reveal();
  }
  // ### "Let's start": the heist begins when the game has loaded; until then the box says so and offers "Start now".
  function start(){
    if (state.started) return;
    if (!AHEAD){ state.started = true; writeStore(Core.HEIST.key, ''); location.assign('../room-1-escape/'); return; }
    state.want = true;
    load();
    if (state.done) reveal(); else draw();
  }
  // ### Room 1 fills the window: the heist begins.
  function reveal(){
    if (state.started) return;
    state.started = true;
    // a new heist: what an earlier one handed over no longer counts
    writeStore(Core.HEIST.key, '');
    $('who').hidden = true; rooms.classList.remove('behind'); document.body.classList.add('playing');
    try { frame1.contentWindow.focus(); } catch (e) {}
  }
  const tellRoomOne = what => { if (frame1) frame1.contentWindow.postMessage({ shardHeist: what }, location.origin); };
  // ### Room 1 was left through the tunnel door: room 2 comes up. Ready and waiting, it is shown and told to begin; otherwise
  // ### it is opened now and loads behind the glare.
  function toRoomTwo(){
    if (state.left) return;
    state.left = true;
    rooms.dataset.left = frame2 && state.ready ? 'ahead' : 'late';
    if (frame2){
      // loaded ahead: shown as it is. Ready, it begins now; still loading, it begins when it says it is ready (see below)
      frame2.classList.remove('under');
      if (state.ready) frame2.contentWindow.postMessage({ shardHeist: 'go' }, location.origin);
    } else {
      // room 1 was left before room 2 had even been started (it starts 2.5 s after room 1 has loaded)
      frame2 = makeFrame(ROOM2, 'Room 2 · The chase', false);
      rooms.insertBefore(frame2, frame1);
    }
    try { frame2.contentWindow.focus(); } catch (e) {}
    // room 1 goes once room 2 has been drawn under it (its last picture, the glare, is what room 2 opens in)
    setTimeout(() => { if (frame1){ frame1.remove(); frame1 = null; } try { frame2.contentWindow.focus(); } catch (e) {} }, 400);
  }
  // only messages from our own two frames, on our own address, count
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || typeof e.data.shardHeist !== 'string') return;
    if (frame2 && e.source === frame2.contentWindow && e.data.shardHeist === 'steps' && !state.ready) progress(55 + 43 * Math.max(0, Math.min(1, Number(e.data.part) || 0)));
    else if (frame1 && e.source === frame1.contentWindow && e.data.shardHeist === 'warm') progress(45);
    else if (frame2 && e.source === frame2.contentWindow && e.data.shardHeist === 'ready'){
      state.ready = true; rooms.dataset.ready = '1'; tellRoomOne('calm'); loaded();
      // the player is already waiting in the glare: begin at once
      if (state.left) frame2.contentWindow.postMessage({ shardHeist: 'go' }, location.origin);
    }
    else if (frame1 && e.source === frame1.contentWindow && e.data.shardHeist === 'leave') toRoomTwo();
  });

  box.addEventListener('click', e => {
    const b = e.target.closest('[data-do]');
    if (!b || state.busy) return;
    if (b.dataset.do === 'start') start();
    else if (b.dataset.do === 'now') reveal();
    else if (b.dataset.do === 'name') takeName();
    else if (b.dataset.do === 'other') other();
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'whoName' && !state.busy){ e.preventDefault(); takeName(); } });
  init();
})();
