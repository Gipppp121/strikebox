// Strikebox client: three.js first-person team deathmatch.
import * as THREE from 'three';
import { MAP, P, TEAMS, collide, groundAt, rayWorld, hitPlayer } from './shared.js';
import * as sfx from './sfx.js';

// ---------- device ----------
const TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const EMBED = window.top !== window.self;
const LOW = TOUCH || Math.min(innerWidth, innerHeight) < 560;
document.body.classList.toggle('touch', TOUCH); document.body.classList.toggle('embed', EMBED);

const $ = id => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(LOW ? 1.25 : 2, devicePixelRatio)); renderer.shadowMap.enabled = !LOW; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd3e6); scene.fog = new THREE.Fog(0xbfd3e6, LOW ? 30 : 40, LOW ? 80 : 110);
const camera = new THREE.PerspectiveCamera(78, 1, .05, 200); camera.rotation.order = 'YXZ'; scene.add(camera);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- textures ----------
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(...rep); t.anisotropy = 4; return t; }
const noise = (g, w, h, a, col) => { for (let i = 0; i < w * h / 6; i++) { g.fillStyle = col(Math.random()); g.globalAlpha = a; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } g.globalAlpha = 1; };
const sandTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c8b089'; g.fillRect(0, 0, w, h); noise(g, w, h, .25, r => r < .5 ? '#b49a72' : '#d9c39c'); g.strokeStyle = 'rgba(90,70,40,.18)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h); }, [32, 22]);
const wallTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d6c29a'; g.fillRect(0, 0, w, h); noise(g, w, h, .3, r => r < .5 ? '#c3ad83' : '#e4d3b0'); g.strokeStyle = 'rgba(120,95,60,.35)'; g.lineWidth = 2; for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 32) % 2 ? 0 : 32; x < w; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } } });
const crateTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#9a6b3c'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { g.fillStyle = y % 32 ? '#8a5d33' : '#a57445'; g.fillRect(0, y, w, 15) } g.strokeStyle = '#5a3a1c'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.stroke(); });
const lowTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#8f9499'; g.fillRect(0, 0, w, h); noise(g, w, h, .35, r => r < .5 ? '#7c8187' : '#a4a9ae'); });

// ---------- world ----------
scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x8a7350, .9));
const sun = new THREE.DirectionalLight(0xfff1d8, 1.6); sun.position.set(-20, 40, 14); sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 512 : 2048, LOW ? 512 : 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 30, bottom: -30, near: 1, far: 100 }); scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w + 4, MAP.d + 4), new THREE.MeshLambertMaterial({ map: sandTex })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
for (const [cx, cz, w, d, h, kind] of MAP.boxes) {
  const tex = (kind === 'crate' ? crateTex : kind === 'low' ? lowTex : wallTex).clone(); tex.needsUpdate = true;
  if (kind === 'wall') tex.repeat.set(Math.max(w, d) / 4, h / 4); else tex.repeat.set(1, 1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex }));
  m.position.set(cx, h / 2, cz); m.castShadow = m.receiveShadow = true; scene.add(m);
}
// spawn pads
for (const [team, list] of Object.entries(MAP.spawns)) { const c = TEAMS[team].color; const pad = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .12 })); pad.rotation.x = -Math.PI / 2; pad.position.set(team === 'ct' ? -28.5 : 28.5, .01, 0); scene.add(pad); }

