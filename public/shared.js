// Shared between server and client: the map, constants and collision/ray helpers.
export const MAP = {
  w: 64, d: 44,
  // boxes: [cx, cz, w, d, h, kind]  kind: wall | crate | low
  boxes: [
    // outer walls
    [0, -22.5, 66, 1, 6, 'wall'], [0, 22.5, 66, 1, 6, 'wall'], [-32.5, 0, 1, 46, 6, 'wall'], [32.5, 0, 1, 46, 6, 'wall'],
    // mid block with two doors
    [0, -13, 2, 18, 5, 'wall'], [0, 13, 2, 18, 5, 'wall'],
    // long A corridor walls
    [-14, -8, 12, 1.2, 4, 'wall'], [14, -8, 12, 1.2, 4, 'wall'],
    [-14, 8, 12, 1.2, 4, 'wall'], [14, 8, 12, 1.2, 4, 'wall'],
    // crates
    [-6, 0, 2, 2, 1.6, 'crate'], [6, 0, 2, 2, 1.6, 'crate'], [-6, -2.2, 1.4, 1.4, 1.1, 'crate'], [6, 2.2, 1.4, 1.4, 1.1, 'crate'],
    [-20, -15, 3, 3, 2.2, 'crate'], [20, 15, 3, 3, 2.2, 'crate'], [-20, 15, 2.4, 2.4, 1.6, 'crate'], [20, -15, 2.4, 2.4, 1.6, 'crate'],
    [-10, -17, 2, 2, 1.6, 'crate'], [10, 17, 2, 2, 1.6, 'crate'], [-10, 17, 1.6, 4, 1.2, 'low'], [10, -17, 1.6, 4, 1.2, 'low'],
    [-26, 0, 1.2, 6, 1.4, 'low'], [26, 0, 1.2, 6, 1.4, 'low'],
  ],
  spawns: {
    ct: [[-29, -18], [-29, -6], [-29, 6], [-29, 18], [-27, 0], [-27, -12], [-27, 12]],
    t: [[29, 18], [29, 6], [29, -6], [29, -18], [27, 0], [27, 12], [27, -12]],
  },
};
export const P = { r: 0.38, eye: 1.62, speed: 6.2, jump: 6.4, g: 18, hp: 100, mag: 30, reload: 2.1, rate: 0.1, dmg: 26, head: 100, respawn: 3 };
export const TEAMS = { ct: { name: 'CT', color: 0x3f86ff, css: '#4f8dff' }, t: { name: 'T', color: 0xe8a33a, css: '#f0a43a' } };

// push a circle (x,z,r) out of boxes it overlaps, if the player's feet are below box top
export function collide(x, z, r, y = 0) {
  for (const [cx, cz, w, d, h] of MAP.boxes) {
    if (y >= h - 0.05) continue;
    const hx = w / 2, hz = d / 2;
    const nx = Math.max(cx - hx, Math.min(x, cx + hx)), nz = Math.max(cz - hz, Math.min(z, cz + hz));
    const dx = x - nx, dz = z - nz, dd = dx * dx + dz * dz;
    if (dd < r * r) {
      if (dd > 1e-8) { const dl = Math.sqrt(dd); x = nx + dx / dl * r; z = nz + dz / dl * r; }
      else { // centre inside: push out on the shortest axis
        const px = hx - Math.abs(x - cx), pz = hz - Math.abs(z - cz);
        if (px < pz) x = cx + Math.sign(x - cx || 1) * (hx + r); else z = cz + Math.sign(z - cz || 1) * (hz + r);
      }
    }
  }
  return [x, z];
}
// highest box top under a point (for standing on crates)
export function groundAt(x, z, r, y) {
  let gy = 0;
  for (const [cx, cz, w, d, h] of MAP.boxes) {
    if (Math.abs(x - cx) < w / 2 + r * .6 && Math.abs(z - cz) < d / 2 + r * .6 && y >= h - 0.25) gy = Math.max(gy, h);
  }
  return gy;
}
// ray vs axis-aligned box, returns distance or Infinity
export function rayBox(o, dir, cx, cz, w, d, h) {
  const mn = [cx - w / 2, 0, cz - d / 2], mx = [cx + w / 2, h, cz + d / 2];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return Infinity; continue; }
    let a = (mn[i] - o[i]) / dir[i], b = (mx[i] - o[i]) / dir[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity;
  }
  return t0;
}
export function rayWorld(o, dir) { let best = Infinity; for (const b of MAP.boxes) best = Math.min(best, rayBox(o, dir, ...b)); const tf = dir[1] < 0 ? -o[1] / dir[1] : Infinity; return Math.min(best, tf); }
// ray vs sphere
export function raySphere(o, dir, c, r) { const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2]; const b = ox * dir[0] + oy * dir[1] + oz * dir[2]; const cc = ox * ox + oy * oy + oz * oz - r * r; const disc = b * b - cc; if (disc < 0) return Infinity; const t = -b - Math.sqrt(disc); return t > 0 ? t : Infinity; }
// ray vs vertical cylinder (body)
export function rayCyl(o, dir, cx, cz, r, y0, y1) {
  const ox = o[0] - cx, oz = o[2] - cz; const a = dir[0] * dir[0] + dir[2] * dir[2]; if (a < 1e-9) return Infinity;
  const b = 2 * (ox * dir[0] + oz * dir[2]), c = ox * ox + oz * oz - r * r; const disc = b * b - 4 * a * c; if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a); if (t <= 0) return Infinity; const y = o[1] + dir[1] * t; return (y >= y0 && y <= y1) ? t : Infinity;
}
// hit test a shot against one player at (x,y,z); returns {t, head} or null
export function hitPlayer(o, dir, p) {
  const th = raySphere(o, dir, [p.x, p.y + 1.62, p.z], 0.24);
  const tb = rayCyl(o, dir, p.x, p.z, 0.36, p.y, p.y + 1.42);
  if (th === Infinity && tb === Infinity) return null;
  return th <= tb ? { t: th, head: true } : { t: tb, head: false };
}
