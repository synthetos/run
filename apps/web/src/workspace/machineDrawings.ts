/**
 * Blueprint-style machine illustrations for the Machines view, ported from
 * the workspace design study (docs/design/workspace-prototype/machines.mjs).
 * Each drawing is built from simple solids and drawn as hidden-line SVG from
 * the general, public arrangement of the machine family; none is a
 * dimensioned drawing of a product, and no maker's artwork is used.
 *
 * Pure: `machineDrawing(id)` returns a view box and paths that a component
 * renders as SVG elements (never as markup).
 */
type V3 = readonly [number, number, number];
type P2 = readonly [number, number];
type Tone = 'part' | 'dark' | 'accent' | 'bed' | 'ghost';

interface Camera {
  readonly r: V3;
  readonly c: V3;
  readonly u: V3;
}

const rad = (d: number): number => (d * Math.PI) / 180;
const dot = (p: V3, v: V3): number => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];

export function camera(az: number, el: number): Camera {
  const a = rad(az);
  const e = rad(el);
  return {
    r: [Math.cos(a), Math.sin(a), 0],
    c: [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)],
    u: [-Math.sin(e) * Math.sin(a), Math.sin(e) * Math.cos(a), Math.cos(e)],
  };
}

interface BoxOpts {
  readonly slots?: 'x' | 'y' | 'z';
  readonly slotCount?: number;
  readonly motor?: boolean;
  readonly grid?: number;
  readonly tslots?: { readonly axis: 'x' | 'y'; readonly count: number };
  readonly bias?: number;
  readonly rings?: readonly number[];
}

type Item =
  | { readonly kind: 'box'; readonly b: readonly [number, number, number, number, number, number]; readonly tone: Tone; readonly opts: BoxOpts; readonly d: number }
  | { readonly kind: 'cyl'; readonly axis: 'x' | 'y' | 'z'; readonly c: V3; readonly r: number; readonly len: number; readonly tone: Tone; readonly opts: BoxOpts; readonly d: number }
  | { readonly kind: 'lines'; readonly pts: readonly V3[]; readonly cls: string; readonly d: number };

export interface DrawingPath {
  readonly d: string;
  readonly cls: string;
}

export interface MachineDrawing {
  readonly viewBox: string;
  readonly paths: readonly DrawingPath[];
}

