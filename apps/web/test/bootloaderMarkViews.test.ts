/**
 * What the page shows for a board marked after a failed update (owner report 2026-11-20): while Connect listens for
 * the banner, press Reset now with the worker's countdown; when the wait ran out, Try again (no port choice) in place
 * of the refusal; on Board → Firmware, the mark and how it clears. Nothing says to power-cycle before Connect.
 */
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import type { BannerWaitView } from '../src/machine-worker/bannerWait.ts';
import type { FlashView } from '../src/machine-worker/flashService.ts';
import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { FirmwareTab } from '../src/workspace/views/FirmwareViews.ts';
import { ConnectNotice } from '../src/workspace/views/RunView.ts';
import { snap, view } from './runMotionHarness.ts';

const BOARD = { id: '3Y2462-WWR', hv: 8, fb: 449.01, fv: 0.97 };
const ADVICE = 'The board may still be in its bootloader. Normal commands could damage it. Press Connect, then press Reset on the board when Run asks.';

function flash(bannerWait: BannerWaitView | null): FlashView {
  return { id: 7, phase: 'failed', done: 0, of: 385, note: null, source: 'release', target: { fb: 450.06, label: '450.06', sha256: 'a'.repeat(64) }, boardId: BOARD.id, board: BOARD, countdown: null, wrote: true, message: ADVICE, recoveryOffered: true, versionCheck: null, result: null, marked: true, bannerWait };
}

function strip(f: FlashView, entry: LiveView['entry'], compact = true): string {
  const base = view(snap({ base: 'NOT_CONNECTED', identity: null, classification: null }));
  const m = createWorkspaceModel();
  m.live.value = { ...base, entry, message: { ...base.message, flash: f, flasher: true } } as LiveView;
  m.actions.value = { cancel: () => undefined, firmware: { reconnect: async () => null } } as unknown as LiveActions;
  return renderToString(h(ConnectNotice, { model: m, compact }));
}

it('the setup wizard’s Connect card shows the same guidance and Try again', () => {
  const waiting = strip(flash({ phase: 'waiting', seconds: 12 }), { step: 'opening' }, false);
  expect(waiting).toContain('data-banner-host="card"');
  expect(waiting).toContain('Press the Reset button on the board now');
  expect(waiting).toContain('data-banner-wait-seconds="12"');
  const expired = strip(flash({ phase: 'expired', seconds: 0 }), { step: 'refused', refusal: { kind: 'open-failed', message: ADVICE } }, false);
  expect(expired).toContain('data-banner-host="card"');
  expect(expired).toContain('data-action="banner-retry"');
});

it('while Connect listens: press Reset now (or power off and on with USB connected), with the countdown', () => {
  const html = strip(flash({ phase: 'waiting', seconds: 27 }), { step: 'opening' });
  expect(html).toContain('data-banner-wait="waiting"');
  expect(html).toContain('Press the Reset button on the board now (or switch the board’s power off and on, keeping USB connected).');
  expect(html).toContain('data-banner-wait-seconds="27"');
  expect(html).toContain('27 s.');
  expect(html).not.toContain('data-action="banner-retry"');
});

it('when the wait ran out: Try again replaces the refusal, which carries the same advice', () => {
  const html = strip(flash({ phase: 'expired', seconds: 0 }), { step: 'refused', refusal: { kind: 'open-failed', message: ADVICE } });
  expect(html).toContain('data-banner-wait="expired"');
  expect(html).toContain('data-action="banner-retry"');
  expect(html).toContain('Try again');
  expect(html).not.toContain('id="refused-title"');
});

it('Board → Firmware says the board is marked and that Connect, then Reset, clears it; no button forgets the mark', () => {
  const f = flash(null);
  const html = renderToString(h(FirmwareTab, { view: { message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash: f, flasher: true } } as unknown as LiveView }));
  expect(html).toContain('data-region="bootloader-mark"');
  expect(html).toContain('To clear the mark: press Connect, then press Reset on the board when Run asks.');
  expect(html).not.toMatch(/Unplug USB and power|power-cycle|forget/i);
  const note = html.slice(html.indexOf('data-region="bootloader-mark"'), html.indexOf('</section>', html.indexOf('data-region="bootloader-mark"')));
  expect(note).not.toContain('<button');
  // The spindle and VFD warning stays on the Recovery card.
  expect(html).toContain('data-safety="W28"');
});

it.each([
  ['the Recovery card', true],
  ['the Update stopped card', false],
] as const)('%s says "may still be in its bootloader" once when its message already does', (_name, recoveryOffered) => {
  const f = { ...flash(null), marked: false, wrote: false, recoveryOffered, message: `Cancelled before anything was written. ${ADVICE}` };
  const html = renderToString(h(FirmwareTab, { view: { message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash: f, flasher: true } } as unknown as LiveView }));
  expect(html).toContain(recoveryOffered ? 'data-region="flash-recovery"' : 'data-region="flash-failed"');
  expect(html.split('may still be in its bootloader').length - 1).toBe(1);
});