// ---------- soldier models ----------
function soldier(team) {
  const g = new THREE.Group(); const col = TEAMS[team].color;
  const cloth = new THREE.MeshLambertMaterial({ color: col }), dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 }), skin = new THREE.MeshLambertMaterial({ color: 0xd9a77e });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const legL = add(new THREE.BoxGeometry(.2, .78, .24), dark, -.13, .39, 0), legR = add(new THREE.BoxGeometry(.2, .78, .24), dark, .13, .39, 0);
  add(new THREE.BoxGeometry(.56, .66, .32), cloth, 0, 1.11, 0);
  const head = add(new THREE.SphereGeometry(.2, 14, 10), skin, 0, 1.62, 0);
  add(new THREE.CylinderGeometry(.22, .22, .12, 14), cloth, 0, 1.76, 0); // helmet band
  const gun = add(new THREE.BoxGeometry(.08, .1, .62), dark, .2, 1.18, -.34);
  g.userData = { legL, legR, head, gun };
  return g;
}
function nameTag(text, css) { const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.font = 'bold 26px monospace'; x.textAlign = 'center'; x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(20, 6, 216, 36); x.fillStyle = css; x.fillText(text, 128, 33); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); s.scale.set(1.3, .25, 1); s.position.y = 2.15; return s; }

// ---------- first-person gun ----------
const vm = new THREE.Group(); camera.add(vm);
{ const dark = new THREE.MeshLambertMaterial({ color: 0x24272c }), wood = new THREE.MeshLambertMaterial({ color: 0x6b4428 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); vm.add(m); return m; };
  add(new THREE.BoxGeometry(.07, .09, .56), dark, 0, 0, -.2); add(new THREE.BoxGeometry(.05, .05, .3), dark, 0, .02, -.6);
  add(new THREE.BoxGeometry(.06, .16, .08), dark, 0, -.11, -.12); add(new THREE.BoxGeometry(.06, .12, .18), wood, 0, -.03, .14);
  add(new THREE.BoxGeometry(.05, .14, .07), dark, 0, -.12, -.3); }
vm.scale.setScalar(.5); vm.position.set(.2, -.17, -.32);
const flash = new THREE.PointLight(0xffc070, 0, 6); camera.add(flash); flash.position.set(.22, -.12, -1);
const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); flashMesh.position.set(0, .02, -.8); vm.add(flashMesh); flashMesh.visible = false;

// ---------- net ----------
let ws, myId = 0, myTeam = 'ct', myRoom = 0, joined = false, lastJoin = null;
const others = new Map(); // id -> {mesh, tag, buf:[{t,x,y,z,yaw,alive}], team}
let snapPlayers = [], score = { ct: 0, t: 0 };
const me = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, alive: false, hp: 100, ammo: P.mag, reload: 0, respawn: 0, onGround: true };
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { if (lastJoin) send(lastJoin); $('net').style.display = 'none'; };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'welcome') { myId = m.id; myTeam = m.team; myRoom = m.room; joined = true; if (lastJoin) lastJoin.team = m.team; } else if (m.t === 'snap') onSnap(m); };
  ws.onclose = e => { $('net').style.display = 'block'; $('net').textContent = e.reason === 'server full' ? 'server is full, retrying…' : 'reconnecting…'; setTimeout(connect, e.reason === 'server full' ? 5000 : 1500); };
}
connect();
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function onSnap(m) {
  score = m.score; snapPlayers = m.ps; const t = performance.now() / 1000; const seen = new Set();
  let nct = 0, nt = 0, hasBots = false;
  for (const [id, name, team, x, y, z, yaw, pitch, hp, alive, kills, deaths, ammo, reload, respawn, bot] of m.ps) {
    if (!bot) team === 'ct' ? nct++ : nt++; else hasBots = true;
    if (id === myId) {
      const wasAlive = me.alive; if (alive && reload > 0 && me.reload <= 0) sfx.reload(); me.hp = hp; me.alive = !!alive; me.ammo = ammo; me.reload = reload; me.respawn = respawn; myTeam = team;
      if (!wasAlive && alive) { me.x = x; me.y = y; me.z = z; me.yaw = yaw; me.pitch = 0; me.vy = 0; sfx.spawn(); }
      continue;
    }
    seen.add(id);
    let o = others.get(id);
    if (!o || o.team !== team) { if (o) scene.remove(o.mesh); const mesh = soldier(team); mesh.add(nameTag(name, TEAMS[team].css)); scene.add(mesh); o = { mesh, team, buf: [], name }; others.set(id, o); }
    o.buf.push({ t, x, y, z, yaw, alive }); if (o.buf.length > 6) o.buf.shift();
  }
  for (const [id, o] of others) if (!seen.has(id)) { scene.remove(o.mesh); others.delete(id); }
  const pl = n => `${n} player${n === 1 ? '' : 's'}${hasBots ? ' + bots' : ''}`; $('nct').textContent = pl(nct); $('nt').textContent = pl(nt);
  for (const ev of m.ev) onEvent(ev);
}
function spatial(x, z) { const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz) || 1; const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw); return { vol: Math.max(.05, Math.min(1, 7 / d)) * .8, pan: (dx * rx + dz * rz) / d * .8, far: d > 25 ? 1 : 0 }; }
function onEvent(ev) {
  if (ev.e === 'shot' && ev.id !== myId) { tracer(ev.o, ev.to, 0xffe2a0); const s = spatial(ev.o[0], ev.o[2]); sfx.shot(s.vol, s.pan, s.far); }
  if (ev.e === 'hit' && ev.by === myId) { hitm(ev.head); sfx.hit(ev.head); }
  if (ev.e === 'hit' && ev.id === myId) { dmgFlash = 1; sfx.hurt(); }
  if (ev.e === 'kill') { feed(ev); if (ev.v === myId) { killer = ev.kn; sfx.death(); } if (ev.k === myId) sfx.kill(); }
}
let killer = '';