class Drawing {
  readonly cam = camera(-36, 30);
  readonly items: Item[] = [];
  P(p: V3): P2 {
    return [dot(p, this.cam.r), -dot(p, this.cam.u)];
  }
  depth(p: V3): number {
    return dot(p, this.cam.c);
  }
  box(ax0: number, ay0: number, az0: number, ax1: number, ay1: number, az1: number, tone: Tone = 'part', opts: BoxOpts = {}): this {
    const [x0, x1] = ax0 <= ax1 ? [ax0, ax1] : [ax1, ax0];
    const [y0, y1] = ay0 <= ay1 ? [ay0, ay1] : [ay1, ay0];
    const [z0, z1] = az0 <= az1 ? [az0, az1] : [az1, az0];
    this.items.push({ kind: 'box', b: [x0, y0, z0, x1, y1, z1], tone, opts, d: this.depth([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]) + (opts.bias ?? 0) });
    return this;
  }
  cyl(axis: 'x' | 'y' | 'z', c: V3, r: number, len: number, tone: Tone = 'part', opts: BoxOpts = {}): this {
    const mid: [number, number, number] = [c[0], c[1], c[2]];
    const ai = 'xyz'.indexOf(axis);
    mid[ai] = (mid[ai] as number) + len / 2;
    this.items.push({ kind: 'cyl', axis, c, r, len, tone, opts, d: this.depth(mid) + (opts.bias ?? 0) });
    return this;
  }
  lines(pts: readonly V3[], cls = 'detail'): this {
    this.items.push({ kind: 'lines', pts, cls, d: this.depth(pts[0] as V3) });
    return this;
  }
  extrusion(axis: 'x' | 'y' | 'z', x: number, y: number, z: number, len: number, w: number, hgt: number, tone: Tone = 'part', opts: BoxOpts = {}): this {
    if (axis === 'x') return this.box(x, y, z, x + len, y + w, z + hgt, tone, { ...opts, slots: axis });
    if (axis === 'y') return this.box(x, y, z, x + w, y + len, z + hgt, tone, { ...opts, slots: axis });
    return this.box(x, y, z, x + w, y + hgt, z + len, tone, { ...opts, slots: axis });
  }
  stepper(x: number, y: number, z: number, facing: 'z' | '-y' | 'x' | '-x' | 'y', size = 42): this {
    const s = size / 2;
    if (facing === 'z') {
      this.box(x - s, y - s, z, x + s, y + s, z + size * 0.9, 'dark', { motor: true });
      this.cyl('z', [x, y, z + size * 0.9], 11, 2);
      this.cyl('z', [x, y, z + size * 0.9 + 2], 2.5, 10);
    }
    if (facing === '-y') {
      this.box(x - s, y, z - s, x + s, y + size * 0.9, z + s, 'dark', { motor: true });
      this.cyl('y', [x, y - 2, z], 11, 2);
    }
    if (facing === 'x') {
      this.box(x - size * 0.9, y - s, z - s, x, y + s, z + s, 'dark', { motor: true });
      this.cyl('x', [x, y, z], 11, 2);
    }
    if (facing === '-x') {
      this.box(x, y - s, z - s, x + size * 0.9, y + s, z + s, 'dark', { motor: true });
      this.cyl('x', [x - 2, y, z], 11, 2);
    }
    if (facing === 'y') {
      this.box(x - s, y - size * 0.9, z - s, x + s, y, z + s, 'dark', { motor: true });
      this.cyl('y', [x, y, z], 11, 2);
    }
    return this;
  }
  router(x: number, y: number, zTip: number, style: 'router' | 'spindle' = 'router'): this {
    if (style === 'router') {
      this.cyl('z', [x, y, zTip], 1.6, 14);
      this.cyl('z', [x, y, zTip + 12], 9, 16);
      this.cyl('z', [x, y, zTip + 26], 44, 150, 'accent', { rings: [0.18, 0.72, 0.84] });
      this.cyl('z', [x, y, zTip + 176], 34, 40, 'dark', { rings: [0.5] });
    } else {
      this.cyl('z', [x, y, zTip], 1.6, 14);
      this.cyl('z', [x, y, zTip + 12], 11, 12);
      this.cyl('z', [x, y, zTip + 22], 40, 170, 'accent', { rings: [0.12, 0.88] });
      this.cyl('z', [x, y, zTip + 172], 20, 14);
      this.cyl('y', [x + 18, y - 34, zTip + 140], 4, 10);
      this.cyl('y', [x - 18, y - 34, zTip + 140], 4, 10);
    }
    return this;
  }

  path(pts: readonly P2[], close = true): string {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + (close ? 'Z' : '');
  }

  render(pad = 18): MachineDrawing {
    const items = [...this.items].sort((a, b) => a.d - b.d);
    const out: DrawingPath[] = [];
    const all: P2[] = [];
    const boxes = items.filter((it): it is Extract<Item, { kind: 'box' }> => it.kind === 'box' && it.tone !== 'ghost');
    if (boxes.length > 0) {
      const x0 = Math.min(...boxes.map((b) => b.b[0]));
      const x1 = Math.max(...boxes.map((b) => b.b[3]));
      const y0 = Math.min(...boxes.map((b) => b.b[1]));
      const y1 = Math.max(...boxes.map((b) => b.b[4]));
      const g = 40;
      const pts: V3[] = [[x0 - g, y0 - g * 2, 0], [x1 + g, y0 - g * 2, 0], [x1 + g, y1 + g, 0], [x0 - g, y1 + g, 0]];
      out.push({ d: this.path(pts.map((p) => this.P(p))), cls: 'ground' });
    }
    for (const it of items) {
      if (it.kind === 'box') this.drawBox(it, out, all);
      else if (it.kind === 'cyl') this.drawCyl(it, out, all);
      else {
        const pp = it.pts.map((p) => this.P(p));
        all.push(...pp);
        out.push({ d: this.path(pp, false), cls: it.cls });
      }
    }
    let minx = Infinity;
    let maxx = -Infinity;
    let miny = Infinity;
    let maxy = -Infinity;
    for (const [x, y] of all) {
      minx = Math.min(minx, x);
      maxx = Math.max(maxx, x);
      miny = Math.min(miny, y);
      maxy = Math.max(maxy, y);
    }
    return { viewBox: `${(minx - pad).toFixed(1)} ${(miny - pad).toFixed(1)} ${(maxx - minx + pad * 2).toFixed(1)} ${(maxy - miny + pad * 2).toFixed(1)}`, paths: out };
  }

