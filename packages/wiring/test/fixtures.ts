/**
 * Wiring fixtures: the real generated TinyG v8 definition (TB-05a) and a
 * reference 3-axis TinyG diagram that passes every rule, which each rule test
 * then breaks in one way.
 */
import v8json from '../../schema/boards/tinyg/tinyg-v8@8.json' with { type: 'json' };
import { DIAGRAM_FORMAT, defaultProps, type Diagram, type Part, type PartKind, type PropValue, type Wire, type WiringBoard } from '../src/index.ts';

export const V8 = v8json as unknown as WiringBoard;

export function part(id: string, kind: PartKind, props: Record<string, PropValue> = {}, label = id): Part {
  return { id, kind, label, props: { ...defaultProps(kind), ...props } };
}

let n = 0;
export function wire(from: string, to: string, extra: Partial<Wire> = {}): Wire {
  n += 1;
  return { id: `w${n}`, from, to, ...extra };
}

const SH = { shielded: true, shieldGroundEnd: 'one' } as const;

/** Mains through the E-stop to the PSU and the VFD; NC switches at Xmin, Ymin, Zmax; PWM to the VFD through a buffer. */
export function reference(): Diagram {
  return {
    format: DIAGRAM_FORMAT,
    boardId: 'tinyg-v8@8',
    parts: [
      part('mains', 'mains'),
      part('estop', 'estop', {}, 'E-stop'),
      part('psu', 'psu', { volts: 24 }, 'Motor PSU'),
      part('vfd', 'vfd'),
      part('spindle', 'spindle', { type: 'vfd-spindle' }),
      part('buf', 'buffer', { outputV: 5 }),
      part('sx', 'switch', { contact: 'NC' }, 'X min'),
      part('sy', 'switch', { contact: 'NC' }, 'Y min'),
      part('sz', 'switch', { contact: 'NC' }, 'Z max'),
      part('mx', 'stepper', { currentA: 1.5 }, 'X motor'),
    ],
    wires: [
      wire('mains:L', 'estop:nc1a'),
      wire('estop:nc1b', 'psu:L'),
      wire('estop:nc1b', 'vfd:L'),
      wire('mains:N', 'psu:N'),
      wire('mains:N', 'vfd:N'),
      wire('mains:PE', 'psu:PE'),
      wire('mains:PE', 'vfd:PE'),
      wire('psu:+v', 'board:J1.2'),
      wire('psu:-v', 'board:J1.1'),
      wire('vfd:u', 'spindle:m1'),
      wire('vfd:v', 'spindle:m2'),
      wire('vfd:w', 'spindle:m3'),
      wire('board:J6.5', 'buf:in'),
      wire('buf:gnd', 'board:J6.1'),
      wire('buf:out', 'vfd:ain'),
      wire('vfd:com', 'board:J6.1'),
      wire('sx:sig', 'board:J7.3', SH),
      wire('sx:com', 'board:J7.1', SH),
      wire('sy:sig', 'board:J7.5', SH),
      wire('sy:com', 'board:J7.1', SH),
      wire('sz:sig', 'board:J8.4', SH),
      wire('sz:com', 'board:J8.1', SH),
    ],
  };
}

export function withParts(d: Diagram, parts: readonly Part[], wires: readonly Wire[] = []): Diagram {
  return { ...d, parts: [...d.parts, ...parts], wires: [...d.wires, ...wires] };
}

export function without(d: Diagram, pred: (w: Wire) => boolean): Diagram {
  return { ...d, wires: d.wires.filter((w) => !pred(w)) };
}

export function setProps(d: Diagram, id: string, props: Record<string, PropValue>): Diagram {
  return { ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, props: { ...p.props, ...props } } : p)) };
}
