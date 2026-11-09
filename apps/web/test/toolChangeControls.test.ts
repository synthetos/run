/**
 * At a manual tool change the page offers only the Z re-zero (H74 as amended 2026-11-08): X, Y and A Set zero, Go to
 * zero, the temporary offsets and the coordinate system are disabled with their reasons. The session refuses them
 * again (packages/machine job-start-modes / tool-change tests).
 */
import { TOOL_CHANGE_JOG_A, TOOL_CHANGE_ZERO } from '@synthetos/machine';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { TC_GO_REASON, TC_JOG_A_REASON, TC_OFFSET_REASON, TC_ZERO_REASON, atToolChange, jogBlocked, zeroBlocked } from '../src/workspace/toolChangeControls.ts';
import { ZeroSection } from '../src/workspace/views/RunView.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

function snap(base: string, phase: string | null): Snapshot {
  return {
    base,
    overlays: [],
    primaryOverlay: null,
    epoch: 1,
    identity: { fb: 450.02, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    live: { machineClass: 'programStop', stat: 3, hold: 0, vel: 0, home: 0, coor: 1, pos: {}, mpo: {} },
    values: { g54: { value: { x: 1, y: 2, z: 3 }, status: 0, at: 1 }, g92: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } },
    notices: { adviseEstop: false },
    motion: null,
    job: phase === null ? null : { phase },
  } as unknown as Snapshot;
}

function model(s: Snapshot) {
  const m = createWorkspaceModel();
  m.live.value = {
    ...INITIAL_LIVE_VIEW,
    message: { v: 3, kind: 'snapshot', snapshot: s, dro: { axes: [], machineSource: { label: 'status report', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: null, offsets: null, total: null }, marker: null }, lag: { amberMs: 1000, redMs: 2000 }, motion: true } as unknown as LiveView['message'],
  };
  m.actions.value = { motion: () => Promise.resolve(null) } as unknown as LiveActions;
  return m;
}

const buttons = (html: string, control: string): { text: string; disabled: boolean; title: string | null }[] =>
  [...html.matchAll(new RegExp(`<button\\b([^>]*data-machine-control="${control}"[^>]*)>([^<]*)`, 'g'))].map((m) => ({
    text: m[2] as string,
    disabled: /\sdisabled(=|\s|\/|>|$)/.test(m[1] as string),
    title: /title="([^"]*)"/.exec(m[1] as string)?.[1]?.replace(/&#39;/g, "'") ?? null,
  }));

describe('the Zero panel at a manual tool change', () => {
  it('only Z can be zeroed; X, Y and Go are disabled with the reasons; offsets and systems stay', () => {
    const html = renderToString(h(ZeroSection, { model: model(snap('PROGRAM_PAUSED', 'toolChange')) }));
    const zero = buttons(html, 'zero');
    expect(zero.filter((b) => b.text === 'Zero').map((b) => b.disabled)).toEqual([true, true, false]); // X, Y, Z
    expect(zero.filter((b) => b.text === 'Zero' && b.disabled).every((b) => b.title === TC_ZERO_REASON)).toBe(true);
    expect(zero.filter((b) => b.text === 'Go').every((b) => b.disabled && b.title === TC_GO_REASON)).toBe(true);
    expect(buttons(html, 'offset').every((b) => b.disabled && b.title === TC_OFFSET_REASON)).toBe(true);
  });

  it('idle: every axis can be zeroed as before', () => {
    const html = renderToString(h(ZeroSection, { model: model(snap('IDLE_UNHOMED', null)) }));
    expect(buttons(html, 'zero').filter((b) => b.text === 'Zero').map((b) => b.disabled)).toEqual([false, false, false]);
  });

  it('the rules and the session share the reason', () => {
    expect(TC_ZERO_REASON).toBe(TOOL_CHANGE_ZERO);
    expect(TC_JOG_A_REASON).toBe(TOOL_CHANGE_JOG_A);
    expect(jogBlocked(snap('PROGRAM_PAUSED', 'toolChange'), { a: 1 })).toBe(TC_JOG_A_REASON);
    expect(jogBlocked(snap('PROGRAM_PAUSED', 'toolChange'), { z: 1 })).toBeNull();
    expect(jogBlocked(snap('IDLE_HOMED', null), { a: 1 })).toBeNull();
    const tc = snap('PROGRAM_PAUSED', 'toolChange');
    expect(atToolChange(tc)).toBe(true);
    expect(atToolChange(snap('PROGRAM_PAUSED', 'breakpoint'))).toBe(false);
    expect(atToolChange(null)).toBe(false);
    expect(zeroBlocked(tc, ['z'])).toBeNull();
    expect(zeroBlocked(tc, ['x', 'y', 'z'])).toBe(TC_ZERO_REASON);
    expect(zeroBlocked(snap('IDLE_HOMED', null), ['x'])).toBeNull();
  });
});
