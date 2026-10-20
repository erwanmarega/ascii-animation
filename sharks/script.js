const canvas = document.getElementById('sea');
const ctx = canvas.getContext('2d');
const FONT = '"SF Mono", Menlo, Consolas, monospace';
const CELL = 13;
const SPINE_POINTS = 24;
const RAMP = ['.', ':', 't', 'S', '%', 'X', '8', '#', '@'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let W = 0, H = 0, cols = 0, rows = 0;
let value, kind;
const sharks = [];
const mouse = { x: -9999, y: -9999 };

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function hash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function halfWidth(u) {
  if (u < 0) return 0;
  if (u < 0.22) return Math.pow(u / 0.22, 0.55);
  if (u < 0.86) return 1 - 0.85 * ((u - 0.22) / 0.64);
  if (u <= 1) return 0.15;
  return 0;
}

const FINS = [
  [[0.22, 0.8], [0.47, 2.7], [0.52, 2.4], [0.42, 0.55]],
  [[0.60, 0.45], [0.73, 1.1], [0.75, 0.9], [0.70, 0.35]],
  [[0.84, 0.2], [1.06, 1.5], [0.99, 0.6], [0.97, 0.1]],
];

function inPolygon(px, py, poly) {
  let neg = false, pos = false;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross < 0) neg = true; else if (cross > 0) pos = true;
    if (neg && pos) return false;
  }
  return true;
}

function shade(u, a, haloA) {
  const hw = halfWidth(u);
  if (a < hw) return 0.45 + 0.5 * (1 - a / hw);
  for (const fin of FINS) if (inPolygon(u, a, fin)) return 0.32;
  if (u > -0.03 && u < 1.03 && a < hw + haloA) return -1;
  return 0;
}

function createShark(slot, count) {
  const depth = Math.random();
  const L = 220 + depth * 230;
  const s = {
    L,
    maxW: L * 0.12,
    depth,
    speed: (45 + depth * 45) * (reducedMotion ? 0.3 : 1),
    angle: rand(0, Math.PI * 2),
    tx: 0,
    ty: 0,
    timer: 0,
    phase: rand(0, Math.PI * 2),
    x: rand((W * slot) / count, (W * (slot + 1)) / count),
    y: rand(H * 0.2, H * 0.8),
    trail: [],
    spine: [],
  };
  for (let d = 0; d <= L * 1.3; d += 4) {
    s.trail.push({ x: s.x - Math.cos(s.angle) * d, y: s.y - Math.sin(s.angle) * d });
  }
  return s;
}

function pickTarget(s) {
  let best = -1;
  for (let i = 0; i < 6; i++) {
    const tx = rand(W * 0.1, W * 0.9), ty = rand(H * 0.1, H * 0.9);
    let gap = Infinity;
    for (const o of sharks) {
      if (o !== s) gap = Math.min(gap, Math.hypot(tx - o.x, ty - o.y), Math.hypot(tx - o.tx, ty - o.ty));
    }
    if (gap > best) { best = gap; s.tx = tx; s.ty = ty; }
  }
  s.timer = rand(6, 12);
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

function updateShark(s, dt) {
  s.timer -= dt;
  if (s.timer <= 0 || Math.hypot(s.tx - s.x, s.ty - s.y) < s.L * 0.5) pickTarget(s);
  let desired = Math.atan2(s.ty - s.y, s.tx - s.x);

  let avoiding = false;
  for (const o of sharks) {
    if (o === s) continue;
    let gap = Infinity, nx = 0, ny = 0;
    for (const p of o.spine) {
      const g = Math.hypot(s.x - p.x, s.y - p.y);
      if (g < gap) { gap = g; nx = p.x; ny = p.y; }
    }
    if (gap < o.maxW * 4 + s.L * 0.5) {
      desired = Math.atan2(s.y - ny, s.x - nx);
      avoiding = true;
      if (s.timer > 1) s.timer = 1;
    }
  }

  let boost = 0;
  const dist = Math.hypot(s.x - mouse.x, s.y - mouse.y);
  if (dist < 220) {
    desired = Math.atan2(s.y - mouse.y, s.x - mouse.x);
    boost = 1.5 * (1 - dist / 220);
  }

  const maxTurn = (0.9 + boost + (avoiding ? 0.8 : 0)) * dt;
  s.angle += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(s.angle, desired)));

  const speed = s.speed * (1 + boost);
  s.x += Math.cos(s.angle) * speed * dt;
  s.y += Math.sin(s.angle) * speed * dt;
  s.phase += dt * speed / s.L * 7;

  s.trail.unshift({ x: s.x, y: s.y });
  let len = 0;
  for (let i = 1; i < s.trail.length; i++) {
    len += Math.hypot(s.trail[i].x - s.trail[i - 1].x, s.trail[i].y - s.trail[i - 1].y);
    if (len > s.L * 1.3) { s.trail.length = i + 1; break; }
  }

  buildSpine(s);
}

