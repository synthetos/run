import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { HomeSection, unknownApplies } from '../src/workspace/homing.ts';
import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { homingView } from '../src/workspace/motion.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { UnknownModal } from '../src/workspace/unknownModal.ts';
import { snap, view, type Snapshot } from './runMotionHarness.ts';

const HOMING = { xam: 1, xsn: 0, xsx: 1, xsv: 500, xtn: 0, xtm: 100, xlb: 2, yam: 1, ysn: 1, ysx: 0, ysv: 500, yam2: 0, zam: 1, zsn: 0, zsx: 0, zsv: 0, aam: 0, asn: 0, asx: 0, asv: 0 };

function withSettings(s: Snapshot, settings: Record<string, number>, flag = true): LiveView {
  const v = view(s, flag);
  return { ...v, readout: { dialectId: 'tinyg-en', phase: { kind: 'recorded', hash: 'x' }, settings } } as LiveView;
}

function model(v: LiveView, motion = true) {
  const m = createWorkspaceModel();
  m.live.value = v;
  m.actions.value = { ...({} as LiveActions), ...(motion ? { motion: () => Promise.resolve(null) } : {}) } as LiveActions;
  return m;
}

const machineButtons = (html: string, cls: string): { disabled: boolean; text: string }[] =>
  [...html.matchAll(new RegExp(`<button\\b([^>]*data-machine-control="${cls}"[^>]*)>([^<]*)`, 'g'))].map((m) => ({ disabled: /\sdisabled(=|\s|\/|>|$)/.test(m[1] as string), text: m[2] as string }));
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)', () => {


  it('homingView: configured axes from the settings, why not otherwise, and when Home may be sent', () => {
    const hv = homingView(withSettings(snap(), HOMING), HOMING);
    expect(hv).toMatchObject({ enabled: true, reason: null, configured: ['x', 'y'], read: true, homing: false, searchMm: 102 });
    expect(hv.axes.z.reason).toBe('no switch is set for homing');
    expect(homingView(withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'] }), HOMING), HOMING).enabled).toBe(true);
    const cases: [LiveView | null, string][] = [
      [null, 'Connect a machine'],
      [withSettings(snap(), HOMING, false), 'not enabled in this build'],
      [withSettings(snap({ base: 'HOMING' }), HOMING), 'Homing.'],
      [withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' } }), HOMING), 'Read only: firmware 450.01 is not approved.'],
      [withSettings(snap({ overlays: ['STALE'] }), HOMING), 'No status'],
      [withSettings(snap({ base: 'ALARM' }), HOMING), 'alarm'],
      [withSettings(snap({ motion: { op: 'change', phase: 'drain', hold: false, held: false, stopping: false } }), HOMING), 'A move is running'],
    ];
    for (const [v, text] of cases) expect(homingView(v, HOMING).reason, text).toContain(text);
    expect(homingView(withSettings(snap(), {}), {}).read).toBe(false);
  });
});
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)', () => {


  it('the Home tab: Home per configured axis and Home all; Set machine zero here (G28.3) offered whenever the machine is at rest (OD-13 §4)', () => {
    const live = renderToString(h(HomeSection, { model: model(withSettings(snap(), HOMING)) }));
    const buttons = machineButtons(live, 'home');
    expect(buttons.filter((b) => !b.disabled).map((b) => b.text)).toEqual(['Home', 'Home', 'Home all', 'Set machine zero here…']);
    // The switch column says min, max or none; the reason sits on the cell's title, not in the table (OD-13).
    expect(live).toContain('data-home-config="z" title="no switch is set for homing">none<');
    expect(live).not.toContain('Keep a hand');
    const none = renderToString(h(HomeSection, { model: model(withSettings(snap(), { xam: 1, xsn: 0, xsx: 0, xsv: 0, yam: 1, ysn: 0, ysx: 0, ysv: 0, zam: 1, zsn: 0, zsx: 0, zsv: 0, aam: 0, asn: 0, asx: 0, asv: 0 })) }));
    expect(machineButtons(none, 'home').filter((b) => !b.disabled).map((b) => b.text)).toEqual(['Set machine zero here…']);
    // Prerendered and without the flag: every control disabled.
    for (const html of [renderToString(h(HomeSection, { model: null })), renderToString(h(HomeSection, { model: model(withSettings(snap(), HOMING, false)) }))]) {
      expect(machineButtons(html, 'home').every((b) => b.disabled)).toBe(true);
    }
  });
});
describe('amendment 2026-11-02: homing, offsets and the ways out of UNKNOWN (T-S104–T-S106, control allowlist)', () => {


  it('the UNKNOWN question on connect offers its exits; the strip says Homing and "No reports from the board"', () => {
    const unknown = withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }), HOMING);
    expect(unknownApplies(unknown)).toBe(true);
    const html = renderToString(h(UnknownModal, { model: model(unknown) }));
    expect(html).toContain('data-action="unknown-verify"');
    expect(html).toContain('data-action="unknown-home"');
    // Set machine zero here is offered whenever the machine is at rest, switches or not (OD-13 §4).
    expect(html).toContain('data-action="unknown-position"');
    const noSwitches = withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }), { xam: 1, xsn: 0, xsx: 0, xsv: 0 });
    expect(renderToString(h(UnknownModal, { model: model(noSwitches) }))).toContain('data-action="unknown-position"');
    // Without motion the verify exit is still there: UNKNOWN never traps.
    const p1 = renderToString(h(UnknownModal, { model: model(withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }), HOMING, false)) }));
    expect(p1).toContain('data-action="unknown-verify"');
    expect(p1).not.toContain('data-action="unknown-home"');
    expect(p1).not.toContain('data-action="unknown-position"');
    expect(renderToString(h(UnknownModal, { model: model(withSettings(snap(), HOMING)) }))).toBe('');
    // READ_ONLY denies positionVerify (SAFETY §4.1): no question whose answer the session refuses (owner 164).
    const readOnly = withSettings(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY', 'UNKNOWN'], primaryOverlay: 'UNKNOWN', classification: { dialectId: 'tinyg-en', mode: 'readOnly' } }), HOMING);
    expect(unknownApplies(readOnly)).toBe(false);
    expect(stripStatus(view(snap({ base: 'HOMING' })), null).title).toBe('Homing');
    expect(stripStatus(view(snap({ overlays: ['STALE'] })), null).title).toBe('No reports from the board');
  });
});