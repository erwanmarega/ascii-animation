const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const FONT = '"SF Mono", Menlo, Consolas, monospace';
const CW = 9, CH = 15;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const MOON_RAMP = ['.', ':', 'o', 'O', '0', '@'];
const CLOUD_RAMP = ['.', '-', '~', '=', '+'];
const LEAF_RAMP = ['&', '%', '#', '@', '&', '*'];
const FUR = ['~', '"', '^', "'", '`', '~', 'w'];
const SIGN_TEXT = ['め', 'い'];

let W = 0, H = 0, cols = 0, rows = 0, n = 0;
let chs, fr, fgc, fb, br, bgc, bb, flag, beam;
let off, offCtx, img, vignette;
let horizon, roadY, u, moon, Lb;
let S = 0, legPhase = 0, rain = 0, rainTarget = 0;
let flies = [];
const mouse = { x: -9999, y: -9999 };
const styleCache = new Map();

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash(i, j, k) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, 0), b = hash(xi + 1, yi, 0);
  const c = hash(xi, yi + 1, 0), d = hash(xi + 1, yi + 1, 0);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y) {
  return (vnoise(x, y) * 0.5 + vnoise(x * 2.03, y * 2.03) * 0.25 + vnoise(x * 4.1, y * 4.1) * 0.125) / 0.875;
}

function sdRoundBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

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

function set(i, ch, r, g, b, R, G, B) {
  chs[i] = ch;
  fr[i] = r; fgc[i] = g; fb[i] = b;
  br[i] = R; bgc[i] = G; bb[i] = B;
}

function cellIndex(x, y) {
  const c = Math.floor(x / CW), r = Math.floor(y / CH);
  return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
}

function forCells(x0, y0, x1, y1, fn) {
  const c0 = Math.max(0, Math.floor(x0 / CW)), c1 = Math.min(cols - 1, Math.ceil(x1 / CW));
  const r0 = Math.max(0, Math.floor(y0 / CH)), r1 = Math.min(rows - 1, Math.ceil(y1 / CH));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) fn(c * CW + CW / 2, r * CH + CH / 2, r * cols + c, c, r);
  }
}