function buildSpine(s) {
  const pts = [];
  const step = s.L / (SPINE_POINTS - 1);
  let target = 0, acc = 0, i = 0;
  while (pts.length < SPINE_POINTS) {
    const a = s.trail[i], b = s.trail[i + 1];
    if (!b) { pts.push({ x: a.x, y: a.y }); continue; }
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= target) {
      const t = seg ? (target - acc) / seg : 0;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      target += step;
    } else {
      acc += seg;
      i++;
    }
  }

  s.spine = pts.map((p, k) => {
    const u = k / (SPINE_POINTS - 1);
    const q = pts[Math.min(k + 1, SPINE_POINTS - 1)], r = pts[Math.max(k - 1, 0)];
    const dx = q.x - r.x, dy = q.y - r.y;
    const len = Math.hypot(dx, dy) || 1;
    const wave = Math.sin(s.phase - u * Math.PI * 1.8) * s.L * 0.07 * Math.pow(u, 1.5);
    return { x: p.x - (dy / len) * wave, y: p.y + (dx / len) * wave };
  });
}

function rasterize(s) {
  const sp = s.spine;
  const pad = s.maxW * 2.8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of sp) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const c0 = Math.max(0, Math.floor((minX - pad) / CELL));
  const c1 = Math.min(cols - 1, Math.ceil((maxX + pad) / CELL));
  const r0 = Math.max(0, Math.floor((minY - pad) / CELL));
  const r1 = Math.min(rows - 1, Math.ceil((maxY + pad) / CELL));
  const last = SPINE_POINTS - 2;
  const haloA = (CELL * 1.1) / s.maxW;
  const dim = 0.45 + s.depth * 0.55;

  for (let r = r0; r <= r1; r++) {
    const py = r * CELL + CELL / 2;
    for (let c = c0; c <= c1; c++) {
      const px = c * CELL + CELL / 2;

      let best = Infinity, u = 0, d = 0;
      for (let i = 0; i <= last; i++) {
        const a = sp[i], b = sp[i + 1];
        const ex = b.x - a.x, ey = b.y - a.y;
        const len2 = ex * ex + ey * ey || 1;
        const t = ((px - a.x) * ex + (py - a.y) * ey) / len2;
        const tc = Math.max(0, Math.min(1, t));
        const qx = a.x + ex * tc - px, qy = a.y + ey * tc - py;
        const dist2 = qx * qx + qy * qy;
        if (dist2 < best) {
          best = dist2;
          const tu = (i === 0 && t < 0) || (i === last && t > 1) ? t : tc;
          u = (i + tu) / (SPINE_POINTS - 1);
          d = ((px - a.x) * ey - (py - a.y) * ex) / Math.sqrt(len2);
        }
      }

      const v = shade(u, Math.abs(d) / s.maxW, haloA);
      if (v === 0) continue;
      const idx = r * cols + c;
      if (v > 0) {
        const shaded = v * dim;
        if (kind[idx] !== 1 || shaded > value[idx]) {
          kind[idx] = 1;
          value[idx] = shaded;
        }
      } else if (kind[idx] === 0) {
        kind[idx] = 2;
        value[idx] = dim;
      }
    }
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cols = Math.ceil(W / CELL);
  rows = Math.ceil(H / CELL);
  value = new Float32Array(cols * rows);
  kind = new Uint8Array(cols * rows);
}

function populate() {
  const count = 3;
  sharks.length = 0;
  for (let i = 0; i < count; i++) sharks.push(createShark(i, count));
  sharks.forEach(buildSpine);
}

function draw(t) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  ctx.font = `${Math.round(CELL * 0.78)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tick = Math.floor(t * 4);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = c * CELL, y = r * CELL;
      const k = kind[idx];

      if (k === 1) {
        const n = hash(c, r, tick);
        const v = Math.max(0, Math.min(1, value[idx] + (n - 0.5) * 0.22));
        const tint = (hash(c, r, 7) - 0.5) * 40;
        ctx.fillStyle = `rgba(${70 + tint}, ${80 + tint * 0.5}, ${100 - tint * 0.3}, ${0.1 + v * 0.7})`;
        ctx.fillRect(x + 1, y + 1, CELL - 1, CELL - 1);
        ctx.fillStyle = v > 0.72
          ? `rgba(235, 240, 245, ${0.3 + v * 0.2})`
          : `rgba(20, 25, 35, ${0.18 + v * 0.22})`;
        ctx.fillText(RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))], x + CELL / 2, y + CELL / 2);
      } else if (k === 2) {
        if (hash(c, r, tick >> 1) < 0.45) {
          ctx.fillStyle = `rgba(40, 50, 65, ${0.35 * value[idx]})`;
          ctx.fillText(hash(c, r, 3) < 0.7 ? '.' : "'", x + CELL / 2, y + CELL / 2);
        }
      } else {
        const w = Math.sin(c * 0.31 + t * 0.6) * Math.sin(r * 0.43 - t * 0.4)
                + Math.sin((c + r) * 0.17 + t * 0.8);
        if (w > 1.55 && hash(c, r, 11) < 0.35) {
          ctx.fillStyle = `rgba(30, 40, 55, ${(w - 1.55) * 0.6})`;
          ctx.fillText('-', x + CELL / 2, y + CELL / 2);
        }
      }
    }
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  value.fill(0);
  kind.fill(0);
  for (const s of sharks) updateShark(s, dt);
  for (const s of [...sharks].sort((a, b) => a.depth - b.depth)) rasterize(s);
  draw(now / 1000);
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => { resize(); populate(); });
window.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });

resize();
populate();
requestAnimationFrame(loop);
