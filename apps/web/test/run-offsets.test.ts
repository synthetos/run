import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { activeSystem, offsetsView } from '../src/workspace/motion.ts';
import { ZeroSection } from '../src/workspace/views/RunView.ts';
import { snap, view } from './runMotionHarness.ts';

function model(v: LiveView, motion = true) {
  const m = createWorkspaceModel();
  m.live.value = v;
  m.actions.value = { ...({} as LiveActions), ...(motion ? { motion: () => Promise.resolve(null) } : {}) } as LiveActions;
  return m;
}

const machineButtons = (html: string, cls: string): { disabled: boolean; text: string }[] =>
  [...html.matchAll(new RegExp(`<button\\b([^>]*data-machine-control="${cls}"[^>]*)>([^<]*)`, 'g'))].map((m) => ({ disabled: /\sdisabled(=|\s|\/|>|$)/.test(m[1] as string), text: m[2] as string }));
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)', () => {


  it('offsetsView: the active system, its saved offset, the temporary offset and the total, as read', () => {
    const v = view(snap({ live: { coor: 2, pos: {}, mpo: {} }, values: { g55: { value: { x: 10, y: 5, z: -1 }, status: 0, at: 1 }, g92: { value: { x: 0, y: 2, z: 0 }, status: 0, at: 1 }, ofs: { value: { x: 10, y: 7, z: -1 }, status: 0, at: 1 } } }));
    expect(offsetsView(v)).toEqual({ system: 'G55', saved: { x: 10, y: 5, z: -1 }, temporary: { x: 0, y: 2, z: 0 }, temporaryInForce: true, total: { x: 10, y: 7, z: -1 } });
    expect(activeSystem(view(snap({ live: { coor: 0, pos: {}, mpo: {} } })))).toBeNull();
    expect(offsetsView(view(snap({ values: { g92: { value: [1], status: 0, at: 1 } } })))).toMatchObject({ system: null, saved: null, temporary: null, temporaryInForce: false });
  });
});
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)', () => {


  it('the Offsets tab: G54–G59, Set work zero saved in the active system, the temporary offset apart, all disabled without motion', () => {
    const v = view(snap({ live: { coor: 1, pos: {}, mpo: {} }, values: { g54: { value: { x: 1, y: 2, z: 3 }, status: 0, at: 1 }, g92: { value: { x: 0, y: 0, z: 0 }, status: 0, at: 1 } } }));
    const html = renderToString(h(ZeroSection, { model: model(v) }));
    expect(html).toContain('Work zero');
    expect(html).toContain('G10 L20, saved on the controller');
    expect(html).toContain('Temporary offset');
    const offset = machineButtons(html, 'offset');
    expect(offset.map((b) => b.text)).toEqual(['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'X = 0', 'Y = 0', 'Z = 0', 'All = 0', 'Clear']);
    // The active system is selected (not offered again); Clear is offered only while a temporary offset is in force.
    expect(offset.filter((b) => b.disabled).map((b) => b.text)).toEqual(['G54', 'Clear']);
    expect(machineButtons(renderToString(h(ZeroSection, { model: null })), 'offset').every((b) => b.disabled)).toBe(true);
    expect(machineButtons(renderToString(h(ZeroSection, { model: model(v) })), 'zero').length).toBeGreaterThan(0);
  });
});