function drawLandscape(t) {
  const moonVis = 1 - rain * 0.85;
  const fieldTop = horizon;
  const roadTop = roadY - H * 0.035, roadBot = roadY + H * 0.03;
  const tick = Math.floor(t * 6);

  for (let r = 0; r < rows; r++) {
    const y = r * CH + CH / 2;
    for (let c = 0; c < cols; c++) {
      const x = c * CW + CW / 2, i = r * cols + c;
      flag[i] = 0;
      beam[i] = 0;

      if (y >= fieldTop) {
        const d = (y - fieldTop) / (H - fieldTop);
        if (y < roadTop) {
          const wx = x + S * (0.2 + 0.9 * d);
          const band = (1 / (d + 0.04)) * 0.55 % 1;
          if (band < 0.16) {
            const h = hash(Math.floor(wx / CW), r, 3);
            set(i, h < 0.5 ? '_' : h < 0.8 ? '=' : '.', 85, 95, 68, 38, 46, 36);
            continue;
          }
          let R = 16 + d * 10, G = 32 + d * 12, B = 54 + d * 8;
          const sway = Math.sin(wx * 0.006 - t * 1.8) + 0.6 * Math.sin(wx * 0.019 - t * 3.1 + y * 0.01);
          const sp = CW * (1.2 + d * 2.2);
          const reflect = Math.abs(x - moon.x) < moon.r * (0.45 + d * 0.9) * (0.6 + 0.5 * vnoise(y * 0.15, t * 1.5));
          if ((wx / sp) % 1 < 0.45 && hash(Math.floor(wx / sp), r, 4) > 0.25) {
            const ch = sway > 0.7 ? '/' : sway < -0.7 ? '\\' : hash(Math.floor(wx / sp), r, 5) < 0.5 ? '|' : ',';
            const k = 0.55 + 0.6 * d;
            set(i, ch, 70 * k, 130 * k, 82 * k, R, G, B);
          } else if (reflect && moonVis > 0.2) {
            const k = moonVis * (1 - d * 0.4);
            set(i, hash(c, r, tick >> 2) < 0.5 ? '~' : '-', 230 * k, 220 * k, 180 * k, R + 60 * k, G + 60 * k, B + 50 * k);
          } else if (rain > 0.1 && hash(c, r, tick) < 0.05 * rain) {
            set(i, 'o', 140, 160, 190, R, G, B);
          } else {
            set(i, hash(c, r, 6) < 0.12 ? '~' : ' ', 55, 80, 110, R, G, B);
          }
        } else if (y < roadBot) {
          const wx = x + S;
          const h = hash(Math.floor(wx / CW), r, 7);
          const mid = 1 - Math.abs(y - roadY) / (roadBot - roadTop);
          const R = 50 + mid * 18, G = 46 + mid * 15, B = 44 + mid * 10;
          const rut = Math.abs(y - (roadY - H * 0.012)) < CH * 0.5 || Math.abs(y - (roadY + H * 0.014)) < CH * 0.5;
          if (rain > 0.3 && vnoise(wx * 0.012, r * 0.7) > 1.05 - rain * 0.35) {
            set(i, hash(c, r, tick) < 0.08 * rain ? 'o' : '~', 120, 140, 170, 28, 40, 60);
          } else if (rut) {
            set(i, h < 0.55 ? '-' : h < 0.85 ? '_' : ' ', 120, 108, 92, R - 8, G - 8, B - 6);
          } else {
            set(i, h < 0.16 ? '.' : h < 0.24 ? ',' : h < 0.28 ? '`' : ' ', 125, 112, 96, R, G, B);
          }
        } else {
          const wx = x + S * 1.35;
          const top = roadBot + H * 0.025 * (vnoise(wx * 0.04, 2.5) - 0.3);
          const R = 9, G = 22 + d * 4, B = 19;
          if (y < top) {
            set(i, ' ', 0, 0, 0, 50, 46, 44);
            continue;
          }
          const sway = Math.sin(wx * 0.006 - t * 1.6) + 0.6 * Math.sin(wx * 0.017 - t * 2.7);
          const h = hash(Math.floor(wx / CW), r, 8);
          const tip = y - top < CH * 1.6;
          const ch = sway > 0.6 ? '/' : sway < -0.6 ? '\\' : h < 0.3 ? '|' : h < 0.5 ? ';' : h < 0.7 ? '"' : "'";
          const k = tip ? 1.4 : 0.8 + h * 0.4;
          set(i, ch, 38 * k, 82 * k, 56 * k, R, G, B);
        }
        continue;
      }

      const wm = x + S * 0.16;
      const hm = horizon - H * (0.012 + 0.035 * fbm(wm * 0.005 + 40, 0.37)) - H * 0.012 * vnoise(wm * 0.045, 7.3);
      if (y >= hm) {
        const nz = vnoise(wm * 0.09, y * 0.09);
        const edge = y - hm < CH * 1.2;
        const lit = edge ? 0.9 * moonVis : 0;
        set(i, LEAF_RAMP[Math.floor(nz * 5.99)], 32 + 40 * lit, 62 + 50 * lit, 52 + 45 * lit, 11, 26, 28);
        continue;
      }

      const wf = x + S * 0.05;
      const hf = horizon - H * (0.05 + 0.09 * fbm(wf * 0.0022, 0.37));
      if (y >= hf) {
        const R = 20, G = 31, B = 52;
        if (y - hf < CH) {
          set(i, hash(c, r, 9) < 0.6 ? '_' : '^', 70 + 30 * moonVis, 88 + 30 * moonVis, 120 + 30 * moonVis, R, G, B);
        } else if (hash(Math.floor(wf / CW), r, 10) < 0.005) {
          const flick = 0.75 + 0.25 * Math.sin(t * 3 + c);
          set(i, '.', 255 * flick, 190 * flick, 100 * flick, R + 30, G + 20, B);
        } else {
          set(i, hash(c, r, 11) < 0.06 ? '.' : ' ', 34, 48, 72, R, G, B);
        }
        continue;
      }

      const ty = y / horizon;
      let R = lerp(lerp(8, 38, ty), 26 + ty * 18, rain);
      let G = lerp(lerp(12, 62, ty), 32 + ty * 20, rain);
      let B = lerp(lerp(36, 98, ty), 44 + ty * 22, rain);
      const dm = Math.hypot(x - moon.x, y - moon.y);
      const glow = Math.exp(-dm / (moon.r * 2.2)) * 0.9 * moonVis;
      R += 120 * glow; G += 125 * glow; B += 118 * glow;

      const cn = fbm(x * 0.0021 + t * 0.01 + S * 0.00002, y * 0.0068 + 3.1);
      const cwgt = clamp(1 - Math.abs(ty - 0.55) * 1.4, 0, 1);
      const th = 0.5 - rain * 0.24;
      const cloud = smoothstep(th, th + 0.18, cn - (1 - cwgt) * 0.25);
      const litC = clamp(1 - dm / (moon.r * 6), 0, 1) * moonVis;
      const silver = cloud * (1 - cloud) * 4;
      const cR = 36 + 30 * litC + 150 * litC * silver;
      const cG = 44 + 30 * litC + 150 * litC * silver;
      const cB = 70 + 26 * litC + 140 * litC * silver;

      if (dm < moon.r && moonVis > 0.3) {
        const crater = fbm(x * 0.035 + 9, y * 0.035);
        const limb = Math.sqrt(1 - (dm / moon.r) ** 2);
        const v = (0.7 + 0.3 * limb) * (0.82 + 0.35 * (crater - 0.5)) * moonVis;
        const mix = cloud * 0.8;
        const mR = lerp(240 * v, cR, mix), mG = lerp(228 * v, cG, mix), mB = lerp(194 * v, cB, mix);
        set(i, MOON_RAMP[Math.floor(crater * 5.99)], mR * 0.82, mG * 0.8, mB * 0.74, mR, mG, mB);
        continue;
      }

      R = lerp(R, cR, cloud * 0.92); G = lerp(G, cG, cloud * 0.92); B = lerp(B, cB, cloud * 0.92);
      if (cloud > 0.08) {
        const ci = Math.floor(clamp(cloud + (hash(c, r, 12) - 0.5) * 0.3, 0, 0.999) * CLOUD_RAMP.length);
        set(i, CLOUD_RAMP[ci], R * 1.35 + 14, G * 1.35 + 14, B * 1.3 + 14, R, G, B);
      } else if (hash(c, r, 1) < 0.016 * (1 - ty) && rain < 0.7) {
        const h2 = hash(c, r, 2);
        const tw = (0.45 + 0.55 * Math.sin(t * (1 + h2 * 3) + hash(c, r, 3) * 6.28)) * (1 - rain) * (1 - cloud * 8);
        set(i, h2 < 0.25 ? '*' : h2 < 0.55 ? '+' : '.', R + 190 * tw, G + 195 * tw, B + 160 * tw, R, G, B);
      } else {
        set(i, ' ', 0, 0, 0, R, G, B);
      }
    }
  }
}

