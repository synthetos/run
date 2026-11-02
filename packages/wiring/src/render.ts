/**
 * Layout and the two renderers (RUN_PLAN §7.3; TOOLS_PLAN §6.5; old P1-11).
 *
 * - `layoutDiagram`: auto-layout zones (switches left, motors right, power
 *   top, spindle bottom) and a simple orthogonal channel router.
 * - `renderDom`: builds the on-screen SVG with `createElementNS`; every pin
 *   is a `<g data-pin>`; findings are markers.
 * - `renderString`: the export. Presentation attributes only (no `style`, no
 *   CSS variables), a fixed print palette, `<title>`/`<desc>`, wire table,
 *   BOM, checklist, the W14 footer always and the W14 watermark when the
 *   E-stop rule fires. It is the only code that writes SVG text and it
 *   escapes `& < > " '` in everything it writes.
 */
import { boardPins, type BoardPinInfo, type WiringBoard } from './board.ts';
import { checklist } from './checklist.ts';
import { COMPONENTS, type ComponentDef } from './components.ts';
import { boardEp, type Diagram, type Part, type Wire } from './diagram.ts';
import { exportFlags, type Finding } from './rules.ts';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const W14_WATERMARK = 'INCOMPLETE — NO E-STOP SHOWN';
export const W14_FOOTER = 'This diagram does not replace a qualified electrician. Emergency stop circuits must remove motor and spindle power in hardware.';

type Zone = 'left' | 'right' | 'top' | 'bottom';
const ZONE: Readonly<Record<Part['kind'], Zone>> = {
  switch: 'left',
  proximity: 'left',
  stepper: 'right',
  psu: 'top',
  mains: 'top',
  estop: 'top',
  contactor: 'top',
  usbIsolator: 'top',
  spindle: 'bottom',
  vfd: 'bottom',
  relay: 'bottom',
  buffer: 'bottom',
};

const PIN_STEP = 16;
const PART_W = 140;
const GAP = 60;

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface PlacedPart {
  readonly part: Part;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pinsRight: boolean;
}
export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly board: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly boardPins: readonly (BoardPinInfo & Point & { readonly side: 'left' | 'right' })[];
  readonly parts: readonly PlacedPart[];
  /** Every pin position, keyed by endpoint (`board:J7.3`, `part:pin`). */
  readonly pins: ReadonlyMap<string, Point>;
  readonly wires: readonly { readonly wire: Wire; readonly points: readonly Point[] }[];
}

const partH = (def: ComponentDef): number => 28 + def.pins.length * PIN_STEP;