  drawBox(it: Extract<Item, { kind: 'box' }>, out: DrawingPath[], all: P2[]): void {
    const [x0, y0, z0, x1, y1, z1] = it.b;
    const c = this.cam.c;
    const faces: [string, V3, V3[]][] = [
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
      const pp = pts.map((p) => this.P(p));
      all.push(...pp);
      out.push({ d: this.path(pp), cls: `face ${it.tone} ${shade}` });
      if (it.opts.slots !== undefined && name !== 'bot') this.slotLines(it, name, out);
      if (it.opts.motor === true && name === 'top') {
        const inset = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const [p0, p1, p2, p3] = pts as [V3, V3, V3, V3];
        const q = [inset(p0, p2, 0.12), inset(p1, p3, 0.12), inset(p2, p0, 0.12), inset(p3, p1, 0.12)];
        out.push({ d: this.path(q.map((p) => this.P(p))), cls: 'detail faint' });
      }
      if (it.opts.grid !== undefined && name === 'top') this.gridLines(it, out);
      if (it.opts.tslots !== undefined && name === 'top') this.tslotLines(it, out);
    }
  }

  slotLines(it: Extract<Item, { kind: 'box' }>, face: string, out: DrawingPath[]): void {
    const [x0, y0, z0, x1, y1, z1] = it.b;
    const ax = it.opts.slots;
    const n = it.opts.slotCount ?? 1;
    const seg = (a: V3, b: V3): void => {
      out.push({ d: this.path([this.P(a), this.P(b)], false), cls: 'detail faint' });
    };
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      if (ax === 'x') {
        if (face === 'top') seg([x0, y0 + (y1 - y0) * t, z1], [x1, y0 + (y1 - y0) * t, z1]);
        if (face === 'front' || face === 'back') {
          const y = face === 'front' ? y0 : y1;
          seg([x0, y, z0 + (z1 - z0) * t], [x1, y, z0 + (z1 - z0) * t]);
        }
      } else if (ax === 'y') {
        if (face === 'top') seg([x0 + (x1 - x0) * t, y0, z1], [x0 + (x1 - x0) * t, y1, z1]);
        if (face === 'left' || face === 'right') {
          const x = face === 'left' ? x0 : x1;
          seg([x, y0, z0 + (z1 - z0) * t], [x, y1, z0 + (z1 - z0) * t]);
        }
      } else {
        if (face === 'front' || face === 'back') {
          const y = face === 'front' ? y0 : y1;
          seg([x0 + (x1 - x0) * t, y, z0], [x0 + (x1 - x0) * t, y, z1]);
        }
        if (face === 'left' || face === 'right') {
          const x = face === 'left' ? x0 : x1;
          seg([x, y0 + (y1 - y0) * t, z0], [x, y0 + (y1 - y0) * t, z1]);
        }
      }
    }
  }

  gridLines(it: Extract<Item, { kind: 'box' }>, out: DrawingPath[]): void {
    const [x0, y0, , x1, y1, z1] = it.b;
    const s = it.opts.grid as number;
    const parts: string[] = [];
    const seg = (a: V3, b: V3): void => {
      const p = this.P(a);
      const q = this.P(b);
      parts.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
    };
    for (let x = x0 + s; x < x1 - 1; x += s) seg([x, y0, z1], [x, y1, z1]);
    for (let y = y0 + s; y < y1 - 1; y += s) seg([x0, y, z1], [x1, y, z1]);
    out.push({ d: parts.join(''), cls: 'detail faint' });
  }

  tslotLines(it: Extract<Item, { kind: 'box' }>, out: DrawingPath[]): void {
    const [x0, y0, , x1, y1, z1] = it.b;
    const { axis, count } = it.opts.tslots as { axis: 'x' | 'y'; count: number };
    const parts: string[] = [];
    const seg = (a: V3, b: V3): void => {
      const p = this.P(a);
      const q = this.P(b);
      parts.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
    };
    for (let k = 1; k <= count; k++) {
      const t = k / (count + 1);
      for (const o of [-5, 5]) {
        if (axis === 'y') seg([x0 + (x1 - x0) * t + o, y0, z1], [x0 + (x1 - x0) * t + o, y1, z1]);
        else seg([x0, y0 + (y1 - y0) * t + o, z1], [x1, y0 + (y1 - y0) * t + o, z1]);
      }
    }
    out.push({ d: parts.join(''), cls: 'detail' });
  }

  drawCyl(it: Extract<Item, { kind: 'cyl' }>, out: DrawingPath[], all: P2[]): void {
    const { axis, c, r, len } = it;
    const ai = 'xyz'.indexOf(axis);
    const u: V3 = axis === 'z' ? [1, 0, 0] : [0, 0, 1];
    const v: V3 = axis === 'x' ? [0, 1, 0] : axis === 'y' ? [1, 0, 0] : [0, 1, 0];
    const ring = (t: number): V3[] =>
      Array.from({ length: 36 }, (_, k) => {
        const a = (k / 36) * Math.PI * 2;
        const p: [number, number, number] = [c[0], c[1], c[2]];
        p[ai] = (p[ai] as number) + t;
        return [p[0] + r * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), p[1] + r * (Math.cos(a) * u[1] + Math.sin(a) * v[1]), p[2] + r * (Math.cos(a) * u[2] + Math.sin(a) * v[2])] as V3;
      });
    const r0 = ring(0);
    const r1 = ring(len);
    const pts = [...r0, ...r1].map((p) => this.P(p));
    all.push(...pts);
    out.push({ d: this.path(convexHull(pts)), cls: `face ${it.tone} s2` });
    const axisDir: [number, number, number] = [0, 0, 0];
    axisDir[ai] = 1;
    const capFront = dot(axisDir, this.cam.c) > 0 ? r1 : r0;
    for (const t of it.opts.rings ?? []) {
      const rr = ring(len * t);
      let d = '';
      let pen = false;
      for (let k = 0; k <= 36; k++) {
        const a = ((k % 36) / 36) * Math.PI * 2;
        const n: V3 = [Math.cos(a) * u[0] + Math.sin(a) * v[0], Math.cos(a) * u[1] + Math.sin(a) * v[1], Math.cos(a) * u[2] + Math.sin(a) * v[2]];
        if (dot(n, this.cam.c) > 0) {
          const p = this.P(rr[k % 36] as V3);
          d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
          pen = true;
        } else pen = false;
      }
      if (d !== '') out.push({ d, cls: 'detail faint' });
    }
    if (Math.abs(dot(axisDir, this.cam.c)) > 0.02) out.push({ d: this.path(capFront.map((p) => this.P(p))), cls: `face ${it.tone} s1` });
  }
}

