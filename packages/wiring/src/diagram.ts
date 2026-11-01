/**
 * The diagram model (RUN_PLAN §7.3; TOOLS_PLAN §6.5 "Save format").
 *
 * `parts[]` plus `wires[{from, to, ...}]`. An endpoint is `board:J7.3` (a
 * board connector pin) or `<partId>:<pinId>`. `parseDiagram` validates
 * untrusted JSON against the board and the component library; everything
 * downstream (rules, renderers, editor) works on a parsed diagram only.
 */
import { boardPins, type BoardPinInfo, type WiringBoard } from './board.ts';
import { COMPONENTS, PART_KINDS, defaultProps, pinDef, type PartKind } from './components.ts';

export const DIAGRAM_FORMAT = 'synthetos-wiring@1';

export type PropValue = string | number | boolean;

export interface Part {
  readonly id: string;
  readonly kind: PartKind;
  readonly label: string;
  readonly props: Readonly<Record<string, PropValue>>;
}

export interface Wire {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly color?: string;
  readonly gauge?: string;
  readonly shielded?: boolean;
  readonly twisted?: boolean;
  /** Where the cable shield is grounded: at one end (recommended) or both. */
  readonly shieldGroundEnd?: 'one' | 'both';
}

export interface Diagram {
  readonly format: typeof DIAGRAM_FORMAT;
  readonly boardId: string;
  readonly parts: readonly Part[];
  readonly wires: readonly Wire[];
}

export const MAX_LABEL = 64;
const ID = /^[a-z][a-z0-9-]{0,31}$/;

export function emptyDiagram(boardId: string): Diagram {
  return { format: DIAGRAM_FORMAT, boardId, parts: [], wires: [] };
}

export type Endpoint = { readonly side: 'board'; readonly pin: BoardPinInfo } | { readonly side: 'part'; readonly part: Part; readonly pin: string };

/** Resolves an endpoint string; undefined when it names nothing. */
export function resolveEndpoint(ep: string, diagram: Diagram, pins: readonly BoardPinInfo[]): Endpoint | undefined {
  const i = ep.indexOf(':');
  if (i < 0) return undefined;
  const owner = ep.slice(0, i);
  const pin = ep.slice(i + 1);
  if (owner === 'board') {
    const b = pins.find((x) => x.ref === pin);
    return b === undefined ? undefined : { side: 'board', pin: b };
  }
  const part = diagram.parts.find((x) => x.id === owner);
  if (part === undefined || pinDef(part.kind, pin) === undefined) return undefined;
  return { side: 'part', part, pin };
}