export function layoutDiagram(diagram: Diagram, board: WiringBoard): Layout {
  const bp = boardPins(board);
  const connectors = [...new Set(bp.map((p) => p.connector))];
  const sideOf = (c: string): 'left' | 'right' => (connectors.indexOf(c) % 2 === 0 ? 'left' : 'right');
  const count = (s: 'left' | 'right'): number => bp.filter((p) => sideOf(p.connector) === s).length + connectors.filter((c) => sideOf(c) === s).length;
  const zones: Record<Zone, Part[]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of diagram.parts) zones[ZONE[p.kind]].push(p);
  const rowW = (n: number): number => n * (PART_W + 20);
  const boardW = 240;
  const colW = PART_W + 2 * GAP + 80;
  const width = Math.max(1000, colW * 2 + boardW, rowW(zones.top.length) + 2 * colW, rowW(zones.bottom.length) + 2 * colW);
  const topH = Math.max(0, ...zones.top.map((p) => partH(COMPONENTS[p.kind])));
  const boardX = (width - boardW) / 2;
  const boardY = 40 + topH + GAP;
  const boardH = Math.max(120, 40 + Math.max(count('left'), count('right')) * PIN_STEP);
  const pins = new Map<string, Point>();
  const placedPins: (BoardPinInfo & Point & { side: 'left' | 'right' })[] = [];
  for (const side of ['left', 'right'] as const) {
    let y = boardY + 36;
    for (const c of connectors.filter((x) => sideOf(x) === side)) {
      y += PIN_STEP; // connector heading
      for (const p of bp.filter((x) => x.connector === c)) {
        const pt = { x: side === 'left' ? boardX : boardX + boardW, y };
        pins.set(boardEp(p.ref), pt);
        placedPins.push({ ...p, ...pt, side });
        y += PIN_STEP;
      }
    }
  }
  const parts: PlacedPart[] = [];
  const place = (p: Part, x: number, y: number, pinsRight: boolean): number => {
    const def = COMPONENTS[p.kind];
    const h = partH(def);
    parts.push({ part: p, x, y, w: PART_W, h, pinsRight });
    def.pins.forEach((d, i) => pins.set(`${p.id}:${d.id}`, { x: pinsRight ? x + PART_W : x, y: y + 28 + i * PIN_STEP + PIN_STEP / 2 }));
    return h;
  };
  let ly = boardY;
  for (const p of zones.left) ly += place(p, 40, ly, true) + 20;
  let ry = boardY;
  for (const p of zones.right) ry += place(p, width - 40 - PART_W, ry, false) + 20;
  const rowX = (n: number): number => (width - rowW(n) + 20) / 2;
  zones.top.forEach((p, i) => {
    const x = rowX(zones.top.length) + i * (PART_W + 20);
    place(p, x, 40, x + PART_W / 2 < width / 2);
  });
  const bottomY = Math.max(boardY + boardH, ly, ry) + GAP;
  let bottomH = 0;
  zones.bottom.forEach((p, i) => {
    const x = rowX(zones.bottom.length) + i * (PART_W + 20);
    bottomH = Math.max(bottomH, place(p, x, bottomY, x + PART_W / 2 < width / 2));
  });
  const height = bottomY + bottomH + 40;
  const wires = diagram.wires.map((wire, i) => {
    const a = pins.get(wire.from) as Point;
    const b = pins.get(wire.to) as Point;
    const lane = ((i % 8) - 3.5) * 6;
    const cx = Math.round((a.x + b.x) / 2 + lane);
    return { wire, points: [a, { x: cx, y: a.y }, { x: cx, y: b.y }, b] };
  });
  return { width, height, board: { x: boardX, y: boardY, w: boardW, h: boardH }, boardPins: placedPins, parts, pins, wires };
}

/** Fixed print palette (export) and screen classes (DOM). */
const INK = '#111111';
const PAPER = '#ffffff';
const SEVERITY_COLOUR = { block: '#b00020', estop: '#b00020', warn: '#a35a00', info: '#1d4e89' } as const;

/** The element-building surface `renderDom` needs; a browser `Document` satisfies it. */
export interface SvgElementLike {
  setAttribute(name: string, value: string): void;
  appendChild(child: never): unknown;
  textContent: string | null;
}
export interface SvgDocumentLike {
  createElementNS(ns: typeof SVG_NS, name: string): SvgElementLike;
}