function convexHull(points: readonly P2[]): P2[] {
  const p = points.map((q) => [q[0], q[1]] as P2).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  const upper: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as P2, lower[lower.length - 1] as P2, q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] as P2, upper[upper.length - 1] as P2, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const BUILDERS: Readonly<Record<string, (d: Drawing) => void>> = {
  xcarve(d) {
    const W = 860;
    const D = 820;
    for (const x of [0, W - 40]) d.extrusion('y', x, 0, 18, D, 40, 40, 'part', { slotCount: 2 });
    d.box(0, -12, 0, W, 0, 70);
    d.box(0, D, 0, W, D + 12, 70);
    d.box(40, 20, 18, W - 40, D - 20, 36, 'bed', { grid: 70 });
    const gy = 360;
    for (const x of [-14, W]) {
      d.box(x, gy - 50, 40, x + 14, gy + 80, 230);
      d.lines([[x + (x < 0 ? 0 : 14), gy - 30, 70], [x + (x < 0 ? 0 : 14), gy + 60, 70]], 'detail faint');
    }
    d.extrusion('x', 0, gy, 170, W, 40, 60, 'part', { slotCount: 2 });
    d.extrusion('x', 0, gy, 120, W, 40, 40, 'part', { slotCount: 1 });
    d.stepper(-14, gy + 20, 205, '-x');
    d.stepper(W + 14, gy + 20, 205, 'x');
    d.box(370, gy - 28, 110, 490, gy, 240);
    d.box(395, gy - 64, 120, 465, gy - 28, 220);
    d.stepper(430, gy - 46, 240, 'z');
    d.router(430, gy - 100, 70);
    for (let k = 0; k < 9; k++) d.box(560 + k * 30, gy + 30, 236, 588 + k * 30, gy + 60, 252, 'dark');
  },
  shapeoko(d) {
    const W = 820;
    const D = 820;
    for (const x of [0, W - 60]) d.box(x, 0, 0, x + 60, D, 90, 'part', { slots: 'y', slotCount: 2 });
    d.box(-10, -14, 0, W + 10, 0, 110);
    d.box(-10, D, 0, W + 10, D + 14, 110);
    d.box(60, 10, 0, W - 60, D - 10, 40, 'bed', { tslots: { axis: 'x', count: 6 } });
    const gy = 380;
    for (const x of [-16, W]) d.box(x, gy - 70, 70, x + 16, gy + 110, 330);
    d.box(0, gy, 210, W, gy + 90, 320, 'part', { slots: 'x', slotCount: 3 });
    d.stepper(-16, gy + 30, 270, '-x');
    d.stepper(W + 16, gy + 30, 270, 'x');
    d.box(340, gy - 34, 170, 480, gy, 340);
    d.box(360, gy - 80, 150, 460, gy - 34, 310);
    d.stepper(410, gy - 57, 340, 'z');
    d.router(410, gy - 116, 72);
  },
  lead(d) {
    const W = 820;
    const D = 820;
    for (const x of [0, W - 80]) d.box(x, 0, 0, x + 80, D, 40, 'part', { slots: 'y', slotCount: 3 });
    d.extrusion('x', 80, 0, 0, W - 160, 40, 40, 'part', { slotCount: 1 });
    d.extrusion('x', 80, D - 40, 0, W - 160, 40, 40, 'part', { slotCount: 1 });
    d.box(80, 40, 0, W - 80, D - 40, 22, 'bed', { grid: 80 });
    for (const x of [40, W - 40]) {
      d.cyl('y', [x, 0, 54], 4, D, 'part', { bias: 50 });
      d.stepper(x, -48, 54, '-y');
    }
    const gy = 400;
    for (const x of [-10, W - 90]) d.box(x, gy - 60, 40, x + 100, gy + 60, 60);
    for (const x of [-10, W]) d.box(x, gy - 60, 60, x + 10, gy + 60, 240);
    d.box(0, gy, 150, W, gy + 40, 230, 'part', { slots: 'x', slotCount: 3 });
    d.cyl('x', [0, gy - 6, 190], 4, W, 'part', { bias: -5 });
    d.stepper(W + 10, gy + 20, 190, 'x');
    d.box(360, gy - 40, 130, 460, gy - 6, 250);
    d.box(380, gy - 80, 120, 440, gy - 40, 230);
    d.stepper(410, gy - 60, 250, 'z');
    d.router(410, gy - 116, 60);
  },
  workbee(d) {
    const W = 820;
    const D = 820;
    for (const x of [0, W - 40]) {
      d.extrusion('y', x, 0, 70, D, 40, 80, 'part', { slotCount: 3 });
      for (const y of [30, D - 70]) d.box(x, y, 0, x + 40, y + 40, 70);
    }
    d.box(30, 20, 0, W - 30, D - 20, 24, 'bed', { grid: 100 });
    for (const x of [20, W - 20]) {
      d.cyl('y', [x, 0, 165], 4, D, 'part', { bias: 40 });
      d.stepper(x, -48, 165, '-y');
    }
    const gy = 400;
    for (const x of [-16, W]) {
      d.box(x, gy - 90, 120, x + 16, gy + 90, 420);
      d.lines([[x + (x < 0 ? 0 : 16), gy - 60, 380], [x + (x < 0 ? 0 : 16), gy + 60, 380]], 'detail faint');
    }
    d.extrusion('x', 0, gy, 340, W, 40, 80, 'part', { slotCount: 3 });
    d.extrusion('x', 0, gy, 240, W, 40, 80, 'part', { slotCount: 3 });
    d.cyl('x', [0, gy - 6, 330], 4, W, 'part', { bias: -5 });
    d.stepper(W + 16, gy + 20, 330, 'x');
    d.box(350, gy - 40, 210, 470, gy - 6, 400);
    d.box(370, gy - 90, 170, 450, gy - 40, 340);
    d.stepper(410, gy - 65, 400, 'z');
    d.router(410, gy - 124, 100);
  },
  router6040(d) {
    const W = 560;
    const D = 860;
    d.box(0, 0, 0, W, D, 70);
    d.stepper(W / 2, D + 2, 35, 'y');
    d.box(30, 160, 70, W - 30, 640, 110, 'bed', { tslots: { axis: 'y', count: 5 } });
    const gy = 380;
    for (const x of [-30, W]) {
      d.box(x, gy - 150, 0, x + 30, gy + 120, 380);
      d.lines([[x + (x < 0 ? 0 : 30), gy - 150, 120], [x + (x < 0 ? 0 : 30), gy - 80, 380]], 'detail faint');
    }
    d.box(-30, gy, 290, W + 30, gy + 110, 420, 'part', { slots: 'x', slotCount: 2 });
    d.stepper(W + 30, gy + 55, 355, 'x');
    d.box(200, gy - 44, 250, 360, gy, 440);
    d.box(225, gy - 100, 200, 335, gy - 44, 380);
    d.stepper(280, gy - 72, 380, 'z');
    d.router(280, gy - 150, 130, 'spindle');
  },
  custom(d) {
    const W = 820;
    const D = 820;
    const ghost = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
      d.box(x0, y0, z0, x1, y1, z1, 'ghost');
    };
    for (const x of [0, W - 40]) ghost(x, 0, 0, x + 40, D, 50);
    ghost(40, 20, 0, W - 40, D - 20, 24);
    const gy = 400;
    for (const x of [-14, W]) ghost(x, gy - 60, 50, x + 14, gy + 80, 250);
    ghost(0, gy, 170, W, gy + 40, 240);
    ghost(370, gy - 40, 130, 470, gy, 280);
    d.lines([[0, -60, 0], [W, -60, 0]], 'dim');
    d.lines([[W + 70, 0, 0], [W + 70, D, 0]], 'dim');
    d.lines([[W + 70, D, 0], [W + 70, D, 260]], 'dim');
    d.lines([[0, -75, 0], [0, -45, 0]], 'dim');
    d.lines([[W, -75, 0], [W, -45, 0]], 'dim');
    d.cyl('z', [420, gy - 80, 60], 30, 120, 'ghost');
  },
};