// ---------- effects ----------
const tracers = [];
function tracer(a, b, col) { const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]); const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .9 })); scene.add(l); tracers.push({ l, t: .09 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0x333333 })); s.position.set(...b); scene.add(s); tracers.push({ l: s, t: 4 }); }
let hitT = 0, dmgFlash = 0;
function hitm(head) { hitT = .25; $('hitm').querySelectorAll('i').forEach(i => i.style.background = head ? '#ff5050' : '#fff'); }
function feed(ev) { const d = document.createElement('div'); d.innerHTML = `<b style="color:${TEAMS[ev.kt].css}">${esc(ev.kn)}</b> ${ev.head ? '◎' : '▸'} <b style="color:${TEAMS[ev.vt].css}">${esc(ev.vn)}</b>`; $('feed').prepend(d); setTimeout(() => d.remove(), 5000); while ($('feed').children.length > 5) $('feed').lastChild.remove(); }
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- input ----------
const keys = {}; let mouseDown = false, locked = false, dragLook = false, lastShot = 0, recoil = 0, spreadK = 0;
const SENS = .0022, TSENS = .0058;
function look(dx, dy, k) { if (!me.alive) return; me.yaw -= dx * k; me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - dy * k)); }
function doReload() { if (me.ammo < P.mag && me.reload <= 0) send({ t: 'reload' }); }
function switchTeam() { if (joined) send({ t: 'team', team: myTeam === 'ct' ? 't' : 'ct' }); }
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Tab') { e.preventDefault(); $('board').style.display = 'block'; } if (e.code === 'KeyR') doReload(); if (e.code === 'KeyM') switchTeam(); if (e.code === 'KeyN') toggleMute(); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') $('board').style.display = 'none'; });
// pointer lock, with a drag-to-look fallback when the page runs inside an iframe that blocks it
function tryLock() { if (TOUCH || dragLook) return; try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => { dragLook = true; showClick(); }); } catch { dragLook = true; } }
document.addEventListener('pointerlockerror', () => { dragLook = true; showClick(); });
function showClick() { $('click').style.display = !TOUCH && !locked && joined && !dragLook ? 'flex' : 'none'; $('hint2').style.display = dragLook && joined && !TOUCH ? 'block' : 'none'; }
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; showClick(); });
renderer.domElement.addEventListener('mousedown', e => { if (!joined || TOUCH) return; sfx.initAudio(); if (!locked && !dragLook) { tryLock(); return; } if (e.button === 0) mouseDown = true; });
$('click').addEventListener('mousedown', () => { sfx.initAudio(); tryLock(); });
addEventListener('mouseup', () => mouseDown = false);
addEventListener('mousemove', e => { if (TOUCH) return; if (locked) look(e.movementX, e.movementY, SENS); else if (dragLook && (e.buttons & 1)) look(e.movementX, e.movementY, SENS * 1.4); });
document.querySelectorAll('#menu button').forEach(b => b.addEventListener('click', () => {
  sfx.initAudio();
  const name = $('name').value.trim() || 'player' + Math.floor(Math.random() * 900 + 100);
  lastJoin = { t: 'join', name, team: b.dataset.team }; send(lastJoin); $('menu').style.display = 'none'; tryLock(); setTimeout(showClick, 300);
}));
// ---------- touch controls ----------
const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 }, lookT = { id: null, x: 0, y: 0 };
let fireTouch = null;
if (TOUCH) {
  const zone = $('touch');
  const knob = $('knob'), base = $('stick');
  zone.addEventListener('touchstart', e => { e.preventDefault(); sfx.initAudio();
    for (const tch of e.changedTouches) {
      const tgt = tch.target.closest('[data-btn]');
      if (tgt) { const b = tgt.dataset.btn; tgt.classList.add('on');
        if (b === 'fire') { fireTouch = tch.identifier; mouseDown = true; lookT.id = tch.identifier; lookT.x = tch.clientX; lookT.y = tch.clientY; }
        else if (b === 'jump') keys.Space = true; else if (b === 'reload') doReload(); else if (b === 'team') switchTeam(); else if (b === 'board') $('board').style.display = $('board').style.display === 'block' ? 'none' : 'block'; else if (b === 'mute') toggleMute();
        tch.btn = b; continue; }
      if (tch.clientX < innerWidth * .45 && stick.id === null) { stick.id = tch.identifier; stick.x0 = stick.x = tch.clientX; stick.y0 = stick.y = tch.clientY; base.style.display = 'block'; base.style.left = (tch.clientX - 55) + 'px'; base.style.top = (tch.clientY - 55) + 'px'; knob.style.transform = 'translate(0,0)'; }
      else if (lookT.id === null) { lookT.id = tch.identifier; lookT.x = tch.clientX; lookT.y = tch.clientY; }
    } }, { passive: false });
  zone.addEventListener('touchmove', e => { e.preventDefault();
    for (const tch of e.changedTouches) {
      if (tch.identifier === stick.id) { stick.x = tch.clientX; stick.y = tch.clientY; let dx = stick.x - stick.x0, dy = stick.y - stick.y0; const d = Math.hypot(dx, dy), m = 45; if (d > m) { dx = dx / d * m; dy = dy / d * m; } knob.style.transform = `translate(${dx}px,${dy}px)`; }
      if (tch.identifier === lookT.id) { look(tch.clientX - lookT.x, tch.clientY - lookT.y, TSENS); lookT.x = tch.clientX; lookT.y = tch.clientY; }
    } }, { passive: false });
  const end = e => { for (const tch of e.changedTouches) {
      if (tch.identifier === stick.id) { stick.id = null; base.style.display = 'none'; }
      if (tch.identifier === lookT.id) lookT.id = null;
      if (tch.identifier === fireTouch) { fireTouch = null; mouseDown = false; }
    }
    zone.querySelectorAll('[data-btn].on').forEach(b => { if (b.dataset.btn !== 'fire' || fireTouch === null) b.classList.remove('on'); });
    if (![...e.touches].some(t => t.target.closest && t.target.closest('[data-btn="jump"]'))) keys.Space = false; };
  zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
}
function toggleMute() { sfx.setMuted(!sfx.isMuted()); document.querySelectorAll('[data-btn="mute"],#mute').forEach(b => b.textContent = sfx.isMuted() ? '🔇' : '🔊'); }
$('mute').addEventListener('click', () => { sfx.initAudio(); toggleMute(); });

