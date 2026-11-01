/**
 * Board pins, the diagram model, expected settings and the checklist
 * (old P1-08, P1-10; TOOLS_PLAN §6.5).
 */
import { describe, expect, it } from 'vitest';
import { boardPins, checklist, confirmWord, expectedSettings, hashDiagram, keyClass, parseDiagram, type WiringBoard } from '../src/index.ts';
import { V8, part, reference, wire, withParts } from './fixtures.ts';

describe('board pins (generated TinyG v8 definition)', () => {
  it('J7 Xmin is a 3.3 V input, not 5 V tolerant, sourced from the v8h schematic', () => {
    const x = boardPins(V8).find((p) => p.ref === 'J7.3');
    expect(x).toMatchObject({ role: 'input', signal: 'in.limit-min-x', maxV: 3.3, tolerant5v: false, verified: 'schematic' });
    expect(boardPins(V8).find((p) => p.ref === 'J6.4')).toMatchObject({ role: 'output', signal: 'out.spindleDirection' });
    expect(boardPins(V8).find((p) => p.ref === 'J1.2')?.role).toBe('motor-supply');
    expect(boardPins(V8).every((p) => p.src.length > 0)).toBe(true);
  });

  it('a board with no logic-level rating is treated as 3.3 V, not 5 V tolerant, and says so', () => {
    const bare: WiringBoard = { ...V8, ratings: [] };
    const x = boardPins(bare).find((p) => p.ref === 'J7.3');
    expect(x).toMatchObject({ maxV: 3.3, tolerant5v: false, verified: 'unverified' });
    expect(x?.src).toContain('no logic-level rating');
  });
});

describe('parseDiagram', () => {
  it('accepts the reference diagram and fills defaults', () => {
    const r = parseDiagram(JSON.parse(JSON.stringify(reference())), V8);
    expect(r.ok).toBe(true);
  });

  it.each([
    ['an unknown part kind', (d: Record<string, unknown>) => ({ ...d, parts: [{ id: 'x', kind: 'laser-cannon', label: 'x', props: {} }] })],
    ['a wire to a pin the board does not have', (d: Record<string, unknown>) => ({ ...d, wires: [{ id: 'w', from: 'board:J9.1', to: 'board:J7.1' }] })],
    ['a prop out of range', (d: Record<string, unknown>) => ({ ...d, parts: [{ id: 'p', kind: 'psu', label: 'p', props: { volts: 600 } }], wires: [] })],
    ['a label over 64 characters', (d: Record<string, unknown>) => ({ ...d, parts: [{ id: 'p', kind: 'psu', label: 'x'.repeat(65), props: {} }], wires: [] })],
    ['an unknown field', (d: Record<string, unknown>) => ({ ...d, script: 'x' })],
    ['a duplicate part id', (d: Record<string, unknown>) => ({ ...d, parts: [{ id: 'p', kind: 'psu', label: '', props: {} }, { id: 'p', kind: 'psu', label: '', props: {} }], wires: [] })],
    ['another board', (d: Record<string, unknown>) => ({ ...d, boardId: 'tinyg-v7@7' })],
  ])('refuses %s', (_label, mutate) => {
    const r = parseDiagram(mutate(JSON.parse(JSON.stringify(reference())) as Record<string, unknown>), V8);
    expect(r.ok).toBe(false);
  });

  it('the hash ignores key order and changes with content', () => {
    const d = reference();
    const reordered = JSON.parse(JSON.stringify({ wires: d.wires, parts: d.parts, boardId: d.boardId, format: d.format }));
    expect(hashDiagram(reordered)).toBe(hashDiagram(d));
    expect(hashDiagram(withParts(d, [part('extra', 'buffer')]))).not.toBe(hashDiagram(d));
  });
});

describe('expectedSettings', () => {
  it('NC switches at Xmin, Ymin and Zmax give st=1, xsn/ysn/zsx=1 and every other switch key 0', () => {
    const s = Object.fromEntries(expectedSettings(reference(), V8, 'tinyg-en').map((e) => [e.key, e.value]));
    expect(s).toEqual({ st: 1, xsn: 1, xsx: 0, ysn: 1, ysx: 0, zsn: 0, zsx: 1, asn: 0, asx: 0 });
  });

  it('every key carries its class and a firmware citation', () => {
    for (const e of expectedSettings(reference(), V8, 'tinyg-en')) {
      expect(e.keyClass).toBe('switch');
      expect(e.src).toMatch(/\.c:\d+/);
    }
    expect(expectedSettings(reference(), V8, 'tinyg-440').find((e) => e.key === 'st')?.src).toContain('TG switch.c:256');
  });

  it('mixed NO and NC switches give no st proposal', () => {
    const d = { ...reference(), parts: reference().parts.map((p) => (p.id === 'sy' ? { ...p, props: { ...p.props, contact: 'NO' } } : p)) };
    expect(expectedSettings(d, V8, 'tinyg-en').map((e) => e.key)).not.toContain('st');
  });

  it('EN: an active-high SSR behind a buffer on Spin proposes spep=1 (polarity class); 440 has no spep', () => {
    const d = withParts(reference(), [part('b2', 'buffer'), part('ssr', 'relay', { type: 'ssr', activeLow: false })], [
      wire('board:J6.3', 'b2:in'),
      wire('b2:out', 'ssr:sig'),
    ]);
    expect(expectedSettings(d, V8, 'tinyg-en').find((e) => e.key === 'spep')).toMatchObject({ value: 1, keyClass: 'polarity' });
    expect(expectedSettings(d, V8, 'tinyg-440').find((e) => e.key === 'spep')).toBeUndefined();
  });

  it('key classes: polarity and switch keys need a typed word, others do not', () => {
    expect(['spep', 'spdp', 'prbp', '1po', '4po'].map(keyClass)).toEqual(['polarity', 'polarity', 'polarity', 'polarity', 'polarity']);
    expect(['st', 'xsn', 'zsx', 'asn'].map(keyClass)).toEqual(['switch', 'switch', 'switch', 'switch']);
    expect(['xvm', '1tr', 'stx'].map(keyClass)).toEqual(['other', 'other', 'other']);
    expect(confirmWord('polarity')).toBe('POLARITY');
    expect(confirmWord('switch')).toBe('SWITCH');
    expect(confirmWord('other')).toBeUndefined();
  });
});

describe('checklist', () => {
  it('orders power off, then motors with power off, then power on', () => {
    const ids = checklist(reference(), V8).map((c) => c.id);
    expect(ids[0]).toBe('power-off');
    expect(ids.indexOf('motors-power-off')).toBeLessThan(ids.indexOf('power-on'));
    expect(ids.at(-1)).toBe('power-on');
    expect(checklist(reference(), V8).find((c) => c.id === 'trimpot')?.text).toContain('8 o’clock to about 4 o’clock');
  });

  it('prints a VREF number only when the board data states RSENSE', () => {
    const withRs = checklist(reference(), V8).find((c) => c.id === 'vref-mx');
    expect(withRs?.text).toContain('= 1.200 V');
    expect(withRs?.src).toContain('ICHOP = VREF / (8 × RSENSE)');
    const noRs: WiringBoard = { ...V8, ratings: (V8.ratings ?? []).filter((r) => r.id !== 'senseResistors') };
    const without = checklist(reference(), noRs).find((c) => c.id === 'vref-mx');
    expect(without?.text).toContain('RSENSE is not known');
    expect(without?.text).not.toMatch(/\d V\b/);
  });
});
