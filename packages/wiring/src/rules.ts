/**
 * The wiring rules engine (RUN_PLAN §7.3; TOOLS_PLAN §6.5 "Rules engine";
 * SAFETY H13, W14, W15).
 *
 * Pure: `rules(diagram, board, dialect)` returns findings, each with a rule
 * id, severity, message, citation and the parts and pins involved. Every rule
 * in `RULES` has a test (the rules test fails if one does not).
 *
 * Severity `estop` is the E-stop rule: it never blocks export (blocking export
 * only teaches people to draw a fake E-stop) but it puts the W14 watermark on
 * every export and blocks the "wired per diagram" attestation.
 */
import { boardElectrical, boardPins, driverRating, type BoardPinInfo, type WiringBoard } from './board.ts';
import { COMPONENTS, pinDef } from './components.ts';
import { Netlist, type Diagram, type Part } from './diagram.ts';

export type Dialect = 'tinyg-en' | 'tinyg-440' | 'g2core' | 'unknown';
export type Severity = 'block' | 'warn' | 'info' | 'estop';

export interface Finding {
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly message: string;
  readonly cite: string;
  readonly parts: readonly string[];
  readonly pins: readonly string[];
}

export interface RuleDef {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly cite: string;
}

const PLAN = 'TOOLS_PLAN §6.5 rules engine';

export const RULES = [
  { id: 'WR-LEVEL', severity: 'block', title: 'Voltage above a 3.3 V, not 5 V tolerant pin', cite: `${PLAN}; board logic-level rating` },
  { id: 'WR-J6-BUFFER', severity: 'block', title: 'Relay or SSR driven straight from a TinyG output', cite: `${PLAN}; TinyG.wiki TinyG-Using-External-Drivers.md:18; TinyG-Start-v6-and-Earlier.md:19` },
  { id: 'WR-ACTIVE-LOW', severity: 'block', title: 'Active-low relay module on a TinyG output', cite: `${PLAN}; RUN_PLAN §7.3; PROTOCOL_NOTES §13.1` },
  { id: 'WR-SPINDIR', severity: 'warn', title: 'Something wired to SpinDir', cite: `${PLAN}; xboot config.mk:156-157; EN hardware.h:188,192 (SPINDLE_DIR_LED is the indicator LED); bench B-FL-2` },
  { id: 'WR-SERIES', severity: 'block', title: 'Supplies stacked in series', cite: PLAN },
  { id: 'WR-COMMON-GND', severity: 'block', title: 'Signal device without a common ground', cite: PLAN },
  { id: 'WR-EARTH', severity: 'warn', title: 'PSU earth not connected', cite: PLAN },
  { id: 'WR-VMAX', severity: 'block', title: 'Motor supply above the board maximum', cite: `${PLAN}; board supply rating` },
  { id: 'WR-VWARN', severity: 'warn', title: 'Motor supply above the protection margin', cite: `${PLAN}; bench B-TVS-1` },
  { id: 'WR-VMIN', severity: 'warn', title: 'Motor supply below the board minimum', cite: `${PLAN}; board supply rating` },
  { id: 'WR-NO-RATING', severity: 'info', title: 'No supply rating known for this board', cite: 'RUN_PLAN §5.1 rule 6 (no guessed facts)' },
  { id: 'WR-SWITCH-ON-OUTPUT', severity: 'block', title: 'Switch wired to an output pin', cite: `${PLAN}; g2core board/ArduinoDue/gShield-pinout.h:133-208` },
  { id: 'WR-SHIELD', severity: 'warn', title: 'Unshielded switch run near a spindle or VFD', cite: PLAN },
  { id: 'WR-SHIELD-BOTH', severity: 'warn', title: 'Cable shield grounded at both ends', cite: PLAN },
  { id: 'WR-SWITCH-NO', severity: 'warn', title: 'Normally open switch (NC recommended)', cite: PLAN },
  { id: 'WR-CURRENT', severity: 'warn', title: 'Motor current above the driver maximum', cite: `${PLAN}; TI DRV8818 SLVSAX9G` },
  { id: 'WR-LASER-G2', severity: 'block', title: 'Laser or plasma on a g2 board', cite: `${PLAN}; bench B-G2-8` },
  { id: 'WR-LASER-TG', severity: 'block', title: 'Laser or plasma on TinyG', cite: 'SAFETY W15; TOOLS_PLAN §6.5' },
  { id: 'WR-ESTOP', severity: 'estop', title: 'No E-stop that removes motor and spindle power', cite: 'SAFETY W14; TOOLS_PLAN §6.5 E-STOP rule' },
  { id: 'WR-VMOT-RESET', severity: 'info', title: 'Cutting Vmot resets TinyG', cite: 'SAFETY HIL-2.13; TOOLS_PLAN §6.5' },
] as const satisfies readonly RuleDef[];

