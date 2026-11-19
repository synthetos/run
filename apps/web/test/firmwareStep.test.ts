import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import { offerText } from '../src/firmware/updateOffer.ts';
import { firmwareGate, firmwareState, HELD_TEXT, type FirmwareState } from '../src/wizard/firmwareStep.ts';
import { CHECKING_TEXT, CONNECT_FOR_FIRMWARE, Firmware, FIRMWARE_LEAD, FIRMWARE_TITLE, firmwareUpdating, LIST_FAILED_TEXT, startUpdate, UPDATING_TEXT } from '../src/wizard/steps/Firmware.ts';
import { setupAway } from '../src/wizard/setupActions.ts';
import { releaseRequest } from '../src/workspace/boardNavigation.ts';
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
  it('review finding 1: an idle needed board whose offer is withheld keeps Skip and gets a line true for the reason', () => {
    const idle = { base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'] };
    const flow = firmwareState(board(449.01, { ...idle, classification: { mode: 'readOnly', dialectId: 'tinyg-449-stock', reason: 'flowControl', detail: '', upgradeOffer: false } }));
    expect(flow).toMatchObject({ kind: 'needed', offer: null, held: 'flow-control' });
    const unidentified = firmwareState(board(440.2, { ...idle, classification: { mode: 'readOnly', dialectId: null, reason: 'conflict', detail: '', upgradeOffer: false } }));
    expect(unidentified).toMatchObject({ kind: 'needed', offer: null, held: 'unidentified' });
    const noQr = firmwareState(board(449.01, { ...STOCK_449, live: { stat: 1, vel: 0, hold: 0 } }));
    expect(noQr).toMatchObject({ kind: 'needed', offer: null, held: 'other' });
    for (const s of [flow, unidentified, noQr]) expect(firmwareGate(s)).toEqual({ skippable: true, nextEnabled: false });
    expect(HELD_TEXT['flow-control']).toBe('Set ex to 1 (XON/XOFF) with another program, then connect again.');
    expect(HELD_TEXT.unidentified).toBe('Run could not identify this firmware. Update from Board → Firmware.');
    expect(HELD_TEXT.other).toBe('Update from Board → Firmware.');
    // "Not idle" only when the board really is not at rest.
    expect(firmwareState(board(450.07, { ...READ_ONLY_EN, base: 'JOB_RUNNING', job: { phase: 'running' } }))).toMatchObject({ held: 'busy' });
    for (const s of [flow, unidentified, noQr]) expect(HELD_TEXT[(s as { held: keyof typeof HELD_TEXT }).held]).not.toMatch(/idle/);
  });
  it('review minor 6: a hardware version reported as text is read as a number, never "checking" forever', () => {
    expect(firmwareState(board(450.02, { identity: { id: 'B-1', hv: '8', fb: '450.02' } })).kind).toBe('available');
    // Text that is not a number (the session's Identity allows hv as text): unlisted, said once, not "checking".
    expect(firmwareState(board(450.02, { identity: { id: 'B-1', hv: 'v8', fb: 450.02 } }))).toEqual({ kind: 'unlisted', hv: 'v8' });
  });
  it('review minor 6: an available release on a flow-control board says the ex fix, not "once the machine is idle"', () => {
    const s = firmwareState(board(450.02, { classification: { mode: 'readOnly', dialectId: 'tinyg-en', reason: 'flowControl', detail: '', upgradeOffer: false } }));
    expect(s).toMatchObject({ kind: 'available', offer: null, held: 'flow-control' });
  });
  it('hardware the list does not name: unlisted, not current', () => {
    expect(firmwareState(board(450.02, { identity: { id: 'B-1', hv: 7, fb: 450.02 } }))).toEqual({ kind: 'unlisted', hv: 7 });
  });
  it('the gate: needed holds Next and Skip unless this site cannot update; updating holds both; the rest pass', () => {
    const needed = firmwareState(board(450.07, READ_ONLY_EN));
    expect(firmwareGate(needed)).toEqual({ skippable: false, nextEnabled: false });
    expect(firmwareGate(firmwareState(board(449.01, STOCK_449, { flasher: false })))).toEqual({ skippable: true, nextEnabled: false });
    // Review finding 1: a withheld offer never traps the person; Skip stays, Next stays held for `needed`.
    expect(firmwareGate(firmwareState(board(450.07, { ...READ_ONLY_EN, base: 'JOB_RUNNING', job: { phase: 'running' } })))).toEqual({ skippable: true, nextEnabled: false });
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

describe('step 3 Update firmware (owner 167)', () => {
  it('marks the release Run expects on the Firmware page, offer up or held, and steps the wizard aside', () => {
    try {
      startUpdate(firmwareState(board(450.02, { base: 'JOB_RUNNING', job: { phase: 'running' } })));
      expect(releaseRequest.value).toBe('tinyg-450.06.hex');
      expect(setupAway.value).toBe(true);
      releaseRequest.value = null;
      startUpdate(firmwareState(board(450.02)));
      expect(releaseRequest.value).toBe('tinyg-450.06.hex');
    } finally {
      setupAway.value = false;
      releaseRequest.value = null;
      firmwareUpdating.value = false;
    }
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
    expect(html).toMatch(/data-action="wizard-update"[^>]*>Update firmware</);
    // Owner 167: no release list or updater inside the frame; the button opens Board → Firmware.
    expect(html).not.toContain('data-region="firmware-releases"');
    expect(html).not.toContain('wizard-embed');
    expect(html).not.toContain('update-release');
  });
  it('held where Board → Firmware can help (busy, read-only, unidentified): the reason and Update firmware to open it', () => {
    const busy = renderToString(h(Firmware, { ...base, model, state: firmwareState(board(450.02, { base: 'JOB_RUNNING', job: { phase: 'running' } })) }));
    expect(busy).toContain(HELD_TEXT.busy);
    expect(busy).toContain('data-action="wizard-update"');
    expect(busy).not.toContain('data-region="firmware-releases"');
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
  it('updating: one line and a way to the running update on Board → Firmware; no flow in the frame and no connect line', () => {
    const live = board(450.02);
    model.live.value = live;
    const html = renderToString(h(Firmware, { ...base, model, state: firmwareState(live), updating: true }));
    expect(html).not.toContain('data-region="firmware-releases"');
    expect(html).toContain('data-action="wizard-update"');
    const closed = renderToString(h(Firmware, { ...base, model, state: { kind: 'updating' }, updating: true }));
    expect(closed).toContain(`data-firmware-step="updating">${UPDATING_TEXT}<`);
    expect(UPDATING_TEXT).toBe('The update runs on Board → Firmware.');
    expect(closed).toMatch(/data-action="wizard-update"[^>]*>Show the update</);
    expect(closed).not.toContain('data-region="firmware-releases"');
    expect(closed).not.toContain('data-region="connect"');
  });
  it('current: one line; disconnected: the connect line and the Connect flow', () => {
    expect(renderToString(h(Firmware, { ...base, model, state: { kind: 'current', fb: 450.06 } }))).toContain('Firmware 450.06 is current.');
    const html = renderToString(h(Firmware, { ...base, model: null, state: { kind: 'disconnected' } }));
    expect(html).toContain(CONNECT_FOR_FIRMWARE);
    expect(html).toContain('data-region="connect"');
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
});