const BLOBS = [
  [0, -1.25, 0.75], [-0.7, -1.0, 0.55], [0.7, -1.05, 0.6], [-0.35, -1.7, 0.55],
  [0.4, -1.65, 0.55], [0, -2.05, 0.45], [-1.05, -0.8, 0.38], [1.05, -0.85, 0.4],
];

function drawTree() {
  const R = clamp(H * 0.2, 60, 220);
  const period = W * 2.4 + R * 3;
  const tx = W + R * 1.5 - ((S * 0.3 + W * 0.9) % period);
  const ty = horizon + H * 0.02;
  if (tx < -R * 1.6 || tx > W + R * 1.6) return;
  const moonVis = 1 - rain * 0.85;

  forCells(tx - R * 1.5, ty - R * 2.55, tx + R * 1.5, ty, (x, y, i, c, r) => {
    const lx = (x - tx) / R, ly = (y - ty) / R;
    const fuzz = (vnoise(x * 0.05, y * 0.05) - 0.5) * 0.3;

    let best = Infinity, nx = 0, ny = 0;
    for (const [bx, by, br0] of BLOBS) {
      const dd = Math.hypot(lx - bx, ly - by) / br0;
      if (dd < best) { best = dd; nx = (lx - bx) / br0; ny = (ly - by) / br0; }
    }
    if (best - 1 + fuzz < 0) {
      const lit = Math.max(0, nx * 0.6 - ny * 0.8) * moonVis;
      const nz = vnoise(x * 0.11, y * 0.11);
      const k = 0.35 + 0.9 * lit * Math.min(1, best + 0.2);
      set(i, LEAF_RAMP[Math.floor(nz * 5.99)], 60 * k + 10, 115 * k + 14, 85 * k + 12, 13 + 20 * lit, 30 + 30 * lit, 28 + 22 * lit);
      return;
    }

    const half = 0.11 + 0.06 * Math.max(0, ly + 0.25) / 0.25 + 0.02 * Math.sin(ly * 9);
    if (ly > -1.0 && Math.abs(lx) < half + fuzz * 0.2) {
      if (Math.abs(ly + 0.5) < 0.035) {
        set(i, '~', 225, 215, 185, 120, 110, 90);
      } else if (ly > -0.47 && ly < -0.38 && Math.abs(Math.sin(lx * 40)) > 0.6) {
        set(i, 'z', 235, 235, 225, 40, 34, 32);
      } else {
        const lit = lx > 0 ? 0.6 * moonVis : 0;
        set(i, hash(c, r, 13) < 0.5 ? '|' : '[', 70 + 40 * lit, 58 + 32 * lit, 50 + 26 * lit, 30, 24, 23);
      }
    }
  });
}

