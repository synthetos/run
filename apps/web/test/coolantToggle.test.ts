/**
 * The Job page's coolant control (owner, 2026-11-18, pictures 151 and 152): one toggle named by what the machine
 * says is wired (Flood M8, Mist M7, Air M7, M9 off), hidden when the machine says none, and "Coolant" (M8) with a
 * link to Board → the coolant pin while the machine has no choice yet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import type { MachineCoolant } from '@synthetos/library';
import type { MotionCommand } from '../src/machine-worker/rpc.ts';
import { all, root, text, type El } from './tree.ts';
import { CoolantToggle, type CoolantToggleProps } from '../src/workspace/views/run/coolantToggle.ts';
import { boardTab, pinRequest, viewRequest } from '../src/workspace/boardNavigation.ts';

afterEach(() => { pinRequest.value = null; viewRequest.value = null; boardTab.value = 'overview'; });

function render(kind: MachineCoolant | null, extra: Partial<CoolantToggleProps> = {}) {
  const sent: MotionCommand[] = [];
  const el = root(h('div', null, h(CoolantToggle, { kind, pressed: false, canOn: true, canOff: true, run: (c) => sent.push(c), ...extra })));
  const toggle = all(el, (e) => e.tag === 'button' && e.props['data-machine-control'] === 'coolant')[0] as El | undefined;
  return { el, sent, toggle };
}

describe('the coolant toggle', () => {
  it('Flood: one toggle "Flood"; on sends M8 (coolantOn flood), off sends M9 (coolantOff)', () => {
    const off = render('flood');
    expect(all(off.el, (e) => e.props['data-machine-control'] === 'coolant')).toHaveLength(1);
    expect(text(off.toggle as El)).toBe('Flood');
    expect(off.toggle?.props['aria-pressed']).toBe('false');
    (off.toggle?.props['onClick'] as () => void)();
    expect(off.sent).toEqual([{ op: 'coolantOn', which: 'flood' }]);
    const on = render('flood', { pressed: true });
    expect(on.toggle?.props['aria-pressed']).toBe('true');
    (on.toggle?.props['onClick'] as () => void)();
    expect(on.sent).toEqual([{ op: 'coolantOff' }]);
  });
  it('Mist and Air switch on with M7 (coolantOn mist)', () => {
    for (const [kind, label] of [['mist', 'Mist'], ['air', 'Air']] as const) {
      const r = render(kind);
      expect(text(r.toggle as El)).toBe(label);
      (r.toggle?.props['onClick'] as () => void)();
      expect(r.sent).toEqual([{ op: 'coolantOn', which: 'mist' }]);
    }
  });
  it('none: no coolant row at all', () => {
    expect(render('none').el.children).toHaveLength(0);
  });
  it('review finding 3: none, but the board reports the output on: a pressed "Coolant" toggle that sends M9 (never gated)', () => {
    const r = render('none', { pressed: true, canOn: false });
    expect(text(r.toggle as El)).toBe('Coolant');
    expect(r.toggle?.props['aria-pressed']).toBe('true');
    (r.toggle?.props['onClick'] as () => void)();
    expect(r.sent).toEqual([{ op: 'coolantOff' }]);
    expect(all(r.el, (e) => e.props['data-action'] === 'coolant-set-wiring')).toHaveLength(0);
  });
  it('no choice yet: "Coolant" with M8, and "Set what is wired" opens Board → the coolant pin', () => {
    const r = render(null);
    expect(text(r.toggle as El)).toBe('Coolant');
    (r.toggle?.props['onClick'] as () => void)();
    expect(r.sent).toEqual([{ op: 'coolantOn', which: 'flood' }]);
    const link = all(r.el, (e) => e.props['data-action'] === 'coolant-set-wiring')[0];
    expect(text(link as El)).toBe('Set what is wired');
    boardTab.value = 'firmware';
    (link?.props['onClick'] as () => void)();
    expect([boardTab.value, pinRequest.value, viewRequest.value]).toEqual(['overview', 'J6.6', 'board']);
    expect(all(render('flood').el, (e) => e.props['data-action'] === 'coolant-set-wiring')).toHaveLength(0);
  });
  it('keeps the gating: on needs `canOn`, off needs `canOff` (stop-class, never gated by motion)', () => {
    expect(render('flood', { canOn: false }).toggle?.props['disabled']).toBe(true);
    expect(render('flood', { pressed: true, canOn: false }).toggle?.props['disabled']).toBeUndefined();
    expect(render('flood', { pressed: true, canOff: false }).toggle?.props['disabled']).toBe(true);
  });
  it('the "?" says what it sends and that Run cannot tell what is wired', () => {
    expect(text(render('mist').el)).toContain('Mist sends M7 to switch the coolant output on and M9 to switch it off.');
  });
});