export type RuleId = (typeof RULES)[number]['id'];

const ruleDef = (id: RuleId): RuleDef => RULES.find((r) => r.id === id) as RuleDef;

/** Rule text for the active-low BLOCK, per dialect (RUN_PLAN §7.3; PN §13.1). */
export function activeLowText(dialect: Dialect): { readonly message: string; readonly cite: string } {
  const base = 'An active-low relay module switches on when its input is low or not driven.';
  const en =
    'On EN firmware the spindle and coolant pins stay inputs (high impedance) while settings load at boot, so the module can switch on during reset and boot; spep and spdp set the OFF level only after settings load. A feedhold also leaves outputs on.';
  const enCite = 'PROTOCOL_NOTES §13.1; EN spindle.c:56-60 (spindle_init_outputs runs after settings load); EN docs/configuration-layout-2.md "Output levels during boot"; bench B-IO-1';
  const tg =
    'TinyG 440.21 has no output polarity setting, so the module runs whenever the output is commanded off. The outputs may also float during reset (UNVERIFIED: bench items B-IO-1 and B-FL-2).';
  const tgCite = 'TOOLS_PLAN §6.5 (no polarity setting on 440.21; XMEGA reset state UNVERIFIED, B-IO-1, B-FL-2)';
  if (dialect === 'tinyg-en') return { message: `${base} ${en}`, cite: enCite };
  if (dialect === 'tinyg-440') return { message: `${base} ${tg}`, cite: tgCite };
  return { message: `${base} ${en} ${tg}`, cite: `${enCite}; ${tgCite}` };
}

const ep = (part: Part, pin: string): string => `${part.id}:${pin}`;
const num = (part: Part, name: string): number => Number(part.props[name]);

interface Ctx {
  readonly diagram: Diagram;
  readonly board: WiringBoard;
  readonly dialect: Dialect;
  readonly pins: readonly BoardPinInfo[];
  readonly nl: Netlist;
}

function partOf(ctx: Ctx, endpoint: string): { part: Part; pin: string } | undefined {
  const i = endpoint.indexOf(':');
  const id = endpoint.slice(0, i);
  const part = ctx.diagram.parts.find((p) => p.id === id);
  return part === undefined ? undefined : { part, pin: endpoint.slice(i + 1) };
}

/** Board signal pins on the same net as `endpoint`. */
function boardPinsOnNet(ctx: Ctx, endpoint: string): BoardPinInfo[] {
  return ctx.pins.filter((p) => (p.role === 'input' || p.role === 'output' || p.role === 'logic-supply') && ctx.nl.same(`board:${p.ref}`, endpoint));
}

/** The highest voltage a source on the net can put on it, and which source. */
function netVoltage(ctx: Ctx, endpoint: string): { volts: number; source: string } {
  let best = { volts: 0, source: '' };
  const consider = (volts: number, source: string): void => {
    if (volts > best.volts) best = { volts, source };
  };
  for (const m of [endpoint, ...ctx.nl.members(endpoint)]) {
    if (m.startsWith('board:')) {
      const b = ctx.pins.find((p) => `board:${p.ref}` === m);
      if (b?.role === 'logic-supply') consider(3.3, `board ${b.ref} (3.3 V)`);
      continue;
    }
    const o = partOf(ctx, m);
    if (o === undefined) continue;
    const { part, pin } = o;
    const who = `${part.label || part.id}`;
    if (part.kind === 'psu' && pin === '+v') consider(num(part, 'volts'), `${who} (${num(part, 'volts')} V supply)`);
    if (part.kind === 'proximity' && pin === 'out')
      consider(
        num(part, 'supplyV'),
        `${who} (${part.props['output']} sensor on ${num(part, 'supplyV')} V; ${part.props['output'] === 'NPN' ? 'NPN modules commonly pull their output up to the sensor supply' : 'a PNP output switches the sensor supply'})`,
      );
    if (part.kind === 'buffer' && pin === 'out') consider(num(part, 'outputV'), `${who} (${num(part, 'outputV')} V output)`);
    if ((part.kind === 'mains' || part.kind === 'psu' || part.kind === 'vfd') && (pin === 'L' || pin === 'N')) consider(230, `${who} (mains)`);
  }
  return best;
}