function drawPoles() {
  const ps = clamp(W * 0.5, 260, 520);
  const top = horizon - H * 0.2, bottom = roadY - H * 0.035;
  const sag = H * 0.05;
  const base = -((S * 0.75) % ps);

  for (let c = 0; c < cols; c++) {
    const x = c * CW + CW / 2;
    const uu = ((x - base) / ps) % 1;
    for (let j = 0; j < 2; j++) {
      const yw = top + CH * 0.6 + j * CH * 1.1 + sag * 4 * uu * (1 - uu);
      const i = cellIndex(x, yw);
      if (i < 0) continue;
      const slope = (sag * 4 * (1 - 2 * uu) / ps) * (CW / CH);
      const ch = slope > 0.18 ? '\\' : slope < -0.18 ? '/' : (yw % CH) / CH < 0.5 ? '-' : '_';
      set(i, ch, 105, 112, 130, br[i], bgc[i], bb[i]);
    }
  }

  for (let x0 = base - ps; x0 < W + ps; x0 += ps) {
    forCells(x0 - CW * 3.5, top - CH, x0 + CW * 3.5, bottom, (x, y, i) => {
      const dx = Math.abs(x - x0);
      if (y < top + CH && dx < CW * 3.2) {
        set(i, dx > CW * 2.5 ? 'o' : '=', 120, 110, 100, 34, 30, 32);
      } else if (dx < CW * 0.55) {
        set(i, '|', 92, 80, 72, 30, 26, 28);
      }
    });
  }
}

function drawTotoro(t) {
  const ht = clamp(u * 1.5, 90, 340);
  const period = W * 3.2;
  const tx = W + ht * 1.5 - ((S * 0.9 + W * 0.15 + ht * 1.5) % period);
  const ty = roadY - H * 0.03;
  if (tx < -ht || tx > W + ht) return;
  const moonVis = 1 - rain * 0.85;
  const blink = (t % 4.3) < 0.15;

  forCells(tx - ht * 0.7, ty - ht * 1.35, tx + ht * 0.65, ty, (x, y, i, c, r) => {
    const lx = (x - tx) / ht, ly = (y - ty) / ht;

    const ux = (lx - 0.12) / 0.42, uy = (ly + 1.1) / 0.2;
    if (uy < 0 && ux * ux + uy * uy < 1 && uy > -1) {
      const scallop = uy > -0.15 && Math.abs(Math.sin(ux * 9)) < 0.3;
      if (!scallop) {
        const rib = Math.abs(Math.sin(Math.atan2(uy, ux) * 4)) < 0.2;
        set(i, rib ? (ux < 0 ? '/' : '\\') : ' ', 70, 72, 90, 16, 16, 22);
        return;
      }
    }
    if (Math.abs(lx - 0.18) < 0.012 + CW * 0.3 / ht && ly < -0.6 && ly > -1.15) {
      set(i, '|', 80, 70, 60, br[i], bgc[i], bb[i]);
      return;
    }

    const sd = Math.hypot(lx + 0.55, ly + 1.05);
    if (sd < 0.09) {
      if (sd > 0.065) set(i, 'o', 230, 120, 100, 160, 50, 45);
      else set(i, sd < 0.025 ? '停' : ' ', 60, 40, 40, 220, 214, 194);
      return;
    }
    if (Math.abs(lx + 0.55) < CW * 0.4 / ht && ly > -0.96) {
      set(i, '|', 150, 150, 150, 60, 60, 64);
      return;
    }

    const inEar = [-1, 1].some(s => ((lx - s * 0.14) / 0.05) ** 2 + ((ly + 0.87) / 0.12) ** 2 < 1);
    const ny = (ly + 0.44) / 0.44;
    const rx = 0.31 + 0.06 * clamp(ny, -1, 1);
    const inBody = (lx / rx) ** 2 + ny * ny < 1;
    if (!inEar && !inBody) return;

    const lit = clamp(0.55 + lx * 1.2 - ly * 0.15, 0.3, 1) * (0.6 + 0.4 * moonVis);
    let R = 108 * lit, G = 116 * lit, B = 124 * lit;
    let ch = hash(c, r, 14) < 0.5 ? ' ' : '"';
    let fR = R * 0.75, fG = G * 0.75, fB = B * 0.75;

    const bx = lx / 0.25, by = (ly + 0.32) / 0.27;
    if (inBody && bx * bx + by * by < 1) {
      R = 205 * lit; G = 198 * lit; B = 172 * lit;
      fR = 90; fG = 90; fB = 88;
      ch = by < -0.35 && by > -0.75 && c % 2 === 0 ? '^' : ' ';
    }
    for (const s of [-1, 1]) {
      const ex = Math.hypot(lx - s * 0.12, ly + 0.68);
      if (ex < 0.05) {
        if (blink) { R = 60; G = 64; B = 70; ch = '-'; fR = fG = fB = 20; }
        else if (ex < 0.022) { R = G = B = 15; ch = '.'; fR = fG = fB = 255; }
        else { R = G = B = 245; ch = ' '; }
      }
      if (inBody && Math.abs(lx) > 0.19 && Math.abs(lx) < 0.32 && Math.abs(ly + 0.64 + (Math.abs(lx) - 0.19) * 0.1) < 0.012 + CH * 0.3 / ht) {
        ch = '-'; fR = fG = fB = 30;
      }
    }
    if (Math.abs(lx) < 0.03 && Math.abs(ly + 0.73) < 0.02) { ch = '^'; fR = fG = fB = 20; R = G = B = 40; }
    set(i, ch, fR, fG, fB, R, G, B);
  });
}

