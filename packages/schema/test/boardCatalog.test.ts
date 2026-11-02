/**
 * Generated board definitions (ROADMAP TB-05a acceptance): every TinyG
 * revision edge-next recognises has a definition, overlay pins exist in the
 * generated pin map, each definition drives its own panel set, and an
 * unknown hv selects the safe subset with a visible notice.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_DEFINITIONS,
  UNCERTAIN_BOARD_NOTICE,
  UNRECOGNISED_BOARD_NOTICE,
  boardPanels,
  checkBoardConsistency,
  parseBoardDefinition,
  selectBoard,
  selectGeneratedBoard,
} from '../src/index.ts';
import type { BoardDefinition } from '../src/index.ts';
import dueJson from './fixtures/boards/g2core/arduino-due-gshield@na.json' with { type: 'json' };

const byId = (id: string): BoardDefinition => {
  const b = BOARD_DEFINITIONS.find((d) => d.id === id);
  if (b === undefined) throw new Error(`no ${id}`);
  return b;
};

describe('generated TinyG definitions', () => {
  it('cover every hv edge-next accepts by name (6, 7, 8) on hp 1, and nothing else', () => {
    expect(BOARD_DEFINITIONS.map((d) => d.id)).toEqual(['tinyg-v6@6', 'tinyg-v7@7', 'tinyg-v8@8']);
    for (const d of BOARD_DEFINITIONS) {
      expect(d.family).toBe('tinyg');
      expect(d.match.hp).toBe(1);
      expect(d.source).toMatchObject({ kind: 'generated', firmware: 'EN@97321391' });
    }
  });

  it('every hv selects its own definition exactly', () => {
    for (const hv of [6, 7, 8]) {
      const s = selectGeneratedBoard({ family: 'tinyg', hp: 1, hv });
      expect(s).toMatchObject({ kind: 'exact', board: { id: `tinyg-v${hv}@${hv}` } });
    }
  });

  it('v6 moves the coolant GPIO output to PD5; the spindle PWM waveform stays on PD5 (TCD1 OC1B), so both are conflicting', () => {
    const mcu = (b: BoardDefinition, signal: string) => b.pins?.find((p) => p.signal === signal)?.mcu;
    const verified = (b: BoardDefinition, signal: string) => b.pins?.find((p) => p.signal === signal)?.verified;
    expect(mcu(byId('tinyg-v8@8'), 'out.spindlePwm')).toBe('PD5');
    expect(mcu(byId('tinyg-v8@8'), 'out.coolant')).toBe('PE5');
    expect(mcu(byId('tinyg-v7@7'), 'out.spindlePwm')).toBe('PD5');
    expect(mcu(byId('tinyg-v6@6'), 'out.spindlePwm')).toBe('PD5');
    expect(verified(byId('tinyg-v6@6'), 'out.spindlePwm')).toBe('unverified');
    expect(mcu(byId('tinyg-v6@6'), 'out.coolant')).toBe('PD5');
    expect(verified(byId('tinyg-v6@6'), 'out.coolant')).toBe('unverified');
    expect(mcu(byId('tinyg-v6@6'), 'out.spindleEnable')).toBe('PA5');
  });

  it('every overlay connector pin that names a signal names one in the generated pin map', () => {
    let checked = 0;
    for (const d of BOARD_DEFINITIONS) {
      const signals = new Set((d.pins ?? []).map((p) => p.signal));
      for (const c of d.connectors ?? []) {
        for (const p of c.pins) {
          if (p.signal === undefined) continue;
          expect(signals.has(p.signal), `${d.id} ${c.id}.${p.n}`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(12);
  });

  it('only facts from public sources: no hardware-repo fact, and no src names a local path', () => {
    const text = JSON.stringify(BOARD_DEFINITIONS);
    expect(text).not.toContain('"verified":"hardware-repo"');
    expect(text).not.toMatch(/\/Volumes|\/Users|synthetos-hw|\.kicad/);
  });
});

describe('pin consistency (parseBoardDefinition)', () => {
  const v8 = (): Record<string, unknown> => JSON.parse(JSON.stringify(byId('tinyg-v8@8'))) as Record<string, unknown>;

  it('refuses a connector pin naming a signal the pin map does not have', () => {
    const json = v8();
    json['pins'] = (json['pins'] as { signal: string }[]).filter((p) => p.signal !== 'out.coolant');
    const parsed = parseBoardDefinition(json);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.message).toContain('out.coolant');
  });

  it('refuses a duplicated signal, connector, pin number, or a pin with both signal and net', () => {
    const b = byId('tinyg-v8@8');
    const pins = b.pins ?? [];
    const conns = b.connectors ?? [];
    const first = conns[0];
    if (first === undefined) throw new Error('no connectors');
    expect(checkBoardConsistency({ ...b, pins: [...pins, pins[0] as (typeof pins)[number]] })).toHaveLength(1);
    expect(checkBoardConsistency({ ...b, connectors: [...conns, first] })).toHaveLength(1);
    expect(checkBoardConsistency({ ...b, connectors: [{ ...first, pins: [...first.pins, first.pins[0] as (typeof first.pins)[number]] }] })).toHaveLength(1);
    expect(checkBoardConsistency({ ...b, connectors: [{ ...first, pins: [{ n: 1, label: 'x', signal: 'out.coolant', net: 'GND' }] }] })).toHaveLength(1);
    expect(checkBoardConsistency(b)).toEqual([]);
  });
});

describe('capability-driven panels', () => {
  const ids = (s: ReturnType<typeof boardPanels>) => s.panels.map((p) => (p.kind === 'output' ? `output:${p.id}` : p.kind));

  it('TinyG v8 shows spindle direction and its connectors; the Due+gShield shows no spindle direction', () => {
    const v8 = boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv: 8 }));
    expect(v8.notice).toBeUndefined();
    expect(ids(v8)).toEqual(['motors', 'inputs', 'output:spindleEnable', 'output:spindleDirection', 'output:spindlePwm', 'output:coolant', 'connectors', 'ratings']);
    const due = parseBoardDefinition(dueJson);
    if (!due.ok) throw new Error('fixture');
    const g2 = boardPanels(selectBoard({ family: 'g2core', hp: due.board.match.hp, hv: due.board.match.hv[0] as string | number }, [due.board]));
    expect(ids(g2)).not.toContain('output:spindleDirection');
    expect(ids(g2)).not.toContain('connectors');
  });

  it('v6 and v7 have no overlay, so no connector or rating panel', () => {
    for (const hv of [6, 7]) expect(ids(boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv })))).not.toContain('connectors');
  });

  it('an unknown hv selects the empty safe subset with the unrecognised revision notice', () => {
    for (const hv of [9, 5, 7.5, 'v8']) {
      const s = boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv }));
      expect(s.notice?.text).toBe(UNRECOGNISED_BOARD_NOTICE);
      expect(s.panels).toEqual([]);
    }
  });

  it('an ambiguous match says so and shows only the common panels', () => {
    const v8 = byId('tinyg-v8@8');
    const other = { ...byId('tinyg-v7@7'), match: { hp: 1, hv: [8] } };
    const s = boardPanels(selectBoard({ family: 'tinyg', hp: 1, hv: 8 }, [v8, other]));
    expect(s.notice?.text).toBe(UNCERTAIN_BOARD_NOTICE);
    expect(ids(s)).not.toContain('connectors');
    expect(ids(s)).toContain('output:coolant');
  });
});