/** On-screen SVG for the editor. Labels go in as text nodes, never as markup. */
export function renderDom(doc: SvgDocumentLike, diagram: Diagram, board: WiringBoard, findings: readonly Finding[]): SvgElementLike {
  const L = layoutDiagram(diagram, board);
  const el = (name: string, attrs: Record<string, string | number>, parent?: SvgElementLike, text?: string): SvgElementLike => {
    const e = doc.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    if (parent !== undefined) parent.appendChild(e as never);
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${L.width} ${L.height}`, role: 'img', 'aria-label': `Wiring diagram for ${board.name}`, class: 'wiring-svg' });
  el('title', {}, svg, `Wiring diagram for ${board.name}`);
  const b = el('g', { 'data-board': board.id }, svg);
  el('rect', { x: L.board.x, y: L.board.y, width: L.board.w, height: L.board.h, class: 'wiring-board', rx: 6 }, b);
  el('text', { x: L.board.x + L.board.w / 2, y: L.board.y + 22, 'text-anchor': 'middle', class: 'wiring-board-name' }, b, board.name);
  for (const p of L.boardPins) {
    const g = el('g', { 'data-pin': p.ref, class: `wiring-pin wiring-pin-${p.role}` }, b);
    el('title', {}, g, `${p.ref} ${p.label}`);
    el('circle', { cx: p.x, cy: p.y, r: 4 }, g);
    el('text', { x: p.side === 'left' ? p.x + 8 : p.x - 8, y: p.y + 4, 'text-anchor': p.side === 'left' ? 'start' : 'end', class: 'wiring-pin-label' }, g, `${p.ref} ${p.label}`);
  }
  for (const pp of L.parts) {
    const g = el('g', { 'data-part': pp.part.id, class: `wiring-part wiring-part-${pp.part.kind}` }, svg);
    el('rect', { x: pp.x, y: pp.y, width: pp.w, height: pp.h, rx: 4 }, g);
    el('text', { x: pp.x + 8, y: pp.y + 18, class: 'wiring-part-label' }, g, pp.part.label || pp.part.id);
    for (const d of COMPONENTS[pp.part.kind].pins) {
      const at = L.pins.get(`${pp.part.id}:${d.id}`) as Point;
      const pg = el('g', { 'data-pin': `${pp.part.id}:${d.id}`, class: 'wiring-pin' }, g);
      el('circle', { cx: at.x, cy: at.y, r: 3.5 }, pg);
      el('text', { x: pp.pinsRight ? at.x - 6 : at.x + 6, y: at.y + 4, 'text-anchor': pp.pinsRight ? 'end' : 'start', class: 'wiring-pin-label' }, pg, d.label);
    }
  }
  for (const w of L.wires) {
    el('polyline', { points: w.points.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', class: `wiring-wire${w.wire.shielded === true ? ' wiring-wire-shielded' : ''}`, 'data-wire': w.wire.id }, svg);
  }
  for (const [i, f] of findings.entries()) {
    const refs = [...f.pins.map((r) => boardEp(r)), ...f.parts.flatMap((id) => [...L.pins.keys()].filter((k) => k.startsWith(`${id}:`)).slice(0, 1))];
    for (const r of refs) {
      const at = L.pins.get(r);
      if (at === undefined) continue;
      const g = el('g', { 'data-finding': f.rule, class: `wiring-finding wiring-finding-${f.severity}` }, svg);
      el('title', {}, g, `${f.rule}: ${f.message}`);
      el('circle', { cx: at.x, cy: at.y, r: 9, fill: 'none', 'stroke-width': 2, 'data-index': i }, g);
    }
  }
  if (exportFlags(findings).watermark) {
    el('text', { x: L.width / 2, y: L.height / 2, 'text-anchor': 'middle', class: 'wiring-watermark', 'data-watermark': 'w14', transform: `rotate(-20 ${L.width / 2} ${L.height / 2})` }, svg, W14_WATERMARK);
  }
  return svg;
}

/** Escapes text for SVG content and attribute values. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

export type Paper = 'letter' | 'a4';
const PAPER_SIZE: Readonly<Record<Paper, { w: string; h: string; vw: number; vh: number }>> = {
  letter: { w: '8.5in', h: '11in', vw: 850, vh: 1100 },
  a4: { w: '210mm', h: '297mm', vw: 840, vh: 1188 },
};

/** Ends a string at `max` characters so one long label cannot run off the page. */
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The export SVG. Every user-entered string passes through `escapeXml`; the
 * output uses only elements and presentation attributes the web app's export
 * allowlist accepts (apps/web security/tt.ts `brandSvgExport`).
 */
export function renderString(diagram: Diagram, board: WiringBoard, findings: readonly Finding[], opts: { readonly paper: Paper }): string {
  const L = layoutDiagram(diagram, board);
  const P = PAPER_SIZE[opts.paper];
  const flags = exportFlags(findings);
  const margin = 25;
  const scale = Math.min((P.vw - 2 * margin) / L.width, 600 / L.height);
  const parts: string[] = [];
  const t = (x: number, y: number, s: string, attrs = ''): string => `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="${INK}"${attrs}>${escapeXml(s)}</text>`;

  // Diagram, scaled into the top of the page.
  const d: string[] = [];
  d.push(`<rect x="${L.board.x}" y="${L.board.y}" width="${L.board.w}" height="${L.board.h}" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`);
  d.push(`<text x="${L.board.x + L.board.w / 2}" y="${L.board.y + 22}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" fill="${INK}">${escapeXml(board.name)}</text>`);
  for (const p of L.boardPins) {
    d.push(`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${PAPER}" stroke="${INK}"/>`);
    d.push(t(p.side === 'left' ? p.x + 8 : p.x - 8, p.y + 3, `${p.ref} ${p.label}`, p.side === 'left' ? '' : ' text-anchor="end"'));
  }
  for (const pp of L.parts) {
    d.push(`<rect x="${pp.x}" y="${pp.y}" width="${pp.w}" height="${pp.h}" rx="4" fill="${PAPER}" stroke="${INK}"/>`);
    d.push(t(pp.x + 8, pp.y + 18, clip(pp.part.label || pp.part.id, 24), ' font-weight="bold"'));
    for (const def of COMPONENTS[pp.part.kind].pins) {
      const at = L.pins.get(`${pp.part.id}:${def.id}`) as Point;
      d.push(`<circle cx="${at.x}" cy="${at.y}" r="3.5" fill="${PAPER}" stroke="${INK}"/>`);
      d.push(t(pp.pinsRight ? at.x - 6 : at.x + 6, at.y + 3, def.label, pp.pinsRight ? ' text-anchor="end"' : ''));
    }
  }
  for (const w of L.wires) {
    d.push(`<polyline points="${w.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.5"${w.wire.shielded === true ? ' stroke-dasharray="6 2"' : ''}/>`);
  }
  for (const f of findings) {
    for (const r of f.pins) {
      const at = L.pins.get(boardEp(r));
      if (at !== undefined) d.push(`<circle cx="${at.x}" cy="${at.y}" r="9" fill="none" stroke="${SEVERITY_COLOUR[f.severity]}" stroke-width="2"/>`);
    }
  }
  parts.push(`<g transform="translate(${margin} ${margin + 20}) scale(${scale.toFixed(4)})">${d.join('')}</g>`);
  parts.push(t(margin, margin + 8, `Wiring diagram: ${board.name}`, ' font-size="12" font-weight="bold"'));

  // Tables below the diagram.
  let y = margin + 20 + L.height * scale + 24;
  const line = (s: string, attrs = ''): void => {
    parts.push(t(margin, y, clip(s, 150), attrs));
    y += 12;
  };
  const endpointLabel = (e: string): string => {
    const [owner, pin] = [e.slice(0, e.indexOf(':')), e.slice(e.indexOf(':') + 1)];
    if (owner === 'board') return `board ${pin}`;
    const part = diagram.parts.find((p) => p.id === owner);
    return `${part?.label || owner} ${pin}`;
  };
  line('Wire table', ' font-weight="bold"');
  for (const w of diagram.wires) line(`${w.id}: ${endpointLabel(w.from)} → ${endpointLabel(w.to)}${w.color === undefined ? '' : `, ${w.color}`}${w.gauge === undefined ? '' : `, ${w.gauge}`}${w.shielded === true ? `, shielded (shield grounded at ${w.shieldGroundEnd ?? 'one'} end)` : ''}`);
  if (diagram.wires.length === 0) line('(no wires)');
  y += 6;
  line('Bill of materials', ' font-weight="bold"');
  for (const p of diagram.parts) line(`${p.label || p.id}: ${COMPONENTS[p.kind].title} (${Object.entries(p.props).map(([k, v]) => `${k} ${String(v)}`).join(', ')})`);
  if (diagram.parts.length === 0) line('(no parts)');
  y += 6;
  line('Findings', ' font-weight="bold"');
  for (const f of findings) line(`${f.severity.toUpperCase()} ${f.rule}: ${f.message}`);
  if (findings.length === 0) line('(none)');
  y += 6;
  line('Checklist', ' font-weight="bold"');
  for (const [i, c] of checklist(diagram, board).entries()) line(`${i + 1}. [ ] ${c.text}`);
  y += 18;
  const height = Math.max(P.vh, y + 30);
  parts.push(t(margin, height - margin, W14_FOOTER, ' font-size="8"'));
  if (flags.watermark) {
    parts.push(
      `<text x="${P.vw / 2}" y="${height / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="bold" fill="${SEVERITY_COLOUR.estop}" fill-opacity="0.35" transform="rotate(-30 ${P.vw / 2} ${height / 2})">${escapeXml(W14_WATERMARK)}</text>`,
    );
  }
  const desc = `${diagram.parts.length} parts, ${diagram.wires.length} wires, ${findings.length} findings${flags.watermark ? `; ${W14_WATERMARK}` : ''}`;
  const h = opts.paper === 'letter' ? `${((11 * height) / P.vh).toFixed(2)}in` : `${((297 * height) / P.vh).toFixed(0)}mm`;
  return (
    `<svg xmlns="${SVG_NS}" width="${P.w}" height="${h}" viewBox="0 0 ${P.vw} ${height}" role="img" aria-label="${escapeXml(`Wiring diagram for ${board.name}`)}">` +
    `<title>${escapeXml(`Wiring diagram for ${board.name}`)}</title><desc>${escapeXml(desc)}</desc>` +
    `<rect x="0" y="0" width="${P.vw}" height="${height}" fill="${PAPER}"/>` +
    parts.join('') +
    `</svg>`
  );
}