function drawCatbus(t) {
  const cx = W * 0.4 + Math.sin(t * 0.25) * W * 0.04;
  const cy = roadY - 0.81 * u - Math.abs(Math.sin(legPhase)) * 0.04 * u;
  const tick = Math.floor(t * 5);

  forCells(cx - 1.6 * u, roadY - 0.06 * u, cx + 1.8 * u, roadY + 0.08 * u, (x, y, i) => {
    const e = ((x - cx - 0.1 * u) / (1.7 * u)) ** 2 + ((y - roadY) / (0.07 * u)) ** 2;
    if (e < 1) { br[i] *= 0.45; bgc[i] *= 0.45; bb[i] *= 0.5; fr[i] *= 0.5; fgc[i] *= 0.5; fb[i] *= 0.5; }
  });

  const tail = [];
  for (let k = 0; k <= 12; k++) {
    const s = k / 12;
    const wag = Math.sin(t * 4 - s * 2.5) * 0.14 * s;
    tail.push([(-1.38 - 0.5 * s + 0.35 * s * s * s + wag) * u, (-0.15 - 1.0 * s + 0.1 * s * s) * u]);
  }

  const legs = [];
  for (const side of [0, 1]) {
    for (let k = 0; k < 6; k++) {
      const ph = legPhase + k * 1.05 + side * Math.PI;
      const hx = (-1.15 + k * 0.43) * u, hy = 0.3 * u;
      const fx = hx + 0.25 * u * Math.sin(ph);
      const fy = hy + 0.42 * u - Math.max(0, Math.cos(ph)) * 0.14 * u;
      const kx = (hx + fx) / 2 + 0.07 * u, ky = (hy + fy) / 2;
      legs.push({ side, hx, hy, kx, ky, fx, fy });
    }
  }

  const ears = [
    [[0.78, -0.45], [1.08, -0.6], [0.82, -0.94]],
    [[1.3, -0.62], [1.58, -0.48], [1.5, -0.92]],
  ].map(p => p.map(([a, b]) => [a * u, b * u]));
  const innerEars = ears.map(p => {
    const mx = (p[0][0] + p[1][0] + p[2][0]) / 3, my = (p[0][1] + p[1][1] + p[2][1]) / 3;
    return p.map(([a, b]) => [mx + (a - mx) * 0.5, my + (b - my) * 0.5 + 0.03 * u]);
  });
  const whiskers = [[2.15, -0.16], [2.25, 0.02], [2.1, 0.2]].map(([a, b]) => [a * u, b * u]);

  forCells(cx - 2.0 * u, cy - 1.3 * u, cx + 2.35 * u, cy + 0.85 * u, (x, y, i, c, r) => {
    const lx = x - cx, ly = y - cy;
    const fz = (vnoise(lx * 0.07, ly * 0.07) - 0.5) * CW * 1.3;
    const furCh = FUR[Math.floor(hash(Math.floor(lx / CW), Math.floor(ly / CH), 15) * FUR.length)];

    let legD = Infinity, legSide = 0, paw = false;
    for (const L of legs) {
      const dl = Math.min(sdSegment(lx, ly, L.hx, L.hy, L.kx, L.ky), sdSegment(lx, ly, L.kx, L.ky, L.fx, L.fy)) - 0.075 * u;
      const dp = Math.hypot(lx - L.fx, ly - L.fy) - 0.095 * u;
      const dd = Math.min(dl, dp);
      if (dd + fz < 0 && (legD + fz >= 0 || L.side === 1)) { legD = dd; legSide = L.side; paw = dp < dl; }
    }

    const dBody = sdRoundBox(lx + 0.12 * u, ly, 1.35 * u, 0.46 * u, 0.42 * u);
    const dHead = Math.hypot(lx - 1.15 * u, ly + 0.08 * u) - 0.55 * u;
    let dTail = Infinity;
    for (let k = 0; k < tail.length - 1; k++) {
      const s = k / 12;
      dTail = Math.min(dTail, sdSegment(lx, ly, tail[k][0], tail[k][1], tail[k + 1][0], tail[k + 1][1]) - 0.13 * u * (1 - 0.35 * s));
    }
    const d = Math.min(smin(dBody, dHead, 0.2 * u), dTail);
    const inBody = d + fz < 0;
    const inEar = inPolygon(lx, ly, ears[0]) || inPolygon(lx, ly, ears[1]);

    const sx = (lx - 1.17 * u) / (0.19 * u), sy = (ly + 0.74 * u) / (0.09 * u);
    if (Math.abs(sx) < 1 && Math.abs(sy) < 1) {
      flag[i] = 1;
      if (Math.abs(sx) > 0.88 || Math.abs(sy) > 0.7) {
        set(i, '=', 70, 45, 25, 110, 70, 35);
      } else {
        const pos = (sx + 1) / 2 * SIGN_TEXT.length;
        const k = Math.floor(pos);
        const centered = Math.abs(pos - k - 0.5) * (0.38 * u / SIGN_TEXT.length) < CW * 0.55 && Math.abs(sy) < 0.3;
        set(i, centered ? SIGN_TEXT[k] : ' ', 50, 30, 25, 245, 232, 195);
      }
      return;
    }

    if (!inBody && !inEar && legD === Infinity) {
      for (const [wx, wy] of whiskers) {
        if (sdSegment(lx, ly, 1.6 * u, 0.0, wx, wy) < CH * 0.35) {
          const sl = wy / (wx - 1.6 * u);
          set(i, sl < -0.12 ? '/' : sl > 0.12 ? '\\' : '-', 245, 235, 210, br[i], bgc[i], bb[i]);
          flag[i] = 1;
          return;
        }
      }
      return;
    }

    flag[i] = 1;
    if (legD !== Infinity && (legSide === 1 || !inBody)) {
      if (!inBody || legSide === 1 && ly > 0.38 * u) {
        const k = legSide === 1 ? 1 : 0.62;
        if (paw) set(i, hash(c, r, 16) < 0.5 ? 'm' : 'w', 150 * k, 110 * k, 60 * k, 236 * k, 205 * k, 150 * k);
        else set(i, furCh, 120 * k, 75 * k, 30 * k, 200 * k, 135 * k, 60 * k);
        return;
      }
    }

    if (inEar && !inBody) {
      const inner = inPolygon(lx, ly, innerEars[0]) || inPolygon(lx, ly, innerEars[1]);
      if (inner) set(i, "'", 240, 170, 150, 210, 125, 112);
      else set(i, '^', 150, 95, 40, 205, 140, 60);
      return;
    }

    const eyes = [[1.18 * u, -0.28 * u, 0.14 * u, 0.14 * u], [1.58 * u, -0.25 * u, 0.07 * u, 0.13 * u]];
    for (const [ex, ey, rx, ry] of eyes) {
      const qx = (lx - ex) / rx, qy = (ly - ey) / ry;
      const e2 = qx * qx + qy * qy;
      if (e2 < 1.25) {
        if (e2 > 1) set(i, ' ', 0, 0, 0, 70, 40, 18);
        else if (Math.abs(qx + 0.15) < 0.22 && Math.abs(qy) < 0.8) set(i, '|', 255, 230, 120, 40, 30, 12);
        else if (Math.hypot(qx + 0.45, qy + 0.45) < 0.25) set(i, '*', 255, 255, 255, 255, 255, 230);
        else set(i, '@', 255, 250, 200, 255, 225, 90);
        return;
      }
    }

    const mx = 1.27 * u, mw = 0.42 * u;
    const q = (lx - mx) / mw;
    if (Math.abs(q) < 1 && d < -CW * 0.2) {
      const yc = 0.12 * u - 0.15 * u * q * q;
      const th = 0.085 * u * (1 - q * q) + 0.012 * u;
      if (Math.abs(ly - yc) < th) {
        const nearTop = ly - (yc - th) < CH * 0.9;
        const nearBot = (yc + th) - ly < CH * 0.9;
        if (nearTop) set(i, 'v', 250, 245, 230, 110, 40, 38);
        else if (nearBot && Math.abs(q) < 0.6) set(i, 'A', 245, 238, 222, 110, 40, 38);
        else set(i, ' ', 0, 0, 0, 92, 26, 30);
        return;
      }
    }

    if (Math.hypot(lx - 1.66 * u, ly + 0.08 * u) < 0.045 * u + CW * 0.3) {
      set(i, 'o', 120, 50, 50, 230, 130, 125);
      return;
    }

    for (let k = 0; k < 5; k++) {
      const wx = (-1.05 + k * 0.35) * u;
      const dw = sdRoundBox(lx - wx, ly + 0.08 * u, 0.13 * u, 0.15 * u, 0.05 * u);
      if (dw < 0) {
        const flick = 0.92 + 0.08 * Math.sin(t * 7 + k * 2 + hash(k, 0, 17) * 6);
        if (ly > 0.0 * u) set(i, '_', 150 * flick, 95 * flick, 40 * flick, 225 * flick, 160 * flick, 80 * flick);
        else set(i, hash(c, r, tick) < 0.1 ? '.' : ' ', 255, 240, 190, 255 * flick, 205 * flick, 115 * flick);
        return;
      }
      if (dw < CW * 0.8) {
        set(i, Math.abs(lx - wx) > 0.12 * u ? '|' : '=', 90, 50, 20, 120, 70, 28);
        return;
      }
    }

    const belly = smoothstep(0.05 * u, 0.4 * u, ly) * (dTail < dBody ? 0 : 1);
    const lit = clamp(0.95 - ly / u * 0.35 + (lx / u) * 0.05, 0.6, 1.15);
    const rim = clamp(-(d + fz) / (0.12 * u), 0, 1);
    let k = lit * (0.72 + 0.28 * rim);
    let R = lerp(212, 238, belly) * k, G = lerp(148, 206, belly) * k, B = lerp(60, 140, belly) * k;
    let ch = furCh, fRk = 0.72;
    const back = ly < -0.27 * u && lx < 0.75 * u;
    const tailStripe = dTail < dBody && Math.sin((ly / u) * 28) > 0.4;
    if (tailStripe || back && Math.sin(((lx + 0.4 * ly) / u) * (Math.PI * 2 / 0.22)) > 0.3) {
      R = 138 * k; G = 80 * k; B = 32 * k;
      ch = hash(c, r, 18) < 0.5 ? '#' : '%';
      fRk = 0.7;
    }
    if (rim < 0.6) {
      set(i, ly < 0 ? '^' : '"', Math.min(255, R * 1.25), Math.min(255, G * 1.2), Math.min(255, B * 1.15), R, G, B);
    } else {
      set(i, ch, R * fRk, G * fRk, B * fRk, R, G, B);
    }
  });

  return { ex: cx + 1.62 * u, ey: cy - 0.25 * u };
}

