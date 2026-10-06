// Strikebox server: static files + team deathmatch rooms over WebSocket.
// Rooms hold up to MAX_ROOM players. When one fills up, the next player opens a new room.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { MAP, P, collide, rayWorld, hitPlayer } from './public/shared.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = +process.env.PORT || 8080;
const BOTS = +(process.env.BOTS || 0);             // bots per team when a team is short. 0 = humans only
const MAX_ROOM = +(process.env.MAX_ROOM || 16);    // players per room, split evenly between teams
const MAX_CONN = +(process.env.MAX_CONN || 400);   // sockets on the whole server
const MAX_PER_IP = +(process.env.MAX_PER_IP || 4); // sockets from one address
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };
const now = () => Date.now() / 1000;
const rnd = (a, b) => a + Math.random() * (b - a);
const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; };
const vec = a => Array.isArray(a) && a.length === 3 && a.every(v => Number.isFinite(+v)) ? a.map(Number) : null;

// ---------- static files ----------
const cache = new Map();
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.humans(), 0), sockets: wss.clients.size })); }
  if (p === '/' || p === '/embed') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p)); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  const send = b => {
    const ext = path.extname(f);
    if (ext === '.html') { const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http'); b = Buffer.from(b.toString().replaceAll('__ORIGIN__', `${proto}://${req.headers.host}`)); }
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' }); res.end(b);
  };
  if (cache.has(f)) return send(cache.get(f));
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('not found'); } cache.set(f, b); send(b); });
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

// ---------- rooms ----------
let nextId = 1, nextRoom = 1;
const rooms = new Map();
class Room {
  constructor() { this.id = nextRoom++; this.players = new Map(); this.socks = new Set(); this.score = { ct: 0, t: 0 }; this.events = []; rooms.set(this.id, this); }
  humans(team) { let n = 0; for (const p of this.players.values()) if (!p.bot && (!team || p.team === team)) n++; return n; }
  spawnPoint(team) {
    let best = MAP.spawns[team][0], bd = -1;
    for (const s of MAP.spawns[team]) { let d = 1e9; for (const p of this.players.values()) if (p.alive && p.team !== team) d = Math.min(d, Math.hypot(p.x - s[0], p.z - s[1])); if (d > bd) { bd = d; best = s; } }
    return best;
  }
  spawn(p) { const [x, z] = this.spawnPoint(p.team); Object.assign(p, { x: x + rnd(-.6, .6), z: z + rnd(-.6, .6), y: 0, yaw: p.team === 'ct' ? -Math.PI / 2 : Math.PI / 2, pitch: 0, hp: P.hp, alive: true, ammo: P.mag, reloadAt: 0, spawnedAt: now() }); }
  add(name, team, bot = false) {
    const p = { id: nextId++, name, team, bot, kills: 0, deaths: 0, lastShot: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.spawn(p); this.players.set(p.id, p); return p;
  }
  pickTeam(want) {
    const half = Math.ceil(MAX_ROOM / 2), ct = this.humans('ct'), t = this.humans('t');
    if (want === 'ct' && ct < half && ct <= t + 1) return 'ct';
    if (want === 't' && t < half && t <= ct + 1) return 't';
    return ct <= t ? 'ct' : 't';
  }
  balanceBots() {
    for (const team of ['ct', 't']) {
      const want = this.humans() ? Math.max(0, BOTS - this.humans(team)) : 0;
      const bots = [...this.players.values()].filter(p => p.bot && p.team === team);
      while (bots.length < want) bots.push(this.add(`bot ${team.toUpperCase()}${nextId}`, team, true));
      while (bots.length > want) this.players.delete(bots.pop().id);
    }
  }
  shoot(p, o, dir) {
    const t = now();
    if (!p.alive || t - p.lastShot < P.rate * 0.9 || t < p.reloadAt) return;
    p.lastShot = t; p.ammo--; if (p.ammo <= 0) { p.reloadAt = t + P.reload; p.ammo = P.mag; }
    const n = Math.hypot(...dir); if (!n) return; dir = dir.map(v => v / n);
    if (!o || Math.hypot(o[0] - p.x, o[2] - p.z) > 1.5 || Math.abs(o[1] - (p.y + P.eye)) > 1) o = [p.x, p.y + P.eye, p.z];
    const wall = rayWorld(o, dir);
    let best = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team || t - q.spawnedAt < .8) continue; // short spawn protection
      const h = hitPlayer(o, dir, q); if (h && h.t < wall && (!best || h.t < best.h.t)) best = { q, h };
    }
    const end = best ? best.h.t : Math.min(wall, 80);
    this.events.push({ e: 'shot', id: p.id, o: o.map(v => +v.toFixed(2)), to: [o[0] + dir[0] * end, o[1] + dir[1] * end, o[2] + dir[2] * end].map(v => +v.toFixed(2)), hit: !!best });
    if (!best) return;
    const { q, h } = best; q.hp -= h.head ? P.head : P.dmg;
    this.events.push({ e: 'hit', id: q.id, by: p.id, head: h.head });
    if (q.hp <= 0) {
      q.alive = false; q.hp = 0; q.deaths++; q.respawnAt = t + P.respawn; p.kills++; this.score[p.team]++;
      this.events.push({ e: 'kill', k: p.id, v: q.id, head: h.head, kn: p.name, vn: q.name, kt: p.team, vt: q.team });
    }
  }
  step(dt, sendSnap) {
    const t = now();
    for (const p of this.players.values()) { if (!p.alive && t >= p.respawnAt) this.spawn(p); if (p.bot) botThink(this, p, dt); }
    if (!sendSnap) return;
    const snap = JSON.stringify({ t: 'snap', room: this.id, score: this.score, ps: [...this.players.values()].map(p => [p.id, p.name, p.team, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.hp, p.alive ? 1 : 0, p.kills, p.deaths, p.ammo, p.reloadAt > t ? +(p.reloadAt - t).toFixed(2) : 0, p.alive ? 0 : +Math.max(0, p.respawnAt - t).toFixed(1), p.bot ? 1 : 0]), ev: this.events });
    this.events = [];
    for (const ws of this.socks) if (ws.readyState === 1 && ws.bufferedAmount < 256 * 1024) ws.send(snap); // skip clients that can't keep up
  }
}
function roomFor() { for (const r of rooms.values()) if (r.humans() < MAX_ROOM) return r; return new Room(); }

