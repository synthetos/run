/**
 * The Setup view's drawing: bed, fixture (an extruded outline with holes),
 * toe clamps and stock, on a canvas with a parallel projection and painter's
 * order (after the workspace design study's scene.mjs). Drag to orbit,
 * scroll to zoom. Illustrative only: it is not the interpreter and not a
 * collision check.
 */
import { camera } from './machineDrawings.ts';
import type { SetupState } from './library.ts';

type V3 = readonly [number, number, number];
const dot = (p: V3, v: V3): number => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];

interface Face {
  /** Stacking layer (bed 0, fixture 1, stock 2, clamps 3): drawn in this order, then by depth. */
  readonly layer: number;
  readonly pts: readonly V3[];
  readonly fill: string;
  readonly stroke: string;
  readonly depth: number;
}

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v === '' ? fallback : v;
}

function shade(rgb: readonly number[], k: number): string {
  return `rgb(${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * k)))).join(',')})`;
}

export type SetupCamera = 'iso' | 'top' | 'front';

export class SetupScene {
  readonly #canvas: HTMLCanvasElement;
  #cam = camera(-32, 34);
  #az = -32;
  #el = 34;
  #zoom = 1;
  #setup: SetupState | null = null;
  #stockColor: readonly number[] = [196, 205, 212];
  #fit: 'stock' | 'bed' = 'stock';
  readonly #observer: ResizeObserver | null;
  readonly #cleanup: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.render()) : null;
    this.#observer?.observe(canvas);
    let drag: { x: number; y: number; az: number; el: number } | null = null;
    const down = (e: PointerEvent): void => {
      drag = { x: e.clientX, y: e.clientY, az: this.#az, el: this.#el };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (drag === null) return;
      this.#az = drag.az - (e.clientX - drag.x) * 0.35;
      this.#el = Math.max(8, Math.min(90, drag.el + (e.clientY - drag.y) * 0.3));
      this.#cam = camera(this.#az, this.#el);
      this.render();
    };
    const up = (): void => {
      drag = null;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.#zoom = Math.max(0.4, Math.min(6, this.#zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      this.render();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.#cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  dispose(): void {
    this.#observer?.disconnect();
    for (const c of this.#cleanup) c();
  }

  setView(view: SetupCamera): void {
    [this.#az, this.#el] = view === 'top' ? [0, 90] : view === 'front' ? [0, 12] : [-32, 34];
    this.#cam = camera(this.#az, this.#el);
    this.render();
  }

  setFit(fit: 'stock' | 'bed'): void {
    this.#fit = fit;
    this.#zoom = 1;
    this.render();
  }

  update(setup: SetupState, stockColor: readonly number[]): void {
    this.#setup = setup;
    this.#stockColor = stockColor;
    this.render();
  }

  render(): void {
    const setup = this.#setup;
    const canvas = this.#canvas;
    const ctx = canvas.getContext('2d');
    if (setup === null || ctx === null) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (w === 0 || hgt === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    const cam = this.#cam;
    const faces: Face[] = [];
    const ink = css('--blue', '#1d5aa6');
    const line = css('--field', '#8d9ca6');
    const bedTone = [176, 140, 98];
    const fixtureTone = [125, 147, 168];
    const clampTone = [110, 122, 134];
    const box = (layer: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tone: readonly number[], stroke: string): void => {
      const quads: [V3, V3[]][] = [
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
        [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
        [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
        [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
        [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
      ];
      for (const [n, pts] of quads) {
        const facing = dot(n, cam.c);
        if (facing <= 1e-6) continue;
        const k = n[2] === 1 ? 1 : n[1] !== 0 ? 0.82 : 0.7;
        const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
        faces.push({ layer, pts, fill: shade(tone, k), stroke, depth: dot(c, cam.c) + dot(n, cam.c) * 0.01 });
      }
    };
    const prism = (layer: number, outline: readonly (readonly [number, number])[], ox: number, oy: number, z0: number, z1: number, tone: readonly number[]): void => {
      const top = outline.map(([x, y]) => [ox + x, oy + y, z1] as V3);
      const n = outline.length;
      for (let i = 0; i < n; i++) {
        const a = outline[i] as readonly [number, number];
        const b = outline[(i + 1) % n] as readonly [number, number];
        const nx = b[1] - a[1];
        const ny = -(b[0] - a[0]);
        const len = Math.hypot(nx, ny) || 1;
        const normal: V3 = [nx / len, ny / len, 0];
        const sign = signedArea(outline) > 0 ? 1 : -1;
        const nn: V3 = [normal[0] * sign, normal[1] * sign, 0];
        if (dot(nn, cam.c) <= 0) continue;
        const pts: V3[] = [[ox + a[0], oy + a[1], z0], [ox + b[0], oy + b[1], z0], [ox + b[0], oy + b[1], z1], [ox + a[0], oy + a[1], z1]];
        const c: V3 = [ox + (a[0] + b[0]) / 2, oy + (a[1] + b[1]) / 2, (z0 + z1) / 2];
        faces.push({ layer, pts, fill: shade(tone, 0.75), stroke: shade(tone, 0.55), depth: dot(c, cam.c) });
      }
      faces.push({ layer, pts: top, fill: shade(tone, 1), stroke: shade(tone, 0.6), depth: Number.POSITIVE_INFINITY });
    };

    const bed = setup.bed;
    box(0, 0, 0, -bed.thickness, bed.width, bed.depth, 0, bedTone, shade(bedTone, 0.6));
    const fx = setup.fixture;
    const fixtureTop = fx === null ? 0 : fx.height;
    if (fx !== null && fx.outline.length >= 3) {
      const fw = Math.max(...fx.outline.map((p) => p[0]));
      const fd = Math.max(...fx.outline.map((p) => p[1]));
      prism(1, fx.outline, fx.position.x - fw / 2, fx.position.y - fd / 2, 0, fx.height, fixtureTone);
    }
    const st = setup.stock;
    const sw = st.shape === 'round' ? (st.diameter ?? st.width) : st.width;
    const sd = st.shape === 'round' ? (st.diameter ?? st.width) : st.depth;
    const sx = st.position.x - sw / 2;
    const sy = st.position.y - sd / 2;
    if (st.shape === 'round') {
      const ring = Array.from({ length: 40 }, (_, k) => [sw / 2 + (sw / 2) * Math.cos((k / 40) * Math.PI * 2), sd / 2 + (sd / 2) * Math.sin((k / 40) * Math.PI * 2)] as const);
      prism(2, ring, sx, sy, fixtureTop, fixtureTop + st.thickness, this.#stockColor);
    } else box(2, sx, sy, fixtureTop, sx + sw, sy + sd, fixtureTop + st.thickness, this.#stockColor, shade(this.#stockColor, 0.6));
    if (setup.clamps && st.shape !== 'round') {
      const ch = Math.max(6, st.thickness * 0.6);
      const z = fixtureTop + st.thickness;
      for (const [cx, cy] of [[sx + sw * 0.15, sy - 8], [sx + sw * 0.85, sy - 8], [sx + sw * 0.15, sy + sd + 8], [sx + sw * 0.85, sy + sd + 8]] as const) box(3, cx - 14, cy - 10, z - 2, cx + 14, cy + 10, z - 2 + ch, clampTone, shade(clampTone, 0.6));
    }

    // Fit: project the bounds of the target.
    const P = (p: V3): [number, number] => [dot(p, cam.r), -dot(p, cam.u)];
    const target: V3[] =
      this.#fit === 'bed'
        ? [[0, 0, -bed.thickness], [bed.width, bed.depth, 0], [0, bed.depth, 0], [bed.width, 0, -bed.thickness]]
        : [[sx - 90, sy - 90, 0], [sx + sw + 90, sy + sd + 90, fixtureTop + st.thickness + 20], [sx - 90, sy + sd + 90, 0], [sx + sw + 90, sy - 90, fixtureTop + st.thickness]];
    const proj = target.flatMap((p) => {
      const out: [number, number][] = [];
      for (const z of [p[2], 0]) out.push(P([p[0], p[1], z]));
      return out;
    });
    const minx = Math.min(...proj.map((p) => p[0]));
    const maxx = Math.max(...proj.map((p) => p[0]));
    const miny = Math.min(...proj.map((p) => p[1]));
    const maxy = Math.max(...proj.map((p) => p[1]));
    const scale = Math.min((w - 40) / (maxx - minx || 1), (hgt - 60) / (maxy - miny || 1)) * this.#zoom;
    const ox = w / 2 - ((minx + maxx) / 2) * scale;
    const oy = hgt / 2 - ((miny + maxy) / 2) * scale;
    const S = (p: V3): [number, number] => {
      const q = P(p);
      return [ox + q[0] * scale, oy + q[1] * scale];
    };

    faces.sort((a, b) => a.layer - b.layer || a.depth - b.depth);
    ctx.lineJoin = 'round';
    for (const f of faces) {
      ctx.beginPath();
      f.pts.forEach((p, i) => {
        const [x, y] = S(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      ctx.strokeStyle = f.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Fixture holes, drawn on its top face.
    if (fx !== null && fx.holes.length > 0) {
      const fw = Math.max(...fx.outline.map((p) => p[0]));
      const fd = Math.max(...fx.outline.map((p) => p[1]));
      ctx.fillStyle = shade(fixtureTone, 0.45);
      for (const [hx, hy, r] of fx.holes) {
        const x = fx.position.x - fw / 2 + hx;
        const y = fx.position.y - fd / 2 + hy;
        if (x > sx && x < sx + sw && y > sy && y < sy + sd) continue;
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) {
          const [px, py] = S([x + r * Math.cos((k / 16) * Math.PI * 2), y + r * Math.sin((k / 16) * Math.PI * 2), fixtureTop]);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.fill();
      }
    }
    // Work zero marker and axes.
    const zx = st.zero.corner.includes('right') ? sx + sw : st.zero.corner.includes('left') ? sx : sx + sw / 2;
    const zy = st.zero.corner.includes('back') ? sy + sd : st.zero.corner.includes('front') ? sy : sy + sd / 2;
    const zz = st.zero.height === 'top' ? fixtureTop + st.thickness : fixtureTop;
    const o = S([zx, zy, zz]);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.font = '10px "IBM Plex Mono", monospace';
    for (const [label, d] of [['X', [30, 0, 0]], ['Y', [0, 30, 0]], ['Z', [0, 0, 30]]] as const) {
      const e = S([zx + d[0], zy + d[1], zz + d[2]]);
      ctx.beginPath();
      ctx.moveTo(o[0], o[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.stroke();
      ctx.fillText(label, e[0] + 3, e[1] - 3);
    }
    ctx.beginPath();
    ctx.arc(o[0], o[1], 3.5, 0, Math.PI * 2);
    ctx.fillStyle = css('--sheet', '#ffffff');
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.stroke();
  }
}

function signedArea(poly: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as readonly [number, number];
    const q = poly[(i + 1) % poly.length] as readonly [number, number];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
