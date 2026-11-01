/**
 * The component library (RUN_PLAN §7.3; TOOLS_PLAN §6.5 "Component library").
 *
 * Each component lists its pins with an electrical role and its properties
 * with type, range and default. The rules engine reasons only from these
 * roles and properties, never from labels the user typed.
 */

export type PartKind =
  | 'stepper'
  | 'switch'
  | 'proximity'
  | 'estop'
  | 'contactor'
  | 'psu'
  | 'mains'
  | 'relay'
  | 'buffer'
  | 'vfd'
  | 'spindle'
  | 'usbIsolator';

/**
 * - `signal-out`: drives a line (sensor output, buffer output).
 * - `signal-in`: reads a line (relay input, buffer input, VFD control input).
 * - `ground`: the part's signal or supply return.
 * - `supply-in` / `supply-out`: DC supply into or out of the part.
 * - `mains`: AC line or neutral.
 * - `earth`: protective earth.
 * - `contact`: one side of a switching contact (see `contacts`).
 * - `motor`: motor winding or spindle motor lead.
 * - `data`: a USB data side.
 */
export type PinRole = 'signal-out' | 'signal-in' | 'ground' | 'supply-in' | 'supply-out' | 'mains' | 'earth' | 'contact' | 'motor' | 'data';

export interface PinDef {
  readonly id: string;
  readonly label: string;
  readonly role: PinRole;
}

export type PropDef =
  | { readonly name: string; readonly label: string; readonly type: 'number'; readonly min: number; readonly max: number; readonly unit: string; readonly default: number }
  | { readonly name: string; readonly label: string; readonly type: 'enum'; readonly options: readonly string[]; readonly default: string }
  | { readonly name: string; readonly label: string; readonly type: 'boolean'; readonly default: boolean };

export interface ComponentDef {
  readonly kind: PartKind;
  readonly title: string;
  readonly pins: readonly PinDef[];
  /** Pairs of `contact` pins that a switching element connects. */
  readonly contacts: readonly (readonly [string, string])[];
  readonly props: readonly PropDef[];
  readonly src: string;
}

const LIB = 'TOOLS_PLAN §6.5 component library';

const p = (id: string, label: string, role: PinRole): PinDef => ({ id, label, role });