// ---------- bots ----------
const WAY = [[-28, 0], [-20, -12], [-20, 12], [-8, -4], [-8, 4], [0, -2], [0, 2], [8, -4], [8, 4], [20, -12], [20, 12], [28, 0], [-14, -15], [14, 15], [-14, 15], [14, -15], [-24, -19], [24, 19]];
function sees(a, b) { const o = [a.x, a.y + P.eye, a.z], tx = b.x - o[0], ty = b.y + 1.2 - o[1], tz = b.z - o[2]; const d = Math.hypot(tx, ty, tz); return rayWorld(o, [tx / d, ty / d, tz / d]) > d ? d : 0; }
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function move(p, mx, mz) { const [x, z] = collide(p.x + mx, p.z + mz, P.r, p.y); p.x = Math.max(-31.5, Math.min(31.5, x)); p.z = Math.max(-21.5, Math.min(21.5, z)); }
function botThink(room, b, dt) {
  if (!b.alive) return;
  const t = now(); let tgt = null, td = 1e9;
  for (const q of room.players.values()) if (q.alive && q.team !== b.team) { const d = sees(b, q); if (d && d < 42 && d < td) { td = d; tgt = q; } }
  if (tgt) {
    const dy = wrap(Math.atan2(-(tgt.x - b.x), -(tgt.z - b.z)) - b.yaw); b.yaw += dy * Math.min(1, dt * 7);
    if (!b.seenAt || t - b.seenAt > 2) b.seenAt = t;
    if (Math.abs(dy) < .12 && t - b.seenAt > .45 && t - b.lastShot > .16) { const sp = .045 + td * .0016, o = [b.x, b.y + P.eye, b.z]; room.shoot(b, o, [tgt.x + rnd(-sp, sp) * td - o[0], tgt.y + rnd(.9, 1.7) - o[1], tgt.z + rnd(-sp, sp) * td - o[2]]); }
    b.strafe = b.strafe || 1; if (Math.random() < dt * .8) b.strafe *= -1;
    const s = 2.4 * dt; move(b, Math.cos(b.yaw) * s * b.strafe, -Math.sin(b.yaw) * s * b.strafe); return;
  }
  b.seenAt = 0;
  if (!b.goal || Math.hypot(b.goal[0] - b.x, b.goal[1] - b.z) < 1.2 || t > (b.goalUntil || 0)) { b.goal = WAY[(Math.random() * WAY.length) | 0]; b.goalUntil = t + 9; }
  const dx = b.goal[0] - b.x, dz = b.goal[1] - b.z, d = Math.hypot(dx, dz) || 1;
  b.yaw += wrap(Math.atan2(-dx, -dz) - b.yaw) * Math.min(1, dt * 5);
  const s = 4.6 * dt, ox = b.x, oz = b.z; move(b, dx / d * s, dz / d * s);
  if (Math.hypot(b.x - ox, b.z - oz) < s * .3) b.goalUntil = 0;
}

