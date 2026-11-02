/**
 * Fixture outlines from DXF and SVG files, parsed locally (WORKSPACE_FEATURES
 * "Workholding and bed"): the largest closed outline becomes the solid and
 * circles become holes. Units are taken as millimetres.
 *
 * The SVG is read as text with a small tag scanner, never parsed into a
 * document (DOMParser is an HTML sink under Trusted Types, and the file is
 * untrusted): only `rect`, `circle`, `ellipse`, `polygon`, `polyline` and
 * simple `path` data (M, L, H, V, Z, absolute and relative) are read; every
 * other construct is ignored. The DXF reader takes LWPOLYLINE, POLYLINE with
 * VERTEX, LINE chains and CIRCLE entities from the ENTITIES section.
 *
 * Pure and bounded: files over `MAX_OUTLINE_BYTES` are refused.
 */
export type Pt = readonly [number, number];

export interface ParsedOutline {
  readonly outline: readonly Pt[];
  readonly holes: readonly (readonly [number, number, number])[];
  readonly width: number;
  readonly depth: number;
}

export const MAX_OUTLINE_BYTES = 4 * 1024 * 1024;

export class OutlineError extends Error {
  override readonly name = 'OutlineError';
}

function area(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Moves the result so its outline starts at 0,0 (bottom-left), with Y up. */
function finish(polys: readonly (readonly Pt[])[], circles: readonly (readonly [number, number, number])[], flipY: boolean): ParsedOutline {
  const closed = polys.filter((p) => p.length >= 3);
  let best: readonly Pt[] | null = null;
  for (const p of closed) if (best === null || area(p) > area(best)) best = p;
  let outline: readonly Pt[];
  let holes = circles;
  if (best === null) {
    // No polygon: a single large circle is the outline (a round plate).
    const big = [...circles].sort((a, b) => b[2] - a[2])[0];
    if (big === undefined) throw new OutlineError('No closed outline or circle was found in the file.');
    outline = Array.from({ length: 48 }, (_, k) => [big[0] + big[2] * Math.cos((k / 48) * Math.PI * 2), big[1] + big[2] * Math.sin((k / 48) * Math.PI * 2)] as Pt);
    holes = circles.filter((c) => c !== big);
  } else outline = best;
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) throw new OutlineError('The outline has no area.');
  const tx = (p: Pt): Pt => [p[0] - minX, flipY ? maxY - p[1] : p[1] - minY];
  return {
    outline: outline.map(tx),
    holes: holes.filter((c) => c[0] > minX && c[0] < maxX && c[1] > minY && c[1] < maxY).map((c) => [...tx([c[0], c[1]]), c[2]] as const),
    width: maxX - minX,
    depth: maxY - minY,
  };
}

// ---------------------------------------------------------------- SVG

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m === null ? null : (m[2] ?? m[3] ?? null);
}

function n(tag: string, name: string): number {
  const v = Number.parseFloat(attr(tag, name) ?? '0');
  return Number.isFinite(v) ? v : 0;
}

function numbers(text: string): number[] {
  return (text.match(NUM) ?? []).map(Number);
}

/** Path data with M/L/H/V/Z (absolute or relative) into closed polygons; curves are skipped as straight chords. */
function pathPolys(d: string): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let cmd = '';
  let i = 0;
  const next = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur.length >= 3) out.push(cur);
        cur = [];
        x = sx;
        y = sy;
      }
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M':
        if (cur.length >= 3) out.push(cur);
        x = (rel ? x : 0) + next();
        y = (rel ? y : 0) + next();
        sx = x;
        sy = y;
        cur = [[x, y]];
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        x = (rel ? x : 0) + next();
        y = (rel ? y : 0) + next();
        cur.push([x, y]);
        break;
      case 'H':
        x = (rel ? x : 0) + next();
        cur.push([x, y]);
        break;
      case 'V':
        y = (rel ? y : 0) + next();
        cur.push([x, y]);
        break;
      case 'C':
        i += 4;
        x = (rel ? x : 0) + next();
        y = (rel ? y : 0) + next();
        cur.push([x, y]);
        break;
      case 'S':
      case 'Q':
        i += 2;
        x = (rel ? x : 0) + next();
        y = (rel ? y : 0) + next();
        cur.push([x, y]);
        break;
      case 'T':
        x = (rel ? x : 0) + next();
        y = (rel ? y : 0) + next();
        cur.push([x, y]);
        break;
      case 'A':
        i += 5;
        x = (rel ? x : 0) + next();
        y = (rel ? y : 0) + next();
        cur.push([x, y]);
        break;
      default:
        i++;
    }
  }
  if (cur.length >= 3) out.push(cur);
  return out.filter((p) => p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])));
}

