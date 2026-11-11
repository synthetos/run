import { expect, it } from 'vitest';
import { PHASE_2_RELEASE, withFlasher, withSettingsWrites } from '@synthetos/safety';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { EN_APPROVED } from './jobHarness.ts';

function ready(): Driver {
  const d = new Driver({ release: withFlasher(withSettingsWrites(PHASE_2_RELEASE, 'staging'), 'staging'), manifest: EN_APPROVED });
  d.open(); d.answer(EN_ANSWERS);
  return d;
}
it.each([0, 2])('an early ACK accounts for G4 P%s exactly once, including the zero-duration margin', seconds => {
  const d = ready();
  d.state = { ...d.state, expected: [], queue: [], writing: { seq: 500, token: 'gc', purpose: 'motion', line: `G4 P${seconds}`, intent: 'typedMove' } };
  d.line('{"r":{},"f":[3,0,10]}');
  expect(d.state.dwellWait?.durationMs).toBe(seconds * 1000);
  d.feed({ type: 'lineWritten', epoch: d.state.epoch, seq: 500 });
  expect(d.state.dwellWait?.durationMs).toBe(seconds * 1000);
});
it('a pending dwell prevents an idle-looking settings gate from writing', () => {
  const d = ready();
  d.state = { ...d.state, dwellWait: { durationMs: 2000, until: null } };
  expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 }).allowed).toBe(true);
  d.answer(EN_ANSWERS);
  expect(d.state.settingWrite).toMatchObject({ outcome: 'refused', detail: 'Not written: the dwell has not been confirmed finished.' });
  expect(d.lines().some(l => l.includes('1234'))).toBe(false);
});
it('a pending dwell prevents an idle-looking bootloader gate from entering boot', () => {
  const d = ready();
  d.state = { ...d.state, dwellWait: { durationMs: 2000, until: null } };
  expect(d.intent({ intent: 'flash' }).allowed).toBe(true);
  d.answer(EN_ANSWERS);
  expect(d.state.notices.bootRefused).toContain('dwell');
  expect(d.lines()).not.toContain('{"boot":1}');
});