export interface MachineTemplate {
  readonly id: string;
  readonly name: string;
  readonly drive: 'belt' | 'screw' | 'any';
  readonly blurb: string;
  readonly size: string;
  readonly note: string;
  readonly travel: { readonly x: number; readonly y: number; readonly z: number };
}

/** The catalogue (examples until each has a sourced revision; WORKSPACE_FEATURES "Machine profile"). */
export const CATALOGUE: readonly MachineTemplate[] = [
  { id: 'xcarve', name: 'X-Carve', drive: 'belt', blurb: 'Belt-driven gantry on wide aluminium rails. Pick your size and mechanical revision.', size: '500 mm and 1000 mm frames', note: 'Usually a GRBL controller: conversion to TinyG needs wiring review', travel: { x: 750, y: 750, z: 65 } },
  { id: 'shapeoko', name: 'Shapeoko', drive: 'belt', blurb: 'Rigid desktop router with a deep X beam and hybrid table.', size: 'Standard, XL and XXL footprints', note: 'Ships with its own controller: conversion required', travel: { x: 425, y: 425, z: 75 } },
  { id: 'lead', name: 'OpenBuilds LEAD', drive: 'screw', blurb: 'Lead screws on all axes, framed in C-beam extrusion.', size: '1010 and 1515', note: 'Kit build: record your own motors and screws', travel: { x: 730, y: 810, z: 90 } },
  { id: 'workbee', name: 'OpenBuilds WorkBee', drive: 'screw', blurb: 'Tall gantry plates, raised rails and a generous Z travel.', size: '1010 to 1510', note: 'Kit build: record your own motors and screws', travel: { x: 775, y: 800, z: 120 } },
  { id: 'router6040', name: '3040 / 6040 router', drive: 'screw', blurb: 'Fixed gantry, moving T-slot table, ball screws and a water-cooled spindle.', size: '3040, 4060 and 6040 frames', note: 'Many electronics variants: verify before configuring', travel: { x: 600, y: 400, z: 80 } },
  { id: 'custom', name: 'Custom machine', drive: 'any', blurb: 'Start from a blank sheet. Describe the axes, drives and travel you built.', size: 'Any size', note: 'Every value is yours to measure and record', travel: { x: 500, y: 500, z: 80 } },
];

const cache = new Map<string, MachineDrawing>();

export function machineDrawing(id: string): MachineDrawing {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const d = new Drawing();
  (BUILDERS[id] ?? BUILDERS['custom'] as (d: Drawing) => void)(d);
  const out = d.render();
  cache.set(id, out);
  return out;
}