export const COMPONENTS: Readonly<Record<PartKind, ComponentDef>> = Object.freeze({
  stepper: {
    kind: 'stepper',
    title: 'Stepper motor',
    pins: [p('a+', 'A+', 'motor'), p('a-', 'A-', 'motor'), p('b+', 'B+', 'motor'), p('b-', 'B-', 'motor')],
    contacts: [],
    props: [
      { name: 'leads', label: 'Leads', type: 'enum', options: ['4', '6', '8'], default: '4' },
      { name: 'currentA', label: 'Rated current per phase', type: 'number', min: 0, max: 10, unit: 'A', default: 1.5 },
    ],
    src: `${LIB}: stepper (4/6/8 wire, colour map)`,
  },
  switch: {
    kind: 'switch',
    title: 'Mechanical switch',
    pins: [p('com', 'COM', 'ground'), p('sig', 'NO/NC', 'signal-out')],
    contacts: [],
    props: [{ name: 'contact', label: 'Contact', type: 'enum', options: ['NC', 'NO'], default: 'NC' }],
    src: `${LIB}: switch (mechanical NO/NC)`,
  },
  proximity: {
    kind: 'proximity',
    title: 'Inductive proximity sensor',
    pins: [p('v+', 'V+', 'supply-in'), p('0v', '0V', 'ground'), p('out', 'OUT', 'signal-out')],
    contacts: [],
    props: [
      { name: 'output', label: 'Output', type: 'enum', options: ['NPN', 'PNP'], default: 'NPN' },
      { name: 'contact', label: 'Contact', type: 'enum', options: ['NO', 'NC'], default: 'NO' },
      { name: 'supplyV', label: 'Supply voltage', type: 'number', min: 0, max: 60, unit: 'V', default: 24 },
    ],
    src: `${LIB}: switch (NPN/PNP inductive with supply voltage)`,
  },
  estop: {
    kind: 'estop',
    title: 'E-stop (NC main + NC aux)',
    pins: [p('nc1a', 'NC1 a', 'contact'), p('nc1b', 'NC1 b', 'contact'), p('nc2a', 'NC2 a', 'contact'), p('nc2b', 'NC2 b', 'contact')],
    contacts: [
      ['nc1a', 'nc1b'],
      ['nc2a', 'nc2b'],
    ],
    props: [],
    src: `${LIB}: E-stop (NC main + NC aux)`,
  },
  contactor: {
    kind: 'contactor',
    title: 'Contactor or safety relay',
    pins: [p('a1', 'A1', 'supply-in'), p('a2', 'A2', 'ground'), p('l1', 'L1', 'contact'), p('t1', 'T1', 'contact'), p('l2', 'L2', 'contact'), p('t2', 'T2', 'contact')],
    contacts: [
      ['l1', 't1'],
      ['l2', 't2'],
    ],
    props: [{ name: 'coilV', label: 'Coil voltage', type: 'number', min: 0, max: 250, unit: 'V', default: 24 }],
    src: `${LIB}: contactor or safety relay`,
  },
  psu: {
    kind: 'psu',
    title: 'Power supply (DC)',
    pins: [p('L', 'L', 'mains'), p('N', 'N', 'mains'), p('PE', 'PE', 'earth'), p('+v', '+V', 'supply-out'), p('-v', '-V', 'ground')],
    contacts: [],
    props: [
      { name: 'volts', label: 'Output voltage', type: 'number', min: 0, max: 60, unit: 'V', default: 24 },
      { name: 'amps', label: 'Output current', type: 'number', min: 0, max: 100, unit: 'A', default: 10 },
    ],
    src: `${LIB}: PSU (V, A, earth)`,
  },
  mains: {
    kind: 'mains',
    title: 'Mains supply',
    pins: [p('L', 'L', 'mains'), p('N', 'N', 'mains'), p('PE', 'PE', 'earth')],
    contacts: [],
    props: [{ name: 'volts', label: 'Voltage', type: 'number', min: 100, max: 250, unit: 'V AC', default: 230 }],
    src: `${LIB}: PSU input side (mains feed)`,
  },
  relay: {
    kind: 'relay',
    title: 'Relay module or SSR',
    pins: [p('sig', 'IN', 'signal-in'), p('gnd', 'GND / IN-', 'ground'), p('vcc', 'VCC', 'supply-in'), p('com', 'COM', 'contact'), p('no', 'NO', 'contact')],
    contacts: [['com', 'no']],
    props: [
      { name: 'type', label: 'Type', type: 'enum', options: ['relay', 'ssr'], default: 'ssr' },
      { name: 'activeLow', label: 'Active low (switches on when IN is low)', type: 'boolean', default: false },
      { name: 'inputV', label: 'Input voltage', type: 'number', min: 0, max: 32, unit: 'V', default: 3 },
      { name: 'inputmA', label: 'Input current', type: 'number', min: 0, max: 200, unit: 'mA', default: 10 },
    ],
    src: `${LIB}: relay or SSR (input V and mA, active-high or active-low)`,
  },
  buffer: {
    kind: 'buffer',
    title: 'Buffer or level shifter',
    pins: [p('vcc', 'VCC', 'supply-in'), p('gnd', 'GND', 'ground'), p('in', 'IN', 'signal-in'), p('out', 'OUT', 'signal-out')],
    contacts: [],
    props: [{ name: 'outputV', label: 'Output high level', type: 'number', min: 0, max: 30, unit: 'V', default: 5 }],
    src: `${LIB}: buffer or level shifter`,
  },
  vfd: {
    kind: 'vfd',
    title: 'VFD',
    pins: [
      p('L', 'L', 'mains'),
      p('N', 'N', 'mains'),
      p('PE', 'PE', 'earth'),
      p('u', 'U', 'motor'),
      p('v', 'V', 'motor'),
      p('w', 'W', 'motor'),
      p('fwd', 'FWD', 'signal-in'),
      p('ain', 'AIN', 'signal-in'),
      p('com', 'COM', 'ground'),
    ],
    contacts: [],
    props: [{ name: 'control', label: 'Speed input', type: 'enum', options: ['0-10V', 'PWM'], default: '0-10V' }],
    src: `${LIB}: VFD (0-10 V or PWM)`,
  },
  spindle: {
    kind: 'spindle',
    title: 'Spindle',
    pins: [p('m1', 'M1 / L', 'motor'), p('m2', 'M2 / N', 'motor'), p('m3', 'M3', 'motor'), p('PE', 'PE', 'earth')],
    contacts: [],
    props: [{ name: 'type', label: 'Type', type: 'enum', options: ['router', 'vfd-spindle', 'brushed-dc', 'laser', 'plasma'], default: 'vfd-spindle' }],
    src: `${LIB}: spindle`,
  },
  usbIsolator: {
    kind: 'usbIsolator',
    title: 'USB isolator',
    pins: [p('host', 'Host side', 'data'), p('device', 'Device side', 'data')],
    contacts: [],
    props: [],
    src: `${LIB}: USB isolator`,
  },
});

export const PART_KINDS: readonly PartKind[] = Object.freeze(Object.keys(COMPONENTS) as PartKind[]);

export function pinDef(kind: PartKind, pin: string): PinDef | undefined {
  return COMPONENTS[kind].pins.find((x) => x.id === pin);
}

export function defaultProps(kind: PartKind): Record<string, string | number | boolean> {
  return Object.fromEntries(COMPONENTS[kind].props.map((d) => [d.name, d.default]));
}
