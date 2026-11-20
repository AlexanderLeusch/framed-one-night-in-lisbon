/* Framed: One Night in Lisbon. The heist page: one driver name for both rooms, and both rooms on one page.
   ### 1. The driver. The name the player gives here is the one on the leaderboards of room 2 and of the whole heist. It uses the
   ###    same online account as room 2 (room-2-chase/js/online.js: a name is enough, no email and no password) and the same
   ###    rules for names (Core.cleanName). When the online board can't be reached, the name becomes a driver of this device, as
   ###    in room 2. A player may also start without a name; room 2 then asks for one at the end.
   ### 2. The rooms. Room 1 is played in a frame. While it is played, room 2 is loaded in a second frame under it (in its waiting
   ###    mode, ?heist=wait: it builds its world and then stands still). When room 1 is left through the tunnel door (it tells
   ###    this page, see showEnding in its room.js), room 2 is shown at once and told to begin: no page is loaded at that moment,
   ###    so there is nothing to wait for. If room 2 is still loading by then, it is shown as it is, in the glare of the headlights,
   ###    and begins the moment it is ready: what has been loaded is never thrown away. Only a phone, which has too little
   ###    memory for both worlds at once, loads room 2 after room 1. Both frames share the window's time, so while room 2
   ###    builds its world, room 1 is told so ('busy', then 'calm' once room 2 has loaded): its opening scene, where Officer
   ###    Hale shuts the door, waits for that and then plays without a stutter.
   ### The two rooms stay separate pages that know nothing of each other's files: only this page holds both. */
(function (){
  'use strict';
  const Core = window.ShardCore, Online = window.ShardOnline;
  const $ = id => document.getElementById(id);
  const readStore = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const net = Online && typeof fetch === 'function' ? Online.createClient({ fetch: (u, o) => fetch(u, o), store: { get: readStore, set: writeStore } }) : null;
  const box = $('whoBox'), rooms = $('rooms');
  // a phone (a touch screen that is small, or very little memory) keeps one 3D world in memory at a time; everything else,
  // touch-screen laptops and tablets included, loads room 2 ahead
  const PHONE = (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600) || (navigator.deviceMemory && navigator.deviceMemory < 4);
  const AHEAD = !PHONE;
  const ROOM1 = '../room-1-escape/?heist=frame', ROOM2_WAIT = '../room-2-chase/?heist=wait#arrive', ROOM2 = '../room-2-chase/?heist=1#arrive';
  const state = { name: '', online: false, busy: false, msg: '', bad: false, started: false, ready: false, left: false };
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
    const msg = state.msg ? `<p class="heist-msg${state.bad ? ' bad' : ''}" role="status">${esc(state.msg)}</p>` : '';
    if (state.name){
      box.innerHTML = `<div class="acc on"><p>${state.online ? 'Online as' : 'Driving as'} <b>${esc(state.name)}</b> · ${state.online ? 'your times go on the online leaderboards of room 2 and of the heist.' : 'your times stay on this device.'}</p><button type="button" class="drv" data-do="other"${dis}>Not you?</button></div>
        ${msg}<div class="heist-go"><button type="button" class="btn" data-do="start"${dis}>Start the heist <small>Enter</small></button></div>`;
    } else {
      box.innerHTML = `<div class="acc"><p>Type a driver name and you are on the online leaderboard. No email, no password. The name counts in both rooms.</p>
        <span class="drv-new"><input type="text" class="drv-input" id="whoName" maxlength="${Core.NAME_MAX}" placeholder="Your driver name" aria-label="Your driver name" autocomplete="nickname" spellcheck="false"><button type="button" class="drv-add" data-do="name"${dis}>Start the heist</button></span>${msg}</div>
        <div class="heist-go"><button type="button" class="drv" data-do="start"${dis}>Play without a name</button></div>`;
    }
    const first = box.querySelector(state.name ? '.btn' : '#whoName');
    if (first && !state.busy) first.focus({ preventScroll: true });
  }
  // ### What is known when the page opens: an online account from an earlier visit (its name is asked for), or the driver of
  // ### this device.
  async function init(){
    if (!Core || !rooms){ box.textContent = 'The heist could not be loaded. Play the rooms from the start page.'; return; }
    if (net && net.user){
      const r = await net.driverName();
      if (r.ok && r.name){ state.name = r.name; state.online = true; setLocalDriver(r.name); draw(); return; }
    }
    state.name = localDriver();
    draw();
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
  // ### Starts the heist: room 1 fills the window. Once it has loaded, and where there is memory for both, room 2 is loaded
  // ### under it; the briefing of room 1 is read meanwhile.
  function start(){
    if (state.started) return;
    state.started = true;
    // a new heist: what an earlier one handed over no longer counts
    writeStore(Core.HEIST.key, '');
    if (!AHEAD){ location.assign('../room-1-escape/'); return; }
    $('who').hidden = true; rooms.hidden = false; document.body.classList.add('playing');
    frame1 = makeFrame(ROOM1, 'Room 1 · Plot Twist: Cell Block D', false);
    frame1.addEventListener('load', () => {
      try { frame1.contentWindow.focus(); } catch (e) {}
      // (room 2 goes under room 1: the frame that comes first on the page lies below)
      setTimeout(() => {
        if (state.left || frame2 || !frame1) return;
        tellRoomOne('busy');
        frame2 = makeFrame(ROOM2_WAIT, 'Room 2 · The chase', true); rooms.insertBefore(frame2, frame1);
        // loaded (or failed to): room 1 may play its scenes again
        frame2.addEventListener('load', () => tellRoomOne('calm'), { once: true });
      }, 2500);
    }, { once: true });
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
    if (frame2 && e.source === frame2.contentWindow && e.data.shardHeist === 'ready'){
      state.ready = true; rooms.dataset.ready = '1';
      // the player is already waiting in the glare: begin at once
      if (state.left) frame2.contentWindow.postMessage({ shardHeist: 'go' }, location.origin);
    }
    else if (frame1 && e.source === frame1.contentWindow && e.data.shardHeist === 'leave') toRoomTwo();
  });

  box.addEventListener('click', e => {
    const b = e.target.closest('[data-do]');
    if (!b || state.busy) return;
    if (b.dataset.do === 'start') start();
    else if (b.dataset.do === 'name') takeName();
    else if (b.dataset.do === 'other') other();
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'whoName' && !state.busy){ e.preventDefault(); takeName(); } });
  init();
})();