// test hook for automated runs
window.__sb = { me, send, TOUCH, LOW, stick, setKeys: k => Object.assign(keys, k), setMouse: v => { mouseDown = v; }, forceLock: () => { locked = true; }, join: (name, team) => { lastJoin = { t: 'join', name, team }; send(lastJoin); $('menu').style.display = 'none'; } };

// ---------- shooting ----------
function fire(t) {
  if (!me.alive || me.reload > 0 || t - lastShot < P.rate) return;
  lastShot = t;
  const moving = (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || stick.id !== null) ? 1 : 0;
  const spread = .004 + spreadK * .012 + moving * .012 + (me.onGround ? 0 : .05);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(me.pitch + (Math.random() - .5) * spread * 2, me.yaw + (Math.random() - .5) * spread * 2, 0, 'YXZ'));
  const o = [me.x, me.y + P.eye, me.z], d = [dir.x, dir.y, dir.z];
  send({ t: 'shot', o, d }); sfx.shot(.9, 0, 0);
  // local tracer to whatever we would hit
  let end = Math.min(rayWorld(o, d), 80);
  for (const [, ot] of others) { const b = ot.cur; if (!b || !b.alive || ot.team === myTeam) continue; const h = hitPlayer(o, d, b); if (h && h.t < end) end = h.t; }
  const gunTip = new THREE.Vector3(.2, -.17, -.75).applyMatrix4(camera.matrixWorld);
  tracer([gunTip.x, gunTip.y, gunTip.z], [o[0] + d[0] * end, o[1] + d[1] * end, o[2] + d[2] * end], 0xfff0b0);
  recoil = Math.min(recoil + .5, 1.6); spreadK = Math.min(1, spreadK + .18); me.pitch = Math.min(1.45, me.pitch + .011);
  flash.intensity = 3; flashMesh.visible = true; setTimeout(() => { flash.intensity = 0; flashMesh.visible = false; }, 45);
}