// ---------- network ----------
const perIp = new Map();
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'player' + Math.floor(rnd(100, 999));
wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (wss.clients.size > MAX_CONN || (perIp.get(ip) || 0) >= MAX_PER_IP) { ws.close(1013, 'server full'); return; }
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  ws.tokens = 40; ws.lastFill = now(); ws.strikes = 0;
  let room = null, p = null;
  const leave = () => { if (!room) return; room.socks.delete(ws); if (p) { room.players.delete(p.id); room.events.push({ e: 'leave', n: p.name }); } room.balanceBots(); if (!room.humans()) rooms.delete(room.id); room = null; p = null; };
  ws.on('message', raw => {
    // token bucket: about 60 messages a second, a little burst allowed
    const t = now(); ws.tokens = Math.min(40, ws.tokens + (t - ws.lastFill) * 60); ws.lastFill = t;
    if (ws.tokens < 1) { if (++ws.strikes > 200) ws.terminate(); return; } ws.tokens--;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      leave(); room = roomFor(); room.socks.add(ws);
      const team = room.pickTeam(m.team); p = room.add(cleanName(m.name), team); room.balanceBots();
      ws.send(JSON.stringify({ t: 'welcome', id: p.id, team, room: room.id }));
      room.events.push({ e: 'join', n: p.name, team });
      return;
    }
    if (!p) return;
    if (m.t === 'st' && p.alive) {
      const x = num(m.x, -32, 32), z = num(m.z, -22, 22), y = num(m.y, 0, 3), yaw = num(m.yaw, -1e4, 1e4), pitch = num(m.pitch, -1.5, 1.5);
      if (x === null || z === null || y === null || yaw === null || pitch === null) return;
      if (Math.hypot(x - p.x, z - p.z) < P.speed * .25 + 1) { [p.x, p.z] = collide(x, z, P.r * .9, y); }
      p.y = y; p.yaw = yaw; p.pitch = pitch;
    } else if (m.t === 'shot') { const d = vec(m.d); if (d) room.shoot(p, vec(m.o), d); }
    else if (m.t === 'reload' && p.ammo < P.mag && now() > p.reloadAt) { p.reloadAt = now() + P.reload; p.ammo = P.mag; }
    else if (m.t === 'team' && (m.team === 'ct' || m.team === 't') && m.team !== p.team && room.pickTeam(m.team) === m.team) { p.team = m.team; p.alive = false; p.respawnAt = now() + 1; room.balanceBots(); }
  });
  ws.on('close', () => { leave(); const n = (perIp.get(ip) || 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });
  ws.on('error', () => {});
});
// drop sockets that stopped answering
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 15000);

// ---------- loop ----------
let last = now(), tick = 0;
setInterval(() => {
  const t = now(), dt = Math.min(.1, t - last); last = t; tick++;
  for (const r of rooms.values()) { try { r.step(dt, tick % 2 === 0); } catch (e) { console.error('room', r.id, e); } }
}, 1000 / 30);

process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));
server.listen(PORT, () => console.log(`strikebox on http://localhost:${PORT} · bots per team: ${BOTS} · room size: ${MAX_ROOM}`));
