// Canvas 2D scene for the design study: bed, fixture, clamps, stock with a
// heightfield for material removal, toolpath and tool. Parallel projection,
// painter's order. Illustrative: it is not the interpreter and not a
// collision checker.
import { materials, sampleFixture, toolById } from './job.mjs';

const rad = (d) => d * Math.PI / 180;
export function camera(az, el) {
  const a = rad(az), e = rad(el);
  const r = [Math.cos(a), Math.sin(a), 0];
  const c = [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)];
  const u = [-Math.sin(e) * Math.sin(a), Math.sin(e) * Math.cos(a), Math.cos(e)];
  return { az, el, r, c, u };
}
const dot = (p, v) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function rgb(a, k = 1, alpha = 1) { return `rgba(${Math.round(a[0] * k)},${Math.round(a[1] * k)},${Math.round(a[2] * k)},${alpha})`; }
function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function parseColor(hex) { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }

export class Scene {
  constructor(canvas, state) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.state = state;
    this.cam = camera(-32, 34); this.zoom = 1; this.pan = [0, 0]; this.fitTarget = 'fixture';
    this.progress = 1; this.mode = 'both'; this.layers = { bed: true, fixture: true, stock: true, path: true };
    this.heights = null; this.dirty = true;
    const ro = new ResizeObserver(() => this.render()); ro.observe(canvas);
    this.bindPointer();
  }
  bindPointer() {
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, az: this.cam.az, el: this.cam.el }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const az = drag.az - (e.clientX - drag.x) * 0.35, el = Math.max(8, Math.min(90, drag.el + (e.clientY - drag.y) * 0.3));
      this.cam = camera(az, el); this.fast = true; this.render(); this.onCamera?.();
    });
    const end = () => { if (drag) { drag = null; this.fast = false; this.render(); } };
    this.canvas.addEventListener('pointerup', end); this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.4, Math.min(6, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); this.render(); }, { passive: false });
  }
  setView(name) {
    if (name === 'iso') this.cam = camera(-32, 34);
    if (name === 'top') this.cam = camera(0, 90);
    if (name === 'front') this.cam = camera(0, 12);
    if (name === 'fit') { this.zoom = 1; this.cam = camera(-32, 34); }
    this.render();
  }
  // World geometry from the setup. Bed top is z = 0.
  geometry() {
    const s = this.state.setup;
    const fx = s.fixtures[0];
    const plate = fx.outline ? fx : { ...fx, ...sampleFixture() };
    const fixtureTop = s.fixtures.length ? fx.height : 0;
    const st = s.stock;
    const thick = st.shape === 'sheet' ? Math.min(st.thickness, 25) : st.thickness;
    const w = st.shape === 'round' ? st.diameter : st.width, d = st.shape === 'round' ? st.diameter : st.depth;
    return { bed: s.bed, plate: s.fixtures.length ? plate : null, fixtureTop, stock: { x: st.x, y: st.y, z: fixtureTop, w, d, t: thick, shape: st.shape, material: materials[st.material] } };
  }
  // Heightfield: cell heights above the stock bottom, NaN outside a round blank.
  computeHeights() {
    const g = this.geometry().stock;
    const cell = Math.max(1, Math.max(g.w, g.d) / 170);
    const nx = Math.ceil(g.w / cell), ny = Math.ceil(g.d / cell);
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let v = g.t;
      if (g.shape === 'round') { const dx = (i + 0.5) * cell - g.w / 2, dy = (j + 0.5) * cell - g.d / 2; if (Math.hypot(dx, dy) > g.w / 2) v = NaN; }
      h[j * nx + i] = v;
    }
    const ops = this.state.removal?.() ?? [];
    for (const { op, upto } of ops) this.stamp(h, nx, ny, cell, g, op, upto);
    this.heights = { h, nx, ny, cell };
  }
  stamp(h, nx, ny, cell, g, op, upto) {
    const tool = toolById(op.tool); const r = tool.diameter / 2;
    const moves = op.moves; const last = Math.floor(upto * (moves.length - 1));
    const offX = 0, offY = 0; // toolpaths are in work coordinates from the stock corner
    const cut = (x, y, z) => {
      const zz = g.t + z; if (zz >= g.t) return;
      const i0 = Math.max(0, Math.floor((x - r) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r) / cell));
      const j0 = Math.max(0, Math.floor((y - r) / cell)), j1 = Math.min(ny - 1, Math.floor((y + r) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cell - x, dy = (j + 0.5) * cell - y; const dd = Math.hypot(dx, dy);
        if (dd > r) continue;
        let floor = zz;
        if (tool.type === 'ball') floor = zz + r - Math.sqrt(r * r - dd * dd);
        if (tool.type === 'vbit') floor = zz + dd / Math.tan(rad(tool.angle / 2));
        const k = j * nx + i; if (h[k] > floor) h[k] = Math.max(0, floor);
      }
    };
    for (let m = 1; m <= last; m++) {
      const [ax, ay, az] = moves[m - 1], [bx, by, bz, rapid] = moves[m];
      if (rapid) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell * 0.6)));
      for (let k = 0; k <= n; k++) cut(offX + ax + (bx - ax) * k / n, offY + ay + (by - ay) * k / n, az + (bz - az) * k / n);
    }
  }
  invalidate() { this.heights = null; this.render(); }
  project(p) { return [dot(p, this.cam.r) * this.scale + this.cx, -dot(p, this.cam.u) * this.scale + this.cy]; }
  render() {
    const cv = this.canvas; const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!this.heights) this.computeHeights();
    const g = this.geometry();
    this.colors = { ink: cssVar('--ink'), blue: cssVar('--blue'), muted: cssVar('--muted'), rule: cssVar('--rule'), grid: cssVar('--grid'), sheet: cssVar('--sheet'), wash: cssVar('--blue-wash'), field: cssVar('--field'), paper: cssVar('--paper'), run: cssVar('--state-run') };
    // Fit the camera to the fixture (or stock) bounds.
    const fit = this.fitTarget === 'bed' ? [0, 0, -g.bed.thickness, g.bed.width, g.bed.depth, 0]
      : this.fitTarget === 'stock' ? [g.stock.x - 26, g.stock.y - 26, g.fixtureTop - 4, g.stock.x + g.stock.w + 26, g.stock.y + g.stock.d + 26, g.fixtureTop + g.stock.t + 12]
      : g.plate ? [g.plate.x - 20, g.plate.y - 20, 0, g.plate.x + g.plate.width + 20, g.plate.y + g.plate.depth + 20, g.fixtureTop + g.stock.t + 30]
        : [g.stock.x - 40, g.stock.y - 40, 0, g.stock.x + g.stock.w + 40, g.stock.y + g.stock.d + 40, g.stock.t + 30];
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const x of [fit[0], fit[3]]) for (const y of [fit[1], fit[4]]) for (const z of [fit[2], fit[5]]) {
      const p = [x, y, z]; const sx = dot(p, this.cam.r), sy = -dot(p, this.cam.u);
      minx = Math.min(minx, sx); maxx = Math.max(maxx, sx); miny = Math.min(miny, sy); maxy = Math.max(maxy, sy);
    }
    const pad = this.compact ? 12 : Math.min(56, H * 0.1, W * 0.06); const bottomRoom = this.compact ? 0 : Math.min(54, H * 0.16);
    this.scale = Math.min((W - pad * 2) / (maxx - minx), (H - pad * 2 - bottomRoom) / (maxy - miny)) * this.zoom;
    this.cx = W / 2 - (minx + maxx) / 2 * this.scale; this.cy = (H - bottomRoom) / 2 + pad * 0.3 - (miny + maxy) / 2 * this.scale;
    if (this.layers.bed && this.fitTarget === 'bed') this.drawBed(g); else if (this.layers.bed) this.drawShadow(g);
    if (this.layers.fixture && g.plate) this.drawFixture(g);
    if (this.layers.stock && this.mode !== 'path') this.drawStock(g);
    if (this.layers.stock && this.mode !== 'path' && this.state.setup.clamps && g.stock.shape !== 'round') this.drawClamps(g);
    if (this.mode === 'path' && this.layers.stock) this.drawStockGhost(g);
    if (this.layers.path && this.mode !== 'result') this.drawPaths(g);
    this.drawZero(g);
    const at = this.state.toolAt?.(); if (at) this.drawTool(g, at);
  }
  poly(pts, fill, stroke, lw = 1) {
    const ctx = this.ctx; ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = this.project(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  line(a, b, stroke, lw = 1, dash) {
    const ctx = this.ctx; const [x1, y1] = this.project(a), [x2, y2] = this.project(b);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.setLineDash(dash || []); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
  }
  boxFaces(x0, y0, z0, x1, y1, z1, fills, stroke) {
    const c = this.cam.c;
    const faces = [
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], fills[0]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], fills[1]],
      [[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], fills[1]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], fills[2]],
      [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], fills[2]],
    ];
    for (const [n, pts, f] of faces) if (dot(n, c) > 1e-6) this.poly(pts, f, stroke);
  }
  drawBed(g) {
    const { width: W, depth: D, thickness: T } = g.bed; const C = this.colors;
    this.boxFaces(0, 0, -T, W, D, 0, [C.sheet, C.grid, C.grid], C.rule);
    const ctx = this.ctx; ctx.save(); ctx.globalAlpha = 0.9;
    for (let x = 50; x < W; x += 50) this.line([x, 0, 0], [x, D, 0], x % 250 ? C.grid : C.rule, 1);
    for (let y = 50; y < D; y += 50) this.line([0, y, 0], [W, y, 0], y % 250 ? C.grid : C.rule, 1);
    ctx.restore();
    const tr = this.state.machine.travel;
    this.poly([[15, 15, 0.1], [15 + tr.x, 15, 0.1], [15 + tr.x, 15 + tr.y, 0.1], [15, 15 + tr.y, 0.1]], null, C.field, 1);
  }
  drawShadow() { /* The canvas grid stands in for the bed when framing the stock. */ }
  drawFixture(g) {
    const p = g.plate; const C = this.colors; const top = g.fixtureTop; const c = this.cam.c;
    const pts = p.outline.map(([x, y]) => [p.x + x, p.y + y]);
    const steel = [176, 150, 118];
    // Side walls facing the camera, back to front.
    const walls = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const n = [b[1] - a[1], -(b[0] - a[0]), 0];
      if (dot(n, c) <= 0) continue;
      walls.push({ a, b, depth: dot([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0], c), shade: 0.78 + 0.12 * Math.sign(n[0] * this.cam.r[0] + n[1] * this.cam.r[1]) });
    }
    walls.sort((m, n) => m.depth - n.depth);
    for (const w of walls) this.poly([[w.a[0], w.a[1], 0], [w.b[0], w.b[1], 0], [w.b[0], w.b[1], top], [w.a[0], w.a[1], top]], rgb(steel, w.shade), rgb(steel, w.shade));
    this.poly(pts.map(([x, y]) => [x, y, top]), rgb(steel, 1.0), C.field, 1);
    for (const [hx, hy, hr] of p.holes) {
      const ring = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; ring.push([p.x + hx + hr * Math.cos(a), p.y + hy + hr * Math.sin(a), top + 0.05]); }
      this.poly(ring, rgb(steel, 0.62), null);
    }
    // Silhouette outline of the walls.
    for (const w of walls) this.line([w.a[0], w.a[1], 0], [w.b[0], w.b[1], 0], C.field, 1);
  }
  drawStock(g) {
    const { h, nx, ny, cell } = this.heights; const s = g.stock; const c = this.cam.c;
    const base = s.material.color; const alpha = s.material.name.includes('acrylic') ? 0.88 : 1;
    const lightTop = 1.0, wallX = 0.6, wallY = 0.74, floorK = 0.9;
    const order = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!Number.isNaN(h[j * nx + i])) order.push(j * nx + i);
    const depthOf = (k) => { const i = k % nx, j = (k - i) / nx; return c[0] * i * cell + c[1] * j * cell; };
    order.sort((a, b) => depthOf(a) - depthOf(b));
    const sx = c[0] > 0 ? 1 : -1, sy = c[1] > 0 ? 1 : -1; // neighbours toward the camera
    const ctx = this.ctx; ctx.lineJoin = 'round';
    const machined = mix(base, parseColor('#7f9cc0'), 0.18);
    const edge = 'rgba(20,34,44,.45)';
    let batchColor = null; let open = false;
    const flush = () => { if (open) { ctx.fillStyle = batchColor; ctx.strokeStyle = batchColor; ctx.lineWidth = 0.6; ctx.fill(); ctx.stroke(); open = false; } };
    const pathOf = (pts) => { pts.forEach((p, i) => { const [x, y] = this.project(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
    const quad = (pts, color) => { if (color !== batchColor) { flush(); batchColor = color; } if (!open) { ctx.beginPath(); open = true; } pathOf(pts); };
    const wall = (pts, color, a, b) => {
      flush(); ctx.beginPath(); pathOf(pts); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 0.6; ctx.fill(); ctx.stroke();
      const [x1, y1] = this.project(a), [x2, y2] = this.project(b); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = edge; ctx.lineWidth = 0.9; ctx.stroke();
    };
    for (const k of order) {
      const i = k % nx, j = (k - i) / nx; const z = s.z + h[k];
      const x0 = s.x + i * cell, y0 = s.y + j * cell, x1 = x0 + cell, y1 = y0 + cell;
      const cutK = h[k] < s.t - 0.01;
      const shade = cutK ? floorK - (s.t - h[k]) / s.t * 0.1 : lightTop;
      if (h[k] > 0.001) quad([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], rgb(cutK ? machined : base, shade, alpha));
      const ni = i + sx, nj = j + sy;
      const hx = ni >= 0 && ni < nx && !Number.isNaN(h[j * nx + ni]) ? h[j * nx + ni] : 0;
      const hy = nj >= 0 && nj < ny && !Number.isNaN(h[nj * nx + i]) ? h[nj * nx + i] : 0;
      if (hx < h[k] - 0.001) { const xe = sx > 0 ? x1 : x0; wall([[xe, y0, s.z + hx], [xe, y1, s.z + hx], [xe, y1, z], [xe, y0, z]], rgb(base, wallX, alpha), [xe, y0, z], [xe, y1, z]); }
      if (hy < h[k] - 0.001) { const ye = sy > 0 ? y1 : y0; wall([[x0, ye, s.z + hy], [x1, ye, s.z + hy], [x1, ye, z], [x0, ye, z]], rgb(base, wallY, alpha), [x0, ye, z], [x1, ye, z]); }
    }
    flush();
    // Crisp outline for the stock silhouette.
    ctx.save(); ctx.globalAlpha = 0.65;
    if (s.shape !== 'round') {
      const t = s.z + s.t; const L = this.colors.ink;
      this.poly([[s.x, s.y, t], [s.x + s.w, s.y, t], [s.x + s.w, s.y + s.d, t], [s.x, s.y + s.d, t]], null, L, 0.8);
    }
    ctx.restore();
  }
  drawStockGhost(g) {
    const s = g.stock; const C = this.colors; const t = s.z + s.t;
    if (s.shape === 'round') { const ring = []; for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2; ring.push([s.x + s.w / 2 + s.w / 2 * Math.cos(a), s.y + s.d / 2 + s.d / 2 * Math.sin(a), t]); } this.poly(ring, null, C.field, 1); return; }
    this.ctx.setLineDash([4, 4]);
    this.poly([[s.x, s.y, t], [s.x + s.w, s.y, t], [s.x + s.w, s.y + s.d, t], [s.x, s.y + s.d, t]], null, C.field, 1);
    this.poly([[s.x, s.y, s.z], [s.x + s.w, s.y, s.z], [s.x + s.w, s.y + s.d, s.z], [s.x, s.y + s.d, s.z]], null, C.field, 1);
    this.ctx.setLineDash([]);
  }
  drawClamps(g) {
    const s = g.stock; const t = s.z + s.t;
    const steel = [96, 108, 120];
    const clamps = [[s.x + s.w / 2 - 12, s.y - 14, 24, 22], [s.x + s.w / 2 - 12, s.y + s.d - 8, 24, 22], [s.x - 14, s.y + s.d / 2 - 12, 22, 24], [s.x + s.w - 8, s.y + s.d / 2 - 12, 22, 24]];
    const c = this.cam.c; clamps.sort((a, b) => (c[0] * a[0] + c[1] * a[1]) - (c[0] * b[0] + c[1] * b[1]));
    for (const [x, y, w, d] of clamps) {
      this.boxFaces(x, y, t, x + w, y + d, t + 7, [rgb(steel, 1.5), rgb(steel, 1.15), rgb(steel, 0.95)], rgb(steel, 0.8));
      const ring = []; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; ring.push([x + w / 2 + 3.5 * Math.cos(a), y + d / 2 + 3.5 * Math.sin(a), t + 7.05]); }
      this.poly(ring, rgb(steel, 0.7), null);
    }
  }
  drawPaths(g) {
    const s = g.stock; const ctx = this.ctx; const C = this.colors; const top = s.z + s.t;
    const paths = this.state.paths?.() ?? [];
    for (const { op, upto, emphasis } of paths) {
      const mv = op.moves; const last = Math.floor(upto * (mv.length - 1));
      const P = (m) => this.project([s.x + m[0], s.y + m[1], top + m[2] + 0.2]);
      // cut moves
      ctx.lineWidth = emphasis ? 1 : 0.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [from, to, color, alpha] of [[1, mv.length - 1, C.blue, emphasis ? (upto < 1 ? 0.22 : 0.5) : 0.16], [1, last, C.blue, upto < 1 ? 0.38 : 0.5]]) {
        if (to < from) continue;
        ctx.beginPath(); ctx.globalAlpha = alpha; ctx.strokeStyle = color;
        let pen = false;
        for (let m = from; m <= to; m++) {
          if (mv[m][3]) { pen = false; continue; }
          const [x0, y0] = P(mv[m - 1]), [x1, y1] = P(mv[m]);
          if (!pen) { ctx.moveTo(x0, y0); pen = true; }
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
        if (upto >= 1) break;
      }
      // rapids
      if (emphasis) {
        ctx.beginPath(); ctx.globalAlpha = 0.55; ctx.setLineDash([3, 4]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
        for (let m = 1; m < mv.length; m++) if (mv[m][3]) { const [x0, y0] = P(mv[m - 1]), [x1, y1] = P(mv[m]); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
  }
  drawZero(g) {
    const s = g.stock; const t = s.z + s.t; const C = this.colors; const ctx = this.ctx;
    const o = [s.x, s.y, t]; const L = 22 / Math.max(this.scale, 0.3) * 1.2;
    const axes = [['X', [L, 0, 0]], ['Y', [0, L, 0]], ['Z', [0, 0, L]]];
    ctx.font = '600 11px "IBM Plex Sans", sans-serif';
    for (const [name, v] of axes) {
      const end = [o[0] + v[0], o[1] + v[1], o[2] + v[2]];
      this.line(o, end, C.ink, 1.6);
      const [x, y] = this.project([o[0] + v[0] * 1.25, o[1] + v[1] * 1.25, o[2] + v[2] * 1.25]);
      ctx.fillStyle = C.ink; ctx.fillText(name, x - 3, y + 4);
    }
    const [ox, oy] = this.project(o); ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fillStyle = C.sheet; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, 4, 0, Math.PI / 2); ctx.arc(ox, oy, 4, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fillStyle = C.ink; ctx.fill();
  }
  drawTool(g, at) {
    const [x, y, z] = at; const s = g.stock; const tool = toolById(this.state.activeTool());
    const tip = [s.x + x, s.y + y, s.z + s.t + z]; const r = tool.diameter / 2;
    const cyl = (z0, z1, rr, fill, stroke) => {
      const ring = (zz) => Array.from({ length: 24 }, (_, k) => { const a = k / 24 * Math.PI * 2; return [tip[0] + rr * Math.cos(a), tip[1] + rr * Math.sin(a), zz]; });
      const all = [...ring(z0), ...ring(z1)].map((p) => this.project(p));
      // convex hull of the two projected rings
      all.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lower = [], upper = [];
      for (const p of all) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
      for (const p of all.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
      const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
      const ctx = this.ctx; ctx.beginPath(); hull.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
      const top = ring(z1).map((p) => this.project(p)); ctx.beginPath(); top.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
    };
    const C = this.colors;
    cyl(tip[2], tip[2] + tool.fluteLength, r, 'rgba(120,135,150,.95)', C.ink);
    cyl(tip[2] + tool.fluteLength, tip[2] + tool.fluteLength + 14, tool.shank / 2, 'rgba(200,210,218,.98)', C.ink);
    cyl(tip[2] + tool.fluteLength + 14, tip[2] + tool.fluteLength + 24, 9, 'rgba(150,165,178,.98)', C.ink);
  }
}
