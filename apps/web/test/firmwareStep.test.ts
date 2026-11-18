import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import { offerText } from '../src/firmware/updateOffer.ts';
import { firmwareGate, firmwareState, HELD_TEXT, type FirmwareState } from '../src/wizard/firmwareStep.ts';
import { CHECKING_TEXT, CONNECT_FOR_FIRMWARE, Firmware, FIRMWARE_LEAD, FIRMWARE_TITLE, LIST_FAILED_TEXT } from '../src/wizard/steps/Firmware.ts';
import { createWorkspaceModel, type LiveView } from '../src/workspace/model.ts';
import { snap, view } from './runMotionHarness.ts';

const rel = (fb: number): FirmwareRelease =>
  ({ hv: 8, fb, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: `tinyg-${fb.toFixed(2)}.hex`, sha256: 'a'.repeat(64), size: 1, date: '2026-11-09', changelog: '', recommended: false, simulatorOnly: false, repo: null, tag: null }) as FirmwareRelease;
const LIST = { env: 'staging', issuedMs: 0, expiresMs: 1, boards: [{ hv: 8, minimumFb: 450.02, releases: [rel(450.02), rel(450.06)] }] } as unknown as FirmwareReleases;
const READ_ONLY_EN = { classification: { mode: 'readOnly', dialectId: 'tinyg-en', reason: 'en-not-approved' }, base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'] };
/** The owner's staging board (146): the stock 449.01 build, read-only. */
const STOCK_449 = { classification: { mode: 'readOnly', dialectId: 'tinyg-449-stock', reason: 'stock-449', detail: '', upgradeOffer: false }, base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'] };

/** A connected board at `fb` with the verified release list and the flasher on. */
function board(fb: number, over: Record<string, unknown> = {}, extra: { readonly flasher?: boolean; readonly releases?: unknown } = {}): LiveView {
  const v = view(snap({ identity: { id: 'B-1', hv: 8, fb }, live: { stat: 1, vel: 0, hold: 0, qr: 32 }, job: null, ...over }), false);
  const releases = 'releases' in extra ? extra.releases : { ok: true, list: LIST };
  return { ...v, message: { ...v.message, flasher: extra.flasher ?? true }, ...(releases === undefined ? {} : { firmware: { releases } }) } as unknown as LiveView;
}

describe('firmwareState: the board against the release list, the offer only for "can it run now"', () => {
  it('disconnected, needed, available, current', () => {
    expect(firmwareState(null)).toEqual({ kind: 'disconnected' });
    expect(firmwareState(view(null))).toEqual({ kind: 'disconnected' });
    expect(firmwareState(board(450.07, READ_ONLY_EN))).toMatchObject({ kind: 'needed', held: null, facts: { current: 450.07, release: { fb: 450.06 } }, offer: { kind: 'needed' } });
    expect(firmwareState(board(450.02))).toMatchObject({ kind: 'available', held: null, facts: { current: 450.02, release: { fb: 450.06 } }, offer: { kind: 'available' } });
    expect(firmwareState(board(450.06))).toEqual({ kind: 'current', fb: 450.06 });
  });
  it('checking while the release list or the identity is not there yet; list-failed when it could not load', () => {
    expect(firmwareState(board(450.02, {}, { releases: undefined }))).toEqual({ kind: 'checking' });
    expect(firmwareState(board(450.02, { identity: { id: 'B-1', hv: 8 } }))).toEqual({ kind: 'checking' });
    expect(firmwareState(board(450.02, {}, { releases: { ok: false, reason: 'it could not be read' } }))).toEqual({ kind: 'list-failed' });
  });
  it('owner 146: 449.01 with a loaded list whose newest is 450.06 is never current', () => {
    const noUpdater = firmwareState(board(449.01, STOCK_449, { flasher: false }));
    expect(noUpdater).toMatchObject({ kind: 'needed', offer: null, held: 'no-updater', facts: { current: 449.01, release: { fb: 450.06 } } });
    const flasher = firmwareState(board(449.01, STOCK_449));
    expect(flasher.kind).toBe('needed');
  });
  it('a newer release the offer withholds right now: held, with why, and never current', () => {
    expect(firmwareState(board(450.02, {}, { flasher: false }))).toMatchObject({ kind: 'available', offer: null, held: 'no-updater' });
    expect(firmwareState(board(450.02, { base: 'JOB_RUNNING', job: { phase: 'running' } }))).toMatchObject({ kind: 'available', offer: null, held: 'busy' });
    expect(firmwareState(board(450.02, { classification: { mode: 'readOnly', dialectId: 'tinyg-en', reason: 'en-approved', detail: '', upgradeOffer: false } }))).toMatchObject({ kind: 'available', offer: null, held: 'read-only' });
  });
  it('hardware the list does not name: unlisted, not current', () => {
    expect(firmwareState(board(450.02, { identity: { id: 'B-1', hv: 7, fb: 450.02 } }))).toEqual({ kind: 'unlisted', hv: 7 });
  });
  it('the gate: needed holds Next and Skip unless this site cannot update; updating holds both; the rest pass', () => {
    const needed = firmwareState(board(450.07, READ_ONLY_EN));
    expect(firmwareGate(needed)).toEqual({ skippable: false, nextEnabled: false });
    expect(firmwareGate(firmwareState(board(449.01, STOCK_449, { flasher: false })))).toEqual({ skippable: true, nextEnabled: false });
    expect(firmwareGate(firmwareState(board(450.07, { ...READ_ONLY_EN, base: 'JOB_RUNNING', job: { phase: 'running' } })))).toEqual({ skippable: false, nextEnabled: false });
    expect(firmwareGate({ kind: 'updating' })).toEqual({ skippable: false, nextEnabled: false });
    for (const s of [firmwareState(board(450.02)), firmwareState(board(450.02, {}, { flasher: false })), { kind: 'current', fb: 450.06 }, { kind: 'disconnected' }, { kind: 'checking' }, { kind: 'list-failed' }, { kind: 'unlisted', hv: 7 }] as FirmwareState[]) {
      expect(firmwareGate(s)).toEqual({ skippable: true, nextEnabled: true });
    }
  });
  it('updating: while the flash runs, or while the update was started and the session is closed (the flash closes it)', () => {
    const flashing = board(450.02);
    const withFlash = { ...flashing, message: { ...flashing.message, flash: { phase: 'write', wrote: true } } } as unknown as LiveView;
    expect(firmwareState(withFlash)).toEqual({ kind: 'updating' });
    expect(firmwareState(view(null), true)).toEqual({ kind: 'updating' });
    expect(firmwareState(view(null), false)).toEqual({ kind: 'disconnected' });
    // The flash is over and the board is back: the list decides again.
    const done = { ...flashing, message: { ...flashing.message, flash: { phase: 'done', wrote: true } } } as unknown as LiveView;
    expect(firmwareState(done, true).kind).toBe('available');
  });
});

describe('step 3 Firmware (render)', () => {
  const model = createWorkspaceModel();
  const base = { updating: false, onUpdate: () => undefined, board: null, mismatch: null };
  const needed = () => firmwareState(board(450.07, READ_ONLY_EN)) as Extract<FirmwareState, { kind: 'needed' }>;
  it('needed: the board line, the two-row table, the exact offer text and Update firmware', () => {
    expect(FIRMWARE_TITLE).toBe('Firmware');
    expect(FIRMWARE_LEAD).toBe('Run controls the firmware it was tested against.');
    const state = needed();
    const html = renderToString(h(Firmware, { ...base, model, state, board: 'TinyG v8 · firmware 450.07 · B-1' }));
    expect(html).toContain('data-wizard="board">Connected · TinyG v8 · firmware 450.07 · B-1<');
    expect(html).toContain('450.07');
    expect(html).toContain('450.06');
    expect(html).toContain(`data-firmware-step="text">${offerText(state.facts)}<`);
    expect(html).toContain('data-action="wizard-update"');
    expect(html).not.toContain('data-region="firmware-releases"');
  });
  it('held: the facts table, the reason line, no Update firmware and never "current"', () => {
    const state = firmwareState(board(449.01, STOCK_449, { flasher: false }));
    const html = renderToString(h(Firmware, { ...base, model, state, board: 'TinyG v8 · firmware 449.01 · 3Y2462-WWR' }));
    expect(html).toContain('On the board');
    expect(html).toContain('TinyG 449.01');
    expect(html).toContain('TinyG 450.06');
    expect(html).toContain(`data-firmware-step="held">${HELD_TEXT['no-updater']}<`);
    expect(html).not.toContain('data-action="wizard-update"');
    expect(html).not.toContain('current');
    const busy = renderToString(h(Firmware, { ...base, model, state: firmwareState(board(450.02, { base: 'JOB_RUNNING', job: { phase: 'running' } })) }));
    expect(busy).toContain(HELD_TEXT.busy);
    expect(HELD_TEXT.busy).toBe('The machine is not idle. Update from Board → Firmware once it is.');
    expect(HELD_TEXT['read-only']).toBe('This connection is read-only. Update from Board → Firmware once the machine is idle.');
    expect(HELD_TEXT['no-updater']).toBe('Firmware updates are not available on this site.');
  });
  it('checking and list-failed: one line each, never "current"', () => {
    const checking = renderToString(h(Firmware, { ...base, model, state: { kind: 'checking' } }));
    expect(checking).toContain(CHECKING_TEXT);
    expect(CHECKING_TEXT).toBe('Checking the firmware against the release list.');
    const failed = renderToString(h(Firmware, { ...base, model, state: { kind: 'list-failed' } }));
    expect(failed).toContain(LIST_FAILED_TEXT);
    expect(LIST_FAILED_TEXT).toBe('The release list could not load, so the firmware was not checked.');
    expect(checking + failed).not.toContain('current');
    expect(renderToString(h(Firmware, { ...base, model, state: { kind: 'unlisted', hv: 7 } }))).toContain('No firmware is listed for this hardware (v7).');
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
