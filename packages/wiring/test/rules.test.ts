/**
 * One test per wiring rule (old P1-10 acceptance; TOOLS_PLAN §6.5). Each test
 * name starts with the rule id; the last test fails if a rule in RULES has no
 * test here. Fixtures follow the forum incidents the rules come from.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARDUINO_DUE_GSHIELD, RULES, activeLowText, emptyDiagram, exportFlags, rules, type Diagram, type Dialect, type WiringBoard } from '../src/index.ts';
import { V8, part, reference, setProps, wire, withParts, without } from './fixtures.ts';

const ids = (d: Diagram, board: WiringBoard = V8, dialect: Dialect = 'tinyg-en') => rules(d, board, dialect).map((f) => f.rule);
const find = (d: Diagram, id: string, board: WiringBoard = V8, dialect: Dialect = 'tinyg-en') => rules(d, board, dialect).filter((f) => f.rule === id);

describe('the reference 3-axis TinyG diagram', () => {
  it('passes every rule; only the Vmot reset note remains', () => {
    expect(ids(reference())).toEqual(['WR-VMOT-RESET']);
    expect(exportFlags(rules(reference(), V8, 'tinyg-en'))).toEqual({ watermark: false, attestationBlocked: false, blocking: 0 });
  });
});

describe('rules', () => {
  it('WR-LEVEL: a 24 V NPN proximity sensor on J7 Xmin blocks', () => {
    const d = withParts(without(reference(), (w) => w.from.startsWith('sx:')), [part('prox', 'proximity', { output: 'NPN', supplyV: 24 })], [
      wire('prox:out', 'board:J7.3'),
      wire('prox:0v', 'board:J7.1'),
      wire('prox:v+', 'psu:+v'),
    ]);
    const f = find(d, 'WR-LEVEL');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('block');
    expect(f[0]?.pins).toEqual(['J7.3']);
    expect(f[0]?.message).toContain('24 V');
    expect(f[0]?.cite).toContain('v8schematics/v8h');
  });

  it('WR-LEVEL: a supply wired onto the 3.3 V rail or an output blocks too, a 3.3 V sensor does not', () => {
    expect(find(withParts(reference(), [], [wire('psu:+v', 'board:J7.2')]), 'WR-LEVEL')).toHaveLength(1);
    const ok = withParts(without(reference(), (w) => w.from.startsWith('sx:')), [part('prox', 'proximity', { supplyV: 3.3 })], [wire('prox:out', 'board:J7.3'), wire('prox:0v', 'board:J7.1')]);
    expect(find(ok, 'WR-LEVEL')).toEqual([]);
  });

  it('WR-J6-BUFFER: an SSR straight on J6 Spin blocks; through a buffer it does not', () => {
    const direct = withParts(reference(), [part('ssr', 'relay', { type: 'ssr' })], [wire('ssr:sig', 'board:J6.3'), wire('ssr:gnd', 'board:J6.1')]);
    const f = find(direct, 'WR-J6-BUFFER');
    expect(f.map((x) => [x.severity, x.pins])).toEqual([['block', ['J6.3']]]);
    expect(f[0]?.message).toContain('a few mA');
    const buffered = withParts(reference(), [part('b2', 'buffer'), part('ssr', 'relay', { type: 'ssr' })], [
      wire('board:J6.3', 'b2:in'),
      wire('b2:gnd', 'board:J6.1'),
      wire('b2:out', 'ssr:sig'),
      wire('ssr:gnd', 'board:J6.1'),
    ]);
    expect(find(buffered, 'WR-J6-BUFFER')).toEqual([]);
  });

  it('WR-ACTIVE-LOW: an active-low relay module on J6 Spin blocks even through a buffer, with the boot float note', () => {
    const d = withParts(reference(), [part('b2', 'buffer'), part('rl', 'relay', { type: 'relay', activeLow: true })], [
      wire('board:J6.3', 'b2:in'),
      wire('b2:gnd', 'board:J6.1'),
      wire('b2:out', 'rl:sig'),
      wire('rl:gnd', 'board:J6.1'),
    ]);
    const f = find(d, 'WR-ACTIVE-LOW', V8, 'tinyg-en');
    expect(f.map((x) => [x.severity, x.pins])).toEqual([['block', ['J6.3']]]);
    expect(f[0]?.message).toContain('while settings load at boot');
    expect(f[0]?.cite).toContain('PROTOCOL_NOTES §13.1');
    expect(f[0]?.cite).toContain('spindle.c:56-60');
    expect(find(setProps(d, 'rl', { activeLow: false }), 'WR-ACTIVE-LOW')).toEqual([]);
  });

  it('WR-ACTIVE-LOW EN rule text: boot float and hold, no "no polarity setting" reason; 440 keeps that reason', () => {
    const en = activeLowText('tinyg-en');
    expect(en.message).toContain('stay inputs (high impedance) while settings load at boot');
    expect(en.message).toContain('A feedhold also leaves outputs on');
    expect(en.message).not.toContain('no output polarity setting');
    const tg = activeLowText('tinyg-440');
    expect(tg.message).toContain('no output polarity setting');
    expect(tg.message).not.toContain('settings load at boot');
    const unknown = activeLowText('unknown');
    expect(unknown.message).toContain('settings load at boot');
    expect(unknown.message).toContain('no output polarity setting');
  });

  it('WR-SPINDIR: anything on J6 SpinDir warns citing B-FL-2', () => {
    const d = withParts(reference(), [part('b2', 'buffer')], [wire('board:J6.4', 'b2:in'), wire('b2:gnd', 'board:J6.1')]);
    const f = find(d, 'WR-SPINDIR');
    expect(f.map((x) => [x.severity, x.pins])).toEqual([['warn', ['J6.4']]]);
    expect(f[0]?.cite).toContain('B-FL-2');
  });

  it('WR-SERIES: two 12 V bricks in series block', () => {
    const d = without(reference(), (w) => w.from.startsWith('psu:'));
    const s = withParts(d, [part('p1', 'psu', { volts: 12 }), part('p2', 'psu', { volts: 12 })], [
      wire('p1:+v', 'board:J1.2'),
      wire('p1:-v', 'p2:+v'),
      wire('p2:-v', 'board:J1.1'),
      wire('p1:PE', 'mains:PE'),
      wire('p2:PE', 'mains:PE'),
    ]);
    expect(find(s, 'WR-SERIES').map((f) => f.severity)).toContain('block');
  });

  it('WR-COMMON-GND: a switch whose common is not on board ground blocks', () => {
    const d = without(reference(), (w) => w.from === 'sx:com');
    const f = find(d, 'WR-COMMON-GND');
    expect(f.map((x) => [x.severity, x.parts])).toEqual([['block', ['sx']]]);
  });

  it('WR-EARTH: a PSU with no earth warns', () => {
    expect(find(without(reference(), (w) => w.to === 'psu:PE'), 'WR-EARTH').map((f) => f.severity)).toEqual(['warn']);
  });

  it('WR-VMAX: 36 V on TinyG blocks', () => {
    const f = find(setProps(reference(), 'psu', { volts: 36 }), 'WR-VMAX');
    expect(f.map((x) => x.severity)).toEqual(['block']);
    expect(f[0]?.cite).toContain('Connecting-TinyG.md:18');
  });

  it('WR-VWARN: 30 V on TinyG warns above 26 V (B-TVS-1)', () => {
    const d = setProps(reference(), 'psu', { volts: 30 });
    expect(find(d, 'WR-VWARN').map((x) => x.severity)).toEqual(['warn']);
    expect(find(d, 'WR-VWARN')[0]?.cite).toContain('B-TVS-1');
    expect(find(d, 'WR-VMAX')).toEqual([]);
  });

  it('WR-VMIN: 10 V on TinyG warns', () => {
    expect(find(setProps(reference(), 'psu', { volts: 10 }), 'WR-VMIN').map((x) => x.severity)).toEqual(['warn']);
  });

  it('WR-NO-RATING: a board with no supply rating gets a note, not a guessed limit', () => {
    const other: WiringBoard = { ...V8, id: 'tinyg-test@1' };
    const d = { ...setProps(reference(), 'psu', { volts: 48 }), boardId: other.id };
    expect(find(d, 'WR-NO-RATING', other).map((x) => x.severity)).toEqual(['info']);
    expect(find(d, 'WR-VMAX', other)).toEqual([]);
  });

  it('WR-SWITCH-ON-OUTPUT: a gShield-on-Due limit switch on D12 (spindle enable) blocks', () => {
    const d = { ...emptyDiagram(ARDUINO_DUE_GSHIELD.id), parts: [part('lim', 'switch')], wires: [wire('lim:sig', 'board:D.12'), wire('lim:com', 'board:D.0')] };
    const f = find(d, 'WR-SWITCH-ON-OUTPUT', ARDUINO_DUE_GSHIELD, 'g2core');
    expect(f.map((x) => [x.severity, x.pins])).toEqual([['block', ['D.12']]]);
    expect(f[0]?.message).toContain('spindleEnable');
    expect(f[0]?.cite).toContain('gShield-pinout.h');
  });

  it('WR-SHIELD: an unshielded switch run with a VFD present warns', () => {
    const d = { ...reference(), wires: reference().wires.map((w) => (w.from === 'sx:sig' ? { ...w, shielded: false } : w)) };
    expect(find(d, 'WR-SHIELD').map((x) => [x.severity, x.parts])).toEqual([['warn', ['sx']]]);
  });

  it('WR-SHIELD-BOTH: a shield grounded at both ends warns', () => {
    const d = { ...reference(), wires: reference().wires.map((w) => (w.from === 'sx:sig' ? { ...w, shieldGroundEnd: 'both' as const } : w)) };
    expect(find(d, 'WR-SHIELD-BOTH').map((x) => x.severity)).toEqual(['warn']);
  });

  it('WR-SWITCH-NO: a normally open switch warns', () => {
    expect(find(setProps(reference(), 'sx', { contact: 'NO' }), 'WR-SWITCH-NO').map((x) => [x.severity, x.parts])).toEqual([['warn', ['sx']]]);
  });

  it('WR-CURRENT: 3 A on a DRV8818 warns citing TI SLVSAX9G', () => {
    const f = find(setProps(reference(), 'mx', { currentA: 3 }), 'WR-CURRENT');
    expect(f.map((x) => x.severity)).toEqual(['warn']);
    expect(f[0]?.message).toContain('2.5 A');
    expect(f[0]?.cite).toContain('SLVSAX9G');
  });

  it('WR-LASER-G2: a laser on a g2 board blocks citing B-G2-8', () => {
    const d = { ...emptyDiagram(ARDUINO_DUE_GSHIELD.id), parts: [part('l', 'spindle', { type: 'laser' })], wires: [] };
    expect(find(d, 'WR-LASER-G2', ARDUINO_DUE_GSHIELD, 'g2core').map((x) => x.severity)).toEqual(['block']);
  });

  it('WR-LASER-TG: plasma on TinyG blocks (W15)', () => {
    expect(find(setProps(reference(), 'spindle', { type: 'plasma' }), 'WR-LASER-TG').map((x) => x.severity)).toEqual(['block']);
  });

  it('WR-ESTOP: no E-stop flags the watermark and blocks the attestation, but not export', () => {
    const d = { ...reference(), parts: reference().parts.filter((p) => p.id !== 'estop'), wires: [...reference().wires.filter((w) => !w.from.startsWith('estop') && w.to !== 'estop:nc1a'), wire('mains:L', 'psu:L'), wire('mains:L', 'vfd:L')] };
    const f = rules(d, V8, 'tinyg-en');
    expect(f.filter((x) => x.rule === 'WR-ESTOP').map((x) => x.severity)).toEqual(['estop']);
    expect(exportFlags(f)).toEqual({ watermark: true, attestationBlocked: true, blocking: 0 });
  });

  it('WR-ESTOP: an E-stop that breaks Vmot but not the VFD supply is flagged', () => {
    const d = { ...reference(), wires: [...reference().wires.filter((w) => !(w.from === 'estop:nc1b' && w.to === 'vfd:L')), wire('mains:L', 'vfd:L')] };
    const f = find(d, 'WR-ESTOP');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('vfd supply');
    expect(f[0]?.message).not.toContain('Vmot');
    expect(exportFlags(rules(d, V8, 'tinyg-en')).watermark).toBe(true);
  });

  it('WR-ESTOP: an E-stop in a contactor coil circuit, with the contactor cutting the supplies, passes', () => {
    const base = reference();
    const d: Diagram = {
      ...base,
      parts: [...base.parts, part('k1', 'contactor')],
      wires: [
        ...base.wires.filter((w) => w.from !== 'mains:L' && w.from !== 'estop:nc1b'),
        wire('mains:L', 'k1:l1'),
        wire('k1:t1', 'psu:L'),
        wire('k1:t1', 'vfd:L'),
        wire('mains:L', 'estop:nc1a'),
        wire('estop:nc1b', 'k1:a1'),
        wire('k1:a2', 'mains:N'),
      ],
    };
    expect(find(d, 'WR-ESTOP')).toEqual([]);
    // The same contactor with the E-stop not in its coil circuit does not count.
    const bypass = { ...d, wires: [...d.wires.filter((w) => w.to !== 'k1:a1'), wire('mains:L', 'k1:a1')] };
    expect(find(bypass, 'WR-ESTOP')).toHaveLength(1);
  });

  it('WR-VMOT-RESET: an E-stop cutting Vmot on TinyG notes that position is lost', () => {
    const f = find(reference(), 'WR-VMOT-RESET');
    expect(f.map((x) => x.severity)).toEqual(['info']);
    expect(f[0]?.message).toContain('position is lost');
  });

  it('every rule in RULES has a test named after it, and every finding cites a source', () => {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    for (const r of RULES) expect(src, r.id).toContain(`it('${r.id}`);
    for (const r of RULES) expect(r.cite.length, r.id).toBeGreaterThan(0);
  });
});
