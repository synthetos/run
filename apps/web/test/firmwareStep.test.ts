import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import { offerText } from '../src/firmware/updateOffer.ts';
import { firmwareGate, firmwareState, type FirmwareState } from '../src/wizard/firmwareStep.ts';
import { CONNECT_FOR_FIRMWARE, Firmware, FIRMWARE_LEAD, FIRMWARE_TITLE } from '../src/wizard/steps/Firmware.ts';
import { createWorkspaceModel, type LiveView } from '../src/workspace/model.ts';
import { snap, view } from './runMotionHarness.ts';

const rel = (fb: number): FirmwareRelease =>
  ({ hv: 8, fb, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: `tinyg-${fb.toFixed(2)}.hex`, sha256: 'a'.repeat(64), size: 1, date: '2026-11-09', changelog: '', recommended: false, simulatorOnly: false, repo: null, tag: null }) as FirmwareRelease;
const LIST = { env: 'staging', issuedMs: 0, expiresMs: 1, boards: [{ hv: 8, minimumFb: 450.02, releases: [rel(450.02), rel(450.06)] }] } as unknown as FirmwareReleases;

/** A connected board at `fb` with the verified release list and the flasher on. */
function board(fb: number, over: Record<string, unknown> = {}): LiveView {
  const v = view(snap({ identity: { id: 'B-1', hv: 8, fb }, live: { stat: 1, vel: 0, hold: 0, qr: 32 }, job: null, ...over }), false);
  return { ...v, message: { ...v.message, flasher: true }, firmware: { releases: { ok: true, list: LIST } } } as unknown as LiveView;
}

describe('firmwareState follows updateOffer with no second rule', () => {
  it('disconnected, needed, available, current', () => {
    expect(firmwareState(null)).toEqual({ kind: 'disconnected' });
    expect(firmwareState(view(null))).toEqual({ kind: 'disconnected' });
    const needed = firmwareState(board(450.07, { classification: { mode: 'readOnly', dialectId: 'tinyg-en', reason: 'en-not-approved' }, base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'] }));
    expect(needed).toMatchObject({ kind: 'needed', offer: { kind: 'needed', current: 450.07, release: { fb: 450.06 } } });
    const available = firmwareState(board(450.02));
    expect(available).toMatchObject({ kind: 'available', offer: { kind: 'available', release: { fb: 450.06 } } });
    expect(firmwareState(board(450.06))).toEqual({ kind: 'current', fb: 450.06 });
  });
  it('the gate: needed is not skippable and holds Next; everything else is skippable with Next on', () => {
    const offer = (firmwareState(board(450.02)) as Extract<FirmwareState, { kind: 'available' }>).offer;
    expect(firmwareGate({ kind: 'needed', offer: { ...offer, kind: 'needed' } })).toEqual({ skippable: false, nextEnabled: false });
    expect(firmwareGate({ kind: 'updating' })).toEqual({ skippable: false, nextEnabled: false });
    expect(firmwareGate({ kind: 'available', offer })).toEqual({ skippable: true, nextEnabled: true });
    expect(firmwareGate({ kind: 'current', fb: 450.06 })).toEqual({ skippable: true, nextEnabled: true });
    expect(firmwareGate({ kind: 'disconnected' })).toEqual({ skippable: true, nextEnabled: true });
  });
  it('updating: while the flash runs, or while the update was started and the session is closed (the flash closes it)', () => {
    const flashing = board(450.02);
    const withFlash = { ...flashing, message: { ...flashing.message, flash: { phase: 'write', wrote: true } } } as unknown as LiveView;
    expect(firmwareState(withFlash)).toEqual({ kind: 'updating' });
    expect(firmwareState(view(null), true)).toEqual({ kind: 'updating' });
    expect(firmwareState(view(null), false)).toEqual({ kind: 'disconnected' });
    // The flash is over and the board is back: the offer decides again.
    const done = { ...flashing, message: { ...flashing.message, flash: { phase: 'done', wrote: true } } } as unknown as LiveView;
    expect(firmwareState(done, true).kind).toBe('available');
  });
});

describe('step 3 Firmware (render)', () => {
  const model = createWorkspaceModel();
  const base = { updating: false, onUpdate: () => undefined, board: null, mismatch: null };
  const needed = () => firmwareState(board(450.07, { classification: { mode: 'readOnly', dialectId: 'tinyg-en', reason: 'en-not-approved' }, base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'] })) as Extract<FirmwareState, { kind: 'needed' }>;
  it('needed: the board line, the two-row table, the exact offer text and Update firmware', () => {
    expect(FIRMWARE_TITLE).toBe('Firmware');
    expect(FIRMWARE_LEAD).toBe('Run controls the firmware it was tested against.');
    const state = needed();
    const html = renderToString(h(Firmware, { ...base, model, state, board: 'TinyG v8 · firmware 450.07 · B-1' }));
    expect(html).toContain('data-wizard="board">Connected · TinyG v8 · firmware 450.07 · B-1<');
    expect(html).toContain('450.07');
    expect(html).toContain('450.06');
    expect(html).toContain(`data-firmware-step="text">${offerText(state.offer)}<`);
    expect(html).toContain('data-action="wizard-update"');
    expect(html).not.toContain('data-region="firmware-releases"');
  });
  it('another board than the machine’s: the reason as an alert and no Update firmware', () => {
    const html = renderToString(h(Firmware, { ...base, model, state: needed(), board: 'TinyG v8 · B-2', mismatch: 'This is board B-2, not the board.' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('This is board B-2');
    expect(html).not.toContain('data-action="wizard-update"');
  });
  it('updating: the Board tab’s update flow is embedded in the frame, with no connect line even when the session is closed', () => {
    const live = board(450.02);
    model.live.value = live;
    const html = renderToString(h(Firmware, { ...base, model, state: firmwareState(live), updating: true }));
    expect(html).toContain('data-region="firmware-releases"');
    expect(html).toContain('class="wizard-embed"');
    const closed = renderToString(h(Firmware, { ...base, model, state: { kind: 'updating' }, updating: true }));
    expect(closed).toContain('data-region="firmware-releases"');
    expect(closed).not.toContain('data-region="connect"');
    expect(closed).not.toContain('data-action="wizard-update"');
  });
  it('current: one line; disconnected: the connect line and the Connect flow', () => {
    expect(renderToString(h(Firmware, { ...base, model, state: { kind: 'current', fb: 450.06 } }))).toContain('Firmware 450.06 is current.');
    const html = renderToString(h(Firmware, { ...base, model: null, state: { kind: 'disconnected' } }));
    expect(html).toContain(CONNECT_FOR_FIRMWARE);
    expect(html).toContain('data-region="connect"');
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
});