export type ParsedDiagram = { readonly ok: true; readonly diagram: Diagram } | { readonly ok: false; readonly errors: readonly string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates untrusted JSON as a diagram for `board`. Unknown fields are refused. */
export function parseDiagram(json: unknown, board: WiringBoard): ParsedDiagram {
  const errors: string[] = [];
  if (!isRecord(json)) return { ok: false, errors: ['not an object'] };
  for (const k of Object.keys(json)) if (!['format', 'boardId', 'parts', 'wires'].includes(k)) errors.push(`unknown field ${k}`);
  if (json['format'] !== DIAGRAM_FORMAT) errors.push(`format must be ${DIAGRAM_FORMAT}`);
  if (json['boardId'] !== board.id) errors.push(`boardId must be ${board.id}`);
  const parts: Part[] = [];
  const rawParts = Array.isArray(json['parts']) ? json['parts'] : (errors.push('parts must be an array'), []);
  for (const [i, raw] of rawParts.entries()) {
    const at = `parts[${i}]`;
    if (!isRecord(raw)) {
      errors.push(`${at} not an object`);
      continue;
    }
    for (const k of Object.keys(raw)) if (!['id', 'kind', 'label', 'props'].includes(k)) errors.push(`${at} unknown field ${k}`);
    const { id, kind, label, props } = raw;
    if (typeof id !== 'string' || !ID.test(id) || id === 'board') errors.push(`${at}.id invalid`);
    else if (parts.some((x) => x.id === id)) errors.push(`${at}.id duplicate ${id}`);
    if (typeof kind !== 'string' || !PART_KINDS.includes(kind as PartKind)) {
      errors.push(`${at}.kind invalid`);
      continue;
    }
    if (typeof label !== 'string' || label.length > MAX_LABEL) errors.push(`${at}.label must be a string of at most ${MAX_LABEL} characters`);
    const def = COMPONENTS[kind as PartKind];
    const merged: Record<string, PropValue> = defaultProps(kind as PartKind);
    if (props !== undefined && !isRecord(props)) errors.push(`${at}.props not an object`);
    for (const [name, value] of Object.entries(isRecord(props) ? props : {})) {
      const d = def.props.find((x) => x.name === name);
      if (d === undefined) {
        errors.push(`${at}.props.${name} unknown`);
        continue;
      }
      const ok =
        d.type === 'number'
          ? typeof value === 'number' && Number.isFinite(value) && value >= d.min && value <= d.max
          : d.type === 'boolean'
            ? typeof value === 'boolean'
            : typeof value === 'string' && d.options.includes(value);
      if (!ok) errors.push(`${at}.props.${name} out of range`);
      else merged[name] = value as PropValue;
    }
    if (typeof id === 'string' && typeof label === 'string') parts.push({ id, kind: kind as PartKind, label, props: merged });
  }
  const shell: Diagram = { format: DIAGRAM_FORMAT, boardId: board.id, parts, wires: [] };
  const pins = boardPins(board);
  const wires: Wire[] = [];
  const rawWires = Array.isArray(json['wires']) ? json['wires'] : (errors.push('wires must be an array'), []);
  for (const [i, raw] of rawWires.entries()) {
    const at = `wires[${i}]`;
    if (!isRecord(raw)) {
      errors.push(`${at} not an object`);
      continue;
    }
    for (const k of Object.keys(raw)) if (!['id', 'from', 'to', 'color', 'gauge', 'shielded', 'twisted', 'shieldGroundEnd'].includes(k)) errors.push(`${at} unknown field ${k}`);
    const { id, from, to } = raw;
    if (typeof id !== 'string' || !ID.test(id)) errors.push(`${at}.id invalid`);
    else if (wires.some((w) => w.id === id)) errors.push(`${at}.id duplicate ${id}`);
    for (const [name, ep] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (typeof ep !== 'string' || resolveEndpoint(ep, shell, pins) === undefined) errors.push(`${at}.${name} names no pin`);
    }
    if (from === to) errors.push(`${at} connects a pin to itself`);
    for (const k of ['color', 'gauge'] as const) if (raw[k] !== undefined && (typeof raw[k] !== 'string' || (raw[k] as string).length > MAX_LABEL)) errors.push(`${at}.${k} invalid`);
    for (const k of ['shielded', 'twisted'] as const) if (raw[k] !== undefined && typeof raw[k] !== 'boolean') errors.push(`${at}.${k} invalid`);
    if (raw['shieldGroundEnd'] !== undefined && raw['shieldGroundEnd'] !== 'one' && raw['shieldGroundEnd'] !== 'both') errors.push(`${at}.shieldGroundEnd invalid`);
    if (typeof id === 'string' && typeof from === 'string' && typeof to === 'string') wires.push({ ...(raw as unknown as Wire) });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, diagram: { ...shell, wires } };
}

/** Canonical JSON: keys sorted at every level, so equal diagrams hash equal. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** A change-detection hash (two FNV-1a 32-bit lanes, hex). Not a security hash. */
export function hashDiagram(d: Diagram): string {
  const s = canonicalJson(d);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Nets: endpoints joined by wires (union-find). All board pins on the same
 * named net (GND, 3V3, VMOT) are one net. A switching contact (E-stop,
 * contactor, relay) does not join its two sides; the rules treat it as an edge.
 */
export class Netlist {
  private readonly parent = new Map<string, string>();
  readonly diagram: Diagram;
  readonly pins: readonly BoardPinInfo[];
  constructor(diagram: Diagram, pins: readonly BoardPinInfo[]) {
    this.diagram = diagram;
    this.pins = pins;
    for (const p of pins) if (p.net !== undefined) this.union(`board:${p.ref}`, `board:#${p.net}`);
    for (const w of diagram.wires) this.union(w.from, w.to);
  }
  private find(x: string): string {
    let r = x;
    while (this.parent.has(r) && this.parent.get(r) !== r) r = this.parent.get(r) as string;
    this.parent.set(x, r);
    return r;
  }
  private union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  net(ep: string): string {
    return this.find(ep);
  }
  same(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
  /** Every endpoint (wired, or a board pin) on the same net as `ep`, excluding `ep`. */
  members(ep: string): string[] {
    const n = this.find(ep);
    const all = new Set<string>();
    for (const w of this.diagram.wires) for (const e of [w.from, w.to]) all.add(e);
    for (const p of this.pins) all.add(`board:${p.ref}`);
    return [...all].filter((e) => e !== ep && this.find(e) === n);
  }
  /** True when a wire touches the endpoint. */
  wired(ep: string): boolean {
    return this.diagram.wires.some((w) => w.from === ep || w.to === ep);
  }
}