function computeBeam(eye) {
  const dir = 0.12, half = 0.3;
  forCells(eye.ex, 0, W, H, (x, y, i) => {
    const dx = x - eye.ex, dy = y - eye.ey;
    const a = Math.abs(Math.atan2(dy, dx) - dir);
    if (a > half) return;
    const dist = Math.hypot(dx, dy);
    beam[i] = Math.pow(1 - a / half, 1.6) * Math.min(1, dist / (u * 0.3)) * Math.exp(-dist / (W * 0.5));
  });
}

function applyBeam(t) {
  const tick = Math.floor(t * 8);
  const gain = 0.8 + rain * 0.5;
  for (let i = 0; i < n; i++) {
    const k = beam[i] * gain;
    if (k <= 0.01 || flag[i]) continue;
    br[i] += 255 * k * 0.42; bgc[i] += 210 * k * 0.42; bb[i] += 120 * k * 0.42;
    fr[i] += 255 * k * 0.8; fgc[i] += 225 * k * 0.8; fb[i] += 150 * k * 0.8;
    if (chs[i] === ' ' && hash(i, 0, tick) < 0.04 * k) chs[i] = '.';
  }
}

function drawFireflies(t, dt) {
  const vis = 1 - rain;
  for (const f of flies) {
    f.x += (-Lb * 0.25 + Math.sin(t * 0.6 + f.ph) * 30) * dt;
    f.y += Math.cos(t * 0.9 + f.ph * 1.3) * 18 * dt;
    const dx = mouse.x - f.x, dy = mouse.y - f.y, dist = Math.hypot(dx, dy);
    if (dist < 260 && dist > 1) {
      const pull = (1 - dist / 260) * 260 * dt;
      f.x += dx / dist * pull + Math.cos(t * 3 + f.ph) * 40 * dt;
      f.y += dy / dist * pull + Math.sin(t * 3 + f.ph) * 40 * dt;
    }
    if (f.x < -30) { f.x = W + 30; f.y = rand(horizon, H); }
    if (f.x > W + 60) f.x = -20;
    f.y = clamp(f.y, horizon - H * 0.15, H);
    if (vis < 0.05) continue;

    const g = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + f.ph * 3), 2) * vis;
    forCells(f.x - CW * 2.5, f.y - CH * 2, f.x + CW * 2.5, f.y + CH * 2, (x, y, i) => {
      const fall = Math.max(0, 1 - Math.hypot((x - f.x) / (CW * 2.5), (y - f.y) / (CH * 2)));
      br[i] += 90 * g * fall; bgc[i] += 115 * g * fall; bb[i] += 30 * g * fall;
    });
    const i = cellIndex(f.x, f.y);
    if (i >= 0 && g > 0.1) set(i, g > 0.6 ? '*' : g > 0.3 ? '+' : '.', 230 * g + 25, 255 * g, 140 * g, br[i], bgc[i], bb[i]);
  }
}