// ---------- loop ----------
let lastT = performance.now() / 1000, sendT = 0, bob = 0;
function frame() {
  requestAnimationFrame(frame);
  const t = performance.now() / 1000, dt = Math.min(.05, t - lastT); lastT = t;
  if (joined && me.alive) {
    // movement
    let f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), amt = 1;
    if (stick.id !== null) { const dx = stick.x - stick.x0, dy = stick.y - stick.y0, d = Math.hypot(dx, dy); if (d > 8) { f = -dy / d; s = dx / d; amt = Math.min(1, d / 45); } }
    let mx = -Math.sin(me.yaw) * f + Math.cos(me.yaw) * s, mz = -Math.cos(me.yaw) * f - Math.sin(me.yaw) * s; const ml = Math.hypot(mx, mz) || 1;
    const sp = P.speed * (keys.ShiftLeft ? .5 : 1) * amt * dt;
    if (f || s) { [me.x, me.z] = collide(me.x + mx / ml * sp, me.z + mz / ml * sp, P.r, me.y); const pb = bob; bob += dt * 9 * amt; if (me.onGround && Math.floor(pb / Math.PI) !== Math.floor(bob / Math.PI) && !keys.ShiftLeft) sfx.step(); }
    me.x = Math.max(-31.5, Math.min(31.5, me.x)); me.z = Math.max(-21.5, Math.min(21.5, me.z));
    const gy = groundAt(me.x, me.z, P.r, me.y + .01);
    if (keys.Space && me.onGround) { me.vy = P.jump; me.onGround = false; }
    me.vy -= P.g * dt; me.y += me.vy * dt; if (me.y <= gy) { if (me.vy < -4) sfx.land(); me.y = gy; me.vy = 0; me.onGround = true; } else me.onGround = me.y - gy < .02;
    if (mouseDown) fire(t);
    if (t - sendT > .05) { sendT = t; send({ t: 'st', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(4), pitch: +me.pitch.toFixed(4) }); }
  }
  recoil *= Math.pow(.002, dt); spreadK *= Math.pow(.05, dt);
  if (!joined) { camera.position.set(Math.sin(t * .08) * 34, 17, Math.cos(t * .08) * 26); camera.lookAt(0, 0, 0); }
  else { camera.position.set(me.x, me.y + P.eye + Math.sin(bob) * .03, me.z); camera.rotation.set(me.pitch, me.yaw, 0); }
  vm.position.set(.2 + Math.sin(bob * .5) * .008, -.17 + Math.abs(Math.cos(bob * .5)) * .006, -.32 + recoil * .03); vm.rotation.x = recoil * .08;
  vm.visible = me.alive && joined;
  if (me.reload > 0) { vm.rotation.x = -.6; vm.position.y = -.28; }
  // others: interpolate 120 ms behind
  const rt = t - .12;
  for (const [, o] of others) {
    const b = o.buf; if (!b.length) continue;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
    const u = c.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (c.t - a.t))) : 1;
    let dy = c.yaw - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    const cur = { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u, z: a.z + (c.z - a.z) * u, yaw: a.yaw + dy * u, alive: c.alive };
    const moving = Math.hypot(c.x - a.x, c.z - a.z) > .02;
    o.mesh.position.set(cur.x, cur.y, cur.z); o.mesh.rotation.y = cur.yaw; o.mesh.visible = !!cur.alive; o.cur = cur;
    o.walk = (o.walk || 0) + (moving ? dt * 10 : 0); o.mesh.userData.legL.rotation.x = Math.sin(o.walk) * .5; o.mesh.userData.legR.rotation.x = -Math.sin(o.walk) * .5;
  }
  for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; tr.t -= dt; if (tr.l.material.opacity !== undefined && tr.t < .09) tr.l.material.opacity = Math.max(0, tr.t / .09); if (tr.t <= 0) { scene.remove(tr.l); tracers.splice(i, 1); } }
  hitT -= dt; $('hitm').style.opacity = Math.max(0, hitT * 4); dmgFlash = Math.max(0, dmgFlash - dt * 2.5);
  $('dmg').style.boxShadow = `inset 0 0 140px rgba(220,0,0,${dmgFlash * .7})`;
  hud();
  renderer.render(scene, camera);
}
function hud() {
  $('hp').innerHTML = `${me.hp}<small>HEALTH</small>`; $('hp').style.color = me.hp < 30 ? '#ff6b6b' : '#fff';
  $('ammo').innerHTML = me.reload > 0 ? `reloading<small>${me.reload.toFixed(1)}s</small>` : `${me.ammo} / ∞<small>AMMO</small>`;
  $('score').innerHTML = `<div class="ct">CT ${score.ct}</div><div class="t">${score.t} T</div>`;
  const dead = joined && !me.alive; $('dead').style.display = dead ? 'block' : 'none'; if (dead) $('dead').innerHTML = `${killer ? `killed by <b>${esc(killer)}</b><br>` : ''}respawn in ${me.respawn.toFixed(1)}s`;
  $('cross').style.display = joined && me.alive ? 'block' : 'none';
  $('hint').textContent = joined ? (TOUCH ? `room ${myRoom} · you are ${TEAMS[myTeam].name}` : `room ${myRoom} · you are ${TEAMS[myTeam].name} · M to switch`) : '';
  if ($('board').style.display === 'block') {
    const rows = team => snapPlayers.filter(p => p[2] === team).sort((a, b) => b[10] - a[10]).map(p => `<tr class="${p[0] === myId ? 'me' : ''}"><td style="color:${TEAMS[team].css}">${esc(p[1])}${p[15] ? ' <span style="opacity:.5">bot</span>' : ''}</td><td>${p[10]}</td><td>${p[11]}</td></tr>`).join('');
    $('board').innerHTML = `<table><tr><td><b style="color:#4f8dff">CT ${score.ct}</b></td><td>K</td><td>D</td></tr>${rows('ct')}<tr><td>&nbsp;</td></tr><tr><td><b style="color:#f0a43a">T ${score.t}</b></td><td>K</td><td>D</td></tr>${rows('t')}</table>`;
  }
}
frame();
