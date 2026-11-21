// Room 1: the 3D prison washroom (rendering, camera, hotspots, sound, cards). The rules it plays by live in src/rules.js.
(() => {
'use strict';
if (typeof THREE === 'undefined' || typeof EscapeRules === 'undefined' || typeof MiniGames === 'undefined'){
  if (window.ShardFatal) ShardFatal('The game could not load', 'The 3D engine did not arrive. Check your internet connection or turn off content blockers for this page, then reload.');
  return;
}
const R = EscapeRules;
// Every hex colour in this file is written in sRGB; convert to linear for the filmic pipeline
(() => { const setHex = THREE.Color.prototype.setHex; THREE.Color.prototype.setHex = function(hex){ setHex.call(this, hex); return this.convertSRGBToLinear(); }; })();

// ---------- State and saving ----------
// ### S is the whole game state from rules.js. It only ever changes through act() (player actions) and the clock in
// ### frame(). It is saved to localStorage after every accepted action and every few seconds while the clock runs.
const $ = id => document.getElementById(id);
const readStore = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let S = R.newState(), paused = false, saveTimer = 0;
// nothing has happened yet on the briefing, and it must not replace a real save
const save = () => { if (S.scene !== 'intro') writeStore(R.SAVE_KEY, JSON.stringify(S)); };
const saved = R.restore(readStore(R.SAVE_KEY));
const COARSE = matchMedia('(pointer: coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- Renderer, scene, camera ----------
// ### One renderer with soft shadows and filmic tone mapping. The room is lit like a real night-time washroom: one caged
// ### fluorescent tube that now and then flickers (see "The mood of the lights"), a weaker lamp over the stall, and cold
// ### corridor light through the door window.
const canvas = $('room');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e){ ShardFatal('3D graphics are not available', 'This game needs WebGL. Turn on hardware acceleration in your browser settings, update your graphics driver or try another browser.'); return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // then set by adaptResolution() to suit the frame rate
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // filtered with each light's shadow.radius: as soft, and cheaper per pixel
// ### Nothing in the room moves most of the time, so the shadow maps are only redrawn for the frames in which something
// ### does (the mop, the tile, the hatch lid, the door and Hale in the briefing). shadowsMoved() asks for that.
renderer.shadowMap.autoUpdate = false;
let shadowFrames = 2;
const shadowsMoved = () => { shadowFrames = 2; };
// ### Loading up front. Every picture and model of the room is loaded as the page opens, through one loading manager
// ### (ASSETS), so the room knows when all of it has arrived: the briefing scene, where Officer Hale shuts the door, only
// ### starts once it has (see warmOpening() under "Briefing scene"), and never has to load or build anything while it plays.
const ASSETS = new THREE.LoadingManager();
let assetsBusy = false;
ASSETS.onStart = () => { assetsBusy = true; };
ASSETS.onLoad = () => { assetsBusy = false; };
// ### Counts a model (fetched and built in work, a promise) as part of ASSETS; if it fails, its stand-in stays.
function loading(name, work){
  ASSETS.itemStart(name);
  work.catch(() => {}).then(() => ASSETS.itemEnd(name));
}
const glbBytes = r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); };
// sharp textures at grazing angles, but no more than 8 samples: beyond that the cost rises and the picture barely changes
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050607);
scene.fog = new THREE.FogExp2(0x0b0e0e, 0.03);
// the near plane sits 5 cm in front of the eye: you can never get closer to a wall, and the depth buffer stays precise
// enough that decals on the walls never shimmer
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.05, 40);
const room = new THREE.Group();
scene.add(room);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ShardFatal('The graphics were reset', 'The browser stopped the 3D view, usually after a driver reset or when memory runs low. Reload to continue.'); });

// ---------- Painted textures ----------
// ### Every surface is painted on a canvas at start-up: glazed tiles with grout and grime, flaking paint, stained concrete,
// ### diamond-plate steel, scratched graffiti and the steamed-up mirror. No image files are downloaded.
const TEX = COARSE ? 512 : 1024;
const rnd = mulberry32(4471);
// ### Paints a texture on a canvas, so the room needs no image files.
function canvasTex(w, h, draw, repeat){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// ### Adds dirt, scratches and stains to a wall texture.
function grime(g, w, h, n, color, maxR, lowBias){
  for (let i = 0; i < n; i++){
    const x = rnd() * w, y = lowBias ? h - Math.pow(rnd(), 2) * h : rnd() * h, r = (0.2 + rnd()) * maxR;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
// ### Tiles: 12 x 12 glazed tiles of 15 cm in the old institutional green, so one picture covers 1.8 m of wall (the whole
// ### height of the tiling). Over the years tiles broke and were replaced with whatever was in the store: cream, pale
// ### mint, a darker bottle green, a sandy one. Every wall paints its own picture, so the odd tiles sit somewhere else.
const TILE_ODD = [[.012, [200, 194, 164]], [.026, [140, 166, 136]], [.04, [54, 84, 62]], [.045, [176, 158, 120]]];
const tileTex = () => canvasTex(TEX, TEX, (g, w, h) => {
  const n = 12, b = w / n, gw = Math.max(2, w / 300);
  g.fillStyle = '#34423a'; g.fillRect(0, 0, w, h);   // the grout, dark with dirt
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    const odd = rnd(), l = (rnd() - .5) * 16, x = i * b + gw, y = j * b + gw, s = b - gw * 2;
    const c = (TILE_ODD.find(([p]) => odd < p) || [0, [88 + l, 120 + l, 94 + l * .8]])[1];
    g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(x, y, s, s);
    const gl = g.createLinearGradient(x, y, x + s, y + s);
    gl.addColorStop(0, 'rgba(255,255,255,.12)'); gl.addColorStop(.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.1)');
    g.fillStyle = gl; g.fillRect(x, y, s, s);
    // crazing in the glaze and the odd crack right across a tile
    if (rnd() < .12){ g.strokeStyle = 'rgba(30,40,32,.5)'; g.lineWidth = 1.2; g.beginPath(); let cx = x + rnd() * s, cy = y; g.moveTo(cx, cy); for (let k = 0; k < 5; k++){ cx += (rnd() - .5) * s * .4; cy += s / 5; g.lineTo(cx, cy); } g.stroke(); }
    if (rnd() < .05){ g.fillStyle = 'rgba(40,36,28,.45)'; g.beginPath(); g.arc(x + (rnd() < .5 ? 0 : s), y + rnd() * s, 2 + rnd() * s * .12, 0, 7); g.fill(); }   // a chipped corner
  }
  grime(g, w, h, 30, 'rgba(70,58,30,.18)', w * .08, true);
  grime(g, w, h, 20, 'rgba(30,40,30,.14)', w * .05, false);
}, [1, 1]);
const concreteTex = canvasTex(TEX, TEX, (g, w, h) => {
  g.fillStyle = '#5a5d5b'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16000; i++){ const v = rnd(); g.fillStyle = v > .5 ? `rgba(255,255,255,${(v - .5) * .12})` : `rgba(0,0,0,${v * .2})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  grime(g, w, h, 40, 'rgba(40,34,24,.2)', w * .14, false);
  g.strokeStyle = 'rgba(30,30,30,.35)'; g.lineWidth = 2;
  for (let i = 1; i < 2; i++){ g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke(); g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke(); }
}, [4, 3]);
const plateTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6f777b'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) for (let x = (y / 32 % 2) * 16; x < w; x += 32){
    g.save(); g.translate(x + 8, y + 8); g.rotate(Math.PI / 4 * ((x + y) / 32 % 2 ? 1 : -1));
    g.fillStyle = '#9aa2a6'; g.fillRect(-9, -2.5, 18, 5); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-9, 2.5, 18, 1.5); g.restore();
  }
  grime(g, w, h, 8, 'rgba(60,40,20,.25)', 60, false);
}, [2, 2]);
// ### A single-stroke alphabet for writing by hand (scratched with a key, traced with a finger): each letter is a few
// ### strokes in a box one unit high (y down, 0 at the top), as [width, stroke, stroke, ...], a stroke being a list of
// ### points. Only the letters the room writes are here.
const HAND_FONT = (() => {
  const arc = (cx, cy, rx, ry, a0, a1) => { const p = [], n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 18)); for (let i = 0; i <= n; i++){ const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return p; };
  return {
    A: [.6, [[0, 1], [.3, 0], [.6, 1]], [[.12, .62], [.48, .62]]],
    B: [.55, [[0, 1], [0, 0]], [[0, 0], [.32, 0], ...arc(.32, .25, .2, .25, -90, 90), [0, .5]], [[0, .5], [.34, .5], ...arc(.34, .75, .21, .25, -90, 90), [0, 1]]],
    C: [.55, arc(.32, .5, .3, .5, -40, -320)],
    D: [.58, [[0, 0], [0, 1]], [[0, 0], [.22, 0], ...arc(.22, .5, .34, .5, -90, 90), [0, 1]]],
    E: [.5, [[.5, 0], [0, 0], [0, 1], [.5, 1]], [[0, .5], [.4, .5]]],
    F: [.5, [[.5, 0], [0, 0], [0, 1]], [[0, .5], [.4, .5]]],
    H: [.55, [[0, 0], [0, 1]], [[.55, 0], [.55, 1]], [[0, .5], [.55, .5]]],
    I: [.12, [[.06, 0], [.06, 1]]],
    J: [.45, [[.42, 0], [.42, .74], ...arc(.22, .74, .2, .26, 0, 180)]],
    K: [.52, [[0, 0], [0, 1]], [[.5, 0], [0, .62]], [[.16, .46], [.52, 1]]],
    L: [.45, [[0, 0], [0, 1], [.45, 1]]],
    N: [.56, [[0, 1], [0, 0], [.56, 1], [.56, 0]]],
    O: [.62, arc(.31, .5, .31, .5, -90, 270)],
    P: [.52, [[0, 1], [0, 0], [.3, 0], ...arc(.3, .26, .22, .26, -90, 90), [0, .52]]],
    R: [.55, [[0, 1], [0, 0], [.3, 0], ...arc(.3, .26, .22, .26, -90, 90), [0, .52]], [[.24, .52], [.55, 1]]],
    S: [.52, [...arc(.27, .25, .25, .25, -25, -270), ...arc(.27, .75, .26, .25, -90, 145)]],
    T: [.56, [[0, 0], [.56, 0]], [[.28, 0], [.28, 1]]],
    U: [.55, [[0, 0], [0, .68], ...arc(.275, .68, .275, .32, 180, 0), [.55, 0]]],
    W: [.78, [[0, 0], [.18, 1], [.39, .32], [.6, 1], [.78, 0]]],
    Y: [.56, [[0, 0], [.28, .5], [.56, 0]], [[.28, .5], [.28, 1]]],
    1: [.3, [[0, .2], [.2, 0], [.2, 1]]],
    9: [.5, [...arc(.25, .28, .24, .28, 0, 360), [.49, .3], [.44, .75], [.3, 1], [.05, .95]]],
    _: [.5, [[0, 1.02], [.5, 1.02]]],
    '.': [.1, [[.03, .95], [.06, 1]]],
    '?': [.5, [...arc(.25, .25, .24, .25, -170, 60), [.26, .5], [.26, .7]], [[.26, .92], [.27, .97]]]
  };
})();
// ### How wide handWrite writes text at a letter height of size pixels.
const handWidth = (text, size) => [...text].reduce((a, ch) => a + (ch === ' ' ? .45 : HAND_FONT[ch] ? HAND_FONT[ch][0] + .2 : 0), -.2) * size;
// ### Writes text by hand with HAND_FONT, the baseline starting at x, y and turned by rot: each letter a little off (moved,
// ### sized and slanted by rng), each point of it off by up to jitter of the letter height. stroke(points) draws one
// ### stroke in canvas pixels, so the same writing can be scratched, traced or pressed in.
function handWrite(text, x, y, size, rot, rng, jitter, stroke){
  const c = Math.cos(rot), s = Math.sin(rot);
  let cx = 0;
  for (const ch of text){
    if (ch === ' '){ cx += size * .45; continue; }
    const glyph = HAND_FONT[ch];
    if (!glyph) continue;
    const dx = (rng() - .5) * size * .05, dy = (rng() - .5) * size * .06, sc = 1 + (rng() - .5) * .1, tilt = (rng() - .5) * .08;
    for (let k = 1; k < glyph.length; k++){
      stroke(glyph[k].map(([gx, gy]) => {
        const lx = cx + dx + gx * size * sc + (1 - gy) * size * tilt + (rng() - .5) * jitter * size, ly = dy + (gy - 1) * size * sc + (rng() - .5) * jitter * size;
        return [x + lx * c - ly * s, y + lx * s + ly * c];
      }));
    }
    cx += (glyph[0] * sc + .2) * size;
  }
}
// ### Turns a height picture (grey, light is high) into a normal map. perMetre is the picture's pixels per metre and
// ### depthMm how far white stands above black, so the slopes come out the same at any resolution.
function normalFromHeight(src, perMetre, depthMm){
  const w = src.width, h = src.height, hd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const nc = c.getContext('2d'), out = nc.createImageData(w, h), o = out.data, k = depthMm / 1000 * perMetre / 2;
  const at = (x, y) => hd[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    o[i] = (-dx / l * .5 + .5) * 255; o[i + 1] = (dy / l * .5 + .5) * 255; o[i + 2] = (1 / l * .5 + .5) * 255; o[i + 3] = 255;
  }
  nc.putImageData(out, 0, 0);
  return c;
}
// ### Polylines on a canvas: each stroke offset by (ox, oy), with round ends.
function polylines(g, strokes, ox, oy){
  g.lineCap = g.lineJoin = 'round'; g.beginPath();
  for (const pts of strokes){ g.moveTo(pts[0][0] + ox, pts[0][1] + oy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + ox, pts[i][1] + oy); }
  g.stroke();
}
// ### Graffiti scratched into the stall's paint with a key or a screw, including the clue. Every letter is a few strokes,
// ### each gone over two or three times and never quite along the same line, slipping on at the end now and then. A
// ### fresh scratch is bare steel, bright at the bottom of the groove, with the paint pushed up into a pale burr along
// ### one side and a dark shadow along the other; old ones are filled with grime. The groove's depth is a normal map,
// ### its bare steel is shinier than the paint. The picture covers 1.05 x 0.66 m at about a millimetre a pixel.
const graffitiMaps = (() => {
  const grnd = mulberry32(1517), W2 = 1024, H2 = 640;
  for (let i = 0; i < 196; i++) rnd();   // the room's random numbers, as many as the old graffiti took, so the textures after it keep their look
  const fresh = [], old = [];
  const scratch = (list, wid) => pts => {
    const passes = 2 + (grnd() < .55 ? 1 : 0);
    for (let p = 0; p < passes; p++){
      const q = pts.map(([x, y]) => [x + (grnd() - .5) * 1.8, y + (grnd() - .5) * 1.8]);
      if (grnd() < .25){ const a = q[q.length - 2], b = q[q.length - 1], k = .1 + grnd() * .25; q.push([b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k]); }   // the key slips on
      list.push({ pts: q, w: wid * (.75 + grnd() * .5) });
    }
  };
  handWrite('SHE WAS UNSINKABLE', 70, 150, 56, -.03, grnd, .025, scratch(fresh, 2.1));
  handWrite('SHE SAILED ONLY ONCE', 90, 260, 52, .02, grnd, .025, scratch(fresh, 2.1));
  handWrite('THE YEAR OPENS THE FLOOR', 60, 370, 50, -.015, grnd, .025, scratch(fresh, 2.2));
  handWrite('IIII IIII IIII II', 640, 520, 36, 0, grnd, .03, scratch(old, 1.8));
  handWrite('J.R. WAS HERE', 80, 560, 30, .05, grnd, .03, scratch(old, 1.5));
  handWrite('NO WAY OUT?', 660, 80, 32, -.06, grnd, .03, scratch(fresh, 1.5));
  for (let i = 0; i < 40; i++){ const x = grnd() * W2, y = grnd() * H2; (grnd() < .5 ? old : fresh).push({ pts: [[x, y], [x + (grnd() - .5) * 120, y + (grnd() - .5) * 30]], w: .9 + grnd() * .6 }); }
  const layer = (g, list, style, grow, ox, oy) => { g.strokeStyle = style; for (const s of list){ g.lineWidth = s.w * grow; polylines(g, [s.pts], ox, oy); } };
  // the colour: shadow and burr round the grooves, then the grooves, bright steel for the fresh ones and grime for the old
  const map = canvasTex(W2, H2, g => {
    g.clearRect(0, 0, W2, H2);
    const all = fresh.concat(old);
    layer(g, all, 'rgba(18,20,18,.5)', 1.8, .9, 1.2);
    layer(g, all, 'rgba(214,222,214,.36)', .8, -.8, -.9);
    layer(g, old, 'rgba(70,74,68,.82)', 1, 0, 0);
    layer(g, fresh, 'rgba(176,184,182,.95)', 1, 0, 0);
    layer(g, fresh, 'rgba(238,242,240,.7)', .35, 0, 0);
  });
  // the depth: the grooves cut into the paint, the burr raised beside them
  const height = document.createElement('canvas'); height.width = W2; height.height = H2;
  { const g = height.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, W2, H2); layer(g, fresh.concat(old), '#b8b8b8', .8, -.9, -.9); layer(g, fresh, '#202020', 1, 0, 0); layer(g, old, '#505050', 1, 0, 0); }
  // roughness (g) and metalness (b): the bare steel is smooth metal, the paint and the grime are not
  const sheen = canvasTex(W2, H2, g => { g.fillStyle = 'rgb(0,215,0)'; g.fillRect(0, 0, W2, H2); layer(g, fresh, 'rgb(0,90,225)', 1, 0, 0); layer(g, old, 'rgb(0,190,40)', 1, 0, 0); });
  sheen.encoding = THREE.LinearEncoding;
  const normal = new THREE.CanvasTexture(normalFromHeight(height, W2 / 1.05, .5)); normal.anisotropy = ANISO;
  return { map, normal, sheen };
})();
// Scratches in the tiles beside the door: the date the "unsinkable" ship went down, the year gouged out. Once its mini game
// is won, the last two digits of the code show under it (paintScratches is called again with won = true).
const paintScratches = (g, w, h, won) => {
  g.clearRect(0, 0, w, h);
  const scratch = (text, x, y, size, rot, alpha) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`;
    // in the green glaze a scratch shows as a dark groove full of grime, with a bright chipped edge beside it
    for (let k = 0; k < 3; k++){ g.strokeStyle = `rgba(38,40,36,${alpha * (1 - k * .2)})`; g.lineWidth = 2.6; g.strokeText(text, (rnd() - .5) * 2.5, (rnd() - .5) * 2.5); }
    g.strokeStyle = `rgba(255,255,250,${alpha * .5})`; g.lineWidth = 1; g.strokeText(text, 1.5, 1.5);
    g.restore();
  };
  scratch('THE UNSINKABLE', 60, 130, 76, -.025, .85);
  scratch('WENT DOWN ON HER FIRST VOYAGE', 50, 230, 52, .015, .85);
  scratch('15 APRIL', 70, 360, 82, -.02, .9);
  // the year is scratched over until nothing can be read
  g.strokeStyle = 'rgba(38,40,36,.85)'; g.lineWidth = 3;
  for (let i = 0; i < 60; i++){ const x = 440 + rnd() * 200, y = 290 + rnd() * 70; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 60, y + (rnd() - .5) * 60); g.stroke(); }
  scratch('1500 LOST', 90, 470, 60, .03, .8);
  if (won) scratch('CODE  _ _ 1 2', 420, 580, 92, -.03, 1);
  scratch('IIII IIII', 700, 560, 40, 0, .45);
  g.strokeStyle = 'rgba(38,40,36,.3)'; g.lineWidth = 1.2;
  for (let i = 0; i < 30; i++){ const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 120, y + (rnd() - .5) * 30); g.stroke(); }
};
const scratchesTex = canvasTex(1024, 640, (g, w, h) => paintScratches(g, w, h, false));
// Steam on the mirror, with the letters someone traced into it left clear. Once the mirror's mini game is won, the first
// two digits of the code show in the steam too.
const paintSteam = (g, w, h, won) => {
  g.clearRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(225,232,232,.95)'); gr.addColorStop(1, 'rgba(225,232,232,.72)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++){ g.fillStyle = `rgba(255,255,255,${rnd() * .25})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, rnd() * 3, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'destination-out';
  // traced with a fingertip: a soft, half-wiped edge round a clear stroke
  const srnd = mulberry32(won ? 1913 : 1912), strokes = [];
  const line = (text, y, size) => handWrite(text, (w - handWidth(text, size)) / 2, y, size, -.015, srnd, .02, pts => strokes.push(pts));
  if (won){ line('UNSINKABLE?', h * .36, 70); line('1 9 _ _', h * .8, 108); }
  else line('UNSINKABLE?', h * .58, 96);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 18; polylines(g, strokes, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,1)'; g.lineWidth = 11; polylines(g, strokes, 0, 0);
  // the water gathers at the bottom of a stroke and runs down in a thin clear streak with a drop at its end
  g.fillStyle = g.strokeStyle = 'rgba(0,0,0,.85)';
  for (const pts of strokes){
    if (srnd() > .25) continue;
    const [x, y] = pts.reduce((a, p) => p[1] > a[1] ? p : a), len = 10 + srnd() * 45, wob = (srnd() - .5) * 5;
    g.lineWidth = 1.6 + srnd(); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + wob, y + len / 2, x + wob * .5, y + len); g.stroke();
    g.beginPath(); g.arc(x + wob * .5, y + len + 1.5, 2.2 + srnd(), 0, 7); g.fill();
  }
  for (let i = 0; i < 9; i++){   // and a few more down the lower part of the steam
    const x = 160 + rnd() * (w - 320), y = h * (.62 + (x % 37) / 400), len = 40 + rnd() * 90;
    g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y + len / 2, x - 1, y + len); g.stroke(); g.beginPath(); g.arc(x - 1, y + len + 1.5, 2.2, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
};
const steamTex = canvasTex(1024, 512, (g, w, h) => paintSteam(g, w, h, false));
// ### Paints a clue texture again (the mirror and the scratches show their digits once won).
const painted = new Map();
function repaint(tex, paint, won){
  if ((painted.get(tex) || false) === won) return;
  painted.set(tex, won);
  const c = tex.image; paint(c.getContext('2d'), c.width, c.height, won); tex.needsUpdate = true;
}
const signTex = canvasTex(1024, 384, (g, w, h) => {
  g.fillStyle = '#d9cfa8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d1f1e'; g.fillRect(0, 0, w, 70); g.fillRect(0, h - 26, w, 26);
  g.font = '800 46px "Arial Narrow", Arial, sans-serif'; g.fillStyle = '#d9cfa8'; g.fillText('CELL BLOCK D · WASHROOM 2', 30, 52);
  g.fillStyle = '#1d1f1e'; g.font = '800 64px "Arial Narrow", Arial, sans-serif'; g.fillText('10 MINUTES MAXIMUM', 30, 160);
  g.font = '600 40px "Arial Narrow", Arial, sans-serif'; g.fillText('ONE INMATE AT A TIME · NO TALKING', 30, 230);
  g.fillText('REPORT DAMAGE TO THE DUTY OFFICER', 30, 290);
  grime(g, w, h, 12, 'rgba(90,70,40,.25)', 120, false);
});
const corridorTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#cfe7ff'); gr.addColorStop(1, '#5d7da6');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// ### Officer Hale's outline, for the two places where only his shadow shows: his dark figure behind the window of the door
// ### and the shadow he throws into the room while he holds the door open. It follows the 3D figure (buildHale) part by
// ### part: boots, legs, the duty belt with the radio and the baton, the tapered shirt, shoulders, arms and hands, neck,
// ### head and ears, and the peaked cap. Points are in his own metres (x across, y up, z forwards, as in buildHale); `to`
// ### turns a point into a spot on the canvas and `px` a radius there into pixels, so the same body can be seen from the
// ### front or thrown flat onto the floor by a light. reach: one arm out to the door handle, as while he holds the door.
function haleOutline(g, to, px, reach){
  // a limb: round at both ends, r0 thick at a and r1 at b
  const limb = (a, b, r0, r1) => {
    const [ax, ay] = to(a), [bx, by] = to(b), ra = px(a, r0), rb = px(b, r1), l = Math.hypot(bx - ax, by - ay) || 1, nx = (ay - by) / l, ny = (bx - ax) / l;
    g.beginPath(); g.arc(ax, ay, ra, 0, 7); g.fill(); g.beginPath(); g.arc(bx, by, rb, 0, 7); g.fill();
    g.beginPath(); g.moveTo(ax + nx * ra, ay + ny * ra); g.lineTo(bx + nx * rb, by + ny * rb); g.lineTo(bx - nx * rb, by - ny * rb); g.lineTo(ax - nx * ra, ay - ny * ra); g.fill();
  };
  // an oval round c through ex (its side) and ey (its top), so it stretches and leans with the view
  const oval = (c, ex, ey) => {
    const [cx, cy] = to(c), [xx, xy] = to(ex), [yx, yy] = to(ey);
    g.save(); g.transform(xx - cx, xy - cy, yx - cx, yy - cy, cx, cy); g.beginPath(); g.arc(0, 0, 1, 0, 7); g.restore(); g.fill();
  };
  // a body of revolution seen from the front: its [radius, height] profile down one side and back up the other
  const profile = (pts, z) => {
    g.beginPath();
    [...pts.map(([r, y]) => [r, y, z]), ...[...pts].reverse().map(([r, y]) => [-r, y, z])].forEach((p, i) => { const [x, y] = to(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.fill();
  };
  for (const s of [-1, 1]){
    const x = s * .1;
    limb([x, .03, -.08], [x, .03, .19], .05, .045);                      // the boot on the floor, heel to toe
    limb([x, .06, 0], [x, .21, 0], .058, .054);                           // boot shaft
    limb([x, .17, 0], [x * 1.05, .52, .01], .062, .066);                  // lower leg
    limb([x * 1.05, .52, .01], [x, .93, 0], .066, .088);                  // thigh
  }
  // the seat of the trousers, the belt and the shirt up to the collar
  profile([[.16, .82], [.18, .9], [.187, .96], [.187, 1.006], [.186, 1.12], [.2, 1.26], [.208, 1.36], [.205, 1.44], [.19, 1.5], [.15, 1.54], [.1, 1.57], [.076, 1.6], [.068, 1.63]], 0);
  limb([-.18, .94, -.045], [-.18, .99, -.045], .032, .032);              // radio pack on the belt
  limb([.185, .99, -.02], [.2, .55, -.03], .016, .014);                  // baton
  for (const s of [-1, 1]) oval([s * .2, 1.455, 0], [s * .27, 1.455, 0], [s * .2, 1.525, 0]);   // shoulders
  // shoulder, elbow, wrist and finger tips: one arm hangs, the other one hangs too or reaches out to the door
  const arm = (sh, el, wr, tip) => { limb(sh, el, .058, .05); limb(el, wr, .05, .04); limb(wr, tip, .03, .022); };
  arm([-.205, 1.45, 0], [-.235, 1.17, -.02], [-.241, .918, .043], [-.245, .81, .06]);
  if (reach) arm([.205, 1.45, 0], [.32, 1.29, .24], [.393, 1.197, .51], [.42, 1.18, .61]);
  else arm([.205, 1.45, 0], [.235, 1.17, -.02], [.241, .918, .043], [.245, .81, .06]);
  limb([0, 1.57, -.008], [0, 1.68, 0], .066, .058);                      // neck
  oval([0, 1.745, .01], [.078, 1.745, .01], [0, 1.857, .01]);            // head
  for (const s of [-1, 1]) oval([s * .076, 1.737, -.008], [s * .088, 1.737, -.008], [s * .076, 1.764, -.008]);   // ears
  // the peaked cap: the band, the crown widening to its top, and the visor in front
  profile([[.087, 1.783], [.087, 1.826], [.11, 1.853], [.122, 1.866], [.118, 1.873], [.06, 1.879], [0, 1.88]], .01);
  oval([0, 1.784, .07], [.092, 1.784, .07], [0, 1.796, .07]);
}
// ### A shape drawn by draw(g) on a w x h canvas, its edges softened by r pixels. A canvas's own drop shadow does the
// ### blurring (every browser has it): the shape is drawn one canvas width off to the left and only its shadow lands.
function softShape(w, h, r, color, draw){
  const m = document.createElement('canvas'); m.width = w; m.height = h;
  const mg = m.getContext('2d'); mg.fillStyle = color; draw(mg);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.shadowColor = color; g.shadowBlur = r; g.shadowOffsetX = w; g.drawImage(m, -w, 0);
  return c;
}
// ### Hale behind the window, from the front: his dark figure against the corridor light, soft through the glass. The
// ### picture holds all of him, 0.68 m across and from 2 cm below his soles to 2.02 m (256 pixels to 0.68 m both ways);
// ### updateGuard shows the part that fits the window and makes it smaller as he walks off.
const guardTex = canvasTex(256, 768, (g, w, h) => {
  const PX = w / .68;
  g.drawImage(softShape(w, h, 4, '#07090c', c => haleOutline(c, p => [(p[0] + .34) * PX, (2.02 - p[1]) * PX], (p, r) => r * PX, false)), 0, 0);
});
// ### Paints a digit for the wheels of the combination lock.
const digitTex = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };
function drawDigit(t, d){
  const g = t.image.getContext('2d');
  g.fillStyle = '#262b2e'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e9ece6'; g.font = '700 46px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d), 32, 35);
  t.needsUpdate = true;
}
// ### The relief of the tiles: one height map (the grout lies lower, the glaze has a rounded edge) and one gloss map (the
// ### glaze is smooth, the grout matt), painted once and shared by every tiled surface.
const tileRelief = (() => {
  const S2 = 512, n = 8, s = S2 / n, gw = s * .037;
  const bump = document.createElement('canvas'), gloss = document.createElement('canvas');
  bump.width = bump.height = gloss.width = gloss.height = S2;
  const b = bump.getContext('2d'), r = gloss.getContext('2d');
  b.fillStyle = '#000'; b.fillRect(0, 0, S2, S2); r.fillStyle = '#ececec'; r.fillRect(0, 0, S2, S2);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    for (let k = 0; k < 4; k++){ const v = 110 + k * 45, o = gw + k * 1.2; b.fillStyle = `rgb(${v},${v},${v})`; b.fillRect(i * s + o, j * s + o, s - o * 2, s - o * 2); }
    const v = 46 + rnd() * 30 | 0; r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(i * s + gw, j * s + gw, s - gw * 2, s - gw * 2);
  }
  // dull patches where years of cleaning have worn the glaze
  for (let i = 0; i < 40; i++){ const x = rnd() * S2, y = rnd() * S2, rr = 10 + rnd() * 40, g = r.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(170,170,170,.35)'); g.addColorStop(1, 'rgba(170,170,170,0)'); r.fillStyle = g; r.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  // ### The height map is turned into a normal map once. A bump map is worked out per pixel on screen and sparkles along
  // ### the grout as you move; a normal map is filtered like any texture, so the relief stays calm while you walk and look.
  const normal = document.createElement('canvas'); normal.width = normal.height = S2;
  const hd = b.getImageData(0, 0, S2, S2).data, nc = normal.getContext('2d'), out = nc.createImageData(S2, S2), o = out.data;
  const h = (x, y) => hd[(((y + S2) % S2) * S2 + (x + S2) % S2) * 4] / 255;
  for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++){
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2, dy = (h(x, y + 1) - h(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * S2 + x) * 4;
    o[i] = (-dx / l * .5 + .5) * 255; o[i + 1] = (dy / l * .5 + .5) * 255; o[i + 2] = (1 / l * .5 + .5) * 255; o[i + 3] = 255;
  }
  nc.putImageData(out, 0, 0);
  return { normal, gloss };
})();
// ### A tiled material for w x h metres of wall: the colour picture (12 tiles across) and the relief and gloss (8 tiles
// ### across) start at the same corner and share the 15 cm grid, so the grout lines meet exactly.
function tileMat(w, h = TILE_H){
  const map = tileTex(), mk = (img, aniso) => { const t = new THREE.CanvasTexture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.repeat.set(w / 1.2, h / 1.2); return t; };
  map.repeat.set(w / 1.8, h / 1.8);
  return new THREE.MeshStandardMaterial({ map, normalMap: mk(tileRelief.normal, ANISO), roughnessMap: mk(tileRelief.gloss, Math.min(ANISO, 4)), roughness: 1, metalness: 0 });
}
// ### The stall's panels paint their whole coat themselves now (see panelMaterial). The shared picture they used to stretch
// ### over every panel took this many of the room's random numbers; they are still drawn, so every texture after it keeps
// ### its look.
for (let i = 0; i < 20182; i++) rnd();
// ### The ceiling: painted concrete with the joints of the slabs and brown water stains around the old leaks.
const ceilingTex = canvasTex(TEX / 2, TEX / 2, (g, w, h) => {
  g.fillStyle = '#4a4f4c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++){ const v = rnd(); g.fillStyle = v > .5 ? `rgba(255,255,255,${(v - .5) * .08})` : `rgba(0,0,0,${v * .12})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  for (let k = 0; k < 5; k++){ const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70;
    for (let j = 0; j < 3; j++){ g.strokeStyle = `rgba(110,80,40,${.25 - j * .06})`; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, r * (1 - j * .2), r * (.7 - j * .12), rnd(), 0, 7); g.stroke(); }
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(90,70,40,.25)'); gr.addColorStop(1, 'rgba(90,70,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
}, [2, 1.5]);
// ### Soft shadows where surfaces meet (ambient occlusion), painted as gradients rather than computed every frame.
const aoTex = canvasTex(8, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(.35, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const blobTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(.55, 'rgba(0,0,0,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
// ### Dirt on the floor: rings of limescale and grime around the toilet and the drain, stains and drips.
const stainTex = canvasTex(256, 256, (g, w, h) => {
  for (let i = 0; i < 26; i++){ const x = w / 2 + (rnd() - .5) * w * .5, y = h / 2 + (rnd() - .5) * h * .5, r = 10 + rnd() * 50, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${60 + rnd() * 40 | 0},${50 + rnd() * 30 | 0},30,.3)`); gr.addColorStop(1, 'rgba(60,50,30,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(200,195,170,.25)'; g.lineWidth = 3; g.beginPath(); g.ellipse(w / 2, h / 2, w * .36, h * .3, 0, 0, 7); g.stroke();
});
// ### Grilles: slots for the air vent, small holes for the intercom speaker.
const grilleTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#9aa2a4'; g.fillRect(0, 0, w, h); g.fillStyle = '#121414'; for (let y = 10; y < h - 8; y += 12) g.fillRect(8, y, w - 16, 6); });
const speakerTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#a4abad'; g.fillRect(0, 0, w, h); g.fillStyle = '#181a1a'; for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (Math.hypot(x - 3, y - 3) < 3.4){ g.beginPath(); g.arc(22 + x * 14, 22 + y * 14, 3.5, 0, 7); g.fill(); } });

// soft gradients and small parts need no extra texture samples at grazing angles; the ceiling and steel need only a few
for (const t of [aoTex, blobTex, stainTex, grilleTex, speakerTex]) t.anisotropy = 1;
ceilingTex.anisotropy = 4;

// ### Powder-coated steel for the stall. Each panel (the partition, the two pilasters, the door) gets a picture of its own
// ### from corner to corner, about 3 mm a pixel, painted the way a real panel looks after years in a prison washroom. The
// ### coat is a semi-gloss paint with no metal in it, so it takes a soft sheen from the lamps: a faint mottling, a fine
// ### speckle, the orange peel of the powder and the sheet steel's gentle waves under it, its gloss a little uneven.
// ### The wear is where it really happens. Chips come in small clusters where something knocked the panel, mostly along
// ### the edges and low down: bare, shiny steel inside, or rust where it stayed wet, bleeding a little down the paint.
// ### Scratches come in groups of near-parallel strokes at hand and hip height (a key, a ring, a belt buckle dragged
// ### along), with a few long single ones and a haze of fine scuffs that only dulls the gloss. Low down: kicked-in
// ### dents, black scuffs of rubber soles, dirt and mop splashes rising from the floor, and rust and blistered paint
// ### along the bottom edge where the mop water sits. Streaks of dried water run down, grime sits in the rolled edges,
// ### and greasy hand prints show where people push. The relief is a normal map; roughness (green) and metalness (blue)
// ### come from one more picture: bare steel is smooth metal, grease is smooth, dirt and rust are rough. foot is how
// ### high above the floor the panel starts, grips are [u, height] where hands push.
const panelRnd = mulberry32(5150);   // its own random numbers, so the rest of the room keeps its look
function panelMaterial(wm, hm, foot, grips = []){
  const R = panelRnd, D = COARSE ? 170 : 320, w = Math.max(32, Math.round(wm * D)), h = Math.max(32, Math.round(hm * D)), area = wm * hm, px = D / 320;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const col = mk(), hgt = mk(), rgh = mk(), g = col.getContext('2d'), e = hgt.getContext('2d'), r = rgh.getContext('2d');
  const Y = m => (hm - (m - foot)) * D;   // the canvas row at a height of m metres above the floor
  const blob = (c, x, y, rad, colour) => { const gr = c.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, colour); gr.addColorStop(1, colour.replace(/[\d.]+\)$/, '0)')); c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
  // the coat: its colour, a faint mottling and a fine speckle; semi-gloss and no metal
  g.fillStyle = '#5f6d65'; g.fillRect(0, 0, w, h);
  e.fillStyle = '#808080'; e.fillRect(0, 0, w, h);
  r.fillStyle = 'rgb(0,118,0)'; r.fillRect(0, 0, w, h);
  for (let i = 0; i < area * 30; i++) blob(g, R() * w, R() * h, D * (.05 + R() * .2), R() < .5 ? 'rgba(150,165,155,.045)' : 'rgba(40,48,44,.05)');
  for (let i = 0; i < w * h / 70; i++){ const v = R() < .5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${R() * .045})`; g.fillRect(R() * w, R() * h, 1.5 * px, 1.5 * px); }
  for (let i = 0; i < area * 8; i++) blob(r, R() * w, R() * h, D * (.08 + R() * .25), R() < .5 ? 'rgba(0,150,0,.25)' : 'rgba(0,92,0,.25)');
  // the orange peel of the powder coat
  for (let i = 0; i < w * h / 26; i++){ const v = 128 + (R() - .5) * 34 | 0; e.fillStyle = `rgb(${v},${v},${v})`; e.beginPath(); e.arc(R() * w, R() * h, .8 + R() * 1.6, 0, 7); e.fill(); }
  // the sheet steel is never quite flat: broad, gentle waves that show in the gloss (oil-canning)
  for (let i = 0; i < area * 3; i++) blob(e, R() * w, R() * h, D * (.25 + R() * .35), R() < .5 ? 'rgba(150,150,150,.12)' : 'rgba(105,105,105,.12)');
  // a haze of fine scuffs that only dulls the gloss, thickest at hand height
  r.lineCap = 'round';
  for (let i = 0; i < area * 140; i++){
    const x = R() * w, y = Y(foot + Math.min(hm, .2 + R() * 1.6)), l = D * (.004 + R() * .02), a = (R() - .5) * 1.6;
    r.strokeStyle = 'rgba(0,160,0,.45)'; r.lineWidth = .7 * px; r.beginPath(); r.moveTo(x, y); r.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); r.stroke();
  }
  // dents where the panel was kicked, mostly low down
  for (let i = 0; i < Math.max(1, area * 2.2); i++){
    const x = R() * w, y = Y(foot + .1 + R() * Math.min(hm * .6, 1)), rad = D * (.015 + R() * .03);
    blob(e, x, y, rad, 'rgba(40,40,40,.7)'); blob(g, x, y + rad * .3, rad, 'rgba(20,24,22,.1)');
  }
  // ### A scratch: a slightly bent stroke. A light one only whitens and dulls the paint; a deep one cuts to the steel.
  const scratch = (x0, y0, x1, y1, bend, deep) => {
    const mx = (x0 + x1) / 2 - (y1 - y0) * bend, my = (y0 + y1) / 2 + (x1 - x0) * bend;
    for (const [c, st, lw] of [[g, deep ? 'rgba(158,164,166,.7)' : `rgba(196,206,198,${.05 + R() * .12})`, deep ? 1.1 : .7], [e, deep ? '#4c4c4c' : '#727272', 1], [r, deep ? 'rgb(0,90,235)' : 'rgb(0,150,0)', 1]]){
      c.strokeStyle = st; c.lineWidth = lw * px; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1); c.stroke();
    }
  };
  // groups of strokes side by side, dragged together, mostly along the panel, at hand and hip height
  for (let k = 0; k < Math.max(2, area * 3.2); k++){
    const cx = R() * w, cy = Y(foot + Math.min(hm - .05, .35 + R() * 1.2)), a = (R() - .5) * 1.1 + (R() < .25 ? Math.PI / 2 : 0);
    const n = 2 + (R() * 5 | 0), l = D * (.03 + R() * R() * .22), gap = D * (.0015 + R() * .004), bend = (R() - .5) * .25, deep = R() < .12;
    for (let i = 0; i < n; i++){
      const o = (i - n / 2) * gap, aa = a + (R() - .5) * .07, ll = l * (.55 + R() * .45), s = (R() - .5) * l * .25;
      const x0 = cx - Math.sin(a) * o + Math.cos(aa) * s, y0 = cy + Math.cos(a) * o + Math.sin(aa) * s;
      scratch(x0, y0, x0 + Math.cos(aa) * ll, y0 + Math.sin(aa) * ll, bend, deep && i === 0);
    }
  }
  for (let k = 0; k < area; k++){ const x = R() * w, y = R() * h, a = R() * 6.283, l = D * (.06 + R() * .2); scratch(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, (R() - .5) * .15, R() < .05); }
  // ### A chip: the coat broken off in an uneven patch, a little lower than the paint, with the broken edge as a thin
  // ### dark rim. Inside is bare, shiny steel, or rust where it stayed wet, which bleeds a little down the paint below.
  const chip = (x, y, rad) => {
    const pts = [], n = 5 + (R() * 4 | 0), sq = .6 + R() * .5, rust = R() < .3;
    for (let k = 0; k < n; k++){ const a = (k + R() * .5) / n * 6.283, rr = rad * (.45 + R() * .75); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * sq]); }
    const path = c => { c.beginPath(); c.moveTo(...pts[0]); for (const q of pts) c.lineTo(...q); c.closePath(); };
    path(g); g.lineWidth = 1.1 * px; g.strokeStyle = 'rgba(30,34,31,.5)'; g.stroke();
    g.fillStyle = rust ? `rgb(${76 + R() * 22 | 0},${52 + R() * 12 | 0},${38 + R() * 8 | 0})` : 'rgb(142,147,149)'; g.fill();
    path(e); e.fillStyle = rust ? '#686868' : '#5a5a5a'; e.fill();
    path(r); r.fillStyle = rust ? 'rgb(0,235,0)' : 'rgb(0,85,255)'; r.fill();
    if (rust && R() < .7){ const l = D * (.01 + R() * .05), gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(96,64,42,.3)'); gr.addColorStop(1, 'rgba(96,64,42,0)'); g.fillStyle = gr; g.fillRect(x - rad * .35, y, rad * .7 + px, l); }
  };
  // the knocks: on a vertical edge (more often low), on the bottom or the top edge, or low on the face
  for (let k = 0; k < Math.max(2, Math.round((wm + hm) * 1.5)); k++){
    const s = R(), inset = D * .006;
    let x, y;
    if (s < .35){ x = R() < .5 ? inset : w - inset; y = Y(foot + Math.pow(R(), 1.6) * hm); }
    else if (s < .55){ x = R() * w; y = h - inset; }
    else if (s < .65){ x = R() * w; y = inset; }
    else { x = R() * w; y = Y(foot + Math.pow(R(), 2) * Math.min(hm, .9)); }
    const n = 1 + (R() * 6 | 0), spread = D * (.006 + R() * .025);
    for (let i = 0; i < n; i++) chip(x + (R() - .5) * spread * 2, y + (R() - .5) * spread * 2, (1 + Math.pow(R(), 3) * 6) * 1.2 * px);
  }
  // black scuffs of rubber soles between 5 and 40 cm above the floor
  for (let i = 0; i < wm * 6; i++){
    const x = R() * w, y = Y(.05 + R() * R() * .4), l = D * (.03 + R() * .12), a = (R() - .5) * 1.4, bend = (R() - .5) * l * .6, x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l;
    if (y < 0 || y > h) continue;
    for (const [c, st, lw] of [[g, `rgba(22,22,22,${.12 + R() * .22})`, 1.5 + R() * 4], [r, 'rgb(0,165,0)', 4]]){ c.strokeStyle = st; c.lineWidth = lw * px; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo((x + x1) / 2 - Math.sin(a) * bend, (y + y1) / 2 + Math.cos(a) * bend, x1, y1); c.stroke(); }
  }
  // dirt rising from the floor, splashes of mop water and the tide line they leave, dull and rough
  const dirt = g.createLinearGradient(0, Y(0), 0, Y(.55)); dirt.addColorStop(0, 'rgba(66,54,36,.5)'); dirt.addColorStop(1, 'rgba(66,54,36,0)');
  g.fillStyle = dirt; g.fillRect(0, 0, w, h);
  const dull = r.createLinearGradient(0, Y(0), 0, Y(.4)); dull.addColorStop(0, 'rgba(0,200,0,.7)'); dull.addColorStop(1, 'rgba(0,200,0,0)');
  r.fillStyle = dull; r.fillRect(0, 0, w, h);
  for (let i = 0; i < wm * 160; i++){ const y = Y(Math.pow(R(), 2) * .16); if (y < 0 || y > h) continue; g.fillStyle = `rgba(60,48,32,${.15 + R() * .3})`; g.beginPath(); g.arc(R() * w, y, (.6 + R() * 2.2) * px, 0, 7); g.fill(); }
  if (foot < .05){ g.strokeStyle = 'rgba(70,58,40,.35)'; g.lineWidth = 2 * px; g.beginPath(); for (let x = 0; x <= w; x += 6) g.lineTo(x, Y(.09 + Math.sin(x / px * .05) * .006 + (R() - .5) * .004)); g.stroke(); }
  // the bottom edge, where the mop water sits: rust creeping in under the coat and the paint blistering over it
  for (let i = 0; i < wm * 14; i++){
    const x = R() * w, y = h - R() * R() * D * .03, rad = D * (.004 + R() * .012);
    blob(g, x, y, rad * 1.8, 'rgba(96,60,34,.45)'); blob(r, x, y, rad * 1.8, 'rgba(0,225,0,.8)');
    if (R() < .5){ blob(e, x, y - rad, rad, 'rgba(190,190,190,.6)'); blob(g, x, y - rad, rad * .8, 'rgba(110,70,40,.25)'); }
  }
  // streaks of dried water running down
  for (let i = 0; i < area * 6; i++){ const x = R() * w, y = R() * h * .7, l = D * (.1 + R() * .35); g.strokeStyle = `rgba(48,54,50,${.03 + R() * .04})`; g.lineWidth = (1 + R() * 2) * px; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 4, y + l); g.stroke(); }
  // grime in the rolled edges
  g.strokeStyle = 'rgba(40,40,34,.22)'; g.lineWidth = 2 * px; g.strokeRect(px, px, w - 2 * px, h - 2 * px);
  // ### Where hands push: greasy patches and the prints of whole hands (a palm and four fingers, the thumb to one side),
  // ### darker and smoother than the paint round them.
  const HAND = [[0, 0, .045, .05, 0], [-.034, -.075, .009, .03, .12], [-.012, -.088, .0095, .034, .04], [.011, -.085, .0095, .032, -.04], [.031, -.068, .0085, .026, -.14], [.058, -.008, .011, .026, -.9]];
  const print = (cx, cy, a, s) => {
    for (const [c, colour] of [[g, `rgba(28,32,28,${.05 + R() * .05})`], [r, 'rgba(0,60,0,.35)']]){
      c.save(); c.translate(cx, cy); c.rotate(a); c.fillStyle = colour;
      for (const [x, y, rx, ry, rot] of HAND){ c.beginPath(); c.ellipse(x * D * s, y * D * s, rx * D * s, ry * D * s, rot, 0, 6.283); c.fill(); }
      c.restore();
    }
  };
  for (const [u, m] of grips){
    for (let k = 0; k < 6; k++){ const x = u * w + (R() - .5) * D * .1, y = Y(m + (R() - .5) * .2), rad = D * (.03 + R() * .05); blob(g, x, y, rad, 'rgba(30,34,30,.18)'); blob(r, x, y, rad, 'rgba(0,70,0,.6)'); }
    for (let k = 0; k < 3; k++) print(clamp(u * w + (R() - .5) * D * .12, D * .06, w - D * .06), Y(m + (R() - .5) * .25), (R() - .5) * .8 + (u > .5 ? -.3 : .3), .9 + R() * .2);
  }
  const tex = (c, srgb, aniso) => { const t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso; return t; };
  const rm = tex(rgh, false, 2);
  return new THREE.MeshStandardMaterial({ map: tex(col, true, ANISO), normalMap: tex(normalFromHeight(hgt, D, .35), false, 4), roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1 });
}
// ### A partition panel w x h metres and t thick: a rounded rectangle with crimped, rounded edges, its corner at the
// ### origin and its faces towards +z and -z. Both faces and the edges show the panel's own picture from corner to corner.
function panelGeo(w, h, t, r = .012){
  const b = Math.min(.006, t / 3), s = new THREE.Shape(); roundedRect(s, b, b, w - b, h - b, r);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -(t - 2 * b) / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, clamp(p.getX(i) / w, 0, 1), clamp(p.getY(i) / h, 0, 1));
  return geo;
}

// ---------- Scanned textures (Poly Haven, CC0) ----------
// ### Real photographed surfaces from Poly Haven's free asset library (polyhaven.com, all CC0), fetched once through its
// ### API and kept in room-1-escape/textures: a scratched hangar floor of poured concrete, a painted cinder-block wall,
// ### a scratched steel plate whose gloss and dents give the stainless steel its wear, and the "Bank Vault" HDRI (a
// ### caged concrete vault under a fluorescent tube) that every metal surface reflects. Each file loads once; every
// ### surface that uses it gets its own copy with its own repeat, and all copies are refreshed when the picture arrives.
const SCAN = (() => {
  const loader = new THREE.TextureLoader(ASSETS), files = {};
  return (file, srgb, rx = 1, ry = 1, aniso = ANISO) => {
    let f = files[file];
    if (!f){
      f = files[file] = { copies: [], img: null };
      loader.load('textures/' + file, t => { f.img = t.image; for (const c of f.copies){ c.image = t.image; c.needsUpdate = true; } shadowsMoved(); });
    }
    const t = new THREE.Texture(f.img || undefined);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = aniso;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (f.img) t.needsUpdate = true;
    f.copies.push(t);
    return t;
  };
})();
// ### Painted cinder blocks for the walls above the tiles (one picture is about a metre of wall). The scan is a grey
// ### block; the tint (linear, above 1) paints it the yellowed cream of the walls in the photo, keeping its pores and joints.
function blockMat(w, h){
  const m = new THREE.MeshStandardMaterial({ map: SCAN('wall-blocks-color.jpg', true, w, h), normalMap: SCAN('wall-blocks-normal.jpg', false, w, h, 4),
    normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: SCAN('wall-blocks-rough.jpg', false, w, h, 2), roughness: 1.1 });
  m.color.setRGB(4.1, 3.75, 3.2);
  return m;
}
// ### Stainless steel: the scanned scratches change the gloss and dent the surface a little; the vault HDRI does the rest.
function steelMat(color, roughness, o){
  return new THREE.MeshStandardMaterial(Object.assign({ color, metalness: 1, roughness, roughnessMap: SCAN('steel-scratches-rough.jpg', false, 1, 1),
    normalMap: SCAN('steel-scratches-normal.jpg', false, 1, 1, 4), normalScale: new THREE.Vector2(.35, .35), envMapIntensity: 1.25 }, o));
}

// ---------- Materials ----------
// ### The surfaces of the cell: scanned textures for the concrete, the cinder blocks and the steel, painted canvas
// ### textures for everything that tells the story (the tiles, the graffiti, the scratches, the steam, the sign).
const M = {
  tiles: w => tileMat(w),
  floor: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: .78 }),
  ceiling: new THREE.MeshStandardMaterial({ map: ceilingTex, roughness: .95, normalMap: SCAN('floor-concrete-normal.jpg', false, 3, 2.25, 4), normalScale: new THREE.Vector2(.8, .8) }),
  steel: steelMat(0xc9cfd2, 1.35),
  dullSteel: steelMat(0x9aa2a6, 2.1, { envMapIntensity: .9 }),
  // the toilet: polished stainless steel, seen from both sides inside the bowl and the basin
  bowl: steelMat(0xd2d8da, 1.1, { side: THREE.DoubleSide }),
  // the steel bench, the urinal trough and the showers: plain stainless, a little duller where hands and water wear it
  worn: steelMat(0xb4bcc0, 1.7),
  water: new THREE.MeshStandardMaterial({ color: 0x5d6b5e, metalness: .1, roughness: .04, transparent: true, opacity: .88 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecee, metalness: 1, roughness: .12 }),
  cove: new THREE.MeshStandardMaterial({ color: 0x24382c, roughness: .35 }),
  grille: new THREE.MeshStandardMaterial({ map: grilleTex, metalness: .5, roughness: .6 }),
  speaker: new THREE.MeshStandardMaterial({ map: speakerTex, metalness: .6, roughness: .5 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0xd9dad3, roughness: .45 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa8251c, roughness: .4 }),
  led: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 3 }),
  ao: new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  stain: new THREE.MeshStandardMaterial({ map: stainTex, transparent: true, depthWrite: false, roughness: .9, polygonOffset: true, polygonOffsetFactor: -3 }),
  mirror: new THREE.MeshStandardMaterial({ color: 0xdfe4e6, metalness: 1, roughness: .12 }),
  door: new THREE.MeshStandardMaterial({ color: 0x3e4b54, metalness: .55, roughness: .55 }),
  plate: new THREE.MeshStandardMaterial({ map: plateTex, metalness: .75, roughness: .4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 1 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0x59605c, metalness: .6, roughness: .45 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xe9dfc4, roughness: .9, side: THREE.DoubleSide }),
  corridor: new THREE.MeshBasicMaterial({ map: corridorTex }),
  guard: new THREE.MeshBasicMaterial({ map: guardTex, transparent: true, opacity: 0, depthWrite: false }),
  graffiti: new THREE.MeshStandardMaterial({ map: graffitiMaps.map, normalMap: graffitiMaps.normal, roughnessMap: graffitiMaps.sheen, metalnessMap: graffitiMaps.sheen, roughness: 1, metalness: 1, transparent: true, depthWrite: false }),
  scratches: new THREE.MeshStandardMaterial({ map: scratchesTex, transparent: true, roughness: .8, depthWrite: false }),
  steam: new THREE.MeshStandardMaterial({ map: steamTex, transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
  sign: new THREE.MeshStandardMaterial({ map: signTex, roughness: .8 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: .9 }),
  frost: new THREE.MeshStandardMaterial({ color: 0x9fb4c4, emissive: 0x24384e, emissiveIntensity: 1, roughness: .2, metalness: 0 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: .6 })
};

// ---------- Water on the floor ----------
// ### The puddles are real mirrors. When one is in view the room is drawn a second time, at 40 % of the width and height
// ### of the screen, by a camera mirrored under the floor (the way three.js's Reflector does it, with an oblique near plane
// ### that cuts away everything below the floor). Each point of a puddle looks that picture up where its mirror image
// ### is, so the lamps, the steel and the red glow show in the water: bent a little by slow ripples and by the rings of
// ### the drops that fall from the shower head. Where the water stands the concrete is darker, round it a damp rim;
// ### the flatter you look across a puddle, the more it mirrors (Fresnel). The shapes are noise, so no two are alike.
const WATER = (() => {
  // fractal noise for the outlines, painted once (three octaves that tile), so the shader reads it instead of working it out
  const noise = (() => {
    const S = 128, data = new Uint8Array(S * S * 4), oct = [[4, .55], [8, .3], [16, .15]].map(([n, a]) => ({ n, a, g: Array.from({ length: n * n }, rnd) }));
    const fade = t => t * t * (3 - 2 * t);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
      let v = 0;
      for (const o of oct){
        const fx = x / S * o.n, fy = y / S * o.n, ix = Math.floor(fx), iy = Math.floor(fy), sx = fade(fx - ix), sy = fade(fy - iy), at = (i, j) => o.g[(j % o.n) * o.n + i % o.n];
        v += o.a * ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy);
      }
      const i = (y * S + x) * 4; data[i] = data[i + 1] = data[i + 2] = v * 255; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  })();
  const rt = new THREE.WebGLRenderTarget(16, 16, { encoding: THREE.sRGBEncoding, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const texMat = new THREE.Matrix4(), drip = new THREE.Vector4(3.715, 1.55, -99, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tRefl: { value: rt.texture }, tNoise: { value: noise }, texMat: { value: texMat }, time: { value: 0 }, drip: { value: drip } },
    vertexShader: `
      uniform mat4 texMat; varying vec4 vProj; varying vec3 vWorld; varying vec2 vUv;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vUv = uv; vProj = texMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D tRefl, tNoise; uniform float time; uniform vec4 drip; varying vec4 vProj; varying vec3 vWorld; varying vec2 vUv;
      void main(){
        // the outline: an ellipse frayed by the noise; water inside, a damp rim round it
        float n = texture2D(tNoise, vWorld.xz * 0.4).r * 0.75 + texture2D(tNoise, vWorld.xz * 1.9 + 0.37).r * 0.25;
        float d = length((vUv - 0.5) * 2.0) * 1.25 + (n - 0.5) * 0.5;
        float water = smoothstep(0.8, 0.68, d), damp = smoothstep(1.0, 0.6, d);
        if (damp <= 0.0) discard;
        // slow ripples, and rings running out from the last drop
        vec2 w = vec2(sin(vWorld.x * 21.0 + time * 1.1) + sin(vWorld.z * 29.0 - time * 1.6), sin(vWorld.z * 17.0 + time * 1.3) + sin(vWorld.x * 25.0 - time * 0.9)) * 0.0015;
        vec2 dv = vWorld.xz - drip.xy; float dl = length(dv), age = time - drip.z, front = dl - age * 0.3;
        w += dv / max(dl, 0.001) * sin(front * 95.0) * exp(-front * front * 180.0) * exp(-age * 1.3) * 0.014;
        vec4 p = vProj; p.xy += w * p.w;
        // four taps a little apart: water on rough concrete never mirrors quite sharply
        vec2 b = vec2(0.0015, 0.0025) * p.w;
        vec3 refl = (sRGBToLinear(texture2DProj(tRefl, p + vec4(b, 0.0, 0.0))).rgb + sRGBToLinear(texture2DProj(tRefl, p - vec4(b, 0.0, 0.0))).rgb
          + sRGBToLinear(texture2DProj(tRefl, p + vec4(b.y, -b.x, 0.0, 0.0))).rgb + sRGBToLinear(texture2DProj(tRefl, p - vec4(b.y, -b.x, 0.0, 0.0))).rgb) * 0.25;
        refl *= 1.0 + smoothstep(0.6, 1.0, max(refl.r, max(refl.g, refl.b))) * 2.5;   // the lamps glint
        float F = 0.3 + 0.7 * pow(1.0 - clamp(normalize(cameraPosition - vWorld).y, 0.0, 1.0), 4.0);
        float a = mix(damp * 0.35, 0.55 + 0.45 * F, water);
        gl_FragColor = linearToOutputTexel(vec4(refl, 1.0));
        gl_FragColor = vec4(gl_FragColor.rgb * water * F, a);
      }`,
    transparent: true, depthWrite: false, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -4
  });
  // ### The mop water in the bucket uses the same mirror picture. Its surface is higher than the floor, and a mirror at
  // ### height h shows the floor's mirror picture shifted up by 2 (h - floor) (camera and mirrored room move together),
  // ### so each point looks the picture up that far lower down. The water itself is murky grey-brown with grey scum and
  // ### bubbles on it; seen from above you look into it, and the flatter you look the more it mirrors the room.
  // ### The water in the toilet bowl is the same, only yellower and browner (murk is the colour of the water itself) and
  // ### duller (gloss scales the mirroring: deep in the steel bowl little of the room reaches the water).
  const murks = [];
  const murkMat = (lift, scum, murk, gloss) => { const m = new THREE.ShaderMaterial({
    uniforms: { tRefl: mat.uniforms.tRefl, tNoise: mat.uniforms.tNoise, texMat: mat.uniforms.texMat, time: mat.uniforms.time, lift: { value: lift }, tScum: { value: scum }, murk: { value: new THREE.Color(murk) }, gloss: { value: gloss } },
    vertexShader: `
      uniform mat4 texMat; uniform float lift; varying vec4 vProj; varying vec3 vWorld; varying vec2 vUv;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vUv = uv; vProj = texMat * (w - vec4(0.0, lift, 0.0, 0.0)); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D tRefl, tNoise, tScum; uniform float time, gloss; uniform vec3 murk; varying vec4 vProj; varying vec3 vWorld; varying vec2 vUv;
      void main(){
        // fine slow ripples: the water in a bucket hardly moves
        vec2 w = vec2(sin(vWorld.x * 47.0 + time * 0.7) + sin(vWorld.z * 59.0 - time * 0.9), sin(vWorld.z * 41.0 + time * 0.8) + sin(vWorld.x * 53.0 - time * 0.6)) * 0.0009;
        vec4 p = vProj; p.xy += w * p.w;
        vec2 b = vec2(0.0012, 0.002) * p.w;
        vec3 refl = (sRGBToLinear(texture2DProj(tRefl, p + vec4(b, 0.0, 0.0))).rgb + sRGBToLinear(texture2DProj(tRefl, p - vec4(b, 0.0, 0.0))).rgb
          + sRGBToLinear(texture2DProj(tRefl, p + vec4(b.y, -b.x, 0.0, 0.0))).rgb + sRGBToLinear(texture2DProj(tRefl, p - vec4(b.y, -b.x, 0.0, 0.0))).rgb) * 0.25;
        refl *= 1.0 + smoothstep(0.6, 1.0, max(refl.r, max(refl.g, refl.b))) * 2.5 * gloss;
        float F = (0.25 + 0.75 * pow(1.0 - clamp(normalize(cameraPosition - vWorld).y, 0.0, 1.0), 4.0)) * gloss;
        // the murk: grey-brown, cloudier in patches, darker in the shadow of the bucket's wall
        float n = texture2D(tNoise, vWorld.xz * 5.0 + vec2(time * 0.003, 0.0)).r;
        float r = length((vUv - 0.5) * 2.0);
        vec3 water = murk * (0.75 + 0.6 * n) * (1.0 - 0.45 * smoothstep(0.7, 1.0, r));
        // grey scum and bubbles drift slowly round
        float c = cos(time * 0.02), s = sin(time * 0.02); vec2 su = mat2(c, -s, s, c) * (vUv - 0.5) + 0.5;
        vec4 scum = sRGBToLinear(texture2D(tScum, su));
        float sc = clamp((scum.r - 0.03) * 4.0, 0.0, 1.0);
        vec3 col = mix(water, refl, F * (1.0 - sc * 0.7));
        col = mix(col, scum.rgb * 0.6, sc * 0.6);
        // a thin wet ring where the water meets the plastic catches the light
        col += refl * smoothstep(0.93, 1.0, r) * 0.6;
        gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
        gl_FragColor.a = mix(1.0 - 0.14 * gloss, 1.0, max(F, sc));   // the duller, the less of the bowl shows through
        gl_FragColor.rgb *= gl_FragColor.a;
      }`,
    transparent: true, depthWrite: false, premultipliedAlpha: true
  }); murks.push(m); return m; };
  const boxes = [], mirror = new THREE.PerspectiveCamera(), frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4(), plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2();
  const N = new THREE.Vector3(0, 1, 0), P0 = new THREE.Vector3(0, .004, 0);
  // the drop that falls from the shower head every few seconds
  const drop = new THREE.Mesh(new THREE.SphereGeometry(.006, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc8d4d8, roughness: .05, metalness: .5 }));
  drop.scale.y = 1.7; drop.visible = false; scene.add(drop);
  let dropT = 1.5, lastT = -1;
  const lastView = new THREE.Matrix4();
  return {
    mat, rt,
    // ### A puddle of w x d metres (the water fills about four fifths of it).
    puddle(w, d, x, z){ const m = flat(w, d, mat, x, z, .005); m.renderOrder = 1; boxes.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, .005, z), new THREE.Vector3(w, .02, d))); return m; },
    // ### Whether a foot at x, z lands in the water of a puddle (the middle four fifths of it; buckets do not count).
    wetAt(x, z){ return boxes.some(b => b.max.y < .05 && Math.abs(x - (b.min.x + b.max.x) / 2) < .4 * (b.max.x - b.min.x) && Math.abs(z - (b.min.z + b.max.z) / 2) < .4 * (b.max.z - b.min.z)); },
    // ### The water in a bucket: a disc of radius r at height y, with a picture of the scum and bubbles on it.
    // ### murk is the water's own colour (linear), grey-brown mop water if left out; gloss how much it mirrors (0 to 1).
    bucket(r, x, y, z, scum, murk = new THREE.Color(.075, .068, .05), gloss = 1){
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), murkMat(2 * (y - P0.y), scum, murk, gloss)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 1; room.add(m);
      boxes.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, y, z), new THREE.Vector3(2 * r, .02, 2 * r)));
      return m;
    },
    resize(){ renderer.getDrawingBufferSize(size); rt.setSize(Math.max(1, size.x * .4 | 0), Math.max(1, size.y * .4 | 0)); lastT = -1; },
    // ### Moves the ripples and the drop on, then draws the mirror picture again, but only when a puddle is in view and
    // ### the view has changed (or a fifth of a second has passed, for the steam and the guard): standing still costs nothing.
    update(t, dt){
      mat.uniforms.time.value = t;
      if ((dropT -= dt) < 0){ dropT += 2.8; drip.z = t; }   // it lands: a new ring
      const fall = .64 - dropT;   // the drop hangs at the head for a moment, then falls 2 m in 0.64 s
      drop.visible = dropT < 1.2;
      drop.position.set(drip.x, fall > 0 ? 2.0 - 4.9 * fall * fall : 2.0, drip.y);
      if (camera.position.y < .1) return;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
      if (!boxes.some(b => frustum.intersectsBox(b))) return;
      if (lastT >= 0 && t - lastT < .2 && camera.matrixWorld.elements.every((v, i) => Math.abs(v - lastView.elements[i]) < 1e-4)) return;
      lastView.copy(camera.matrixWorld); lastT = t;
      // the mirrored camera (three.js Reflector, for a floor at y = 0.004)
      camPos.setFromMatrixPosition(camera.matrixWorld);
      mirror.position.set(camPos.x, 2 * P0.y - camPos.y, camPos.z);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos); look.y = 2 * P0.y - look.y;
      mirror.up.set(0, 1, 0).applyMatrix4(rot); mirror.up.y = -mirror.up.y;
      mirror.lookAt(look); mirror.far = camera.far; mirror.updateMatrixWorld();
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      texMat.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
      // oblique near plane: the camera sees nothing below the floor
      plane.setFromNormalAndCoplanarPoint(N, P0).applyMatrix4(mirror.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = mirror.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
      mat.visible = false; for (const m of murks) m.visible = false;
      const own = INMATE && INMATE.g.visible; if (own) INMATE.g.visible = false;   // your body is drawn without a head
      renderer.setRenderTarget(rt); renderer.render(scene, mirror); renderer.setRenderTarget(null);
      mat.visible = true; for (const m of murks) m.visible = true; if (own) INMATE.g.visible = true;
    }
  };
})();

// ---------- The steel mirror ----------
// ### The mirror over the sinks is a sheet of polished stainless steel, as in every prison (glass would be a weapon), and
// ### it really mirrors the washroom. When it is in view the room is drawn once more, at 45 % of the width and height of
// ### the screen, by a camera mirrored behind the wall (three.js's Reflector again, with an oblique near plane that cuts
// ### away everything behind the mirror). Steel is no glass: the picture is darker and a little cool, and soft, blurred
// ### more where the scanned scratches say the steel is worn and more across than up and down; the sheet bows a little between
// ### its screws, so the picture wavers. Limescale splashed up from the sinks, wiped smears, fingerprints and a few deep
// ### scratches lie on top and scatter the light. You see yourself in it, hazy: a figure of inmate 4471 (head, striped
// ### uniform, arms) stands where you stand only while the mirror's picture is drawn, and your own hands are drawn into
// ### that picture from where they really are. The picture is only redrawn while the mirror is in view, and at most 20
// ### times a second while you stand still at the sinks (5 from further away).
const MIRROR = (() => {
  const P0 = new THREE.Vector3(-3.985, 1.6, 0), N = new THREE.Vector3(1, 0, 0), SIZE = [2.2, .72];
  const mrnd = mulberry32(1356);   // its own random numbers, so the rest of the room keeps its look
  const rt = new THREE.WebGLRenderTarget(16, 16, { encoding: THREE.sRGBEncoding, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const texMat = new THREE.Matrix4(), glow = new THREE.Color(0);
  // ### What lies on the steel (rgb its colour, alpha how much): dull, milky edges where the polish has gone, rings of
  // ### limescale and drips splashed up from the two sinks (most of them low down), wiped smears, greasy fingerprints
  // ### near the edges and a few deep scratches. The sinks are at u = 0.2 and 0.8.
  const dirt = canvasTex(1024, 336, (g, w, h) => {
    const edge = (x0, y0, x1, y1, a) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(200,204,198,${a})`); gr.addColorStop(1, 'rgba(200,204,198,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    edge(0, 0, 0, 30, .3); edge(0, h, 0, h - 70, .5); edge(0, 0, 36, 0, .32); edge(w, 0, w - 36, 0, .32);
    for (let i = 0; i < 560; i++){
      const near = mrnd() < .7, x = near ? (mrnd() < .5 ? .2 : .8) * w + (mrnd() - .5) * w * .32 : mrnd() * w;
      const y = h - Math.pow(mrnd(), 1.8) * h * .9, r = .8 + mrnd() * mrnd() * 6, a = .16 + mrnd() * .3;
      g.strokeStyle = `rgba(234,236,228,${a})`; g.lineWidth = .7 + mrnd(); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      g.fillStyle = `rgba(222,226,218,${a * .35})`; g.fill();
      if (mrnd() < .12) g.fillRect(x - .6, y, 1.2, 6 + mrnd() * 28);   // a drop that ran down
    }
    g.lineCap = 'round';
    for (let i = 0; i < 7; i++){   // wiped with a sleeve: a few broad arcs
      const r = 70 + mrnd() * 120, a = .05 + mrnd() * .06;
      g.save(); g.translate(mrnd() * w, h * (.25 + mrnd() * .55)); g.rotate((mrnd() - .5) * .8);
      for (let k = 0; k < 5; k++){ g.strokeStyle = `rgba(210,212,204,${a})`; g.lineWidth = 5 + mrnd() * 9; g.beginPath(); g.arc(0, r + k * 6, r + k * 6, -Math.PI / 2 - .55, -Math.PI / 2 + .55); g.stroke(); }
      g.restore();
    }
    for (let i = 0; i < 10; i++){   // fingerprints where hands steady themselves on the edge
      const x = (mrnd() < .5 ? mrnd() * .1 : 1 - mrnd() * .1) * w, y = h * (.3 + mrnd() * .6), t = mrnd();
      g.strokeStyle = 'rgba(196,194,186,.13)'; g.lineWidth = .9;
      for (let r = 2; r < 10; r += 1.5){ g.beginPath(); g.ellipse(x, y, r * .72, r, t, 0, 7); g.stroke(); }
    }
    for (let i = 0; i < 26; i++){   // deep scratches catch the light
      const x = mrnd() * w, y = mrnd() * h, l = 20 + mrnd() * 170, a = (mrnd() - .5) * 1.2;
      g.strokeStyle = `rgba(252,252,248,${.2 + mrnd() * .35})`; g.lineWidth = .7 + mrnd() * .6;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l / 2 + (mrnd() - .5) * 12, y + Math.sin(a) * l / 2 + (mrnd() - .5) * 12, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { tRefl: { value: rt.texture }, tWear: { value: SCAN('steel-scratches-rough.jpg', false) }, tDirt: { value: dirt }, texMat: { value: texMat }, glow: { value: glow } },
    vertexShader: `
      uniform mat4 texMat; varying vec4 vProj; varying vec2 vUv;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vUv = uv; vProj = texMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D tRefl, tWear, tDirt; uniform vec3 glow; varying vec4 vProj; varying vec2 vUv;
      vec3 tap(vec4 p, vec2 o){ return sRGBToLinear(texture2DProj(tRefl, p + vec4(o * p.w, 0.0, 0.0))).rgb; }
      void main(){
        // the sheet bows a little between its screws, so the picture wavers
        vec2 bow = vec2(sin(vUv.x * 19.0 + 1.3) * 0.6 + sin(vUv.x * 47.0 + vUv.y * 9.0) * 0.25, sin(vUv.y * 9.0 + vUv.x * 7.0) * 0.5 + sin(vUv.x * 31.0) * 0.2) * 0.0022;
        vec4 p = vProj; p.xy += bow * p.w;
        // never sharp: blurred more where the scanned scratches say the steel is worn
        float wear = clamp((texture2D(tWear, vUv * vec2(3.05, 1.0)).r - 0.2) * 5.0, 0.0, 1.0);
        // (a spiral of taps, turned differently at every pixel, so the blur is smooth grain; wider across, as polishing
        // leaves its marks along the sheet)
        float r = 0.0022 + wear * 0.005, spin = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
        vec3 c = vec3(0.0);
        for (int i = 0; i < 12; i++){ float k = (float(i) + 0.5) / 12.0, a = float(i) * 2.39996 + spin; c += tap(p, vec2(cos(a) * 1.6, sin(a) * 0.75) * sqrt(k) * r) / 12.0; }
        // steel gives back about 60 % of the light, a little cool, and less where it is worn dull
        c *= vec3(0.6, 0.63, 0.65) * (1.08 - wear * 0.3);
        // limescale, smears and scratches scatter the light: there the picture is a wide, pale blur
        vec4 d = texture2D(tDirt, vUv); d.rgb = sRGBToLinear(vec4(d.rgb, 1.0)).rgb;
        vec3 wide = (tap(p, vec2(0.018, 0.0)) + tap(p, vec2(-0.018, 0.0)) + tap(p, vec2(0.0, 0.022)) + tap(p, vec2(0.0, -0.022))) * 0.25;
        c = mix(c, wide * d.rgb * 0.75 + 0.004, d.a);
        gl_FragColor = linearToOutputTexel(vec4(c + glow, 1.0));
      }`
  });
  mat.emissive = glow;   // hover() lights a hotspot through its emissive colour; here that colour is a uniform

  // ### The figure in the mirror, built the first time the mirror is drawn: a head with a painted face (a buzz cut, brows,
  // ### eyes, nose, mouth and stubble round a sphere whose u = 0.75 looks forward), ears and a nose, the neck, a chest in
  // ### the striped uniform with its number patch, the shoulders and the upper arms down to the elbows of your real arms.
  function buildSelf(){
    const frnd = mulberry32(4472), g = new THREE.Group(); g.visible = false; scene.add(g);
    const SKIN = '#b4846a', face = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = SKIN; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++){ const x = frnd() * w, y = frnd() * h, r = 8 + frnd() * 30, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, frnd() < .5 ? 'rgba(150,80,60,.12)' : 'rgba(225,180,150,.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
      // stubble round the mouth and along the jaw, then the buzz cut, low at the nape and high at the forehead
      for (let i = 0; i < 2600; i++){ const u = .58 + frnd() * .34, v = .6 + frnd() * .32; if (Math.abs(u - .75) > .1 + (v - .6) * .3 && v < .8) continue; c.fillStyle = `rgba(48,38,32,${.12 + frnd() * .2})`; c.fillRect(u * w, v * h, 1.2, 1.2); }
      for (let x = 0; x < w; x++){
        const d = Math.min(Math.abs(x / w - .75), 1 - Math.abs(x / w - .75)) / .5, end = (.27 + Math.pow(d, 1.3) * .36) * h;
        const gr = c.createLinearGradient(0, end - 6, 0, end); gr.addColorStop(0, 'rgba(40,31,24,.82)'); gr.addColorStop(1, 'rgba(40,31,24,0)');
        c.fillStyle = 'rgba(40,31,24,.82)'; c.fillRect(x, 0, 1, end - 6); c.fillStyle = gr; c.fillRect(x, end - 6, 1, 6);
      }
      for (let i = 0; i < 3000; i++){ const x = frnd() * w, y = frnd() * h * .6; c.fillStyle = frnd() < .5 ? 'rgba(20,15,12,.25)' : 'rgba(180,140,115,.12)'; c.fillRect(x, y, 1, 1); }
      for (const s of [-1, 1]){
        const x = (.75 + s * .068) * w, y = .544 * h;
        let gr = c.createRadialGradient(x, y, 0, x, y, 20); gr.addColorStop(0, 'rgba(70,40,30,.5)'); gr.addColorStop(1, 'rgba(70,40,30,0)');
        c.save(); c.translate(x, y); c.scale(1, .55); c.translate(-x, -y); c.fillStyle = gr; c.fillRect(x - 20, y - 20, 40, 40); c.restore();   // the socket
        c.fillStyle = 'rgba(222,212,200,.9)'; c.beginPath(); c.ellipse(x, y, 12, 4.2, 0, 0, 7); c.fill();
        c.fillStyle = '#3a2a1e'; c.beginPath(); c.ellipse(x - s * 1.5, y, 4.6, 3.6, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(50,30,22,.8)'; c.lineWidth = 1.6; c.beginPath(); c.ellipse(x, y + 1, 12.5, 5, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();   // the upper lid
        c.strokeStyle = 'rgba(40,31,24,.85)'; c.lineWidth = 4; c.beginPath(); c.moveTo(x - 15, y - 13); c.quadraticCurveTo(x, y - 19 + s, x + 15, y - 14); c.stroke();   // the brow
      }
      const nx = .75 * w;
      c.strokeStyle = 'rgba(110,62,46,.35)'; c.lineWidth = 2; for (const s of [-1, 1]){ c.beginPath(); c.moveTo(nx + s * 7, .56 * h); c.lineTo(nx + s * 9, .655 * h); c.stroke(); }
      c.fillStyle = 'rgba(60,30,24,.7)'; for (const s of [-1, 1]){ c.beginPath(); c.ellipse(nx + s * 6, .668 * h, 3, 1.8, 0, 0, 7); c.fill(); }
      c.fillStyle = 'rgba(150,80,70,.6)'; c.beginPath(); c.ellipse(nx, .748 * h, 11, 3, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(80,38,32,.85)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(nx - 13, .738 * h); c.quadraticCurveTo(nx, .732 * h, nx + 13, .738 * h); c.stroke();
      const jaw = c.createLinearGradient(0, .8 * h, 0, h); jaw.addColorStop(0, 'rgba(60,35,25,0)'); jaw.addColorStop(1, 'rgba(60,35,25,.45)'); c.fillStyle = jaw; c.fillRect(0, .8 * h, w, .2 * h);
    });
    const skin = new THREE.MeshStandardMaterial({ map: face, roughness: .6, envMapIntensity: .3 });
    const plain = new THREE.MeshStandardMaterial({ color: new THREE.Color(SKIN).convertSRGBToLinear(), roughness: .6, envMapIntensity: .3 });
    const cloth = HAND_MAT.sleeve.clone();
    cloth.map = HAND_MAT.sleeve.map.clone(); cloth.map.repeat.set(2, 4.2); cloth.map.needsUpdate = true;   // (the linen's normal and roughness maps follow the map's repeat)
    const mesh = (geo, m, parent) => { const o = new THREE.Mesh(geo, m); (parent || g).add(o); return o; };
    // the head turns with the camera; the eyes are its origin
    const head = new THREE.Group(); head.rotation.order = 'YXZ'; g.add(head);
    const skull = new THREE.SphereGeometry(1, 32, 24), sp = skull.attributes.position;
    for (let i = 0; i < sp.count; i++){ const y = sp.getY(i), k = y < 0 ? 1 - .2 * Math.min(1, -y * 1.3) : 1; sp.setXYZ(i, sp.getX(i) * k * .078, y * .108, sp.getZ(i) * (y < 0 ? 1 + .06 * y : 1) * .098); }
    skull.computeVertexNormals();
    mesh(skull, skin, head).position.set(0, .015, .075);
    mesh(new THREE.ConeGeometry(.014, .042, 10).rotateX(-Math.PI / 2 - .35), plain, head).position.set(0, -.036, -.03);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(1, 12, 10).scale(.013, .031, .021), plain, head).position.set(s * .077, -.02, .085);
    // the body turns with the head, a little behind it; the eyes are its origin too
    const body = new THREE.Group(); g.add(body);
    mesh(new THREE.CylinderGeometry(.05, .055, .12, 16), plain, body).position.set(0, -.14, .082);
    const chest = plainColours(new THREE.LatheGeometry([[.0, -.62], [.15, -.62], [.165, -.5], [.17, -.35], [.18, -.2], [.19, -.1], [.18, -.05], [.14, -.02], [.075, 0], [.065, .006]].map(([r, y]) => new THREE.Vector2(r, y)), 28).scale(1, 1, .62));
    mesh(chest, cloth, body).position.set(0, -.2, .075);
    const patch = mesh(new THREE.PlaneGeometry(.1, .05), new THREE.MeshStandardMaterial({ roughness: .9, map: canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = '#d8d2bf'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d1c1a'; c.font = '800 44px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('4471', w / 2, h * .78);
      c.fillStyle = 'rgba(90,70,40,.18)'; c.fillRect(0, h * .7, w, h * .3);
    }) }), body);
    patch.position.set(-.085, -.35, -.032); patch.rotation.y = Math.PI + .35;
    // the arms: shoulder, upper arm and elbow; a forearm and a fist only stand in while your real hands are out of sight
    const limb = (r0, r1) => plainColours(new THREE.CylinderGeometry(r1, r0, 1, 14, 1, true).translate(0, .5, 0));
    const shoulder = [], upper = [], elbow = [], fore = [], fist = [];
    for (let i = 0; i < 2; i++){
      shoulder.push(mesh(plainColours(new THREE.SphereGeometry(.056, 14, 10)), cloth));
      upper.push(mesh(limb(.05, .044), HAND_MAT.sleeve));
      elbow.push(mesh(plainColours(new THREE.SphereGeometry(.045, 12, 8)), HAND_MAT.sleeve));
      fore.push(mesh(limb(.043, .038), HAND_MAT.sleeve));
      fist.push(mesh(new THREE.SphereGeometry(1, 12, 8).scale(.042, .05, .03), plain));
    }
    return { g, head, body, shoulder, upper, elbow, fore, fist, elbowAt: [new THREE.Vector3(), new THREE.Vector3()], yaw: cam.yaw };
  }
  const _s = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4();
  // ### Stretches a limb mesh (its own y from 0 to 1) from a to b.
  const reach = (m, a, b) => { const len = a.distanceTo(b); m.position.copy(a); m.quaternion.setFromUnitVectors(_y.set(0, 1, 0), _e.subVectors(b, a).divideScalar(len || 1)); m.scale.set(1, len, 1); };
  // ### Puts the figure where you stand: the head exactly as you look, the body turning after it, and each arm bent at
  // ### the elbow from the shoulder to where your real hand is (hanging down when your hands are out of sight).
  function poseSelf(me, eye, dt){
    me.yaw += wrapAngle(cam.yaw - me.yaw) * (1 - Math.exp(-dt * 2.5));
    me.head.position.copy(eye); me.head.rotation.set(clamp(cam.pitch, -.7, .5) * .85, -cam.yaw, camera.rotation.z);
    me.body.position.copy(eye); me.body.rotation.set(0, -me.yaw, 0); me.body.updateMatrixWorld(true);
    const c = Math.cos(me.yaw), s = Math.sin(me.yaw);
    ['r', 'l'].forEach((key, i) => {
      const h = HANDS[key], side = key === 'r' ? 1 : -1, shown = h.arm.visible;
      me.body.localToWorld(_s.set(side * .19, -.235, .075));
      if (shown) _w.copy(h.p).applyMatrix4(camera.matrixWorld);
      else me.body.localToWorld(_w.set(side * .22, -.8, .02));
      // the elbow bends out, down and back (the pole: right * side, down, behind)
      me.elbowAt[i].copy(twoBone(_s, _w, UPPER_ARM, FOREARM, new THREE.Vector3(c * side * .8 - s * .3, -1, s * side * .8 + c * .3)));
      me.shoulder[i].position.copy(_s); me.elbow[i].position.copy(me.elbowAt[i]); reach(me.upper[i], _s, me.elbowAt[i]);
      me.fore[i].visible = me.fist[i].visible = !shown;
      if (!shown){ reach(me.fore[i], me.elbowAt[i], _w); me.fist[i].position.copy(_w); }
      if (SELF) posed[i] = { wrist: _w.clone(), shown };
    });
    if (SELF) poseReal(me, eye, posed);
  }
  // ### The real figure in the mirror (SELF): its eyes where yours are, the head turned as you look, the body after it;
  // ### each arm reaches from the shoulder to where your real hand is, or hangs at your side while your hands are out of
  // ### sight (then its own hands show). The elbows it finds are where your real forearms are bent to in the picture.
  const posed = [], _ey = new THREE.Vector3();
  function poseReal(me, eye, arms){
    const I = SELF, by = I.by, sc = I.g.scale.x, fwd = _ey.set(Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    I.reset();
    I.g.rotation.set(0, Math.PI - me.yaw, 0);
    I.g.position.copy(eye).addScaledVector(fwd, -.131 * sc); I.g.position.y -= 1.69 * sc;
    I.g.updateWorldMatrix(true, true);
    const pitch = clamp(cam.pitch, -.7, .5), turnY = clamp(wrapAngle(me.yaw - cam.yaw), -1.2, 1.2);
    by.neck02.quaternion.setFromEuler(new THREE.Euler(-pitch * .4, turnY * .4, 0, 'YXZ'));
    by.head.quaternion.setFromEuler(new THREE.Euler(-pitch * .6, turnY * .6, 0, 'YXZ'));
    let hands = false;
    ['R', 'L'].forEach((s, i) => {
      const a = arms[i], side = s === 'R' ? -1 : 1;
      I.limb(by['upperarm01.' + s], by['lowerarm01.' + s], by['wrist.' + s], a.wrist, _e.set(side, -1, -.3).applyQuaternion(I.g.quaternion));
      by['lowerarm01.' + s].getWorldPosition(me.elbowAt[i]);
      I.curl(s, .35, .25); hands = hands || !a.shown;
    });
    I.show(['skinArm'], hands);
    I.g.updateWorldMatrix(true, true);
  }
  // ### Your real hands, drawn into the mirror's picture: for that one picture each forearm is turned from the wrist to
  // ### the figure's elbow and its sleeve cut to that length, then everything is put back as it was.
  const keep = [];
  function bendArms(me, on){
    ['r', 'l'].forEach((key, i) => {
      const a = HANDS[key].arm, sleeves = a.children.filter(o => o.material === HAND_MAT.sleeve);
      if (!on){ a.quaternion.copy(keep[i].q); sleeves.forEach((o, k) => { o.scale.z = keep[i].z[k]; }); return; }
      keep[i] = { q: a.quaternion.clone(), z: sleeves.map(o => o.scale.z) };
      const elbowC = _e.copy(me.elbowAt[i]).applyMatrix4(camera.matrixWorldInverse);
      _m.lookAt(elbowC, a.position, _y.set(0, 1, 0).transformDirection(camera.matrixWorldInverse)); a.quaternion.setFromRotationMatrix(_m);
      const fl = elbowC.distanceTo(a.position) / .485;
      sleeves.forEach(o => { o.scale.z = fl; });
    });
  }

  const mcam = new THREE.PerspectiveCamera(), handCamM = new THREE.PerspectiveCamera(); handCamM.matrixAutoUpdate = false;
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), box = new THREE.Box3().setFromCenterAndSize(P0, new THREE.Vector3(.04, SIZE[1], SIZE[0]));
  const camPos = new THREE.Vector3(), view = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2(), lastView = new THREE.Matrix4();
  let lastT = -1, me = null;
  const api = {
    P0, SIZE, mat, rt,
    hide: [],   // the mirror itself and the steam on it, which must not show in their own picture
    resize(){ renderer.getDrawingBufferSize(size); const k = COARSE ? .35 : .45; rt.setSize(Math.max(1, size.x * k | 0), Math.max(1, size.y * k | 0)); lastT = -1; },
    // ### Draws the mirror's picture again when the mirror is in view and you stand in front of it, and the view has
    // ### changed or a twentieth of a second has passed (your hands and the steam move even while you stand still; from
    // ### further away than the sinks, a fifth of a second).
    update(t){
      if (camera.position.y < .1) return;
      camPos.setFromMatrixPosition(camera.matrixWorld);
      if (camPos.x < P0.x + .05) return;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
      if (!frustum.intersectsBox(box)) return;
      const still = camera.matrixWorld.elements.every((v, i) => Math.abs(v - lastView.elements[i]) < 1e-4);
      if (lastT >= 0 && still && t - lastT < (camPos.x < P0.x + 2.6 ? .05 : .2)) return;
      const dt = lastT >= 0 ? Math.min(.25, t - lastT) : 1;
      lastView.copy(camera.matrixWorld); lastT = t;
      // the mirrored camera (three.js Reflector, for the plane x = -3.985 facing into the room)
      view.subVectors(P0, camPos).reflect(N).negate().add(P0);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      look.subVectors(P0, look).reflect(N).negate().add(P0);
      mcam.position.copy(view); mcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(N);
      mcam.lookAt(look); mcam.far = camera.far; mcam.updateMatrixWorld();
      mcam.projectionMatrix.copy(camera.projectionMatrix);
      texMat.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(mcam.projectionMatrix).multiply(mcam.matrixWorldInverse);
      // oblique near plane: the camera sees nothing behind the mirror
      plane.setFromNormalAndCoplanarPoint(N, P0).applyMatrix4(mcam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = mcam.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
      // you, where you stand, then your hands drawn into the same picture from where they are
      if (!me) me = buildSelf();
      poseSelf(me, camPos, dt);
      for (const o of api.hide) o.visible = false;
      const own = INMATE && INMATE.g.visible; if (own) INMATE.g.visible = false;
      (SELF ? SELF.g : me.g).visible = true;
      renderer.setRenderTarget(rt); renderer.render(scene, mcam);
      (SELF ? SELF.g : me.g).visible = false; if (own) INMATE.g.visible = true;
      if (HANDS.r.arm.visible){
        handCamM.matrix.multiplyMatrices(camera.matrixWorldInverse, mcam.matrixWorld); handCamM.matrixWorldNeedsUpdate = true;
        handCamM.projectionMatrix.copy(mcam.projectionMatrix); handCamM.projectionMatrixInverse.copy(mcam.projectionMatrix).invert();
        bendArms(me, true);
        const body = ME && ME.g.visible;   // the figure above already is your body in the mirror
        if (body) ME.g.visible = false;
        renderer.autoClear = false; renderer.render(handScene, handCamM); renderer.autoClear = true;
        if (body) ME.g.visible = true;
        bendArms(me, false);
      }
      renderer.setRenderTarget(null);
      for (const o of api.hide) o.visible = true;
    }
  };
  return api;
})();

// ---------- The washroom ----------
// ### The room is 8 m wide (x -4..4), 6 m deep (z -3..3) and 3 m high. The steel door is in the south wall, the sinks on the
// ### west wall, the toilet stall in the north-east corner with the hatch in its floor, the mop in the south-east corner.
const W = 8, D = 6, H = 3, TILE_H = 1.8;
const add = (mesh, parent = room) => { mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m); };
const cyl = (rt, rb, h, mat, x, y, z, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return add(m); };
const plane = (w, h, mat, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; room.add(m); return m; };
// ### Decals that lie flat on the floor: soft shadows, stains and puddles.
const flat = (w, d, mat, x, z, y = .003) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); room.add(m); return m; };
// ### A rectangle with rounded corners, added to a shape or path (for extruded parts).
function roundedRect(s, x0, y0, x1, y1, r){
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
}
// ### A soft shadow along the line where two surfaces meet: dark at the edge (pos), fading towards fade, facing normal.
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function aoEdge(len, w, pos, fade, normal){
  const g = new THREE.PlaneGeometry(len, w); g.translate(0, -w / 2, 0);
  const y = fade.clone().negate(), x = new THREE.Vector3().crossVectors(y, normal);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, normal).setPosition(pos));
  room.add(new THREE.Mesh(g, M.ao));
}
const HOT = {};   // hotspot key -> meshes that can be clicked
// ### Registers a clickable object (a hotspot) for the marker and the rules.
const hot = (key, ...meshes) => { (HOT[key] = HOT[key] || []).push(...meshes); meshes.forEach(m => { if (m.material !== M.steam) m.material = m.material.clone(); m.userData.hot = key; }); };

// ### A wall: green tiles up to 1.8 m, a dark green cap tile, cream blocks above, and its own coat of stains. runs are
// ### [metres from the wall's left end as seen from the room, height] of pipe brackets and shower heads that rust or drip.
// ### gaps lists where the trim on top of the tiles stops, as [from, to] in metres along the wall (u, as in wallStains):
// ### a mirror hung on the wall interrupts it, the trim is never laid across the front of it.
function wall(len, x, z, ry, runs, corners, gaps = []){
  const st = wallStains(len, runs, corners);
  plane(len, TILE_H, stained(M.tiles(len), st, 0, TILE_H / H), x, TILE_H / 2, z, ry);
  plane(len, H - TILE_H, stained(blockMat(len, H - TILE_H), st, TILE_H / H, 1), x, TILE_H + (H - TILE_H) / 2, z, ry);
  let from = 0;
  for (const [a, b] of [...gaps, [len, len]]){
    if (a - from > .001){
      const c = (from + a) / 2 - len / 2;   // the piece's middle, from the middle of the wall
      const trim = box(a - from, .05, .03, M.cove, x + Math.cos(ry) * c + Math.sin(ry) * .015, TILE_H, z - Math.sin(ry) * c + Math.cos(ry) * .015);
      trim.rotation.y = ry;
    }
    from = b;
  }
}
// ### Lays a wall's stain picture over the tiles or the blocks (v0..v1 is the part of the picture that surface shows): the
// ### colour is mixed towards the stain by its alpha, and stained glaze turns matt. That is one more texture read per
// ### pixel, where a see-through layer over every wall would have lit each pixel of wall twice.
function stained(m, tex, v0, v1){
  const u = { stainMap: { value: tex }, stainV: { value: new THREE.Vector2(v0, v1 - v0) } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform vec2 stainV;\nvarying vec2 vStainUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vStainUv = vec2(uv.x, stainV.x + uv.y * stainV.y);');
    sh.fragmentShader = 'uniform sampler2D stainMap;\nvarying vec2 vStainUv;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n  vec4 stainC = sRGBToLinear(texture2D(stainMap, vStainUv));\n  diffuseColor.rgb = mix(diffuseColor.rgb, stainC.rgb, stainC.a);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.95, stainC.a);');
  };
  return m;
}
// ### Rust, water and dirt over a whole wall, one picture per wall so nothing repeats: brown runs from the old leaks in
// ### the ceiling and under every pipe bracket, a dirty tide line where the tiles end with grime washed down from it,
// ### limescale under the showers, dirt rising from the floor and mould in the corners (corners says at which end of the
// ### wall the room has one; the walls beside the door have one only). Laid over the wall by stained().
function wallStains(len, runs = [], corners = [true, true]){
  const PX = COARSE ? 80 : 128;
  const tex = canvasTex(Math.round(len * PX), H * PX, (g, w) => {
    const Y = m => (H - m) * PX;   // metres above the floor -> pixels from the top
    // a run: soft blobs down a wobbling line, thinner and fainter as the water dried on its way down
    const run = (u, top, length, width, rgb, a) => {
      let cx = u * PX; const steps = Math.max(2, Math.ceil(length * PX / 2));
      for (let k = 0; k < steps; k++){
        const t = k / steps, r = Math.max(.6, width * PX * (1 - t * .55) * (.6 + rnd() * .5));
        cx += (rnd() - .5) * 1.1;
        g.fillStyle = `rgba(${rgb},${a * (1 - t * t)})`; g.beginPath(); g.ellipse(cx, Y(top) + k * 2, r, r * 1.8, 0, 0, 7); g.fill();
      }
    };
    const blot = (cx, cy, r, rgb, a) => { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); };
    // water stains yellowing the blocks, and the leaks in the ceiling that caused them
    for (let i = 0; i < len * 1.6; i++) blot(rnd() * w, Y(2.2 + rnd() * .8), (.15 + rnd() * .45) * PX, '140,98,42', .14 + rnd() * .14);
    for (let i = 0; i < len * 1.2; i++){ const u = rnd() * len; run(u, H, .4 + rnd() * 1.4, .02 + rnd() * .05, '112,64,26', .045); if (rnd() < .5) run(u + (rnd() - .5) * .1, H, .3 + rnd() * .8, .008, '80,44,18', .05); }
    // rust under the brackets and pipes, and wet streaks or limescale below the shower heads
    for (const [u, top, kind] of runs){
      if (kind === 'shower'){ for (let k = 0; k < 6; k++) run(u + (rnd() - .5) * .3, top, .5 + rnd() * 1.1, .01 + rnd() * .025, '214,214,196', .045); }
      else for (let k = 0; k < 3; k++) run(u + (rnd() - .5) * .06, top, .5 + rnd() * .9, .008 + rnd() * .018, '128,58,18', .06);
    }
    // the tide line at the top of the tiles, with dirt washed down the glaze from it
    for (let i = 0; i < len * 30; i++) blot(rnd() * w, Y(TILE_H - .02 - Math.pow(rnd(), 2) * .2), (.03 + rnd() * .1) * PX, '72,60,30', .08);
    for (let i = 0; i < len * 2.5; i++) run(rnd() * len, TILE_H - .03, .2 + rnd() * .9, .01 + rnd() * .03, '60,54,30', .04);
    // dirt and splashes rising from the floor
    const fg = g.createLinearGradient(0, Y(.5), 0, Y(0)); fg.addColorStop(0, 'rgba(40,32,18,0)'); fg.addColorStop(.7, 'rgba(40,32,18,.22)'); fg.addColorStop(1, 'rgba(30,24,14,.5)');
    g.fillStyle = fg; g.fillRect(0, Y(.5), w, .5 * PX);
    for (let i = 0; i < len * 40; i++) blot(rnd() * w, Y(Math.pow(rnd(), 2) * .45), (.02 + rnd() * .07) * PX, '38,30,16', .12);
    // mould creeping out of the room's corners: thick in the corner under the ceiling, thinning out along the ceiling
    // and down the joint
    corners.forEach((on, k) => {
      if (!on) return;
      for (let i = 0; i < 90; i++){
        const along = Math.pow(rnd(), 2.2), down = Math.pow(rnd(), 2.2), fade = 1 - Math.max(along, down) * .85;
        blot(k ? w - along * .9 * PX : along * .9 * PX, Y(H) + down * 1.5 * PX * (1 - along * .7), (.02 + rnd() * .06) * PX, '30,36,24', .28 * fade);
      }
    });
  });
  tex.anisotropy = 4;
  return tex;
}
{ // floor with an opening where the hatch is (shape coordinates are metres; y of the shape becomes -z in the room)
  const fs = new THREE.Shape(); fs.moveTo(-W / 2, -D / 2); fs.lineTo(W / 2, -D / 2); fs.lineTo(W / 2, D / 2); fs.lineTo(-W / 2, D / 2); fs.lineTo(-W / 2, -D / 2);
  const hp = new THREE.Path(), hx = 2.2, hz = 1.75, hh = .37; hp.moveTo(hx - hh, hz - hh); hp.lineTo(hx - hh, hz + hh); hp.lineTo(hx + hh, hz + hh); hp.lineTo(hx + hh, hz - hh); hp.lineTo(hx - hh, hz - hh); fs.holes.push(hp);
  // the scanned concrete: one picture covers 2 m of floor (the shape's uv are metres), brightened to the room's grey
  const fm = new THREE.MeshStandardMaterial({ map: SCAN('floor-concrete-color.jpg', true, .5, .5), normalMap: SCAN('floor-concrete-normal.jpg', false, .5, .5),
    roughnessMap: SCAN('floor-concrete-rough.jpg', false, .5, .5, 4), roughness: .95, envMapIntensity: .5 });
  fm.color.setRGB(1.75, 1.85, 1.9);
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(fs), fm);
  fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; room.add(fl);
}
plane(W, D, M.ceiling, 0, H, 0, 0, Math.PI / 2);
wall(W, 0, -D / 2, 0, [1, 3, 5, 7].map(u => [u, 2.72]));            // north, rust under the pipe brackets
// south (door wall), built around the doorway so the open door shows the corridor in the briefing
wall(3.45, -2.275, D / 2, Math.PI, [], [false, true]); wall(3.45, 2.275, D / 2, Math.PI, [], [true, false]);
plane(1.1, H - 2.14, blockMat(1.1, H - 2.14), 0, 2.14 + (H - 2.14) / 2, D / 2, Math.PI);
wall(D, -W / 2, 0, Math.PI / 2, [[1.5, 2.72], [4.5, 2.72]], undefined, [[D / 2 - 1.14, D / 2 + 1.14]]);  // west (sinks), rust where the pipes turn down; the trim stops at the mirror's backing plate
wall(D, W / 2, 0, -Math.PI / 2, [[3.45, 1.98, 'shower'], [4.55, 1.98, 'shower']]);  // east, under the shower heads
// skirting drain channel and floor drain
cyl(.12, .12, .01, M.dark, 0, .006, .3, 24);
for (let i = -2; i <= 2; i++) box(.22, .012, .012, M.dullSteel, 0, .012, .3 + i * .045);

// Pipes along the ceiling and down to the sinks
const pipe = (len, x, y, z, axis) => { const p = cyl(.045, .045, len, M.pipe, x, y, z, 12); if (axis === 'x') p.rotation.z = Math.PI / 2; if (axis === 'z') p.rotation.x = Math.PI / 2; return p; };
pipe(W, 0, 2.78, -2.88, 'x'); pipe(W, 0, 2.66, -2.9, 'x'); pipe(D, -3.9, 2.78, 0, 'z');
pipe(1.9, -3.92, 1.85, -1.5); pipe(1.9, -3.92, 1.85, 1.5);
for (const x of [-3, -1, 1, 3]) box(.06, .12, .1, M.dullSteel, x, 2.78, -2.9);

// Lights: the caged tube in the middle (an old warm-white tube), a lamp over the stall, corridor light through the window
// and two red emergency lamps (below)
const hemi = new THREE.HemisphereLight(0xb4a292, 0x1e1410, .3); room.add(hemi);
const mainLight = new THREE.SpotLight(0xffdcbc, 3.2, 14, 1.3, .65, 1.6);
mainLight.position.set(-.6, 2.86, .3); mainLight.target.position.set(-.6, 0, .3);
mainLight.castShadow = true; mainLight.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048); mainLight.shadow.bias = -.0005; mainLight.shadow.radius = 4;
room.add(mainLight, mainLight.target);
const stallLight = new THREE.SpotLight(0xffd6a6, 2.1, 7, .95, .7, 1.8);
stallLight.position.set(2.75, 2.86, -1.8); stallLight.target.position.set(2.75, 0, -1.9);
stallLight.castShadow = true; stallLight.shadow.mapSize.set(COARSE ? 512 : 1024, COARSE ? 512 : 1024); stallLight.shadow.bias = -.0008; stallLight.shadow.radius = 3;
room.add(stallLight, stallLight.target);
const windowLight = new THREE.SpotLight(0x9cc4ff, .9, 8, .5, .8, 1.5);
windowLight.position.set(0, 1.7, 3.3); windowLight.target.position.set(0, .6, 0); room.add(windowLight, windowLight.target);
// ### The two fluorescent lamps are built like real ones. The fitting is Poly Haven's scanned "Mounted Fluorescent
// ### Lights" batten (painted sheet steel with its lampholders, models/fluorescent-fitting.glb, CC0); a plain box stands
// ### in until it loads, or if it never does. In it sits an old T12 tube of clear glass: physically based glass (three.js's
// ### MeshPhysicalMaterial with transmission) that lets you see through to everything inside while the room still glints
// ### on its surface. Inside, the glowing gas column stops a few centimetres short of each end, so the electrodes show
// ### there: a glass stem and its pinch, two lead-in wires and a coiled tungsten filament that glows orange. The ends
// ### are aluminium caps with two brass pins, and a guard of bent steel wire (the scanned steel) hangs round the tube.
// ### The gas, the halo and the filaments follow the flickering of each lamp (see "The mood of the lights").
const FLUO = (() => {
  const SX = .885, SYZ = 2.5, R = .00714 * SYZ, AXIS_Y = -.02685 * SYZ;   // the model's tube: .885 m between its holders, centred 26.85 mm down
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: .05, transmission: .96, transparent: true,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.7, reflectivity: .6, clearcoat: .4, clearcoatRoughness: .05 });
  const aluminium = steelMat(0xd6d9da, .85, { envMapIntensity: 1.1 });
  const nickel = new THREE.MeshStandardMaterial({ color: 0x9a9c9c, metalness: 1, roughness: .35, envMapIntensity: 1.2 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a65a, metalness: 1, roughness: .3, envMapIntensity: 1.1 });
  const wire = steelMat(0xb4bcc0, 1.5, { envMapIntensity: 1.1 });
  const housingStandIn = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: .5, metalness: .2 });
  // the gas glows brightest where you look through the middle of the column and fades at its edges and its ends
  const glow = (color, power, fade) => new THREE.ShaderMaterial({
    uniforms: { level: { value: 1 }, tint: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vY = uv.y; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float level; uniform vec3 tint; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float a = pow(abs(dot(normalize(vN), normalize(vV))), ${power.toFixed(2)}) * smoothstep(0.0, ${fade.toFixed(3)}, min(vY, 1.0 - vY)) * level; gl_FragColor = vec4(tint * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const along = (r0, r1, len, seg, mat, x, open = false) => {   // a cylinder along the tube's axis (x)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg, 1, open), mat); m.rotation.z = -Math.PI / 2; m.position.x = x; return m;
  };
  // the coiled filament: a fine helix from one lead-in wire to the other, across the tube
  class Coil extends THREE.Curve {
    constructor(w, r, turns){ super(); this.w = w; this.r = r; this.turns = turns; }
    getPoint(t, out = new THREE.Vector3()){ const a = t * this.turns * Math.PI * 2; return out.set(Math.cos(a) * this.r, Math.sin(a) * this.r, (t - .5) * this.w); }
  }
  const coilGeo = new THREE.TubeGeometry(new Coil(.0105, .0018, 11), 160, .0004, 5, false);
  const lamps = [];
  function build(x, y, z, len, color){
    const g = new THREE.Group(); g.position.set(x, y, z); room.add(g);
    const sx = len / SX, half = len / 2;
    const housing = new THREE.Group(); housing.scale.set(sx, SYZ, SYZ); g.add(housing);
    const standIn = new THREE.Mesh(new THREE.BoxGeometry(.912, .022, .045), housingStandIn); standIn.position.y = -.011; housing.add(standIn);
    const tube = new THREE.Group(); tube.position.y = AXIS_Y; g.add(tube);
    const gas = glow(color, 1.1, .08), halo = glow(color, 3, .2), hot = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: .5, metalness: .6, emissive: 0xff8436, emissiveIntensity: 1.1 });
    const glassLen = len - .05;
    tube.add(along(R, R, glassLen, 40, glass, 0, true));
    const col = along(R * .8, R * .8, glassLen - .19, 24, gas, 0, true); col.renderOrder = 2; tube.add(col);   // the dark space round each electrode
    const hal = along(R * 2.6, R * 2.6, glassLen - .1, 24, halo, 0, true); hal.renderOrder = 3; tube.add(hal);
    for (const s of [-1, 1]){
      const e = new THREE.Group(); e.position.x = s * half; e.scale.x = -s; tube.add(e);   // each end looks inwards along +x
      e.add(along(R * 1.04, R * 1.04, .025, 32, aluminium, .0125));                     // the aluminium cap over the glass
      const face = new THREE.Mesh(new THREE.CircleGeometry(R * 1.04, 32), aluminium); face.rotation.y = -Math.PI / 2; e.add(face);
      for (const pz of [-.00635, .00635]){ const p = along(.0012, .0012, .012, 8, brass, -.004); p.position.z = pz; e.add(p); }   // the two pins (12.7 mm apart)
      e.add(along(R * .62, R * .3, .02, 20, glass, .028));                              // the flared glass stem
      const pinch = new THREE.Mesh(new THREE.BoxGeometry(.008, .004, .014), glass); pinch.position.x = .042; e.add(pinch);
      for (const wz of [-.0052, .0052]){                                               // the two lead-in wires
        const w = new THREE.Mesh(new THREE.CylinderGeometry(.0007, .0007, .026, 6), nickel); w.rotation.z = -Math.PI / 2; w.position.set(.057, 0, wz); e.add(w);
      }
      const coil = new THREE.Mesh(coilGeo, hot); coil.position.x = .07; e.add(coil);
    }
    // the wire guard: bows of steel wire round the tube, tied together by three wires along it
    const guard = new THREE.Group(); guard.position.y = AXIS_Y; g.add(guard);
    const bowR = R + .026, bows = Math.max(3, Math.round(len / .3) + 1);
    const bow = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => { const a = Math.PI * i / 16; return new THREE.Vector3(0, -Math.sin(a) * bowR, Math.cos(a) * bowR); })), 32, .0022, 6, false);
    const at = i => -half + .06 + i * (len - .12) / (bows - 1);
    for (let i = 0; i < bows; i++){
      const b = new THREE.Mesh(bow, wire); b.position.x = at(i); guard.add(b);
      for (const sz of [-1, 1]){ const st = new THREE.Mesh(new THREE.CylinderGeometry(.0022, .0022, -AXIS_Y, 6), wire); st.position.set(at(i), -AXIS_Y / 2, sz * bowR); guard.add(st); }   // up into the batten
    }
    for (const a of [0, Math.PI * .3, Math.PI * .7, Math.PI]){
      const r = along(.0022, .0022, len - .1, 6, wire, 0); r.position.set(0, -Math.sin(a) * bowR, Math.cos(a) * bowR); guard.add(r);
    }
    g.traverse(o => { if (o.isMesh){ o.castShadow = false; o.receiveShadow = o.material !== gas && o.material !== halo; } });
    const lamp = { g, housing, gas, halo, hot, hotI: hot.emissiveIntensity, set(level){ gas.uniforms.level.value = level; halo.uniforms.level.value = level * .22; hot.emissiveIntensity = this.hotI * (.25 + .75 * level); } };
    lamps.push(lamp);
    return lamp;
  }
  // ### Loads the scanned batten and puts it in place of the stand-in boxes; if it fails, the boxes stay.
  function load(){
    loading('fluorescent fitting', fetch('models/fluorescent-fitting.glb').then(glbBytes).then(buf => {
      const { json, acc } = glbParts(buf), prim = json.meshes[0].primitives[0], A = prim.attributes;
      const color = SCAN('fluorescent-fitting-color.jpg', true, 1, 1, 4), normal = SCAN('fluorescent-fitting-normal.jpg', false, 1, 1, 4), arm = SCAN('fluorescent-fitting-arm.jpg', false, 1, 1, 4);
      for (const t of [color, normal, arm]) t.flipY = false;   // glTF pictures are not flipped
      // paint over sheet steel: the scan's colour, its gloss (green), the bare metal of the holders' contacts (blue) and dust in the folds (red)
      const mat = new THREE.MeshStandardMaterial({ map: color, normalMap: normal, roughnessMap: arm, metalnessMap: arm, aoMap: arm, roughness: 1, metalness: 1, envMapIntensity: 1.1, side: THREE.DoubleSide });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(acc(A.POSITION), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(acc(A.NORMAL), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(acc(A.TEXCOORD_0), 2));
      geo.setAttribute('uv2', geo.attributes.uv);
      geo.setIndex(new THREE.BufferAttribute(acc(prim.indices), 1));
      for (const l of lamps){
        while (l.housing.children.length) l.housing.remove(l.housing.children[0]);
        const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; l.housing.add(m);
      }
      shadowsMoved();
    }));
  }
  return { build, load, lamps };
})();
// the caged tube in the middle, an old warm-white T12 (1.2 m), and a shorter one (0.6 m) over the stall
const tube = FLUO.build(-.6, H, .3, 1.2, 0xffe9d2);
const stallTube = FLUO.build(2.75, H, -1.8, .6, 0xffd6a6);
FLUO.load();
plane(1.5, .56, M.sign, -1.9, 2.2, -D / 2 + .012);
// ### Red emergency lamps, as in the photo: caged red domes over the door, over the mirror by the sinks and high in the
// ### stall over the toilet. Each has a soft glow round the glass (the puddles mirror it too). Every light costs time at
// ### every pixel, so only two of them really shine, without shadows: a point light over the door and a spot in the
// ### stall aimed at the toilet (it stays inside the partition). The lamp over the mirror paints its red wash onto the
// ### wall instead. They burn steadily until time runs short (see "The mood of the lights").
const RED_LAMPS = [], RED_WASHES = [];
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,120,90,.9)'); gr.addColorStop(.12, 'rgba(255,50,25,.55)'); gr.addColorStop(.4, 'rgba(200,20,8,.16)'); gr.addColorStop(1, 'rgba(160,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
glowTex.anisotropy = 1;
const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const redGlass = new THREE.MeshStandardMaterial({ color: 0x5a0804, emissive: 0xff2412, emissiveIntensity: 2.6, roughness: .25 });
function redLamp(x, y, z, ry, intensity, reach, aim){
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; room.add(g);
  const part = (geo, mat, px, py, pz, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.set(rx, 0, rz); m.receiveShadow = true; g.add(m); return m; };
  part(new THREE.BoxGeometry(.16, .16, .025), M.dullSteel, 0, 0, .0125);
  part(new THREE.CylinderGeometry(.068, .072, .02, 20), M.dullSteel, 0, 0, .035, Math.PI / 2);
  part(new THREE.SphereGeometry(.058, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), redGlass, 0, 0, .045, Math.PI / 2);
  // the wire cage over the glass: three hoops and a ring
  for (const rz of [0, Math.PI / 3, -Math.PI / 3]) part(new THREE.TorusGeometry(.068, .0035, 4, 12, Math.PI), M.dullSteel, 0, 0, .045, Math.PI / 2, rz).rotation.order = 'ZXY';
  part(new THREE.TorusGeometry(.07, .004, 4, 18), M.dullSteel, 0, 0, .075);
  const glow = new THREE.Sprite(glowMat); glow.position.set(0, 0, .08); glow.scale.setScalar(.55); g.add(glow);
  if (!intensity){   // no light: a soft red wash on the wall round the lamp
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x9a3a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    wash.position.set(0, -.15, .004); g.add(wash); RED_WASHES.push(wash.material);
    return;
  }
  const light = aim ? new THREE.SpotLight(0xff2a14, intensity, reach, .6, .6, 1.5) : new THREE.PointLight(0xff2a14, intensity, reach, 2);
  light.position.set(0, -.08, .3); g.add(light); RED_LAMPS.push({ light, base: intensity });
  if (aim){ light.target.position.set(...aim); room.add(light.target); }
}
redLamp(0, 2.5, D / 2 - .002, Math.PI, 1.8, 6);                       // over the door
redLamp(-W / 2 + .002, 2.32, 0, Math.PI / 2, 0);                      // over the mirror
redLamp(2.2, 2.45, -D / 2 + .002, 0, 4, 5, [3.1, .4, -2.6]);          // in the stall, over the toilet

// ### The mood of the lights. The old tube mostly burns steadily, but now and then it struggles: a few quick dips, and
// ### sometimes it drops out for a moment and stutters back, each time with a tick from its starter. The lamp over the
// ### stall does the same, more rarely. The dips are at least a third of a second apart, so the light never flashes more
// ### than three times a second, and with reduced motion it never flickers at all. Under the tube hangs a faint cone of
// ### light with dust drifting through it. When time runs short the red emergency lamps begin to throb: slowly from two
// ### minutes left, faster in the last minute.
const LIGHTS = { t: 0, tube: 1, stall: 1, red: 0, phase: 0, main: mainLight.intensity, stallI: stallLight.intensity, hemi: hemi.intensity,
  glass: redGlass.emissiveIntensity, handKey: null, handI: 0,
  tubeEp: null, tubeNext: 8 + Math.random() * 8, stallEp: null, stallNext: 30 + Math.random() * 25 };
// ### One bout of flickering: two to five dips, the last one sometimes a longer drop-out before the tube catches again.
function flickerBout(){
  const steps = [], n = 2 + Math.floor(Math.random() * 4);
  let at = 0;
  for (let i = 0; i < n; i++){
    const out = i === n - 1 && Math.random() < .35;
    steps.push({ at, dur: out ? .2 + Math.random() * .25 : .05 + Math.random() * .07, level: out ? .08 : .25 + Math.random() * .4, heard: false });
    at += .34 + Math.random() * .3;
  }
  return { t0: LIGHTS.t, steps, end: at };
}
// ### How bright a lamp is during its bout (1 between the dips), and whether the bout is over.
function boutLevel(ep, vol){
  const tau = LIGHTS.t - ep.t0;
  for (const s of ep.steps) if (tau >= s.at && tau < s.at + s.dur){ if (!s.heard){ s.heard = true; cue(vol); } return s.level; }
  return 1;
}
// the cone of light under the tube: brightest where you look straight through it, fading towards its edges and the floor
const lightCone = (() => {
  const h = 2.84, geo = new THREE.CylinderGeometry(.42, 1.45, h, 40, 1, true);
  const mat = new THREE.ShaderMaterial({
    uniforms: { strength: { value: .07 }, tint: { value: new THREE.Color(0xffe6c8) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vY = uv.y; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float strength; uniform vec3 tint; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float a = pow(abs(dot(normalize(vN), normalize(vV))), 2.0) * pow(vY, 1.6) * strength; gl_FragColor = vec4(tint * a, 1.0); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(-.6, 2.9 - h / 2, .3); m.scale.x = 1.3; m.renderOrder = 3; room.add(m);
  return m;
})();
// dust in the cone: slow motes that only show where the tube lights them
const roomDust = (() => {
  const n = 160, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++){ pos[i * 3] = -.6 + (Math.random() - .5) * 2.4; pos[i * 3 + 1] = .3 + Math.random() * 2.4; pos[i * 3 + 2] = .3 + (Math.random() - .5) * 2; seed[i] = Math.random() * 100; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dot = canvasTex(32, 32, (g, w, h) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: .013, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; room.add(pts);
  return { pts, pos, col, seed, n };
})();
// ### Moves the lights on each frame: the bouts of flickering, the cone and its dust, and the throbbing red lamps.
function updateLights(dt){
  const L = LIGHTS; L.t += dt;
  if (!REDUCED){
    if (!L.tubeEp && L.t > L.tubeNext) L.tubeEp = flickerBout();
    if (!L.stallEp && L.t > L.stallNext) L.stallEp = flickerBout();
  }
  let f = 1, fs = 1;
  if (L.tubeEp){ f = boutLevel(L.tubeEp, 'flicker'); if (L.t - L.tubeEp.t0 > L.tubeEp.end){ L.tubeEp = null; L.tubeNext = L.t + 12 + Math.random() * 22; } }
  if (L.stallEp){ fs = boutLevel(L.stallEp, 'flickerFar'); if (L.t - L.stallEp.t0 > L.stallEp.end){ L.stallEp = null; L.stallNext = L.t + 35 + Math.random() * 40; } }
  // a tube snaps on and off within a few hundredths of a second
  L.tube += (f - L.tube) * Math.min(1, dt * 45); L.stall += (fs - L.stall) * Math.min(1, dt * 45);
  mainLight.intensity = L.main * L.tube; tube.set(L.tube);
  stallLight.intensity = L.stallI * L.stall; stallTube.set(L.stall);
  hemi.intensity = L.hemi * (.5 + .5 * L.tube);   // the room's soft fill comes from the tube too
  if (!L.handKey){ L.handKey = handScene.children.find(o => o.isDirectionalLight); L.handI = L.handKey.intensity; }
  L.handKey.intensity = L.handI * (.25 + .75 * L.tube);
  lightCone.material.uniforms.strength.value = .07 * L.tube * L.tube;
  // the dust drifts and turns in the air; a mote is lit by how close it is to the middle of the cone
  const d = roomDust, p = d.pos, c = d.col, t = L.t;
  for (let i = 0; i < d.n; i++){
    const j = i * 3, s = d.seed[i];
    p[j] += Math.sin(t * .23 + s) * .03 * dt; p[j + 1] += (Math.sin(t * .17 + s * 2) * .02 - .006) * dt; p[j + 2] += Math.cos(t * .19 + s) * .03 * dt;
    if (p[j + 1] < .2) p[j + 1] = 2.7;
    const y = clamp(p[j + 1] / 2.9, 0, 1), r = .42 + (1.45 - .42) * (1 - y), dx = (p[j] + .6) / 1.3, dz = p[j + 2] - .3;
    const b = clamp(1 - Math.hypot(dx, dz) / r, 0, 1) * (.25 + .75 * y) * L.tube * (.6 + .4 * Math.sin(t * 1.3 + s * 5));
    c[j] = b * .55; c[j + 1] = b * .5; c[j + 2] = b * .42;
  }
  d.pts.geometry.attributes.position.needsUpdate = true; d.pts.geometry.attributes.color.needsUpdate = true;
  // the red lamps: steady until two minutes are left, then a slow throb that quickens in the last minute
  const urge = REDUCED || S.ending || S.scene === 'intro' ? 0 : S.time <= 60 ? 1 : S.time <= 120 ? .55 : 0;
  L.red += (urge - L.red) * Math.min(1, dt * .8);
  L.phase += dt * Math.PI * 2 / (2.6 - 1.3 * clamp((L.red - .55) / .45, 0, 1));
  const pulse = 1 + .32 * L.red * Math.sin(L.phase);
  for (const r of RED_LAMPS) r.light.intensity = r.base * pulse;
  redGlass.emissiveIntensity = L.glass * pulse; glowMat.opacity = Math.min(1, pulse);
  for (const w of RED_WASHES) w.opacity = pulse;
}

// The door with its barred window; Officer Hale's silhouette appears in it. It hangs on hinges on the west side (x -0.52)
// and swings into the room; doorPivot turns it. Closed (rotation 0) it is exactly where it always was.
// ### Door and frame are dark steel: a real scanned steel plate (Poly Haven's "Blue Metal Plate", Rob Tuytel, CC0), the
// ### stretch between its seams that fits a door, cut once from the 2k files and greyed (textures/door-steel-*.jpg): old
// ### paint worn thin over the metal, scratches and scuffs that catch the vault reflections, a duller haze where hands
// ### push. The picture spans the leaf from edge to edge; the frame, the hinges and the window frame read the same plate at
// ### their own size (steelUV). Until the three pictures arrive, or if they never do, the plain grey steel of M.door shows.
const doorSteel = (() => {
  const m = M.door.clone(), maps = {}, loader = new THREE.TextureLoader(ASSETS);
  for (const [k, file] of [['map', 'door-steel-color.jpg'], ['normalMap', 'door-steel-normal.jpg'], ['roughnessMap', 'door-steel-rough.jpg']])
    loader.load('textures/' + file, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; if (k === 'map') t.encoding = THREE.sRGBEncoding;
      maps[k] = t;
      if (Object.keys(maps).length < 3) return;
      Object.assign(m, maps, { metalness: .9, roughness: .8, envMapIntensity: 1.4 });
      m.color.setRGB(5.6, 5.8, 6.1); m.normalScale.set(.9, .9); m.needsUpdate = true; shadowsMoved();
    });
  return m;
})();
// a box whose faces show the door's steel at their real size: one picture is the 1.04 x 2.14 m leaf; ou, ov shift it
const steelUV = (geo, w, h, d, ou = 0, ov = 0) => {
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, ou + uv.getX(i) * dims[f][0] / 1.04, ov + uv.getY(i) * dims[f][1] / 2.14);
  return geo;
};
const steelBlock = (w, h, d, x, y, z, ou, ov) => { const m = new THREE.Mesh(steelUV(new THREE.BoxGeometry(w, h, d), w, h, d, ou, ov), doorSteel); m.position.set(x, y, z); return add(m); };
const doorPivot = new THREE.Group(), doorLeaf = new THREE.Group();
doorPivot.position.set(-.52, 0, 2.95); doorLeaf.position.set(.52, 0, -2.95); doorPivot.add(doorLeaf); room.add(doorPivot);
const onDoor = (...ms) => ms.forEach(m => doorLeaf.add(m));
onDoor(steelBlock(1.04, 2.14, .1, 0, 1.07, 2.95));
// the frame: a head and two jambs, with the stop the leaf closes against
steelBlock(1.16, .06, .14, 0, 2.17, 2.95, .1, .3); steelBlock(.06, 2.17, .14, -.55, 1.08, 2.95, .37); steelBlock(.06, 2.17, .14, .55, 1.08, 2.95, .71, .2);
onDoor(plane(.3, .34, M.corridor, 0, 1.68, 2.895, Math.PI));
const guard = plane(.3, .34, M.guard, 0, 1.66, 2.89, Math.PI); onDoor(guard);
for (let i = -1; i <= 1; i++) onDoor(cyl(.008, .008, .34, M.steel, i * .075, 1.68, 2.885, 8));
for (const [w, h, x, y] of [[.36, .03, 0, 1.865], [.36, .03, 0, 1.495], [.03, .4, -.165, 1.68], [.03, .4, .165, 1.68]]) onDoor(steelBlock(w, h, .03, x, y, 2.885, .3 + x, y / 2.14));
const handle = cyl(.022, .022, .16, M.steel, .38, 1.02, 2.86, 10); handle.rotation.z = Math.PI / 2; onDoor(handle);
onDoor(box(.06, .14, .04, M.steel, .44, 1.02, 2.89));
// a lock cylinder in a round escutcheon above the handle
const lockRose = cyl(.026, .028, .012, M.steel, .44, 1.17, 2.895, 16); lockRose.rotation.x = Math.PI / 2; onDoor(lockRose);
onDoor(box(.006, .022, .004, M.dark, .44, 1.17, 2.888));
// three hinges: two leaves on the leaf and the frame and a round knuckle with its pin between them
for (const y of [.35, 1.07, 1.8]){
  const k = cyl(.017, .017, .15, doorSteel, -.52, y, 2.885, 12); onDoor(k);
  onDoor(cyl(.007, .007, .02, M.steel, -.52, y + .085, 2.885, 8), steelBlock(.05, .13, .006, -.485, y, 2.893, .1, y / 2.14));
}
// a brushed steel kick plate along the bottom, where boots have kicked the door for years
onDoor(box(.96, .26, .004, M.worn, 0, .17, 2.898));
hot('wedge', handle);

// The corridor outside and Officer Hale in the doorway. Only seen in the briefing, while he shuts the door on you.
const hallTex = canvasTex(1024, 384, (g, w, h) => {
  g.fillStyle = '#c9d5dc'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5f7383'; g.fillRect(0, h * .55, w, h * .45);
  g.fillStyle = '#e8b13a'; g.fillRect(0, h * .55 - 8, w, 8);
  g.fillStyle = '#26303a'; g.font = '800 54px "Arial Narrow", Arial, sans-serif'; g.fillText('CELL BLOCK D', 40, 120); g.fillText('D-01 → D-24', 640, 120);
  grime(g, w, h, 14, 'rgba(60,70,70,.25)', 90, true);
});
const hallFloorTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h * .3, 4, w / 2, h * .3, w * .7); gr.addColorStop(0, '#b7c3cb'); gr.addColorStop(1, '#4c5962');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// ### Officer Hale in 3D: a prison guard in his fifties, built to look like a real man rather than a toy. His uniform is
// ### a scanned navy wool twill (Poly Haven "Poly Wool Herringbone"), his shirt collar a scanned poplin weave ("Stretch
// ### Poplin"), his boots, duty belt and cap visor scanned leather ("Brown Leather", dyed black here); all three were
// ### fetched once through Poly Haven's free API and are kept in room-1-escape/textures. No free library offers a skin
// ### scan, so his skin is painted in code: a weathered face with grey stubble, a grey moustache, eye bags, crow's feet
// ### and the lines from nose to mouth, round a head shaped from a sphere (brow, cheekbones, jaw and chin). Every part is
// ### smooth-shaded and rounded: a tapered torso and trousers turned on a lathe, shoulders, elbows and knees as joints,
// ### hands with fingers and a thumb. On the uniform: shoulder boards, a breast badge, a name plate, a shoulder radio,
// ### a duty belt with a key ring, a handcuff case and a baton. His left arm hangs, his right arm reaches out to pull the
// ### door shut. haleFade() fades the whole figure in and out.
function buildHale(){
  const hrnd = mulberry32(1912), g = new THREE.Group(), mats = [];
  const mat = o => { const m = new THREE.MeshStandardMaterial(Object.assign({ transparent: true, opacity: 0 }, o)); mats.push(m); return m; };
  // the scanned surfaces; every piece gets planar UVs in metres divided by the size of one scan (see worldUV)
  const scanned = (color, normal, rough, o) => mat(Object.assign({ map: SCAN(color, true), normalMap: SCAN(normal, false), roughnessMap: SCAN(rough, false) }, o));
  const wool = scanned('uniform-wool-color.jpg', 'uniform-wool-normal.jpg', 'uniform-wool-rough.jpg', { roughness: 1, normalScale: new THREE.Vector2(.9, .9), envMapIntensity: .25 });
  wool.color.setRGB(.11, .135, .2);   // the grey scan dyed navy (linear)
  const leather = scanned('leather-color.jpg', 'leather-normal.jpg', 'leather-rough.jpg', { roughness: .75, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .7 });
  leather.color.setRGB(.42, .42, .44);
  const poplin = mat({ color: 0x9db3c8, roughness: .8, normalMap: SCAN('shirt-poplin-normal.jpg', false), normalScale: new THREE.Vector2(.8, .8), envMapIntensity: .2 });
  const tie = mat({ color: 0x15181d, roughness: .55, envMapIntensity: .3 });
  const metal = mat({ color: 0xc9c2a8, roughness: .3, metalness: 1, envMapIntensity: 1.1 });
  const steel = mat({ color: 0xb9bec2, roughness: .35, metalness: 1, envMapIntensity: 1 });
  const plastic = mat({ color: 0x18191b, roughness: .45, envMapIntensity: .4 });
  const SKIN = '#c08c72', skinPlain = mat({ color: SKIN, roughness: .58, envMapIntensity: .25 });
  const hairM = mat({ color: 0x4a4540, roughness: .95, envMapIntensity: .1 });
  const TILE = new Map([[wool, .27], [leather, .4], [poplin, .29]]);
  // ### Planar UVs from the piece's own position, in units of one scan: u runs across the front and round the sides
  // ### (x + z), v up the figure, so the weave keeps its real size on every part, whatever its shape.
  const worldUV = (geo, tile) => {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++){
      const side = Math.abs(n.getX(i)) > Math.abs(n.getZ(i));
      uv[i * 2] = (side ? p.getZ(i) : p.getX(i)) / tile; uv[i * 2 + 1] = (Math.abs(n.getY(i)) > .85 ? p.getZ(i) : p.getY(i)) / tile;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  };
  const put = (geo, m, parent) => {
    if (TILE.has(m)) worldUV(geo, TILE.get(m));
    const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; (parent || g).add(mesh); return mesh;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
  // a smooth tapered tube from a to b, ending in round caps, so joints between two tubes have no seams or gaps
  const tube = (a, b, r0, r1, m, caps = true) => {
    const d = b.clone().sub(a), len = d.length(), geo = new THREE.CylinderGeometry(r1, r0, len, 18, 3, true);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize())));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    put(geo, m);
    if (caps){ put(new THREE.SphereGeometry(r0, 18, 12).translate(a.x, a.y, a.z), m); put(new THREE.SphereGeometry(r1, 18, 12).translate(b.x, b.y, b.z), m); }
  };
  // a body of revolution from [radius, height] pairs, flattened front to back by sz
  const lathe = (pts, sz, m, segs = 32) => put(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs).scale(1, 1, sz), m);
  const blob = (rx, ry, rz, x, y, z, m, parent) => put(new THREE.SphereGeometry(1, 16, 12).scale(rx, ry, rz).translate(x, y, z), m, parent);
  const rbox = (w, h, d, x, y, z, m, rx = 0, rz = 0) => { const geo = new THREE.BoxGeometry(w, h, d); geo.rotateX(rx); geo.rotateZ(rz); geo.translate(x, y, z); return put(geo, m); };

  // ---- boots and trousers
  for (const s of [-1, 1]){
    const x = s * .1;
    rbox(.105, .028, .3, x, .014, .045, leather);                                        // sole and heel
    blob(.056, .055, .13, x, .065, .06, leather);                                        // the foot, round over the toes
    blob(.05, .03, .06, x, .065, .155, leather);                                         // toe cap
    tube(V(x, .06, 0), V(x, .21, -.005), .058, .054, leather, false);                    // boot shaft
    tube(V(x, .17, 0), V(x * 1.05, .52, .01), .062, .066, wool);                         // lower leg, the hem over the boot
    tube(V(x * 1.05, .52, .01), V(x, .93, 0), .066, .088, wool);                         // thigh
    rbox(.004, .7, .004, x, .55, .072, wool);                                            // the pressed crease
  }
  lathe([[.0, .82], [.16, .82], [.18, .9], [.178, .97], [.17, 1.0], [0, 1.0]], .7, wool); // seat of the trousers

  // ---- the uniform shirt: chest, waist and shoulders turned on a lathe, tucked in at the belt
  const TORSO = [[.176, .95], [.178, 1.02], [.186, 1.12], [.2, 1.26], [.208, 1.36], [.205, 1.44], [.18, 1.5], [.13, 1.55], [.08, 1.585], [.066, 1.61]], SZ = .64;
  lathe([[0, .95], ...TORSO, [0, 1.61]], SZ, wool, 40);
  // ### How far the shirt's surface stands out in front at a height and a sideways offset, so the placket, the tie, the
  // ### pockets and the badge lie on the chest instead of floating in front of it or sinking in.
  const rAt = y => { for (let i = 1; i < TORSO.length; i++) if (y <= TORSO[i][1]){ const [r0, y0] = TORSO[i - 1], [r1, y1] = TORSO[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return TORSO[TORSO.length - 1][0]; };
  const surfZ = (y, x = 0) => { const r = rAt(y); return SZ * Math.sqrt(Math.max(0, r * r - x * x)); };
  // a strip that lies on the chest from height y0 to y1, its half width given by hw(t) for t from 0 (bottom) to 1 (top)
  const onChest = (cx, y0, y1, hw, off, m) => {
    const geo = new THREE.PlaneGeometry(1, 1, 4, 14), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++){ const t = p.getY(i) + .5, y = y0 + (y1 - y0) * t, x = cx + p.getX(i) * 2 * hw(t); p.setXYZ(i, x, y, surfZ(y, x) + off); }
    geo.computeVertexNormals(); return put(geo, m);
  };
  onChest(0, .99, 1.5, () => .016, .002, wool);                                         // the button placket
  for (const y of [1.06, 1.17]) blob(.007, .007, .004, 0, y, surfZ(y) + .004, metal);   // buttons below the tie
  for (const s of [-1, 1]){
    onChest(s * .095, 1.27, 1.39, () => .054, .005, wool);                               // breast pockets
    onChest(s * .095, 1.375, 1.415, t => .056 - (1 - t) * .004, .009, wool);           // pocket flaps
    blob(.006, .006, .004, s * .095, 1.385, surfZ(1.385, s * .095) + .012, metal);
    rbox(.13, .016, .1, s * .17, 1.515, .0, wool, 0, -s * .38);                          // shoulder boards
    blob(.007, .007, .007, s * .125, 1.537, .02, metal);
  }
  // the badge over the left pocket: a gold shield; the name plate over the right
  const shield = new THREE.Shape(); shield.moveTo(0, .03); shield.lineTo(.022, .022); shield.lineTo(.02, -.01); shield.quadraticCurveTo(.012, -.026, 0, -.034); shield.quadraticCurveTo(-.012, -.026, -.02, -.01); shield.lineTo(-.022, .022); shield.closePath();
  const badge = new THREE.ExtrudeGeometry(shield, { depth: .004, bevelEnabled: true, bevelThickness: .002, bevelSize: .002, bevelSegments: 2 });
  badge.rotateX(-.25); badge.translate(.095, 1.45, surfZ(1.45, .095) + .002); put(badge, metal);
  const plate = canvasTex(128, 32, (c, w, h) => { c.fillStyle = '#1a1c20'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8e2cf'; c.font = '700 24px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('D. HALE', w / 2, 24); });
  const plateM = mat({ map: plate, roughness: .4, envMapIntensity: .5 });
  const pg = new THREE.PlaneGeometry(.075, .018); pg.rotateX(-.2); pg.translate(-.095, 1.435, surfZ(1.435, .095) + .004); put(pg, plateM);
  // shirt collar, tie knot and tie
  lathe([[.07, 1.58], [.073, 1.62], [.067, 1.645]], .95, poplin, 24).material.side = THREE.DoubleSide;
  for (const s of [-1, 1]){ const c = new THREE.BoxGeometry(.045, .055, .004); c.rotateZ(s * .9); c.rotateX(-.5); c.translate(s * .026, 1.585, .074); put(c, poplin); }
  blob(.014, .017, .011, 0, 1.585, .078, tie);
  onChest(0, 1.15, 1.57, t => .028 - t * .016, .007, tie);                               // the tie, widening downwards
  { const tip = new THREE.BufferGeometry(), z = surfZ(1.15) + .007;
    tip.setAttribute('position', new THREE.Float32BufferAttribute([-.028, 1.15, z, .028, 1.15, z, 0, 1.115, surfZ(1.115) + .007], 3)); tip.computeVertexNormals(); put(tip, tie); }

  // ---- the duty belt and what hangs on it
  put(new THREE.CylinderGeometry(.187, .187, .052, 40, 1, true).scale(1, 1, .7).translate(0, .98, 0), leather).material.side = THREE.DoubleSide;
  rbox(.06, .045, .012, 0, .98, .133, steel);                                            // buckle
  rbox(.04, .028, .014, 0, .98, .136, leather);
  { const ring = new THREE.TorusGeometry(.03, .004, 8, 24); ring.translate(-.15, .93, .1); put(ring, steel);
    const krnd = mulberry32(4471);
    for (let k = 0; k < 5; k++){ const a = -.5 + k * .25 + (krnd() - .5) * .1, key = new THREE.BoxGeometry(.012, .055, .003); key.translate(0, -.03, 0); key.rotateZ(a); key.translate(-.15 + Math.sin(a) * .028, .905, .104 + k * .002); put(key, k % 2 ? metal : steel); } }
  rbox(.07, .055, .035, .16, .955, .065, leather, 0, 0);                                 // handcuff case
  rbox(.06, .06, .03, -.175, .965, -.045, plastic);                                      // radio pack at the back
  tube(V(.185, .99, -.02), V(.2, .55, -.03), .016, .014, plastic, true);                 // baton
  // the radio microphone clipped to the left shoulder board, its coiled cord down to the back
  rbox(.032, .05, .02, -.155, 1.47, .095, plastic, -.2);
  tube(V(-.17, 1.45, .08), V(-.19, 1.2, -.12), .004, .004, plastic, false);

  // ---- arms and hands
  const hand = (wrist, dir, s, curl) => {
    // a hand in its own frame (pointing down -y, the palm facing -x * s), turned to the forearm's direction; each finger
    // has two joints that bend by curl and twice curl
    const h = new THREE.Group(); g.add(h);
    h.position.copy(wrist); h.quaternion.setFromUnitVectors(V(0, -1, 0), dir.clone().normalize());
    const part = geo => { const m = new THREE.Mesh(geo, skinPlain); m.castShadow = true; h.add(m); };
    part(new THREE.SphereGeometry(1, 18, 12).scale(.021, .048, .04).translate(0, -.042, 0));         // palm and back of the hand
    const seg = (a, b, r) => { const d = b.clone().sub(a), geo = new THREE.CylinderGeometry(r * .92, r, d.length(), 10);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize())));
      geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); part(geo); part(new THREE.SphereGeometry(r * .95, 10, 8).translate(b.x, b.y, b.z)); };
    [.058, .066, .062, .05].forEach((l, f) => {
      const z = -.026 + f * .0175, r = .0088 - f * .0006, k = V(0, -.082, z);
      const m = k.clone().add(V(-s * Math.sin(curl) * l * .55, -Math.cos(curl) * l * .55, 0));
      const tip = m.clone().add(V(-s * Math.sin(curl * 2) * l * .45, -Math.cos(curl * 2) * l * .45, 0));
      part(new THREE.SphereGeometry(r, 10, 8).translate(k.x, k.y, k.z)); seg(k, m, r); seg(m, tip, r * .92);
    });
    const t0 = V(-s * .01, -.03, .03), t1 = t0.clone().add(V(-s * .022, -.03, .016)), t2 = t1.clone().add(V(-s * .018, -.022, .004));
    seg(t0, t1, .011); seg(t1, t2, .0095);
  };
  for (const s of [-1, 1]) blob(.068, .07, .072, s * .2, 1.455, 0, wool);                // shoulders
  // left arm hanging, slightly bent
  tube(V(-.205, 1.45, 0), V(-.235, 1.17, -.02), .058, .05, wool);
  tube(V(-.235, 1.17, -.02), V(-.24, .93, .04), .05, .04, wool);
  tube(V(-.24, .95, .035), V(-.241, .925, .041), .044, .043, wool, false);              // cuff
  hand(V(-.241, .918, .043), V(-.01, -1, .2), -1, .45);
  // right arm reaching out for the door
  tube(V(.205, 1.45, 0), V(.32, 1.29, .24), .058, .05, wool);
  tube(V(.32, 1.29, .24), V(.39, 1.2, .5), .05, .04, wool);
  tube(V(.385, 1.205, .48), V(.392, 1.198, .505), .044, .043, wool, false);
  hand(V(.393, 1.197, .51), V(.25, -.12, 1), 1, .75);

  // ---- neck and head
  tube(V(0, 1.57, -.008), V(0, 1.68, .0), .062, .055, skinPlain, false);
  const head = new THREE.Group(); head.position.set(0, 1.745, .01); head.rotation.x = .04; g.add(head);
  const RX = .078, RY = .112, RZ = .098;
  // ### The face, painted on the sphere's own map: u = 0.75 is the front (the sphere is turned round to face +z), v runs
  // ### from the crown (0) to the chin (1). U(x, y) and Vv(y) find the spot on the map for a point on the face.
  const Vv = y => Math.acos(Math.max(-1, Math.min(1, y / RY))) / Math.PI;
  const U = (x, y) => .75 - Math.asin(Math.max(-1, Math.min(1, x / (RX * Math.sqrt(Math.max(.05, 1 - (y / RY) ** 2)))))) / (Math.PI * 2);
  const face = canvasTex(1024, 512, (c, w, h) => {
    const P = (x, y) => [U(x, y) * w, Vv(y) * h], blobAt = (x, y, r, col, sy = 1) => { c.save(); c.translate(x, y); c.scale(1, sy); const gr = c.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, col); gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); c.fillStyle = gr; c.fillRect(-r, -r, r * 2, r * 2); c.restore(); };
    c.fillStyle = SKIN; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) blobAt(hrnd() * w, hrnd() * h, 10 + hrnd() * 40, hrnd() < .55 ? 'rgba(165,85,65,.1)' : 'rgba(225,185,155,.1)');
    for (let i = 0; i < 9000; i++){ c.fillStyle = `rgba(110,60,45,${hrnd() * .08})`; c.fillRect(hrnd() * w, hrnd() * h, 1.5, 1.5); }   // pores
    // a weathered red over the cheeks and the nose
    for (const s of [-1, 1]){ const [x, y] = P(s * .045, -.03); blobAt(x, y, 46, 'rgba(175,90,70,.12)', .7); }
    { const [x, y] = P(0, -.02); blobAt(x, y, 22, 'rgba(170,85,66,.12)'); }
    // short grey hair at the back and sides, cut high above the ears (the cap covers the top)
    for (let x = 0; x < w; x++){
      const d = Math.min(Math.abs(x / w - .75), 1 - Math.abs(x / w - .75)) / .5, end = (.16 + Math.pow(d, 1.6) * .5) * h;
      c.fillStyle = 'rgba(120,114,106,.92)'; c.fillRect(x, 0, 1, end - 10);
      const gr = c.createLinearGradient(0, end - 10, 0, end); gr.addColorStop(0, 'rgba(120,114,106,.92)'); gr.addColorStop(1, 'rgba(120,114,106,0)'); c.fillStyle = gr; c.fillRect(x, end - 10, 1, 10);
    }
    for (let i = 0; i < 9000; i++){ const x = hrnd() * w, y = hrnd() * h * .62; c.fillStyle = hrnd() < .5 ? 'rgba(60,55,50,.25)' : 'rgba(205,200,192,.22)'; c.fillRect(x, y, 1, 2); }
    // forehead lines
    c.strokeStyle = 'rgba(120,62,48,.25)'; c.lineWidth = 1.4;
    for (const y of [.06, .072, .084]){ const [x0, yy] = P(-.04, y), [x1] = P(.04, y); c.beginPath(); c.moveTo(x0, yy); c.quadraticCurveTo((x0 + x1) / 2, yy - 4, x1, yy); c.stroke(); }
    // the eyes: sockets, bags, whites, grey-blue irises, lids, crow's feet, heavy brows
    for (const s of [-1, 1]){
      const [x, y] = P(s * .031, .012);
      blobAt(x, y, 28, 'rgba(80,42,32,.55)', .6);
      blobAt(x, y + 14, 20, 'rgba(120,70,62,.28)', .45);
      c.strokeStyle = 'rgba(110,60,46,.4)'; c.lineWidth = 1.3; c.beginPath(); c.ellipse(x, y + 9, 13, 5, 0, .15 * Math.PI, .85 * Math.PI); c.stroke();
      c.fillStyle = 'rgba(178,160,148,.95)'; c.beginPath(); c.ellipse(x, y, 11.5, 3.9, 0, 0, 7); c.fill();
      c.fillStyle = '#3f4c55'; c.beginPath(); c.arc(x - s * 1.2, y + .3, 4, 0, 7); c.fill();
      c.fillStyle = '#121212'; c.beginPath(); c.arc(x - s * 1.2, y + .3, 1.9, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.8)'; c.fillRect(x - s * 1.2 + 1, y - 1.5, 1.2, 1.2);
      c.strokeStyle = 'rgba(45,25,20,.9)'; c.lineWidth = 2.2; c.beginPath(); c.ellipse(x, y + 1, 13.5, 5.4, 0, Math.PI * 1.04, Math.PI * 1.96); c.stroke();
      c.strokeStyle = 'rgba(120,70,55,.35)'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(x, y - 1, 15, 8, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();   // the lid fold
      c.strokeStyle = 'rgba(115,62,48,.3)'; c.lineWidth = 1;
      for (const a of [-.35, 0, .35]){ c.beginPath(); c.moveTo(x - s * 16, y + a * 6); c.lineTo(x - s * 27, y + a * 14); c.stroke(); }
      c.lineCap = 'round';
      for (let k = 0; k < 70; k++){ const t = hrnd(), bx = x - 17 + t * 34, by = y - 13 - Math.sin(t * Math.PI) * 4 + (s * (t - .5)) * 2 + (hrnd() - .5) * 3; c.strokeStyle = `rgba(${hrnd() < .3 ? '150,142,132' : '52,44,38'},.85)`; c.lineWidth = 1.8; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + s * (t - .5) * 4 + 3, by - 1.5); c.stroke(); }
    }
    // nose shadow, the lines from the nose to the mouth, the mouth under the moustache
    { const [x, y] = P(0, -.04); c.fillStyle = 'rgba(70,35,28,.55)'; for (const s of [-1, 1]){ c.beginPath(); c.ellipse(x + s * 6, y + 6, 3.4, 2, 0, 0, 7); c.fill(); } }
    for (const s of [-1, 1]){ const [x0, y0] = P(s * .018, -.035), [x1, y1] = P(s * .04, -.075); c.strokeStyle = 'rgba(110,58,45,.4)'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x1 + s * 2, (y0 + y1) / 2, x1, y1); c.stroke(); }
    { const [x, y] = P(0, -.066); c.fillStyle = 'rgba(140,84,72,.6)'; c.beginPath(); c.ellipse(x, y + 4, 14, 3.4, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(70,32,28,.8)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x - 15, y + 2); c.quadraticCurveTo(x, y + 3.5, x + 15, y + 2); c.stroke(); }
    // the moustache: grey hairs combed down and out from under the nose
    { const [x, y] = P(0, -.05); c.lineCap = 'round';
      for (let k = 0; k < 900; k++){ const t = hrnd() * 2 - 1, bx = x + t * 24, by = y - 5 + Math.abs(t) * 5 + hrnd() * 7; c.strokeStyle = `rgba(${hrnd() < .6 ? '62,56,50' : '128,120,112'},.85)`; c.lineWidth = 1.4; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + t * 3, by + 4 + hrnd() * 3); c.stroke(); } }
    // grey stubble over the jaw, the chin and the upper lip
    for (let i = 0; i < 14000; i++){
      const u = .55 + hrnd() * .4, v = .58 + hrnd() * .4, du = Math.abs(u - .75);
      if (v < .66 && du < .1) continue;                                    // not on the cheeks under the eyes
      if (v < .58 + du * .4) continue;
      c.fillStyle = `rgba(${hrnd() < .5 ? '80,70,62' : '150,142,132'},${.12 + hrnd() * .22})`; c.fillRect(u * w, v * h, 1.2, 1.2);
    }
    const jaw = c.createLinearGradient(0, .82 * h, 0, h); jaw.addColorStop(0, 'rgba(70,40,30,0)'); jaw.addColorStop(1, 'rgba(70,40,30,.4)'); c.fillStyle = jaw; c.fillRect(0, .82 * h, w, .18 * h);
  });
  const skinFace = mat({ map: face, roughness: .62, envMapIntensity: .2 });
  // ### The skull: a sphere turned to face +z and shaped: narrower at the temples, a brow ridge, cheekbones, eye
  // ### sockets, a strong jaw and a square chin.
  const skull = new THREE.SphereGeometry(1, 48, 36); skull.rotateY(Math.PI);
  { const p = skull.attributes.position;
    for (let i = 0; i < p.count; i++){
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const front = Math.max(0, z), jawK = y < -.1 ? 1 - .08 * Math.min(1, (-y - .1) * 1.6) : 1;
      x *= jawK * (y > .45 ? 1 - (y - .45) * .12 : 1);
      if (y < -.55) z += front * (-.55 - y) * .25;                                           // the chin
      z += front * .07 * Math.exp(-(((y - .22) / .1) ** 2)) * Math.exp(-((x / .55) ** 2));   // the brow ridge
      for (const s of [-1, 1]){
        const ex = s * .4, ey = .1; z -= front * .06 * Math.exp(-(((x - ex) / .18) ** 2 + ((y - ey) / .13) ** 2));   // eye sockets
        z += front * .04 * Math.exp(-(((x - s * .52) / .2) ** 2 + ((y + .14) / .14) ** 2));                            // cheekbones
      }
      if (z < 0) z *= 1.05;
      p.setXYZ(i, x * RX, y * RY, z * RZ);
    }
    skull.computeVertexNormals(); }
  put(skull, skinFace, head);
  // the nose: bridge, tip and the wings of the nostrils
  { const n = new THREE.SphereGeometry(1, 16, 12); n.scale(.0105, .024, .012); n.rotateX(-.3); n.translate(0, -.016, RZ - .002); put(n, skinPlain, head); }
  blob(.0105, .0095, .0095, 0, -.035, RZ + .006, skinPlain, head);
  for (const s of [-1, 1]) blob(.0065, .006, .007, s * .0095, -.038, RZ - .004, skinPlain, head);
  // the ears
  for (const s of [-1, 1]){ const e = new THREE.SphereGeometry(1, 14, 10); e.scale(.007, .027, .016); e.rotateY(-s * .3); e.translate(s * (RX - .002), -.008, -.008); put(e, skinPlain, head); }
  // a grey moustache, thick and trimmed
  for (const s of [-1, 1]){ const m = new THREE.SphereGeometry(1, 14, 10); m.scale(.02, .0065, .005); m.rotateZ(s * .3); m.translate(s * .013, -.049, RZ - .008); put(m, hairM, head); }
  // ---- the peaked cap: band, a crown that widens to its top, the black leather visor, a chin strap and the cap badge
  const cap = new THREE.Group(); cap.position.set(0, .045, -.004); cap.rotation.x = -.08; head.add(cap);
  put(new THREE.CylinderGeometry(.086, .084, .04, 32, 1, true).scale(1, 1, 1.18).translate(0, .015, 0), wool, cap).material.side = THREE.DoubleSide;
  put(new THREE.LatheGeometry([[.086, .035], [.11, .062], [.122, .075], [.118, .082], [.06, .088], [0, .089]].map(([r, y]) => new THREE.Vector2(r, y)), 32).scale(1, 1, 1.12), wool, cap);
  { const v = new THREE.CylinderGeometry(.092, .092, .006, 32, 1, false, -Math.PI / 2, Math.PI); v.scale(1, 1, .75); v.rotateX(.3); v.translate(0, -.002, .06); put(v, leather, cap); }
  put(new THREE.CylinderGeometry(.0875, .0875, .009, 32, 1, true, -Math.PI * .45, Math.PI * .9).scale(1, 1, 1.18).translate(0, .008, 0), leather, cap);
  { const b = new THREE.ExtrudeGeometry(shield, { depth: .003, bevelEnabled: true, bevelThickness: .0015, bevelSize: .0015, bevelSegments: 1 }); b.scale(.75, .75, 1); b.rotateX(-.2); b.translate(0, .05, .105); put(b, metal, cap); }
  return { g, mats };
}
// ### The shadow Hale throws through the open door: his outline (haleOutline, the arm out to the door) thrown flat onto
// ### the floor by a light high up and well back in the corridor, so it runs from his boots over the threshold into the
// ### room, stretched as a real shadow is: legs short, the body and the cap longer and wider. Like a real one it is sharp
// ### and dark where his boots stand and softer and paler towards his head, the farther the light has to travel past him.
// ### The picture covers the floor from x -0.7 to 0.9 and z 1 to 3.6 (160 pixels to the metre); top is the room side.
const HALE_AT = { x: .14, z: 3.42 };
const shadowTex = canvasTex(256, 416, (g, w, h) => {
  const L = { x: 0, y: 4.05, z: 5.96 }, PX = 160;
  // a point of his body (his own metres; he faces into the room) to where its shadow falls, and a radius there
  const to = p => { const s = L.y / (L.y - p[1]); return [(L.x + s * (HALE_AT.x - p[0] - L.x) + .7) * PX, (L.z + s * (HALE_AT.z - p[2] - L.z) - 1) * PX]; };
  const px = (p, r) => r * L.y / (L.y - p[1]) * PX;
  const body = r => softShape(w, h, r, '#000', c => haleOutline(c, to, px, true));
  const near = body(2), far = body(10);
  // from his boots (0) to the top of his cap (1)
  const along = (c, a, b) => { const gr = c.createLinearGradient(0, (HALE_AT.z - 1) * PX, 0, .22 * PX); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  g.drawImage(near, 0, 0);
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = along(g, 'rgba(0,0,0,0)', '#000'); g.fillRect(0, 0, w, h);
  const fg = far.getContext('2d'); fg.globalCompositeOperation = 'destination-in'; fg.fillStyle = along(fg, 'rgba(0,0,0,0)', '#000'); fg.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter'; g.drawImage(far, 0, 0);
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = along(g, 'rgba(0,0,0,.85)', 'rgba(0,0,0,.6)'); g.fillRect(0, 0, w, h);
});
const hall = new THREE.Group(); room.add(hall);
{ const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: hallTex })); m.position.set(0, 1.5, 4.6); m.rotation.y = Math.PI; hall.add(m);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshBasicMaterial({ map: hallFloorTex })); f.position.set(0, .002, 3.8); f.rotation.x = -Math.PI / 2; hall.add(f);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshBasicMaterial({ color: 0x39434b })); c.position.set(0, 3, 3.8); c.rotation.x = Math.PI / 2; hall.add(c);
  const t = new THREE.Mesh(new THREE.BoxGeometry(1.4, .05, .12), new THREE.MeshBasicMaterial({ color: 0xf2f8ff })); t.position.set(0, 2.97, 3.7); hall.add(t); }
const hale = buildHale();
// Fades Hale in or out; he is only drawn while he can be seen
function haleFade(o){ if (hale.fade) hale.fade(o); else for (const m of hale.mats) m.opacity = o; hale.g.visible = o > .01; }
hall.visible = false;
hale.g.position.set(HALE_AT.x, 0, HALE_AT.z); hale.g.rotation.y = Math.PI; hale.g.visible = false; room.add(hale.g);
const haleShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0, depthWrite: false }));
haleShadow.position.set(.1, .004, 2.3); haleShadow.rotation.x = -Math.PI / 2; room.add(haleShadow);
// ### Officer Hale as a real man. The figure above is only the stand-in until models/hale.glb has loaded (or if it cannot
// ### be loaded). The model is made from the free MakeHuman base mesh (CC0, see models/LICENSE-hale.txt): a real male body
// ### in his fifties, shaped by MakeHuman's own measurements, with its skeleton of 66 bones, real eyes and a painted skin
// ### (models/hale-skin.jpg and its bump map): stubble, grey cropped hair at the sides, eyebrows, the lines of his face.
// ### Over it the uniform is fitted to the body: a navy wool tunic and trousers, a light blue shirt collar with a dark tie,
// ### a duty belt with pouches, a buckle and keys, a badge, a name plate, boots and a peaked cap. Every piece of it is
// ### bound to the skeleton, so he can move: his head turns to you, his right hand reaches for the edge of the door and
// ### stays on it while he pulls it shut, his left arm hangs at his side, his chest rises and falls as he breathes.
function readHuman(buf){
  const { json, acc } = glbParts(buf), skin = json.skins[0];
  const bones = skin.joints.map(j => { const n = json.nodes[j], b = new THREE.Bone(); b.name = n.name; b.position.fromArray(n.translation); return b; });
  skin.joints.forEach((j, k) => (json.nodes[j].children || []).forEach(c => bones[k].add(bones[skin.joints.indexOf(c)])));
  const ibm = acc(skin.inverseBindMatrices), inverses = bones.map((b, k) => new THREE.Matrix4().fromArray(ibm, k * 16));
  const parts = json.meshes[0].primitives.map(p => {
    const A = p.attributes, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(acc(A.POSITION), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(acc(A.NORMAL), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(acc(A.TEXCOORD_0), 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(acc(A.JOINTS_0)), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(acc(A.WEIGHTS_0), 4));
    geo.setIndex(new THREE.BufferAttribute(acc(p.indices), 1));
    return { name: json.materials[p.material].name, geo };
  });
  return { bones, inverses, parts };
}
function buildRealHale(buf){
  const h = readHuman(buf), g = new THREE.Group(), mats = [];
  const mat = o => { const m = new THREE.MeshStandardMaterial(Object.assign({ transparent: true, opacity: 0, skinning: true }, o)); mats.push(m); return m; };
  const own = (file, srgb) => { const t = new THREE.TextureLoader(ASSETS).load(file, shadowsMoved); t.flipY = false; t.anisotropy = ANISO; if (srgb) t.encoding = THREE.sRGBEncoding; return t; };
  // the scans of the old figure, in units of one scan: the cloth pieces carry their UVs in metres
  const tiled = (file, srgb, size) => SCAN(file, srgb, 1 / size, 1 / size);
  const scanned = ([color, normal, rough], size, o) => mat(Object.assign({ map: tiled(color, true, size), normalMap: tiled(normal, false, size), roughnessMap: tiled(rough, false, size), side: THREE.DoubleSide }, o));
  const WOOL = ['uniform-wool-color.jpg', 'uniform-wool-normal.jpg', 'uniform-wool-rough.jpg'], LEATHER = ['leather-color.jpg', 'leather-normal.jpg', 'leather-rough.jpg'];
  const wool = scanned(WOOL, .27, { roughness: 1, normalScale: new THREE.Vector2(.9, .9), envMapIntensity: .25 }); wool.color.setRGB(.11, .135, .2);
  const trousers = scanned(WOOL, .27, { roughness: 1, normalScale: new THREE.Vector2(.9, .9), envMapIntensity: .25 }); trousers.color.setRGB(.085, .1, .15);
  const cap = scanned(WOOL, .2, { roughness: 1, normalScale: new THREE.Vector2(.7, .7), envMapIntensity: .25 }); cap.color.setRGB(.07, .085, .13);
  const leather = scanned(LEATHER, .4, { roughness: .8, normalScale: new THREE.Vector2(.5, .5), envMapIntensity: .6 }); leather.color.setRGB(.13, .13, .14);
  const M = {
    skin: mat({ map: own('models/hale-skin.jpg', true), bumpMap: own('models/hale-skin-bump.jpg', false), bumpScale: .0012, roughness: .58, envMapIntensity: .3 }),
    eyes: mat({ map: own('models/hale-eye.jpg', true), roughness: .35, envMapIntensity: .4 }),
    cornea: mat({ color: 0xffffff, roughness: .03, envMapIntensity: 1.5, depthWrite: false }),
    shirt: wool, trousers, cap, boots: leather, belt: leather,
    collar: mat({ color: 0x9db3c8, roughness: .8, normalMap: tiled('shirt-poplin-normal.jpg', false, .29), normalScale: new THREE.Vector2(.8, .8), envMapIntensity: .2, side: THREE.DoubleSide }),
    tie: mat({ color: 0x0d1016, roughness: .7, envMapIntensity: .3, side: THREE.DoubleSide }),
    metal: mat({ color: 0xc9c2a8, roughness: .3, metalness: 1, envMapIntensity: 1.1, side: THREE.DoubleSide }),
    visor: mat({ color: 0x050506, roughness: .5, envMapIntensity: .12, side: THREE.DoubleSide }),
    sole: mat({ color: 0x0c0c0c, roughness: .9, envMapIntensity: .2 })
  };
  const corneaOpacity = .14;
  const root = h.bones[0]; g.add(root);
  const skeleton = new THREE.Skeleton(h.bones, h.inverses);
  for (const p of h.parts){ const m = new THREE.SkinnedMesh(p.geo, M[p.name]); m.frustumCulled = false; if (p.name === 'cornea') m.renderOrder = 1; g.add(m); m.bind(skeleton, new THREE.Matrix4()); }
  const by = Object.fromEntries(h.bones.map(b => [b.name, b]));
  // ---- posing. In the model every bone starts unturned (lined up with the world), so a pose is built from the rest
  // ---- pose each time: curl the fingers, then turn each bone of an arm so that it points where it should.
  const V = () => new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), a = V(), b = V();
  const wpos = (o, out) => o.getWorldPosition(out);
  // turns bone so that the line from it to tip points along dir (world)
  const aim = (bone, tip, dir) => {
    bone.updateWorldMatrix(true, true);
    wpos(bone, a); wpos(tip, b); b.sub(a).normalize();
    q.setFromUnitVectors(b, dir.clone().normalize());
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
  };
  const rest = h.bones.map(b => b.quaternion.clone());
  // in the rest pose: where each finger points and which way each palm faces, to curl them towards it
  root.updateWorldMatrix(true, true);
  const restDir = (b1, b2) => wpos(b2, V()).sub(wpos(b1, V())).normalize();
  const curlAxis = {};
  for (const [s, sg] of [['R', 1], ['L', -1]]){
    const across = restDir(by['finger2-1.' + s], by['finger5-1.' + s]), along = restDir(by['finger3-1.' + s], by['finger3-2.' + s]);
    const palm = V().crossVectors(along, across).multiplyScalar(sg).normalize();
    for (let f = 1; f <= 5; f++) for (let k = 1; k <= 2; k++){
      const n = 'finger' + f + '-' + k + '.' + s, d = restDir(by[n], by['finger' + f + '-' + (k + 1) + '.' + s]);
      curlAxis[n] = V().crossVectors(d, palm).normalize();
    }
    curlAxis['finger1-3.' + s] = curlAxis['finger1-2.' + s];
    for (let f = 2; f <= 5; f++) curlAxis['finger' + f + '-3.' + s] = curlAxis['finger' + f + '-2.' + s];
  }
  const curl = (s, amount, thumb) => {
    for (let f = 1; f <= 5; f++) for (let k = 1; k <= 3; k++){
      const n = 'finger' + f + '-' + k + '.' + s, bone = by[n];
      bone.quaternion.setFromAxisAngle(curlAxis[n], (f === 1 ? thumb : amount) * (k === 1 ? .8 : 1));
    }
  };
  const len = (b1, b2) => wpos(b1, V()).distanceTo(wpos(b2, V()));
  const ARM = {};
  for (const s of ['R', 'L']) ARM[s] = { up: len(by['upperarm01.' + s], by['lowerarm01.' + s]), low: len(by['lowerarm01.' + s], by['wrist.' + s]) };
  const S = V(), E = V(), T = V(), u = V(), pole = V(), tmp = V(), fwd = V(), look = V();
  // two-bone reach: the wrist goes to target (or as near as the arm allows), the elbow bends towards pole
  const reach = (s, target, poleDir) => {
    const A = ARM[s];
    wpos(by['upperarm01.' + s], S);
    u.copy(target).sub(S); const d = Math.min(u.length(), (A.up + A.low) * .985); u.normalize();
    const x = (A.up * A.up - A.low * A.low + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, A.up * A.up - x * x));
    pole.copy(poleDir).addScaledVector(u, -poleDir.dot(u)).normalize();
    E.copy(S).addScaledVector(u, x).addScaledVector(pole, hh);
    T.copy(S).addScaledVector(u, d);
    aim(by['upperarm01.' + s], by['lowerarm01.' + s], tmp.copy(E).sub(S));
    aim(by['lowerarm01.' + s], by['wrist.' + s], tmp.copy(T).sub(E));
  };
  const dirOf = (x, y, z) => g.localToWorld(V().set(x, y, z)).sub(g.getWorldPosition(V())).normalize();
  // the pose at time t of the scene: grip is where his right hand holds the door, eye the camera he looks at
  const pose = (t, grip, eye) => {
    h.bones.forEach((b, i) => b.quaternion.copy(rest[i]));
    g.updateWorldMatrix(true, true);
    // how well he can reach the door: not at all while it stands wide open, fully once it swings towards him
    wpos(by['upperarm01.R'], S);
    const span = ARM.R.up + ARM.R.low, hold = THREE.MathUtils.smoothstep(span * 1.12 - S.distanceTo(grip), 0, span * .15);
    const r = THREE.MathUtils.smoothstep(t, 1.4, 1.75);   // he reaches out as the door starts to swing
    curl('R', .3 + .75 * hold, .2 + .3 * hold); curl('L', .35, .25);
    // leaning in after the door while he reaches for it
    by.spine03.quaternion.setFromAxisAngle(V().set(1, 0, 0), .12 * r * (1 - hold * .6));
    const breath = Math.sin(t * 1.7) * .012;
    by.spine02.quaternion.setFromAxisAngle(V().set(1, 0, 0), -breath);
    // the left arm hangs down beside him, the elbow a little bent
    wpos(by['upperarm01.L'], S);
    reach('L', tmp.copy(S).add(dirOf(.09, -1, .1).multiplyScalar(.5)), dirOf(.2, 0, -1));
    aim(by['wrist.L'], by['finger3-1.L'], wpos(by['wrist.L'], V()).sub(wpos(by['lowerarm01.L'], V())));
    // the right hand: while the door stands open it hangs, and with "Inside" it shows you in, the palm open; then it
    // reaches for the edge of the door, the wrist a hand's breadth short of where the fingers hold it
    wpos(by['upperarm01.R'], S);
    const show = THREE.MathUtils.smoothstep(t, .8, 1.15) * (1 - THREE.MathUtils.smoothstep(t, 1.5, 1.9));
    const free = V().copy(S).add(dirOf(-.09, -1, .1).multiplyScalar(.52)).lerp(V().copy(S).add(dirOf(-.25, -.5, .85).normalize().multiplyScalar(.55)), show);
    const w = V().copy(grip).sub(S); const wl = w.length(); w.normalize();
    const held = V().copy(grip).addScaledVector(w, -Math.min(.09, wl * .2));
    reach('R', free.lerp(held, r), dirOf(-.6, -1, -.3));
    const hand = V().copy(wpos(by['wrist.R'], V())).sub(wpos(by['lowerarm01.R'], V())).normalize();
    aim(by['wrist.R'], by['finger3-1.R'], hand.lerp(V().copy(grip).sub(wpos(by['wrist.R'], V())).normalize(), r).add(dirOf(0, show * .35, 0)));
    // the head (and less the neck) turns to look at you
    if (eye){
      g.updateWorldMatrix(true, true);
      wpos(by.head, a); look.copy(eye).sub(a).normalize();
      fwd.copy(dirOf(0, 0, 1));
      const yaw = Math.atan2(look.dot(dirOf(1, 0, 0)), look.dot(fwd)), pitch = Math.asin(THREE.MathUtils.clamp(look.dot(dirOf(0, 1, 0)), -1, 1));
      const cy = THREE.MathUtils.clamp(yaw, -1, 1), cp = THREE.MathUtils.clamp(pitch, -.5, .4);
      by.neck02.quaternion.setFromEuler(new THREE.Euler(-cp * .4, cy * .4, 0, 'YXZ'));
      by.head.quaternion.setFromEuler(new THREE.Euler(-cp * .6, cy * .6, 0, 'YXZ'));
    }
  };
  const fade = o => { for (const m of mats) m.opacity = m === M.cornea ? o * corneaOpacity : o; };
  return { g, mats, pose, fade };
}
// ### Loads the real Hale and swaps him in for the stand-in, in the same place and with the same fade.
function loadRealHale(){
  loading('Hale', fetch('models/hale.glb').then(glbBytes).then(buf => {
    const real = buildRealHale(buf), o = hale.mats[0].opacity;
    real.g.position.copy(hale.g.position); real.g.rotation.copy(hale.g.rotation);
    room.remove(hale.g); room.add(real.g);
    Object.assign(hale, real); haleFade(o); shadowsMoved();
  }));
}
loadRealHale();
// ### Inmate 4471, the player, as a real man (models/inmate.glb): the free MakeHuman base mesh (CC0, see
// ### models/LICENSE-inmate.txt), a man in his late thirties with a skeleton of 66 bones, real eyes and a painted skin
// ### (models/inmate-skin.jpg and its bump map) with a prison buzz cut, dark stubble and eyebrows. Over it the striped
// ### uniform is fitted to the body: the shirt with its plain collar and the white patch with his number, the trousers
// ### and brown leather work boots. Every piece is bound to the skeleton. The parts are kept apart by where they sit
// ### (head, arms, the rest), so the view through his own eyes can leave out his head and the arms it draws itself.
// ### base is the folder of room 1, where the model and the scans are. Returns the figure (g), its parts by name and a
// ### small set of tools to pose it: reset, aim (turn a bone so the next one lies along a direction), limb (two bones
// ### reaching a point, bending towards a pole), turn (set a bone's turn in the world) and curl (close a hand).
function buildInmate(buf, base){
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb file');
  const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bin = 20 + jl + 8;
  const acc = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType], st = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(buf.slice(st, st + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const skin = json.skins[0];
  const bones = skin.joints.map(j => { const n = json.nodes[j], b = new THREE.Bone(); b.name = n.name; b.position.fromArray(n.translation); return b; });
  skin.joints.forEach((j, k) => (json.nodes[j].children || []).forEach(c => bones[k].add(bones[skin.joints.indexOf(c)])));
  const ibm = acc(skin.inverseBindMatrices), inverses = bones.map((b, k) => new THREE.Matrix4().fromArray(ibm, k * 16));
  // ---- the materials: his skin; the cloth in stripes 6.5 cm wide (one dark and one sand stripe every 13 cm, as on the
  // ---- uniform in the washroom), woven of the scanned linen; the plain sand collar, the patch, the leather of the boots
  const tl = new THREE.TextureLoader();
  const tex = (file, srgb, rep) => {
    const t = tl.load(base + file); t.anisotropy = 8; if (srgb) t.encoding = THREE.sRGBEncoding;
    if (rep){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); } else t.flipY = false;
    return t;
  };
  const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };
  const stripes = canvas(64, 128, (g, w, h) => {
    g.fillStyle = '#c4ba98'; g.fillRect(0, 0, w, h); g.fillStyle = '#25221f'; g.fillRect(0, 0, w, h / 2);
    for (let i = 0; i < 900; i++){ g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${Math.random() * .06})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1); }
  });
  stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping; stripes.repeat.set(1 / .26, 1 / .13);
  const linen = { normalMap: tex('textures/uniform-linen-normal.jpg', false, 1 / .3), roughnessMap: tex('textures/uniform-linen-rough.jpg', false, 1 / .3), normalScale: new THREE.Vector2(.8, .8) };
  const std = o => new THREE.MeshStandardMaterial(Object.assign({ skinning: true }, o));
  const cloth = std(Object.assign({ map: stripes, roughness: 1, side: THREE.DoubleSide, envMapIntensity: .2 }, linen));
  const plain = std(Object.assign({ color: 0xc4ba98, roughness: 1, side: THREE.DoubleSide, envMapIntensity: .2 }, linen));
  const body = std({ map: tex('models/inmate-skin.jpg', true), bumpMap: tex('models/inmate-skin-bump.jpg', false), bumpScale: .0012, roughness: .58, envMapIntensity: .3 });
  const leather = std({ map: tex('textures/leather-color.jpg', true, 1 / .4), normalMap: tex('textures/leather-normal.jpg', false, 1 / .4), roughnessMap: tex('textures/leather-rough.jpg', false, 1 / .4), roughness: .85, envMapIntensity: .5 });
  leather.color.setRGB(.55, .38, .26);
  const patch = std({ roughness: .95, side: THREE.DoubleSide, map: canvas(128, 64, (g, w, h) => {
    g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a857a'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#16140f'; g.font = 'bold 38px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('4471', w / 2, h / 2 + 2);
  }) });
  const M = { skin: body, skinHead: body, skinArm: body, shirt: cloth, shirtArm: cloth, shirtHead: plain, trousers: cloth, collar: plain, patch,
    eyes: std({ map: tex('models/hale-eye.jpg', true), roughness: .35, envMapIntensity: .4 }),
    cornea: std({ color: 0xffffff, roughness: .03, envMapIntensity: 1.5, transparent: true, opacity: .14, depthWrite: false }),
    boots: leather, sole: std({ color: 0x141210, roughness: .9 }) };
  // ---- the figure
  const g = new THREE.Group(); g.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones, inverses), parts = {};
  for (const p of json.meshes[0].primitives){
    const A = p.attributes, geo = new THREE.BufferGeometry(), name = json.materials[p.material].name;
    geo.setAttribute('position', new THREE.BufferAttribute(acc(A.POSITION), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(acc(A.NORMAL), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(acc(A.TEXCOORD_0), 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(acc(A.JOINTS_0)), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(acc(A.WEIGHTS_0), 4));
    geo.setIndex(new THREE.BufferAttribute(acc(p.indices), 1));
    const m = new THREE.SkinnedMesh(geo, M[name] || cloth); m.frustumCulled = false; m.castShadow = true;
    if (name === 'cornea') m.renderOrder = 1;
    g.add(m); m.bind(skeleton, new THREE.Matrix4());
    (parts[name] = parts[name] || []).push(m);
  }
  // ---- posing. Every bone starts unturned (lined up with the figure), so a pose is built from the rest pose each time.
  const by = Object.fromEntries(bones.map(b => [b.name, b])), rest = bones.map(b => b.position.clone());
  const V = () => new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), a = V(), b = V(), c = V(), e = V(), u = V(), p = V();
  const at = (bone, out) => bone.getWorldPosition(out);
  const reset = () => { bones.forEach((bn, i) => { bn.quaternion.set(0, 0, 0, 1); bn.position.copy(rest[i]); }); g.updateWorldMatrix(true, true); };
  // turns bone so that the line from it to tip points along dir (in the world)
  const aim = (bone, tip, dir) => {
    bone.updateWorldMatrix(true, true);
    at(bone, a); at(tip, b); b.sub(a).normalize();
    q.setFromUnitVectors(b, u.copy(dir).normalize());
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
    bone.updateWorldMatrix(false, true);
  };
  // two bones from bone1 through bone2 to end: end goes to target (or as near as the limb reaches), the middle joint
  // bends towards pole (a direction in the world)
  const limb = (bone1, bone2, end, target, pole) => {
    g.updateWorldMatrix(true, true);
    at(bone1, a); at(bone2, b); at(end, c);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    u.copy(target).sub(a); const d = Math.min(u.length(), (l1 + l2) * .995); u.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    p.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
    e.copy(a).addScaledVector(u, x).addScaledVector(p, hh);
    const t = V().copy(a).addScaledVector(u, d);
    aim(bone1, bone2, V().copy(e).sub(a));
    aim(bone2, end, t.sub(at(bone2, V())));
  };
  // sets the bone's turn in the world (the figure's rest axes turned by quat)
  const turn = (bone, quat) => { bone.parent.updateWorldMatrix(true, false); bone.parent.getWorldQuaternion(pq); bone.quaternion.copy(pq.invert().multiply(quat)); bone.updateWorldMatrix(false, true); };
  // closes the fingers of one hand ('L' or 'R') by amount, the thumb by thumb: each joint turns round the line across
  // its finger and the palm, as found in the rest pose (MakeHuman's own measurements, as for Officer Hale)
  g.updateWorldMatrix(true, true);
  const restDir = (b1, b2) => at(b2, V()).sub(at(b1, V())).normalize(), curlAxis = {};
  for (const [s, sg] of [['R', 1], ['L', -1]]){
    const across = restDir(by['finger2-1.' + s], by['finger5-1.' + s]), along = restDir(by['finger3-1.' + s], by['finger3-2.' + s]);
    const palm = V().crossVectors(along, across).multiplyScalar(sg).normalize();
    for (let f = 1; f <= 5; f++) for (let k = 1; k <= 2; k++){
      const n = 'finger' + f + '-' + k + '.' + s;
      curlAxis[n] = V().crossVectors(restDir(by[n], by['finger' + f + '-' + (k + 1) + '.' + s]), palm).normalize();
    }
    for (let f = 1; f <= 5; f++) curlAxis['finger' + f + '-3.' + s] = curlAxis['finger' + f + '-2.' + s];
  }
  const curl = (s, amount, thumb) => {
    for (let f = 1; f <= 5; f++) for (let k = 1; k <= 3; k++){ const n = 'finger' + f + '-' + k + '.' + s; by[n].quaternion.setFromAxisAngle(curlAxis[n], (f === 1 ? thumb : amount) * (k === 1 ? .8 : 1)); }
  };
  const show = (names, on) => names.forEach(n => (parts[n] || []).forEach(m => { m.visible = on; }));
  return { g, by, parts, bones, reset, aim, limb, turn, curl, show, mats: Object.values(M) };
}
// ### You, as a real man: two figures of inmate 4471 from models/inmate.glb. INMATE is the body you see when you look
// ### down and on the ladder (posed by poseBody and climbHands from the same joints as before; your head and your arms
// ### are left out, as the view and your real hands are already there); SELF is you in the steel mirror, all of you. Until
// ### the model has loaded (or if it cannot be), the figures built in code stand in, as before. Your own body is drawn a
// ### tenth smaller than the model, so its legs are as long as the walk measures them (LEG); the one in the mirror so
// ### that its eyes are where yours are.
let INMATE = null, SELF = null;
const INMATE_HIDE = ['skinHead', 'eyes', 'cornea', 'skinArm', 'shirtArm'];
function loadInmate(){
  loading('Inmate', fetch('models/inmate.glb').then(glbBytes).then(buf => {
    const I = buildInmate(buf, ''), S = buildInmate(buf, '');
    I.g.scale.setScalar(.9); I.show(INMATE_HIDE, false); I.g.visible = false; I.g.traverse(o => { o.castShadow = false; });
    S.g.scale.setScalar(.96); S.g.visible = false;
    scene.add(I.g, S.g); INMATE = I; SELF = S;
  }));
}
loadInmate();
const _iq = new THREE.Quaternion(), _iy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), _iv = new THREE.Vector3(), _ip = new THREE.Vector3(), _ia = new THREE.Vector3();
// ### Poses your body from its joints in the room: the hips, the base of the neck, the way the legs face (yaw, as for
// ### the camera), and for each side (right, then left) the knee, the ankle and how the boot is turned. The model's
// ### ankle sits lower in its boot than the walk's, so each boot is set that much lower.
function poseInmate(I, neck, hips, yaw, knees, ankles, footQ){
  const by = I.by; I.reset();
  I.g.position.copy(hips); I.g.rotation.set(0, Math.PI - yaw, 0); by.root.position.set(0, 0, 0); I.g.updateWorldMatrix(true, true);
  I.aim(by.spine05, by.neck01, _iv.subVectors(neck, by.spine05.getWorldPosition(_ip)));
  ['R', 'L'].forEach((s, i) => {
    const hip = by['upperleg01.' + s].getWorldPosition(_ip);
    _ia.set(0, -.044, 0).applyQuaternion(footQ[i]).add(ankles[i]);
    I.limb(by['upperleg01.' + s], by['lowerleg01.' + s], by['foot.' + s], _ia, _iv.subVectors(knees[i], hip));
    I.turn(by['foot.' + s], _iq.copy(footQ[i]).multiply(_iy));
  });
}
// ### The figures built in code for your chest and legs give way to the model once it is there.
function codeBody(){ if (!ME) return; const on = !INMATE; ME.torso.visible = on; for (const k of ['thigh', 'shin', 'hip', 'knee', 'boot']) ME[k].forEach(m => { m.visible = on; }); }
// the cold light that falls in through the open door
const doorLight = new THREE.SpotLight(0xd4e6ff, 0, 9, .62, .55, 1.3);
doorLight.position.set(0, 2.3, 4.1); doorLight.target.position.set(0, 0, .3); room.add(doorLight, doorLight.target);
// ### A light that is switched off still costs every pixel its sums, so the door light and the tunnel light are only part of
// ### the scene while they shine: the door light during the briefing scene, the tunnel light from the moment the hatch opens.
doorLight.visible = false;

// ### The sinks: one stainless-steel unit bolted to the west wall, the kind every prison has (no edge to break off,
// ### nothing to unscrew). A deck with two deep pressed bowls and a rolled front edge, an apron that hides the plumbing,
// ### a splashback with a metering push button for cold and hot (the red one) and a short spout over each bowl, and a
// ### pressed soap dish between them. The hot tap really runs: a stream falls into the bowl under it and splashes there.
// ### Years of use show on it: limescale where the water lands and dries, rust round the drains, grime in the corners,
// ### scuffs on the apron, security bolts that hold it to the wall and a yellowed bead of silicone along the wall.
const SINK = { x: -3.75, top: .89, bx: -3.73, bowls: [-.65, .65], wall: -3.975 };
const bowls = [], hotButton = [];
// ### Brushed stainless steel (a satin "No. 4" finish): fine lines ground into the steel along the unit, each one a little
// ### duller or brighter than the steel round it. GRAIN metres of steel make one picture, and every part of the unit gets
// ### its texture coordinates in metres (sinkUv), so the grain keeps its size everywhere and is never stretched.
const SINK_STEEL = (() => {
  const GRAIN = .5, PX = COARSE ? 256 : 512, r = mulberry32(5150);
  const hgt = document.createElement('canvas'), rgh = document.createElement('canvas');
  hgt.width = hgt.height = rgh.width = rgh.height = PX;
  const h = hgt.getContext('2d'), g = rgh.getContext('2d');
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, PX, PX);
  g.fillStyle = 'rgb(0,84,255)'; g.fillRect(0, 0, PX, PX);   // green: the gloss (roughness about .33), blue: all metal
  // broad, faint bands where the belt pressed harder, then the fine lines; both wrap round, so the picture tiles
  const line = (c, x, y, l, t, style) => { c.fillStyle = style; c.fillRect(x, y, l, t); if (x + l > PX) c.fillRect(x - PX, y, l, t); };
  for (let i = 0; i < 40; i++){ const y = r() * PX, t = 4 + r() * 18, l = PX * (.4 + r() * .6), x = r() * PX; line(g, x, y, l, t, `rgba(0,${r() < .5 ? 60 : 110},255,.12)`); }
  for (let i = 0; i < PX * 18; i++){
    const y = r() * PX, x = r() * PX, l = PX * (.05 + r() * .7), t = .5 + r() * .9, up = r() < .5;
    line(h, x, y, l, t, `rgba(${up ? 255 : 0},${up ? 255 : 0},${up ? 255 : 0},${.05 + r() * .12})`);
    line(g, x, y, l, t, `rgba(0,${up ? 66 : 112},255,${.08 + r() * .12})`);
  }
  // a few deeper scratches across the grain, where something hard was dragged over the steel
  for (let i = 0; i < 12; i++){
    const x = r() * PX, y = r() * PX, a = (r() - .5) * 1.2, l = 10 + r() * 60;
    for (const [c, st] of [[h, 'rgba(0,0,0,.35)'], [g, 'rgba(0,150,255,.4)']]){ c.strokeStyle = st; c.lineWidth = .8; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  }
  const tex = (c, aniso) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t; };
  const normal = tex(normalFromHeight(hgt, PX / GRAIN, .6), Math.min(ANISO, 4)), rough = tex(rgh, ANISO);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc6cacb, metalness: 1, roughness: 1, roughnessMap: rough, metalnessMap: rough,
    normalMap: normal, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: 1.15 });
  return { GRAIN, PX, mat, normal, rough, hgt, rgh };
})();
// ### Gives a box (w x h x d) texture coordinates in metres, with the grain along each face's longest side; the deck and
// ### apron run along the unit, the end panels from the wall forwards.
function sinkUv(geo, w, h, d){
  const uv = geo.attributes.uv, G = SINK_STEEL.GRAIN;
  for (let i = 0; i < uv.count; i++){
    const f = Math.floor(i / 4), u = uv.getX(i), v = uv.getY(i);
    const [su, sv] = f < 2 ? [d, h] : f < 4 ? [w, d] : [w, h];
    if (sv > su) uv.setXY(i, v * sv / G, u * su / G); else uv.setXY(i, u * su / G, v * sv / G);
  }
  return geo;
}
// ### A long tube (a rolled edge, the splashback's rounded top) along z, its grain along its length.
function sinkTube(rad, len, x, y, z, seg){
  const geo = new THREE.CylinderGeometry(rad, rad, len, seg), uv = geo.attributes.uv, G = SINK_STEEL.GRAIN;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * len / G, uv.getX(i) * 2 * Math.PI * rad / G);
  const m = new THREE.Mesh(geo, SINK_STEEL.mat); m.position.set(x, y, z); m.rotation.x = Math.PI / 2; return add(m);
}
const sinkBox = (w, h, d, x, y, z) => { const m = new THREE.Mesh(sinkUv(new THREE.BoxGeometry(w, h, d), w, h, d), SINK_STEEL.mat); m.position.set(x, y, z); return add(m); };
// ### A decal of wear laid over a flat part of the unit: a w x h picture painted by draw(g, W, H, X, Y), where X and Y turn
// ### metres from the decal's left and top edge into pixels. The marks are limescale, rust and dirt, not steel: matt and
// ### without the metal's gloss. up says whether it lies flat (the deck) or stands against the wall (facing the room).
function sinkDecal(w, h, x, y, z, up, draw){
  const PX = COARSE ? 256 : 420, W = Math.round(w * PX), H = Math.round(h * PX);
  const tex = canvasTex(W, H, (g) => draw(g, W, H, m => m * PX, m => m * PX));
  const geo = new THREE.PlaneGeometry(w, h);
  if (up) geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 2);   // the picture's left edge at the south end (+z), as seen from the room
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: .88, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; m.renderOrder = 1; room.add(m);
  return m;
}
// ### Little marks the decals and the bowls share: a dried drop (a ring of limescale with a faint middle), a soft blob,
// ### a run of water that dried on its way down.
function dropRing(g, x, y, rad, a, rgb = '236,232,220', r = rnd){
  g.beginPath(); g.ellipse(x, y, rad, rad * (.6 + r() * .4), r() * Math.PI, 0, 7);
  g.fillStyle = `rgba(${rgb},${a * .45})`; g.fill();
  g.strokeStyle = `rgba(${rgb},${a * .7})`; g.lineWidth = Math.max(.5, rad * .18); g.stroke();
}
function softBlob(g, x, y, rad, rgba){ const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)')); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
function dribble(g, x, y, len, wide, rgba, r){
  g.strokeStyle = rgba; g.lineCap = 'round';
  let cx = x, cy = y;
  for (let k = 0; k < 8; k++){ const ny = cy + len / 8, nx = cx + (r() - .5) * wide * .6; g.lineWidth = Math.max(.5, wide * (1 - k / 9)); g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke(); cx = nx; cy = ny; }
}
// ### Each bowl gets its own pictures, painted round the bowl (u, all the way round) and from the drain up to the rim (v),
// ### so the grain runs in circles, as on a spun steel bowl: limescale round the drain, a tide line of dried splashes,
// ### rust where the stream lands and drips down to the drain, a few grey water marks up the sides. hot says whether the
// ### tap above it is the one that runs (its bowl is the dirtier one).
function sinkBowlMat(hot, seed){
  const r = mulberry32(seed), W = COARSE ? 512 : 1024, H = COARSE ? 160 : 320;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const col = mk(), rgh = mk(), hgt = mk(), c = col.getContext('2d'), g = rgh.getContext('2d'), h = hgt.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
  g.fillStyle = 'rgb(0,72,255)'; g.fillRect(0, 0, W, H);
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, W, H);
  const Y = v => (1 - v) * H, U = u => ((u % 1) + 1) % 1 * W;   // v 0 is the drain, 1 the rim; u .75 faces the wall
  // marks near the seam are painted on both sides of it, each copy with the same random numbers
  const both = fn => { const s = r() * 4294967296 >>> 0; for (const o of [0, W, -W]) fn(o, mulberry32(s)); };
  // the circular grain, as on the deck
  for (let i = 0; i < W * 9; i++){
    const y = r() * H, x = r() * W, l = W * (.03 + r() * .4), t = .5 + r() * .8, up = r() < .5;
    h.fillStyle = `rgba(${up ? 255 : 0},${up ? 255 : 0},${up ? 255 : 0},${.05 + r() * .12})`; h.fillRect(x, y, l, t); h.fillRect(x - W, y, l, t);
    g.fillStyle = `rgba(0,${up ? 60 : 100},255,${.08 + r() * .1})`; g.fillRect(x, y, l, t); g.fillRect(x - W, y, l, t);
  }
  // the bottom is duller and darker: soap, skin and grey water dry there
  const bottom = c.createLinearGradient(0, Y(0), 0, Y(.45)); bottom.addColorStop(0, 'rgba(150,146,136,.55)'); bottom.addColorStop(1, 'rgba(150,146,136,0)');
  c.fillStyle = bottom; c.fillRect(0, 0, W, H);
  const dullB = g.createLinearGradient(0, Y(0), 0, Y(.45)); dullB.addColorStop(0, 'rgba(0,150,200,.6)'); dullB.addColorStop(1, 'rgba(0,150,200,0)');
  g.fillStyle = dullB; g.fillRect(0, 0, W, H);
  // limescale crusting round the drain: chalky, rough and no longer metal, in uneven flakes
  for (let i = 0; i < (hot ? 900 : 500); i++){
    const v = .06 + Math.pow(r(), 1.6) * .16, x = r() * W, y = Y(v), rad = 1 + r() * (hot ? 5 : 3.5);
    c.fillStyle = `rgba(232,228,214,${.25 + r() * .45})`; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
    g.fillStyle = `rgba(0,230,40,${.3 + r() * .4})`; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    h.fillStyle = `rgba(255,255,255,${.2 + r() * .3})`; h.beginPath(); h.arc(x, y, rad * .8, 0, 7); h.fill();
  }
  // a tide line of dried splashes high up the side, where the water from the tap hits and runs back
  for (let i = 0; i < (hot ? 320 : 140); i++){
    const v = .68 + (r() - .5) * .12 + Math.sin(r() * 6.28) * .02, x = r() * W, rad = .8 + Math.pow(r(), 2) * 4, a = .15 + r() * .3, s = r() * 4294967296 >>> 0;
    dropRing(c, x, Y(v), rad, a, undefined, mulberry32(s)); dropRing(g, x, Y(v), rad, .5, '0,200,90', mulberry32(s));
  }
  // grey water marks running down the sides to the bottom
  for (let i = 0; i < 40; i++){ const x = r() * W, v0 = .55 + r() * .4, l = (v0 - .1) * H * (.4 + r() * .6), wd = 2 + r() * 3, a = .15 + r() * .2; both((o, q) => dribble(c, x + o, Y(v0), l, wd, `rgba(170,166,154,${a})`, q)); }
  if (hot){
    // rust: an orange-brown stain where the stream lands, running down to the drain, and drips down from the rim under the spout
    for (let k = 0; k < 30; k++){ const x = U(.75 + (r() - .5) * .05), y = Y(.2 + r() * .12), rad = 6 + r() * 14, a = .12 + r() * .15; both(o => softBlob(c, x + o, y, rad, `rgba(150,92,52,${a})`)); }
    both(o => { c.fillStyle = 'rgba(140,84,46,.35)'; c.beginPath(); c.ellipse(U(.75) + o, Y(.12), W * .04, H * .1, 0, 0, 7); c.fill(); });
    for (let k = 0; k < 7; k++){ const x = U(.75 + (r() - .5) * .08), l = H * (.5 + r() * .3), wd = 2 + r() * 2.5, a = .2 + r() * .2; both((o, q) => dribble(c, x + o, Y(.97), l, wd, `rgba(146,90,50,${a})`, q)); }
    both(o => { g.fillStyle = 'rgba(0,200,70,.5)'; g.beginPath(); g.ellipse(U(.75) + o, Y(.16), W * .05, H * .14, 0, 0, 7); g.fill(); });
  }
  // a rusty ring right round the drain, where the strainer meets the bowl
  c.fillStyle = `rgba(128,82,48,${hot ? .55 : .3})`; c.fillRect(0, Y(.085), W, H * .03);
  g.fillStyle = 'rgba(0,210,60,.6)'; g.fillRect(0, Y(.085), W, H * .03);
  const t = (cv, srgb, aniso) => { const x = new THREE.CanvasTexture(cv); if (srgb) x.encoding = THREE.sRGBEncoding; x.anisotropy = aniso; x.wrapS = THREE.RepeatWrapping; return x; };
  const rm = t(rgh, false, ANISO);
  return new THREE.MeshStandardMaterial({ color: 0xc8cccd, map: t(col, true, ANISO), roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1,
    normalMap: t(normalFromHeight(hgt, W / 1.07, .5), false, Math.min(ANISO, 4)), normalScale: new THREE.Vector2(.5, .5), side: THREE.DoubleSide, envMapIntensity: 1.1 });
}
// ### The perforated strainer in each drain: rings of small holes round a centre screw, and a crust in the holes.
const strainerMat = new THREE.MeshStandardMaterial({ metalness: 1, roughness: .35, color: 0xd6dadb, map: canvasTex(128, 128, (g, w) => {
  g.fillStyle = '#e8e8e6'; g.fillRect(0, 0, w, w);
  for (const [n, rr] of [[6, .2], [12, .38], [18, .56], [24, .74]]) for (let i = 0; i < n; i++){
    const a = i / n * Math.PI * 2 + rr, x = w / 2 + Math.cos(a) * rr * w / 2, y = w / 2 + Math.sin(a) * rr * w / 2;
    g.fillStyle = '#0b0b0a'; g.beginPath(); g.arc(x, y, w * .028, 0, 7); g.fill();
    g.strokeStyle = 'rgba(200,190,160,.5)'; g.lineWidth = 1; g.stroke();
  }
  g.fillStyle = '#9a9c9a'; g.beginPath(); g.arc(w / 2, w / 2, w * .07, 0, 7); g.fill();
  g.fillStyle = '#2a2a28'; g.fillRect(w / 2 - w * .05, w / 2 - 1.5, w * .1, 3);
  softBlob(g, w * .4, w * .62, w * .3, 'rgba(150,100,60,.35)');
}) });
// ### Security bolt heads: smooth domes with two little holes, so no ordinary screwdriver fits.
const boltMat = new THREE.MeshStandardMaterial({ color: 0xb9bdbe, metalness: 1, roughness: .3 });
function securityBolt(x, y, z, nx, nz){
  const head = new THREE.Mesh(new THREE.SphereGeometry(.0075, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), boltMat);
  head.scale.y = .45; head.position.set(x, y, z); head.rotation.set(nz ? Math.sign(nz) * Math.PI / 2 : 0, 0, nx ? -Math.sign(nx) * Math.PI / 2 : 0); add(head);
  for (const s of [-1, 1]){
    const pin = new THREE.Mesh(new THREE.CircleGeometry(.0011, 8), M.dark);
    pin.position.set(x + nx * .0035 + (nz ? s * .0028 : 0), y, z + nz * .0035 + (nx ? s * .0028 : 0)); pin.lookAt(pin.position.x + nx, y, pin.position.z + nz); room.add(pin);
  }
}
// ### The bead of silicone where the unit meets the wall: once white, now yellowed, with grey mould in its lower parts.
const siliconeMat = new THREE.MeshStandardMaterial({ roughness: .55, map: canvasTex(32, 512, (g, w, h) => {
  g.fillStyle = '#d9d2bb'; g.fillRect(0, 0, w, h);
  const r = mulberry32(611);
  for (let i = 0; i < 600; i++){ const y = r() * h, low = y / h; g.fillStyle = `rgba(52,56,50,${(.08 + r() * .4) * (.3 + low)})`; g.beginPath(); g.arc(r() * w, y, .6 + r() * 1.8, 0, 7); g.fill(); }
  softBlob(g, w / 2, h * .9, h * .12, 'rgba(70,66,52,.35)');
}) });
function siliconeBead(len, x, y, z, along){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(.0048, .0048, len, 8), siliconeMat); m.position.set(x, y, z);
  if (along === 'z') m.rotation.x = Math.PI / 2;
  room.add(m); m.receiveShadow = true; return m;
}
{
  // the deck, cut out for the bowls (shape y becomes -z), its edges rounded off; its grain runs along the unit
  const ds = new THREE.Shape(); roundedRect(ds, -.242, -1.292, .242, 1.292, .02);
  for (const z of SINK.bowls){ const hole = new THREE.Path(); hole.absellipse(SINK.bx - SINK.x, -z, .148, .186, 0, Math.PI * 2, true); ds.holes.push(hole); }
  const dg = new THREE.ExtrudeGeometry(ds, { depth: .02, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 3, curveSegments: 28 });
  { const uv = dg.attributes.uv, G = SINK_STEEL.GRAIN; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) / G, uv.getX(i) / G); }
  dg.rotateX(-Math.PI / 2); dg.translate(SINK.x, SINK.top - .028, 0); add(new THREE.Mesh(dg, SINK_STEEL.mat));
  // the bowls, pressed in one piece: steep sides rounding into a flat bottom, a polished weld round the rim, a chrome
  // drain with a perforated strainer
  for (const z of SINK.bowls){
    const pts = [[0, -.155], [.045, -.153], [.09, -.146], [.125, -.128], [.152, -.1], [.17, -.066], [.18, -.036], [.185, -.014], [.19, -.006]];
    const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, SINK.top + y)), 44); geo.scale(.8, 1, 1); geo.translate(SINK.bx, 0, z);
    bowls.push(add(new THREE.Mesh(geo, sinkBowlMat(z < 0, z < 0 ? 77 : 78))));
    const weld = new THREE.Mesh(new THREE.TorusGeometry(.188, .0028, 6, 64), boltMat); weld.rotation.x = Math.PI / 2; weld.scale.set(.8, 1, 1);
    weld.position.set(SINK.bx, SINK.top - .002, z); room.add(weld);
    cyl(.031, .031, .003, M.chrome, SINK.bx, SINK.top - .1535, z, 28);   // the flange
    const strainer = new THREE.Mesh(new THREE.CircleGeometry(.027, 28), strainerMat); strainer.rotation.x = -Math.PI / 2; strainer.rotation.z = z;
    strainer.position.set(SINK.bx, SINK.top - .1515, z); room.add(strainer);
    // under the bowl: the tailpiece and the waste pipe into the wall, and the supply pipe
    cyl(.018, .018, .19, M.pipe, SINK.bx, SINK.top - .25, z, 12);
    cyl(.022, .022, .27, M.pipe, -3.865, SINK.top - .345, z, 12).rotation.z = Math.PI / 2;
    pipe(.72, -3.85, .36, z + (z < 0 ? -.1 : .1));
  }
  // a rolled front edge, an apron down to the knees and closed ends, so nothing can be hidden under the bowls
  sinkTube(.016, 2.6, -3.5, SINK.top - .014, 0, 16);
  sinkBox(.012, .25, 2.6, -3.506, SINK.top - .155, 0);
  for (const s of [-1, 1]) sinkBox(.494, .25, .012, -3.753, SINK.top - .155, s * 1.294);
  sinkTube(.008, 2.6, -3.503, SINK.top - .28, 0, 10);
  // the splashback with its rounded top, and a cove where it meets the deck
  sinkBox(.025, .22, 2.6, -3.9875, SINK.top + .11, 0);
  sinkTube(.0125, 2.6, -3.9875, SINK.top + .22, 0, 12);
  sinkTube(.009, 2.6, SINK.wall, SINK.top + .002, 0, 8);
  // over each bowl a short chrome spout with its aerator, a push button for cold (blue dot) and one for hot (red dot)
  const dot = c => new THREE.MeshStandardMaterial({ color: c, roughness: .45 });
  const red = dot(0xb33a2c), blue = dot(0x2c5a9a);
  for (const z of SINK.bowls){
    const curve = new THREE.CubicBezierCurve3(v3(SINK.wall - .002, SINK.top + .1, z), v3(-3.9, SINK.top + .108, z), v3(-3.82, SINK.top + .1, z), v3(-3.805, SINK.top + .066, z));
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, .0105, 10), M.chrome));
    cyl(.022, .022, .006, M.chrome, SINK.wall + .003, SINK.top + .1, z, 16).rotation.z = Math.PI / 2;
    cyl(.012, .0115, .014, M.chrome, -3.805, SINK.top + .058, z, 14); cyl(.0085, .0085, .002, M.dark, -3.805, SINK.top + .0505, z, 12);
    for (const [dz, mat] of [[.12, red], [-.12, blue]]){
      const bz = z - Math.sign(z) * dz, y = SINK.top + .145;
      cyl(.034, .034, .008, M.dullSteel, SINK.wall + .004, y, bz, 22).rotation.z = Math.PI / 2;
      const b = cyl(.022, .024, .02, M.chrome, SINK.wall + .016, y, bz, 22), c = cyl(.011, .011, .002, mat, SINK.wall + .027, y, bz, 16);
      b.rotation.z = c.rotation.z = Math.PI / 2;
      if (z < 0 && mat === red) hotButton.push(b, c);
    }
  }
  // the soap dish, pressed into a shallow tray, empty but for a crust of old soap
  sinkBox(.11, .005, .17, -3.88, SINK.top + .003, 0);
  for (const s of [-1, 1]){ sinkBox(.11, .016, .005, -3.88, SINK.top + .008, s * .083); sinkBox(.005, .016, .17, -3.88 + s * .053, SINK.top + .008, 0); }
  sinkDecal(.16, .1, -3.88, SINK.top + .0057, 0, true, (g, w, h) => {
    const r = mulberry32(912);
    for (let i = 0; i < 26; i++) softBlob(g, w * (.15 + r() * .7), h * (.2 + r() * .6), 3 + r() * 9, `rgba(226,214,196,${.25 + r() * .3})`);
    g.fillStyle = 'rgba(120,110,90,.35)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
  });
  // security bolts: along the top of the splashback, and two on each end panel where brackets hold it to the wall
  for (const z of [-1.2, -.3, .3, 1.2]) securityBolt(-3.9748, SINK.top + .19, z, 1, 0);
  for (const s of [-1, 1]) for (const y of [SINK.top - .07, SINK.top - .23]) securityBolt(-3.94, y, s * 1.3003, 0, s);
  // silicone along the top of the splashback and down both ends, where the unit meets the tiles
  siliconeBead(2.6, -3.9975, SINK.top + .2295, 0, 'z');
  for (const s of [-1, 1]) siliconeBead(.5, -3.9972, SINK.top - .03, s * 1.3015);
  // ### The wear on the flat parts. The deck: grime in the back corner, limescale drops and rings round both bowls (more
  // ### round the one with the running tap), a smear of soap from the dish, greasy hand marks along the front edge.
  sinkDecal(2.584, .484, SINK.x, SINK.top + .0006, 0, true, (g, w, h, X, Y) => {
    const r = mulberry32(1919), zpx = z => X(1.292 - z), xpx = x => Y(x - (SINK.x - .242));   // canvas x along the unit, y from the wall
    const back = g.createLinearGradient(0, 0, 0, xpx(SINK.x - .2)); back.addColorStop(0, 'rgba(74,64,48,.6)'); back.addColorStop(1, 'rgba(74,64,48,0)');
    g.fillStyle = back; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) softBlob(g, r() * w, xpx(SINK.x - .242 + Math.pow(r(), 2) * .06), 2 + r() * 8, `rgba(66,58,44,${.15 + r() * .25})`);
    for (const z of SINK.bowls){
      const hotOne = z < 0, cx = zpx(z), cy = xpx(SINK.bx);
      for (let i = 0; i < (hotOne ? 150 : 70); i++){
        const a = r() < .6 ? Math.PI / 2 + (r() - .5) * 2.2 : r() * Math.PI * 2, d = 1.04 + Math.pow(r(), 2.2) * (hotOne ? .6 : .45);   // most in front of the bowl
        const x = cx + Math.cos(a) * X(.186) * d, y = cy + Math.sin(a) * Y(.148) * d;
        dropRing(g, x, y, .6 + Math.pow(r(), 2) * 4, .1 + r() * .22, undefined, r);
      }
      softBlob(g, cx, cy + Y(.17), X(.12), `rgba(226,222,210,${hotOne ? .22 : .12})`);   // a dried splash halo in front of the bowl
    }
    for (let i = 0; i < 18; i++) softBlob(g, zpx((r() - .5) * .3), xpx(SINK.x - .15 + r() * .2), 4 + r() * 10, `rgba(220,208,186,${.15 + r() * .2})`);
    for (let i = 0; i < 40; i++) softBlob(g, r() * w, h - Y(Math.pow(r(), 2) * .07), 4 + r() * 10, `rgba(48,44,38,${.05 + r() * .07})`);
    // the bowls themselves are holes in the decal
    g.globalCompositeOperation = 'destination-out';
    for (const z of SINK.bowls){ g.fillStyle = '#000'; g.beginPath(); g.ellipse(zpx(z), xpx(SINK.bx), X(.186) - 1, Y(.148) - 1, 0, 0, 7); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  });
  // the splashback: limescale and a rusty trickle under the spouts, grime ringing the push buttons and in the cove
  sinkDecal(2.58, .2, SINK.wall + .0006, SINK.top + .105, 0, false, (g, w, h, X, Y) => {
    const r = mulberry32(2024), zpx = z => X(1.29 - z), ypx = y => Y(SINK.top + .205 - y);
    const cove = g.createLinearGradient(0, h, 0, h - Y(.04)); cove.addColorStop(0, 'rgba(70,60,46,.6)'); cove.addColorStop(1, 'rgba(70,60,46,0)');
    g.fillStyle = cove; g.fillRect(0, 0, w, h);
    for (const z of SINK.bowls){
      const hotOne = z < 0;
      for (let i = 0; i < (hotOne ? 60 : 28); i++){ const x = zpx(z) + (r() - .5) * X(.36), y = ypx(SINK.top + .01 + Math.pow(r(), 1.8) * .1); dropRing(g, x, y, .5 + Math.pow(r(), 2) * 3, .1 + r() * .2, undefined, r); }
      for (let k = 0; k < (hotOne ? 6 : 3); k++) dribble(g, zpx(z) + (r() - .5) * X(.05), ypx(SINK.top + .09), Y(.08), 1.5 + r() * 2, hotOne && k < 3 ? `rgba(140,86,48,${.3 + r() * .2})` : `rgba(230,226,214,${.25 + r() * .2})`, r);
      for (const dz of [.12, -.12]){ const bz = z - Math.sign(z) * dz; g.strokeStyle = 'rgba(58,50,38,.45)'; g.lineWidth = 3; g.beginPath(); g.arc(zpx(bz), ypx(SINK.top + .145), X(.036), 0, 7); g.stroke(); softBlob(g, zpx(bz), ypx(SINK.top + .145), X(.05), 'rgba(50,46,40,.18)'); }
    }
    for (let i = 0; i < 90; i++) softBlob(g, r() * w, ypx(SINK.top + Math.pow(r(), 2) * .1), 2 + r() * 6, `rgba(64,56,44,${.1 + r() * .2})`);
  });
  // the apron: dried drips down from the rolled edge, black scuffs from shoes and knees, dirt from the mop at the bottom
  sinkDecal(2.58, .25, -3.5 + .0006, SINK.top - .155, 0, false, (g, w, h, X, Y) => {
    const r = mulberry32(2025);
    for (let i = 0; i < 38; i++){ const x = r() * w, rust = r() < .2; dribble(g, x, 0, Y(.03 + Math.pow(r(), 1.5) * .2), .8 + r() * 2, rust ? `rgba(140,88,52,${.1 + r() * .16})` : `rgba(226,222,212,${.08 + r() * .16})`, r); }
    for (let i = 0; i < 16; i++){
      const x = r() * w, y = h - Y(.015 + Math.pow(r(), 1.5) * .12), l = X(.015 + r() * .05), a = (r() - .5) * .6;
      g.strokeStyle = `rgba(24,22,20,${.08 + r() * .2})`; g.lineWidth = .8 + r() * 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y + (r() - .5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const mop = g.createLinearGradient(0, h, 0, h - Y(.07)); mop.addColorStop(0, 'rgba(78,66,48,.55)'); mop.addColorStop(1, 'rgba(78,66,48,0)');
    g.fillStyle = mop; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) softBlob(g, r() * w, Y(.01 + r() * .05), 6 + r() * 14, `rgba(40,38,34,${.08 + r() * .1})`);   // hands on the edge
  });
}
hot('tap', ...hotButton, bowls[0]);
// ### The mirror: a sheet of polished steel (MIRROR draws its picture) on a backing plate, in a frame of steel channel held
// ### by tamper-proof screws. The steam lies on it, under the frame.
const mirror = plane(MIRROR.SIZE[0], MIRROR.SIZE[1], MIRROR.mat, MIRROR.P0.x, MIRROR.P0.y, MIRROR.P0.z, Math.PI / 2);
// the backing plate and the frame are brushed steel like the sinks, their grain along each bar
sinkBox(.01, .8, 2.28, -3.996, 1.6, 0);
for (const s of [-1, 1]){ sinkBox(.026, .04, 2.24, -3.983, 1.6 + s * .37, 0); sinkBox(.026, .78, .04, -3.983, 1.6, s * 1.1); }
for (const [y, z] of [[-.37, -1.1], [-.37, -.55], [-.37, 0], [-.37, .55], [-.37, 1.1], [.37, -1.1], [.37, -.55], [.37, 0], [.37, .55], [.37, 1.1], [0, -1.1], [0, 1.1]]){
  cyl(.008, .008, .004, M.chrome, -3.968, 1.6 + y, z, 10).rotation.z = Math.PI / 2; cyl(.0025, .0025, .005, M.dark, -3.968, 1.6 + y, z, 6).rotation.z = Math.PI / 2;
}
const steam = plane(2.2, .72, M.steam, -3.975, 1.6, 0, Math.PI / 2); steam.renderOrder = 2;
hot('read:mirror', mirror, steam); hot('play:mirror', mirror, steam);
mirror.material = MIRROR.mat;   // hot() gave it a copy, but the mirror's picture is bound to the one material
MIRROR.hide.push(mirror, steam);
const steamPuffs = [];
const puffTex = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
for (let i = 0; i < 14; i++){ const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false })); s.userData.t = i / 14; room.add(s); steamPuffs.push(s); }
// ### The running hot tap: a thin stream from the spout down into the bowl, its surface sliding downwards, and a
// ### splash where it lands. Shown while the tap is on.
const tapStream = (() => {
  const wrnd = mulberry32(2803), top = SINK.top + .05, bottom = SINK.top - .145, x = -3.805, z = SINK.bowls[0];
  const tex = canvasTex(32, 256, (g, w, h) => {
    g.fillStyle = 'rgba(235,242,245,.45)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++){ g.fillStyle = `rgba(255,255,255,${.2 + wrnd() * .6})`; g.fillRect(wrnd() * w, wrnd() * h, 1 + wrnd() * 3, 6 + wrnd() * 40); }
    for (let i = 0; i < 40; i++){ g.fillStyle = `rgba(120,140,150,${.1 + wrnd() * .2})`; g.fillRect(wrnd() * w, wrnd() * h, 1 + wrnd() * 2, 4 + wrnd() * 20); }
  }, [1, 1]);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.0042, .0055, top - bottom, 12, 1, true), new THREE.MeshStandardMaterial({ map: tex, color: 0xdbe6ea, roughness: .05, metalness: .4, transparent: true, depthWrite: false }));
  mesh.position.set(x, (top + bottom) / 2, z); mesh.visible = false; room.add(mesh);
  const splash = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xe8f0f2, transparent: true, opacity: 0, depthWrite: false }));
  splash.position.set(x, bottom + .012, z); room.add(splash);
  return {
    // ### Moves the water on: the stream's surface slides down and the splash flickers while the tap runs.
    update(dt, t){
      mesh.visible = splash.visible = !!S.steam;
      if (!mesh.visible) return;
      tex.offset.y = (tex.offset.y + dt * 2.2) % 1;
      const k = REDUCED ? 0 : 1;
      mesh.rotation.y = Math.sin(t * 13) * .3 * k; mesh.scale.x = mesh.scale.z = 1 + Math.sin(t * 37) * .08 * k;
      splash.material.opacity = .28 + Math.sin(t * 29) * .08 * k; splash.scale.setScalar(.035 + Math.sin(t * 23) * .006 * k);
    }
  };
})();

// ---------- Mop and bucket ----------
// ### A janitor's round bucket of yellow moulded plastic in the south-east corner, a quarter full of grey mop water, and a
// ### cotton string mop standing in it, its wooden handle leaning into the corner. Both are built here from many small
// ### parts (no model files): the bucket is turned on a lathe with a rolled rim, a foot ring and two ribs, scuffed and
// ### grubby with a faded stencil and a tide line inside; the mop is about a hundred and fifty yarn strands gripped in a
// ### steel clamp on a varnished handle. Wedged against the door, the handle braces under the door handle and presses on
// ### the door leaf, and the strands lie spread on the floor.
const BUCKET = { x: 3.35, z: 2.45, water: .11, bottom: .026 };
// the bucket's wall: radius at height y outside and inside
const bucketOut = y => .158 + (y - .016) * .109, bucketIn = y => bucketOut(y) - .007;
const bucketProfile = (() => {
  const p = [[0, .003], [.13, .003], [.148, .006], [.156, .011], [.158, .016]];
  for (let i = 1; i <= 20; i++){ const y = .016 + i * .0157, rib = Math.abs(y - .1) < .01 || Math.abs(y - .262) < .01 ? .0045 : 0; p.push([bucketOut(y) + rib, y]); }
  p.push([.2, .338], [.207, .341], [.209, .347], [.205, .353], [.196, .354], [.189, .349]);
  for (let i = 1; i <= 8; i++){ const y = .345 - i * (.345 - BUCKET.bottom) / 8; p.push([bucketIn(y), y]); }
  p.push([.11, BUCKET.bottom], [0, BUCKET.bottom]);
  return p.map(([x, y]) => new THREE.Vector2(x, y));
})();
// ### The bucket's plastic: yellow, scuffed and streaked on the outside with a faded stencil, dirty inside with a grey
// ### tide line where the mop water stands. The picture runs once round (u) and along the lathe profile (v).
const bucketTex = canvasTex(1024, 256, (g, w, h) => {
  const n = bucketProfile.length, rowOf = j => (1 - j / (n - 1)) * h, out0 = rowOf(4), out1 = rowOf(25), in0 = rowOf(31);
  g.fillStyle = '#e2ad1c'; g.fillRect(0, 0, w, h);
  // inside: darker, with a dirty tide line at the water level and silt at the bottom
  const tide = rowOf(30 + 8 * (.345 - BUCKET.water) / (.345 - BUCKET.bottom));
  const ig = g.createLinearGradient(0, in0, 0, h); ig.addColorStop(0, '#b98d1f'); ig.addColorStop(1, '#5c5032'); g.fillStyle = ig; g.fillRect(0, in0, w, h - in0);
  g.fillStyle = 'rgba(70,64,48,.55)'; g.fillRect(0, tide - 5, w, 7); g.fillStyle = 'rgba(70,64,48,.2)'; g.fillRect(0, tide - 14, w, 9);
  // outside: grime gathered towards the foot, drips run down from the rim, scuffs from being kicked about
  const og = g.createLinearGradient(0, out1, 0, out0); og.addColorStop(0, 'rgba(90,70,30,0)'); og.addColorStop(.75, 'rgba(90,70,30,.12)'); og.addColorStop(1, 'rgba(70,55,25,.45)');
  g.fillStyle = og; g.fillRect(0, out1, w, out0 - out1);
  for (let i = 0; i < 34; i++){
    const x = rnd() * w, y0 = out1 + rnd() * 8, len = 20 + rnd() * (out0 - out1) * .9;
    g.strokeStyle = `rgba(95,80,45,${.08 + rnd() * .14})`; g.lineWidth = 1 + rnd() * 2.5;
    g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + (rnd() - .5) * 6, y0 + len / 2, x + (rnd() - .5) * 4, y0 + len); g.stroke();
  }
  for (let i = 0; i < 55; i++){
    const x = rnd() * w, y = out1 + rnd() * (out0 - out1), l = 4 + rnd() * 26, a = (rnd() - .5) * .7;
    g.strokeStyle = rnd() < .6 ? `rgba(255,236,170,${.15 + rnd() * .2})` : `rgba(60,45,20,${.12 + rnd() * .2})`; g.lineWidth = .6 + rnd();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  grime(g, w, out0, 26, 'rgba(80,62,28,.18)', 30, true);
  // a faded stencil, twice round the bucket
  g.save(); g.font = '800 30px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const u of [.12, .62]){
    g.fillStyle = 'rgba(28,26,22,.62)'; g.fillText('BLOCK D', u * w, out1 + (out0 - out1) * .42);
    g.font = '700 21px "Arial Narrow", Arial, sans-serif'; g.fillText('WASHROOM 2', u * w, out1 + (out0 - out1) * .62); g.font = '800 30px "Arial Narrow", Arial, sans-serif';
  }
  g.restore();
  // the stencil has worn away in flecks
  for (const u of [.12, .62]) for (let i = 0; i < 260; i++){ g.fillStyle = `rgba(226,173,28,${.5 + rnd() * .5})`; g.fillRect((u - .07 + rnd() * .14) * w, out1 + (out0 - out1) * (.3 + rnd() * .42), 1 + rnd() * 2, 1 + rnd() * 2); }
  // the rim is rubbed paler
  g.fillStyle = 'rgba(255,240,190,.18)'; g.fillRect(0, out1 - (out1 - in0) * .9, w, (out1 - in0) * .7);
});
{
  const bucket = new THREE.Mesh(new THREE.LatheGeometry(bucketProfile, 48), new THREE.MeshStandardMaterial({ map: bucketTex, roughness: .48 }));
  bucket.position.set(BUCKET.x, 0, BUCKET.z); bucket.rotation.y = .9; add(bucket);
  // ### The mop water mirrors the room like the puddles do (WATER.bucket); this picture is the grey scum and the bubbles
  // ### floating on it, on black (no scum).
  const scumTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++){ const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(170,165,145,.6)'); gr.addColorStop(1, 'rgba(170,165,145,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 90; i++){ const x = rnd() * w, y = rnd() * h, r = .8 + rnd() * 3; g.strokeStyle = 'rgba(225,225,210,.6)'; g.lineWidth = .8; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
  });
  WATER.bucket(bucketIn(BUCKET.water) - .001, BUCKET.x, BUCKET.water, BUCKET.z, scumTex);
  // the wire handle with its plastic grip, hooked into two lugs on the rim and dropped down over the front
  const lugs = new THREE.Group(); lugs.position.set(BUCKET.x, .322, BUCKET.z); lugs.rotation.y = -.75; room.add(lugs);
  const lugMat = new THREE.MeshStandardMaterial({ map: bucketTex, roughness: .5 });
  for (const s of [-1, 1]){ const l = new THREE.Mesh(new THREE.BoxGeometry(.018, .05, .03), lugMat); l.position.set(s * .2, -.006, 0); add(l, lugs); }
  const arc = new THREE.Group(); arc.rotation.x = -1.28; lugs.add(arc);
  add(new THREE.Mesh(new THREE.TorusGeometry(.214, .0028, 6, 40, Math.PI), M.dullSteel), arc);
  for (const s of [-1, 1]){ const hook = new THREE.Mesh(new THREE.TorusGeometry(.007, .0026, 5, 10), M.dullSteel); hook.position.set(s * .214, 0, 0); hook.rotation.y = Math.PI / 2; add(hook, arc); }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .1, 12), M.black); grip.rotation.z = Math.PI / 2; grip.position.y = .214; add(grip, arc);
}

// ### Varnished wood for the mop handle: grain running along it, darker and greyer at the foot where it stands in the
// ### water, and polished darker where hands hold it.
const mopWoodTex = canvasTex(64, 512, (g, w, h) => {
  g.fillStyle = '#a8865a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 46; i++){
    const x = rnd() * w; g.strokeStyle = `rgba(${rnd() < .5 ? '110,72,36' : '210,170,115'},${.15 + rnd() * .3})`; g.lineWidth = .5 + rnd() * 2.2;
    g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * .02 + i) * 1.5, y); g.stroke();
  }
  const foot = g.createLinearGradient(0, h * .82, 0, h); foot.addColorStop(0, 'rgba(70,62,48,0)'); foot.addColorStop(1, 'rgba(70,62,48,.7)'); g.fillStyle = foot; g.fillRect(0, h * .82, w, h * .18);
  const hand = g.createLinearGradient(0, h * .04, 0, h * .4); hand.addColorStop(0, 'rgba(70,45,25,.35)'); hand.addColorStop(1, 'rgba(70,45,25,0)'); g.fillStyle = hand; g.fillRect(0, h * .04, w, h * .36);
});
const MOP_LEN = 1.37, MOP_R = .0125;
// ### Cotton yarn: no picture, each strand has its own colour, a used mop's grubby grey-brown, darker and browner towards
// ### the tips, with dark blotches of old dirt and darker still where wet;
// ### a twist pattern on strands this thin only shimmers.
const mopYarn = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
// ### Where the mop stands: the middle of its clamp and the end of its handle. In the corner the handle leans into the
// ### corner of the two walls. At the door its end is jammed into the gap between the door leaf (face at z 2.90) and the
// ### lever of the door handle (a bar along x at y 1.02, z 2.86, radius 0.022): the end presses on the door and the lever
// ### rests on top of the handle, so the door cannot swing in.
function mopPose(clamp, top, floor, wall){
  const u = top.clone().sub(clamp).normalize(), q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), u);
  return { p: clamp, q, r: new THREE.Euler().setFromQuaternion(q), floor, wall };
}
const MOP_CORNER = mopPose(v3(3.3, .26, 2.41), v3(3.976, 0, 2.976), BUCKET.bottom, true);
const MOP_DOOR = mopPose(v3(.26, .05, 0), v3(.36, .975, 2.904), 0, false);
// the handle is always MOP_LEN long: solve for the missing height (corner) or distance (door)
{ const c = MOP_CORNER.p, h = Math.hypot(3.976 - c.x, 2.976 - c.z); Object.assign(MOP_CORNER, mopPose(c, v3(3.976, c.y + Math.sqrt(MOP_LEN ** 2 - h ** 2), 2.976), BUCKET.bottom, true)); }
{ // the end sits 8 mm into the door leaf, so the tilted end of the handle meets its face; its height is found (by halving)
  // where the handle just touches the underside of the lever
  const LEVER = { y: 1.02, z: 2.86, r: .022 }, ex = .37, ez = 2.908, dx = -.06;
  const at = ey => { const dy = ey - .05, dz = Math.sqrt(MOP_LEN ** 2 - dy * dy - dx * dx); return v3(ex + dx, .05, ez - dz); };
  let lo = .95, hi = 1.06;
  for (let i = 0; i < 40; i++){
    const ey = (lo + hi) / 2, c = at(ey), u = v3(ex, ey, ez).sub(c).normalize(), n = Math.hypot(u.y, u.z);
    const gap = ((LEVER.y - ey) * u.z - (LEVER.z - ez) * u.y) / n - LEVER.r - MOP_R;   // from the handle's axis to the lever's, less both radii
    if (gap > 0) lo = ey; else hi = ey;
  }
  const t = v3(ex, lo, ez); Object.assign(MOP_DOOR, mopPose(at(lo), t, 0, false));
}
// ### The strands for one pose: each starts in the clamp, falls out to its side and drops; it lies down where it reaches
// ### the floor (or the bucket's bottom) and stays inside the bucket's wall. Built in the room's coordinates and then
// ### moved into the mop's own, so the strands hang right for the pose they belong to. Returns one mesh of all strands.
function mopFringe(pose){
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(pose.q), ax = v3(1, 0, 0).applyMatrix4(rot), az = v3(0, 0, 1).applyMatrix4(rot), up = v3(0, 1, 0).applyMatrix4(rot);
  const toLocal = new THREE.Matrix4().compose(pose.p, pose.q, v3(1, 1, 1)).invert();
  const SEG = 18, SIDES = 6, N = 150, R = .0055, pos = [], nor = [], col = [], uv = [], idx = [];
  for (let s = 0; s < N; s++){
    const side = s % 2 ? 1 : -1, a = (rnd() * 2 - 1), dirt = .7 + rnd() * .3, shade = .8 + rnd() * .3, brown = rnd(), blot = rnd() < .6 ? .25 + rnd() * .3 : 0, bf = 6 + rnd() * 10, bp = rnd() * 7, len = .25 + rnd() * .07, seg = len / SEG;
    let p = pose.p.clone().addScaledVector(ax, a * .066).addScaledVector(az, side * (.006 + rnd() * .014)).addScaledVector(up, -.014);
    let d = az.clone().multiplyScalar(side * (.5 + rnd() * .4)).addScaledVector(ax, a * .35).addScaledVector(up, -.6).normalize();
    const pts = [p.clone()];
    for (let k = 0; k < SEG; k++){
      if (d.y > -.04 || p.y > pose.floor + R * 2){ d.y -= .45 + rnd() * .1; d.x += (rnd() - .5) * .14; d.z += (rnd() - .5) * .14; d.normalize(); }
      p = p.clone().addScaledVector(d, seg);
      if (p.y < pose.floor + R){ p.y = pose.floor + R; d.y = 0; d.x += (rnd() - .5) * .14; d.z += (rnd() - .5) * .14; d.normalize(); d.y = -.03; }
      if (pose.wall){
        const dx = p.x - BUCKET.x, dz = p.z - BUCKET.z, rr = Math.hypot(dx, dz), lim = bucketIn(p.y) - R - .004;
        if (rr > lim){ p.x = BUCKET.x + dx / rr * lim; p.z = BUCKET.z + dz / rr * lim; d.x -= dx / rr * .6; d.z -= dz / rr * .6; d.normalize(); }
      }
      pts.push(p);
    }
    // a tube round the strand's points; its colour follows its length
    const base = pos.length / 3; let n0 = null, arcLen = 0;
    for (let k = 0; k <= SEG; k++){
      const t = pts[Math.min(SEG, k + 1)].clone().sub(pts[Math.max(0, k - 1)]).normalize();
      if (!n0) n0 = Math.abs(t.y) < .9 ? v3(0, 1, 0).cross(t).normalize() : v3(1, 0, 0).cross(t).normalize();
      n0 = n0.clone().sub(t.clone().multiplyScalar(n0.dot(t))).normalize();
      const b = t.clone().cross(n0), f = k / SEG, rad = R * (k === SEG ? .25 : 1 - .25 * f * f);
      if (k) arcLen += pts[k].distanceTo(pts[k - 1]);
      // linear colours: a dingy grey (about #5a5954) near the clamp, a muddy brown-grey (about #38342c) at the tips; the
      // warm lamps of the washroom lift them a good deal
      const wet = pose.wall && pts[k].y < BUCKET.water ? .5 : 1, m = Math.min(1, dirt * Math.pow(f, 1.1)), stain = 1 - blot * Math.max(0, Math.sin(f * bf + bp));
      const top = [.1 + .008 * brown, .1, .09 - .012 * brown], tip = [.04 + .006 * brown, .035, .026 - .004 * brown], k2 = shade * stain * wet;
      const c = top.map((v, i) => (v + (tip[i] - v) * m) * k2);
      for (let j = 0; j < SIDES; j++){
        const an = j / SIDES * Math.PI * 2, nv = n0.clone().multiplyScalar(Math.cos(an)).addScaledVector(b, Math.sin(an));
        const v = pts[k].clone().addScaledVector(nv, rad).applyMatrix4(toLocal), nl = nv.clone().transformDirection(toLocal);
        pos.push(v.x, v.y, v.z); nor.push(nl.x, nl.y, nl.z); col.push(...c); uv.push(arcLen / .03, j / SIDES);
      }
    }
    for (let k = 0; k < SEG; k++) for (let j = 0; j < SIDES; j++){
      const a0 = base + k * SIDES + j, a1 = base + k * SIDES + (j + 1) % SIDES, b0 = a0 + SIDES, b1 = a1 + SIDES;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mopYarn); m.castShadow = true;   // no shadows on itself: on strands this thin they only flicker
  return m;
}
const mop = new THREE.Group();
const mopStick = new THREE.Mesh(new THREE.CylinderGeometry(MOP_R, MOP_R, MOP_LEN - .12, 14), new THREE.MeshStandardMaterial({ map: mopWoodTex, roughness: .42 }));
mopStick.position.y = .06 + (MOP_LEN - .12) / 2;
// the blue plastic cap on the end of the handle, with its rounded tip
const mopCapMat = new THREE.MeshStandardMaterial({ color: 0x2c5a86, roughness: .38 });
const mopCap = new THREE.Mesh(new THREE.CylinderGeometry(MOP_R + .002, MOP_R + .002, .055, 14), mopCapMat); mopCap.position.y = MOP_LEN - .06 - .0275 + .0035;
const mopTip = new THREE.Mesh(new THREE.SphereGeometry(MOP_R + .002, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), mopCapMat); mopTip.scale.y = .4; mopTip.position.y = MOP_LEN - .06 + .0035;
// the clamp: a steel ferrule on the handle and a jaw that grips the folded strands, closed with a bolt and a wing nut
const mopFerrule = new THREE.Mesh(new THREE.CylinderGeometry(MOP_R + .003, MOP_R + .006, .075, 14), M.dullSteel); mopFerrule.position.y = .05;
const mopJaw = new THREE.Mesh(new THREE.BoxGeometry(.15, .03, .046), M.dullSteel); mopJaw.position.y = .008;
const mopJawLip = new THREE.Mesh(new THREE.BoxGeometry(.156, .008, .05), M.dullSteel); mopJawLip.position.y = -.008;
const mopBolt = new THREE.Mesh(new THREE.CylinderGeometry(.0045, .0045, .07, 8), M.steel); mopBolt.rotation.x = Math.PI / 2; mopBolt.position.set(.05, .008, 0);
const mopNut = new THREE.Mesh(new THREE.BoxGeometry(.03, .012, .006), M.steel); mopNut.position.set(.05, .008, .031);
const mopBoltHead = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, .005, 6), M.steel); mopBoltHead.rotation.x = Math.PI / 2; mopBoltHead.position.set(.05, .008, -.026);
const fringeCorner = mopFringe(MOP_CORNER), fringeDoor = mopFringe(MOP_DOOR);
for (const m of [mopStick, mopCap, mopTip, mopFerrule, mopJaw, mopJawLip, mopBolt, mopNut, mopBoltHead]){ m.castShadow = m.receiveShadow = true; mop.add(m); }
mop.add(fringeCorner, fringeDoor); room.add(mop);
hot('take:mop', mopStick, mopFerrule, mopJaw, fringeCorner);
// The scratches in the tiles beside the door (east of the door frame, facing into the room)
const scratches = plane(1.0, .62, M.scratches, 1.75, 1.3, D / 2 - .006, Math.PI);
hot('read:scratches', scratches); hot('play:scratches', scratches);

// The toilet stall: partitions, steel toilet, graffiti, the crooked tile and the hatch in the floor
const SX0 = 1.5, SZ1 = -.7;
// the partition stands on two feet 15 cm off the floor; the pilasters run from the floor to the headrail
{
  const side = add(new THREE.Mesh(panelGeo(2.285, 1.9, .04), panelMaterial(2.285, 1.9, .15)));
  side.position.set(SX0, .15, SZ1); side.rotation.y = Math.PI / 2;   // its own x runs to -z, its front faces into the stall
  for (const [x, grips] of [[SX0, [[1, 1.12]]], [3.7, [[0, 1.3]]]]) add(new THREE.Mesh(panelGeo(.3, 2.03, .04), panelMaterial(.3, 2.03, .02, grips))).position.set(x, .02, SZ1);
}
// ### The stall's hardware, all brushed stainless: an anti-grip headrail (a rounded profile with a flat underside) with end
// ### caps and a wall bracket, a U-channel that holds the partition to the wall along its whole height, two round
// ### adjustable feet under the partition, and shoes round the foot of each pilaster.
{
  const hr = new THREE.Shape(); hr.moveTo(-.025, 0); hr.lineTo(.025, 0); hr.lineTo(.025, .022); hr.absarc(0, .022, .025, 0, Math.PI, false); hr.closePath();
  const rail = add(new THREE.Mesh(new THREE.ExtrudeGeometry(hr, { depth: 2.52, bevelEnabled: false, curveSegments: 12 }), M.steel));
  rail.rotation.y = Math.PI / 2; rail.position.set(SX0 - .02, 2.033, SZ1);
  for (const x of [SX0 - .022, 4.0 - .005]){ const cap = add(new THREE.Mesh(new THREE.ExtrudeGeometry(hr, { depth: .004, bevelEnabled: false, curveSegments: 12 }), M.dullSteel)); cap.rotation.y = Math.PI / 2; cap.position.set(x, 2.033, SZ1); cap.scale.set(1.08, 1.08, 1); }
  box(.008, .09, .07, M.dullSteel, 3.996, 2.05, SZ1);   // the bracket that holds the rail to the east wall
  // the U-channel along the wall joint, with its screws
  for (const dx of [-.024, .024]) box(.003, 1.86, .03, M.steel, SX0 + dx, 1.08, -2.985);
  box(.051, 1.86, .003, M.steel, SX0, 1.08, -2.9985);
  for (const y of [.35, .8, 1.25, 1.7]) for (const dx of [-.026, .026]){ const sc = cyl(.004, .004, .003, M.chrome, SX0 + dx, y, -2.975, 6); sc.rotation.z = Math.PI / 2; }
  // the partition's feet: a round base on the floor, a threaded post and a clamp round the panel's lower edge
  for (const z of [-2.75, SZ1 - .12]){
    cyl(.034, .038, .012, M.steel, SX0, .006, z, 20); cyl(.011, .011, .14, M.chrome, SX0, .08, z, 12); cyl(.016, .016, .02, M.dullSteel, SX0, .045, z, 6);
    box(.052, .045, .05, M.steel, SX0, .16, z);
  }
  // ### Where the partition meets the back of the front pilaster, three stirrup brackets hold it, as on a real stall: a
  // ### flange on each face of the partition, bolted through it, and on the stall side an ear screwed to the pilaster
  // ### (on the outside the partition ends flush with the pilaster's edge, so there is nothing to screw to).
  for (const y of [.42, 1.1, 1.78]){
    for (const s of [-1, 1]){
      box(.003, .07, .04, M.steel, SX0 + s * .0215, y, SZ1 - .04);
      const bolt = cyl(.0055, .0055, .003, M.chrome, SX0 + s * .0245, y, SZ1 - .045, 10); bolt.rotation.z = Math.PI / 2;
    }
    box(.026, .07, .003, M.steel, SX0 + .0345, y, SZ1 - .0215);
    for (const dy of [-.02, .02]){ const sc = cyl(.0042, .0042, .003, M.chrome, SX0 + .038, y + dy, SZ1 - .0235, 8); sc.rotation.x = Math.PI / 2; }
  }
}
// steel edge caps on the partitions
box(.055, 1.9, .012, M.dullSteel, SX0, 1.1, SZ1 - .01); box(.012, 1.9, .05, M.dullSteel, SX0 + .3, 1.1, SZ1); box(.012, 1.9, .05, M.dullSteel, 3.7, 1.1, SZ1);
// shoes round the foot of each pilaster: a rounded stainless sleeve
for (const x of [SX0 + .15, 3.85]){
  const sh = new THREE.Shape(); roundedRect(sh, -.162, -.03, .162, .03, .012);
  const g = new THREE.ExtrudeGeometry(sh, { depth: .09, bevelEnabled: true, bevelThickness: .006, bevelSize: .004, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(x, .006, SZ1); add(new THREE.Mesh(g, M.steel));
}
// the stall door stands open against the east wall: hinges, a slide latch and a coat hook
{
  const pivot = new THREE.Group(); pivot.position.set(3.7, 0, SZ1 + .025); pivot.rotation.y = 1.72; room.add(pivot);
  const put = m => { m.castShadow = m.receiveShadow = true; pivot.add(m); return m; };
  const bx = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return put(m); };
  put(new THREE.Mesh(panelGeo(.86, 1.62, .03), panelMaterial(.86, 1.62, .23, [[.08, 1.12], [.5, 1.5]]))).position.set(-.88, .23, 0);
  for (const y of [.42, 1.04, 1.66]){
    const h = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .12, 12), M.steel); h.position.set(-.005, y, .02); put(h);
    for (const z of [-.017, .017]) bx(.07, .11, .003, M.steel, -.045, y, z);   // the hinge's leaves wrap round the door's edge
    for (const y2 of [-.035, .035]) for (const z of [-.019, .019]){ const sc = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .002, 6), M.chrome); sc.rotation.x = Math.PI / 2; sc.position.set(-.06, y + y2, z); put(sc); }
  }
  // the occupancy indicator on the outside of the door: a steel rosette with a little window showing green, free
  { const ind = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .006, 24), M.steel); ind.rotation.x = Math.PI / 2; ind.position.set(-.8, 1.12, -.018); put(ind);
    const freeTex = canvasTex(64, 32, (g, w, h) => { g.fillStyle = '#2f8a3a'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9f2e6'; g.font = 'bold 16px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('FREE', w / 2, 22); });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(.034, .016), new THREE.MeshStandardMaterial({ map: freeTex, roughness: .4 })); win.rotation.y = Math.PI; win.position.set(-.8, 1.128, -.0215); pivot.add(win); }
  bx(.1, .035, .02, M.steel, -.8, 1.12, .028); bx(.025, .02, .03, M.steel, -.77, 1.12, .045);
  bx(.03, .06, .015, M.steel, -.45, 1.62, -.024); const hook = new THREE.Mesh(new THREE.TorusGeometry(.022, .006, 6, 12, Math.PI), M.steel); hook.position.set(-.45, 1.58, -.045); hook.rotation.set(0, Math.PI / 2, Math.PI); put(hook);
}
box(.035, .06, .02, M.steel, SX0 + .3, 1.12, SZ1 + .03);   // the latch keeper on the other pilaster

// ### The toilet: a stainless-steel prison pan with a low-level cistern on the wall above it, both of the same polished
// ### steel (M.bowl: the scanned scratches of Poly Haven's "Blue Metal Plate", fetched through its API, with the vault
// ### HDRI in the reflections). The pan is one turned piece (foot, waist, flaring sides, a rolled rim, no seat) with a
// ### flush horn welded to its back under the rim. The cistern is pressed sheet steel: round corners, rounded edges and
// ### a front that bows out a little, as thin sheet does, so the light slides over it; a lid with a turned-down lip, a
// ### dual flush button, security screws, a stamped plate, and soft runs of limescale and rust from the lid's lip.
// ### Cistern and pan are joined the way a real low-level cistern is: the flush pipe leaves the cistern through its
// ### outlet nut, runs down the wall, bends forward and slides into the horn through a black rubber connector. The cold
// ### water comes from a stop valve on the wall into the side of the cistern.
const TOILET = { x: 3.25, z: -2.82, top: .958 }, BOWL_Z = -2.418, BOWL_SZ = 1.22;
{
  const T = TOILET, WALLZ = -2.986;
  const mesh = (geo, mat) => add(new THREE.Mesh(geo, mat));
  const lathe = (pts, seg, sx, sz, x, z) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); g.scale(sx, 1, sz); g.translate(x, 0, z); return mesh(g, M.bowl); };
  // a decal that casts no shadow: limescale and dirt are not metal, so they are matt and lie on top of the steel
  const decalMat = map => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: .85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  // ### A pressed steel box. Seen from above it is a rectangle (half sizes hw and hd round cx, cz) with round corners
  // ### (radius R); its top and bottom edges are rounded off too (rt, rb, 0 for a sharp edge). bulge(x, y) says how far
  // ### the front stands out of the flat (x from the middle). It is built ring by ring from the bottom up and closed with
  // ### a flat top and bottom, its normals smooth all round; the scan is laid on in metres, the same size as on the bowl.
  const steelBox = (cx, cz, hw, hd, y0, y1, R, rt, rb, bulge) => {
    const K = 8, BACK = 3, FRONT = 12, SIDE = 6, ax = hw - R, az = hd - R;
    // the outline inset metres in from the outside, from the middle of the back (against the wall) all the way round
    const outline = inset => {
      const r = R - inset, pts = [[0, -az - r]];
      const line = (x0, z0, x1, z1, n) => { for (let i = 1; i < n; i++) pts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
      const arc = (x, z, a0) => { for (let i = 0; i <= K; i++){ const a = a0 + Math.PI / 2 * i / K; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } };
      line(0, -az - r, ax, -az - r, BACK); arc(ax, -az, -Math.PI / 2);
      line(ax + r, -az, ax + r, az, SIDE); arc(ax, az, 0);
      line(ax, az + r, -ax, az + r, FRONT); arc(-ax, az, Math.PI / 2);
      line(-ax - r, az, -ax - r, -az, SIDE); arc(-ax, -az, Math.PI);
      line(-ax, -az - r, 0, -az - r, BACK); pts.push([0, -az - r]);
      return pts;
    };
    // the rings: round the bottom edge, up the straight sides (often, so the bulge is smooth), round the top edge
    const rings = [], V = 10, ys0 = y0 + rb, ys1 = y1 - rt;
    if (rb > 0) for (let i = 0; i < K; i++){ const a = -Math.PI / 2 + Math.PI / 2 * i / K; rings.push([ys0 + Math.sin(a) * rb, rb * (1 - Math.cos(a))]); }
    for (let i = 0; i <= V; i++) rings.push([ys0 + (ys1 - ys0) * i / V, 0]);
    if (rt > 0) for (let i = 1; i <= K; i++){ const a = Math.PI / 2 * i / K; rings.push([ys1 + Math.sin(a) * rt, rt * (1 - Math.cos(a))]); }
    const pos = [], uv = [], idx = [];
    let n = 0;
    for (const [y, inset] of rings){
      const pts = outline(inset);
      n = pts.length;
      let u = 0;
      pts.forEach(([x, z], j) => {
        if (j) u += Math.hypot(x - pts[j - 1][0], z - pts[j - 1][1]);
        pos.push(cx + x, y, cz + z + (z > az && bulge ? bulge(x, y) : 0)); uv.push(u, y);
      });
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n - 1; j++){
      const a = i * n + j, b = a + 1, c = a + n + 1, d = a + n;
      idx.push(a, c, b, a, d, c);
    }
    // the flat top and bottom: a fan from the middle, with points of their own so their normals stay straight
    for (const [ring, up] of [[rings.length - 1, true], [0, false]]){
      const c0 = pos.length / 3, y = rings[ring][0];
      pos.push(cx, y, cz); uv.push(cx, -cz);
      for (let j = 0; j < n; j++){ const k = (ring * n + j) * 3; pos.push(pos[k], y, pos[k + 2]); uv.push(pos[k], -pos[k + 2]); }
      for (let j = 1; j < n; j++) idx.push(c0, c0 + (up ? j + 1 : j), c0 + (up ? j : j + 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return mesh(g, M.bowl);
  };
  // ### The cistern: a body of thin sheet whose front bows out 3 mm in the middle, and a lid that sits over its top
  // ### edge, 8 mm proud all round, with a turned-down lip. The outlet is in the middle of its floor.
  const CY0 = .66, CY1 = 1.016, CZ1 = -2.8, CZ = (CZ1 + WALLZ) / 2, CW = .235, CR = .026, LIP = .998, LT = 1.032;
  const SY0 = CY0 + .016, SY1 = CY1, BX0 = CW - CR, BULGE = .003;
  const bulge = (x, y) => BULGE * Math.max(0, 1 - (x / BX0) ** 2) * Math.max(0, 1 - ((y - (SY0 + SY1) / 2) / ((SY1 - SY0) / 2)) ** 2);
  const frontAt = (x, y) => CZ1 + bulge(x, y);
  steelBox(T.x, CZ, CW, (CZ1 - WALLZ) / 2, CY0, CY1, CR, 0, .016, bulge);
  steelBox(T.x, (CZ1 + .008 + WALLZ) / 2, CW + .008, (CZ1 + .008 - WALLZ) / 2, LIP, LT, CR + .007, .007, .0015);
  // the dual flush button on the lid: a chrome ring and two half buttons, the small flush and the full one
  const BX = T.x + .11, BZ = CZ;
  cyl(.034, .035, .005, M.chrome, BX, LT + .0025, BZ, 28);
  for (const [a, h] of [[0, .006], [Math.PI, .008]]){ const b = mesh(new THREE.CylinderGeometry(.027, .027, h, 20, 1, false, a + .06, Math.PI - .12), M.bowl); b.position.set(BX, LT + .005 + h / 2, BZ); }
  // security screws: domed heads with a pin-hex hole, in the lid and in the front
  const screw = (x, y, z, up) => {
    const head = mesh(new THREE.SphereGeometry(.0065, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome);
    head.scale.set(1, .45, 1); head.position.set(x, y, z); if (!up) head.rotation.x = Math.PI / 2;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(.0021, 6), M.dark);
    if (up){ hole.rotation.x = -Math.PI / 2; hole.position.set(x, y + .003, z); } else hole.position.set(x, y, z + .003);
    room.add(hole);
  };
  for (const dx of [-.2, .2]) for (const z of [WALLZ + .03, CZ1 - .022]) screw(T.x + dx, LT, z, true);
  const FRONT_SCREWS = [[-.19, .7], [.19, .7], [-.19, .965], [.19, .965]];
  for (const [dx, y] of FRONT_SCREWS) screw(T.x + dx, y, frontAt(dx, y), false);
  // a small stamped plate, riveted on under the lid
  const plateTex = canvasTex(128, 48, (g, w, h) => {
    g.fillStyle = '#9da4a6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6c7375'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#4a5052'; g.font = 'bold 15px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('BLOCK D  WC 2', w / 2, 21); g.font = '11px Arial, sans-serif'; g.fillText('6 L / 3 L', w / 2, 37);
  });
  const PX = -.1, PY = .955;
  plane(.075, .028, new THREE.MeshStandardMaterial({ map: plateTex, metalness: .7, roughness: .45, polygonOffset: true, polygonOffsetFactor: -1 }), T.x + PX, PY, frontAt(PX, PY) + .0012);
  for (const dx of [-.033, .033]){ const r = mesh(new THREE.SphereGeometry(.0022, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), M.dullSteel); r.rotation.x = Math.PI / 2; r.position.set(T.x + PX + dx, PY, frontAt(PX + dx, PY) + .0012); }
  // ### What runs down the front: limescale (chalky and pale) and a little rust from the screws, in thin wavering runs
  // ### that start at the lid's lip, thin out as they go and sometimes end in a dried bead; dried drops, and grime and a
  // ### crust of limescale along the bottom, where the water gathers before it drips off. The picture lies on the flat
  // ### of the front and bows out with it.
  const DTOP = LIP, DBOT = SY0, DW = 2 * BX0, DH = DTOP - DBOT, drnd = mulberry32(2117);
  const toPx = (dx, y, w, h) => [(dx + BX0) / DW * w, (DTOP - y) / DH * h];
  const runs = (g, x, y, len, w0, a0, c) => {
    const f = 2 + drnd() * 5, ph = drnd() * 7, amp = .5 + drnd() * 1.5, drift = (drnd() - .5) * 5, steps = Math.ceil(len * 1.4);
    for (let i = 0; i <= steps; i++){
      const t = i / steps, px = x + Math.sin(t * f + ph) * amp + drift * t, py = y + t * len, r = w0 * (1 - .5 * t);
      g.fillStyle = `rgba(${c},${a0 * Math.pow(1 - t, .7)})`; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
    }
    if (drnd() < .45){ g.fillStyle = `rgba(${c},${a0 * 2})`; g.beginPath(); g.ellipse(x + Math.sin(f + ph) * amp + drift, y + len, w0 * .9, w0 * 1.3, 0, 0, 7); g.fill(); }
  };
  const dripTex = canvasTex(256, Math.round(256 * DH / DW), (g, w, h) => {
    if ('filter' in g) g.filter = 'blur(.5px)';
    // a faint brown line right under the lip, where water creeps out of the seam
    let gr = g.createLinearGradient(0, 0, 0, 7); gr.addColorStop(0, 'rgba(105,82,52,.3)'); gr.addColorStop(1, 'rgba(105,82,52,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, 7);
    // grime towards the bottom, and a crust of limescale along the bottom edge
    gr = g.createLinearGradient(0, h * .62, 0, h); gr.addColorStop(0, 'rgba(92,84,64,0)'); gr.addColorStop(1, 'rgba(92,84,64,.3)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    gr = g.createLinearGradient(0, h - 8, 0, h); gr.addColorStop(0, 'rgba(226,222,204,0)'); gr.addColorStop(1, 'rgba(226,222,204,.22)'); g.fillStyle = gr; g.fillRect(0, h - 8, w, 8);
    for (let i = 0; i < 90; i++){ const r = .6 + drnd() * 1.8; g.fillStyle = `rgba(226,222,204,${.05 + drnd() * .1})`; g.beginPath(); g.ellipse(drnd() * w, h - Math.pow(drnd(), 2) * 6, r * 2.2, r * .5, 0, 0, 7); g.fill(); }
    // runs of limescale from the lip, most of them short
    for (let i = 0; i < 11; i++) runs(g, 6 + drnd() * (w - 12), drnd() * 3, h * (.12 + Math.pow(drnd(), 1.6) * .75), .9 + drnd() * 1.4, .05 + drnd() * .06, '234,230,214');
    // rust from the screws and from the plate's rivets
    for (const [dx, y] of FRONT_SCREWS){ const [x, py] = toPx(dx, y, w, h); if (py > 0 && py < h * .9) runs(g, x, py + 2, h * (.06 + drnd() * .22), 1.1, .12, '124,70,32'); }
    { const [x, py] = toPx(PX + .033, PY - .012, w, h); runs(g, x, py, h * .2, .9, .09, '124,70,32'); }
    // dried drops: little rings of limescale with a faint middle
    for (let i = 0; i < 26; i++){
      const x = drnd() * w, y = h * (.25 + drnd() * .75), r = .8 + drnd() * 2.2;
      g.strokeStyle = `rgba(232,228,210,${.12 + drnd() * .12})`; g.lineWidth = .7; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      g.fillStyle = 'rgba(232,228,210,.05)'; g.fill();
    }
  });
  {
    const geo = new THREE.PlaneGeometry(DW, DH, 12, 8), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, bulge(p.getX(i), p.getY(i) + (DTOP + DBOT) / 2) + .0012);
    const drips = mesh(geo, decalMat(dripTex)); drips.position.set(T.x, (DTOP + DBOT) / 2, CZ1); drips.castShadow = false;
  }
  // ### And on the lid: dust along the wall, greasy fingerprints round the flush button and a few dried drops.
  {
    const LW = 2 * (CW - CR), LD = CZ1 - WALLZ - .02;
    const lidTex = canvasTex(256, Math.round(256 * LD / LW), (g, w, h) => {
      if ('filter' in g) g.filter = 'blur(.6px)';
      let gr = g.createLinearGradient(0, 0, 0, h * .35); gr.addColorStop(0, 'rgba(128,120,100,.6)'); gr.addColorStop(1, 'rgba(128,120,100,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (const x of [0, w]){ gr = g.createRadialGradient(x, 0, 0, x, 0, h * .7); gr.addColorStop(0, 'rgba(120,112,92,.45)'); gr.addColorStop(1, 'rgba(120,112,92,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
      const bx = (BX - T.x + LW / 2) / LW * w, by = (BZ - (WALLZ + .01)) / LD * h;
      for (let i = 0; i < 14; i++){
        const a = drnd() * Math.PI * 2, d = 20 + drnd() * 26, x = bx + Math.cos(a) * d, y = by + Math.sin(a) * d * .8, r = 4 + drnd() * 5;
        gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(66,60,48,${.16 + drnd() * .14})`); gr.addColorStop(1, 'rgba(66,60,48,0)');
        g.fillStyle = gr; g.save(); g.translate(x, y); g.rotate(a); g.scale(1.4, 1); g.translate(-x, -y); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
      }
      for (let i = 0; i < 16; i++){ const x = drnd() * w, y = drnd() * h, r = .8 + drnd() * 2; g.strokeStyle = `rgba(232,228,210,${.12 + drnd() * .12})`; g.lineWidth = .7; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
    });
    const top = mesh(new THREE.PlaneGeometry(LW, LD), decalMat(lidTex)); top.rotation.x = -Math.PI / 2; top.position.set(T.x, LT + .0006, WALLZ + .01 + LD / 2); top.castShadow = false;
  }
  // ### The flush pipe, 38 mm steel like the pan: out of the outlet nut under the cistern, down the wall, a smooth bend
  // ### forward at the height of the horn, and a short straight run into the rubber connector.
  const HY = .362, BR = .075, PZ = CZ, HORN = -2.765, CUFF = -2.738, CUFF_L = .065;
  {
    const k = .5523 * BR, path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(v3(T.x, CY0 - .015, PZ), v3(T.x, HY + BR, PZ)));
    path.add(new THREE.CubicBezierCurve3(v3(T.x, HY + BR, PZ), v3(T.x, HY + BR - k, PZ), v3(T.x, HY, PZ + BR - k), v3(T.x, HY, PZ + BR)));
    path.add(new THREE.LineCurve3(v3(T.x, HY, PZ + BR), v3(T.x, HY, CUFF - CUFF_L + .03)));
    const geo = new THREE.TubeGeometry(path, 64, .019, 18, false), uv = geo.attributes.uv, len = path.getLength();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * .12);
    mesh(geo, M.bowl);
  }
  // the outlet nut under the cistern: a ribbed black plastic coupling, and a rubber washer above it
  {
    const nut = mesh(new THREE.LatheGeometry([[.0195, -.028], [.03, -.027], [.032, -.023], [.032, -.006], [.029, -.002], [.026, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 18),
      new THREE.MeshStandardMaterial({ color: 0x232527, roughness: .55, flatShading: true }));
    nut.position.set(T.x, CY0 + .001, PZ);
  }
  // the cold water: a stop valve with a red wheel on the wall, a short chrome pipe into the side of the cistern, where a
  // tank connector nut holds it
  const VX = T.x + .36, VY = .9;
  cyl(.028, .028, .06, M.dullSteel, VX, VY, -2.965, 12).rotation.x = Math.PI / 2;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(.026, .006, 6, 16), M.red); wheel.position.set(VX, VY, -2.925); add(wheel);
  cyl(.009, .009, .025, M.chrome, VX, VY, -2.935, 8).rotation.x = Math.PI / 2;
  cyl(.009, .009, VX - (T.x + CW), M.chrome, (VX + T.x + CW) / 2, VY, -2.95, 10).rotation.z = Math.PI / 2;
  cyl(.016, .016, .012, M.dullSteel, T.x + CW + .006, VY, -2.95, 6).rotation.z = Math.PI / 2;
  // the bowl and its pedestal in one turned piece: foot, waist, flaring sides, rolled rim, then down into the trap
  lathe([[.175, 0], [.186, .012], [.186, .034], [.165, .06], [.158, .13], [.172, .22], [.2, .31], [.218, .37], [.228, .404], [.226, .424], [.212, .432], [.197, .426], [.19, .41],
    [.184, .38], [.16, .32], [.12, .27], [.072, .236], [.0, .226]], 44, 1, BOWL_SZ, T.x, BOWL_Z);
  // ### The flush horn: a short steel spigot welded to the back of the bowl under the rim (the weld a smooth fillet that
  // ### starts inside the steel), and over its end the black rubber connector that takes the flush pipe, ribbed where it
  // ### grips the horn and tight round the pipe. Both are turned round the line of the pipe, from the bowl to the wall.
  {
    const along = (pts, seg, z0, mat, su, sv) => {
      const g = new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(r, a)), seg), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      g.rotateX(-Math.PI / 2); g.translate(T.x, HY, z0); return mesh(g, mat);
    };
    along([[.0335, 0], [.0335, .012], [.031, .02], [.027, .028], [.024, .036], [.0225, .045], [.0225, -2.662 - HORN]], 24, -2.662, M.bowl, .15, .11);
    along([[.0226, 0], [.031, 0], [.0335, .003], [.0345, .01], [.0345, .02], [.0325, .024], [.0335, .028], [.0335, .032], [.031, .038], [.028, .046], [.0255, .054],
      [.0235, .06], [.0215, .064], [.0192, CUFF_L]], 28, CUFF, new THREE.MeshStandardMaterial({ color: 0x131313, roughness: .82, metalness: 0, envMapIntensity: .5 }), 1, 1);
  }
  // ### The water in the bowl mirrors the room like the puddles and the mop water do (WATER.bucket): murky yellow-brown,
  // ### with a film of yellowish foam and bubbles on it (this picture, on black where there is none) and a brown tide
  // ### line on the steel just above it.
  const frnd = mulberry32(6116);   // its own dice, so the rest of the room keeps its looks
  const foamTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++){ const x = frnd() * w, y = frnd() * h, r = 5 + frnd() * 18, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(150,128,70,.4)'); gr.addColorStop(1, 'rgba(150,128,70,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 40; i++){ const x = frnd() * w, y = frnd() * h, r = .8 + frnd() * 2.5; g.strokeStyle = 'rgba(210,200,160,.5)'; g.lineWidth = .8; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
    for (let i = 0; i < 25; i++){ g.fillStyle = `rgba(${90 + frnd() * 40 | 0},${70 + frnd() * 30 | 0},40,.7)`; g.fillRect(frnd() * w, frnd() * h, 1 + frnd() * 3, 1 + frnd() * 2); }   // flecks floating in it
  });
  const water = WATER.bucket(.137, T.x, .29, BOWL_Z, foamTex, new THREE.Color(.07, .048, .012), .08); water.scale.y = BOWL_SZ;
  const tide = lathe([[.1365, .2905], [.142, .296], [.149, .305]], 44, 1, BOWL_SZ, T.x, BOWL_Z);
  tide.castShadow = false; tide.material = new THREE.MeshStandardMaterial({ color: 0x4a3a20, roughness: .8, transparent: true, opacity: .4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  cyl(.045, .045, .002, M.dark, T.x, .238, BOWL_Z - .03, 16);
  for (const dx of [-.215, .215]) cyl(.014, .014, .012, M.chrome, T.x + dx, .006, BOWL_Z + .03, 6);   // floor bolts
  // limescale and dirt on the floor round the foot, and the soft shadow under the unit
  flat(.75, .95, M.blob, T.x, -2.55, .002); flat(.62, .62, M.stain, T.x, BOWL_Z, .004);
  WATER.puddle(.7, .48, T.x - .25, -1.98);
}
// ### The toilet roll on a steel holder screwed to the east wall, with a strip of paper hanging down.
{
  box(.012, .1, .2, M.steel, 3.994, .74, -2.0);
  for (const dz of [-.07, .07]) box(.07, .02, .012, M.steel, 3.955, .72, -2.0 + dz);
  const roll = cyl(.055, .055, .11, M.paper, 3.915, .72, -2.0, 18); roll.rotation.x = Math.PI / 2;
  const core = cyl(.021, .021, .112, new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .9 }), 3.915, .72, -2.0, 10); core.rotation.x = Math.PI / 2;
  const tail = plane(.105, .16, M.paper, 3.861, .64, -2.0, -Math.PI / 2); tail.rotation.z = .03;
}
const graffiti = plane(1.05, .66, M.graffiti, SX0 + .025, 1.32, -1.9, Math.PI / 2);
hot('read:graffiti', graffiti);
// The crooked tile, the dark hole behind it and the car key hidden there
const TILE_POS = new THREE.Vector3(2.62, .58, -2.988);
plane(.15, .15, M.dark, TILE_POS.x, TILE_POS.y, -2.996);
const tile = box(.15, .15, .018, tileMat(.15, .15), TILE_POS.x, TILE_POS.y, TILE_POS.z);
tile.rotation.z = .07;
// the car key: a brass blade, a black plastic head and a worn leather fob, lying in the hollow
const carKey = new THREE.Group();
const keyHead = new THREE.Mesh(new THREE.BoxGeometry(.03, .022, .008), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .5 }));
const keyBlade = new THREE.Mesh(new THREE.BoxGeometry(.045, .009, .003), new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: .85, roughness: .3 })); keyBlade.position.x = .036;
const keyRing = new THREE.Mesh(new THREE.TorusGeometry(.01, .002, 6, 14), M.steel); keyRing.position.x = -.022;
const keyFob = new THREE.Mesh(new THREE.BoxGeometry(.028, .04, .004), new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: .85 })); keyFob.position.set(-.036, -.016, 0); keyFob.rotation.z = .4;
carKey.add(keyHead, keyBlade, keyRing, keyFob); carKey.position.set(TILE_POS.x + .005, TILE_POS.y - .01, -2.99); carKey.rotation.z = -.2; carKey.scale.setScalar(1.5); carKey.visible = false; room.add(carKey);
hot('play:tile', tile); hot('take:carkey', keyHead, keyBlade, keyFob);
// The hatch: frame, diamond-plate lid on a hinge, padlock with four number wheels, a shaft with a ladder below
const HATCH = new THREE.Vector3(2.2, 0, -1.75), HS = .74;
for (const [w, d, x, z] of [[HS + .08, .05, 0, -HS / 2], [HS + .08, .05, 0, HS / 2], [.05, HS, -HS / 2, 0], [.05, HS, HS / 2, 0]]) box(w, .03, d, M.dullSteel, HATCH.x + x, .015, HATCH.z + z);
const lidPivot = new THREE.Group(); lidPivot.position.set(HATCH.x, .03, HATCH.z - HS / 2); room.add(lidPivot);
const lid = new THREE.Mesh(new THREE.BoxGeometry(HS - .02, .03, HS - .02), M.plate); lid.position.set(0, 0, HS / 2); lid.castShadow = lid.receiveShadow = true; lidPivot.add(lid);
const hinge = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, HS - .1, 10), M.steel); hinge.rotation.z = Math.PI / 2; lidPivot.add(hinge);
const lockGroup = new THREE.Group(); lockGroup.position.set(0, .08, HS - .03); lidPivot.add(lockGroup);
const lockBody = new THREE.Mesh(new THREE.BoxGeometry(.2, .1, .05), new THREE.MeshStandardMaterial({ color: 0x2e3438, metalness: .8, roughness: .35 })); lockBody.castShadow = true; lockGroup.add(lockBody);
const shackle = new THREE.Mesh(new THREE.TorusGeometry(.045, .01, 8, 20, Math.PI), M.steel); shackle.position.set(0, .05, 0); lockGroup.add(shackle);
const wheelTex = [0, 1, 2, 3].map(() => digitTex());
wheelTex.forEach((t, i) => { const wm = new THREE.Mesh(new THREE.PlaneGeometry(.036, .04), new THREE.MeshBasicMaterial({ map: t })); wm.position.set(-.06 + i * .04, 0, .0255); lockGroup.add(wm); drawDigit(t, 0); });
hot('lock', lockBody, lid);
HOT['go:hatch'] = HOT.lock;   // from the stall, clicking the hatch kneels you down at it

// ### The ladder and the hatch frame once more, as a mask that draws only depth: drawn just before your hands, it hides
// ### the fingers where they wrap round behind a rung, so the hands really hold the wood.
const GRIP_MASK = new THREE.Scene(), MASK_MAT = new THREE.MeshBasicMaterial({ colorWrite: false }), RUNG_AT = [];
function gripMask(o){ const m = new THREE.Mesh(o.geometry, MASK_MAT); m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); GRIP_MASK.add(m); }
{ const f = new THREE.Mesh(new THREE.BoxGeometry(HS + .08, .43, .43)); f.position.set(HATCH.x, -.185, HATCH.z - HS / 2 - .19); gripMask(f); }   // the floor and the frame beyond the hatch's north edge
// ---------- The tunnel under the hatch ----------
// ### Below the hatch an old brick shaft drops 3.6 m into a vaulted catacomb passage that runs off under the corridor:
// ### walls of rough stone blocks, a barrel vault of old brick and a floor of worn brick pavers. The surfaces are CC0
// ### scans from Poly Haven ("Castle Brick 07", "Stone Brick Wall 001", "Worn Brick Floor"), fetched once through its
// ### free public API (no key) and kept in room-1-escape/textures. An old wooden ladder ("Rough Wood" scan) is bolted
// ### to the north wall, with Hale's note taped to it. Nobody has been down here for years: cobwebs fill the corners and
// ### hang from the vault, and dust drifts in the light of two old bulbs. It is only ever seen through the hatch, and
// ### its lights and dust only exist from the moment the hatch opens.
const TUN = { x: HATCH.x, zN: HATCH.z - HS / 2, zS: 6.4, floor: -3.6, spring: -2.1, r: .65 };
TUN.crown = TUN.spring + TUN.r;
TUN.ladderZ = TUN.zN + .14;
TUN.mid = (TUN.zN + TUN.zS) / 2;
TUN.len = TUN.zS - TUN.zN;
TUN.webs = [];
// ### The door at the far end of the tunnel: the doorway (w x h), its plank leaf, and what opening it moves.
const TDOOR = { w: .84, h: 1.76, leafH: 1.73, pivot: null, out: null, glow: null, gap: null };
const trnd = mulberry32(1912);   // its own random numbers, so the room above keeps its look
// ### Scales a geometry's texture coordinates so that one picture covers the same number of metres on every surface.
const uvMetres = (geo, su, sv) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return geo; };
// ### The garage behind the tunnel door, 4 x 4 m, 128 pixels a metre, the floor 3.4 m below the top: dark walls, a
// ### concrete floor, the car facing the door (a dark shape: bumper, grille, bonnet, windscreen, wheels) and its two
// ### headlights, with their glare and the pools of light they throw on the floor.
function paintGarage(g, w, h){
  const ground = 435, cx = w / 2, glare = (x, y, r, a, sx, sy) => {
    g.save(); g.translate(x, y); g.scale(sx || 1, sy || 1);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(226,236,255,${a})`); gr.addColorStop(1, 'rgba(226,236,255,0)');
    g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2); g.restore();
  };
  let gr = g.createLinearGradient(0, 0, 0, ground); gr.addColorStop(0, '#05070b'); gr.addColorStop(1, '#121822');
  g.fillStyle = gr; g.fillRect(0, 0, w, ground);
  gr = g.createLinearGradient(0, ground, 0, h); gr.addColorStop(0, '#161b22'); gr.addColorStop(1, '#0c0f14');
  g.fillStyle = gr; g.fillRect(0, ground, w, h - ground);
  // the car: tyres, then the body from the bumper up to the roof, the windscreen catching a little light
  g.fillStyle = '#030406'; for (const s of [-1, 1]) g.fillRect(cx + s * 92 - 16, ground - 34, 32, 34);
  g.fillStyle = '#07090d';
  g.beginPath(); g.moveTo(cx - 112, ground - 14); g.lineTo(cx - 114, ground - 80); g.quadraticCurveTo(cx - 110, ground - 112, cx - 84, ground - 118);
  g.lineTo(cx - 66, ground - 168); g.quadraticCurveTo(cx, ground - 176, cx + 66, ground - 168); g.lineTo(cx + 84, ground - 118);
  g.quadraticCurveTo(cx + 110, ground - 112, cx + 114, ground - 80); g.lineTo(cx + 112, ground - 14); g.closePath(); g.fill();
  gr = g.createLinearGradient(0, ground - 166, 0, ground - 122); gr.addColorStop(0, '#1b2433'); gr.addColorStop(1, '#0b0f16');
  g.fillStyle = gr; g.beginPath(); g.moveTo(cx - 60, ground - 162); g.quadraticCurveTo(cx, ground - 169, cx + 60, ground - 162); g.lineTo(cx + 76, ground - 122); g.lineTo(cx - 76, ground - 122); g.closePath(); g.fill();
  g.fillStyle = '#0d1118'; g.fillRect(cx - 40, ground - 92, 80, 18);   // the grille
  g.fillStyle = '#10141b'; g.fillRect(cx - 112, ground - 40, 224, 10);   // the bumper
  // the headlights and their glare, added on top of everything
  g.globalCompositeOperation = 'lighter';
  for (const s of [-1, 1]){
    const lx = cx + s * 80, ly = ground - 88;
    glare(lx, ground + 24, 130, .32, 1.3, .22);   // the pool of light on the floor
    glare(lx, ly, 230, .22); glare(lx, ly, 70, .7); glare(lx, ly, 260, .2, 1.4, .06); glare(lx, ly, 18, 1);
  }
  g.globalCompositeOperation = 'source-over';
}
// ### A scanned surface for the tunnel; the tint (linear) greys it with the dust of decades.
function tunnelMat(color, normal, tint, o){
  const m = new THREE.MeshStandardMaterial(Object.assign({ map: SCAN(color, true), normalMap: SCAN(normal, false, 1, 1, 4),
    roughness: .95, side: THREE.DoubleSide }, o));
  m.color.setRGB(tint[0], tint[1], tint[2]);
  return m;
}
const TM = {
  brick: tunnelMat('tunnel-brick-color.jpg', 'tunnel-brick-normal.jpg', [.5, .45, .44], { roughnessMap: SCAN('tunnel-brick-rough.jpg', false, 1, 1, 2), roughness: 1 }),
  stone: tunnelMat('tunnel-stone-color.jpg', 'tunnel-stone-normal.jpg', [.68, .64, .6]),
  floor: tunnelMat('tunnel-floor-color.jpg', 'tunnel-floor-normal.jpg', [.6, .57, .54], { side: THREE.FrontSide }),
  wood: tunnelMat('ladder-wood-color.jpg', 'ladder-wood-normal.jpg', [.86, .78, .68], { side: THREE.FrontSide }),
  iron: new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: .75, metalness: .55 })
};
// ### A flat piece of tunnel; `tile` is how many metres one picture of the scan covers.
function tplane(w, h, mat, tile, x, y, z, rx, ry){
  const m = new THREE.Mesh(uvMetres(new THREE.PlaneGeometry(w, h), w / tile, h / tile), mat);
  m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); room.add(m); return m;
}
// ### A box in the tunnel (it casts no shadow: no shadow-casting light reaches down here).
const tbox = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); room.add(m); return m; };
{
  const { x, zN, zS, floor, spring, r, crown } = TUN, zV = zN + HS, vLen = zS - zV;
  // the brick shaft under the hatch, down to the height of the vault's crown
  tplane(HS, -crown, TM.brick, 2.5, x, crown / 2, zN);
  tplane(HS, -crown, TM.brick, 2.5, x, crown / 2, zV);
  tplane(HS, -crown, TM.brick, 2.5, x - HS / 2, crown / 2, HATCH.z, 0, Math.PI / 2);
  tplane(HS, -crown, TM.brick, 2.5, x + HS / 2, crown / 2, HATCH.z, 0, Math.PI / 2);
  // where the shaft opens into the tunnel: a flat brick ceiling on each side of it, stone up to it
  for (const s of [-1, 1]){
    tplane((r - HS / 2), HS, TM.brick, 2.5, x + s * (r + HS / 2) / 2, crown, HATCH.z, -Math.PI / 2);
    tplane(HS, r, TM.stone, 2.5, x + s * r, spring + r / 2, HATCH.z, 0, Math.PI / 2);
    tplane(TUN.len, spring - floor, TM.stone, 2.5, x + s * r, (spring + floor) / 2, TUN.mid, 0, Math.PI / 2);
  }
  tplane(r * 2, crown - floor, TM.stone, 2.5, x, (crown + floor) / 2, zN);   // the north wall behind the ladder
  tplane(r * 2, TUN.len, TM.floor, 2, x, floor, TUN.mid, -Math.PI / 2);
  // the barrel vault, and the brick face where it starts beside the shaft
  const vault = new THREE.Mesh(uvMetres(new THREE.CylinderGeometry(r, r, vLen, 20, 1, true, Math.PI / 2, Math.PI), Math.PI * r / 2.5, vLen / 2.5).rotateX(Math.PI / 2), TM.brick);
  vault.position.set(x, spring, zV + vLen / 2); room.add(vault);
  const face = new THREE.Shape(); face.moveTo(-r, 0); face.lineTo(-r, r); face.lineTo(r, r); face.lineTo(r, 0); face.absarc(0, 0, r, 0, Math.PI, false);
  const faceM = new THREE.Mesh(uvMetres(new THREE.ShapeGeometry(face, 12), 1 / 2.5, 1 / 2.5), TM.brick); faceM.position.set(x, spring, zV); room.add(faceM);
  // the far end: a stone wall under a brick half-moon with a doorway in it, framed in old timber; the plank door in it
  // opens outwards (see TDOOR)
  const dw = TDOOR.w / 2, dh = TDOOR.h, deep = .35;
  for (const s of [-1, 1]) tplane(r - dw, spring - floor, TM.stone, 2.5, x + s * (r + dw) / 2, (spring + floor) / 2, zS, 0, Math.PI);
  const arch = new THREE.Shape(); arch.moveTo(-r, 0); arch.lineTo(-dw, 0); arch.lineTo(-dw, floor + dh - spring); arch.lineTo(dw, floor + dh - spring); arch.lineTo(dw, 0); arch.lineTo(r, 0); arch.absarc(0, 0, r, 0, Math.PI, false);
  const moon = new THREE.Mesh(uvMetres(new THREE.ShapeGeometry(arch, 18), 1 / 2.5, 1 / 2.5), TM.brick); moon.position.set(x, spring, zS); moon.rotation.y = Math.PI; room.add(moon);
  // the doorway runs through the thick wall: stone sides, a brick lintel, and the pavers go on out into the garage
  for (const s of [-1, 1]) tplane(deep + .9, dh, TM.stone, 2.5, x + s * dw, floor + dh / 2, zS + (deep + .9) / 2, 0, -s * Math.PI / 2);
  tplane(TDOOR.w, deep, TM.brick, 2.5, x, floor + dh, zS + deep / 2, Math.PI / 2);
  tplane(3, 3.5, TM.floor, 2, x, floor + .001, zS + 1.75, -Math.PI / 2);
  for (const s of [-1, 1]) tbox(.07, dh + .08, .07, TM.wood, x + s * (dw + .035), floor + (dh + .08) / 2, zS - .03);
  tbox(TDOOR.w + .2, .08, .07, TM.wood, x, floor + dh + .04, zS - .03);
  // outside, a few metres on: the lock-up garage at night, where the car waits with its headlights on, shining at the
  // door. A picture (fog does not dim it) that the door hides, apart from a glint round its edges, until it swings open.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ fog: false, map: canvasTex(512, 512, paintGarage) }));
  glow.position.set(x, floor + 1.4, zS + 3.5); glow.rotation.y = Math.PI; room.add(glow); TDOOR.out = glow; TDOOR.glow = glow.material; glow.material.color.setScalar(.25);
  // the door: rough planks on two iron straps that run out to the hinges on the left, a ring to pull it by on the right
  const pivot = new THREE.Group(); pivot.position.set(x + dw, floor + .012 + TDOOR.leafH / 2, zS + .04); room.add(pivot); TDOOR.pivot = pivot;
  const leaf = new THREE.Mesh(uvMetres(new THREE.BoxGeometry(TDOOR.w - .04, TDOOR.leafH, .05), 1.6, 3.4), TM.wood); leaf.position.x = -dw; pivot.add(leaf); hot('open:door', leaf);
  for (const y of [-.52, .58]){
    const strap = new THREE.Mesh(new THREE.BoxGeometry(TDOOR.w - .02, .055, .012), TM.iron); strap.position.set(-dw + .01, y, -.031); pivot.add(strap);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .1, 8), TM.iron); pin.position.set(.004, y, -.02); pivot.add(pin);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.045, .007, 6, 18), TM.iron); ring.position.set(-TDOOR.w + .13, .02, -.04); pivot.add(ring);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(.022, .026, .02, 10).rotateX(Math.PI / 2), TM.iron); boss.position.set(-TDOOR.w + .13, .065, -.035); pivot.add(boss);
  const gap = new THREE.Mesh(new THREE.PlaneGeometry(TDOOR.w - .06, .014), new THREE.MeshBasicMaterial({ color: 0x9fb4c8 })); gap.position.set(x, floor + .008, zS - .002); gap.rotation.y = Math.PI; room.add(gap); TDOOR.gap = gap;
  // rubble and broken bricks along the walls
  for (let i = 0; i < 26; i++){
    const s = .04 + trnd() * .09, side = trnd() < .5 ? -1 : 1;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), trnd() < .5 ? TM.stone : TM.brick);
    st.scale.set(1, .45 + trnd() * .3, .8 + trnd() * .4); st.rotation.set(trnd() * 3, trnd() * 3, trnd() * 3);
    st.position.set(x + side * (r - .06 - trnd() * .18), floor + s * .3, zV + .3 + trnd() * (vLen - .8)); room.add(st);
  }
  // the wooden ladder: two rough rails on iron brackets and eleven rungs, none quite level
  const top = -.03, len = top - floor;
  for (const s of [-1, 1]){
    const rail = new THREE.Mesh(uvMetres(new THREE.BoxGeometry(.055, len, .045), .11, len / .5), TM.wood);
    rail.position.set(x + s * .21, (top + floor) / 2, TUN.ladderZ); rail.rotation.z = s * .004; room.add(rail); gripMask(rail);
    for (const y of [-.55, -1.95, -3.2]){ tbox(.07, .045, .15, TM.iron, x + s * .21, y, zN + .075); }
  }
  for (let i = 1; i <= 11; i++){
    const g = uvMetres(new THREE.CylinderGeometry(.019, .021, .47, 10), .12 / .5, .47 / .5).rotateZ(Math.PI / 2);
    const rung = new THREE.Mesh(g, TM.wood); rung.position.set(x + (trnd() - .5) * .01, -i * .3 + (trnd() - .5) * .012, TUN.ladderZ); rung.rotation.set(trnd() * 3, (trnd() - .5) * .03, (trnd() - .5) * .025); room.add(rung);
    RUNG_AT[i] = rung.position.clone(); gripMask(rung);
  }
  // Hale's note, taped to the left rail where you pass it on the way down
  const note = new THREE.Mesh(new THREE.PlaneGeometry(.15, .11), new THREE.MeshStandardMaterial({ roughness: .9, map: canvasTex(384, 280, (g, w, h) => {
    g.fillStyle = '#d9d0b8'; g.fillRect(0, 0, w, h);
    grime(g, w, h, 6, 'rgba(120,96,60,.2)', 60, false);
    g.fillStyle = 'rgba(220,214,190,.8)'; g.fillRect(w * .38, 0, w * .24, 26);   // the tape
    g.fillStyle = '#23262c'; g.font = 'italic 600 34px Georgia, serif';
    ['Took you long enough.', 'A car is waiting at the', 'end of the tunnel.', '— H.'].forEach((l, i) => g.fillText(l, i === 3 ? w - 110 : 22, 76 + i * 52));
  }) }));
  note.position.set(x - .21, -1.05, TUN.ladderZ + .024); note.rotation.z = .06; room.add(note);
  // two old bulbs on the walls, in wire cages
  for (const [bx, bz] of [[x + r - .05, .15], [x - r + .05, 4.6]]){
    const s = Math.sign(bx - x);
    tbox(.03, .05, .1, TM.iron, bx, -1.92, bz);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.032, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb45e, emissiveIntensity: 2.2 }));
    bulb.position.set(bx - s * .07, -1.95, bz); room.add(bulb);
    for (let k = 0; k < 3; k++){ const ring = new THREE.Mesh(new THREE.TorusGeometry(.046, .0025, 4, 16), TM.iron); ring.position.copy(bulb.position); ring.rotation.set(Math.PI / 2 * (k === 0), k * Math.PI / 3, 0); room.add(ring); }
  }
}
const tunnelLight = new THREE.PointLight(0xffb066, 0, 7, 2); tunnelLight.position.set(TUN.x + TUN.r - .15, -1.95, .15); tunnelLight.visible = false; room.add(tunnelLight);
const tunnelLight2 = new THREE.PointLight(0xffa458, 0, 4.5, 2); tunnelLight2.position.set(TUN.x - TUN.r + .15, -1.95, 4.6); tunnelLight2.visible = false; room.add(tunnelLight2);
// the car's headlights behind the door, dark until it opens (it is switched on with the bulbs, so the room's materials
// are set up for it once, when the hatch opens, and opening the door makes no hitch)
const nightLight = new THREE.PointLight(0xd2deef, 0, 7, 2); nightLight.position.set(TUN.x, TUN.floor + .9, TUN.zS + .6); nightLight.visible = false; room.add(nightLight);

// ### Cobwebs, painted on canvases: a web across a corner (threads anchored on the walls, radial threads from a hub, a
// ### sagging spiral that is torn in places, grey dust caught in it) and long single strands that hang from the vault.
const webTex = canvasTex(512, 512, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const hub = [w * (.45 + trnd() * .1), h * (.28 + trnd() * .08)], n = 15, rad = [];
  for (let i = 0; i < n; i++){
    const a = Math.PI * 2 * (i + (trnd() - .5) * .5) / n, dx = Math.cos(a), dy = Math.sin(a);
    // how far the thread runs before it reaches the edge of the picture; the lower threads end free, so the web sags
    const lx = dx > 0 ? (w - hub[0]) / dx : dx < 0 ? -hub[0] / dx : 1e9, ly = dy > 0 ? (h - hub[1]) / dy : dy < 0 ? -hub[1] / dy : 1e9;
    let L = Math.min(lx, ly) - 2; if (dy > .3) L *= .5 + trnd() * .25;
    rad.push([dx, dy, L]);
  }
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(232,229,220,.62)'; g.lineWidth = 1.7;
  for (const [dx, dy, L] of rad){ g.beginPath(); g.moveTo(hub[0], hub[1]); g.lineTo(hub[0] + dx * L, hub[1] + dy * L); g.stroke(); }
  const P = (i, f) => { const [dx, dy, L] = rad[(i + n) % n]; return [hub[0] + dx * L * f, hub[1] + dy * L * f]; };
  g.lineWidth = 1.25;
  for (let k = 1; k <= 13; k++){
    const f = Math.pow(k / 13, 1.15) * .97;
    for (let i = 0; i < n; i++){
      if (trnd() < .13) continue;   // torn
      const a = P(i, f), b = P(i + 1, f), sag = 3 + f * 9;
      g.strokeStyle = `rgba(232,229,220,${.35 + trnd() * .35})`;
      g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag, b[0], b[1]); g.stroke();
      if (trnd() < .05){ g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(a[0] + 6, a[1] + 20, a[0] + (trnd() - .5) * 20, a[1] + 30 + trnd() * 50); g.stroke(); }   // a loose end
    }
  }
  // the free lower edge, sagging from one loose end to the next
  g.strokeStyle = 'rgba(232,229,220,.4)';
  for (let i = 0; i < n; i++){ if (rad[i][1] > .3 && rad[(i + 1) % n][1] > .3){ const a = P(i, 1), b = P(i + 1, 1); g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 22, b[0], b[1]); g.stroke(); } }
  // dust caught in the threads, thickest near the hub, and a grey film where it has gathered for years
  for (let i = 0; i < 70; i++){
    const p = P(Math.floor(trnd() * n), Math.pow(trnd(), 1.6)), s = 1.5 + trnd() * 5;
    const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], s); gr.addColorStop(0, 'rgba(206,200,188,.5)'); gr.addColorStop(1, 'rgba(206,200,188,0)');
    g.fillStyle = gr; g.fillRect(p[0] - s, p[1] - s, s * 2, s * 2);
  }
  const film = g.createRadialGradient(hub[0], hub[1], 0, hub[0], hub[1], w * .35); film.addColorStop(0, 'rgba(210,205,195,.16)'); film.addColorStop(1, 'rgba(210,205,195,0)');
  g.fillStyle = film; g.fillRect(0, 0, w, h);
});
const strandTex = canvasTex(64, 512, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.lineCap = 'round';
  for (let i = 0; i < 4; i++){
    let x = 8 + trnd() * (w - 16); const end = h * (.45 + trnd() * .55);
    g.strokeStyle = `rgba(232,229,220,${.4 + trnd() * .3})`; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x, 0); for (let y = 16; y < end; y += 16){ x += (trnd() - .5) * 3; g.lineTo(x, y); } g.stroke();
    const s = 2 + trnd() * 4, gr = g.createRadialGradient(x, end, 0, x, end, s); gr.addColorStop(0, 'rgba(206,200,188,.7)'); gr.addColorStop(1, 'rgba(206,200,188,0)');
    g.fillStyle = gr; g.fillRect(x - s, end - s, s * 2, s * 2);   // a clump of dust at the end
  }
});
for (const t of [webTex, strandTex]) t.anisotropy = 2;
const WEB = { web: new THREE.MeshStandardMaterial({ map: webTex, color: 0xb4b0a8, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1 }),
  strand: new THREE.MeshStandardMaterial({ map: strandTex, color: 0xb4b0a8, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1 }) };
// ### Hangs a web of w x h metres at (x, y, z), facing along (nx, ny, nz); the top of the picture is the side nearest the ceiling.
function web(mat, w, h, x, y, z, nx, ny, nz){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.lookAt(x + nx, y + ny, z + nz); room.add(m); return m;
}
{
  const { x, zN, r, crown, spring, floor } = TUN, zV = zN + HS, hs = HS / 2;
  // across the four upright corners of the shaft, just under the floor, and lower down in two of them
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]){
    const cx = x + sx * hs, cz = sz > 0 ? zN : zV, s = .2 + trnd() * .08;
    web(WEB.web, s * 1.414, .34 + trnd() * .12, cx - sx * s / 2, -.24 - trnd() * .06, cz + sz * s / 2, -sx, 0, sz);
  }
  web(WEB.web, .3, .3, x + hs - .1, -.95, zV - .1, -1, 0, -1);
  web(WEB.web, .26, .3, x - hs + .09, -1.25, zV - .09, 1, 0, -1);
  // between the ladder rails and the wall
  for (const [s, y] of [[-1, -.75], [1, -1.6], [-1, -2.55], [1, -3.2]]) web(WEB.web, .13, .24, x + s * .21, y, zN + .065, s, 0, 0);
  // where the flat ceiling meets the side walls beside the shaft, and in the corners of the north wall
  for (const s of [-1, 1]){
    web(WEB.web, HS * .9, .3, x + s * (r - .1), crown - .1, HATCH.z, -s, -1, 0);
    web(WEB.web, .42, .5, x + s * (r - .15), crown - .3, zN + .15, -s, 0, 1);
    web(WEB.web, .3, .34, x + s * (r - .1), floor + .5, zN + .1, -s, 0, 1);
  }
  // big webs spanning the vault further down the tunnel, the corners by the far door, and strands from the vault
  // (the two across the vault hang down to the height of your eyes: walking through, you tear them, see updateTunnelWalk)
  for (const m of [web(WEB.web, 1.2, .62, x, crown - .3, 1.7, 0, 0, -1), web(WEB.web, 1.1, .55, x + .05, crown - .27, 3.9, 0, 0, -1)]){ m.material = WEB.web.clone(); TUN.webs.push(m); }
  for (const s of [-1, 1]) web(WEB.web, .4, .55, x + s * (r - .14), spring - .1, TUN.zS - .14, -s, 0, -1);
  // along the top of the side walls, where the vault curves away, webs sag between the stones and the bricks
  for (const [s, z, w] of [[1, .7, .7], [-1, 1.3, .5], [-1, 2.5, .8], [1, 3.3, .6], [-1, 4.2, .5], [1, 5.3, .7]]) web(WEB.web, w, .34, x + s * (r - .1), spring + .2, z, -s, -.8, 0);
  for (let i = 0; i < 16; i++){
    const z = zV + .2 + trnd() * (TUN.zS - zV - .5), dx = (trnd() - .5) * .9, top = spring + Math.sqrt(r * r - dx * dx), len = .2 + trnd() * .45, a = trnd() * 6.3;
    web(WEB.strand, .07, len, x + dx, top - len / 2, z, Math.sin(a), 0, Math.cos(a));
  }
  for (let i = 0; i < 6; i++){
    const a = trnd() * 6.3, len = .2 + trnd() * .3, s = trnd() < .5 ? -1 : 1;
    web(WEB.strand, .07, len, x + s * (hs + .05 + trnd() * .18), crown - len / 2, zN + .1 + trnd() * (HS - .2), Math.sin(a), 0, Math.cos(a));
  }
}

// ### Dust: motes drifting in the still air of the shaft and the tunnel, which only show where the bulbs light them, and
// ### dust that trickles down from the hatch rim when the lid opens and from each rung your hands grab.
const DUST_N = 650, DUST_FREE = 480;
const dust = (() => {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(DUST_N * 3), col = new Float32Array(DUST_N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dot = canvasTex(32, 32, (g, w, h) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: .02, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; pts.visible = false; room.add(pts);
  return { pts, pos, col, vel: new Float32Array(DUST_N * 3), seed: Float32Array.from({ length: DUST_N }, () => trnd() * 100), next: DUST_FREE };
})();
// ### Puts a drifting mote somewhere in the shaft or the tunnel.
function placeMote(i){
  const p = dust.pos, v = dust.vel, { x, zN, r, floor, spring } = TUN;
  if (trnd() < .3){ p[i * 3] = x + (trnd() - .5) * HS * .9; p[i * 3 + 1] = trnd() * TUN.crown; p[i * 3 + 2] = HATCH.z + (trnd() - .5) * HS * .9; }
  else {
    const y = floor + .05 + trnd() * (TUN.crown - floor - .1), half = y > spring ? Math.sqrt(Math.max(0, r * r - (y - spring) ** 2)) : r;
    p[i * 3] = x + (trnd() - .5) * 2 * half * .9; p[i * 3 + 1] = y; p[i * 3 + 2] = zN + .1 + trnd() * (TUN.len - .4);
  }
  v[i * 3] = (trnd() - .5) * .03; v[i * 3 + 1] = (trnd() - .55) * .02; v[i * 3 + 2] = (trnd() - .5) * .03;
}
for (let i = 0; i < DUST_N; i++){ if (i < DUST_FREE) placeMote(i); else dust.pos[i * 3 + 1] = -100; }
// ### Lets a few grains of dust fall from a spot (the hatch rim, a rung).
function dustFall(n, x, y, z, spread){
  for (let k = 0; k < n; k++){
    const i = dust.next; dust.next = dust.next + 1 >= DUST_N ? DUST_FREE : dust.next + 1;
    dust.pos[i * 3] = x + (trnd() - .5) * spread; dust.pos[i * 3 + 1] = y - trnd() * .03; dust.pos[i * 3 + 2] = z + (trnd() - .5) * spread * .4;
    dust.vel[i * 3] = (trnd() - .5) * .08; dust.vel[i * 3 + 1] = -(.15 + trnd() * .5); dust.vel[i * 3 + 2] = (trnd() - .5) * .08;
  }
}
// ### Moves the dust each frame and lights every grain by how close it is to the two bulbs (a mote in the dark is unseen).
function updateDust(dt, t){
  if (!dust.pts.visible) return;
  const p = dust.pos, v = dust.vel, c = dust.col, l1 = tunnelLight.position, l2 = tunnelLight2.position, i1 = tunnelLight.intensity, i2 = tunnelLight2.intensity;
  for (let i = 0; i < DUST_N; i++){
    const j = i * 3, s = dust.seed[i];
    if (p[j + 1] < -50) continue;
    if (i < DUST_FREE){
      p[j] += (v[j] + Math.sin(t * .4 + s) * .012) * dt; p[j + 1] += (v[j + 1] + Math.sin(t * .27 + s * 2) * .008) * dt; p[j + 2] += (v[j + 2] + Math.cos(t * .33 + s) * .012) * dt;
      if (p[j + 1] < TUN.floor || p[j + 1] > 0 || Math.abs(p[j] - TUN.x) > TUN.r || p[j + 2] < TUN.zN || p[j + 2] > TUN.zS) placeMote(i);
    } else {
      v[j + 1] = Math.max(-.9, v[j + 1] - dt * .4);   // falling grains soon float at their own slow speed
      p[j] += (v[j] + Math.sin(t * 2 + s) * .03) * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < TUN.floor) p[j + 1] = -100;
    }
    const d1 = (p[j] - l1.x) ** 2 + (p[j + 1] - l1.y) ** 2 + (p[j + 2] - l1.z) ** 2, d2 = (p[j] - l2.x) ** 2 + (p[j + 1] - l2.y) ** 2 + (p[j + 2] - l2.z) ** 2;
    const b = .06 + i1 * .8 / (1 + d1 * 1.2) + i2 * .8 / (1 + d2 * 2) + (p[j + 1] > -1.2 ? .12 : 0), tw = .75 + .25 * Math.sin(t * 3 + s * 7);
    c[j] = b * tw; c[j + 1] = b * tw * .88; c[j + 2] = b * tw * .7;
  }
  dust.pts.geometry.attributes.position.needsUpdate = true; dust.pts.geometry.attributes.color.needsUpdate = true;
}

// ### Paper towels. No free library offers paper towels or a paper scan (Poly Haven has none; ambientCG and Openverse
// ### were out of reach), so they are made here. The paper is painted: recycled off-white with flecks of fibre, and the
// ### embossed dot pattern of a paper towel as a normal map; one picture is about 6 cm of paper. Every towel is a real
// ### sheet, a grid of points across the paper, so its thin edges and corners show, never a closed ball. All towels in
// ### the room go into one mesh (done()), shaded per point: darker in the valleys of the creases, lighter on the ridges,
// ### greyer where damp, brown where a shoe stood on it. rr is their own random numbers.
function paperTowels(rr){
  const TAU = Math.PI * 2;
  const paper = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ece8de'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++){ const px = rr() * w, py = rr() * h, r = 10 + rr() * 30, gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, `rgba(205,196,178,${.15 + rr() * .2})`); gr.addColorStop(1, 'rgba(205,196,178,0)'); g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2); }
    for (let i = 0; i < 700; i++){
      const px = rr() * w, py = rr() * h, l = 1 + rr() * 5, a = rr() * TAU, c = rr();
      g.strokeStyle = c < .04 ? 'rgba(70,95,150,.5)' : c < .5 ? `rgba(150,140,120,${.2 + rr() * .3})` : `rgba(255,255,250,${.3 + rr() * .4})`;
      g.lineWidth = .5 + rr() * .7; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
    }
  }, [1, 1]);
  const relief = document.createElement('canvas'); relief.width = relief.height = 256;
  { const g = relief.getContext('2d'); g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 8) for (let px = (y / 8 % 2) * 4; px < 256; px += 8){ const gr = g.createRadialGradient(px, y, 0, px, y, 3.2); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(px - 4, y - 4, 8, 8); }
    for (let i = 0; i < 900; i++){ const px = rr() * 256, py = rr() * 256, l = 2 + rr() * 6, a = rr() * TAU; g.strokeStyle = `rgba(${rr() < .5 ? '0,0,0' : '255,255,255'},.25)`; g.lineWidth = .6; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); } }
  const paperNormal = new THREE.CanvasTexture(normalFromHeight(relief, 256 / .06, .35)); paperNormal.wrapS = paperNormal.wrapT = THREE.RepeatWrapping; paperNormal.anisotropy = ANISO;
  const mat = new THREE.MeshStandardMaterial({ map: paper, normalMap: paperNormal, normalScale: new THREE.Vector2(.6, .6), roughness: .95, vertexColors: true, side: THREE.DoubleSide });
  const pos = [], uv = [], col = [], idx = [];
  const tri = v => Math.abs(v - Math.floor(v) - .5) * 2;
  const crinkle = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5; return s - Math.floor(s) - .5; };
  // ### A sheet of nu x nv squares, sizeU x sizeV metres of paper: at(u, v) gives every point (u and v run from 0 to 1
  // ### across the paper) as [x, y, z, shade, dirt].
  function sheet(nu, nv, sizeU, sizeV, at){
    const base = pos.length / 3, ou = rr(), ov = rr();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++){
      const [x, y, z, c, d = 0] = at(i / nu, j / nv);
      pos.push(x, y, z); uv.push(ou + i / nu * sizeU / .06, ov + j / nv * sizeV / .06);
      col.push(c * (1 - d) + .14 * d, c * .985 * (1 - d) + .12 * d, c * .96 * (1 - d) + .09 * d);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++){ const a = base + j * (nu + 1) + i, b = a + nu + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  // ### Creases across the paper: n random straight folds (a triangle wave across each, so they are sharp), period and
  // ### height between the given limits. Returns the height at (a, b), both from -1 to 1 across the sheet.
  function creases(n, per0, per1, amp0, amp1){
    const cr = [];
    for (let k = 0; k < n; k++){ const a = rr() * Math.PI; cr.push([Math.cos(a), Math.sin(a), per0 + rr() * (per1 - per0), rr(), amp0 + rr() * (amp1 - amp0)]); }
    return (a, b) => { let h = 0; for (const [dx, dy, per, off, amp] of cr) h += amp * (tri((a * dx + b * dy) / per + off) - .5); return h; };
  }
  // ### A used towel, crumpled in a fist and thrown away: the sheet wrapped round most of a ball, its corners reaching
  // ### furthest so they curl out as loose flaps, creased and finely crinkled, squashed as it settled (flatY), turned and
  // ### put at px, py, pz, about s across. fit(p) may move a point, to keep it inside the bin or above the floor.
  const m4 = new THREE.Matrix4(), q = new THREE.Vector3();
  function wad(px, py, pz, s, flatY, damp, n, fit){
    const wrap = Math.PI * (.6 + rr() * .32), fold = creases(9 + (rr() * 6 | 0), .25, .7, .1, .22), seed = rr() * 100;
    m4.makeRotationFromEuler(new THREE.Euler(rr() * TAU, rr() * TAU, rr() * TAU));
    const sx = s * (.85 + rr() * .35), sz = s * (.85 + rr() * .35), sy = s * flatY, tone = damp ? .68 + rr() * .1 : .9 + rr() * .1;
    sheet(n, n, .24, .24, (u, w) => {
      const a = u * 2 - 1, b = w * 2 - 1, th = Math.hypot(a, b) / Math.SQRT2 * wrap, ph = Math.atan2(b, a);
      const hh = fold(a, b) + crinkle(a, b, seed) * .05, r = 1 + hh;
      q.set(Math.sin(th) * Math.cos(ph) * r, -Math.cos(th) * r, Math.sin(th) * Math.sin(ph) * r).applyMatrix4(m4);
      const p = [px + q.x * sx, py + q.y * sy, pz + q.z * sz];
      if (fit) fit(p);
      return [p[0], p[1], p[2], tone * clamp(.8 + hh * 1.6, .55, 1.05)];
    });
  }
  return { sheet, creases, wad, crinkle, done(){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return add(new THREE.Mesh(g, mat));
  } };
}
// ### The bin by the sinks: an open can of brushed stainless steel with a rolled rim, a black bin liner pulled over the
// ### rim and gathered in folds below it, and the used paper towels from the dispenser above heaped inside, so you see
// ### them when you look in. One towel did not go all the way in and hangs over the rim; one missed the bin and lies
// ### crumpled on the floor beside it, and another was dropped wet by the sinks and trodden flat. The bin has its own
// ### random numbers, so the rest of the room keeps its look. x, z is the middle of its foot; T takes the towels.
function buildBin(x, z, T){
  const rr = mulberry32(2210), TAU = Math.PI * 2;
  const outR = y => .15 + y * .043, inR = y => outR(y) - .006;   // the wall: 30 cm across at the foot, 34 at the rim
  // the can, turned on a lathe: foot, wall, the rim rolled outwards, the inside and the floor
  const prof = [[0, .002], [.134, .002], [.146, .005], [.15, .013]];
  for (let i = 1; i <= 12; i++){ const y = .013 + i * (.425 - .013) / 12; prof.push([outR(y), y]); }
  prof.push([.174, .428], [.177, .435], [.176, .443], [.17, .447], [.164, .443], [.1625, .434]);
  for (let i = 1; i <= 10; i++){ const y = .434 - i * (.434 - .03) / 10; prof.push([inR(y), y]); }
  prof.push([.13, .024], [0, .024]);
  const can = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48),
    steelMat(0xb7bfc3, 1.5, { roughnessMap: SCAN('steel-scratches-rough.jpg', false, 3, 1), normalMap: SCAN('steel-scratches-normal.jpg', false, 3, 1, 4) }));
  can.position.set(x, 0, z); add(can);

  // ### The liner: rows of points round the can (angle a), from its bottom up the inside, over the rim and down the outside
  // ### to an uneven hem. Below the rim it is pulled tight; the spare plastic gathers in soft folds that stand out more
  // ### towards the hem.
  const ph = [0, 0, 0, 0, 0, 0].map(() => rr() * TAU);
  const fold = a => Math.max(0, .6 * Math.sin(5 * a + ph[0]) + .4 * Math.sin(11 * a + ph[1]) + .5 * Math.sin(2 * a + ph[2]));
  const hem = a => .372 + .012 * Math.sin(3 * a + ph[3]) + .006 * Math.sin(7 * a + ph[4]);
  const rows = [];
  for (let k = 0; k <= 8; k++){ const y = .032 + k * (.43 - .032) / 8, t = 1 - k / 8; rows.push(a => [inR(y) - .0015 - fold(a + 1) * t * .01, y]); }
  for (const [r, y] of [[.1635, .4465], [.17, .4508], [.1772, .4478], [.1806, .44]]) rows.push(() => [r, y]);
  for (let k = 1; k <= 6; k++){ const t = k / 6; rows.push(a => { const y = .44 - t * (.44 - hem(a)); return [outR(y) + .0035 + fold(a) * t * .013, y]; }); }
  const NA = 96, lp = [], li = [];
  for (const row of rows) for (let i = 0; i <= NA; i++){ const a = i / NA * TAU, [r, y] = row(a); lp.push(Math.cos(a) * r, y, Math.sin(a) * r); }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < NA; i++){ const p = j * (NA + 1) + i, q = p + NA + 1; li.push(p, q, p + 1, p + 1, q, q + 1); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: .34, side: THREE.DoubleSide });
  const liner = new THREE.Mesh(lg, linerMat); liner.position.set(x, 0, z); add(liner);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(inR(.032) - .002, 32), linerMat); floor.rotation.x = -Math.PI / 2; floor.position.set(x, .033, z); add(floor);

  // ### The heap: layers of crumpled towels, each laid where it does not sink too far into the others, higher in the
  // ### middle where they are thrown. The bin is about three quarters full, so you look down past the liner onto the
  // ### paper; the towels you can see have more points. Nothing pokes through the liner: points past its wall are
  // ### pulled in onto it.
  const inside = p => { const wx = p[0] - x, wz = p[2] - z, lim = inR(Math.min(p[1], .43)) - .004, rad = Math.hypot(wx, wz); if (rad > lim){ p[0] = x + wx * lim / rad; p[2] = z + wz * lim / rad; } };
  for (const [y0, n, sz, fine] of [[.2, 14, .05], [.25, 16, .048], [.295, 18, .045, 1], [.335, 15, .043, 1], [.362, 5, .04, 1]]){
    const placed = [];
    for (let tries = 0; placed.length < n && tries < 400; tries++){
      const s = sz * (.8 + rr() * .45), R = inR(y0) - s * .75, a = rr() * TAU, d = Math.sqrt(rr()) * R;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      if (placed.some(([qx, qz, qs]) => Math.hypot(px - qx, pz - qz) < (s + qs) * .8)) continue;
      placed.push([px, pz, s]);
      T.wad(x + px, y0 + .025 * (1 - d / R) + rr() * .012, z + pz, s, .6 + rr() * .3, rr() < .18, fine ? 13 : 8, inside);
    }
  }
  // ### The towel caught on the rim, facing the room: a sheet lying on the heap, bent over the rim and hanging down
  // ### outside, creased across and along and pinched together where it bends.
  {
    const A = .35, ca = Math.cos(A), sa = Math.sin(A), path = [[.05, .392], [.1, .405], [.14, .43], [.166, .458], [.177, .461], [.186, .452], [.19, .43], [.191, .405], [.189, .38], [.185, .355]];
    const at = t => { const f = t * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), k = f - i; return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k]; };
    const fold = T.creases(9, .2, .53, .027, .067);
    T.sheet(14, 26, .15, .22, (i, t) => {
      const u = (i - .5) * .15 * (1 - .4 * Math.exp(-(((t - .45) / .18) ** 2))) * (1 - .3 * t) + Math.sin(t * 7 + i * 4.2) * .006 * t, [r, y] = at(t);
      const [r1, y1] = at(Math.min(1, t + .01)), [r0, y0] = at(Math.max(0, t - .01)), tl = Math.hypot(r1 - r0, y1 - y0), nr = -(y1 - y0) / tl, ny = (r1 - r0) / tl;
      const hgt = fold(u / .15, t * .23 / .15) * .15 + T.crinkle(u, t, 1) * .002, rr2 = r + nr * hgt;
      return [x + ca * rr2 - sa * u, y + ny * hgt, z + sa * rr2 + ca * u, .95 * clamp(1 + hgt * 20, .8, 1.04)];
    });
  }
  // a towel that missed the bin, crumpled on the floor beside it and flattened where it landed
  T.wad(x + .27, .034, z - .23, .058, .62, false, 13, p => { p[1] = Math.max(.002, p[1]); });
  flat(.14, .14, M.blob, x + .27, z - .23);
  // ### A towel dropped wet by the sinks and trodden flat: a C-folded sheet lying on the floor with one third still
  // ### folded back over it (a little askew, the fold rounded), finely wrinkled, its edges wavy and curling up as they
  // ### dry, grey and see-through with the water, and brown where a shoe stood on it, the tread across the print.
  {
    const cx = x + .42, cz = z - .62, A = .7, ca = Math.cos(A), sa = Math.sin(A), L = .25, VF = 2 / 3, fold = T.creases(12, .15, .5, .2, .45), ph = rr() * 6.283;
    T.sheet(18, 24, .23, .25, (u, v) => {
      const a = u * 2 - 1, b = v * 2 - 1, k = Math.max(0, v - VF), hh = fold(a, b);
      let lx = (u - .5) * .23 * (1 + .03 * Math.sin(v * 17 + ph)), lz = (Math.min(v, VF) - .5) * L - k * L;
      // the flap folded back, turned a little about the fold as it lies
      if (k > 0){ const t = .2 * k / (1 - VF), oz = (VF - .5) * L, dz = lz - oz; lz = oz + dz * Math.cos(t) - lx * Math.sin(t) * .3; lx += dz * Math.sin(t) * .3; }
      lz += .004 * Math.sin(u * 13 + ph);
      const ridge = Math.max(0, 1 - Math.abs(v - 1 / 3) / .05), roll = k > 0 ? .0022 * Math.exp(-((k / .03) ** 2)) + .0016 : 0;
      const curl = Math.pow(Math.max(Math.abs(a), Math.abs(b)), 4);
      const y = .0016 + roll + Math.max(0, ridge * .0025 + hh * .007 + curl * .005 + .002 + T.crinkle(a, b, 7) * .0008);
      const sole = Math.max(0, 1 - Math.hypot((u - .55) / .32, (v - .38) / .22)), tread = Math.sin(v * 70 + u * 8) > 0 ? 1 : 0;
      const dirt = .05 + clamp(sole * 1.8, 0, 1) * (.4 + .4 * tread) + curl * .15;
      return [cx + ca * lx - sa * lz, y, cz + sa * lx + ca * lz, .2 * clamp(.92 + hh * .6 + ridge * .06, .72, 1.04), clamp(dirt, 0, .8)];
    });
  }
}
// ### The paper-towel dispenser by the sinks, the kind that hangs in every institution: a cabinet of brushed stainless
// ### steel (its grain runs up and down, with greasy fingerprints where people push the cover) with rounded front
// ### corners and edges, the front cover hinged at the top and its seam along the sides, a lock with its key slot, a
// ### narrow window of smoked plastic showing how many towels are left, and underneath the slot the towels come out of,
// ### with the next towel hanging out ready to be pulled: the bottom of a C-folded sheet, half unfolded, bowing out a
// ### little and wavy along its edge. wx is the wall, cy and cz the middle of the cabinet; T takes the towel.
function buildDispenser(wx, cy, cz, T){
  const rr = mulberry32(3307), d = .105, hw = .14, hgt = .34, rc = .028, bt = .007, bs = .005, y0 = cy - hgt / 2, F = wx + d + 2 * bs, B = y0 - bt;
  // ### The grain and the fingerprints, as gloss: fine lines up and down, and soft, smooth smudges of fingertips, most of
  // ### them on the lower half where people push the cover or tug at a towel. three.js lays every map with the normal
  // ### map's repeat, which is one per metre here, so the picture covers a metre at 2 mm a pixel.
  const grain = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(0,118,0)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++){ const x = rr() * w, y = rr() * h, l = 30 + rr() * 300, v = 80 + rr() * 90 | 0; g.strokeStyle = `rgba(0,${v},0,.4)`; g.lineWidth = .4 + rr() * .6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rr() - .5) * 1.5, y + l); g.stroke(); }
    for (let k = 0; k < 90; k++){
      const x = rr() * w, y = rr() * h, rx = 2.5 + rr() * 3, a = rr() * 3;
      g.save(); g.translate(x, y); g.rotate(a); g.scale(1, 1.3);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, 'rgba(0,64,0,.4)'); gr.addColorStop(1, 'rgba(0,64,0,0)'); g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
  });
  grain.encoding = THREE.LinearEncoding;
  const steel = steelMat(0xb4babe, 1, { roughnessMap: grain });
  // the cabinet: its plan (depth out from the wall, width) drawn up its height, the top and bottom edges rounded
  { const s = new THREE.Shape();
    s.moveTo(0, -hw); s.lineTo(d - rc, -hw); s.quadraticCurveTo(d, -hw, d, -hw + rc); s.lineTo(d, hw - rc); s.quadraticCurveTo(d, hw, d - rc, hw); s.lineTo(0, hw); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: hgt, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 3, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2); geo.translate(wx + bs, y0, cz); add(new THREE.Mesh(geo, steel)); }
  // the seam of the front cover, down both sides and across the top, 2 cm out from the wall
  for (const s of [-1, 1]) box(.0018, hgt - .01, .0012, M.dark, wx + .024, cy, cz + s * (hw + bs + .0002));
  box(.0018, .0012, hw * 2 - .01, M.dark, wx + .024, y0 + hgt + bt + .0003, cz);
  // the lock near the top of the cover, with its key slot
  { const lk = cyl(.0085, .0085, .006, M.chrome, F + .0025, y0 + hgt - .032, cz, 18); lk.rotation.z = Math.PI / 2; }
  box(.0015, .009, .0018, M.dark, F + .0058, y0 + hgt - .032, cz);
  // ### The level window: smoked plastic over the stack of folded towels, about half full; above the stack the cabinet
  // ### is dark inside.
  { const stack = canvasTex(32, 256, (g, w, h) => {
      g.fillStyle = '#0d0e0f'; g.fillRect(0, 0, w, h);
      for (let y = h * .46; y < h; y += 3 + rr() * 1.5){ const v = 150 + rr() * 50 | 0; g.fillStyle = `rgb(${v},${v - 4},${v - 12})`; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + 2, w, 1); }
      const sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(.5, 'rgba(0,0,0,.2)'); sh.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = sh; g.fillRect(0, 0, w, h);
    });
    box(.003, .166, .034, M.dark, F + .0003, cy - .01, cz);
    plane(.024, .15, new THREE.MeshStandardMaterial({ map: stack, roughness: .12, metalness: 0, envMapIntensity: 1.2 }), F + .0019, cy - .01, cz, Math.PI / 2); }
  // the slot underneath, with a rolled lip along its front edge
  box(.032, .002, .2, M.dark, F - .036, B - .0004, cz);
  { const lip = cyl(.0035, .0035, .2, M.steel, F - .018, B - .0015, cz, 10); lip.rotation.x = Math.PI / 2; }
  // the next towel hanging from the slot
  const fold = T.creases(6, .3, .8, .04, .09), ph = [rr() * 6.283, rr() * 6.283];
  T.sheet(16, 12, .2, .09, (u, t) => {
    const a = u * 2 - 1, b = t * 2 - 1, hh = fold(a, b);
    const y = B - .002 - t * .085 * (1 + .07 * Math.sin(u * 9 + ph[0]) * t);
    const x = F - .036 + .012 * t + .03 * t * t + Math.sin(u * 7 + ph[1]) * .004 * t + hh * .012 * t + Math.max(0, 1 - Math.abs(t - .62) / .08) * .004;
    return [x, y, cz + (u - .5) * (.2 - .02 * t), .95 * clamp(1 + hh * 1.2, .82, 1.04)];
  });
}
// ### Details that make the washroom feel used and real: tiled skirting, soft shadows in every corner, a camera watching,
// ### an air vent, the light switch and intercom by the door, a towel dispenser and a bin by the sinks, lamp housings.
{
  // dark glazed skirting tiles round the walls (not across the doorway)
  box(W, .1, .02, M.cove, 0, .05, -D / 2 + .01); box(3.45, .1, .02, M.cove, -2.275, .05, D / 2 - .01); box(3.45, .1, .02, M.cove, 2.275, .05, D / 2 - .01);
  box(.02, .1, D, M.cove, -W / 2 + .01, .05, 0); box(.02, .1, D, M.cove, W / 2 - .01, .05, 0);
  // soft shadows: along the floor, under the ceiling, up every corner and where the partition meets the wall
  const up = v3(0, 1, 0), down = v3(0, -1, 0);
  for (const [y, n, w] of [[.0015, up, .42], [H - .0015, down, .5]]){
    aoEdge(W, w, v3(0, y, -D / 2), v3(0, 0, 1), n); aoEdge(W, w, v3(0, y, D / 2), v3(0, 0, -1), n);
    aoEdge(D, w, v3(-W / 2, y, 0), v3(1, 0, 0), n); aoEdge(D, w, v3(W / 2, y, 0), v3(-1, 0, 0), n);
  }
  aoEdge(2.3, .3, v3(SX0 + .02, .0015, -1.85), v3(1, 0, 0), up); aoEdge(2.3, .3, v3(SX0 - .02, .0015, -1.85), v3(-1, 0, 0), up);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    aoEdge(H, .35, v3(sx * W / 2, H / 2, sz * (D / 2 - .002)), v3(-sx, 0, 0), v3(0, 0, -sz));
    aoEdge(H, .35, v3(sx * (W / 2 - .002), H / 2, sz * D / 2), v3(0, 0, -sz), v3(-sx, 0, 0));
  }
  for (const sx of [-1, 1]) aoEdge(1.9, .22, v3(SX0 + sx * .02, 1.1, -D / 2 + .002), v3(sx, 0, 0), v3(0, 0, 1));
  flat(.9, 2.9, M.blob, -3.7, 0); flat(.7, .7, M.blob, 3.35, 2.45); flat(.8, .8, M.stain, 0, .3); WATER.puddle(1.15, .75, -3.2, .55);
  WATER.puddle(1.6, 1.3, -.25, .75);   // round the floor drain in the middle
  // ### The security cameras. High in the north-west corner a bullet camera on a wall bracket: a rounded housing of
  // ### off-white powder-coated aluminium under a sunshield, dark glass in front with the lens and a ring of infrared
  // ### LEDs glowing faintly red, a status light that blinks, and its cable looping from the back into a grey conduit
  // ### that runs up the wall to the ceiling. Over the stall a vandal-proof dome camera hangs from the ceiling: a smoked
  // ### dome on a white base, the camera inside only just visible.
  const camWhite = new THREE.MeshStandardMaterial({ color: 0xd2d2c8, roughness: .55, map: canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#e8e8e2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++){ g.fillStyle = `rgba(90,80,60,${rnd() * .08})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); }   // dust and grime
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(110,95,70,.18)'); gr.addColorStop(.4, 'rgba(110,95,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }) });
  const glassDark = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: .04, metalness: .6, envMapIntensity: 1.4 });
  const lensCoat = new THREE.MeshStandardMaterial({ color: 0x241a52, roughness: .08, metalness: 1, envMapIntensity: 1.6 });
  const irLed = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0x6a0a06, emissiveIntensity: .9, roughness: .3 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: .6 });
  const conduitMat = new THREE.MeshStandardMaterial({ color: 0x8e9290, roughness: .5 });
  const cctv = new THREE.Group(); cctv.position.set(-3.72, 2.66, -2.72); cctv.rotation.set(-.42, -Math.PI * .75, 0, 'YXZ'); room.add(cctv);
  const part = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true; cctv.add(m); return m; };
  // the housing: a rounded section drawn out along the camera's axis (its front is towards -z)
  { const s = new THREE.Shape(); roundedRect(s, -.05, -.045, .05, .045, .03);
    const g = new THREE.ExtrudeGeometry(s, { depth: .24, bevelEnabled: true, bevelThickness: .008, bevelSize: .006, bevelSegments: 3, curveSegments: 8 }); g.translate(0, 0, -.12); part(g, camWhite, 0, 0, 0); }
  // the sunshield: a thin curved hood over the top that reaches out past the glass
  { const g = new THREE.CylinderGeometry(.066, .066, .3, 24, 1, true, -Math.PI * .42, Math.PI * .84); g.rotateX(-Math.PI / 2); const m = part(g, camWhite, 0, .012, -.03); m.material = camWhite.clone(); m.material.side = THREE.DoubleSide; }
  // the front: a dark bezel, smoked glass, the lens barrel and its coated glass, the infrared ring and the status light
  part(new THREE.CylinderGeometry(.047, .047, .012, 28), M.dark, 0, 0, -.13, Math.PI / 2);
  part(new THREE.CylinderGeometry(.043, .043, .002, 28), glassDark, 0, 0, -.137, Math.PI / 2);
  part(new THREE.CylinderGeometry(.017, .019, .01, 20), M.black, 0, 0, -.132, Math.PI / 2);
  part(new THREE.SphereGeometry(.012, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .45, 1), lensCoat, 0, 0, -.136, -Math.PI / 2);
  for (let i = 0; i < 10; i++){ const a = i / 10 * Math.PI * 2; part(new THREE.CylinderGeometry(.0042, .0042, .002, 10), irLed, Math.cos(a) * .031, Math.sin(a) * .031, -.1365, Math.PI / 2); }
  part(new THREE.SphereGeometry(.004, 8, 6), M.led, .034, -.034, -.128);
  // the back: an end cap and the cable gland
  part(new THREE.CylinderGeometry(.04, .044, .012, 24), camWhite, 0, 0, .128, Math.PI / 2);
  part(new THREE.CylinderGeometry(.007, .009, .02, 10), M.black, 0, -.02, .14, Math.PI / 2);
  // the mount on top: a plate on the housing and a ball joint
  part(new THREE.BoxGeometry(.05, .008, .06), camWhite, 0, .052, .04);
  part(new THREE.SphereGeometry(.016, 14, 10), M.dullSteel, 0, .07, .04);
  cctv.updateMatrixWorld(true);
  const ball = cctv.localToWorld(v3(0, .07, .04)), gland = cctv.localToWorld(v3(0, -.02, .15));
  // the bracket: a plate screwed to the west wall and an arm from it to the ball joint
  const WP = v3(-3.985, ball.y + .02, ball.z - .04);
  box(.012, .1, .1, camWhite, WP.x, WP.y, WP.z);
  for (const dy of [-.035, .035]) for (const dz of [-.035, .035]){ const sc = cyl(.005, .005, .003, M.chrome, WP.x + .008, WP.y + dy, WP.z + dz, 6); sc.rotation.z = Math.PI / 2; }
  { const from = v3(WP.x + .006, WP.y, WP.z), len = from.distanceTo(ball), arm = add(new THREE.Mesh(new THREE.CylinderGeometry(.013, .016, len, 12), camWhite));
    arm.position.copy(from).add(ball).multiplyScalar(.5); arm.quaternion.setFromUnitVectors(v3(0, 1, 0), ball.clone().sub(from).normalize()); }
  // the cable: from the gland it sags in a loop and goes into the bracket, then a conduit runs up the wall to the ceiling
  { const pts = [gland, v3(gland.x - .02, gland.y - .09, gland.z - .02), v3(WP.x + .04, WP.y - .1, WP.z + .02), v3(WP.x + .01, WP.y - .045, WP.z)];
    add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, .0035, 6), cableMat)); }
  cyl(.012, .012, H - WP.y - .05, conduitMat, -3.982, (H + WP.y + .05) / 2, WP.z - .07, 10);
  for (const y of [WP.y + .2, H - .08]) box(.01, .02, .035, M.dullSteel, -3.99, y, WP.z - .07);   // its clips
  box(.03, .05, .03, conduitMat, -3.982, WP.y + .055, WP.z - .07);   // the junction where the cable enters it
  // the dome camera over the stall: a base ring on the ceiling, a smoked dome and the camera module dim inside it
  const DOME = v3(2.0, H, -.4);
  cyl(.085, .09, .03, camWhite, DOME.x, H - .015, DOME.z, 32);
  cyl(.075, .075, .008, M.dark, DOME.x, H - .033, DOME.z, 32);
  { const inner = add(new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 12), M.black)); inner.position.set(DOME.x, H - .07, DOME.z);
    const lens = add(new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .02, 16), lensCoat)); lens.position.set(DOME.x - .02, H - .085, DOME.z + .02); lens.rotation.set(.7, 0, .6);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.07, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: .03, metalness: .2, transparent: true, opacity: .72, envMapIntensity: 1.5 }));
    dome.position.set(DOME.x, H - .036, DOME.z); dome.renderOrder = 2; room.add(dome); }
  // a ventilation grille in the ceiling and one high on the wall above the toilet
  box(.52, .02, .42, M.grille, 1.1, H - .01, 1.5); box(.56, .012, .46, M.dullSteel, 1.1, H - .003, 1.5);
  box(.4, .25, .02, M.grille, 3.3, 2.5, -D / 2 + .012); box(.44, .29, .01, M.dullSteel, 3.3, 2.5, -D / 2 + .004);
  // the light switch by the door with its conduit to the ceiling, the intercom on the other side
  box(.08, .12, .035, M.dullSteel, -.85, 1.35, D / 2 - .018); box(.015, .035, .012, M.plastic, -.85, 1.35, D / 2 - .04);
  cyl(.012, .012, H - 1.41, M.dullSteel, -.85, (H + 1.41) / 2, D / 2 - .015, 8);
  for (const y of [1.9, 2.5]) box(.035, .02, .025, M.dullSteel, -.85, y, D / 2 - .013);
  box(.17, .24, .02, M.steel, .88, 1.45, D / 2 - .011);
  plane(.11, .11, M.speaker, .88, 1.5, D / 2 - .022, Math.PI);
  { const b = cyl(.02, .02, .02, M.red, .88, 1.38, D / 2 - .025, 16); b.rotation.x = Math.PI / 2; }
  // a paper-towel dispenser and a steel bin by the sinks, and the used towels: one mesh for all of them
  { const towels = paperTowels(mulberry32(2211));
    buildDispenser(-W / 2 + .01, 1.4, 2.05, towels);
    buildBin(-3.68, 2.25, towels);
    towels.done(); }
  flat(.55, .55, M.blob, -3.68, 2.25);
  // ### More of a real prison washroom: a stainless urinal trough on the north wall under the house rules, a barred
  // ### window of wired glass high up with the night behind it, two push-button showers on the east wall with their drain,
  // ### a steel bench bolted to the wall by the door, a fire extinguisher, a soap dispenser and a yellow wet-floor sign.
  { // the urinal trough: splashback, trough with a rolled rim and a film of water, brackets, flush pipe and waste pipe
    const X = -2, L = 2, Z = -D / 2;
    box(L, .9, .015, M.worn, X, .95, Z + .008);
    box(L, .02, .26, M.worn, X, .42, Z + .15); box(L, .2, .02, M.worn, X, .52, Z + .28);
    { const r = cyl(.016, .016, L, M.worn, X, .62, Z + .285, 12); r.rotation.z = Math.PI / 2; }
    for (const dx of [-L / 2, L / 2]) box(.02, .2, .28, M.worn, X + dx, .52, Z + .15);
    box(L - .04, .004, .24, M.water, X, .44, Z + .15);
    for (const dx of [-.8, 0, .8]) box(.04, .3, .2, M.dullSteel, X + dx, .26, Z + .11);
    cyl(.025, .025, .42, M.pipe, X - .8, .21, Z + .16, 12);
    { const f = cyl(.014, .014, L, M.chrome, X, 1.38, Z + .03, 10); f.rotation.z = Math.PI / 2; }
    cyl(.014, .014, 1.6, M.chrome, X + L / 2 - .1, 2.18, Z + .03, 10);
    box(.08, .12, .04, M.worn, X + L / 2 + .12, 1.2, Z + .02); { const b = cyl(.02, .02, .02, M.chrome, X + L / 2 + .12, 1.2, Z + .045, 14); b.rotation.x = Math.PI / 2; }
    flat(2.2, .7, M.stain, X, Z + .45); WATER.puddle(1.15, .55, X + .3, Z + .5);
  }
  { // the window: wired, frosted glass glowing faintly with the yard lights, five bars and a heavy steel frame
    const X = .4, Y = 2.3, Z = -D / 2, w = .9, h = .46;
    const wire = canvasTex(256, 128, (g, cw, ch) => { g.fillStyle = '#c7d4dc'; g.fillRect(0, 0, cw, ch); g.strokeStyle = 'rgba(40,46,50,.55)'; g.lineWidth = 1.5; for (let i = 0; i <= cw; i += 16){ g.beginPath(); g.moveTo(i, 0); g.lineTo(i, ch); g.stroke(); } for (let j = 0; j <= ch; j += 16){ g.beginPath(); g.moveTo(0, j); g.lineTo(cw, j); g.stroke(); } grime(g, cw, ch, 10, 'rgba(70,60,40,.3)', 40, true); });
    const glass = M.frost.clone(); glass.map = wire; glass.emissiveMap = wire;
    plane(w, h, glass, X, Y, Z + .01);
    for (const [bw, bh, dx, dy] of [[w + .1, .05, 0, h / 2 + .025], [w + .1, .05, 0, -h / 2 - .025], [.05, h + .1, -w / 2 - .025, 0], [.05, h + .1, w / 2 + .025, 0]]) box(bw, bh, .07, M.dullSteel, X + dx, Y + dy, Z + .035);
    for (let i = 0; i < 5; i++) cyl(.012, .012, h, M.steel, X - w / 2 + w * (i + .5) / 5, Y, Z + .05, 8);
    box(w + .14, .03, .1, M.dullSteel, X, Y - h / 2 - .06, Z + .05);   // the sill
  }
  { // two showers: supply pipe from the ceiling, wall plate, arm and head; a push-button valve; one drain in the floor
    for (const z of [.45, 1.55]){
      const X = W / 2;
      cyl(.016, .016, H - 2.05, M.pipe, X - .03, (H + 2.05) / 2, z, 10);
      box(.015, .16, .12, M.worn, X - .008, 2.05, z);
      { const a = cyl(.014, .014, .26, M.chrome, X - .13, 2.07, z, 10); a.rotation.z = Math.PI / 2; }
      { const hd = cyl(.055, .03, .05, M.chrome, X - .27, 2.04, z, 18); hd.rotation.z = -.5; }
      cyl(.05, .05, .003, M.dark, X - .285, 2.012, z, 18);
      box(.03, .16, .11, M.worn, X - .015, 1.2, z);
      { const b = cyl(.025, .025, .025, M.chrome, X - .035, 1.22, z, 16); b.rotation.z = Math.PI / 2; }
      box(.06, .015, .18, M.worn, X - .03, 1.0, z);   // a soap ledge
      flat(.8, .8, M.blob, X - .35, z);
    }
    box(.24, .01, .24, M.dullSteel, 3.55, .005, 1.0);
    for (let i = -2; i <= 2; i++) box(.2, .012, .018, M.dark, 3.55, .006, 1.0 + i * .04);
    WATER.puddle(1.3, 2.2, 3.35, 1.0); flat(1.1, 1.6, M.stain, 3.5, 1.0);
  }
  { // the steel bench bolted to the wall west of the door
    const X = -2.35, Z = D / 2;
    box(1.6, .04, .36, M.worn, X, .46, Z - .2); box(1.6, .06, .02, M.worn, X, .44, Z - .385);
    for (const dx of [-.65, .65]){ box(.04, .42, .3, M.dullSteel, X + dx, .23, Z - .17); box(.12, .12, .01, M.dullSteel, X + dx, .3, Z - .006); }
    for (const dx of [-.7, -.2, .2, .7]){ const b = cyl(.01, .01, .006, M.chrome, X + dx, .482, Z - .2, 6); }
    flat(1.9, .7, M.blob, X, Z - .25);
  }
  { // a soap dispenser between the sinks (the fire extinguisher by the door is further down: see loadExtinguisher)
    box(.08, .16, .08, M.steel, -3.935, 1.1, 0); box(.02, .02, .03, M.black, -3.89, 1.015, 0);   // on the splashback
  }
  { // ### The wet-floor sign by the showers: a folding A-frame of moulded yellow plastic, as cleaners use them. Two panels
    // ### with rounded tops hang from one hinge pin along the top, so they meet there without a gap, and splay out to the
    // ### floor. Each has a grip slot near the top, a raised rim round its edge and the print on its outer face: CAUTION,
    // ### the warning triangle with a person slipping, WET FLOOR and the Spanish line below, a little worn. The plastic is
    // ### scuffed and grubby towards the feet; small black rubber feet keep it from sliding.
    const g = new THREE.Group(); g.position.set(2.7, 0, 1.35); g.rotation.y = .5; room.add(g);
    const PW = .3, PL = .64, PD = .007, R0 = .055, PHI = Math.asin(.15 / PL), HY = PL * Math.cos(PHI) + .004;
    // the outline in the panel's plane: x across, y down from the hinge (0) to the foot (-PL); rounded top, small round feet
    const outline = (w, l, rt, rb, inset = 0) => {
      const s = new THREE.Shape(), x0 = -w / 2 + inset, x1 = w / 2 - inset, y0 = -l + inset, y1 = -inset;
      s.moveTo(x0 + rb, y0); s.lineTo(x1 - rb, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rb);
      s.lineTo(x1, y1 - rt); s.quadraticCurveTo(x1, y1, x1 - rt, y1); s.lineTo(x0 + rt, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rt);
      s.lineTo(x0, y0 + rb); s.quadraticCurveTo(x0, y0, x0 + rb, y0);
      return s;
    };
    const slot = () => { const h = new THREE.Path(), w = .055, y = -.06, r = .016; h.absarc(w, y, r, -Math.PI / 2, Math.PI / 2, false); h.absarc(-w, y, r, Math.PI / 2, Math.PI * 1.5, false); return h; };
    // the plastic: sign yellow, paler where it is rubbed, grey dirt and scuffs towards the feet (the caps' UVs are metres)
    const plasticTex = canvasTex(256, 512, (c, w, h) => {
      c.fillStyle = '#f2c417'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++){ c.fillStyle = `rgba(255,236,150,${rnd() * .12})`; c.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 30, 1 + rnd() * 3); }
      const d = c.createLinearGradient(0, h * .7, 0, h); d.addColorStop(0, 'rgba(90,80,50,0)'); d.addColorStop(1, 'rgba(90,80,50,.45)'); c.fillStyle = d; c.fillRect(0, h * .7, w, h * .3);
      grime(c, w, h, 14, 'rgba(110,95,50,.16)', 40, true);
      for (let i = 0; i < 70; i++){ const x = rnd() * w, y = h * (.45 + rnd() * .55), l = 3 + rnd() * 16, a = (rnd() - .5) * .8; c.strokeStyle = `rgba(70,60,35,${.15 + rnd() * .25})`; c.lineWidth = .6 + rnd(); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
    });
    plasticTex.wrapS = plasticTex.wrapT = THREE.RepeatWrapping; plasticTex.repeat.set(1 / PW, 1 / PL); plasticTex.offset.set(.5, 1);
    const plastic = new THREE.MeshStandardMaterial({ map: plasticTex, roughness: .38 });
    // the print, on a clear layer the size of the panel: u across, v from the foot (0) to the hinge (1)
    const printTex = canvasTex(400, 853, (c, w, h) => {
      const Y = f => (1 - f) * h;   // f: share of the panel's length from the foot
      c.fillStyle = '#141414'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 64px "Arial Narrow", Arial, sans-serif'; c.fillText('CAUTION', w / 2, Y(.79));
      // the warning triangle with rounded corners and a person slipping on the wet floor
      const tx = w / 2, ty0 = Y(.715), ty1 = Y(.43), half = (ty1 - ty0) * .62;
      c.lineJoin = 'round'; c.lineWidth = 16; c.strokeStyle = '#141414';
      c.beginPath(); c.moveTo(tx, ty0); c.lineTo(tx + half, ty1); c.lineTo(tx - half, ty1); c.closePath(); c.stroke();
      c.save(); c.translate(tx, ty1 - (ty1 - ty0) * .38); const k = (ty1 - ty0) / 220;
      c.lineCap = 'round'; c.lineWidth = 15 * k;
      c.beginPath(); c.arc(-26 * k, -52 * k, 13 * k, 0, 7); c.fillStyle = '#141414'; c.fill();                    // head, thrown back
      c.beginPath(); c.moveTo(-14 * k, -36 * k); c.lineTo(10 * k, 8 * k); c.stroke();                                 // body falling backwards
      c.beginPath(); c.moveTo(10 * k, 8 * k); c.lineTo(44 * k, -14 * k); c.lineTo(60 * k, -4 * k); c.stroke();       // one leg kicked up
      c.beginPath(); c.moveTo(10 * k, 8 * k); c.lineTo(24 * k, 40 * k); c.lineTo(42 * k, 46 * k); c.stroke();         // the other sliding away
      c.beginPath(); c.moveTo(-6 * k, -22 * k); c.lineTo(-44 * k, -14 * k); c.stroke();                                // arms flung out
      c.beginPath(); c.moveTo(-4 * k, -20 * k); c.lineTo(22 * k, -46 * k); c.stroke();
      c.lineWidth = 6 * k; c.beginPath(); for (let x = -70; x <= 70; x += 4) c.lineTo(x * k, 66 * k + Math.sin(x * .25) * 3 * k); c.stroke();   // the wet floor
      c.restore();
      c.font = '900 92px "Arial Narrow", Arial, sans-serif'; c.fillText('WET', w / 2, Y(.33)); c.fillText('FLOOR', w / 2, Y(.225));
      c.font = '800 34px "Arial Narrow", Arial, sans-serif'; c.fillText('CUIDADO', w / 2, Y(.145)); c.fillText('PISO MOJADO', w / 2, Y(.1));
      // worn away in flecks and along the edges where hands and mops knock it
      c.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 500; i++){ c.fillStyle = `rgba(0,0,0,${.4 + rnd() * .6})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2); }
      for (let i = 0; i < 18; i++){ const x = rnd() * w, y = h * (.75 + rnd() * .25); c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x, y, 6 + rnd() * 40, 1 + rnd() * 2); }
    });
    const print = new THREE.MeshStandardMaterial({ map: printTex, transparent: true, roughness: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const panelGeo = (() => { const s = outline(PW, PL, R0, .012); s.holes.push(slot()); return new THREE.ExtrudeGeometry(s, { depth: PD, bevelEnabled: true, bevelThickness: .0015, bevelSize: .0015, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, -PD / 2); })();
    // the raised rim round the outer face
    const rimGeo = (() => { const s = outline(PW - .004, PL - .004, R0 - .002, .01); s.holes.push(outline(PW - .03, PL - .03, R0 - .014, .004)); return new THREE.ExtrudeGeometry(s, { depth: .003, bevelEnabled: false, curveSegments: 10 }).translate(0, -.002, PD / 2); })();
    const printGeo = new THREE.PlaneGeometry(PW - .03, PL - .1).translate(0, -PL / 2 - .035, PD / 2 + .0022);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: .85 });
    for (const ry of [0, Math.PI]){
      const side = new THREE.Group(); side.rotation.y = ry; side.position.y = HY; g.add(side);
      const pivot = new THREE.Group(); pivot.rotation.x = -PHI; side.add(pivot);
      for (const [geo, mat] of [[panelGeo, plastic], [rimGeo, plastic], [printGeo, print]]){ const m = new THREE.Mesh(geo, mat); m.castShadow = mat !== print; m.receiveShadow = true; pivot.add(m); }
      for (const x of [-1, 1]){ const f = new THREE.Mesh(new THREE.BoxGeometry(.035, .012, .014), rubber); f.position.set(x * (PW / 2 - .03), -PL + .004, -.001); f.castShadow = true; pivot.add(f); }
    }
    // the hinge along the top: a steel pin through moulded knuckles from both panels
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, PW - .05, 8), M.dullSteel); pin.rotation.z = Math.PI / 2; pin.position.y = HY; g.add(pin);
    for (const x of [-.1, -.035, .035, .1]){ const k = new THREE.Mesh(new THREE.CylinderGeometry(.0085, .0085, .055, 14), plastic); k.rotation.z = Math.PI / 2; k.position.set(x, HY, 0); k.castShadow = k.receiveShadow = true; g.add(k); }
    flat(.5, .5, M.blob, 2.7, 1.35);
  }
}

// ### Prison cloth: broad black and sand stripes of a coarse cotton twill. The stripes' edges wander a little where the dye
// ### bled, the diagonal ribs of the twill and thicker and thinner threads run through it, and it is faded and grubby in
// ### places. Returns the colour and a matching bump map for the ribs. The stripes run across v (one dark and one sand
// ### stripe per repeat) and the texture tiles both ways; rib sets how strongly the twill shows. Used for the uniform on the wall and the sleeves of your arms.
function prisonCloth(w, h, repeat, rib = 1){
  const weave = (x, y) => (((x + y) & 3) < 2 ? 1 : -1) * (((x >> 1) + y) % 7 === 0 ? .4 : 1);   // the twill's diagonal ribs
  const slub = []; for (let y = 0; y < h; y++) slub.push((rnd() - .5) * .1);
  const ph = [rnd(), rnd(), rnd(), rnd()].map(p => p * Math.PI * 2), TAU = Math.PI * 2;
  const shift = x => (Math.sin(TAU * x / w * 3 + ph[0]) * 1.2 + Math.sin(TAU * x / w * 8 + ph[1]) * .6) * h / 256;
  const width = x => (Math.sin(TAU * x / w * 5 + ph[2]) * 1.1 + Math.sin(TAU * x / w * 11 + ph[3]) * .5) * h / 256;
  const map = canvasTex(w, h, g => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const yy = (y + shift(x) + h) % h, edge = Math.abs(yy - h / 2 - width(x)), dark = yy < h / 2 + width(x);
      const blur = Math.min(1, Math.min(edge, yy, h - yy) / 1.5), k = 1 + weave(x, y) * .035 * rib + slub[y] * .6 + (rnd() - .5) * .05;
      const c = dark ? [34, 32, 31] : [196, 186, 152], o = dark ? [196, 186, 152] : [34, 32, 31], mix = .5 - .5 * blur;
      const i = (y * w + x) * 4;
      for (let j = 0; j < 3; j++) d[i + j] = clamp((c[j] * (1 - mix) + o[j] * mix) * k, 0, 255);
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grime(g, w, h, 9, 'rgba(78,60,34,.16)', w * .35, false);              // old sweat and dirt
    grime(g, w, h, 6, 'rgba(240,232,210,.07)', w * .3, false);            // faded where it was scrubbed
  }, repeat);
  const bump = canvasTex(w, h, g => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const v = clamp(128 + weave(x, y) * 60 * rib + slub[y] * 400 + (rnd() - .5) * 30, 0, 255), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, repeat);
  bump.encoding = THREE.LinearEncoding;
  return { map, bump };
}
// ### The uniform is woven of coarse linen: a CC0 scan from Poly Haven (Rough Linen, fetched through its API) gives every
// ### thread. Its shades are laid over the painted stripes once the picture has loaded, and its normal and roughness
// ### maps give the weave its relief and its matt and shiny threads. The stripes keep their own repeat; the weave
// ### follows it, about one scan to each stripe pair.
const LINEN = { img: null, waiting: [] };
function linenCloth(cloth, mat, strength = 1){
  const paint = () => {
    const c = cloth.map.image, g = c.getContext('2d');
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = .85 * strength; g.drawImage(LINEN.img, 0, 0, c.width, c.height); g.restore();
    cloth.map.needsUpdate = true;
  };
  if (LINEN.img) paint();
  else {
    if (!LINEN.waiting.length){
      const im = new Image(), file = 'textures/uniform-linen-detail.jpg', done = () => ASSETS.itemEnd(file);
      im.onload = () => { LINEN.img = im; LINEN.waiting.splice(0).forEach(f => f()); done(); }; im.onerror = done;
      ASSETS.itemStart(file); im.src = file;
    }
    LINEN.waiting.push(paint);
  }
  mat.bumpMap = null;
  mat.normalMap = SCAN('uniform-linen-normal.jpg', false); mat.normalScale = new THREE.Vector2(.7 * strength, .7 * strength);
  mat.roughnessMap = SCAN('uniform-linen-rough.jpg', false); mat.roughness = 1;
  mat.needsUpdate = true;
  return mat;
}
// ### The prisoner's uniform, hung on a hook on the north wall under the red lamp: a striped jacket hung by its collar,
// ### and the matching trousers hung behind it by the waistband, their legs showing under the jacket. The jacket is a
// ### tube of cloth built point by point: gathered at the collar, the shoulders sagging down to either side, soft folds
// ### that grow towards the hem, the lower back pushed off the wall by the trousers. On it sit a turned down collar, a
// ### dark gap down the front with its buttons, a breast pocket whose stripes do not quite match, and a sewn on cloth
// ### patch with the number 1356 stamped on it. The stripes follow the cloth (texture v runs down it).
{
  const PERIOD = .13, LJ = .76;   // one black and one sand stripe; the jacket's length from the collar
  const tex = prisonCloth(256, 256, [1, 1]);
  const cloth = new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump, bumpScale: .0007, roughness: .97 });
  const clothD = cloth.clone(); clothD.side = THREE.DoubleSide;
  const gap = new THREE.MeshStandardMaterial({ color: 0x070606, roughness: 1, side: THREE.DoubleSide });
  // a tube of cloth: fn(t, a) gives the point at t (0 top .. 1 bottom) and angle a, and how far the cloth there is pulled
  // up against the hang (the stripes follow it); v0 + t * len is the length of cloth from the top
  const clothTube = (rows, cols, v0, len, fn) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++){
      const t = i / rows, p = fn(t, j / cols * Math.PI * 2); pos.push(p[0], p[1], p[2]); uv.push(j / cols * 3, -(v0 + t * len - (p[3] || 0)) / PERIOD);
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++){ const a = i * (cols + 1) + j, b = a + cols + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    const n = geo.attributes.normal;   // close the seam where the tube meets itself
    for (let i = 0; i <= rows; i++){ const a = i * (cols + 1), b = a + cols; const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1; n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l); }
    return geo;
  };
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const folds = (x, t) => (Math.sin(x * 30 + 1.3) * .6 + Math.sin(x * 53 + .4) * .25 + Math.sin(x * 13 + t * 4) * .5) * (.002 + .016 * ss(.15, 1, t));
  const g = new THREE.Group(); g.position.set(1.15, 1.84, -D / 2); room.add(g);
  const put = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  // the jacket: half its width, how far its back stands off the wall, and how far its front bulges, down its length
  const jw = t => .025 + .17 * ss(.01, .26, t) + .02 * ss(.26, 1, t);
  const back = t => .012 + .05 * ss(.4, .75, t);
  const jd = t => .018 + .03 * ss(0, .18, t) + .012 * t;
  // the point on the front of the jacket at x across and t down it
  const front = (x, t) => {
    const c = Math.pow(Math.min(1, Math.abs(x) / jw(t)), 1 / .6), s = Math.sqrt(Math.max(0, 1 - c * c));
    const z = back(t) + jd(t) * Math.pow(s, .7) + folds(x, t) * s + .018 * Math.exp(-Math.pow((t - .07) / .04, 2)) * s;   // bunched under the collar
    return [x + .008 * Math.sin(t * 5 + 1) * ss(.1, .6, t), -.03 - t * LJ, z];
  };
  // across the sagging shoulders a stripe runs downhill from the collar
  const sag = (x, t) => .07 * Math.pow(Math.min(1, Math.abs(x) / .19), 1.5) * (1 - ss(.15, .5, t)) + folds(x, t) * .2;
  put(clothTube(56, 36, 0, LJ, (t, a) => {
    const w = jw(t), c = Math.cos(a), sn = Math.sin(a), x = w * Math.sign(c) * Math.pow(Math.abs(c), .6);
    if (sn > 0) return [...front(x, t), sag(x, t)];
    return [x + .008 * Math.sin(t * 5 + 1) * ss(.1, .6, t), -.03 - t * LJ, back(t) + sn * .004, sag(x, t)];
  }), cloth);
  // a piece laid on the front of the jacket: corner(u, v) gives x and t, lift how far it stands off the cloth
  const onFront = (corner, nu, nv, lift, uvOf, mat) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++){
      const u = j / nu, v = i / nv, [x, t] = corner(u, v), p = front(x, t);
      pos.push(p[0], p[1], p[2] + lift(u, v)); uv.push(...uvOf(u, v, x, t));
    }
    for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++){ const a = i * (nu + 1) + j, b = a + nu + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    return put(geo, mat);
  };
  const clothUv = shift => (u, v, x, t) => [x * 6, -(t * LJ - sag(x, t) + shift) / PERIOD];
  // the turned down collar: a band round the hook and two points lying on the chest
  put(clothTube(4, 16, .3, .04, (t, a) => [Math.cos(a) * .034, -.006 - t * .04, .03 + Math.sin(a) * .024, 0]), cloth);
  for (const sd of [-1, 1]){
    const lerp = (p, q, k) => p + (q - p) * k;
    onFront((u, v) => [sd * lerp(lerp(.01, .045, u), lerp(.022, .04, u), v), lerp(lerp(.045, .08, u), lerp(.2, .19, u), v)], 6, 8,
      (u, v) => .006 + .006 * (1 - v), clothUv(.031), clothD);
  }
  // the dark gap where the two fronts meet, from the collar down to the hem, and five buttons beside it
  onFront((u, v) => [-.002 + u * .004, .17 + v * .83], 1, 40, () => .0008, (u, v) => [u, v], gap);
  for (let i = 0; i < 5; i++){
    const t = .22 + i * .15, p = front(-.018, t);
    const b = put(new THREE.CylinderGeometry(.0085, .0085, .005, 12), M.black); b.rotation.x = Math.PI / 2; b.position.set(p[0], p[1], p[2] + .004);
  }
  // the breast pocket on the left of the chest; its stripes are a little off the jacket's, its top edge is hemmed
  onFront((u, v) => [.045 + u * .105, .37 + v * .15], 8, 8, (u, v) => .004 + .002 * Math.sin(u * Math.PI), clothUv(.022), clothD);
  onFront((u, v) => [.045 + u * .105, .37 + v * .006], 8, 1, () => .0065, (u, v) => [u, v], gap);
  // the number patch above it: off-white cloth, the number stamped in black ink, worn, and stitched round the edge
  const numTex = canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = '#d6cfb8'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++){ const v = rnd() < .5 ? 255 : 60; c.fillStyle = `rgba(${v},${v},${v * .9},${rnd() * .09})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1); }
    grime(c, w, h, 5, 'rgba(90,70,40,.16)', 60, false);
    c.fillStyle = '#151413'; c.font = 'bold 86px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.translate(w / 2, h / 2 + 4); c.rotate(-.02); c.scale(1, 1.05); c.fillText('1356', 0, 0); c.restore();
    for (let i = 0; i < 700; i++){ c.fillStyle = `rgba(214,207,184,${.3 + rnd() * .6})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }   // worn ink
    c.strokeStyle = 'rgba(40,36,30,.75)'; c.lineWidth = 2; c.setLineDash([6, 5]); c.strokeRect(8, 8, w - 16, h - 16);   // the stitches
  });
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: .95, side: THREE.DoubleSide });
  onFront((u, v) => [.032 + u * .118, .255 + v * .076], 10, 4, () => .0045, (u, v) => [u, 1 - v], numMat);
  // the sleeves hang from the shoulders down both sides, in front of the body's edge, bunched a little at the elbow
  for (const sd of [-1, 1]){
    put(clothTube(26, 14, .16 + sd * .02, .54, (t, a) => {
      const r = .022 + .025 * ss(0, .14, t) - .006 * t + .003 * Math.sin(t * 19 + a * 2) + .004 * Math.exp(-Math.pow((t - .52) / .06, 2)) + .003 * ss(.93, .97, t);
      const cx = sd * (.15 + .065 * ss(0, .25, t)), cy = -.17 - t * .52, cz = .045 + .02 * ss(0, .2, t) + .045 * ss(.5, 1, t);
      return [cx + Math.cos(a) * r * .85, cy, cz + Math.sin(a) * r, Math.abs(Math.cos(a)) * .015];
    }), cloth);
    const cuff = put(new THREE.CircleGeometry(.036, 12), M.dark); cuff.rotation.x = Math.PI / 2; cuff.scale.x = .85; cuff.position.set(sd * .215, -.689, .11);
  }
  // the trousers' legs, hung behind the jacket by the waistband and showing below its hem
  for (const sd of [-1, 1]){
    put(clothTube(20, 16, .37 + sd * .03, .6, (t, a) => {
      const rx = .062 + .006 * t + .003 * Math.sin(t * 13 + a * 3 + sd), rz = .034 + .004 * t;
      return [sd * (.056 + .008 * t) + Math.cos(a) * rx, -.52 - t * .6, .052 + Math.sin(a) * rz, Math.abs(Math.cos(a)) * .01];
    }), cloth);
    const hem = put(new THREE.CircleGeometry(1, 16), M.dark); hem.rotation.x = Math.PI / 2; hem.scale.set(.066, .036, 1); hem.position.set(sd * .064, -1.119, .052);
  }
  // the hook it hangs on, screwed to the tiles
  box(.035, .07, .012, M.dullSteel, 1.15, 1.88, -D / 2 + .006);
  const hk = new THREE.Mesh(new THREE.TorusGeometry(.02, .005, 6, 12, Math.PI * 1.2), M.steel); hk.position.set(1.15, 1.86, -D / 2 + .03); hk.rotation.set(0, Math.PI / 2, Math.PI * .9); add(hk);
  flat(.5, .3, M.blob, 1.15, -D / 2 + .12);
}
// ### Toilet rolls dropped on the floor: lying on their sides at odd angles, one squashed, one with a long tail of paper
// ### unrolled across the stall floor into the puddle by the toilet.
{
  const paperTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#efe9d9'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++){ g.fillStyle = `rgba(140,130,105,${rnd() * .12})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.fillStyle = 'rgba(150,140,115,.35)'; for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 3, 2);   // the perforation
  }, [1, 1]);
  const paper = new THREE.MeshStandardMaterial({ map: paperTex, roughness: .95, side: THREE.DoubleSide });
  const card = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .9, side: THREE.DoubleSide });
  const R = .056, r = .021, LEN = .1;
  const rollGeo = new THREE.LatheGeometry([[r + .002, -LEN / 2], [R - .005, -LEN / 2], [R, -LEN / 2 + .005], [R, LEN / 2 - .005], [R - .005, LEN / 2], [r + .002, LEN / 2]].map(([a, b]) => new THREE.Vector2(a, b)), 20);
  const coreGeo = new THREE.CylinderGeometry(r, r, LEN + .002, 16, 1, true);
  const roll = (x, z, yaw, squash = 1) => {
    const grp = new THREE.Group(); grp.position.set(x, R * squash, z); grp.rotation.set(0, yaw, Math.PI / 2, 'YXZ'); room.add(grp);
    for (const [geo, mat] of [[rollGeo, paper], [coreGeo, card]]){ const mm = new THREE.Mesh(geo, mat); mm.scale.set(squash, 1, 1); mm.castShadow = mm.receiveShadow = true; grp.add(mm); }
    flat(.22, .2, M.blob, x, z);
  };
  // a strip of paper lying along a path on the floor, crumpled here and there, rising to the roll it came from
  const strip = pts => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))), n = 70, len = curve.getLength(), pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++){
      const t = i / n, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const lift = .003 + Math.max(0, Math.sin(t * 26 + 1)) * .007 * (1 - t * .6);
      for (const sd of [-1, 1]){ pos.push(p.x - tan.z * sd * .05, lift + sd * .003 * Math.sin(t * 41), p.z + tan.x * sd * .05); uv.push((sd + 1) / 2, t * len / .11); }
    }
    for (let i = 0; i < n; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, paper); mm.receiveShadow = true; room.add(mm);
  };
  roll(2.98, -1.3, .5); strip([[2.98, -1.3], [3.12, -1.52], [3.0, -1.78], [3.14, -2.02]]);   // in the stall, into the puddle
  roll(1.72, -2.68, 1.45);                                  // kicked into the stall corner
  roll(-3.15, -1.6, -.45, .7);                              // squashed flat by the sinks
  roll(.62, -1.62, 2.3); strip([[.62, -1.62], [.42, -1.48], [.2, -1.6], [.02, -1.42]]);   // in the middle of the room
}

// Environment map for the steel: a blurred stand-in of the room (tiled walls, dark floor, the bright tube), built once
{
  const envScene = new THREE.Scene();
  const et = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a3f3c'); gr.addColorStop(.4, '#9aa69e'); gr.addColorStop(.62, '#b9c2bb'); gr.addColorStop(.64, '#3c403e'); gr.addColorStop(1, '#1a1c1b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshBasicMaterial({ map: et, side: THREE.BackSide })));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, .08, .25), new THREE.MeshBasicMaterial({ color: 0xffffff })); strip.position.set(-.6, 1.45, .3); envScene.add(strip);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, .02).texture;
  scene.background = new THREE.Color(0x050607);
  // ### Then the real thing: Poly Haven's "Bank Vault" HDRI, stored as RGBE in a PNG (red, green, blue and a shared
  // ### exponent in the alpha channel), so the fluorescent tube in it is many times brighter than the walls, as in life.
  new THREE.TextureLoader(ASSETS).load('textures/bank-vault-rgbe.png', t => {
    t.encoding = THREE.RGBEEncoding; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = true;
    const env = pmrem.fromEquirectangular(t).texture;
    scene.environment.dispose(); scene.environment = env; t.dispose(); pmrem.dispose();
  }, undefined, () => pmrem.dispose());
}
// ### Surfaces that are not metal only pick up a little of the vault, as soft fill light; the metal shows all of it.
room.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial && !o.material.metalness && o.material.envMapIntensity === 1) o.material.envMapIntensity = .45; });

// ### The fire extinguisher by the door is a real one: Poly Haven's "Korean Fire Extinguisher 01" (Um Joorin, CC0),
// ### fetched once through its free API (models/fire-extinguisher.glb, the body and the gauge glass; the paper tag
// ### is left off). Its scanned textures show red paint on steel as it ages: glossy where it is whole, dull and dusty
// ### where hands and mops rub it, chipped to bare metal at the edges, the gauge under a scratched glass, the handle and
// ### the stand grey steel. The word on its label band was repainted in English (FIRE EXTINGUISHER) in the same worn
// ### white. Until the model has loaded, or if it cannot be, a simple extinguisher of cylinders stands in its place.
const extinguisher = new THREE.Group();
extinguisher.position.set(-1.25, 0, D / 2 - .14); extinguisher.rotation.y = Math.PI - .3; room.add(extinguisher);
function extinguisherStandIn(){
  const red = new THREE.MeshStandardMaterial({ color: 0x9c1f18, roughness: .35, metalness: .2 });
  const part = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; extinguisher.add(o); return o; };
  part(new THREE.CylinderGeometry(.075, .075, .44, 24), red, 0, .3, 0); part(new THREE.SphereGeometry(.075, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, .52, 0);
  part(new THREE.CylinderGeometry(.018, .022, .06, 12), M.dullSteel, 0, .61, 0); part(new THREE.BoxGeometry(.03, .02, .13), M.dullSteel, 0, .645, .03);
  part(new THREE.CylinderGeometry(.11, .12, .06, 24), M.dark, 0, .03, 0);
}
extinguisherStandIn(); loadExtinguisher();
flat(.5, .5, M.blob, -1.25, D / 2 - .14);
function loadExtinguisher(){
  loading('fire extinguisher', fetch('models/fire-extinguisher.glb').then(glbBytes).then(buf => {
    const { json, acc } = glbParts(buf);
    const arm = SCAN('fire-extinguisher-arm.jpg', false, 1, 1, 4), normal = SCAN('fire-extinguisher-normal.jpg', false, 1, 1, 4), color = SCAN('fire-extinguisher-color.jpg', true);
    for (const t of [arm, normal, color]) t.flipY = false;   // glTF pictures are not flipped
    const mats = [
      // paint and steel: the scan's red, its gloss (green) and its bare metal (blue); the dust in its creases (red)
      new THREE.MeshStandardMaterial({ map: color, normalMap: normal, roughnessMap: arm, metalnessMap: arm, aoMap: arm, roughness: 1, metalness: 1, envMapIntensity: 1.1 }),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .05, metalness: 0, transparent: true, opacity: .25, depthWrite: false })
    ];
    while (extinguisher.children.length) extinguisher.remove(extinguisher.children[0]);
    json.meshes[0].primitives.forEach((prim, k) => {
      const geo = new THREE.BufferGeometry(), A = prim.attributes;
      geo.setAttribute('position', new THREE.BufferAttribute(acc(A.POSITION), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(acc(A.NORMAL), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(acc(A.TEXCOORD_0), 2));
      geo.setAttribute('uv2', geo.attributes.uv);
      geo.setIndex(new THREE.BufferAttribute(acc(prim.indices), 1));
      const m = new THREE.Mesh(geo, mats[k]); m.castShadow = k === 0; m.receiveShadow = true; m.renderOrder = k;
      extinguisher.add(m);
    });
    shadowsMoved();
  }));
}
// ### Static meshes that share a material are merged into one mesh, so the room is drawn in a few dozen draw calls instead
// ### of several hundred (and each shadow-casting light draws every caster once more). Objects that move or can be clicked
// ### stay separate. Runs once, after the room is built.
function mergeStatic(){
  const keep = new Set([mop, carKey, doorPivot, lidPivot, TDOOR.pivot, hale.g, hall, haleShadow, extinguisher, ...FLUO.lamps.map(l => l.housing)]), groups = new Map();
  room.updateMatrixWorld(true);
  (function walk(o){
    for (const c of o.children){
      if (keep.has(c)) continue;
      if (c.isMesh && c.visible && !c.userData.hot && !Array.isArray(c.material) && !c.children.length){
        const k = c.material.uuid + (c.castShadow ? ':c' : '') + (c.receiveShadow ? ':r' : '');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      }
      walk(c);
    }
  })(room);
  for (const list of groups.values()){
    if (list.length < 2) continue;
    const parts = list.map(m => {
      const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      return g;
    });
    const nv = parts.reduce((a, g) => a + g.attributes.position.count, 0), ni = parts.reduce((a, g) => a + g.index.count, 0);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
    let ov = 0, oi = 0;
    for (const g of parts){
      const n = g.attributes.position.count, ia = g.index.array;
      pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, ov * 2);
      for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov;
      ov += n; oi += ia.length; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, list[0].material);
    merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow; merged.renderOrder = list[0].renderOrder;
    merged.matrixAutoUpdate = false; room.add(merged);
    for (const m of list) m.parent.remove(m);
  }
}
mergeStatic();

// ---------- Camera: walking and looking around ----------
// ### You walk freely through the washroom in the first person: the arrow keys (or W A S D) walk, dragging the mouse or a
// ### finger turns your head. Where you stand decides which part of the room the rules see you in (the door, the sinks or
// ### the stall), so the markers of that part appear as you walk in. A touch screen has no arrow keys, so there the "Walk
// ### to" buttons glide you to a spot instead; the hatch, the briefing and the endings use the same glide. After Ending A
// ### you walk on through the tunnel the same way, down to the door at its far end.
const VIEWS = {
  intro: { pos: [0, 1.62, 2.2], look: [0, 1.4, -3] },
  door: { pos: [-.9, 1.62, 1.2], look: [1.25, .95, 3] },
  sinks: { pos: [-2.15, 1.62, .1], look: [-4, 1.15, 0] },
  stall: { pos: [3.25, 1.62, -.95], look: [2.4, .55, -2.6] },
  hatch: { pos: [2.3, 1.02, -.86], look: [2.22, .05, -1.55] },
  tunnel: { pos: [2.2, -1.98, -1.1], look: [2.2, -2.12, 5] },
  tunnelDoor: { pos: [TUN.x, TUN.floor + 1.62, TUN.zS - .95], look: [TUN.x, TUN.floor + .9, TUN.zS] },
  tunnelOut: { pos: [TUN.x, TUN.floor + 1.62, TUN.zS - .3], look: [TUN.x, TUN.floor + 1.45, TUN.zS + 3] },
  cell: { pos: [0, 1.62, 1.1], look: [0, 1.45, 3] },
  closing: { pos: [.5, 1.5, -.3], look: [-.05, 1.05, 3] }
};
const EYE = 1.62, WALK_SPEED = 1.7, BODY = .26, LOOK_SPEED = .0042, NECK_BEND = .15;   // NECK_BEND: the eyes' distance from where the head bends
// lookYaw and lookPitch are where the mouse points the head; yaw and pitch follow them within a few milliseconds, so uneven
// mouse events never make the picture jerk
const cam = { pos: new THREE.Vector3(...VIEWS.intro.pos), yaw: 0, pitch: 0, lookYaw: 0, lookPitch: 0, from: null, t: 1, dur: 1,
  vel: new THREE.Vector3(), stride: 0, bob: 0, sway: 0, stepAmp: 1 };
camera.rotation.order = 'YXZ';
// ### The camera angles that look at a point.
const anglesTo = (pos, look) => { const d = new THREE.Vector3(...look).sub(new THREE.Vector3(...pos)); return { yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }; };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
let camTarget = { pos: new THREE.Vector3(...VIEWS.intro.pos), ...anglesTo(VIEWS.intro.pos, VIEWS.intro.look) };
Object.assign(cam, { yaw: camTarget.yaw, pitch: camTarget.pitch, lookYaw: camTarget.yaw, lookPitch: camTarget.pitch });
// ### Moves the camera smoothly to another place in the cell.
function goView(name, dur){
  const v = VIEWS[name];
  cam.yaw = wrapAngle(cam.yaw);
  cam.from = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch };
  camTarget = { pos: new THREE.Vector3(...v.pos), ...anglesTo(v.pos, v.look) };
  // turn the short way round
  while (camTarget.yaw - cam.from.yaw > Math.PI) camTarget.yaw -= Math.PI * 2;
  while (camTarget.yaw - cam.from.yaw < -Math.PI) camTarget.yaw += Math.PI * 2;
  cam.t = 0; cam.dur = REDUCED ? .01 : (dur || 1.1); cam.vel.set(0, 0, 0);
}

// ### What you bump into, seen from above as rectangles [x0, x1, z0, z1]: the sink counter, the bin, the bucket, the stall
// ### partitions, its open door and the toilet. The walls are the edges of the room. You are a circle of BODY metres.
const SOLID = [
  [-4, -3.5, -1.3, 1.3], [-3.85, -3.51, 2.08, 2.42], [3.15, 3.55, 2.25, 2.65],
  [1.47, 1.53, -3, -.68], [1.47, 1.8, -.73, -.67], [3.7, 4, -.73, -.67], [3.68, 3.87, -.7, .2],
  [2.95, 3.55, -3, -2.14],
  [-3.05, -.95, -3, -2.68], [-3.17, -1.53, 2.58, 3], [-1.35, -1.15, 2.78, 3], [2.5, 2.9, 1.15, 1.55], [.88, 1.42, -3, -2.82]
];
// ### Keeps the circle you stand in out of every solid and inside the walls; it slides along what it touches.
function collide(p){
  for (let n = 0; n < 2; n++){
    for (const [x0, x1, z0, z1] of SOLID){
      const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= BODY) continue;
      if (d > 1e-6){ p.x = cx + dx / d * BODY; p.z = cz + dz / d * BODY; }
      else { // the centre is inside: leave by the nearest side
        const out = [[x0 - BODY - p.x, 0], [x1 + BODY - p.x, 0], [0, z0 - BODY - p.z], [0, z1 + BODY - p.z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
        p.x += out[0]; p.z += out[1];
      }
    }
    p.x = clamp(p.x, -W / 2 + BODY, W / 2 - BODY); p.z = clamp(p.z, -D / 2 + BODY, D / 2 - BODY);
  }
}
// ### Down in the tunnel: between its side walls, from the foot of the ladder to just before the door.
function collideTunnel(p){
  p.x = clamp(p.x, TUN.x - TUN.r + BODY, TUN.x + TUN.r - BODY); p.z = clamp(p.z, TUN.ladderZ + .4, TUN.zS - .75);
}
// ### Which part of the room a spot belongs to. You have to be well inside a new part before it counts, so walking along
// ### a border never switches back and forth.
function zoneAt(x, z, now){
  const m = n => (now === n ? .12 : -.12);
  if (x > SX0 && z < SZ1 + .45 + m('stall')) return 'stall';
  if (x < -1.7 + m('sinks')) return 'sinks';
  return 'door';
}
const MOVE_KEYS = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
const held = new Set();
const canWalk = () => overlay.hidden && !paused && S.scene !== 'intro' && cam.t >= 1 && (!S.ending || (tunnelWalk && tunnelWalk.door < 0));
// ### Walking into another part of the room tells the rules, quietly after the first visit. From the hatch you stand up first.
const seenScenes = new Set();
function walkInto(zone){
  if (S.scene === 'hatch' && zone !== 'stall') act('go', 'stall', true);
  if (S.scene !== zone) act('go', zone, true);
}
// ### One step of walking: speed builds up and fades out smoothly, you slide along walls, and the floor answers with real
// ### footsteps (see "Footsteps"). The head moves as in a real walk (not with reduced motion): it dips a little at every footfall and rises
// ### over the standing leg, and the body shifts its weight from one foot to the other, so the view sways gently from side
// ### to side once every two steps and tilts with it.
function walk(dt){
  // a card (a clue, the lock, a mini game, the pause) stops you on the spot; the mini games use the arrow keys themselves
  if (!canWalk()){ cam.vel.set(0, 0, 0); cam.bob *= .9; return; }
  let f = 0, s = 0;
  for (const k of held){ f += MOVE_KEYS[k][1]; s += MOVE_KEYS[k][0]; }
  const len = Math.hypot(f, s);
  if (len && S.scene === 'hatch'){ act('go', 'stall', true); }
  const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), sp = len ? WALK_SPEED / len : 0;
  const k = 1 - Math.exp(-dt * (len ? 10 : 14));
  cam.vel.x += ((fx * f - fz * s) * sp - cam.vel.x) * k;
  cam.vel.z += ((fz * f + fx * s) * sp - cam.vel.z) * k;
  const speed = Math.hypot(cam.vel.x, cam.vel.z);
  if (speed > .002){
    cam.pos.x += cam.vel.x * dt; cam.pos.z += cam.vel.z * dt;
    if (tunnelWalk) collideTunnel(cam.pos); else collide(cam.pos);
    const before = Math.floor(cam.stride / .8);
    cam.stride += speed * dt;
    if (Math.floor(cam.stride / .8) !== before){
      // no two steps are quite the same: each one dips the head a little more or less
      cam.stepAmp = .82 + Math.random() * .36;
      if (speed > .5) step(speed);
    }
    if (len) $('lookHint').classList.add('gone');
    if (!tunnelWalk){
      const z = zoneAt(cam.pos.x, cam.pos.z, S.scene === 'hatch' ? 'stall' : S.scene);
      if (z !== (S.scene === 'hatch' ? 'stall' : S.scene)) walkInto(z);
    }
  } else cam.vel.set(0, 0, 0);
  // stand up again after the hatch, and a gentle bob that fades in and out with the speed
  if (S.scene !== 'hatch') cam.pos.y += (EYE + (tunnelWalk ? TUN.floor : 0) - cam.pos.y) * (1 - Math.exp(-dt * 6));
  const gait = REDUCED ? 0 : Math.min(1, speed / WALK_SPEED), steps = cam.stride / .8, kb = 1 - Math.exp(-dt * 12);
  // lowest at each footfall (when the footstep sounds), highest halfway through the step
  cam.bob += ((Math.abs(Math.sin(Math.PI * steps)) - .64) * .026 * gait * cam.stepAmp - cam.bob) * kb;
  cam.sway += (Math.sin(Math.PI * steps) * .011 * gait - cam.sway) * kb;
}
// ### Moves the camera each frame: a glide when one runs, otherwise walking and looking.
function updateCamera(dt){
  if (climb){
    const p = updateClimb(dt);
    cam.pos.copy(p.pos); cam.yaw = cam.lookYaw = p.yaw; cam.pitch = cam.lookPitch = p.pitch; cam.bob = cam.sway = 0; cam.t = 1; cam.vel.set(0, 0, 0);
    camera.position.copy(cam.pos); camera.rotation.set(p.pitch, -p.yaw, p.roll);
    return;
  }
  if (cam.t < 1){
    cam.t = Math.min(1, cam.t + dt / cam.dur);
    const e = cam.t < .5 ? 2 * cam.t * cam.t : 1 - Math.pow(-2 * cam.t + 2, 2) / 2, px = cam.pos.x, pz = cam.pos.z;
    cam.pos.lerpVectors(cam.from.pos, camTarget.pos, e);
    // walking there with the buttons or a marker: the same footsteps, one every stride
    const moved = Math.hypot(cam.pos.x - px, cam.pos.z - pz);
    if (dt > 0 && moved / dt > .3 && S.scene !== 'intro' && (!S.ending || tunnelWalk)){
      const before = Math.floor(cam.stride / .8); cam.stride += moved;
      if (Math.floor(cam.stride / .8) !== before) step(Math.min(WALK_SPEED, moved / dt));
    }
    cam.lookYaw = cam.yaw = cam.from.yaw + (camTarget.yaw - cam.from.yaw) * e;
    cam.lookPitch = cam.pitch = cam.from.pitch + (camTarget.pitch - cam.from.pitch) * e;
    cam.bob *= .9; cam.sway *= .9;
  } else {
    const k = 1 - Math.exp(-dt * 30);
    cam.yaw += (cam.lookYaw - cam.yaw) * k; cam.pitch += (cam.lookPitch - cam.pitch) * k;
    walk(dt);
  }
  // the weight shift moves the eye sideways (to the right of where you look) and tilts the head a little with it; looking
  // down, the head bends forward on the neck as a real one does, so the eyes come forward and a little lower, over your feet
  const bend = Math.max(0, -clamp(cam.pitch, -1.5, 1.4)), ahead = NECK_BEND * Math.sin(bend), drop = NECK_BEND * (1 - Math.cos(bend));
  camera.position.set(cam.pos.x + Math.cos(cam.yaw) * cam.sway + Math.sin(cam.yaw) * ahead, cam.pos.y + cam.bob - drop, cam.pos.z + Math.sin(cam.yaw) * cam.sway - Math.cos(cam.yaw) * ahead);
  camera.rotation.set(clamp(cam.pitch, -1.5, 1.4), -cam.yaw, -cam.sway * .45);
}
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} initAudio(); });
canvas.addEventListener('pointermove', e => {
  if (drag){
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    // the first few pixels decide between a click and a drag; once it is a drag, every pixel turns the head
    if (drag.moved > 6){
      if (!drag.looking){ drag.looking = true; canvas.classList.add('dragging'); $('lookHint').classList.add('gone'); }
      if (cam.t >= 1){ cam.lookYaw += dx * LOOK_SPEED; cam.lookPitch = clamp(cam.lookPitch - dy * LOOK_SPEED, -1.48, 1.25); }
    }
  } else pendingHover = e;
});
canvas.addEventListener('pointerup', e => { if (drag && drag.moved <= 6) clickAt(e); drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });
if (COARSE) $('lookHint').textContent = 'Drag to look around · tap the markers';

// ---------- Your own hands ----------
// ### You see your own hands at the bottom of the picture, in the sleeves of the striped prison uniform (the same black
// ### and sand stripes as the coat on the wall). They live in a small scene of their own that is drawn over the room after
// ### a depth clear, so they never sink into a wall you stand close to and never show up in the puddles. The hands are
// ### real hand models with a skeleton (room-1-escape/models, MIT licence), so every finger bends at its own joints. Until
// ### they have loaded, or if they cannot load (for example when the page is opened straight from the folder), simple
// ### drawn hands stand in. They hide during the endings. With reduced motion they hold still.
const handScene = new THREE.Scene(), handCam = new THREE.PerspectiveCamera();
// (the scene's lights are set as seen when you look straight ahead; drawHands turns them as you look up or down, so the
// light on your hands and your body keeps coming from the lamps on the ceiling and bouncing up from the floor)
const HAND_LIGHTS = [new THREE.HemisphereLight(0xb9c6bf, 0x1c1410, .42)];
{
  const key = new THREE.DirectionalLight(0xe8ecdf, .62); key.position.set(.2, 1, -.4);
  const fill = new THREE.DirectionalLight(0xd9c7b8, .18); fill.position.set(-.3, -.4, .6);   // light bouncing off the floor
  const red = new THREE.PointLight(0xff2a1a, .12, 3); red.position.set(-.8, .5, -.6);   // the emergency lamps
  HAND_LIGHTS.push(key, fill, red);
  for (const l of HAND_LIGHTS){ l.userData.at = l.position.clone(); handScene.add(l); }
}
const brnd = mulberry32(4471);   // the cloth's and the boots' own random numbers, so the room keeps its look
// ### The skin of the real hands, drawn at 0.2 mm a pixel: the warm base with faint blotches and redder patches, freckles,
// ### veins showing blue-green through the skin, the fine criss-cross lines of the skin and its pores, and some dust from
// ### the ladder. The bump map gives the lines and the pores their depth. The first two loops draw from the room's own
// ### random numbers exactly as before (so everything after them in the room keeps its look); the rest uses its own.
function skinTextures(){
  const srnd = mulberry32(2207), S = 512, LINES = [];
  for (let i = 0; i < 900; i++){ const a = (srnd() < .5 ? .7 : -.7) + (srnd() - .5) * .35, x = srnd() * S, y = srnd() * S, l = 8 + srnd() * 30; LINES.push([x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, srnd()]); }
  const PORES = []; for (let i = 0; i < 9000; i++) PORES.push([srnd() * S, srnd() * S, srnd()]);
  const wrap = (g, f) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]){ g.save(); g.translate(dx, dy); f(); g.restore(); } };   // so the tiles meet without a seam
  const map = canvasTex(S, S, (g, w, h) => {
    g.fillStyle = '#a8765c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++){ const r = (2 + rnd() * 9) * 4; g.fillStyle = rnd() < .5 ? `rgba(176,104,84,${rnd() * .12})` : `rgba(214,170,140,${rnd() * .12})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 1600; i++){ g.fillStyle = `rgba(90,52,40,${rnd() * .07})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }   // pores
    const blob = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)')); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    wrap(g, () => {
      for (let i = 0; i < 26; i++) blob(srnd() * w, srnd() * h, 40 + srnd() * 90, srnd() < .5 ? 'rgba(186,96,80,.09)' : 'rgba(198,160,110,.08)');   // redder and yellower patches
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++){   // veins, faint and soft
        let x = srnd() * w, y = srnd() * h, a = srnd() * Math.PI * 2;
        g.strokeStyle = 'rgba(70,92,118,.05)';
        for (const lw of [9, 5]){ g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); let px = x, py = y, pa = a; for (let k = 0; k < 6; k++){ pa += (srnd() - .5) * .9; px += Math.cos(pa) * 22; py += Math.sin(pa) * 22; g.lineTo(px, py); } g.stroke(); }
      }
      for (let i = 0; i < 70; i++) blob(srnd() * w, srnd() * h, 1.5 + srnd() * 3, `rgba(120,66,44,${.2 + srnd() * .25})`);   // freckles
      for (const [x1, y1, x2, y2, v] of LINES){ g.strokeStyle = `rgba(112,66,52,${.05 + v * .06})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      for (let i = 0; i < 18; i++) blob(srnd() * w, srnd() * h, 14 + srnd() * 46, `rgba(84,72,60,${.08 + srnd() * .1})`);   // dust and grime from the ladder
    });
    for (const [x, y, v] of PORES){ g.fillStyle = `rgba(92,50,38,${.04 + v * .08})`; g.fillRect(x, y, 1.4, 1.4); }
  }, [3, 3]);
  const bump = canvasTex(S, S, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    wrap(g, () => { g.lineCap = 'round'; for (const [x1, y1, x2, y2, v] of LINES){ g.strokeStyle = `rgba(0,0,0,${.25 + v * .3})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); } });
    for (const [x, y, v] of PORES){ g.fillStyle = `rgba(0,0,0,${.2 + v * .3})`; g.fillRect(x, y, 1.6, 1.6); }
    for (let i = 0; i < 4000; i++){ g.fillStyle = srnd() < .5 ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'; g.fillRect(srnd() * w, srnd() * h, 3, 3); }   // the soft unevenness between
  }, [3, 3]);
  bump.encoding = THREE.LinearEncoding;
  return { map, bump };
}
const SKIN = skinTextures();
// ### Gives a geometry a white colour per corner, for materials that shade their folds with vertex colours.
function plainColours(geo){ geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3)); return geo; }
const HAND_MAT = {
  skin: new THREE.MeshStandardMaterial({ color: 0xa06e55, roughness: .66 }),
  nail: new THREE.MeshStandardMaterial({ color: 0xd9b3a0, roughness: .35 }),
  // the real hands: the skin above, matt but with a soft sheen
  real: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .58, envMapIntensity: .35, skinning: true, map: SKIN.map, bumpMap: SKIN.bump, bumpScale: .00025 }),
  sleeve: (() => { const c = prisonCloth(256, 256, [1, 3.2], .25); return linenCloth(c, new THREE.MeshStandardMaterial({ color: 0xc8c8c8, side: THREE.DoubleSide, map: c.map, vertexColors: true }), .8); })()
};
// ### The cuff and the sleeve, running from the wrist (the origin) back out of the picture along +z. The sleeve is a tube
// ### of cloth with soft folds, pushed up into rings of wrinkles behind the cuff and at the elbow.
function addSleeve(arm){
  arm.add(new THREE.Mesh(plainColours(new THREE.CylinderGeometry(.038, .04, .035, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, .05)), HAND_MAT.sleeve));
  const tube = clothTube([[0, .05], [.12, .049], [.6, .045], [1, .043]], [[.12, .1, .07], [.92, .1, .05]], 22, 30, (y, a) => (1 - y / .3) * .35 * (.7 + .3 * Math.sin(a * 4 + y * 9)), [0, 1]);
  arm.add(new THREE.Mesh(tube.rotateX(Math.PI / 2).scale(1, 1, .42).translate(0, -.004, .065), HAND_MAT.sleeve));
}
// ### The drawn stand-in hand with its forearm in a sleeve. The wrist is at the origin and the fingers point along -z, as
// ### the camera looks; side is 1 for the right hand and -1 for the left. Every part with the same material is merged, so
// ### each arm is drawn in three draw calls.
function buildHand(side){
  const arm = new THREE.Group();
  const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); (parent || arm).add(m); return m; };
  mesh(new THREE.SphereGeometry(1, 18, 12).scale(.043, .017, .052).translate(0, 0, -.046), HAND_MAT.skin);
  mesh(new THREE.SphereGeometry(1, 14, 10).scale(.035, .019, .03).translate(-side * .012, -.004, -.012), HAND_MAT.skin);   // the ball of the thumb
  [[-.027, .047, .031, .0088], [-.009, .052, .034, .0086], [.009, .049, .032, .0082], [.026, .038, .025, .0072]].forEach(([x, l1, l2, r], i) => {
    const base = new THREE.Group(); base.position.set(side * x, 0, -.09 + Math.abs(x) * .25); arm.add(base);
    mesh(new THREE.SphereGeometry(r * 1.04, 10, 8), HAND_MAT.skin, base);
    mesh(new THREE.CylinderGeometry(r * .95, r, l1, 9).rotateX(Math.PI / 2).translate(0, 0, -l1 / 2), HAND_MAT.skin, base);
    const mid = new THREE.Group(); mid.position.z = -l1; base.add(mid);
    mesh(new THREE.SphereGeometry(r * .93, 10, 8), HAND_MAT.skin, mid);
    mesh(new THREE.CylinderGeometry(r * .8, r * .92, l2, 9).rotateX(Math.PI / 2).translate(0, 0, -l2 / 2), HAND_MAT.skin, mid);
    mesh(new THREE.SphereGeometry(r * .8, 10, 8).translate(0, 0, -l2), HAND_MAT.skin, mid);
    mesh(new THREE.SphereGeometry(1, 8, 6).scale(r * .62, r * .25, r * .9).translate(0, r * .62, -l2 + r * .55), HAND_MAT.nail, mid);
    base.rotation.set(-.22 - i * .07, side * (i - 1.5) * -.03, 0); mid.rotation.x = -.38 - i * .06;
  });
  const thumb = new THREE.Group(); thumb.position.set(-side * .036, -.008, -.03); arm.add(thumb);
  thumb.rotation.set(-.25, side * .55, -side * .5);
  mesh(new THREE.SphereGeometry(.0105, 10, 8), HAND_MAT.skin, thumb);
  mesh(new THREE.CylinderGeometry(.0095, .0108, .036, 9).rotateX(Math.PI / 2).translate(0, 0, -.018), HAND_MAT.skin, thumb);
  const tip = new THREE.Group(); tip.position.z = -.036; tip.rotation.x = -.3; thumb.add(tip);
  mesh(new THREE.SphereGeometry(.0096, 10, 8), HAND_MAT.skin, tip);
  mesh(new THREE.CylinderGeometry(.0084, .0094, .029, 9).rotateX(Math.PI / 2).translate(0, 0, -.0145), HAND_MAT.skin, tip);
  mesh(new THREE.SphereGeometry(.0084, 10, 8).translate(0, 0, -.029), HAND_MAT.skin, tip);
  mesh(new THREE.SphereGeometry(1, 8, 6).scale(.0055, .002, .0075).translate(0, .0068, -.025), HAND_MAT.nail, tip);
  mesh(new THREE.CylinderGeometry(.027, .03, .05, 14).rotateX(Math.PI / 2).scale(1.25, .8, 1).translate(0, 0, .012), HAND_MAT.skin);
  addSleeve(arm);
  bakeArm(arm);
  handScene.add(arm);
  return { arm, wrist: null, fingers: null, thumb: null };
}
// ### Merges every part of an arm that shares a material into one mesh, in the arm's own space.
function bakeArm(arm){
  arm.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(arm.matrixWorld).invert(), groups = new Map(), m4 = new THREE.Matrix4();
  arm.traverse(o => { if (o.isMesh){ if (!groups.has(o.material)) groups.set(o.material, []); groups.get(o.material).push(o); } });
  arm.clear();
  for (const [mat, list] of groups){
    const parts = list.map(o => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)); o.geometry.dispose(); return g; });
    const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const col = mat.vertexColors ? new Float32Array(n * 3) : null;
    let o = 0;
    for (const g of parts){ pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); if (col) col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    arm.add(new THREE.Mesh(geo, mat));
  }
}
// ### Reads a binary glTF file (.glb) with one skinned mesh, as the hand models are: the mesh, its joints and the matrices
// ### that bind the skin to them. A few lines instead of three.js's GLTFLoader, so no other library has to be loaded.
function glbParts(buf){
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb file');
  const jsonLen = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))), bin = 20 + jsonLen + 8;
  const acc = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType], st = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(buf.slice(st, st + a.count * n * T.BYTES_PER_ELEMENT));
  };
  return { json, acc };
}
function readGlb(buf){
  const { json, acc } = glbParts(buf);
  const prim = json.meshes[0].primitives[0], A = prim.attributes, skin = json.skins[0];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(acc(A.POSITION), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(acc(A.NORMAL), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(acc(A.TEXCOORD_0), 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(acc(A.JOINTS_0)), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(acc(A.WEIGHTS_0), 4));
  geo.setIndex(new THREE.BufferAttribute(acc(prim.indices), 1));
  const nodes = json.nodes.map((n, i) => {
    const o = skin.joints.includes(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => nodes[i].add(nodes[c])));
  const ibm = acc(skin.inverseBindMatrices), inverses = skin.joints.map((j, k) => new THREE.Matrix4().fromArray(ibm, k * 16));
  const meshNode = json.nodes.findIndex(n => n.mesh !== undefined);
  return { geo, root: nodes[json.scenes[json.scene || 0].nodes[0]], meshParent: nodes[meshNode], bones: skin.joints.map(j => nodes[j]), inverses };
}
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
// ### Builds a real hand from its model: the joints are chained (wrist, knuckle, the three finger bones) so that bending
// ### one joint carries the rest of the finger with it, and the whole hand is turned so that its wrist sits at the origin
// ### with the fingers along -z and the back of the hand up, like the drawn hand. Then the forearm and sleeve are added.
function buildRealHand(side, buf){
  const m = readGlb(buf), by = {};
  m.root.traverse(o => { if (o.name) by[o.name] = o; });
  m.root.updateMatrixWorld(true);
  const chain = list => { for (let i = 1; i < list.length; i++) if (by[list[i]] && by[list[i - 1]]) by[list[i - 1]].attach(by[list[i]]); };
  chain(['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']);
  for (const f of FINGERS) chain(['wrist', f + '-finger-metacarpal', f + '-finger-phalanx-proximal', f + '-finger-phalanx-intermediate', f + '-finger-phalanx-distal', f + '-finger-tip']);
  const mesh = new THREE.SkinnedMesh(m.geo, HAND_MAT.real);
  mesh.frustumCulled = false;
  m.meshParent.add(mesh);
  m.root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(m.bones, m.inverses), mesh.matrixWorld);
  // put the wrist at the origin, facing the way the drawn hand does
  m.root.applyMatrix4(new THREE.Matrix4().copy(by.wrist.matrixWorld).invert());
  const arm = new THREE.Group(), wrist = new THREE.Group();
  wrist.add(m.root); arm.add(wrist); addSleeve(arm);
  const joint = o => ({ o, rest: o.quaternion.clone() });
  const fingers = FINGERS.map(f => [f + '-finger-phalanx-proximal', f + '-finger-phalanx-intermediate', f + '-finger-phalanx-distal'].map(n => joint(by[n])));
  const thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal'].map(n => joint(by[n]));
  handScene.add(arm);
  return { arm, wrist, fingers, thumb };
}
// ### Loads the two real hands and swaps them in for the drawn ones. If they cannot be loaded, the drawn hands stay.
function loadRealHands(){
  loading('hands', Promise.all(['right', 'left'].map(n => fetch('models/hand-' + n + '.glb').then(glbBytes)))
    .then(([r, l]) => {
      for (const [key, buf, side] of [['r', r, 1], ['l', l, -1]]){
        const h = buildRealHand(side, buf);
        handScene.remove(HANDS[key].arm);
        Object.assign(HANDS[key], h);
      }
    }));
}
// one hand's state: where it is and how fast it moves (springs), its swing size this stride, and its idle gesture
const handState = () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), wr: new THREE.Vector2(), wv: new THREE.Vector2(),
  amp: 1, ampT: 1, step: 0, curl: [0, 0, 0, 0, 0], gesture: null, gestureT: 0, nextGesture: 3 + Math.random() * 6, seed: Math.random() * 100, init: false });
const HANDS = { r: Object.assign(buildHand(1), handState()), l: Object.assign(buildHand(-1), handState()), reach: 0, down: 1 };
loadRealHands();
// ### Where each hand is (x, y, z from the eye) and how it is turned (pitch, yaw, roll). At rest the arms hang relaxed:
// ### the hands low at the edge of the picture, thumbs up and palms turned towards each other, the forearms rising from
// ### below. To use something the right hand turns palm down and reaches forward into the middle of the picture.
const HAND_REST = { r: [.2, -.215, -.37, -.06, .1, -.9], l: [-.2, -.221, -.38, -.06, -.08, .92] };
const HAND_REACH = [.12, -.165, -.5, .3, .35, -.35];
// how much each finger is bent at rest (index to little finger, then the thumb): a relaxed hand curls more towards the little finger
const CURL_REST = [.3, .4, .48, .56, .2];
// ### Little things a hand does while you stand still, now and then: make a loose fist, tap with the index finger,
// ### stretch the fingers or rub the thumb along the fingertips. Each is a curve over its duration, per finger.
const GESTURES = {
  fist: { dur: 1.6, curl: t => [.75, .8, .8, .8, .35].map(c => c * Math.sin(Math.PI * t)) },
  tap: { dur: 1.4, curl: t => [-.35 * Math.max(0, Math.sin(Math.PI * 4 * t)) * Math.sin(Math.PI * t), 0, 0, 0, 0] },
  stretch: { dur: 1.8, curl: t => [-.45, -.5, -.5, -.5, -.3].map(c => c * Math.sin(Math.PI * t)), spread: t => .18 * Math.sin(Math.PI * t) },
  rub: { dur: 2, curl: t => [.35, .3, .2, .1, .45 + .15 * Math.sin(Math.PI * 6 * t)].map(c => c * Math.sin(Math.PI * t)) }
};
const GESTURE_NAMES = Object.keys(GESTURES);
// ### The right hand reaches out when you use something (a marker, a click or a key).
function reachHand(){ if (!REDUCED) HANDS.reach = 1; }
// smooth noise: a few slow waves of unrelated speeds, so nothing ever repeats in step
const wobble = (seed, t) => Math.sin(t * .71 + seed) * .5 + Math.sin(t * 1.37 + seed * 2.3) * .3 + Math.sin(t * 2.9 + seed * 4.1) * .2;
// ### A spring pulls each value towards where it should be: it overshoots a little and settles, as a loose arm does.
function spring(x, v, target, k, damping, dt){
  const n = Math.max(1, Math.ceil(dt / .008)), h = dt / n;
  for (let i = 0; i < n; i++){ v += (k * (target - x) - damping * v) * h; x += v * h; }
  return [x, v];
}
// ### Moves the hands each frame. Walking swings the arms like pendulums, opposite to each other and to the legs, one
// ### swing every two steps, each swing a little different; the arms trail behind a turn of the head, the wrists flop a
// ### little behind the arms, and the fingers curl and open with the swing and drift on their own. Standing still, the
// ### hands breathe and now and then make a small gesture. Using something sends the right hand forward, fingers open.
function updateHands(dt){
  if (climb && climb.hands){ climbHands(dt); return; }
  leaveLadder();
  const show = tunnelWalk ? !endingShown : !S.ending && hatchAnim < 0 && camera.position.y > 0;
  HANDS.down += ((show ? 0 : 1) - HANDS.down) * (1 - Math.exp(-dt * 5));
  const still = REDUCED ? 0 : 1, t = clock;
  HANDS.reach = Math.max(0, HANDS.reach - dt / .55);
  const sp = Math.min(1, Math.hypot(cam.vel.x, cam.vel.z) / WALK_SPEED) * still, steps = cam.stride / .8, ph = steps * Math.PI;
  const reach = Math.sin(HANDS.reach * Math.PI) ** .7, lerp = (a, b, k) => a + (b - a) * k;
  for (const key of ['r', 'l']){
    const h = HANDS[key], [x, y, z, rx, ry, rz] = HAND_REST[key], side = key === 'r' ? 1 : -1, sd = h.seed;
    // every step the next swing gets its own size, so no two strides look the same
    if (Math.floor(steps) !== h.step){ h.step = Math.floor(steps); h.ampT = .78 + Math.random() * .4; }
    h.amp += (h.ampT - h.amp) * (1 - Math.exp(-dt * 3));
    const swing = h.swing = Math.sin(ph + (side > 0 ? Math.PI : 0) + wobble(sd, t * .5) * .25) * sp * h.amp;
    const out = key === 'r' ? reach : 0, R = HAND_REACH, idle = (1 - sp * .6) * still;
    const breathe = Math.sin(t * 1.6 + sd) * .0028 * still;
    // where the arm should be: rest pose, the swing (the elbow bends more on the way forward), a slow drift, the reach
    const tp = [lerp(x - side * swing * .022 + wobble(sd + 1, t) * .004 * idle, R[0], out),
      lerp(y + (swing > 0 ? swing * .065 : swing * .035) + breathe + wobble(sd + 2, t) * .004 * idle, R[1], out) - HANDS.down * .35,
      lerp(z - swing * .095 + wobble(sd + 3, t) * .005 * idle, R[2], out)];
    const tr = [lerp(rx + swing * .2 + wobble(sd + 4, t * .8) * .03 * idle, R[3], out),
      lerp(ry + swing * side * .1 + wobble(sd + 5, t * .8) * .03 * idle, R[4], out),
      lerp(rz + swing * side * .12 + wobble(sd + 6, t * .7) * .05 * idle, R[5], out)];
    if (!h.init){ h.p.fromArray(tp); h.r.fromArray(tr); h.init = true; }
    // springs: a quick, slightly loose follow; the head turning is felt as the arm trailing behind by itself
    const P = h.p.toArray(), Vp = h.v.toArray(), Rr = h.r.toArray(), W = h.w.toArray();
    for (let i = 0; i < 3; i++){
      [P[i], Vp[i]] = spring(P[i], Vp[i], tp[i], still ? 140 : 900, still ? 15 : 60, dt);
      [Rr[i], W[i]] = spring(Rr[i], W[i], tr[i], still ? 120 : 900, still ? 13 : 60, dt);
    }
    h.p.fromArray(P); h.v.fromArray(Vp); h.r.fromArray(Rr); h.w.fromArray(W);
    h.arm.position.copy(h.p);
    h.arm.rotation.set(h.r.x, h.r.y, h.r.z, 'YXZ');
    h.arm.visible = HANDS.down < .98;
    if (!h.wrist) continue;
    // the wrist lags behind the arm's movement and flops back, a little more on the back swing
    const wt = [-W[0] * .06 - Vp[1] * 1.6 + wobble(sd + 7, t * .6) * .05 * still - out * .15, -W[1] * .05 + wobble(sd + 8, t * .5) * .06 * still];
    const wr = h.wr.toArray(), wv = h.wv.toArray();
    for (let i = 0; i < 2; i++) [wr[i], wv[i]] = spring(wr[i], wv[i], clamp(wt[i], -.5, .5), still ? 70 : 900, still ? 7 : 60, dt);
    h.wr.fromArray(wr); h.wv.fromArray(wv);
    h.wrist.rotation.set(wr[0], wr[1], 0);
    // idle gestures: only while standing still with nothing in the hand
    let g = null, gk = 0;
    if (still && sp < .08 && out < .01){
      if (h.gesture){ h.gestureT += dt / GESTURES[h.gesture].dur; if (h.gestureT >= 1){ h.gesture = null; h.nextGesture = 4 + Math.random() * 9; } }
      else if ((h.nextGesture -= dt) <= 0){ h.gesture = GESTURE_NAMES[Math.floor(Math.random() * GESTURE_NAMES.length)]; h.gestureT = 0; }
      if (h.gesture){ g = GESTURES[h.gesture]; gk = h.gestureT; }
    } else if (h.gesture){ h.gesture = null; h.nextGesture = 3 + Math.random() * 6; }
    const gc = g ? g.curl(gk) : [0, 0, 0, 0, 0], spread = (g && g.spread ? g.spread(gk) : 0) + out * .14;
    for (let f = 0; f < 5; f++){
      // the fingers close a little as the hand swings back and open as it swings forward; each drifts on its own
      const target = (CURL_REST[f] - swing * .12 + wobble(sd + 10 + f, t * 1.1) * .07 * still + gc[f]) * (1 - out * .8);
      h.curl[f] += (target - h.curl[f]) * (1 - Math.exp(-dt * (g ? 10 : 6)));
    }
    poseFingers(h, side, spread);
  }
  poseBody(dt, show);
}
// ### Bends every finger joint of a real hand by its curl (index to little finger, then the thumb) and spreads them.
function poseFingers(h, side, spread){
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  h.fingers.forEach((bones, f) => bones.forEach((j, n) => {
    const c = h.curl[f] * [1, 1.25, .8][n], s = n ? 0 : side * (f - 1.5) * (.05 + spread * .5);
    j.o.quaternion.copy(j.rest).multiply(q.setFromEuler(e.set(-c, s, 0)));
  }));
  h.thumb.forEach((j, n) => { const c = h.curl[4] * [.5, 1, .9][n]; j.o.quaternion.copy(j.rest).multiply(q.setFromEuler(e.set(-c, n ? 0 : -side * c * .4, 0))); });
}
// ### Draws the hands over the room with the same lens as the eye, after clearing the depth so nothing hides them.
const _lq = new THREE.Quaternion(), _le = new THREE.Euler();
function drawHands(){
  if (!HANDS.r.arm.visible) return;
  handScene.environment = scene.environment;
  // down in the tunnel only the bulbs light your hands, until the door lets the night in
  const lit = 1 - clamp(-camera.position.y / 1.5, 0, 1) * .6 + nightLight.intensity * .08;
  handScene.traverse(l => { if (l.isLight){ if (l.userData.i0 === undefined) l.userData.i0 = l.intensity; l.intensity = l.userData.i0 * lit; } });
  // the lights stay where they are in the room when you look up or down (on the ladder they keep their own look)
  _lq.setFromEuler(_le.set(climb ? 0 : clamp(cam.pitch, -1.5, 1.4), 0, climb ? 0 : -cam.sway * .45, 'YXZ')).invert();
  for (const l of HAND_LIGHTS) l.position.copy(l.userData.at).applyQuaternion(_lq);
  handCam.projectionMatrix.copy(camera.projectionMatrix); handCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  renderer.autoClear = false; renderer.clearDepth();
  if (climb && climb.hands) renderer.render(GRIP_MASK, camera);   // on the ladder the rungs hide what wraps round behind them
  renderer.render(handScene, handCam); renderer.autoClear = true;
}

// ---------- Hotspots: markers and clicking objects ----------
// ### visibleHotspots() from rules.js says what can be used right now. Objects get a pulsing marker (a real button, so it
// ### works with a keyboard and on touch screens), and the hatch gets a marker of its own so you can kneel down at it.
// ### Clicking an object in the 3D view does the same as its marker. With a keyboard you walk with the arrow keys; only a
// ### touch screen shows the "Walk to" buttons that glide you to another part of the room.
const ANCHORS = {
  'take:mop': [3.6, .66, 2.66], 'wedge': [.38, 1.02, 2.86], 'tap': [-3.95, 1.07, -.53],
  'read:mirror': [-3.97, 1.75, .45], 'play:mirror': [-3.97, 1.75, .45], 'read:graffiti': [1.53, 1.5, -1.9], 'play:tile': [2.62, .58, -2.97], 'take:carkey': [2.62, .58, -2.97],
  'read:scratches': [1.75, 1.3, 2.95], 'play:scratches': [1.75, 1.3, 2.95],
  'lock': [2.2, .1, -1.1], 'go:hatch': [2.2, .06, -1.75],
  'open:door': [TUN.x - TDOOR.w / 2 + .2, TUN.floor + 1.3, TUN.zS - .03]
};
const keyOf = h => h.target ? `${h.action}:${h.target}` : h.action;
let markerEls = [];
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new THREE.Vector3();
// ### What can be used down in the tunnel after Ending A: the door at its far end once you stand in front of it, and
// ### from further away, on a touch screen, a button that walks you there.
const nearDoor = () => cam.pos.z > TUN.zS - 1.7;
function tunnelHotspots(){
  if (!tunnelWalk || tunnelWalk.door >= 0) return [];
  return [nearDoor() ? { action: 'open', target: 'door', label: 'Open the door' } : { action: 'walk', target: 'door', label: 'Walk to the door' }];
}
// ### Shows the markers for what can be used from here; Rules decides which those are (in the tunnel, the door does).
function renderHotspots(){
  const list = tunnelWalk ? tunnelHotspots() : R.visibleHotspots(S);
  const mk = $('markers'); mk.textContent = ''; markerEls = [];
  const go = $('goBtns'); go.textContent = '';
  for (const h of list){
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.hotspot = keyOf(h); b.setAttribute('aria-label', h.label);
    b.addEventListener('click', () => { initAudio(); use(h.action, h.target); });
    if ((h.action === 'go' && h.target !== 'hatch') || h.action === 'walk'){ b.textContent = h.label; go.appendChild(b); continue; }
    b.className = h.action === 'go' ? 'mk go' : 'mk'; b.innerHTML = '<i></i><span></span>'; b.querySelector('span').textContent = h.label;
    mk.appendChild(b); markerEls.push({ el: b, at: new THREE.Vector3(...(ANCHORS[keyOf(h)] || [0, 1, 0])) });
  }
  $('goBar').hidden = !COARSE || !go.children.length;
}
// ### Places the 2D markers over their 3D objects.
function updateMarkers(){
  const w = innerWidth, h = innerHeight, busy = !overlay.hidden || cam.t < 1;
  for (const m of markerEls){
    tmp.copy(m.at).project(camera);
    const on = !busy && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    // only touch the page when a marker really moved, so a still view costs no layout work
    const tf = on ? `translate(${((tmp.x + 1) / 2 * w - 14).toFixed(1)}px, ${((1 - tmp.y) / 2 * h - 14).toFixed(1)}px)` : '';
    if (on !== m.on){ m.el.style.display = on ? '' : 'none'; m.on = on; }
    if (on && tf !== m.tf){ m.el.style.transform = tf; m.tf = tf; }
  }
}
// ### Finds the hotspot under the pointer with a ray through the scene.
function pick(e){
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const live = new Set(tunnelWalk ? (tunnelWalk.door < 0 ? ['open:door'] : []) : R.visibleHotspots(S).map(keyOf));
  const meshes = Object.entries(HOT).filter(([k]) => live.has(k)).flatMap(([, ms]) => ms).filter(m => m.visible);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  // a mesh can stand for more than one hotspot (the hatch lid: kneel down at it, then open the lock); the live one counts
  return hit && hit.distance < 6 ? Object.keys(HOT).find(k => live.has(k) && HOT[k].includes(hit.object)) || null : null;
}
let hovered = null, pendingHover = null;   // pointer moves are handled once per frame, not once per event
// ### Highlights the hotspot under the pointer.
function hover(e){
  if (!overlay.hidden) return;
  const k = pick(e);
  if (k === hovered) return;
  if (hovered) (HOT[hovered] || []).forEach(m => { if (m.material.emissive) m.material.emissive.setHex(m.userData.em || 0); });
  hovered = k; canvas.classList.toggle('over', !!k);
  if (k) (HOT[k] || []).forEach(m => { if (m.material.emissive){ m.userData.em = m.material.emissive.getHex(); m.material.emissive.setHex(0x3a2008); } });
}
// ### Handles a click on the scene.
function clickAt(e){
  if (!overlay.hidden || S.scene === 'intro') return;
  const k = pick(e);
  if (!k) return;
  if (tunnelWalk){ use('open', 'door'); return; }
  const h = R.visibleHotspots(S).find(x => keyOf(x) === k);
  if (h) use(h.action, h.target);
}

// ---------- Actions ----------
// ### use() is what a marker, a click or a key calls. "lock" only opens the lock card; everything else goes through
// ### rules.perform(). Accepted: the new state is kept, saved and shown. Refused: the state stays as it was, and the
// ### player sees why.
function use(action, target){
  if (tunnelWalk){ if (action === 'walk') walkToDoor(); else if (action === 'open') openDoor(); return; }
  if (paused || S.ending) return;
  reachHand();
  if (action === 'lock'){ if (S.scene === 'hatch') showLock(); return; }
  act(action, target);
}
// ### Sends an action to Rules, and shows the answer. Refused actions return the state unchanged, with a reason.
function act(action, target, quiet){
  const before = S, r = R.perform(S, action, target);
  if (r.ok && r.cue === 'open' && r.state.ending === 'A') hatchCreak(); else cue(r.cue);
  if (!r.ok){ say(r.message, 'warn'); return r; }
  S = r.state;
  if (action !== 'new') save();
  // walking into another part of the room moves nothing; a button or a marker glides you there
  if (S.scene !== before.scene && !quiet) goView(S.scene === 'tunnel' ? 'hatch' : S.scene);
  const known = seenScenes.has(S.scene); if (action === 'go') seenScenes.add(S.scene);
  if (r.cue === 'game'){ showMini(target, r.message); return r; }
  if ((action === 'read' || action === 'win') && R.CLUES[target]) showClue(target);
  else if (r.message && !S.ending && !(quiet && known)) say(r.message, action === 'try' && !S.ending ? 'warn' : action === 'take' ? 'good' : '');
  if (action === 'try' && !S.ending){ guardShow = 3; renderLock(); }
  if (S.ending === 'A' && before.ending !== 'A'){ hideCard(); endingA(); }
  syncWorld(); renderHud(); renderHotspots();
  return r;
}

// ### syncWorld puts every object where the state says it is: mop in the bucket or jammed
// ### against the door, the tile on the wall or on the floor, the car key in its hollow, the lock wheels, the steam.
function syncWorld(){
  const mp = S.wedged ? MOP_DOOR : S.inventory.includes('mop') ? null : MOP_CORNER;
  mop.visible = !!mp;
  if (mp){ mop.position.copy(mp.p); mop.quaternion.copy(mp.q); fringeCorner.visible = mp === MOP_CORNER; fringeDoor.visible = mp === MOP_DOOR; }
  if (S.tileOpen && tile.userData.fall === undefined) tile.userData.fall = 0;
  if (!S.tileOpen){ tile.position.copy(TILE_POS); tile.rotation.set(0, 0, .07); delete tile.userData.fall; }
  carKey.visible = S.tileOpen && !S.inventory.includes('carkey');
  repaint(steamTex, paintSteam, S.clues.includes('mirror'));
  repaint(scratchesTex, paintScratches, S.clues.includes('scratches'));
  S.lock.forEach((d, i) => { if (wheelTex[i].userData !== d){ drawDigit(wheelTex[i], d); wheelTex[i].userData = d; } });
  if (!S.ending){
    lidPivot.rotation.x = 0; tunnelLight.intensity = tunnelLight2.intensity = nightLight.intensity = 0; tunnelLight.visible = tunnelLight2.visible = nightLight.visible = dust.pts.visible = false;
    TDOOR.pivot.rotation.y = 0; TDOOR.glow.color.setScalar(.25); TDOOR.gap.visible = true; tunnelEnd(false);
    for (const m of TUN.webs) m.userData.torn = 0;
    for (let i = DUST_FREE; i < DUST_N; i++) dust.pos[i * 3 + 1] = -100;
    scene.fog.density = .03; scene.fog.color.copy(FOG_ROOM);
  }
  shadowsMoved();
}

// ---------- HUD and cards ----------
// ### The clock, inventory and journal, and the cards for clues, the lock and the endings. They only show what Rules says.
const overlay = $('overlay'), card = $('card'), hud = $('hud');
const ICON = {
  mop: '<svg viewBox="0 0 40 24" aria-hidden="true"><rect x="2" y="10.5" width="28" height="3" rx="1.5" fill="#c49a64"/><path d="M28 6h10v12H28z" fill="#d8d2bf"/></svg>',
  carkey: '<svg viewBox="0 0 40 24" aria-hidden="true"><rect x="6" y="7" width="12" height="10" rx="3" fill="#7d8489"/><path d="M18 10.5h16l2 1.5-2 1.5h-3l-1 1.5-1-1.5H18z" fill="#d6b25a"/><circle cx="5" cy="12" r="3" fill="none" stroke="#cfd6d9" stroke-width="1.5"/></svg>'
};
// ### Updates the clock, inventory and journal from the current state.
function renderHud(){
  $('place').textContent = (R.SCENES[S.scene] || { title: S.scene === 'cell' ? 'The Cell' : 'Cell Block D' }).title;
  const slots = $('slots'); slots.textContent = '';
  for (let i = 0; i < 3; i++){
    const it = S.inventory[i], d = document.createElement('div');
    d.className = 'slot' + (it ? ' full' : '');
    if (it){ d.innerHTML = ICON[it]; d.append(R.ITEMS[it]); } else d.textContent = 'Empty';
    slots.appendChild(d);
  }
  $('clueCount').textContent = `${S.clues.length} / 3`;
  renderClock();
}
let lastClock = '';
function renderClock(){
  const t = fmt(S.time);
  if (t !== lastClock){ $('time').textContent = t; lastClock = t; }
  $('time').classList.toggle('low', S.time <= 60 && !S.ending);
  $('clockPanel').classList.toggle('grace', S.graceUsed && !S.ending);
}
let sayTimer = 0;
function say(text, kind){
  if (!text) return;
  const el = $('say'); el.textContent = text; el.className = 'say show' + (kind ? ' ' + kind : '');
  sayTimer = Math.min(9, 3 + text.length / 22);
}
function showCard(html, cls){
  stopMini();
  card.className = 'card' + (cls ? ' ' + cls : ''); card.innerHTML = html; overlay.hidden = false;
  const b = card.querySelector('.btn'); if (b && !COARSE) b.focus({ preventScroll: true });
}
// ### Closes a clue or lock card.
function hideCard(){ stopMini(); overlay.hidden = true; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ### The briefing: five short cards so a first-time player knows what happened, who they are, where, why and how to play.
// ### The first card is the front page of an old newspaper (.news in styles.css): the theft at the Museu de Marinha in Lisbon.
// ### It has no eyebrow or title of its own: the newspaper headline is the card's h1.
// ### The third is not a card but a short scene in the room (see "Briefing scene" below): Hale shuts and locks the door.
const BRIEF = [
  [null, null, '<div class="news-wrap"><article class="news" aria-label="Front page of The Lisbon Times"><div class="mast-top"><span>Front page</span><span>Magazine</span></div><div class="mast">The Lisbon Times</div><div class="dateline"><span>Vol. CXXI · No. 107</span><span>Lisbon, Monday 16 April 2012</span><span>€1.20</span></div><h1>Titanic necklace vanishes from naval museum</h1><div class="deck">The Starfall necklace disappears on the night of the centenary. No alarm sounded.</div><div class="cols"><div class="by">By our crime correspondent</div><p>BELÉM — The Starfall necklace, lent by the Ashford family to the Museu de Marinha for a limited exhibition marking 100 years since the sinking of the Titanic, disappeared from its glass case on the night of the centenary.</p><figure><div class="photo"><div class="ht"><svg class="necklace" viewBox="0 0 160 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="nl-spot" cx=".5" cy=".3" r=".62"><stop offset="0" stop-color="#d8d8d8"/><stop offset=".45" stop-color="#6e6e6e"/><stop offset="1" stop-color="#141414"/></radialGradient><linearGradient id="nl-bust" x1="0" x2="1"><stop offset="0" stop-color="#1c1c1c"/><stop offset=".42" stop-color="#3e3e3e"/><stop offset=".6" stop-color="#323232"/><stop offset="1" stop-color="#161616"/></linearGradient><radialGradient id="nl-pearl" cx=".35" cy=".32" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#e6e6e6"/><stop offset=".8" stop-color="#8a8a8a"/><stop offset="1" stop-color="#3a3a3a"/></radialGradient><linearGradient id="nl-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8b8b8"/><stop offset=".12" stop-color="#5a5a5a"/><stop offset="1" stop-color="#1a1a1a"/></linearGradient><linearGradient id="nl-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".45" stop-color="#fff" stop-opacity=".0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset=".56" stop-color="#fff" stop-opacity=".0"/><stop offset=".7" stop-color="#fff" stop-opacity=".0"/><stop offset=".73" stop-color="#fff" stop-opacity=".14"/><stop offset=".76" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="160" height="72" fill="url(#nl-spot)"/><path d="M62 0H98V9Q98 24 124 34L132 60H28L36 34Q62 24 62 9Z" fill="url(#nl-bust)"/><path d="M28 58H132L140 72H20Z" fill="url(#nl-base)"/><rect x="72" y="62" width="16" height="5" fill="#cfcfcf"/><path d="M73.5 64h13M73.5 65.6h9" stroke="#555" stroke-width=".5"/><g fill="#000" opacity=".45"><ellipse cx="104.9" cy="15.4" rx="2" ry="1.3"/><ellipse cx="103.8" cy="19.5" rx="2" ry="1.3"/><ellipse cx="102.1" cy="23.3" rx="2" ry="1.3"/><ellipse cx="100.0" cy="26.9" rx="2" ry="1.3"/><ellipse cx="97.4" cy="30.0" rx="2" ry="1.3"/><ellipse cx="94.5" cy="32.7" rx="2" ry="1.3"/><ellipse cx="91.4" cy="34.8" rx="2" ry="1.3"/><ellipse cx="88.0" cy="36.3" rx="2" ry="1.3"/><ellipse cx="84.4" cy="37.3" rx="2" ry="1.3"/><ellipse cx="80.8" cy="37.6" rx="2" ry="1.3"/><ellipse cx="77.2" cy="37.3" rx="2" ry="1.3"/><ellipse cx="73.6" cy="36.3" rx="2" ry="1.3"/><ellipse cx="70.2" cy="34.8" rx="2" ry="1.3"/><ellipse cx="67.1" cy="32.7" rx="2" ry="1.3"/><ellipse cx="64.2" cy="30.0" rx="2" ry="1.3"/><ellipse cx="61.6" cy="26.9" rx="2" ry="1.3"/><ellipse cx="59.5" cy="23.3" rx="2" ry="1.3"/><ellipse cx="57.8" cy="19.5" rx="2" ry="1.3"/><ellipse cx="56.7" cy="15.4" rx="2" ry="1.3"/></g><g fill="url(#nl-pearl)"><circle cx="104.1" cy="13.8" r="2.1"/><circle cx="103.0" cy="17.9" r="2.1"/><circle cx="101.3" cy="21.7" r="2.1"/><circle cx="99.2" cy="25.3" r="2.1"/><circle cx="96.6" cy="28.4" r="2.1"/><circle cx="93.7" cy="31.1" r="2.1"/><circle cx="90.6" cy="33.2" r="2.1"/><circle cx="87.2" cy="34.7" r="2.1"/><circle cx="83.6" cy="35.7" r="2.1"/><circle cx="80.0" cy="36.0" r="2.1"/><circle cx="76.4" cy="35.7" r="2.1"/><circle cx="72.8" cy="34.7" r="2.1"/><circle cx="69.4" cy="33.2" r="2.1"/><circle cx="66.3" cy="31.1" r="2.1"/><circle cx="63.4" cy="28.4" r="2.1"/><circle cx="60.8" cy="25.3" r="2.1"/><circle cx="58.7" cy="21.7" r="2.1"/><circle cx="57.0" cy="17.9" r="2.1"/><circle cx="55.9" cy="13.8" r="2.1"/></g><path d="M80 36.5V41" stroke="#bbb" stroke-width=".8"/><polygon points="80,40.5 82.3,46.2 88.4,46.6 83.7,50.5 85.2,56.4 80,53.1 74.8,56.4 76.3,50.5 71.6,46.6 77.7,46.2" fill="url(#nl-pearl)" stroke="#111" stroke-width=".5"/><g stroke="#fff" stroke-linecap="round"><path d="M80 43.5v6M77 46.5h6" stroke-width=".7"/><path d="M93 15v5M90.5 17.5h5M61 27v3M59.5 28.5h3" stroke-width=".45" opacity=".8"/></g><path d="M22 2H138V72M22 2V72" fill="none" stroke="#9a9a9a" stroke-width=".5" opacity=".35"/><rect width="160" height="72" fill="url(#nl-glass)"/></svg></div><b></b></div><figcaption>The Starfall necklace on display at the Museu de Marinha, before the theft.</figcaption></figure><p>No alarm sounded. The museum has closed the exhibition.</p><p>A detective has been put on the case.</p></div></article></div>'],
  ['Cell Block D · 02:14', 'Plot <em>Twist</em>', 'Three weeks ago you were that detective. You followed the trail from the empty case at the Museu de Marinha, and it ended at your own door: the necklace’s velvet box, hidden in your car. Tonight you are <b>inmate 4471</b>, convicted of stealing it. Someone framed you.</p><p>Not everyone believed it. <b>Your oldest friend on the force</b> stood by you through the trial and kept digging until he found the proof that clears your name. But the people who framed you found out and came after him. Before he disappeared from Lisbon, he <b>hid the evidence across the city</b>, in places only you would know to look.'],
  ['The washroom · 02:16', 'Ten <em>minutes</em>', 'cine'],
  ['The rumour', 'A way <em>down</em>', 'Inmates whisper about a <b>hatch in the floor</b> of this washroom, locked with a four-digit code. Three spots in the room hide what you need: <b>a car key</b>, the <b>first two digits</b> and the <b>last two digits</b> of the code. Each one is guarded by a short Titanic mini game. Win them, open the hatch, get out before Hale comes back.'],
  ['How to play', 'Your <em>moves</em>', null]
];
let briefStep = 0;
// ### Shows the opening briefing.
function showBrief(i){
  briefStep = i;
  const [eye, title, text] = BRIEF[i], last = i === BRIEF.length - 1;
  if (text === 'cine'){
    showCard(`<div class="steps">${BRIEF.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="eyebrow">${eye}</div><p class="cine-line" id="cineLine" aria-live="polite"></p>
      <div class="actions"><button class="btn" data-do="next">Next <small>Enter</small></button><button class="btn ghost" data-do="back">Back</button>
      <div class="cine-clock" id="cineClock" aria-hidden="true">10:00</div></div>`, 'cine');
    startCine();
    return;
  }
  stopCine();
  // ### How to play: you walk with the arrow keys; a touch screen has none, so it gets the "Walk to" buttons instead.
  const moving = COARSE ? `
      <b>Walk to</b><span>Buttons at the bottom take you to another part of the room</span>
      <b>Drag</b><span>Look around with your finger</span>
      <b>Markers</b><span>Tap a pulsing marker or the object itself to use it</span>` : `
      <b>↑ ↓</b><span>Arrow keys up and down: walk forwards and backwards</span>
      <b>← →</b><span>Arrow keys left and right: step to the side (W A S D work too)</span>
      <b>Drag</b><span>Hold the mouse button and move the mouse to turn your head and look around</span>
      <b>Walk in</b><span>Walk to the sinks or into the toilet stall: what you can use there gets a pulsing marker</span>
      <b>Markers</b><span>Click a pulsing marker or the object itself to use it</span>`;
  const body = text ? (text.startsWith('<div') ? text : `<p>${text}</p>`) : `<div class="howto">${moving}
      <b>Mini games</b><span>The crooked tile, the mirror and the scratches each open a mini game of ${MiniGames.TIME} s. Win it to get the clue</span>
      <b>Items</b><span>What you pick up appears bottom left and is used automatically</span>
      <b>Clues</b><span>Everything you read is kept in your clue notes</span>
      <b>P / Esc</b><span>Pause. The clock keeps running while you read and try the lock</span>
    </div><p>Wrong codes make noise. Each one costs <b>${R.WRONG_CODE_PENALTY} seconds</b>.</p>`;
  showCard(`<div class="steps">${BRIEF.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
    ${eye ? `<div class="eyebrow">${eye}</div><h1>${title}</h1>` : ''}${body}
    <div class="actions">${last ? '<button class="btn" data-do="start">Start the clock <small>Enter</small></button>' : '<button class="btn" data-do="next">Next <small>Enter</small></button>'}
    ${i > 0 ? '<button class="btn ghost" data-do="back">Back</button>' : ''}</div>`);
}
function showContinue(){
  showCard(`<div class="eyebrow">Saved game</div><h2>Back in the <em>washroom</em></h2>
    <p>You still have <b>${fmt(S.time)}</b>. Items: <b>${S.inventory.length ? S.inventory.map(i => R.ITEMS[i]).join(', ') : 'none'}</b>. Clues: <b>${S.clues.length} of 3</b>.</p>
    <div class="actions"><button class="btn" data-do="resume">Continue <small>Enter</small></button><button class="btn ghost" data-do="ask-new">New game</button></div>`);
}
function showAskNew(){
  showCard(`<div class="eyebrow">New game</div><h2>Start <em>over?</em></h2><p>Your saved progress will be lost.</p>
    <div class="actions"><button class="btn danger" data-do="new">Yes, start over</button><button class="btn ghost" data-do="${S.scene === 'intro' ? 'brief' : paused ? 'pause' : 'resume'}">Back</button></div>`);
}
function showPause(){
  paused = true;
  showCard(`<div class="eyebrow">${esc(R.SCENES[S.scene] ? R.SCENES[S.scene].title : '')} · ${fmt(S.time)} left</div><h2>Paused</h2>
    <p>Items: <b>${S.inventory.length ? S.inventory.map(i => R.ITEMS[i]).join(', ') : 'none'}</b> · Clues: <b>${S.clues.length} of 3</b> · Wrong codes: <b>${S.wrongTries}</b></p>
    <div class="actions"><button class="btn" data-do="resume">Resume <small>Enter</small></button><button class="btn ghost" data-do="ask-new">Restart</button></div>
    <label class="vol">Volume <input type="range" min="0" max="100" step="5" data-vol value="${Math.round(volume * 100)}" aria-label="Volume"><output>${Math.round(volume * 100)}%</output></label>
    ${apiVent && apiVent.live ? `<p class="vent-credit">Air vent: “${esc(apiVent.info.title)}” by ${esc(apiVent.info.creator)} (Freesound, CC0), found through the Openverse API</p>` : ''}`);
}
function showClue(k){
  const c = R.CLUES[k];
  showCard(`<div class="eyebrow">Clue found · ${S.clues.length} of 3</div><div class="paper"><small>${esc(c.title)}</small>${esc(c.text)}</div>
    <div class="actions"><button class="btn" data-do="close">Got it <small>Enter</small></button></div>`);
}
function showNotes(){
  const list = S.clues.map(k => `<div class="paper"><small>${esc(R.CLUES[k].title)}</small>${esc(R.CLUES[k].text)}</div>`).join('');
  showCard(`<div class="eyebrow">Your clue notes</div><h2>${S.clues.length} of 3 <em>clues</em></h2>
    <div class="clue-list">${list || '<div class="empty">Nothing yet. Try the crooked tile, the mirror (once it is steamed up) and the scratches by the door.</div>'}</div>
    <div class="actions"><button class="btn" data-do="close">Back to the room <small>Enter</small></button></div>`);
}
function showLock(){
  showCard(`<div class="eyebrow">The hatch · combination lock</div><h2>Four <em>wheels</em></h2>
    <div class="lock" id="lockUi"></div><div class="tries" id="tries"></div>
    <div class="actions"><button class="btn" data-do="try">Try the code <small>Enter</small></button><button class="btn ghost" data-do="close">Step back</button></div>`);
  renderLock();
}
function renderLock(){
  const ui = card.querySelector('#lockUi');
  if (!ui) return;
  // redrawing removes the wheel button in use: a keyboard player stays on it, or the next Enter would try the code and cost 30 s
  const a = document.activeElement, turn = a && a.dataset && a.dataset.turn && a.matches(':focus-visible') ? a.dataset.turn : null;
  ui.innerHTML = S.lock.map((d, i) => `<div class="wheel"><button data-turn="${i},1" aria-label="Wheel ${i + 1} up">▲</button><output aria-label="Wheel ${i + 1}">${d}</output><button data-turn="${i},-1" aria-label="Wheel ${i + 1} down">▼</button></div>`).join('');
  if (turn) ui.querySelector(`[data-turn="${turn}"]`).focus();
  card.querySelector('#tries').textContent = S.wrongTries ? `Wrong codes so far: ${S.wrongTries} · each costs ${R.WRONG_CODE_PENALTY} s` : 'Each wrong code costs ' + R.WRONG_CODE_PENALTY + ' s';
}
// ---------- Mini games ----------
// ### A clue spot that is used ("play" accepted by Rules, cue "game") opens its mini game from minigames.js in the card. A
// ### win is sent to Rules as "win", which gives the clue; a loss offers the same game again. Closing the card, pausing or
// ### an ending stops the game without a result. The clock keeps running while you play.
// ### The first time a mini game comes up, a card explains it before it starts, the way the briefing explains the room:
// ### the goal, how it works, the controls (mouse and keys, or touch), the 30 seconds and the prize. The game and its
// ### 30 seconds start only with "Start the game"; Hale's clock keeps running while you read. From then on that game
// ### starts at once (trying again, or coming back after giving up). Closing the card unread shows it again next time,
// ### and a new game shows every card again.
let mini = null, miniSpot = null, miniRules = null;
const rulesSeen = new Set();
const SPOT_NAME = { tile: 'The crooked tile', mirror: 'Writing on the mirror', scratches: 'Scratches by the door' };
const SPOT_PRIZE = { tile: 'the car key', mirror: 'the first two digits of the code', scratches: 'the last two digits of the code' };
function showMini(spot, id){
  const info = MiniGames.INFO[id];
  if (!info) return;
  if (!rulesSeen.has(id)){ showMiniRules(spot, id); return; }
  showCard(`<div class="eyebrow">${SPOT_NAME[spot]} · mini game · ${MiniGames.TIME} seconds</div><h2>${info.title}</h2>
    <p>${esc(info.how)} Win to get <b>${SPOT_PRIZE[spot]}</b>.</p><div id="miniHost"></div>
    <div class="actions"><button class="mg-quit" data-do="close">Give up <small>Esc</small></button></div>`, 'mini');
  miniSpot = spot;
  mini = MiniGames.open(card.querySelector('#miniHost'), id, {
    sound: miniSound,
    audio: ac ? { ctx: ac, out: master, music: bandBuf } : null,
    onEnd: (won, reason) => { mini = null; if (S.ending) return; if (won) act('win', spot); else showMiniLost(spot, id, reason); }
  });
}
// ### The card that explains a mini game before its first play.
function showMiniRules(spot, id){
  const info = MiniGames.INFO[id];
  miniSpot = spot; miniRules = id;
  showCard(`<div class="eyebrow">${SPOT_NAME[spot]} · mini game · how to play</div><h2>${info.title}</h2>
    <div class="howto mg-rules">
      <b>Goal</b><span>${esc(info.goal)}</span>
      <b>How</b><ol>${info.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <b>Controls</b><span>${esc(COARSE ? info.touch : info.keys)}</span>
      <b>Time</b><span>${MiniGames.TIME} seconds, counted from the moment you start. Hale’s clock keeps running while you read.</span>
      <b>Prize</b><span>Win to get ${esc(SPOT_PRIZE[spot])}. Lose, and you can try again at once.</span>
    </div>
    <div class="actions"><button class="btn" data-do="mini-start">Start the game <small>Enter</small></button><button class="btn ghost" data-do="close">Back to the room <small>Esc</small></button></div>`, 'mini-rules');
}
function showMiniLost(spot, id, reason){
  showCard(`<div class="eyebrow">${SPOT_NAME[spot]} · ${esc(MiniGames.INFO[id].name)}</div><h2>Not <em>this time</em></h2>
    <p>${esc(reason || 'You lost the mini game.')} Try again: it is the same game, and the clock is still running.</p>
    <div class="actions"><button class="btn" data-do="replay">Try again <small>Enter</small></button><button class="btn ghost" data-do="close">Back to the room</button></div>`);
}
function stopMini(){ if (mini){ mini.stop(); mini = null; } }
// ### The short sounds of the mini games, made from the same tones and noise as the room's.
function miniSound(n){
  if (!ac) return;
  switch (n){
    case 'hit': noise(.25, .35, 'lowpass', 500); tone(110, .25, 'sine', .2, 60); break;
    case 'splash': noise(.18, .12, 'highpass', 1800); break;
    case 'good': tone(660, .1, 'triangle', .1); tone(990, .14, 'triangle', .08, null, .07); break;
    case 'bad': tone(140, .2, 'square', .05, 90); break;
    case 'jump': tone(420, .1, 'sine', .06, 760); break;
    case 'tick': cue('tick'); break;
    case 'pop': tone(760, .07, 'square', .045, 480); break;
    case 'flip': noise(.04, .09, 'lowpass', 900); break;
    case 'bell': tone(1320, .45, 'sine', .07); tone(1980, .3, 'sine', .03); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, .18, 'triangle', .09, null, i * .09)); break;
    case 'lose': tone(300, .5, 'sawtooth', .05, 90); break;
  }
}

// ### Ends the game. Ending A has no card: it is the way into room 2. The escape time is handed over (Rules.handover, kept in
// ### the browser's storage), the headlights of the car behind the door fill the screen (#leave) and the chase opens by
// ### itself, in the same glare, so the door of the tunnel opens straight into the garage. Played on the heist page (in its
// ### frame, opened with ?heist=frame), room 1 only tells that page that it has been left: room 2 is already loaded there
// ### and is shown at once. On its own, room 1 opens room 2's page. Should the browser not follow, a link appears in the
// ### glare after a few seconds. Ending B shows its card.
const CHASE_URL = '../room-2-chase/?heist=1#arrive';
const FRAMED = window.parent !== window && /[?&]heist=frame(&|$)/.test(location.search);
// back from room 2 with the browser's Back button: a browser that kept this page as it was left (in the glare) loads it afresh
addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
function showEnding(){
  const A = S.ending === 'A', E = R.ENDINGS[S.ending];
  if (A){
    writeStore(R.HEIST_KEY, R.handover(S, Date.now()));
    const g = $('leave');
    $('leaveLink').href = CHASE_URL;
    g.hidden = false; void g.offsetWidth; g.classList.add('on');
    setTimeout(() => { if (FRAMED) parent.postMessage({ shardHeist: 'leave' }, location.origin); else location.assign(CHASE_URL); }, REDUCED ? 50 : 1100);
    return;
  }
  showCard(`<div class="eyebrow">${A ? 'Ending A of 2' : 'Ending B of 2'}</div>
    <h1>${A ? 'Out <em>below</em>' : 'Back to <em>the cell</em>'}</h1><p>${esc(E.text)}</p>
    <p>Time left: <b>${fmt(S.time)}</b> · Clues: <b>${S.clues.length} of 3</b> · Wrong codes: <b>${S.wrongTries}</b>${S.wedged ? ' · You jammed the door' : ''}</p>
    ${A ? '<div class="next">Room 2 · The chase starts at the end of this tunnel</div>' : '<p>Tip: the jammed door buys you a minute, and the hot tap steams up the mirror so you can play for its digits.</p>'}
    <div class="actions"><button class="btn" data-do="new">${A ? 'Play again' : 'Try again'} <small>Enter</small></button></div>`, A ? 'ending-a' : 'ending-b');
}
// the volume slider on the pause card; a short tick when it is let go
card.addEventListener('input', e => {
  const r = e.target.closest('[data-vol]');
  if (!r) return;
  volume = Math.min(1, Math.max(0, Number(r.value) / 100));
  writeStore(R.VOLUME_KEY, String(volume));
  r.parentNode.querySelector('output').textContent = r.value + '%';
  if (master) master.gain.value = loud();
});
card.addEventListener('change', e => { if (e.target.closest('[data-vol]')) cue('take'); });
card.addEventListener('click', e => {
  const t = e.target.closest('[data-turn]');
  if (t){ const [i, d] = t.dataset.turn.split(',').map(Number); act('turn', [i, d]); renderLock(); return; }
  const b = e.target.closest('[data-do]');
  if (!b) return;
  initAudio();
  const d = b.dataset.do;
  if (d === 'next') showBrief(Math.min(BRIEF.length - 1, briefStep + 1));
  else if (d === 'back') showBrief(Math.max(0, briefStep - 1));
  else if (d === 'brief') showBrief(0);
  else if (d === 'start'){ const r = act('start', MiniGames.pickGames(Math.random)); if (r.ok){ hideCard(); hud.classList.remove('off'); } }
  else if (d === 'resume') resumeRoom();
  else if (d === 'pause') showPause();
  else if (d === 'ask-new') showAskNew();
  else if (d === 'new'){ paused = false; seenScenes.clear(); rulesSeen.clear(); held.clear(); hatchAnim = -1; climb = null; tunnelWalk = null; tileVel = 0; endingShown = false; act('new'); writeStore(R.SAVE_KEY, ''); hud.classList.add('off'); goView('intro', .8); doorFlash = 0; windowLight.intensity = .9; showBrief(0); }
  else if (d === 'close') hideCard();
  else if (d === 'replay' && miniSpot) use('play', miniSpot);
  else if (d === 'mini-start' && miniSpot && miniRules){ rulesSeen.add(miniRules); use('play', miniSpot); }   // asks Rules again: the spot may have changed while you read
  else if (d === 'try') act('try');
});
$('btnPause').addEventListener('click', e => { e.currentTarget.blur(); if (S.ending || S.scene === 'intro') return; if (paused) resumeRoom(); else showPause(); });
$('btnNotes').addEventListener('click', e => { e.currentTarget.blur(); if (!paused && !S.ending && S.scene !== 'intro') showNotes(); });
let muted = false;
// ### Back to the room from the pause or continue card: the clock runs again, the HUD shows, and so does the sound.
function resumeRoom(){ paused = false; hideCard(); hud.classList.remove('off'); if (ac && !muted && !document.hidden) ac.resume(); }
$('btnSound').addEventListener('click', e => { e.currentTarget.blur(); toggleSound(); });
// ### Turns the sound on or off.
function toggleSound(){ muted = !muted; $('soundWaves').style.display = muted ? 'none' : ''; $('btnSound').setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound'); if (master) master.gain.value = loud(); }
// ### The player's volume: the slider squared, because the ear hears loudness roughly that way.
let volume = R.parseVolume(readStore(R.VOLUME_KEY));
const loud = () => muted ? 0 : .8 * volume * volume;
addEventListener('keydown', e => {
  if (!$('fatal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  // a held Enter must not repeat an action: each wrong code costs 30 seconds
  if (e.code === 'Enter' && e.repeat){ e.preventDefault(); return; }
  if (e.code === 'Enter' && !overlay.hidden){ const b = card.querySelector('.btn'); if (b && document.activeElement && document.activeElement.closest && document.activeElement.closest('.card') && document.activeElement.tagName === 'BUTTON') return; if (b){ e.preventDefault(); b.click(); } return; }
  if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat){
    if (S.ending || S.scene === 'intro') return;
    if (paused) resumeRoom(); else if (!overlay.hidden && e.code === 'Escape') hideCard(); else showPause();
    return;
  }
  if (e.code === 'KeyM') toggleSound();
  if (!overlay.hidden) return;
  // walking: held keys are remembered here and turned into steps in walk(); the page itself never scrolls
  if (MOVE_KEYS[e.code]){ e.preventDefault(); if (!e.repeat && !paused) held.add(e.code); }
});
addEventListener('keyup', e => held.delete(e.code));
// The clock must not run while nobody is looking
document.addEventListener('visibilitychange', () => {
  if (document.hidden){ held.clear(); if (S.scene !== 'intro' && !S.ending && !paused) showPause(); }
  if (ac){ if (document.hidden) ac.suspend(); else if (!muted) ac.resume(); }
});
addEventListener('blur', () => { held.clear(); if (S.scene !== 'intro' && !S.ending && !paused) showPause(); });
addEventListener('pagehide', () => { if (ac) ac.suspend(); save(); });
addEventListener('shardheist:fatal', () => { if (S.scene !== 'intro' && !S.ending && !paused) showPause(); if (ac) ac.suspend(); $('fatalReload').focus(); });

// ---------- Sound ----------
// ### Web Audio: two real recordings (CC0, in room-1-escape/sounds with their credits) for the hot tap and the air vent,
// ### and synthesised sounds for the rest: the hum of the fluorescent tube, dripping water and short effects for every
// ### kind of action. Starts on the first click, as browsers require. If a recording cannot be loaded (for example when
// ### the page is opened as a file), the tap falls back to synthesised hiss and the vent stays silent. The vent then
// ### asks the Openverse sound API for a ventilation recording and crossfades to it (see "The air vent from the API").
let ac = null, master = null, waterGain = null, noiseBuf = null, dripIn = 3;
// ### Where the loops lie in the recordings (seconds): the tap's steady stream, then its end (water stops, handle shut);
// ### the vent's seamless loop. Measured when the files were made; see sounds/CREDITS.md.
const TAP = { file: 'sounds/tap-water.mp3', loopStart: 1.08, loopEnd: 8.28, vol: .45 };
const VENT = { file: 'sounds/air-vent.mp3', loopStart: .25, loopEnd: 9.25, vol: .12 };
// ### The climb down the ladder: one file of short CC0 recordings (see sounds/CREDITS.md), each [start, length] in seconds:
// ### two creaks of old wood, two knocks of a boot on a rung, a hand gripping, clothes rustling, a boot on stone. Only the
// ### creaks are played now: the ladder under your weight and, slowed down, the hatch's hinges.
const LADDER = { file: 'sounds/ladder.mp3', creak1: [.35, .478], creak2: [1.178, .386], rung1: [1.914, .248], rung2: [2.512, .281],
  grab: [3.143, .3], cloth: [3.793, .95], floor: [5.093, .58] };
let ladderBuf = null, ladderBus = null;
// ### The music of the conducting mini game: the band's recording (Bach, CC0, see sounds/CREDITS.md), loaded with the rest;
// ### the beats in it are listed in MiniGames.COND. Until it has arrived the game plays a plain beat of its own.
const BAND_FILE = 'sounds/orchestra.mp3';
let bandBuf = null;
// ### Plays one of the ladder's recordings, with the echo of the brick shaft; false while the file has not arrived.
function ladderSound(name, vol, rate, delay){
  if (!ac || !ladderBuf) return false;
  if (!ladderBus){
    // the shaft and the vault: a second and a half of reverberation, made from noise that dies away
    const n = Math.floor(ac.sampleRate * 1.5), ir = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++){ const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * .5; }
    const verb = ac.createConvolver(), wet = ac.createGain();
    verb.buffer = ir; wet.gain.value = .45;
    ladderBus = ac.createGain(); ladderBus.connect(master); ladderBus.connect(verb); verb.connect(wet); wet.connect(master);
  }
  const [at, len] = LADDER[name], src = ac.createBufferSource(), g = ac.createGain(), t = ac.currentTime + (delay || 0);
  src.buffer = ladderBuf; src.playbackRate.value = rate || 1; g.gain.value = vol;
  src.connect(g); g.connect(ladderBus); src.start(t, Math.max(0, at - .02), len + .06);
  return true;
}
let tapBuf = null, tapBus = null, tapSrc = null, tapOn = false;
// ### Creates the audio on the first click, as browsers require.
function initAudio(){
  if (ac){ if (ac.state === 'suspended' && !document.hidden) ac.resume(); return; }
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e){ ac = null; return; }
  master = ac.createGain(); master.gain.value = loud(); master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const hum = ac.createOscillator(), hum2 = ac.createOscillator(), hf = ac.createBiquadFilter(), hg = ac.createGain();
  hum.type = 'sawtooth'; hum.frequency.value = 100; hum2.type = 'sine'; hum2.frequency.value = 50;
  hf.type = 'lowpass'; hf.frequency.value = 320; hg.gain.value = .022;
  hum.connect(hf); hum2.connect(hf); hf.connect(hg); hg.connect(master); hum.start(); hum2.start();
  const water = ac.createBufferSource(); water.buffer = noiseBuf; water.loop = true;
  const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1400; wf.Q.value = .6;
  waterGain = ac.createGain(); waterGain.gain.value = 0;
  water.connect(wf); wf.connect(waterGain); waterGain.connect(master); water.start();
  tapBus = ac.createGain(); tapBus.gain.value = 0; tapBus.connect(master);
  loadSound(TAP.file, b => { tapBuf = b; });
  loadSound(VENT.file, startVent);
  loadSound(LADDER.file, b => { ladderBuf = b; });
  loadSound(BAND_FILE, b => { bandBuf = b; });
  findApiVent();
  stepBus = ac.createGain(); stepBus.connect(master);
  const echo = ac.createConvolver(), echoGain = ac.createGain(); echo.buffer = washroomEcho(); echoGain.gain.value = STEP_VOL.echo;
  stepBus.connect(echo); echo.connect(echoGain); echoGain.connect(master);
  for (const k in STEP_FILES) for (let i = 1; i <= STEP_FILES[k]; i++) loadSound('sounds/steps/' + k + '-' + i + '.mp3', b => stepBufs[k].push(b));
}
// ### Fetches and decodes one recording, then hands it on; a failure leaves the synthesised sound in its place.
function loadSound(file, then){
  fetch(file).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(file)))
    .then(data => new Promise((ok, fail) => ac.decodeAudioData(data, ok, fail)))
    .then(then, () => {});
}
// ### The air vent: its recording loops for the rest of the game, faded in over two seconds (unless the API's is playing).
let ventGain = null;
function startVent(buf){
  const s = ac.createBufferSource(), g = ac.createGain(), t = ac.currentTime;
  s.buffer = buf; s.loop = true; s.loopStart = VENT.loopStart; s.loopEnd = VENT.loopEnd;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(apiVent && apiVent.live ? 0 : VENT.vol, t + 2);
  s.connect(g); g.connect(master); s.start(t, VENT.loopStart); ventGain = g;
}
// ### Fades the room's own vent recording in or out, when the API's vent takes over or fails.
function fadeVent(on){
  if (!ventGain) return;
  const t = ac.currentTime; ventGain.gain.cancelScheduledValues(t); ventGain.gain.setValueAtTime(ventGain.gain.value, t);
  ventGain.gain.linearRampToValueAtTime(on ? VENT.vol : 0, t + 2);
}

// ---------- The air vent from the API ----------
// ### One search of the Openverse API (no key; rules.js picks the recording and checks it) finds a CC0 ventilation recording
// ### on Freesound; the choice is kept for 30 days, so a player asks only once. Freesound's server does not let a page read
// ### the samples, so the recording plays in two <audio> elements outside Web Audio: they take turns, each fading in over the
// ### last two seconds of the other, so it loops without a gap. Their volume follows the slider and mute here, and they stop
// ### whenever the room's sound stops. On any failure, or where a page cannot set an <audio> volume (iPhone and iPad), the
// ### room's own recording stays.
const API_VENT = { vol: .15, fade: 2 };
let apiVent = null;
function findApiVent(){
  const probe = new Audio(); probe.volume = .5;
  if (probe.volume !== .5) return;
  const kept = R.parseVent(readStore(R.VENT_KEY), Date.now());
  if (kept) return playApiVent(kept);
  fetch(R.VENT_SEARCH, { credentials: 'omit' }).then(r => r.ok ? r.json() : Promise.reject(new Error('Openverse ' + r.status)))
    .then(body => { const v = R.pickVent(body); if (!v) return; writeStore(R.VENT_KEY, JSON.stringify(Object.assign({ at: Date.now() }, v))); playApiVent(v); })
    .catch(() => {});
}
function playApiVent(v){
  const els = [0, 1].map(() => { const a = new Audio(); a.preload = 'auto'; a.volume = 0; a.src = v.url; return a; });
  const me = apiVent = { info: v, els, cur: 0, want: [true, false], live: false };
  const fail = () => { if (apiVent !== me) return; els.forEach(a => { a.pause(); a.removeAttribute('src'); }); apiVent = null; if (me.live) fadeVent(true); };
  els.forEach((a, i) => { a.addEventListener('error', fail); a.addEventListener('ended', () => { me.want[i] = false; }); });
  els[0].addEventListener('playing', () => { if (apiVent === me && !me.live){ me.live = true; fadeVent(false); } }, { once: true });
  if (ac.state === 'running') els[0].play().catch(fail);
}
// ### Each frame: the playing copy hands over to the other near its end; every copy's volume is the slider's, faded over
// ### its first and last two seconds; both pause while the room's sound is stopped (hidden tab, error screen).
function updateApiVent(){
  const v = apiVent; if (!v) return;
  const on = ac.state === 'running';
  v.els.forEach((a, i) => {
    if (!on || !v.want[i]){ if (!a.paused) a.pause(); return; }
    if (a.paused) a.play().catch(() => {});
    const d = a.duration, t = a.currentTime;
    a.volume = d > 0 ? Math.max(0, Math.min(1, API_VENT.vol * loud() * Math.min(1, t / API_VENT.fade, (d - t) / API_VENT.fade))) : 0;
  });
  const a = v.els[v.cur], d = a.duration;
  if (on && d > 2 * API_VENT.fade && a.currentTime > d - API_VENT.fade && !v.want[1 - v.cur]){
    v.cur = 1 - v.cur; v.want[v.cur] = true; v.els[v.cur].currentTime = 0;
  }
}
// ### The hot tap follows the rules' steam: turned on, the recording plays the handle and the water starting, then loops
// ### the steady stream; turned off, the stream fades into the recording's end. Pausing only fades the tap out.
function updateTap(dt){
  if (!tapBuf) return;
  tapBus.gain.value += ((paused ? 0 : TAP.vol) - tapBus.gain.value) * Math.min(1, dt * 4);
  if (S.steam === tapOn) return;
  tapOn = S.steam;
  const t = ac.currentTime, old = tapSrc;
  if (old){ old.g.gain.setValueAtTime(1, t); old.g.gain.linearRampToValueAtTime(0, t + .12); old.s.stop(t + .15); }
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = tapBuf; s.connect(g); g.connect(tapBus);
  if (tapOn){ s.loop = true; s.loopStart = TAP.loopStart; s.loopEnd = TAP.loopEnd; s.start(t); }
  else { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + .12); s.start(t, TAP.loopEnd); }
  tapSrc = tapOn ? { s, g } : null;
}
// ---------- Footsteps ----------
// ### Real recordings (CC0, in sounds/steps with their credits): four steps of hard shoes on concrete (the heel strikes,
// ### the sole slaps down after it), three wet steps for the puddles and five boots on wood for the ladder. Each footfall takes another recording than the last,
// ### a little higher or lower and louder or softer, the left foot a touch to the left and the right foot to the right, and
// ### the bare concrete and tiles answer with an echo: a reverb made here from noise that dies away in about 0.8 s and
// ### stays bright (concrete swallows little of the highs), after a few early reflections off the walls. Until the recordings have loaded, the old synthesised thud stands in.
const STEP_FILES = { floor: 4, wet: 3, rung: 5 }, STEP_VOL = { floor: .4, wet: .35, rung: .35, echo: .38 };
const stepBufs = { floor: [], wet: [], rung: [] }, stepLast = {};
let stepBus = null, stepFoot = 1;
// ### Plays one footstep of a kind; false when its recordings are not there (yet). rate lowers or raises it on purpose.
function footstep(kind, vol, rate = 1){
  const list = stepBufs[kind];
  if (!ac || !stepBus || !list.length) return false;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === stepLast[kind]) i = (i + 1) % list.length;
  stepLast[kind] = i; stepFoot = -stepFoot;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = list[i]; s.playbackRate.value = rate * (.93 + Math.random() * .14); g.gain.value = vol * (.8 + Math.random() * .3);
  s.connect(g);
  if (ac.createStereoPanner){ const p = ac.createStereoPanner(); p.pan.value = .14 * stepFoot; g.connect(p); p.connect(stepBus); } else g.connect(stepBus);
  s.start();
  return true;
}
// ### One footfall where you stand: a wet one in a puddle, otherwise the concrete floor (a little deeper on the old pavers
// ### of the tunnel); a slow step is softer than a brisk one.
function step(speed){
  const brisk = .55 + .45 * Math.min(1, speed / WALK_SPEED), wet = !tunnelWalk && WATER.wetAt(cam.pos.x, cam.pos.z);
  if (!footstep(wet ? 'wet' : 'floor', STEP_VOL[wet ? 'wet' : 'floor'] * brisk, tunnelWalk ? .88 : 1)) noise(.09, .06, 'lowpass', 240);
}
// ### The washroom's echo for the footsteps: stereo noise that dies away 60 dB in 0.8 s and only slowly gets darker,
// ### after early reflections off the concrete and tiles (7 to 31 ms).
function washroomEcho(){
  const len = Math.floor(ac.sampleRate * 1.1), buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++){
    const d = buf.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++){
      const t = i / ac.sampleRate, k = .08 + .5 * Math.min(1, t / .8);   // the tail slowly loses its highs
      lp += (1 - k) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-6.9 * t / .8) * Math.min(1, t / .012);
    }
    for (const [ms, a] of [[7, .5], [11, .35], [17, .3], [23, .22], [31, .18]]) d[Math.floor((ms + c * 1.5) / 1000 * ac.sampleRate)] += a * (c ? -1 : 1);
  }
  return buf;
}
// ### Plays one short tone.
function tone(freq, dur, type, vol, slideTo, delay){
  if (!ac) return;
  const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
}
// ### Plays one short burst of filtered noise.
function noise(dur, vol, type, freq, delay){
  if (!ac) return;
  const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type || 'lowpass'; f.frequency.value = freq || 800;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + .02);
}
// ### Plays a sound cue for an event, such as a warning or a lock opening.
function cue(name){
  if (!ac || !name) return;
  switch (name){
    case 'tick': tone(2400, .03, 'square', .03); noise(.03, .05, 'highpass', 3000); break;
    case 'flicker': noise(.045, .07, 'highpass', 3200); tone(100, .09, 'sawtooth', .022); break;   // the tube's starter ticks
    case 'flickerFar': noise(.04, .03, 'highpass', 3500); break;
    case 'clunk': noise(.25, .5, 'lowpass', 260); tone(90, .3, 'sine', .3, 50); break;
    case 'scrape': for (let i = 0; i < 4; i++) noise(.12, .18, 'bandpass', 2600, i * .11); break;
    case 'take': tone(660, .12, 'triangle', .12); tone(990, .16, 'triangle', .1, null, .08); break;
    case 'paper': noise(.22, .12, 'highpass', 2200); break;
    case 'open': tone(140, 1.4, 'sawtooth', .07, 55); noise(.4, .35, 'lowpass', 300, 1.1); break;
    case 'bang': noise(.7, .9, 'lowpass', 500); tone(70, .6, 'sine', .5, 40); break;
    case 'warn': tone(880, .12, 'square', .05); tone(880, .12, 'square', .05, null, .2); break;
    case 'rattle': for (let i = 0; i < 6; i++) noise(.07, .45, 'bandpass', 900, i * .13); break;
    case 'nope': tone(120, .18, 'square', .05); break;
    case 'step': if (!stepBufs.floor.length) noise(.12, .12, 'lowpass', 180); break;   // with the recordings, the walk itself steps
    case 'door': noise(.3, .5, 'lowpass', 220); break;
    case 'wedge': noise(.2, .3, 'lowpass', 400); tone(200, .2, 'triangle', .1); break;
    case 'water': break;
    default: tone(520, .06, 'sine', .04);
  }
}

// ---------- Briefing scene ----------
// ### Briefing card 3 as a short scene in the room: you turn round to the open door, Officer Hale stands in the corridor
// ### light, swings the door shut, locks it and tells you through it that your ten minutes have begun. Next skips it; Back
// ### from card 4 plays it again. With reduced motion it starts at the end: the door shut and his words on the card.
const DOOR_OPEN = 1.35, CINE_END = 5;
const HALE_GRIP = new THREE.Vector3(), HALE_EYE = new THREE.Vector3();   // where his right hand holds the door, and where he looks
let cineT = -1, shake = 0;
// ### Made ready before it plays, so it runs smoothly from the first frame. Everything the room loads (Hale's model and
// ### skin, his uniform, the door's steel, the other models and pictures) comes in while the first cards are read; once all
// ### of it is there, warmOpening() draws one frame with the corridor, the door light and Hale switched on (he is behind the
// ### shut door then, and fully faded out, so nothing shows): the graphics card builds every shader the scene needs and
// ### takes every picture before the scene starts, instead of in its first frames. (The door light alone changes the shader
// ### of every lit surface in the room.) Its sounds are made in code (see cue()), so there is nothing of theirs to load.
// ### The scene waits for this on its card, at most CINE_WAIT seconds; on a very slow connection it then plays anyway, with
// ### what has arrived. On the heist page room 2 is loaded ahead in the same window, and while it builds its world the
// ### scene waits for that too (nextDoorBusy, told by the heist page).
const CINE_WAIT = 12;
let openingWarm = false, nextDoorBusy = false, cineFrom = 0, cineLoading = false;
function warmOpening(){
  openingWarm = true;
  const was = [hall.visible, doorLight.visible, hale.g.visible];
  hall.visible = doorLight.visible = hale.g.visible = true;
  renderer.compile(scene, camera);
  // every picture on every surface goes to the graphics card now, also on what is out of view (the door behind you)
  const sent = new Set(), send = t => {
    if (!t || !t.isTexture || t.isCubeTexture || sent.has(t) || !t.image || t.image.complete === false) return;
    sent.add(t); renderer.initTexture(t);
  };
  scene.traverse(o => { for (const m of [].concat(o.material || [])){ for (const k in m) send(m[k]); if (m.uniforms) for (const k in m.uniforms) send(m.uniforms[k].value); } });
  renderer.shadowMap.needsUpdate = true;   // and Hale's shadow
  // after this frame has been drawn, all is put back as it was
  return () => { [hall.visible, doorLight.visible, hale.g.visible] = was; shadowsMoved(); };
}
addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== parent || !e.data) return;
  if (e.data.shardHeist === 'busy') nextDoorBusy = true;
  else if (e.data.shardHeist === 'calm') nextDoorBusy = false;
});
const LINES = [
  [0, '<span class="narr">Officer Hale walks you to washroom 2 and holds the door open.</span>'],
  [.9, '<b>Hale:</b> “Inside, 4471.”'],
  [3.4, '<b>Hale</b>, through the door: “Your ten minutes have begun. Not a second more.”']
];
function cineLine(html){ const el = card.querySelector('#cineLine'); if (el) el.innerHTML = html; }
function startCine(){
  hall.visible = true; doorLight.visible = true; cineT = REDUCED ? CINE_END : 0; cineFrom = performance.now(); cineLoading = false;
  overlay.classList.add('cine'); $('lookHint').classList.add('hush'); goView('closing', 1.2);
  if (REDUCED){ cineLine(LINES[2][1]); card.querySelector('#cineClock').classList.add('on'); guardShow = 5; }
  else cineLine(LINES[0][1]);
  updateCine(0);
}
function stopCine(){
  overlay.classList.remove('cine'); $('lookHint').classList.remove('hush');
  if (cineT < 0) return;
  cineT = -1; hall.visible = false; doorPivot.rotation.y = 0; haleFade(0); haleShadow.material.opacity = 0; doorLight.intensity = 0; doorLight.visible = false; shake = 0; shadowsMoved();
  if (S.scene === 'intro') goView('intro', .9);
}
// ### One step of the scene: the door, the light and Hale follow the time; the sounds and words come once each.
function updateCine(dt){
  if (cineT < 0) return;
  // not ready yet: the door stays shut and the card says so, until it is (or has waited long enough)
  const waited = (performance.now() - cineFrom) / 1000;   // in real seconds, however slow the frames are
  if (cineT === 0 && (!openingWarm || nextDoorBusy) && waited < CINE_WAIT){
    if (waited > .5 && !cineLoading){ cineLoading = true; cineLine('<span class="narr">Loading the scene…</span>'); }
    return;
  }
  if (cineLoading){ cineLoading = false; cineLine(LINES[0][1]); }
  const t0 = cineT, t = cineT = Math.min(CINE_END + 1, cineT + dt), at = s => t0 < s && t >= s;
  if (t !== t0) shadowsMoved();
  const k = clamp((t - 1.7) / .95, 0, 1), open = 1 - k * k;   // held open, then swung shut, faster and faster
  doorPivot.rotation.y = DOOR_OPEN * open;
  doorLight.intensity = 4 * open;
  haleFade(Math.min(1, t * 2.5) * (open > .02 ? 1 : 0));
  hale.g.position.z = HALE_AT.z + k * .12; haleShadow.position.z = 2.3 + k * .12;   // his shadow steps back with him
  if (hale.pose && hale.g.visible){ doorPivot.updateMatrixWorld(true); hale.pose(t, doorPivot.localToWorld(HALE_GRIP.set(1.02, 1.05, .04)), camera.getWorldPosition(HALE_EYE)); }
  haleShadow.material.opacity = .75 * open * Math.min(1, t * 2.5);
  for (const [s, html] of LINES) if (s > 0 && at(s)) cineLine(html);
  if (at(1.7)) cue('open');
  if (at(2.65)){ cue('bang'); shake = .45; hall.visible = false; }
  if (at(3.05)){ cue('clunk'); guardShow = 2.6; }   // his figure at the window: he says his words, then walks off
  if (at(3.25)) cue('rattle');
  if (at(3.4)){ const c = card.querySelector('#cineClock'); if (c) c.classList.add('on'); }
}

// ---------- Endings ----------
// ### Ending A: the lid swings up and dust trickles from the rim, the old bulbs below come on, and you climb down the
// ### wooden ladder in the first person. You let yourself down into the hatch facing the ladder and hold on to the frame,
// ### then go down rung by rung: one hand lets go and grabs a lower rung while the other holds on, one boot steps down
// ### to a lower rung, then your body sinks one rung, then the other hand and the other boot. Your whole body is there:
// ### the hands close round the rungs, the forearms run to bent elbows and up to your shoulders, and when you glance
// ### down you see your chest, your legs and your boots on the rungs. The only sound is the old wood creaking under your
// ### weight, with the echo of the shaft (recorded, sounds/ladder.mp3); the hatch creaks open on its hinges. Every
// ### grab shakes dust off the wood, and on the way you pass Hale's note. At the bottom you let go, step onto the stone
// ### floor and turn round to face the tunnel (with reduced motion you are simply down there). Then you walk through
// ### the tunnel yourself, as in the washroom, tearing through the cobwebs across the vault, to the old plank door at
// ### its far end; on a touch screen a button walks you there. Click the door (or its marker) when you stand in front
// ### of it: the latch clacks, the door creaks open on its old hinges and swings out, the headlights of the car waiting
// ### in the garage behind it shine in, fill the screen, and room 2 opens in that light (showEnding).
// ### Ending B: the door is flung open, white corridor light floods in, then the card.
let hatchAnim = -1, doorFlash = 0, endingShown = false, climb = null, endStep = 0, tunnelWalk = null;
const CLIMB = { mount: 1.4, step: .74, steps: 8, off: 2.2, eye: .55 };
CLIMB.eyeZ = TUN.ladderZ + .42;
CLIMB.end = CLIMB.mount + CLIMB.steps * CLIMB.step + CLIMB.off;
const FOG_ROOM = scene.fog.color.clone(), FOG_TUNNEL = new THREE.Color(0x15110c), FOG_NIGHT = new THREE.Color(0x46536a);
const easeIO = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const bump = (t, a, b) => Math.sin(Math.PI * clamp((t - a) / (b - a), 0, 1));
// ### Where a hand holds on: the edge of the hatch frame at the top, a rung (at height y) below it.
const gripAt = (side, y) => {
  if (y > -.1) return new THREE.Vector3(TUN.x + side * .2, .035, TUN.zN + .015);
  const r = RUNG_AT[Math.round(-y / .3)];
  return r ? new THREE.Vector3(r.x + side * .14, r.y, r.z) : new THREE.Vector3(TUN.x + side * .14, y, TUN.ladderZ);
};
// ### How a hand holds on, in the world: the way the fingers point before they bend and the way the back of the hand
// ### faces. On a rung this turns with the forearm (see climbHands); on the hatch frame the hand lies flat, fingers forward.
const GRIP = { rung: { F: new THREE.Vector3(0, -.35, -1).normalize(), B: new THREE.Vector3(0, 1, -.35).normalize(), up: .033, back: .075, curl: .95 },
  edge: { F: new THREE.Vector3(0, -.12, -1).normalize(), B: new THREE.Vector3(0, 1, -.12).normalize(), up: .02, back: .07, curl: .45 } };
// ### Where a boot stands: the ankle above the rung at height y, so the sole rests on it under the ball of the foot.
const footAt = (side, y) => new THREE.Vector3(TUN.x + side * .1, y + .113, TUN.ladderZ + .1);
function endingA(){
  hatchAnim = 0; endingShown = false; climb = null; tunnelWalk = null; $('lookHint').classList.add('gone');
  tunnelLight.visible = tunnelLight2.visible = nightLight.visible = dust.pts.visible = true; tunnelEnd(true);
  dustFall(70, HATCH.x, -.01, HATCH.z, HS * .9);
}
// ### The hatch swings open on its old hinges: a long, slow creak from the ladder's recordings played slowed down, with
// ### the echo of the shaft below (a drawn creak until the recording has arrived).
function hatchCreak(){
  if (ladderSound('creak1', .6, .5)){ ladderSound('creak2', .5, .42, .55); ladderSound('creak1', .4, .62, 1.05); return; }
  tone(105, .9, 'sawtooth', .04, 72); tone(140, .7, 'sawtooth', .025, 96, .6);
}
// ### The door, the garage behind it and the two webs across the vault (each its own draw call) are only drawn from the
// ### moment the hatch opens, so while you play in the washroom they cost nothing.
function tunnelEnd(on){
  TDOOR.pivot.visible = TDOOR.out.visible = on;
  for (const m of TUN.webs){ m.material.opacity = 1 - (m.userData.torn || 0); m.visible = on && !(m.userData.torn > .99); }
}
// ### At the foot of the ladder you are on your own feet again: the walk through the tunnel begins.
function startTunnelWalk(){
  climb = null; tunnelWalk = { door: -1, near: false };
  cam.vel.set(0, 0, 0); cam.t = 1;
  say(COARSE ? 'Down at last. The door at the far end of the tunnel: tap “Walk to the door”.' : 'Down at last. Walk through the tunnel to the door at the far end.');
  renderHotspots();
}
// ### On a touch screen: walks you down the tunnel to stand in front of the door.
function walkToDoor(){
  if (!tunnelWalk || tunnelWalk.door >= 0 || cam.t < 1) return;
  goView('tunnelDoor', Math.max(.8, cam.pos.distanceTo(new THREE.Vector3(...VIEWS.tunnelDoor.pos)) / 1.5));
}
// ### Opens the door at the end of the tunnel, but only from right in front of it.
function openDoor(){
  const w = tunnelWalk;
  if (!w || w.door >= 0 || endingShown) return;
  if (!nearDoor()){ say('The door is at the far end of the tunnel. Walk up to it first.', 'warn'); cue('nope'); return; }
  w.door = 0; held.clear(); reachHand(); doorCreak(); renderHotspots();
  goView('tunnelOut', 2.4);
}
// ### The latch clacks, then the old hinges creak long and slow as the door swings out (the ladder's creak recordings,
// ### played slower still, with the echo of the tunnel; a drawn creak until the recording has arrived).
function doorCreak(){
  noise(.08, .3, 'bandpass', 1400); tone(240, .07, 'square', .025, 150);
  if (ladderSound('creak2', .6, .56, .22)){ ladderSound('creak1', .5, .45, .75); ladderSound('creak2', .32, .5, 1.35); return; }
  tone(118, 1.1, 'sawtooth', .04, 80, .22); tone(160, .8, 'sawtooth', .025, 104, .8);
}
// ### The door swings open and the car's headlights shine in, then the ending card; the cobwebs across the vault tear as you
// ### walk through them.
function updateTunnelWalk(){
  const w = tunnelWalk, near = w.door < 0 && nearDoor();
  if (near !== w.near){ w.near = near; renderHotspots(); }
  for (const m of TUN.webs){
    const torn = Math.max(m.userData.torn || 0, 1 - smoothStep(.2, .8, Math.abs(camera.position.z - m.position.z)));
    if (torn !== m.userData.torn){ m.userData.torn = torn; m.material.opacity = 1 - torn; m.visible = torn < .99; }
  }
  if (w.door < 0) return;
  w.door += endStep;
  // first the latch gives with a little jolt, then the door swings out and slows as it opens
  const o = REDUCED ? 1 : 1 - Math.pow(1 - clamp((w.door - .3) / 1.7, 0, 1), 3), jolt = REDUCED ? 0 : .02 * bump(w.door, 0, .3);
  TDOOR.pivot.rotation.y = 1.7 * o + jolt;
  nightLight.intensity = 3.4 * o; TDOOR.glow.color.setScalar(.25 + .75 * o); TDOOR.gap.visible = o < .05;
  if (w.door > 2.5 && !endingShown){ endingShown = true; showEnding(); }
}
function endingB(){ doorFlash = 1; goView('cell', .6); setTimeout(() => { if (S.ending === 'B'){ showEnding(); } }, 1400); }
// ### Plans the climb: at each step one hand (right, left, right ...) moves from the rung it holds to a lower one, a
// ### little below where the eye will be after that step, and the boot on the other side steps down to a rung about
// ### a leg's length below the eye.
function startClimb(){
  const moves = [], held = { r: .035, l: .035 }, stood = { r: -.6, l: -.9 };
  for (let k = 0; k < CLIMB.steps; k++){
    const key = k % 2 ? 'l' : 'r', foot = k % 2 ? 'r' : 'l', eyeEnd = CLIMB.eye - .3 * (k + 1);
    const y = Math.max(-3.3, Math.min(Math.round((eyeEnd - .28) / .3) * .3, held[key] > 0 ? -.3 : held[key] - .3));
    const fy = Math.max(-3.3, Math.min(Math.round((eyeEnd - 1.6) / .3) * .3, stood[foot] - .3));
    moves.push({ key, from: held[key], to: y, foot, footFrom: stood[foot], footTo: fy }); held[key] = y; stood[foot] = fy;
  }
  const hand = side => ({ pos: gripAt(side, .035), moving: true, curl: .2 });
  climb = { t: REDUCED ? CLIMB.end : 0, moves, from: { pos: cam.pos.clone(), yaw: wrapAngle(cam.yaw), pitch: cam.pitch }, hands: !REDUCED,
    grabbed: -1, landed: -1, stepped: -1, let: -1, off: 0, bodyYaw: 0, release: 0,
    hand: { r: hand(1), l: hand(-1) }, foot: { r: footAt(1, -.6), l: footAt(-1, -.9) } };
  ladderSound('creak2', .3, .85, .5);
}
// ### One frame of the climb: where the eye is and where it looks, where each hand and boot is, sounds and dust.
function updateClimb(dt){
  const c = climb, C = CLIMB, x = TUN.x, pose = { pos: new THREE.Vector3(), yaw: 0, pitch: -.5, roll: 0 };
  c.t += endStep;
  const bottom = new THREE.Vector3(x, EYE + TUN.floor, -1.1);
  if (c.t < C.mount){
    // let yourself down into the hatch, turning to face the ladder, and take hold of the frame
    const e = easeIO(c.t / C.mount);
    pose.pos.lerpVectors(c.from.pos, new THREE.Vector3(x, C.eye, C.eyeZ), e);
    pose.yaw = c.from.yaw * (1 - e); pose.pitch = c.from.pitch + (-.7 - c.from.pitch) * e;
    for (const key of ['r', 'l']){ const h = c.hand[key]; h.moving = e < .7; h.curl = h.moving ? .2 : 1.25; }
    c.bodyYaw = pose.yaw;
  } else if (c.t < C.mount + C.steps * C.step){
    const tt = (c.t - C.mount) / C.step, k = Math.floor(tt), u = tt - k, m = c.moves[k], s = m.key === 'r' ? 1 : -1;
    const mover = c.hand[m.key], other = c.hand[m.key === 'r' ? 'l' : 'r'];
    // the moving hand lets go, swings down a little away from the ladder and grabs the lower rung
    const uh = clamp(u / .5, 0, 1);
    mover.pos.lerpVectors(gripAt(s, m.from), gripAt(s, m.to), easeIO(uh));
    mover.pos.z += Math.sin(Math.PI * uh) * .06; mover.pos.y += Math.sin(Math.PI * uh) * .03;
    mover.moving = uh > .04 && uh < .96; mover.curl = mover.moving ? .15 : 1.25;
    other.moving = false; other.curl = 1.25;
    // the boot on the other side steps down to its next rung, lifted a little off the ladder on the way
    const uf = clamp((u - .2) / .45, 0, 1), fs = m.foot === 'r' ? 1 : -1;
    c.foot[m.foot].lerpVectors(footAt(fs, m.footFrom), footAt(fs, m.footTo), easeIO(uf));
    c.foot[m.foot].z += Math.sin(Math.PI * uf) * .09; c.foot[m.foot].y += Math.sin(Math.PI * uf) * .04;
    // then the body sinks one rung, leaning a little over the boot that stepped down
    const ed = easeIO(clamp((u - .35) / .6, 0, 1)), sw = Math.sin(Math.PI * ed), look = tt;
    pose.pos.set(x + s * .03 * sw, C.eye - .3 * (k + ed) + sw * .012, C.eyeZ);
    pose.roll = s * .035 * sw;
    // at first you look further down at your hands, then a glance down past your boots, then the note on the left rail
    const down = bump(look, 1.9, 3.5), note = bump(look, 4.3, 6.1);
    pose.pitch = -.5 - .22 * clamp(1 - tt / 2, 0, 1) + .05 * sw - .6 * down + .32 * note;
    pose.yaw = -s * .03 * sw - .42 * note;
    c.bodyYaw = -s * .03 * sw;
    if (uh >= 1 && c.grabbed !== k){
      c.grabbed = k; dustFall(10, mover.pos.x, mover.pos.y, mover.pos.z, .1);
    }
    if (uf >= 1 && c.stepped !== k){
      c.stepped = k; dustFall(8, x + fs * .1, m.footTo, TUN.ladderZ, .15);
    }
    if (ed >= .6 && c.landed !== k){
      c.landed = k;
      if (!ladderSound(k % 2 ? 'creak2' : 'creak1', .3 + Math.random() * .15, .75 + Math.random() * .3)) tone(130 + Math.random() * 70, .28, 'sawtooth', .01, 85);   // the old wood creaks under your weight
    }
  } else {
    // at the bottom: step off the last rung onto the stone floor, let go, step back and turn round to face the tunnel
    const v = clamp((c.t - C.mount - C.steps * C.step) / C.off, 0, 1), e = easeIO(v), last = new THREE.Vector3(x, C.eye - .3 * C.steps, C.eyeZ);
    pose.pos.copy(last).lerp(bottom, easeIO(clamp(v * 1.6, 0, 1)));
    pose.yaw = Math.PI * easeIO(clamp((v - .2) / .8, 0, 1)); pose.pitch = -.5 + .4 * e;
    c.bodyYaw = pose.yaw;
    c.release = smoothStep(.05, .4, v);   // the hands let go and the boots step down onto the stone
    if (c.off === 0){ c.off = 1; ladderSound('creak1', .3, .7); dustFall(14, x, TUN.floor + .3, C.eyeZ - .1, .4); }
  }
  if (REDUCED){ const v = VIEWS.tunnel, a = anglesTo(v.pos, v.look); pose.pos.fromArray(v.pos); pose.yaw = a.yaw; pose.pitch = a.pitch; pose.roll = 0; c.hands = false; }
  return pose;
}
// ### Your body on the ladder, drawn with the hands (so a wall never hides it): the chest in the striped uniform with
// ### its collar and number, the shoulders, the upper arms and elbows, the legs with knees, and leather work boots. The
// ### cloth is shaped like a body in loose clothes (narrower at the waist, a calf under the trouser leg) and creased:
// ### it bunches into rings of wrinkles at the elbows, the knees, the waist and over the boots. Built the first time you climb.
let ME = null;
// ### The radius of a profile [[y, r], ...] at height y (straight lines between the points).
function profileAt(pr, y){
  for (let i = 1; i < pr.length; i++) if (y <= pr[i][0]){ const [y0, r0] = pr[i - 1], [y1, r1] = pr[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  return pr[pr.length - 1][1];
}
// ### A tube of cloth from y = 0 to y = 1 (stretched to its length later) whose radius follows the profile. Folds are
// ### pushed into it: soft lengthwise drape all along, and rings of wrinkles where the cloth bunches ([height, reach,
// ### depth] in bunch), each ring wavering round the tube so no two folds are alike. Each corner gets a colour: darker
// ### deep in a fold, where little light reaches, and browner where dirt(y, angle) says the cloth is dusty.
function clothTube(profile, bunch, seg = 24, rows = 36, dirt, seal = [1, 1]){
  const pts = []; for (let j = 0; j <= rows; j++){ const y = j / rows; pts.push(new THREE.Vector2(profileAt(profile, y), y)); }
  const geo = new THREE.LatheGeometry(pts, seg), p = geo.attributes.position, uv = geo.attributes.uv, s1 = brnd() * 6.3, s2 = brnd() * 6.3;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z);
    let f = .025 * Math.sin(a * 3 + s1 + y * 2) + .012 * Math.sin(a * 7 + s2 - y * 3), fold = 0;
    for (const [c, w, amp] of bunch){
      const d = (y - c) / w;
      if (Math.abs(d) < 1) fold += amp * (1 - d * d) * Math.sin((y - c) / w * 9 + Math.sin(a * 2 + s1) * 1.8 + Math.sin(a * 5 + s2) * .6);
    }
    // where the tube meets a joint the folds die away, so its edge closes neatly round the joint
    const fade = Math.min(1, seal[0] ? y / .08 : 1, seal[1] ? (1 - y) / .08 : 1);
    f = (f + fold) * fade; fold *= fade;
    p.setX(i, x * (1 + f)); p.setZ(i, z * (1 + f));
    uv.setY(i, uv.getY(i) + f * .3 + .012 * Math.sin(a * 2 + s2 + y * 4));   // the stripes are pulled out of line by the folds
    const shade = clamp(1 + f * 3 + Math.min(0, fold) * 6, .42, 1.08), dust = dirt ? clamp(dirt(y, a + s2), 0, 1) : 0;
    col[i * 3] = shade * (1 - dust * .3); col[i * 3 + 1] = shade * (1 - dust * .36); col[i * 3 + 2] = shade * (1 - dust * .46);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // the first and last column of the lathe are the same seam: give them the same normal so it does not show
  const n = geo.attributes.normal, cols = rows + 1;
  for (let j = 0; j < cols; j++){
    const a = j, b = seg * cols + j, v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
  return geo;
}
// ### A leather work boot (or its sole), shaped from a sphere: the ankle at the origin, the toe towards -z. Along its
// ### length it is narrow at the heel and widest at the ball of the foot with a broad round toe; its cross-section is a
// ### rounded rectangle from the sole (bottom) to the top, which rises into the shaft round the ankle and slopes down
// ### to the toe. Creases cross the instep where the boot bends. bootPoint gives one point of that surface, from a
// ### point of the unit sphere, so the eyelets and laces can be put right on the leather.
const smoothStep = (a, b, v) => { const q = clamp((v - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
function bootPoint(sx, sy, sz, bottom, topAt, widen, creases, out){
  const sq = v => Math.sign(v) * Math.pow(Math.abs(v), .55);   // a circle pushed out towards a rounded square
  const rho = Math.sqrt(Math.max(0, 1 - sy * sy)), t = (1 - sy) / 2, cx = rho > 1e-5 ? sx / rho : 0, cz = rho > 1e-5 ? sz / rho : 0;
  const w = .034 + .019 * Math.sin(Math.PI * Math.min(1, t * .9)) + widen;   // widest at the ball of the foot, a broad round toe
  const tip = Math.pow(rho, t > .5 ? .5 : .32);   // round at the heel and the toe
  const top = topAt(t), h = (sq(cz) + 1) / 2;
  let y = bottom + (top - bottom) * h * (.35 + .65 * tip) + (top - bottom) * .65 * (1 - tip) * .5;
  if (creases && h > .7 && t > .5 && t < .66) y += Math.sin((t - .5) * 120) * .0022 * (h - .7) / .3;
  return out.set(sq(cx) * w * tip, y, .08 - t * .3);
}
function bootGeometry(bottom, topAt, widen, creases){
  const geo = new THREE.SphereGeometry(1, 28, 24), p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++){ bootPoint(p.getX(i), p.getY(i), p.getZ(i), bottom, topAt, widen, creases, v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  return geo;
}
function buildBody(){
  const cloth = prisonCloth(512, 512, [2, 4.2], .3);
  // the side seams: a ridge down the edge of the cloth (twice round each tube), sewn with a row of pale stitches either side
  for (const [tex, paint] of [[cloth.map, (g, h) => {
    g.fillStyle = 'rgba(20,18,16,.45)'; g.fillRect(0, 0, 3, h); g.fillRect(509, 0, 3, h);
    g.fillStyle = 'rgba(214,204,176,.55)'; for (let y = 0; y < h; y += 9){ g.fillRect(6, y, 1.5, 5); g.fillRect(505, y + 4, 1.5, 5); }
  }], [cloth.bump, (g, h) => {
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, 2, h); g.fillRect(510, 0, 2, h);
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(3, 0, 5, h); g.fillRect(504, 0, 5, h);
    g.fillStyle = 'rgba(0,0,0,.4)'; for (let y = 0; y < h; y += 9){ g.fillRect(6, y + 5, 1.5, 4); g.fillRect(505, y, 1.5, 4); }
  }]]){ paint(tex.image.getContext('2d'), 512); tex.needsUpdate = true; }
  const mat = linenCloth(cloth, new THREE.MeshStandardMaterial({ color: 0xc8c8c8, map: cloth.map, side: THREE.DoubleSide, vertexColors: true }));
  // where the uniform has picked up dust: round the hems and the knees from the ladder and the floor, in patches
  const patchy = (a, y) => .65 + .35 * Math.sin(a * 3 + y * 11) * Math.sin(a * 5 - y * 7);
  const smooth = smoothStep;
  // the boots: dark brown leather, scuffed pale at the toe and the heel, creased where they bend, on black rubber soles
  const leatherMap = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2a1d14'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++){ const v = brnd(); g.fillStyle = v > .5 ? `rgba(90,64,44,${(v - .5) * .3})` : `rgba(8,5,3,${v * .3})`; g.fillRect(brnd() * w, brnd() * h, 2, 2); }
    for (let i = 0; i < 26; i++){ const y = h * (brnd() < .6 ? .8 + brnd() * .2 : brnd() * .12), x = brnd() * w, r = 5 + brnd() * 16;   // scuffs at the toe and the heel
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,96,74,.35)'); gr.addColorStop(1, 'rgba(120,96,74,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.strokeStyle = 'rgba(160,130,90,.5)'; g.setLineDash([3, 3]); g.lineWidth = 1.2;   // stitching round the toe cap
    g.beginPath(); g.moveTo(0, h * .72); g.lineTo(w, h * .72); g.stroke(); g.beginPath(); g.moveTo(0, h * .3); g.lineTo(w, h * .3); g.stroke();
  });
  const leatherBump = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++){ g.fillStyle = brnd() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.12)'; g.fillRect(brnd() * w, brnd() * h, 1.5, 1.5); }   // the grain
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 30; i++){ const y = h * (.55 + brnd() * .12), x = brnd() * w; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 12, y + (brnd() - .5) * 6, x + 20 + brnd() * 20, y + (brnd() - .5) * 4); g.stroke(); }   // creases
  });
  leatherBump.encoding = THREE.LinearEncoding;
  const leather = new THREE.MeshStandardMaterial({ map: leatherMap, bumpMap: leatherBump, bumpScale: .0008, roughness: .48, envMapIntensity: .5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141211, roughness: .95, envMapIntensity: .25 });
  const lace = new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: .9 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a7650, metalness: 1, roughness: .45 });
  const g = new THREE.Group(); handScene.add(g);
  const add = (o, parent) => { o.frustumCulled = false; (parent || g).add(o); return o; };
  const mesh = (geo, m, parent) => add(new THREE.Mesh(geo, m || mat), parent);
  const ball = (r, dust = 0) => {
    const geo = plainColours(new THREE.SphereGeometry(r, 16, 12)), c = geo.attributes.color, uv = geo.attributes.uv;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, 1 - dust * .3, 1 - dust * .36, 1 - dust * .46);
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * Math.PI * r / .42);   // stripes as wide as on a leg (4.2 to 0.42 m)
    return mesh(geo);
  };
  const two = f => [f(), f()];
  // the chest: hips (y = -1) to the base of the neck (y = 0), a body's outline, scaled to 38 by 22 cm
  const torso = add(new THREE.Group());
  // (the shirt: its hem hangs loose a hand's breadth over the trousers, a little belly above it, the chest, the shoulders)
  const CHEST = [[0, 1.02], [.05, .97], [.14, .9], [.3, .87], [.42, .9], [.6, .97], [.85, 1], [.95, .8], [1, .46]];
  const chest = mesh(clothTube(CHEST, [[.22, .12, .05], [.62, .3, .02]], 28, 40,
    (y, a) => (1 - smooth(0, .35, y)) * .35 * patchy(a, y)).translate(0, -1, 0), mat, torso);
  const collar = mesh(plainColours(new THREE.TorusGeometry(.083, .013, 8, 28).rotateX(Math.PI / 2)), mat, torso); collar.scale.set(1, 1, .6); collar.position.y = -.01;
  // the inmate number stencilled on a cloth patch on the chest
  const patch = mesh(new THREE.PlaneGeometry(.11, .05), new THREE.MeshStandardMaterial({ roughness: .95, map: canvasTex(256, 116, (c, w, h) => {
    c.fillStyle = '#d9d2bd'; c.fillRect(0, 0, w, h); grime(c, w, h, 5, 'rgba(90,70,40,.25)', 50, false);
    c.fillStyle = '#1d1c1b'; c.font = '700 80px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('4471', w / 2, h * .8);
  }) }), torso);
  patch.position.set(-.07, -.17, -.112); patch.rotation.set(-.12, Math.PI, 0);
  // the buttons down the front of the shirt, on a placket of doubled cloth
  const button = new THREE.MeshStandardMaterial({ color: 0x2c2a27, roughness: .45 }), buttons = [];
  for (let k = 0; k < 6; k++){
    const q = .1 + k * .15, r = profileAt(CHEST, 1 - q) * .11;
    const b = mesh(new THREE.CylinderGeometry(.0065, .0065, .003, 12).rotateX(Math.PI / 2), button, torso); b.position.set(0, -q * CHEST_LEN, -r - .004);
    buttons.push({ b, q, r });
  }
  // a boot: upper, sole with its heel, and the laces criss-crossing between two rows of brass eyelets on the leather
  const upperTop = t => .075 - .088 * smoothStep(.3, .72, t) - .012 * smoothStep(.85, 1, t);
  const boot = () => {
    const b = add(new THREE.Group());
    mesh(bootGeometry(-.07, upperTop, 0, true), leather, b);
    mesh(bootGeometry(-.093, () => -.066, .006, false), rubber, b);
    mesh(new THREE.BoxGeometry(.066, .024, .072).translate(0, -.1, .044), rubber, b);   // the heel
    const holes = [];
    for (let k = 0; k < 6; k++){
      const sy = 1 - 2 * (.36 + k * .052), rho = Math.sqrt(1 - sy * sy), row = [];
      for (const s of [-1, 1]){
        const at = bootPoint(s * rho * .34, sy, rho * .94, -.07, upperTop, 0, false, new THREE.Vector3()), up = bootPoint(0, sy, rho, -.07, upperTop, 0, false, new THREE.Vector3());
        at.y += .0008; row.push(at.clone().add(new THREE.Vector3(0, .0022, 0)));
        const e = mesh(new THREE.TorusGeometry(.0036, .0012, 5, 10), brass, b); e.position.copy(at);
        e.quaternion.setFromUnitVectors(AXIS_Z, new THREE.Vector3(s * (at.y - up.y) * -6, 1, 0).normalize());   // lying flat on the leather
      }
      holes.push(row);
    }
    // a lace: a thin cord from one eyelet across to the other row, one rung further up, and the bar across the bottom
    const cord = (A, B) => { const d = B.clone().sub(A), m = mesh(new THREE.CylinderGeometry(.0017, .0017, 1, 5), lace, b); m.position.copy(A).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(AXIS_Y, d.clone().normalize()); m.scale.y = d.length(); };
    cord(holes[holes.length - 1][0], holes[holes.length - 1][1]);
    for (let k = holes.length - 1; k > 0; k--){ cord(holes[k][0], holes[k - 1][1]); cord(holes[k][1], holes[k - 1][0]); }
    bakeArm(b);   // the boot's thirty parts drawn in four calls, one per material
    return b;
  };
  return { g, torso, chest, buttons,
    shoulder: two(() => ball(.064)),
    upper: two(() => mesh(clothTube([[0, .05], [.35, .057], [.75, .064], [1, .066]], [[.1, .2, .09], [.9, .12, .04]], 24, 36, (y, a) => (1 - smooth(0, .3, y)) * .25 * patchy(a, y)))),
    elbow: two(() => ball(.049)),
    hip: two(() => ball(.083)),
    thigh: two(() => mesh(clothTube([[0, .09], [.15, .089], [.5, .079], [.8, .068], [1, .063]], [[.0, .12, .05], [.86, .17, .08]], 24, 36, (y, a) => smooth(.7, 1, y) * .55 * patchy(a, y)))),
    knee: two(() => ball(.064, .45)),
    shin: two(() => mesh(clothTube([[0, .062], [.15, .066], [.33, .071], [.6, .062], [.9, .057], [.97, .063], [1, .06]], [[.1, .14, .05], [.88, .14, .1]], 24, 36,
      (y, a) => ((1 - smooth(0, .18, y)) * .5 + smooth(.5, 1, y) * .9) * patchy(a, y), [1, 0]))),
    boot: two(boot) };
}
// ### Where the middle joint goes for a limb from root to end with two bones of lengths a and b, bending towards pole.
function twoBone(root, end, a, b, pole){
  const d = end.clone().sub(root), dist = clamp(d.length(), Math.abs(a - b) + .01, a + b - .002); d.normalize();
  const along = (a * a - b * b + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, a * a - along * along));
  const p = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
  return root.clone().add(d.multiplyScalar(along)).add(p.multiplyScalar(h));
}
const _q2 = new THREE.Quaternion(), _inv = new THREE.Matrix4(), _m4 = new THREE.Matrix4(), _qw = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qy = new THREE.Quaternion();
const _hv = new THREE.Vector3(), _up = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ax = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);
const toCam = v => v.clone().applyMatrix4(_inv);
// ### Turns a joint so that the poles of its sphere (where the cloth pattern bunches up) point along a world direction.
const _dv = new THREE.Vector3();
function aimJoint(m, dir){ m.quaternion.setFromUnitVectors(AXIS_Y, _dv.copy(dir).transformDirection(_inv)); }
// ### Stretches a limb from world point A to world point B.
function placeLimb(m, A, B){
  _a.copy(A).applyMatrix4(_inv); _b.copy(B).applyMatrix4(_inv).sub(_a);
  const len = _b.length(); m.position.copy(_a); m.quaternion.setFromUnitVectors(AXIS_Y, _b.divideScalar(len || 1)); m.scale.set(1, len, 1);
}
const CHEST_LEN = .6 * 1.12;   // the shirt from the neck to its hem
const FOREARM = .29, UPPER_ARM = .31, THIGH = .46, SHIN = .46, ARM_REACH = .58, LEG_REACH = .9;
// ### The hands on the ladder and the body they belong to. Each hand closes round its rung: the wrist sits so that the
// ### rung lies across the palm at the base of the fingers, and the hands are fixed to the rungs in the world, so they
// ### stay put while you sink. Each forearm runs from the wrist to an elbow found from the shoulder (two bones), so the
// ### arms always reach your shoulders; the legs are solved the same way from the hips to the boots on the rungs.
function climbHands(dt){
  if (!ME) ME = buildBody();
  HANDS.down += (0 - HANDS.down) * (1 - Math.exp(-dt * 6));
  camera.updateMatrixWorld();
  _inv.copy(camera.matrixWorld).invert();
  camera.getWorldQuaternion(_qc).invert();
  // the body turns with the climb, not with the head: forward, right and the base of the neck
  const by = climb.bodyYaw, fwd = new THREE.Vector3(Math.sin(by), 0, -Math.cos(by)), right = new THREE.Vector3(Math.cos(by), 0, Math.sin(by));
  const neck = camera.position.clone().add(new THREE.Vector3(0, -.2, 0)).addScaledVector(fwd, -.09);
  const hips = neck.clone().add(new THREE.Vector3(0, -.6, 0)).addScaledVector(fwd, .03);
  _qy.setFromAxisAngle(AXIS_Y, -by);
  ME.g.visible = true;
  HANDS.scaled = true;
  const follow = climb.t > 1.2 ? 1 : 1 - Math.exp(-dt * (8 + climb.t * 60)), legs = { knees: [], ankles: [] };
  for (const key of ['r', 'l']){
    const h = HANDS[key], g = climb.hand[key], side = key === 'r' ? 1 : -1, i = key === 'r' ? 0 : 1;
    // the rung sits across the palm: the wrist is a hand's breadth back along the forearm and a little to the back of the hand
    const zl = _a.copy(AXIS_Z).applyQuaternion(h.arm.quaternion), yl = _b.copy(AXIS_Y).applyQuaternion(h.arm.quaternion);
    _hv.copy(g.pos).applyMatrix4(_inv).addScaledVector(zl, .075).addScaledVector(yl, .032); _hv.y -= HANDS.down * .35;
    // holding on, the hand is set by the rung itself: the rung across the palm at the base of the fingers, the
    // fingers over the top and down round its far side, the knuckles along it; the wrist bends to meet the forearm
    const grip = g.pos.y > -.1 ? GRIP.edge : GRIP.rung;
    if (grip === GRIP.rung){
      // a hand can turn round a rung: it lines up with the forearm (as it was a moment ago), so the wrist hardly bends
      const d = h.toElbow || _b.set(0, -.4, 1), dyz = _a.set(0, d.y, d.z);
      if (dyz.lengthSq() > .04){ grip.F.copy(dyz).normalize().negate(); grip.B.copy(grip.F).negate().cross(AXIS_X); }
    }
    h.hold = (h.hold || 0) + ((g.moving || climb.release ? 0 : 1) - (h.hold || 0)) * (1 - Math.exp(-dt * 16));
    if (h.hold > .001) _hv.lerp(g.pos.clone().addScaledVector(grip.F, -grip.back).addScaledVector(grip.B, grip.up).applyMatrix4(_inv), h.hold);
    if (climb.release){   // at the bottom the hands let go and hang at your sides
      const hang = neck.clone().addScaledVector(right, side * .24).addScaledVector(fwd, .06).add(new THREE.Vector3(0, -.62, 0)).applyMatrix4(_inv);
      _hv.lerp(hang, climb.release); g.moving = climb.release < 1; g.curl = .35;
    }
    // an arm reaches no further than its length: a hold still out of reach is reached for, and taken once it is near
    const shoulder = neck.clone().addScaledVector(right, side * .19).add(new THREE.Vector3(0, -.03, 0));
    const wristW = _hv.clone().applyMatrix4(camera.matrixWorld), reach = wristW.clone().sub(shoulder);
    if (reach.length() > ARM_REACH) wristW.copy(shoulder).addScaledVector(reach.normalize(), ARM_REACH);
    _hv.copy(wristW).applyMatrix4(_inv);
    // the hands glide in from where they hung at the start of the climb, then follow their holds exactly, so the arm
    // never comes apart from the hand or the shoulder
    h.p.lerp(_hv, follow); h.v.set(0, 0, 0); h.w.set(0, 0, 0);
    h.arm.position.copy(h.p);
    wristW.copy(h.p).applyMatrix4(camera.matrixWorld);
    const elbow = twoBone(shoulder, wristW, UPPER_ARM, FOREARM, right.clone().multiplyScalar(side * .8).add(new THREE.Vector3(0, -1, 0)).addScaledVector(fwd, -.3));
    // the forearm points to the elbow, the back of the hand faces up and towards you, the thumb a little inwards
    const elbowC = toCam(elbow);
    h.toElbow = (h.toElbow || new THREE.Vector3()).copy(elbow).sub(wristW).normalize();
    _up.set(0, 1, 0).transformDirection(_inv).add(_ax.copy(h.p).normalize().negate());
    _m4.lookAt(elbowC, h.p, _up);
    _qw.setFromRotationMatrix(_m4).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -side * (g.moving ? .5 : .25)));
    h.arm.quaternion.copy(_qw);   // the forearm always points straight at the elbow
    h.r.set(h.arm.rotation.x, h.arm.rotation.y, h.arm.rotation.z);   // so the usual springs carry on from here afterwards
    h.arm.visible = HANDS.down < .98;
    // the sleeve reaches exactly to the elbow
    const fl = elbowC.distanceTo(h.p) / .485;
    h.arm.children.forEach(o => { if (o.material === HAND_MAT.sleeve) o.scale.z = fl; });
    placeLimb(ME.upper[i], elbow, shoulder);
    ME.elbow[i].position.copy(elbowC); ME.shoulder[i].position.copy(toCam(shoulder));
    // the joints' poles hide inside the sleeve, or point out sideways along the hinge of the elbow
    aimJoint(ME.shoulder[i], elbow.clone().sub(shoulder));
    aimJoint(ME.elbow[i], shoulder.clone().sub(elbow).cross(wristW.clone().sub(elbow)));
    if (h.wrist){
      h.wrist.rotation.set(g.moving ? .1 : -.35, 0, 0); h.wr.set(0, 0); h.wv.set(0, 0);
      if (h.hold > .001){
        const z = grip.F.clone().negate(), x = grip.B.clone().cross(z);
        _qw.setFromRotationMatrix(_m4.makeBasis(x, grip.B, z)).premultiply(_qc).premultiply(_q2.copy(h.arm.quaternion).invert());
        h.wrist.quaternion.slerp(_qw, h.hold);
      }
      const curl = g.moving ? g.curl : grip.curl;
      for (let f = 0; f < 5; f++) h.curl[f] += ((f === 4 ? curl * .75 : curl) - h.curl[f]) * (1 - Math.exp(-dt * 14));
      poseFingers(h, side, g.moving ? .12 : 0);
    }
    // the leg on this side: hip, knee bent towards the ladder, boot on its rung
    // (while you let yourself down into the hatch the boots come off the floor below you onto the rungs, and a boot
    // still out of reach hangs from the leg, stretched towards its rung)
    const hip = hips.clone().addScaledVector(right, side * .1), ankle = climb.foot[key].clone();
    const stand = hip.clone().addScaledVector(fwd, .06).add(new THREE.Vector3(0, -.86, 0));
    stand.y = Math.max(stand.y, climb.t < CLIMB.mount ? .1 : TUN.floor + .1);
    if (climb.t < CLIMB.mount) ankle.lerpVectors(stand, ankle, smoothStep(.3, .95, climb.t / CLIMB.mount));
    if (climb.release) ankle.lerp(stand, smoothStep(0, .7, climb.release));
    const leg = ankle.clone().sub(hip);
    if (leg.length() > LEG_REACH) ankle.copy(hip).addScaledVector(leg.normalize(), LEG_REACH);
    const knee = twoBone(hip, ankle, THIGH, SHIN, fwd.clone().addScaledVector(right, side * .25));
    legs.knees[i] = knee; legs.ankles[i] = ankle;
    placeLimb(ME.thigh[i], hip, knee); placeLimb(ME.shin[i], knee, ankle);
    ME.hip[i].position.copy(toCam(hip)); ME.knee[i].position.copy(toCam(knee));
    aimJoint(ME.hip[i], knee.clone().sub(hip));
    aimJoint(ME.knee[i], hip.clone().sub(knee).cross(ankle.clone().sub(knee)));
    const boot = ME.boot[i]; boot.position.copy(toCam(ankle)); boot.quaternion.copy(_qc).multiply(_qy);
  }
  // the chest: an oval of 38 by 22 cm from the base of the neck to the hips, turned with the body
  ME.torso.position.copy(toCam(neck)); ME.torso.quaternion.copy(_qc).multiply(_qy); fitShirt(neck.y - hips.y);
  codeBody();
  if (INMATE){ INMATE.g.visible = true; poseInmate(INMATE, neck, hips, by, legs.knees, legs.ankles, [_qy, _qy]); }
}
// ### Fits the shirt to a body len metres from the base of the neck to the hips (the hem hangs 12 % lower), its buttons
// ### down the front; breath swells the chest a little.
function fitShirt(len, breath = 1){
  ME.chest.scale.set(.19 * breath, len * 1.12, .11 * breath);
  for (const { b, q, r } of ME.buttons) b.position.set(0, -q * len * 1.12, -r * breath - .004);
}
// ### Puts the sleeves back to their own length and hides the body once you have let go of the ladder.
function leaveLadder(){
  if (!HANDS.scaled) return;
  HANDS.scaled = false;
  for (const key of ['r', 'l']) HANDS[key].arm.children.forEach(o => { if (o.material === HAND_MAT.sleeve) o.scale.z = 1; });
  if (ME) ME.g.visible = false;
  if (INMATE) INMATE.g.visible = false;
}

// ---------- Your body when you look down ----------
// ### Look down and you see yourself as you would in life: the striped shirt over your chest and belly with its buttons,
// ### the trousers, your knees, your leather boots on the floor, and your arms hanging at your sides with the hands by
// ### your thighs. It is the body from the ladder (buildBody), standing on its own feet. The boots stay planted where they
// ### stand while you walk over them: at every footfall (as you hear it) one lands in front of you, heel first, while the
// ### other rolls up onto its toes behind you and swings through, lifted clear of the floor, and the knees bend as they
// ### would. Walking sideways your legs turn the way you go and your chest half way; walking backwards you step back.
// ### Standing, the legs stay put while you look round, until your head turns so far that they take a step or two to face
// ### the same way; when you stop, the feet come together in a step or two. Kneeling at the hatch, you kneel, your hands
// ### on your thighs. As you look down, your hands leave the bottom of the picture and hang at your sides. The head bends
// ### forward on the neck (see updateCamera), so you see past your chest to your feet. Under you lies your shadow from
// ### the lamps. The body only exists in the picture while you look down far enough to see it; with reduced motion the
// ### legs still step (you still walk), but the hands hold still as before.
const STAND = { torso: .52, hipW: .095, thigh: .42, shin: .385, ankle: .111, tilt: -.1, apart: .1, out: .12, lead: .22 };
const LEG = STAND.thigh + STAND.shin;
// the two points a boot rocks on: the ball of the foot under the sole and the back of the heel (the boot's own space,
// ankle at the origin); STAND.tilt stands the boot so its heel and toe both touch the floor, the ankle STAND.ankle above it
const BALL = new THREE.Vector3(0, -.093, -.15), HEEL = new THREE.Vector3(0, -.112, .08);
const foot = () => ({ g: new THREE.Vector3(), yaw: 0, phi: 0, swing: null, landed: 0, ankle: new THREE.Vector3(), q: new THREE.Quaternion() });
const WALKER = { at: null, vel: new THREE.Vector3(), walking: false, turning: false, legYaw: 0, torsoYaw: 0, sleeves: false,
  feet: { r: foot(), l: foot() },
  // this frame's joints in the room, for the meshes and the shadow
  J: { eye: new THREE.Vector3(), neck: new THREE.Vector3(), hips: new THREE.Vector3(), hip: [new THREE.Vector3(), new THREE.Vector3()], knee: [new THREE.Vector3(), new THREE.Vector3()],
    toe: [new THREE.Vector3(), new THREE.Vector3()], shoulder: [new THREE.Vector3(), new THREE.Vector3()], elbow: [new THREE.Vector3(), new THREE.Vector3()],
    wrist: [new THREE.Vector3(), new THREE.Vector3()], tip: [new THREE.Vector3(), new THREE.Vector3()] } };
const _fq = new THREE.Quaternion(), _fe = new THREE.Euler(), _fc = new THREE.Vector3(), _fv = new THREE.Vector3(), _bq = new THREE.Quaternion();
const _bB = new THREE.Vector3(), _bv = new THREE.Vector3(), _bw = new THREE.Vector3(), _bt = new THREE.Vector3(), _bm = new THREE.Matrix4();
const flatDir = (yaw, v) => v.set(Math.sin(yaw), 0, -Math.cos(yaw));
// ### Where the ankle of a boot standing on the floor is, and how the boot is turned (into outPos and outQ): flat, or
// ### with the heel up (phi below 0: it rolls over the ball of the foot) or the toes up (above 0: it rocks on its heel).
// ### g is the spot on the floor under the ankle when the boot stands flat, yaw the way its toes point.
function footPose(g, yaw, phi, fy, outPos, outQ){
  const c = phi >= 0 ? HEEL : BALL;
  _fq.setFromEuler(_fe.set(STAND.tilt, -yaw, 0, 'YXZ'));
  _fc.copy(c).applyQuaternion(_fq).add(_fv.set(g.x, fy + STAND.ankle, g.z));   // that point of the sole stays on the floor
  outQ.setFromEuler(_fe.set(STAND.tilt + phi, -yaw, 0, 'YXZ'));
  return outPos.copy(c).applyQuaternion(outQ).negate().add(_fc);
}
// ### A boot never comes down inside the sinks, the bin, the toilet or a wall: its spot is pushed out of them.
function footClear(p){
  if (tunnelWalk){ p.x = clamp(p.x, TUN.x - TUN.r + .1, TUN.x + TUN.r - .1); return p; }
  const m = .1;
  for (const [x0, x1, z0, z1] of SOLID){
    if (p.x < x0 - m || p.x > x1 + m || p.z < z0 - m || p.z > z1 + m) continue;
    const out = [[x0 - m - p.x, 0], [x1 + m - p.x, 0], [0, z0 - m - p.z], [0, z1 + m - p.z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
    p.x += out[0]; p.z += out[1];
  }
  p.x = clamp(p.x, -W / 2 + m, W / 2 - m); p.z = clamp(p.z, -D / 2 + m, D / 2 - m);
  return p;
}
// ### Where a foot stands at rest: under its hip, the toes turned out a little.
function footHome(side, B, fwdL, rightL, out){ return footClear(out.copy(B).addScaledVector(fwdL, -.06).addScaledVector(rightL, side * STAND.apart).setY(0)); }
// ### Lifts a foot off the floor: it swings from where it is now (the ankle, the boot's turn) to a new spot.
function startSwing(f, n, rate){
  f.swing = { n, u: 0, rate, from: f.ankle.clone(), fromYaw: f.yaw, fromPhi: f.phi, to: f.g.clone(), toYaw: f.yaw, toPhi: 0, lift: .05 };
}
// ### Sets a foot down where its swing ends.
function landFoot(f){ const s = f.swing; f.g.copy(s.to); f.yaw = s.toYaw; f.phi = s.toPhi; f.swing = null; f.landed = clock; }

// ### Moves the feet and works out every joint of the body for this frame, then puts the body's parts where they go and
// ### turns the hands down to your sides as you look down. show says whether your hands are out (not in the endings).
function poseBody(dt, show){
  const Wk = WALKER, F = Wk.feet, J = Wk.J, fy = tunnelWalk ? TUN.floor : 0;
  // the eye where it would be without the bend of the neck (the body hangs from it), and the way you look
  const B = _bB.set(cam.pos.x + Math.cos(cam.yaw) * cam.sway, cam.pos.y + cam.bob, cam.pos.z + Math.sin(cam.yaw) * cam.sway);
  const view = wrapAngle(cam.yaw);
  // how fast you really move, from where you were a frame ago (pushing against a wall moves you nowhere)
  const jump = !Wk.at || Math.hypot(B.x - Wk.at.x, B.z - Wk.at.z) > .6 || Math.abs(B.y - Wk.at.y) > .8;
  if (!jump && dt > 0) Wk.vel.lerp(_bv.set((B.x - Wk.at.x) / dt, 0, (B.z - Wk.at.z) / dt), 1 - Math.exp(-dt * 12));
  if (jump) Wk.vel.set(0, 0, 0);
  Wk.at = (Wk.at || new THREE.Vector3()).copy(B);
  const speed = Math.hypot(Wk.vel.x, Wk.vel.z), crouch = clamp((1.56 - (B.y - fy)) / .5, 0, 1), kneel = smoothStep(.25, .85, crouch);
  const walking = crouch < .3 && speed > (Wk.walking ? .25 : .4), gait = clamp(speed / 1.2, 0, 1);
  // the legs face the way you walk (or step back), and turn after your head only when it turns far; the chest half way
  if (jump) Wk.legYaw = view;
  else if (walking){
    const travel = Math.atan2(Wk.vel.x, -Wk.vel.z), rel = wrapAngle(travel - view);
    Wk.legYaw += wrapAngle((Math.abs(rel) < 2 ? travel : travel + Math.PI) - Wk.legYaw) * (1 - Math.exp(-dt * 7));
    Wk.turning = false;
  } else {
    const off = wrapAngle(view - Wk.legYaw);
    if (Math.abs(off) > .75 || crouch > .3) Wk.turning = true;
    if (Wk.turning){ Wk.legYaw += off * (1 - Math.exp(-dt * 5)); if (Math.abs(off) < .06) Wk.turning = false; }
  }
  Wk.legYaw = wrapAngle(Wk.legYaw);
  Wk.torsoYaw = Wk.legYaw + wrapAngle(view - Wk.legYaw) * .55;
  const fwdL = flatDir(Wk.legYaw, new THREE.Vector3()), rightL = new THREE.Vector3(-fwdL.z, 0, fwdL.x);
  const fwdT = flatDir(Wk.torsoYaw, new THREE.Vector3()), rightT = new THREE.Vector3(-fwdT.z, 0, fwdT.x);
  const homes = [footHome(1, B, fwdL, rightL, new THREE.Vector3()), footHome(-1, B, fwdL, rightL, new THREE.Vector3())];
  const keys = ['r', 'l'], aim = i => Wk.legYaw + (i ? -1 : 1) * STAND.out;
  if (jump) keys.forEach((k, i) => { const f = F[k]; f.g.copy(homes[i]); f.yaw = aim(i); f.phi = 0; f.swing = null; });

  // ### The feet. Walking, the steps follow the footfalls you hear (one every 0.8 m): between two footfalls one boot
  // ### swings from behind you to a spot STAND.lead ahead of its hip and lands as the next one sounds; the right foot
  // ### swings while the right arm swings back. Standing, a foot that is out of place steps back under its hip.
  if (walking){
    if (!Wk.walking) cam.stride = Math.floor(cam.stride / .8) * .8;   // the first step starts now
    const steps = cam.stride / .8, n = Math.floor(steps), i = n % 2 ? 1 : 0, f = F[keys[i]], o = F[keys[1 - i]];
    if (o.swing) landFoot(o);
    if (!f.swing || f.swing.n !== n){ startSwing(f, n, 0); f.swing.lift = .07 + .03 * gait; }
    const s = f.swing, dir = _bv.copy(Wk.vel).normalize();
    s.u = steps - n;
    footClear(s.to.copy(homes[i]).addScaledVector(dir, STAND.lead * Math.max(.4, gait)));
    s.toYaw = aim(i); s.toPhi = .2 * gait;
  } else {
    for (const k of keys){ const s = F[k].swing; if (s && s.n >= 0){ s.n = -1; s.rate = 1 / .22; } }
    keys.forEach((k, i) => { const s = F[k].swing; if (s){ s.to.copy(homes[i]); s.toYaw = aim(i); s.toPhi = 0; s.lift = Math.min(s.lift, .05); } });
    if (!F.r.swing && !F.l.swing && crouch < .3){
      // the foot most out of place steps first, once the other has stood for a moment
      const err = keys.map((k, i) => F[k].g.distanceTo(homes[i]) + Math.abs(wrapAngle(F[k].yaw - aim(i))) * .25);
      const i = err[0] >= err[1] ? 0 : 1, f = F[keys[i]];
      if (err[i] > .07 && clock - F[keys[1 - i]].landed > .12) startSwing(f, -1, 1 / .32);
    }
  }
  Wk.walking = walking;

  // ### The trunk: the base of the neck under and a little behind the eyes, the hips below it; kneeling, it leans
  // ### forward over the hatch and the hips sink down onto the heels.
  const lean = crouch * .35;
  J.eye.copy(B);
  J.neck.copy(B).addScaledVector(fwdT, -.085 + crouch * .09); J.neck.y -= .19 + crouch * .03;
  J.hips.copy(J.neck).addScaledVector(fwdT, -STAND.torso * Math.sin(lean)); J.hips.y -= STAND.torso * Math.cos(lean);
  const knees = [], ankles = [], footQ = [];
  keys.forEach((k, i) => {
    const f = F[k], side = i ? -1 : 1, hip = J.hip[i].copy(J.hips).addScaledVector(rightL, side * STAND.hipW);
    // a swinging foot: from where it was lifted to where it lands, in an arc, its toes coming up to land on the heel
    if (f.swing){
      const s = f.swing;
      if (s.rate) s.u = Math.min(1, s.u + dt * s.rate);
      const e = smoothStep(0, 1, s.u);
      footPose(s.to, s.toYaw, s.toPhi, fy, _bt, _bq);
      f.ankle.lerpVectors(s.from, _bt, e); f.ankle.y += s.lift * Math.pow(Math.sin(Math.PI * s.u), .8);
      f.yaw = s.fromYaw + wrapAngle(s.toYaw - s.fromYaw) * e; f.phi = s.fromPhi + (s.toPhi - s.fromPhi) * smoothStep(.1, .9, s.u);
      f.q.setFromEuler(_fe.set(STAND.tilt + f.phi, -f.yaw, 0, 'YXZ'));
      if (s.rate && s.u >= 1) landFoot(f);
    } else {
      // a planted foot: after landing the toes slap down; walking, it rolls up onto its toes as it falls behind you
      const behind = -_bv.subVectors(f.g, hip).setY(0).dot(fwdL), lift = walking ? -clamp((behind - .1) / .32, 0, 1) * .7 : 0;
      f.phi += (lift - f.phi) * (1 - Math.exp(-dt * (f.phi > lift ? 9 : 14)));
      footPose(f.g, f.yaw, f.phi, fy, f.ankle, f.q);
      // far behind, it rolls further onto its toes rather than leave the floor
      for (let t = 0; t < 6 && f.phi <= 0 && f.ankle.distanceTo(hip) > LEG * 1.02; t++){ f.phi -= .1; footPose(f.g, f.yaw, f.phi, fy, f.ankle, f.q); }
    }
    // kneeling at the hatch you sit back on your heels: the boots lie on their insteps under you, soles up, and the
    // knees come forward onto the floor
    const ankle = f.ankle.clone(), q = f.q.clone();
    if (kneel > 0){
      _bt.copy(hip).addScaledVector(fwdL, -.05); _bt.y = fy + .09;
      ankle.lerp(_bt, kneel); q.slerp(_bq.setFromEuler(_fe.set(Math.PI, -Wk.legYaw, 0, 'YXZ')), kneel);
    }
    // the leg reaches its boot (a little stretch is allowed; further than that the boot hangs from the leg)
    const d = ankle.distanceTo(hip), k2 = clamp(d / LEG, 1, 1.035);
    if (d > LEG * k2) ankle.sub(hip).multiplyScalar(LEG * k2 / d).add(hip);
    knees.push(J.knee[i].copy(twoBone(hip, ankle, STAND.thigh * k2, STAND.shin * k2, _bw.copy(fwdL).addScaledVector(rightL, side * .12))));
    ankles.push(ankle); footQ.push(q);
    J.toe[i].copy(BALL).setY(-.09).setZ(-.21).applyQuaternion(q).add(ankle);
  });

  // ### The arms: from the shoulders they hang at your sides, swinging as you walk; kneeling, the hands rest on the thighs.
  const out = Math.sin(HANDS.reach * Math.PI) ** .7, down = smoothStep(-.42, -.95, cam.pitch);
  const bodyOn = show && HANDS.down < .5 && (cam.pitch < -.42 || kneel > .2);
  camera.updateMatrixWorld();
  _inv.copy(camera.matrixWorld).invert();
  camera.getWorldQuaternion(_qc).invert();
  keys.forEach((k, i) => {
    const h = HANDS[k], side = i ? -1 : 1, sh = J.shoulder[i].copy(J.neck).addScaledVector(rightT, side * .185); sh.y -= .035;
    const wrist = J.wrist[i].copy(sh).addScaledVector(fwdT, .03 + (h.swing || 0) * .18).addScaledVector(rightT, side * .035); wrist.y -= .555;
    if (kneel > 0) wrist.lerp(_bt.lerpVectors(J.hip[i], J.knee[i], .72).addScaledVector(rightL, side * .03).add(_bw.set(0, .07, 0)), kneel);
    const use = i ? 0 : out;   // using something, the right hand reaches out along your look, towards what you look at
    if (use > 0) wrist.lerp(_bt.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(.5).add(sh), use);
    const elbow = twoBone(sh, wrist, UPPER_ARM, FOREARM, _bw.copy(fwdT).multiplyScalar(-.8).addScaledVector(rightT, side * .35).add(_bv.set(0, -.2, 0)));
    // the hand turns from the bottom of the picture to your side: the forearm runs up to the elbow, the back of the hand
    // faces out and a little forward, the thumb forward
    const a = REDUCED ? 0 : Math.max(down, kneel);
    const sleeve = 1 + (FOREARM / .485 - 1) * a;
    if (a > .001){
      const wC = toCam(wrist), eC = toCam(elbow), upC = _bw.copy(rightT).multiplyScalar(side).addScaledVector(fwdT, .35).transformDirection(_inv);
      if (use > 0) upC.lerp(_bv.set(0, 1, 0), use).normalize();   // reaching, the back of the hand turns up
      _bq.setFromRotationMatrix(_bm.lookAt(eC, wC, upC));
      h.arm.position.lerp(wC, a); h.arm.quaternion.slerp(_bq, a);
    }
    if (a > .001 || Wk.sleeves) h.arm.children.forEach(o => { if (o.material === HAND_MAT.sleeve) o.scale.z = sleeve; });
    // where the arm really is now: the elbow at the end of the sleeve, the fingertips for the shadow
    J.elbow[i].set(0, 0, .485 * sleeve).applyQuaternion(h.arm.quaternion).add(h.arm.position).applyMatrix4(camera.matrixWorld);
    J.wrist[i].copy(h.arm.position).applyMatrix4(camera.matrixWorld);
    J.tip[i].set(0, 0, -.17).applyQuaternion(h.arm.quaternion).add(h.arm.position).applyMatrix4(camera.matrixWorld);
    if (bodyOn){
      if (!ME) ME = buildBody();
      placeLimb(ME.upper[i], J.elbow[i], sh);
      ME.shoulder[i].position.copy(toCam(sh)); ME.elbow[i].position.copy(toCam(J.elbow[i]));
      aimJoint(ME.shoulder[i], _bv.subVectors(J.elbow[i], sh));
      aimJoint(ME.elbow[i], _bv.subVectors(sh, J.elbow[i]).normalize().sub(_bw.subVectors(J.wrist[i], J.elbow[i]).normalize()));   // the stripes run round it
      ME.upper[i].visible = ME.shoulder[i].visible = ME.elbow[i].visible = a > .02;
      const hip = J.hip[i], knee = knees[i], ankle = ankles[i];
      placeLimb(ME.thigh[i], hip, knee); placeLimb(ME.shin[i], knee, ankle);
      ME.hip[i].position.copy(toCam(hip)); ME.knee[i].position.copy(toCam(knee));
      aimJoint(ME.hip[i], _bv.subVectors(knee, hip));
      aimJoint(ME.knee[i], _bv.subVectors(hip, knee).normalize().sub(_bw.subVectors(ankle, knee).normalize()));
      ME.boot[i].position.copy(toCam(ankle)); ME.boot[i].quaternion.copy(_qc).multiply(footQ[i]);
    }
  });
  Wk.sleeves = !REDUCED && Math.max(down, kneel) > .001;
  if (INMATE && !climb){
    INMATE.g.visible = bodyOn;
    if (bodyOn) poseInmate(INMATE, J.neck, J.hips, Wk.legYaw, knees, ankles, footQ);
  }
  if (ME && !climb){
    ME.g.visible = bodyOn; codeBody();
    if (bodyOn){
      ME.torso.position.copy(toCam(J.neck));
      ME.torso.quaternion.copy(_qc).multiply(_bq.setFromEuler(_fe.set(-lean, -Wk.torsoYaw, 0, 'YXZ')));
      fitShirt(STAND.torso, 1 + (REDUCED ? 0 : .012 * Math.sin(clock * 1.6)));
    }
  }
  SHADOW.update(J, ankles, footQ, fy, show && cam.pitch < -.08);   // looking higher, the floor it lies on is out of sight
}

// ### Your shadow on the floor, thrown by the lamps: each part of you (legs, boots, trunk, head, arms and hands) is
// ### carried from the lamp straight down onto the floor, so the shadow stretches away from the light, the further the
// ### higher the part. It is painted into a picture of 4 x 4 m round you and laid on the floor (a soft dark layer), the
// ### parts high above the floor softer and paler, and darkest round the soles of your boots. The washroom's tube throws
// ### it, in the stall the stall's lamp (more faintly the tube too); it fades with the distance from the lamp and dims when
// ### the tube flickers. In the tunnel the bulbs hang at head height, so only the dark round your soles is on the floor.
const SHADOW = (() => {
  const N = 256, SIZE = 4, PX = N / SIZE;
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const part = document.createElement('canvas'); part.width = part.height = N; const pg = part.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .75, alphaMap: tex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.visible = false; mesh.renderOrder = 2; scene.add(mesh);
  const at = new THREE.Vector3(), L = new THREE.Vector3();
  let fy = 0, last = -1;
  // a point of you carried from the lamp onto the floor, in the picture's pixels; z is how much the shadow grows there
  const proj = (P, out) => { const t = (L.y - fy) / Math.max(.05, L.y - P.y); out.x = (L.x + (P.x - L.x) * t - at.x) * PX + N / 2; out.y = (L.z + (P.z - L.z) * t - at.z) * PX + N / 2; out.z = t; return out; };
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  // a part from A to B, r thick; the further its shadow is thrown (high up, near the lamp's height), the fainter it is
  const limb = (A, B, r) => {
    proj(A, pa); proj(B, pb);
    const far = Math.max(pa.z, pb.z); if (far > 4) return;
    pg.globalAlpha = clamp((4 - far) / 1.5, 0, 1); pg.lineWidth = r * (pa.z + pb.z) * PX; pg.beginPath(); pg.moveTo(pa.x, pa.y); pg.lineTo(pb.x, pb.y); pg.stroke();
  };
  // one light's shadow of some parts, blurred by blur pixels and as dark as k (0 to 1)
  const cast = (draw, blur, k) => {
    pg.clearRect(0, 0, N, N); pg.strokeStyle = pg.fillStyle = '#fff'; pg.lineCap = 'round'; draw(); pg.globalAlpha = 1;
    g.shadowColor = `rgba(255,255,255,${k})`; g.shadowBlur = blur; g.shadowOffsetX = N; g.drawImage(part, -N, 0); g.shadowColor = 'transparent';
  };
  const lamps = B => {
    if (tunnelWalk) return [];   // the old bulbs down there hang at head height: their shadows of you run up the walls
    const inStall = B.x > SX0 + .05 && B.z < SZ1, main = mainLight.intensity / LIGHTS.main;
    const dm = Math.hypot(B.x - mainLight.position.x, B.z - mainLight.position.z), list = [[mainLight.position, .55 * main * clamp(1.3 - dm / 4.2, 0, 1) * (inStall ? .3 : 1)]];
    if (inStall) list.push([stallLight.position, .5 * stallLight.intensity / LIGHTS.stallI]);
    return list;
  };
  return {
    mesh,
    update(J, ankles, footQ, floor, on){
      mesh.visible = on;
      if (!on || clock - last < 1 / 30) return;
      last = clock; fy = floor; at.copy(J.eye).setY(fy);
      mesh.position.set(at.x, fy + .006, at.z);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.globalCompositeOperation = 'lighten';
      for (const [pos, k] of lamps(J.eye)){
        if (k < .02) continue;
        L.copy(pos);
        // the legs and boots, near the floor: sharper and darker
        cast(() => { for (let i = 0; i < 2; i++){ limb(J.hip[i], J.knee[i], .075); limb(J.knee[i], ankles[i], .055); limb(ankles[i], J.toe[i], .045); } }, 3, k);
        // the trunk, the arms and the head, high above it: softer and paler
        cast(() => {
          limb(J.neck, J.hips, .16); limb(J.neck, _bv.copy(J.eye).add(_bw.set(0, .04, 0)), .085);
          for (let i = 0; i < 2; i++){ limb(J.shoulder[i], J.elbow[i], .05); limb(J.elbow[i], J.wrist[i], .042); limb(J.wrist[i], J.tip[i], .04); }
        }, 9, k * .8);
      }
      // where the soles stand on the floor the shadow is darkest
      for (let i = 0; i < 2; i++){
        const x = (ankles[i].x - at.x) * PX + N / 2, y = (ankles[i].z - at.z) * PX + N / 2, lift = clamp((ankles[i].y - fy - STAND.ankle) / .08, 0, 1);
        const d = _bv.set(0, 0, -1).applyQuaternion(footQ[i]);
        g.save(); g.translate(x + d.x * .08 * PX, y + d.z * .08 * PX); g.rotate(Math.atan2(d.z, d.x)); g.scale(1, .42);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, .19 * PX); gr.addColorStop(0, `rgba(255,255,255,${.6 * (1 - lift)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(-.2 * PX, -.2 * PX, .4 * PX, .4 * PX); g.restore();
      }
      g.globalCompositeOperation = 'source-over';
      tex.needsUpdate = true;
    }
  };
})();

// ---------- Loop ----------
// ### Runs once per screen refresh: the clock (rules.tick), then animations (camera, steam, guard, tile, hatch), then the
// ### markers and the picture. The clock only runs while playing, not paused and not in the briefing.
let clock = 0, last = performance.now(), guardShow = 0, tileVel = 0;
// ### Hale behind the window of the door. When something calls him (he has just shut the door on you, you rattle it, the
// ### time runs short, a wrong code) his dark figure is at the glass, backlit by the corridor, for as long as guardShow
// ### lasts. Then he turns and walks off down the corridor: the figure bobs with his steps and grows smaller towards the
// ### far end, where it fades into the light and is gone. Called back while he walks off, he comes back to the window.
// ### With reduced motion he simply fades where he stands. The figure is guardTex; only the part of it that fits the
// ### window is shown, k metres of glass to a metre of him at the window (his shoulders at ay above the window's bottom
// ### edge), and it shrinks towards the far end of the corridor at (vx, vy), the height of your eyes. All of it moves
// ### the picture on the glass, so walking off costs no more than standing there.
const GUARD = { k: .58, ay: .074, vx: .03, vy: .08, gone: 4.5, steps: 1.8 };
let guardAway = GUARD.gone, guardIn = 0;
function updateGuard(dt){
  const here = guardShow > 0 || S.ending === 'B';
  if (here) guardAway = guardAway >= GUARD.gone ? 0 : Math.max(0, guardAway - dt * 2);
  else guardAway = Math.min(GUARD.gone, guardAway + dt);
  guardIn = guardAway >= GUARD.gone ? 0 : Math.min(1, guardIn + dt * 3);
  const a = REDUCED ? 0 : guardAway, s = 1 / (1 + a), fade = REDUCED ? clamp(1 - guardAway / .8, 0, 1) : 1 - clamp((a - 1.6) / (GUARD.gone - 1.6), 0, 1);
  M.guard.opacity = .95 * guardIn * fade * fade;
  if (!M.guard.opacity) return;
  // his head rises and sinks with every step, and his body sways a little from one foot to the other
  const stride = Math.sin(a * Math.PI * GUARD.steps), bob = .025 * Math.abs(stride), sway = .012 * stride;
  guardTex.repeat.set(.3 / (s * GUARD.k * .68), .34 / (s * GUARD.k * 2.04));
  guardTex.offset.set((((-.15 - GUARD.vx) / s + GUARD.vx) / GUARD.k - sway + .34) / .68, ((GUARD.vy - GUARD.vy / s - GUARD.ay) / GUARD.k + 1.5 - bob) / 2.04);
}
// ### The room loop each frame: clock, camera, markers and drawing.
function frame(now){
  requestAnimationFrame(frame);
  const elapsed = clamp((now - last) / 1000, 0, 1), dt = Math.min(elapsed, .05); last = now; clock += dt;
  // the ending runs in real time even on a slow computer (in larger steps), so the card never waits for it
  endStep = Math.min(elapsed, .25);
  if (!paused && S.scene !== 'intro' && !S.ending){
    const r = R.tick(S, elapsed);
    if (r.state !== S){
      S = r.state;
      if (r.message){ if (!S.ending) say(r.message, 'warn'); cue(r.cue); if (r.cue === 'warn' || r.cue === 'rattle') guardShow = 3; }
      if (S.ending === 'B'){ save(); renderHud(); renderHotspots(); endingB(); }
      else if ((saveTimer += dt) > 3){ save(); saveTimer = 0; }
      renderClock();
    }
  }
  updateCamera(dt);
  updateHands(dt);
  updateCine(dt);
  if (shake > 0 && !REDUCED){ shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - .5) * shake * .05; camera.position.y += (Math.random() - .5) * shake * .05; }
  // steam on the mirror and rising from the hot sink
  const st = S.steam ? 1 : 0;
  M.steam.opacity += (st * .92 - M.steam.opacity) * Math.min(1, dt * .45);
  if (waterGain) waterGain.gain.value += ((S.steam && !paused && !tapBuf ? .05 : 0) - waterGain.gain.value) * Math.min(1, dt * 4);
  if (ac){ updateTap(dt); updateApiVent(); }
  tapStream.update(dt, clock);
  steamPuffs.forEach(s => { s.userData.t = (s.userData.t + dt * .25) % 1; const t = s.userData.t; s.position.set(-3.73 + Math.sin(t * 9 + s.id) * .05, .9 + t * 1.1, -.65 + Math.cos(t * 7 + s.id) * .08); s.scale.setScalar(.15 + t * .5); s.material.opacity = S.steam ? Math.sin(t * Math.PI) * .35 : Math.max(0, s.material.opacity - dt); s.visible = s.material.opacity > .003; });
  // the guard's dark figure in the window, and how he walks off
  guardShow = Math.max(0, guardShow - dt);
  updateGuard(dt);
  // the tile falls off the wall when pried
  if (tile.userData.fall !== undefined && tile.position.y > .01){
    tileVel += dt * 4; tile.position.y = Math.max(.01, tile.position.y - tileVel * dt); tile.position.z = Math.min(-2.75, tile.position.z + dt * .5);
    tile.rotation.x = Math.min(Math.PI / 2, tile.rotation.x + dt * 5);
    if (tile.position.y <= .01) tileVel = 0;
    shadowsMoved();
  }
  // the hatch opens, the bulbs below come on (old ones, they flicker a little) and you climb down
  if (hatchAnim >= 0){
    hatchAnim += endStep;
    lidPivot.rotation.x = -Math.min(1.9, hatchAnim * 1.6);
    if (hatchAnim < 1.3) shadowsMoved();
    const flick = .92 + .08 * Math.sin(clock * 23) * Math.sin(clock * 7.3);
    tunnelLight.intensity = Math.min(2.6, hatchAnim * 1.6) * flick; tunnelLight2.intensity = Math.min(1.2, hatchAnim * .7);
    if (hatchAnim > 1.1 && !climb && !tunnelWalk && cam.t >= 1) startClimb();
    if (climb && climb.t >= CLIMB.end) startTunnelWalk();   // down: from here on you walk yourself
    if (tunnelWalk) updateTunnelWalk();
    // the air down there is thick with dust, and the night outside the door tints it cold
    const under = clamp(-camera.position.y / 1.5, 0, 1);
    scene.fog.density = .03 + under * .07; scene.fog.color.copy(FOG_ROOM).lerp(FOG_TUNNEL, under).lerp(FOG_NIGHT, nightLight.intensity * .1);
  }
  updateDust(dt, clock);
  updateLights(dt);
  if (doorFlash > 0){ doorFlash = Math.max(0, doorFlash - dt * .5); windowLight.intensity = .9 + doorFlash * 8; }
  // dripping tap
  if (ac && !paused && (dripIn -= dt) < 0){ dripIn = 2.5 + Math.random() * 5; tone(1200 + Math.random() * 500, .08, 'sine', .025, 500); }
  if ((sayTimer -= dt) <= 0) $('say').classList.remove('show');
  M.led.emissiveIntensity = (clock % 2) < .12 ? 3 : .15;   // the camera's red light
  if (pendingHover){ hover(pendingHover); pendingHover = null; }
  updateMarkers();
  if (shadowFrames > 0){ renderer.shadowMap.needsUpdate = true; shadowFrames--; }
  // while a mini game runs the room behind the card stands still, so it is not drawn again and the game runs smoothly;
  // a new size is applied just before drawing: resizing after it would clear the picture and show a black frame
  if (!mini){
    if (sizeDirty){ sizeDirty = false; renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); WATER.resize(); MIRROR.resize(); }
    // all of the room has arrived: the briefing scene is made ready (see warmOpening)
    const warmed = !openingWarm && !assetsBusy ? warmOpening() : null;
    camera.updateMatrixWorld();
    WATER.update(clock, dt);
    MIRROR.update(clock);
    renderer.render(scene, camera);
    drawHands();
    if (warmed) warmed();
  }
  adaptResolution(elapsed);
}

// ### The resolution follows the frame rate: when frames take too long the picture is drawn with fewer pixels, and when
// ### there is room to spare for a while it goes back up, never above the screen's own pixel density. It starts at 1.5x
// ### at most (sharp enough, and a quarter of the pixels of 2x), and each step back up waits longer than the last, so the
// ### sharpness never pumps up and down.
const PR_MAX = Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2), PR_MIN = Math.min(PR_MAX, .75);
let pixelRatio = Math.min(PR_MAX, 1.5), perfT = 0, perfN = 0, perfGood = 0, perfWait = 4, sizeDirty = false;
renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); WATER.resize(); MIRROR.resize();
function adaptResolution(elapsed){
  if (elapsed > .25 || document.hidden || !overlay.hidden) return;   // a hitch (a tab switch, a card) says nothing about the graphics card
  perfT += elapsed; perfN++;
  if (perfT < 1) return;
  const ft = perfT / perfN; perfT = perfN = 0;
  let next = pixelRatio;
  if (ft > 1 / 45){ next = Math.max(PR_MIN, pixelRatio - .25); perfGood = 0; perfWait = Math.min(60, perfWait * 2); }
  else if (ft < 1 / 57 && ++perfGood >= perfWait){ next = Math.min(PR_MAX, pixelRatio + .25); perfGood = 0; }
  if (next !== pixelRatio){ pixelRatio = next; sizeDirty = true; }
}
addEventListener('resize', () => { sizeDirty = true; });

// ---------- Start ----------
// ### Restores a saved game if there is a valid one, then starts the loop.
if (saved && R.canContinue(saved)){
  S = saved; goView(S.scene, .01); syncWorld(); renderHud(); renderHotspots(); paused = true; showContinue();
} else { syncWorld(); renderHud(); renderHotspots(); showBrief(0); }
renderer.compile(scene, camera);
requestAnimationFrame(frame);
})();