function drawRain(t) {
  if (rain < 0.02) return;
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < 3; k++) {
      if (hash(c, k, 5) > rain * 0.85) continue;
      const v = H * (1.1 + hash(c, k, 2) * 0.7);
      const y0 = ((t * v + hash(c, k, 9) * H * 3) % (H * 1.3)) - H * 0.15;
      const r0 = Math.floor(y0 / CH);
      for (let rr = r0 - 1; rr <= r0; rr++) {
        if (rr < 0 || rr >= rows) continue;
        const i = rr * cols + c;
        const a = rr === r0 ? 0.85 : 0.45;
        set(i, rr === r0 ? '|' : "'", 150 * a + br[i] * 0.4, 172 * a + bgc[i] * 0.4, 210 * a + bb[i] * 0.4, br[i], bgc[i], bb[i]);
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

  cols = Math.ceil(W / CW);
  rows = Math.ceil(H / CH);
  n = cols * rows;
  chs = new Array(n).fill(' ');
  fr = new Float32Array(n); fgc = new Float32Array(n); fb = new Float32Array(n);
  br = new Float32Array(n); bgc = new Float32Array(n); bb = new Float32Array(n);
  flag = new Uint8Array(n);
  beam = new Float32Array(n);

  off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  offCtx = off.getContext('2d');
  img = offCtx.createImageData(cols, rows);

  horizon = H * 0.56;
  roadY = H * 0.84;
  Lb = clamp(Math.min(W * 0.46, H * 0.75), 220, 640);
  u = Lb * 0.34;
  moon = { x: W * 0.76, y: H * 0.17, r: clamp(Math.min(W, H) * 0.075, 28, 80) };

  vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
  vignette.addColorStop(0, 'rgba(4, 6, 18, 0)');
  vignette.addColorStop(1, 'rgba(4, 6, 18, 0.55)');

  flies = Array.from({ length: Math.round(clamp(W * H / 28000, 12, 60)) }, () => ({
    x: rand(0, W), y: rand(horizon - H * 0.1, H), ph: rand(0, Math.PI * 2),
  }));
}

function styleFor(r, g, b) {
  r = clamp(r, 0, 255) >> 3; g = clamp(g, 0, 255) >> 3; b = clamp(b, 0, 255) >> 3;
  const key = (r << 10) | (g << 5) | b;
  let s = styleCache.get(key);
  if (!s) {
    s = `rgb(${r << 3},${g << 3},${b << 3})`;
    styleCache.set(key, s);
  }
  return s;
}

function draw() {
  const data = img.data;
  for (let i = 0; i < n; i++) {
    data[i * 4] = br[i];
    data[i * 4 + 1] = bgc[i];
    data[i * 4 + 2] = bb[i];
    data[i * 4 + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, cols * CW, rows * CH);

  ctx.font = `${CH - 1}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let last = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const ch = chs[i];
      if (ch === ' ') continue;
      const s = styleFor(fr[i], fgc[i], fb[i]);
      if (s !== last) { ctx.fillStyle = s; last = s; }
      ctx.fillText(ch, c * CW + CW / 2, r * CH + CH / 2 + 1);
    }
  }

  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

let lastT = performance.now();
function loop(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  const t = now / 1000;
  const speed = Lb * 0.8 * (reducedMotion ? 0.3 : 1);
  S += speed * dt;
  legPhase += dt * speed * Math.PI / (0.5 * u);
  rain += (rainTarget - rain) * Math.min(1, dt * 0.6);

  drawLandscape(t);
  drawTree();
  drawPoles();
  drawTotoro(t);
  const eye = drawCatbus(t);
  drawFireflies(t, dt);
  drawRain(t);
  computeBeam(eye);
  applyBeam(t);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
window.addEventListener('click', () => { rainTarget = rainTarget ? 0 : 1; });

resize();
requestAnimationFrame(loop);