interface Edge {
  readonly a: string;
  readonly b: string;
  readonly kind: 'estop' | 'contactor' | 'relay' | 'psu';
  readonly part: Part;
}

/** Power paths for the E-stop rule: which loads an E-stop (directly or through a contactor it controls) disconnects. */
export function estopAnalysis(diagram: Diagram, board: WiringBoard): { readonly hasEstop: boolean; readonly loads: readonly { readonly name: string; readonly endpoint: string; readonly broken: boolean }[]; readonly vmotBroken: boolean } {
  const pins = boardPins(board);
  const nl = new Netlist(diagram, pins);
  const edges: Edge[] = [];
  const roots = new Set<string>();
  for (const part of diagram.parts) {
    for (const [a, b] of COMPONENTS[part.kind].contacts) {
      edges.push({ a: nl.net(ep(part, a)), b: nl.net(ep(part, b)), kind: part.kind === 'estop' ? 'estop' : part.kind === 'contactor' ? 'contactor' : 'relay', part });
    }
    if (part.kind === 'mains') roots.add(nl.net(ep(part, 'L')));
    if (part.kind === 'psu') {
      if (nl.wired(ep(part, 'L'))) edges.push({ a: nl.net(ep(part, 'L')), b: nl.net(ep(part, '+v')), kind: 'psu', part });
      else roots.add(nl.net(ep(part, '+v')));
    }
  }
  const reach = (target: string, skip: (e: Edge) => boolean): boolean => {
    const t = nl.net(target);
    const seen = new Set(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const n = queue.shift() as string;
      if (n === t) return true;
      for (const e of edges) {
        if (skip(e)) continue;
        // A PSU passes power from its input to its output only.
        const next = e.a === n ? e.b : e.kind !== 'psu' && e.b === n ? e.a : undefined;
        if (next !== undefined && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  const isEstop = (e: Edge): boolean => e.kind === 'estop';
  const controlled = new Set(
    diagram.parts.filter((p) => p.kind === 'contactor' && reach(ep(p, 'a1'), () => false) && !reach(ep(p, 'a1'), isEstop)).map((p) => p.id),
  );
  const cut = (e: Edge): boolean => e.kind === 'estop' || (e.kind === 'contactor' && controlled.has(e.part.id));
  const loads: { name: string; endpoint: string; broken: boolean }[] = [];
  const hasVmot = pins.some((p) => p.role === 'motor-supply');
  if (hasVmot) loads.push({ name: 'motor power (Vmot)', endpoint: 'board:#VMOT', broken: false });
  const hasVfd = diagram.parts.some((p) => p.kind === 'vfd');
  for (const p of diagram.parts) {
    if (p.kind === 'vfd') loads.push({ name: `${p.label || p.id} supply`, endpoint: ep(p, 'L'), broken: false });
    if (p.kind === 'spindle' && !(p.props['type'] === 'vfd-spindle' && hasVfd)) loads.push({ name: `${p.label || p.id} supply`, endpoint: ep(p, 'm1'), broken: false });
  }
  const done = loads.map((l) => ({ ...l, broken: reach(l.endpoint, () => false) && !reach(l.endpoint, cut) }));
  return {
    hasEstop: diagram.parts.some((p) => p.kind === 'estop'),
    loads: done,
    vmotBroken: done.some((l) => l.endpoint === 'board:#VMOT' && l.broken),
  };
}

/** Runs every rule. Findings are ordered by rule, then by the order parts appear. */
export function rules(diagram: Diagram, board: WiringBoard, dialect: Dialect): readonly Finding[] {
  const pins = boardPins(board);
  const ctx: Ctx = { diagram, board, dialect, pins, nl: new Netlist(diagram, pins) };
  const out: Finding[] = [];
  const add = (rule: RuleId, message: string, parts: readonly string[], pinRefs: readonly string[], cite?: string): void => {
    const d = ruleDef(rule);
    out.push({ rule, severity: d.severity, message, cite: cite ?? d.cite, parts, pins: pinRefs });
  };
  const elec = boardElectrical(board);
  const tinyg = board.family === 'tinyg';
  const name = (p: Part): string => p.label || p.id;

  // WR-LEVEL (one finding per net: the 3.3 V pins of every connector are one rail)
  const levelNets = new Set<string>();
  for (const b of pins) {
    if (b.role !== 'input' && b.role !== 'output' && b.role !== 'logic-supply') continue;
    const net = ctx.nl.net(`board:${b.ref}`);
    if (levelNets.has(net)) continue;
    levelNets.add(net);
    const v = netVoltage(ctx, `board:${b.ref}`);
    const limit = b.tolerant5v ? 5 : b.maxV;
    if (v.volts > limit) {
      const parts = ctx.nl.members(`board:${b.ref}`).map((m) => partOf(ctx, m)?.part.id).filter((x): x is string => x !== undefined);
      add('WR-LEVEL', `${b.label} (${b.ref}) is a ${b.maxV} V pin that is not 5 V tolerant; ${v.source} can put ${v.volts} V on it. Use a sensor or interface rated for 3.3 V logic, or an opto-isolator or level shifter.`, parts, [b.ref], `${ruleDef('WR-LEVEL').cite}: ${b.src}`);
    }
  }

  // Parts whose signal pin sits on a board signal pin.
  const attached = (pred: (p: Part, pin: string) => boolean): { part: Part; pin: string; board: BoardPinInfo }[] => {
    const r: { part: Part; pin: string; board: BoardPinInfo }[] = [];
    for (const part of diagram.parts) {
      for (const d of COMPONENTS[part.kind].pins) {
        if (!pred(part, d.id)) continue;
        for (const b of boardPinsOnNet(ctx, ep(part, d.id))) if (b.role !== 'logic-supply') r.push({ part, pin: d.id, board: b });
      }
    }
    return r;
  };

  // WR-J6-BUFFER
  if (tinyg) {
    for (const a of attached((p, pin) => p.kind === 'relay' && pin === 'sig')) {
      if (a.board.role !== 'output') continue;
      add('WR-J6-BUFFER', `${name(a.part)} (${a.part.props['type'] === 'ssr' ? 'SSR' : 'relay'}) is driven straight from ${a.board.label} (${a.board.ref}). TinyG outputs are ${elec.outputDrive?.text ?? '3.3 V logic, a few mA'}: put a buffer or driver between the board and the ${a.part.props['type'] === 'ssr' ? 'SSR' : 'relay'}.`, [a.part.id], [a.board.ref], elec.outputDrive === undefined ? undefined : `${ruleDef('WR-J6-BUFFER').cite}; ${elec.outputDrive.src}`);
    }
  }

  // WR-ACTIVE-LOW
  if (tinyg) {
    const text = activeLowText(dialect);
    for (const part of diagram.parts) {
      if (part.kind !== 'relay' || part.props['activeLow'] !== true) continue;
      const sig = ep(part, 'sig');
      const direct = boardPinsOnNet(ctx, sig).filter((b) => b.role === 'output');
      const viaBuffer = diagram.parts
        .filter((b) => b.kind === 'buffer' && ctx.nl.same(ep(b, 'out'), sig))
        .flatMap((b) => boardPinsOnNet(ctx, ep(b, 'in')).filter((x) => x.role === 'output'));
      const outs = [...direct, ...viaBuffer];
      if (outs.length === 0) continue;
      add('WR-ACTIVE-LOW', `${name(part)} on ${outs.map((o) => `${o.label} (${o.ref})`).join(', ')}: ${text.message}`, [part.id], outs.map((o) => o.ref), `${ruleDef('WR-ACTIVE-LOW').cite}; ${text.cite}`);
    }
  }

  // WR-SPINDIR
  for (const b of pins.filter((x) => x.signal === 'out.spindleDirection')) {
    const parts = ctx.nl.members(`board:${b.ref}`).map((m) => partOf(ctx, m)?.part.id).filter((x): x is string => x !== undefined);
    if (parts.length > 0) add('WR-SPINDIR', `Something is wired to ${b.label} (${b.ref}). The bootloader blinks this pin as its LED while it waits after reset; what that does at the pin is UNVERIFIED until a scope check. Do not wire anything here that must stay off.`, parts, [b.ref]);
  }

  // WR-SERIES
  const psus = diagram.parts.filter((p) => p.kind === 'psu');
  for (const a of psus) for (const b of psus) if (a !== b && ctx.nl.same(ep(a, '-v'), ep(b, '+v'))) add('WR-SERIES', `${name(a)} and ${name(b)} are stacked in series. Use one supply rated for the voltage you need.`, [a.id, b.id], []);

  // WR-COMMON-GND
  const hasGnd = pins.some((p) => p.role === 'ground');
  if (hasGnd) {
    const seen = new Set<string>();
    for (const a of attached((p, pin) => {
      const r = pinDef(p.kind, pin)?.role;
      return r === 'signal-out' || r === 'signal-in';
    })) {
      if (seen.has(a.part.id)) continue;
      seen.add(a.part.id);
      const grounds = COMPONENTS[a.part.kind].pins.filter((d) => d.role === 'ground').map((d) => ep(a.part, d.id));
      const missing = grounds.filter((g) => !ctx.nl.same(g, 'board:#GND'));
      if (missing.length > 0) add('WR-COMMON-GND', `${name(a.part)} signals on ${a.board.label} (${a.board.ref}) but its ${missing.map((m) => m.slice(m.indexOf(':') + 1).toUpperCase()).join(', ')} is not on board GND. A signal needs a common ground to return through.`, [a.part.id], [a.board.ref]);
    }
  }

  // WR-EARTH
  for (const p of psus) if (!ctx.nl.wired(ep(p, 'PE'))) add('WR-EARTH', `${name(p)} has no protective earth connected.`, [p.id], []);

  // WR-VMAX, WR-VWARN, WR-VMIN, WR-NO-RATING
  for (const p of psus) {
    if (!ctx.nl.same(ep(p, '+v'), 'board:#VMOT')) continue;
    const v = num(p, 'volts');
    const s = elec.supply;
    if (s === undefined) {
      add('WR-NO-RATING', `${board.name} has no supply rating in the board data; check ${name(p)} (${v} V) against the board's documentation.`, [p.id], []);
      continue;
    }
    if (v > s.max) add('WR-VMAX', `${name(p)} is ${v} V; ${board.name} accepts ${s.min}-${s.max} V (${s.recommend} V recommended).`, [p.id], [], `${ruleDef('WR-VMAX').cite}: ${s.src}`);
    else if (s.warnAbove !== undefined && v > s.warnAbove.volts) add('WR-VWARN', `${name(p)} is ${v} V, above ${s.warnAbove.volts} V where the input protection may conduct; ${s.recommend} V is recommended.`, [p.id], [], `${s.src}; ${s.warnAbove.src}`);
    if (v < s.min) add('WR-VMIN', `${name(p)} is ${v} V; ${board.name} needs at least ${s.min} V.`, [p.id], [], `${ruleDef('WR-VMIN').cite}: ${s.src}`);
  }

  // WR-SWITCH-ON-OUTPUT
  for (const a of attached((p, pin) => (p.kind === 'switch' && pin === 'sig') || (p.kind === 'proximity' && pin === 'out'))) {
    if (a.board.role !== 'output') continue;
    add('WR-SWITCH-ON-OUTPUT', `${name(a.part)} is wired to ${a.board.label} (${a.board.ref}), which the firmware drives as an output (${a.board.signal?.slice(4) ?? 'output'}). Wire switches to input pins only.`, [a.part.id], [a.board.ref], `${ruleDef('WR-SWITCH-ON-OUTPUT').cite}; ${a.board.src}`);
  }

  // WR-SHIELD, WR-SHIELD-BOTH, WR-SWITCH-NO
  const noisy = diagram.parts.some((p) => p.kind === 'vfd' || (p.kind === 'spindle' && ['router', 'brushed-dc', 'vfd-spindle'].includes(String(p.props['type']))));
  const switchPins = new Set(diagram.parts.flatMap((p) => (p.kind === 'switch' ? [ep(p, 'sig')] : p.kind === 'proximity' ? [ep(p, 'out')] : [])));
  if (noisy) {
    for (const w of diagram.wires) {
      if ((switchPins.has(w.from) || switchPins.has(w.to)) && w.shielded !== true) {
        const sw = (switchPins.has(w.from) ? w.from : w.to).split(':')[0] as string;
        add('WR-SHIELD', `Wire ${w.id} from ${sw} is unshielded and this machine has a spindle or VFD. Use shielded cable for switch runs, shield grounded at one end.`, [sw], []);
      }
    }
  }
  for (const w of diagram.wires) if (w.shieldGroundEnd === 'both') add('WR-SHIELD-BOTH', `Wire ${w.id} has its shield grounded at both ends; ground it at one end (the controller end) to avoid a ground loop.`, [], []);
  for (const p of diagram.parts) if (p.kind === 'switch' && p.props['contact'] === 'NO') add('WR-SWITCH-NO', `${name(p)} is normally open. A normally closed switch also reports a broken wire; NC is recommended.`, [p.id], []);

  // WR-CURRENT
  const drv = driverRating(board);
  if (drv !== undefined) {
    for (const p of diagram.parts) {
      if (p.kind === 'stepper' && num(p, 'currentA') > drv.maxA) add('WR-CURRENT', `${name(p)} is rated ${num(p, 'currentA')} A; the ${drv.name} drives at most ${drv.maxA} A per winding, and only with adequate cooling. Set the driver no higher than ${drv.maxA} A.`, [p.id], [], `${ruleDef('WR-CURRENT').cite}: ${drv.src}`);
    }
  }

  // WR-LASER-G2, WR-LASER-TG
  for (const p of diagram.parts) {
    if (p.kind !== 'spindle' || (p.props['type'] !== 'laser' && p.props['type'] !== 'plasma')) continue;
    if (board.family === 'g2core') add('WR-LASER-G2', `${name(p)}: laser and plasma are not supported on g2 boards until the output polarity behaviour is verified for this board (B-G2-8).`, [p.id], []);
    if (tinyg) add('WR-LASER-TG', `${name(p)}: laser and plasma are not supported on TinyG (W15).`, [p.id], []);
  }

  // WR-ESTOP, WR-VMOT-RESET
  const es = estopAnalysis(diagram, board);
  if (!es.hasEstop) add('WR-ESTOP', 'No E-stop is shown. Exports carry the "INCOMPLETE — NO E-STOP SHOWN" watermark and "wired per diagram" cannot be attested.', [], []);
  else {
    const open = es.loads.filter((l) => !l.broken);
    if (open.length > 0) add('WR-ESTOP', `The E-stop does not remove ${open.map((l) => l.name).join(' and ')}. An E-stop must cut motor and spindle power in hardware.`, diagram.parts.filter((p) => p.kind === 'estop').map((p) => p.id), []);
  }
  if (tinyg && elec.logicFromVmot !== undefined && es.vmotBroken) add('WR-VMOT-RESET', 'Cutting Vmot also resets the TinyG (its logic is powered from Vmot): position is lost and the machine must be homed again.', [], [], `${ruleDef('WR-VMOT-RESET').cite}; ${elec.logicFromVmot.src}`);

  return out;
}

export interface ExportFlags {
  /** W14: put "INCOMPLETE — NO E-STOP SHOWN" on every export. */
  readonly watermark: boolean;
  /** The "wired per diagram" attestation is not offered. */
  readonly attestationBlocked: boolean;
  readonly blocking: number;
}

export function exportFlags(findings: readonly Finding[]): ExportFlags {
  const estop = findings.some((f) => f.severity === 'estop');
  const blocking = findings.filter((f) => f.severity === 'block').length;
  return { watermark: estop, attestationBlocked: estop || blocking > 0, blocking };
}
