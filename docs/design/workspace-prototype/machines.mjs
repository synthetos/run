// Blueprint-style machine illustrations, built from simple solids and drawn
// as hidden-line SVG. Each drawing is authored from the general, public
// arrangement of the machine family; none is a dimensioned drawing of a
// product, and no maker's artwork is used.
import { camera } from './scene.mjs';

const NS = 'http://www.w3.org/2000/svg';
const dot = (p, v) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
const el = (name, attrs) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

class Drawing {
  constructor(az = -36, elev = 30) { this.cam = camera(az, elev); this.items = []; }
  P(p) { return [dot(p, this.cam.r), -dot(p, this.cam.u)]; }
  depth(p) { return dot(p, this.cam.c); }
  // Axis-aligned box. tone: 'part' | 'dark' | 'accent' | 'bed' | 'ghost'
  box(x0, y0, z0, x1, y1, z1, tone = 'part', opts = {}) {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0]; if (z0 > z1) [z0, z1] = [z1, z0];
    this.items.push({ kind: 'box', b: [x0, y0, z0, x1, y1, z1], tone, opts, d: opts.d ?? this.depth([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]) + (opts.bias || 0) });
    return this;
  }
  cyl(axis, c, r, len, tone = 'part', opts = {}) {
    const mid = [...c]; mid['xyz'.indexOf(axis)] += len / 2;
    this.items.push({ kind: 'cyl', axis, c, r, len, tone, opts, d: opts.d ?? this.depth(mid) + (opts.bias || 0) });
    return this;
  }
  lines(pts, cls = 'detail', opts = {}) { this.items.push({ kind: 'lines', pts, cls, opts, d: opts.d ?? this.depth(pts[0]) + (opts.bias || 0) }); return this; }
  // A strip of extrusion with slot lines along its length.
  extrusion(axis, x, y, z, len, w, h, tone = 'part', opts = {}) {
    const b = axis === 'x' ? [x, y, z, x + len, y + w, z + h] : axis === 'y' ? [x, y, z, x + w, y + len, z + h] : [x, y, z, x + w, y + h, z + len];
    this.box(...b, tone, { ...opts, slots: axis });
    return this;
  }
  stepper(x, y, z, facing = 'z', size = 42) {
    const s = size / 2;
    if (facing === 'z') { this.box(x - s, y - s, z, x + s, y + s, z + size * 0.9, 'dark', { motor: true }); this.cyl('z', [x, y, z + size * 0.9], 11, 2, 'part'); this.cyl('z', [x, y, z + size * 0.9 + 2], 2.5, 10, 'part'); }
    if (facing === '-y') { this.box(x - s, y, z - s, x + s, y + size * 0.9, z + s, 'dark', { motor: true }); this.cyl('y', [x, y - 2, z], 11, 2, 'part'); }
    if (facing === 'x') { this.box(x - size * 0.9, y - s, z - s, x, y + s, z + s, 'dark', { motor: true }); this.cyl('x', [x, y, z], 11, 2, 'part'); }
    if (facing === '-x') { this.box(x, y - s, z - s, x + size * 0.9, y + s, z + s, 'dark', { motor: true }); this.cyl('x', [x - 2, y, z], 11, 2, 'part'); }
    if (facing === 'y') { this.box(x - s, y - size * 0.9, z - s, x + s, y, z + s, 'dark', { motor: true }); this.cyl('y', [x, y, z], 11, 2, 'part'); }
    return this;
  }
  router(x, y, zTip, style = 'router') {
    if (style === 'router') {
      this.cyl('z', [x, y, zTip], 1.6, 14, 'part');
      this.cyl('z', [x, y, zTip + 12], 9, 16, 'part');
      this.cyl('z', [x, y, zTip + 26], 44, 150, 'accent', { rings: [0.18, 0.72, 0.84] });
      this.cyl('z', [x, y, zTip + 176], 34, 40, 'dark', { rings: [0.5] });
    } else { // water-cooled spindle
      this.cyl('z', [x, y, zTip], 1.6, 14, 'part');
      this.cyl('z', [x, y, zTip + 12], 11, 12, 'part');
      this.cyl('z', [x, y, zTip + 22], 40, 170, 'accent', { rings: [0.12, 0.88] });
      this.cyl('z', [x, y, zTip + 172], 20, 14, 'part');
      this.cyl('y', [x + 18, y - 34, zTip + 140], 4, 10, 'part');
      this.cyl('y', [x - 18, y - 34, zTip + 140], 4, 10, 'part');
    }
    return this;
  }
  render(svg, { pad = 18 } = {}) {
    svg.replaceChildren();
    this.items.sort((a, b) => a.d - b.d);
    const all = [];
    const g = el('g', {});
    // A soft footprint shadow grounds the machine.
    const boxes = this.items.filter((it) => it.kind === 'box' && it.tone !== 'ghost');
    if (boxes.length) {
      const x0 = Math.min(...boxes.map((b) => b.b[0])), x1 = Math.max(...boxes.map((b) => b.b[3])), y0 = Math.min(...boxes.map((b) => b.b[1])), y1 = Math.max(...boxes.map((b) => b.b[4]));
      const pad = 40; const pts = [[x0 - pad, y0 - pad * 2, 0], [x1 + pad, y0 - pad * 2, 0], [x1 + pad, y1 + pad, 0], [x0 - pad, y1 + pad, 0]].map((p) => this.P(p));
      g.append(el('path', { d: this.path(pts), class: 'ground' }));
    }
    for (const it of this.items) {
      if (it.kind === 'box') this.drawBox(g, it, all);
      else if (it.kind === 'cyl') this.drawCyl(g, it, all);
      else this.drawLines(g, it, all);
    }
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [x, y] of all) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    svg.setAttribute('viewBox', `${(minx - pad).toFixed(1)} ${(miny - pad).toFixed(1)} ${(maxx - minx + pad * 2).toFixed(1)} ${(maxy - miny + pad * 2).toFixed(1)}`);
    svg.append(g);
  }
  path(pts, close = true) { return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + (close ? 'Z' : ''); }
  drawBox(g, it, all) {
    const [x0, y0, z0, x1, y1, z1] = it.b; const c = this.cam.c;
    const faces = [
      ['top', [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ['bot', [0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
      ['front', [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      ['back', [0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
      ['left', [-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      ['right', [1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    ];
    for (const [name, n, pts] of faces) {
      if (dot(n, c) <= 1e-6) continue;
      const shade = name === 'top' ? 's1' : name === 'front' || name === 'back' ? 's2' : 's3';
      const pp = pts.map((p) => this.P(p)); all.push(...pp);
      g.append(el('path', { d: this.path(pp), class: `face ${it.tone} ${shade}` }));
      // decorations on a face
      if (it.opts.slots && name !== 'bot') this.slotLines(g, it, name);
      if (it.opts.motor && name !== 'bot') { const inset = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t); const q = [inset(pts[0], pts[2], 0.12), inset(pts[1], pts[3], 0.12), inset(pts[2], pts[0], 0.12), inset(pts[3], pts[1], 0.12)]; if (name !== 'top') g.append(el('path', { d: this.path([pts[0], pts[1], pts[2], pts[3]].map((p, i) => this.P(inset(p, pts[(i + 2) % 4], 0.0)))), class: 'detail' })); if (name === 'top') g.append(el('path', { d: this.path(q.map((p) => this.P(p))), class: 'detail faint' })); }
      if (it.opts.grid && name === 'top') this.gridLines(g, it, pts);
      if (it.opts.tslots && name === 'top') this.tslotLines(g, it);
    }
  }
  slotLines(g, it, face) {
    const [x0, y0, z0, x1, y1, z1] = it.b; const ax = it.opts.slots; const n = it.opts.slotCount || 1;
    const seg = (a, b) => g.append(el('path', { d: this.path([this.P(a), this.P(b)], false), class: 'detail faint' }));
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      if (ax === 'x') {
        if (face === 'top') seg([x0, y0 + (y1 - y0) * t, z1], [x1, y0 + (y1 - y0) * t, z1]);
        if (face === 'front' || face === 'back') { const y = face === 'front' ? y0 : y1; seg([x0, y, z0 + (z1 - z0) * t], [x1, y, z0 + (z1 - z0) * t]); }
      } else if (ax === 'y') {
        if (face === 'top') seg([x0 + (x1 - x0) * t, y0, z1], [x0 + (x1 - x0) * t, y1, z1]);
        if (face === 'left' || face === 'right') { const x = face === 'left' ? x0 : x1; seg([x, y0, z0 + (z1 - z0) * t], [x, y1, z0 + (z1 - z0) * t]); }
      } else {
        if (face === 'front' || face === 'back') { const y = face === 'front' ? y0 : y1; seg([x0 + (x1 - x0) * t, y, z0], [x0 + (x1 - x0) * t, y, z1]); }
        if (face === 'left' || face === 'right') { const x = face === 'left' ? x0 : x1; seg([x, y0 + (y1 - y0) * t, z0], [x, y0 + (y1 - y0) * t, z1]); }
      }
    }
  }
  gridLines(g, it) {
    const [x0, y0, , x1, y1, z1] = it.b; const s = it.opts.grid;
    const parts = [];
    for (let x = x0 + s; x < x1 - 1; x += s) parts.push([this.P([x, y0, z1]), this.P([x, y1, z1])]);
    for (let y = y0 + s; y < y1 - 1; y += s) parts.push([this.P([x0, y, z1]), this.P([x1, y, z1])]);
    g.append(el('path', { d: parts.map(([a, b]) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`).join(''), class: 'detail faint' }));
  }
  tslotLines(g, it) {
    const [x0, y0, , x1, y1, z1] = it.b; const { axis, count } = it.opts.tslots;
    const d = [];
    for (let k = 1; k <= count; k++) {
      const t = k / (count + 1);
      if (axis === 'y') { const x = x0 + (x1 - x0) * t; for (const o of [-5, 5]) { const a = this.P([x + o, y0, z1]), b = this.P([x + o, y1, z1]); d.push(`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`); } }
      else { const y = y0 + (y1 - y0) * t; for (const o of [-5, 5]) { const a = this.P([x0, y + o, z1]), b = this.P([x1, y + o, z1]); d.push(`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`); } }
    }
    g.append(el('path', { d: d.join(''), class: 'detail' }));
  }
  drawCyl(g, it, all) {
    const { axis, c, r, len } = it; const ai = 'xyz'.indexOf(axis);
    const u = axis === 'z' ? [1, 0, 0] : [0, 0, 1], v = axis === 'x' ? [0, 1, 0] : axis === 'y' ? [1, 0, 0] : [0, 1, 0];
    const ring = (t) => Array.from({ length: 36 }, (_, k) => { const a = k / 36 * Math.PI * 2; const p = [...c]; p[ai] += t; return p.map((val, i) => val + r * (Math.cos(a) * u[i] + Math.sin(a) * v[i])); });
    const r0 = ring(0), r1 = ring(len);
    const pts = [...r0, ...r1].map((p) => this.P(p)); all.push(...pts);
    const hull = convexHull(pts);
    g.append(el('path', { d: this.path(hull), class: `face ${it.tone} s2` }));
    const axisDir = [0, 0, 0]; axisDir[ai] = 1;
    const capFront = dot(axisDir, this.cam.c) > 0 ? r1 : r0;
    const visible = (t) => { const rr = ring(t); return rr.map((p, k) => { const a = k / 36 * Math.PI * 2; const n = u.map((val, i) => Math.cos(a) * val + Math.sin(a) * v[i]); return dot(n, this.cam.c) > 0 ? this.P(p) : null; }); };
    for (const t of it.opts.rings || []) {
      const vis = visible(len * t); let d = ''; let pen = false;
      for (let k = 0; k <= 36; k++) { const p = vis[k % 36]; if (p) { d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; pen = true; } else pen = false; }
      g.append(el('path', { d, class: 'detail faint' }));
    }
    if (Math.abs(dot(axisDir, this.cam.c)) > 0.02) g.append(el('path', { d: this.path(capFront.map((p) => this.P(p))), class: `face ${it.tone} s1` }));
  }
  drawLines(g, it, all) {
    const pp = it.pts.map((p) => this.P(p)); all.push(...pp);
    g.append(el('path', { d: this.path(pp, !!it.opts.close), class: it.cls }));
  }
}

function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Each machine family, from its well-known public arrangement.
const builders = {
  // Belt-driven gantry on wide aluminium side rails, low steel feet, the
  // router hanging in front of a single wide X rail.
  xcarve(d) {
    const W = 860, D = 820;
    for (const x of [0, W - 40]) d.extrusion('y', x, 0, 18, D, 40, 40, 'part', { slotCount: 2 });
    d.box(0, -12, 0, W, 0, 70, 'part'); d.box(0, D, 0, W, D + 12, 70, 'part');
    d.box(40, 20, 18, W - 40, D - 20, 36, 'bed', { grid: 70 });
    const gy = 360;
    for (const x of [-14, W]) { d.box(x, gy - 50, 40, x + 14, gy + 80, 230, 'part'); d.lines([[x + (x < 0 ? 0 : 14), gy - 30, 70], [x + (x < 0 ? 0 : 14), gy + 60, 70]], 'detail faint'); }
    d.extrusion('x', 0, gy, 170, W, 40, 60, 'part', { slotCount: 2 });
    d.extrusion('x', 0, gy, 120, W, 40, 40, 'part', { slotCount: 1 });
    d.stepper(-14, gy + 20, 205, '-x'); d.stepper(W + 14, gy + 20, 205, 'x');
    d.box(370, gy - 28, 110, 490, gy, 240, 'part');
    d.box(395, gy - 64, 120, 465, gy - 28, 220, 'part');
    d.stepper(430, gy - 46, 240, 'z');
    d.router(430, gy - 100, 70, 'router');
    for (let k = 0; k < 9; k++) d.box(560 + k * 30, gy + 30, 236, 588 + k * 30, gy + 60, 252, 'dark');
  },
  // Rigid desktop router: deep rectangular rails, a tall boxy X beam with
  // steel end plates, a hybrid T-slot table.
  shapeoko(d) {
    const W = 820, D = 820;
    for (const x of [0, W - 60]) d.box(x, 0, 0, x + 60, D, 90, 'part', { slots: 'y', slotCount: 2 });
    d.box(-10, -14, 0, W + 10, 0, 110, 'part'); d.box(-10, D, 0, W + 10, D + 14, 110, 'part');
    d.box(60, 10, 0, W - 60, D - 10, 40, 'bed', { tslots: { axis: 'x', count: 6 } });
    const gy = 380;
    for (const x of [-16, W]) d.box(x, gy - 70, 70, x + 16, gy + 110, 330, 'part');
    d.box(0, gy, 210, W, gy + 90, 320, 'part', { slots: 'x', slotCount: 3 });
    d.stepper(-16, gy + 30, 270, '-x'); d.stepper(W + 16, gy + 30, 270, 'x');
    d.box(340, gy - 34, 170, 480, gy, 340, 'part');
    d.box(360, gy - 80, 150, 460, gy - 34, 310, 'part');
    d.stepper(410, gy - 57, 340, 'z');
    d.router(410, gy - 116, 72, 'router');
  },
  // Lead-screw machine framed in C-beam on all four sides; Y motors at the
  // front of each rail, the screws visible inside the rails.
  lead(d) {
    const W = 820, D = 820;
    for (const x of [0, W - 80]) { d.box(x, 0, 0, x + 80, D, 40, 'part', { slots: 'y', slotCount: 3 }); }
    d.extrusion('x', 80, 0, 0, W - 160, 40, 40, 'part', { slotCount: 1 }); d.extrusion('x', 80, D - 40, 0, W - 160, 40, 40, 'part', { slotCount: 1 });
    d.box(80, 40, 0, W - 80, D - 40, 22, 'bed', { grid: 80 });
    for (const x of [40, W - 40]) { d.cyl('y', [x, 0, 54], 4, D, 'part', { bias: 50 }); d.stepper(x, -48, 54, '-y'); }
    const gy = 400;
    for (const x of [-10, W - 90]) d.box(x, gy - 60, 40, x + 100, gy + 60, 60, 'part');
    for (const x of [-10, W]) d.box(x, gy - 60, 60, x + 10, gy + 60, 240, 'part');
    d.box(0, gy, 150, W, gy + 40, 230, 'part', { slots: 'x', slotCount: 3 });
    d.cyl('x', [0, gy - 6, 190], 4, W, 'part', { bias: -5 });
    d.stepper(W + 10, gy + 20, 190, 'x');
    d.box(360, gy - 40, 130, 460, gy - 6, 250, 'part');
    d.box(380, gy - 80, 120, 440, gy - 40, 230, 'part');
    d.stepper(410, gy - 60, 250, 'z');
    d.router(410, gy - 116, 60, 'router');
  },
  // Raised rails and tall gantry plates; dual X beams and lead screws, a
  // generous Z for thicker stock.
  workbee(d) {
    const W = 820, D = 820;
    for (const x of [0, W - 40]) { d.extrusion('y', x, 0, 70, D, 40, 80, 'part', { slotCount: 3 }); for (const y of [30, D - 70]) d.box(x, y, 0, x + 40, y + 40, 70, 'part'); }
    d.box(30, 20, 0, W - 30, D - 20, 24, 'bed', { grid: 100 });
    for (const x of [20, W - 20]) { d.cyl('y', [x, 0, 165], 4, D, 'part', { bias: 40 }); d.stepper(x, -48, 165, '-y'); }
    const gy = 400;
    for (const x of [-16, W]) { d.box(x, gy - 90, 120, x + 16, gy + 90, 420, 'part'); d.lines([[x + (x < 0 ? 0 : 16), gy - 60, 380], [x + (x < 0 ? 0 : 16), gy + 60, 380]], 'detail faint'); }
    d.extrusion('x', 0, gy, 340, W, 40, 80, 'part', { slotCount: 3 });
    d.extrusion('x', 0, gy, 240, W, 40, 80, 'part', { slotCount: 3 });
    d.cyl('x', [0, gy - 6, 330], 4, W, 'part', { bias: -5 });
    d.stepper(W + 16, gy + 20, 330, 'x');
    d.box(350, gy - 40, 210, 470, gy - 6, 400, 'part');
    d.box(370, gy - 90, 170, 450, gy - 40, 340, 'part');
    d.stepper(410, gy - 65, 400, 'z');
    d.router(410, gy - 124, 100, 'router');
  },
  // Fixed gantry on two solid side plates; the T-slot table moves under it
  // on a ball screw. Water-cooled spindle.
  router6040(d) {
    const W = 560, D = 860;
    d.box(0, 0, 0, W, D, 70, 'part');
    d.stepper(W / 2, D + 2, 35, 'y');
    d.box(30, 160, 70, W - 30, 640, 110, 'bed', { tslots: { axis: 'y', count: 5 } });
    const gy = 380;
    for (const x of [-30, W]) { d.box(x, gy - 150, 0, x + 30, gy + 120, 380, 'part'); d.lines([[x + (x < 0 ? 0 : 30), gy - 150, 120], [x + (x < 0 ? 0 : 30), gy - 80, 380]], 'detail faint'); }
    d.box(-30, gy, 290, W + 30, gy + 110, 420, 'part', { slots: 'x', slotCount: 2 });
    d.stepper(W + 30, gy + 55, 355, 'x');
    d.box(200, gy - 44, 250, 360, gy, 440, 'part');
    d.box(225, gy - 100, 200, 335, gy - 44, 380, 'part');
    d.stepper(280, gy - 72, 380, 'z');
    d.router(280, gy - 150, 130, 'spindle');
  },
  // A blank sheet: the machine is drawn as construction lines to be filled in.
  custom(d) {
    const W = 820, D = 820;
    const ghost = (x0, y0, z0, x1, y1, z1) => d.box(x0, y0, z0, x1, y1, z1, 'ghost');
    for (const x of [0, W - 40]) ghost(x, 0, 0, x + 40, D, 50);
    ghost(40, 20, 0, W - 40, D - 20, 24);
    const gy = 400;
    for (const x of [-14, W]) ghost(x, gy - 60, 50, x + 14, gy + 80, 250);
    ghost(0, gy, 170, W, gy + 40, 240);
    ghost(370, gy - 40, 130, 470, gy, 280);
    d.lines([[0, -60, 0], [W, -60, 0]], 'dim'); d.lines([[W + 70, 0, 0], [W + 70, D, 0]], 'dim'); d.lines([[W + 70, D, 0], [W + 70, D, 260]], 'dim');
    d.lines([[0, -75, 0], [0, -45, 0]], 'dim'); d.lines([[W, -75, 0], [W, -45, 0]], 'dim');
    d.cyl('z', [420, gy - 80, 60], 30, 120, 'ghost');
  },
};

export const catalogue = [
  { id: 'xcarve', name: 'X-Carve', drive: 'belt', blurb: 'Belt-driven gantry on wide aluminium rails. Pick your size and mechanical revision.', size: '500 mm and 1000 mm frames', note: 'Usually a GRBL controller: conversion to TinyG needs wiring review' },
  { id: 'shapeoko', name: 'Shapeoko', drive: 'belt', blurb: 'Rigid desktop router with a deep X beam and hybrid table.', size: 'Standard, XL and XXL footprints', note: 'Ships with its own controller: conversion required' },
  { id: 'lead', name: 'OpenBuilds LEAD', drive: 'screw', blurb: 'Lead screws on all axes, framed in C-beam extrusion.', size: '1010 and 1515', note: 'Kit build: record your own motors and screws' },
  { id: 'workbee', name: 'OpenBuilds WorkBee', drive: 'screw', blurb: 'Tall gantry plates, raised rails and a generous Z travel.', size: '1010 to 1510', note: 'Kit build: record your own motors and screws' },
  { id: 'router6040', name: '3040 / 6040 router', drive: 'screw', blurb: 'Fixed gantry, moving T-slot table, ball screws and a water-cooled spindle.', size: '3040, 4060 and 6040 frames', note: 'Many electronics variants: verify before configuring' },
  { id: 'custom', name: 'Custom machine', drive: 'any', blurb: 'Start from a blank sheet. Describe the axes, drives and travel you built.', size: 'Any size', note: 'Every value is yours to measure and record' },
];

export function drawMachine(svg, id) {
  const d = new Drawing();
  builders[id](d);
  d.render(svg);
  svg.classList.add('machine-drawing');
}
