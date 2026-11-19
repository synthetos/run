/**
 * The Recovery card says "No firmware running" only when the flash was written to (owner report 2026-11-19:
 * the tag showed after a failure that wrote nothing). When nothing was written it says so plainly.
 */
import { expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { FirmwareTab } from '../src/workspace/views/FirmwareViews.ts';
import type { FlashView } from '../src/machine-worker/flashService.ts';
import type { LiveView } from '../src/workspace/model.ts';

const BOARD = { id: '3Y2462-WWR', hv: 8, fb: 449.01, fv: 0.97 };

function failed(wrote: boolean): LiveView {
  const flash: FlashView = {
    id: 1,
    phase: 'failed',
    done: 0,
    of: 385,
    note: null,
    source: 'release',
    target: { fb: 450.06, label: '450.06', sha256: 'a'.repeat(64) },
    boardId: BOARD.id,
    board: BOARD,
    countdown: null,
    wrote,
    message: null,
    recoveryOffered: true,
    versionCheck: null,
    result: null,
  };
  return { message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash, flasher: true } } as unknown as LiveView;
}

it('after a failure that wrote to the flash: "No firmware running"', () => {
  const html = renderToString(h(FirmwareTab, { view: failed(true) }));
  expect(html).toContain('data-region="flash-recovery"');
  expect(html).toContain('No firmware running');
  expect(html).not.toContain('data-recovery-wrote="false"');
});

it('after a failure that wrote nothing: says nothing was written and the old firmware is still on the board', () => {
  const html = renderToString(h(FirmwareTab, { view: failed(false) }));
  expect(html).toContain('data-region="flash-recovery"');
  expect(html).not.toContain('No firmware running');
  expect(html).toContain('Nothing written');
  expect(html).toContain('Nothing was written to the board. Its old firmware is still there.');
});