export function parseSvgOutline(text: string): ParsedOutline {
  if (text.length > MAX_OUTLINE_BYTES) throw new OutlineError('The file is too large to read here.');
  const polys: Pt[][] = [];
  const circles: [number, number, number][] = [];
  for (const m of text.matchAll(/<\s*(rect|circle|ellipse|polygon|polyline|path)\b([^>]*)>/gi)) {
    const kind = (m[1] as string).toLowerCase();
    const tag = m[2] as string;
    if (kind === 'rect') {
      const x = n(tag, 'x');
      const y = n(tag, 'y');
      const w = n(tag, 'width');
      const hh = n(tag, 'height');
      if (w > 0 && hh > 0) polys.push([[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]]);
    } else if (kind === 'circle') {
      const r = n(tag, 'r');
      if (r > 0) circles.push([n(tag, 'cx'), n(tag, 'cy'), r]);
    } else if (kind === 'ellipse') {
      const r = (n(tag, 'rx') + n(tag, 'ry')) / 2;
      if (r > 0) circles.push([n(tag, 'cx'), n(tag, 'cy'), r]);
    } else if (kind === 'polygon' || kind === 'polyline') {
      const v = numbers(attr(tag, 'points') ?? '');
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i] as number, v[i + 1] as number]);
      if (pts.length >= 3) polys.push(pts);
    } else {
      polys.push(...pathPolys(attr(tag, 'd') ?? ''));
    }
  }
  return finish(polys, circles, true);
}

// ---------------------------------------------------------------- DXF

export function parseDxfOutline(text: string): ParsedOutline {
  if (text.length > MAX_OUTLINE_BYTES) throw new OutlineError('The file is too large to read here.');
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number.parseInt((lines[i] as string).trim(), 10), (lines[i + 1] as string).trim()]);
  const polys: Pt[][] = [];
  const circles: [number, number, number][] = [];
  const segments: [Pt, Pt][] = [];
  let inEntities = false;
  let i = 0;
  while (i < pairs.length) {
    const [code, value] = pairs[i] as [number, string];
    if (code === 2 && value === 'ENTITIES') inEntities = true;
    if (code === 0 && value === 'ENDSEC') inEntities = false;
    if (!inEntities || code !== 0) {
      i++;
      continue;
    }
    const type = value;
    i++;
    const fields: [number, string][] = [];
    while (i < pairs.length && (pairs[i] as [number, string])[0] !== 0) fields.push(pairs[i++] as [number, string]);
    const get = (c: number): number => Number.parseFloat(fields.find((f) => f[0] === c)?.[1] ?? 'NaN');
    if (type === 'LWPOLYLINE') {
      const xs = fields.filter((f) => f[0] === 10).map((f) => Number.parseFloat(f[1]));
      const ys = fields.filter((f) => f[0] === 20).map((f) => Number.parseFloat(f[1]));
      const pts = xs.map((x, k) => [x, ys[k] ?? Number.NaN] as Pt).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length >= 3) polys.push(pts);
    } else if (type === 'CIRCLE') {
      const c: [number, number, number] = [get(10), get(20), get(40)];
      if (c.every(Number.isFinite) && c[2] > 0) circles.push(c);
    } else if (type === 'LINE') {
      const a: Pt = [get(10), get(20)];
      const b: Pt = [get(11), get(21)];
      if ([...a, ...b].every(Number.isFinite)) segments.push([a, b]);
    } else if (type === 'POLYLINE') {
      const pts: Pt[] = [];
      while (i < pairs.length && (pairs[i] as [number, string])[1] === 'VERTEX') {
        i++;
        const vf: [number, string][] = [];
        while (i < pairs.length && (pairs[i] as [number, string])[0] !== 0) vf.push(pairs[i++] as [number, string]);
        const x = Number.parseFloat(vf.find((f) => f[0] === 10)?.[1] ?? 'NaN');
        const y = Number.parseFloat(vf.find((f) => f[0] === 20)?.[1] ?? 'NaN');
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
      }
      if (pts.length >= 3) polys.push(pts);
    }
  }
  // Chain LINE segments end to end into closed loops.
  const key = (p: Pt): string => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const left = [...segments];
  while (left.length > 0) {
    const [a, b] = left.shift() as [Pt, Pt];
    const loop: Pt[] = [a, b];
    let grown = true;
    while (grown && key(loop[loop.length - 1] as Pt) !== key(loop[0] as Pt)) {
      grown = false;
      const end = key(loop[loop.length - 1] as Pt);
      const k = left.findIndex(([p, q]) => key(p) === end || key(q) === end);
      if (k !== -1) {
        const [p, q] = left.splice(k, 1)[0] as [Pt, Pt];
        loop.push(key(p) === end ? q : p);
        grown = true;
      }
    }
    if (loop.length >= 4 && key(loop[loop.length - 1] as Pt) === key(loop[0] as Pt)) polys.push(loop.slice(0, -1));
  }
  return finish(polys, circles, false);
}

export function parseOutline(name: string, text: string): ParsedOutline {
  return /\.dxf$/i.test(name) ? parseDxfOutline(text) : parseSvgOutline(text);
}
