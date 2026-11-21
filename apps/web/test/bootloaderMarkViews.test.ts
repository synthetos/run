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

it.each([['the strip', true], ['the setup wizard card', false]] as const)('%s: W28, verbatim, above the Reset instruction, and Cancel', (_where, compact) => {
  const html = strip(flash({ phase: 'waiting', seconds: 20 }), { step: 'opening' }, compact);
  const dialog = html.slice(html.indexOf('data-region="banner-wait"'));
  expect(dialog).toContain('data-safety="W28"');
  expect(dialog).toContain('Keep spindle and VFD mains switched off.');
  expect(dialog.indexOf('data-safety="W28"')).toBeLessThan(dialog.indexOf('Press the Reset button on the board now'));
  expect(dialog).toContain('data-action="banner-cancel"');
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

const page = (f: FlashView): string => renderToString(h(FirmwareTab, { view: { message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash: f, flasher: true } } as unknown as LiveView }));

it.each([
  ['a restored mark (the note carries the advice)', null],
  ['a failed update in this tab (the message carries it)', ADVICE],
] as const)('%s: "press Reset" is said once, and "try the update again" comes after it', (_name, message) => {
  const html = page({ ...flash(null), message });
  expect(html.split('press Reset on the board').length - 1).toBe(1);
  expect(html.indexOf('You can also try the update again')).toBeGreaterThan(html.indexOf('press Reset on the board'));
});

it('a Recovery card where Run wrote nothing says only that', () => {
  const html = page({ ...flash(null), wrote: false });
  expect(html).toContain('Run wrote nothing.');
  expect(html).not.toContain('old firmware is still there');
});

it('after the banner, a version that differs: "Not updated", with what the board reports', () => {
  const html = page({ ...flash(null), phase: 'done', marked: false, recoveryOffered: false, message: null, versionCheck: { expected: 450.06, reported: 449.01, ok: false } });
  expect(html).toContain('data-version-check="differs"');
  expect(html).toContain('Not updated');
  expect(html).toContain('The board reports 449.01 (expected 450.06).');
});

it('a note about another board’s mark replaces Recovery while this board is connected', () => {
  const html = page({ ...flash(null), elsewhere: 'BOARD-A' });
  expect(html).toContain('Board BOARD-A may still be in its bootloader. Connect that board and press Reset.');
  expect(html).not.toContain('data-region="flash-recovery"');
});

it('Board → Firmware says the board is marked and that Connect, then Reset, clears it; no button forgets the mark', () => {
  const html = page({ ...flash(null), message: null });
  expect(html).toContain('data-region="bootloader-mark"');
  expect(html).toContain('To clear the mark: press Connect, then press Reset on the board when Run asks.');
  expect(html).not.toMatch(/Unplug USB and power|power-cycle|forget/i);
  const note = html.slice(html.indexOf('data-region="bootloader-mark"'), html.indexOf('</section>', html.indexOf('data-region="bootloader-mark"')));
  expect(note).not.toContain('<button');
  // The spindle and VFD warning stays on the Recovery card.
  expect(html).toContain('data-safety="W28"');
});

it('the recovery countdown offers Cancel (Run only waits there) and keeps W28; no Try again while it counts', () => {
  const f: FlashView = { ...flash(null), phase: 'recovery', countdown: 31, message: null };
  const html = renderToString(h(FirmwareTab, { view: { message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash: f, flasher: true } } as unknown as LiveView }));
  expect(html).toContain('data-action="flash-cancel"');
  expect(html).toContain('data-safety="W28"');
  expect(html).not.toContain('data-action="flash-recover"');
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
