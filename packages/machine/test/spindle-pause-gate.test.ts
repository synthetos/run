import { describe, expect, it } from 'vitest';
import { PHASE_1_SETTINGS_RELEASE } from '@synthetos/safety';
import { motionOnlyPauseWrite } from '../src/session/settingWrite.ts';
import { checkWrite, settingRefusal } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const answer = (key: string, value: number, status = 0) => JSON.stringify({ r: { [key]: value }, f: [3, status, 10] });
function ready(spph = 1, status = 0, fb = 450.04, approved = true, coph = 0, cophStatus = 0) {
  const d = new Driver({ release: PHASE_1_SETTINGS_RELEASE, manifest: { environment: 'staging', builds: approved ? [{ channel: 'bench', dialect: 'tinyg-en', fb, fbs: null, commit: 'e'.repeat(40), note: 'test' }] : [] } });
  const answers = { ...EN_ANSWERS, fb: answer('fb', fb), spph: answer('spph', spph, status), coph: answer('coph', coph, cophStatus) };
  d.open(); d.answer(answers);
  return { d, answers };
}
function gate(d: Driver, answers: Record<string, string>) {
  expect(d.intent({ intent: 'settingsWrite', key: 'spph', value: 0 }).allowed).toBe(true);
  d.answer(answers, () => d.state.writing?.purpose === 'setting');
}
describe('motion-only pause requirement', () => {
  it.each([[1, 0], [0, 100], [2, 0]])('blocks spph %s with status %s and permits only the corrective setting', (value, status) => {
    const { d } = ready(value, status);
    expect(d.state.classification).toMatchObject({ mode: 'readOnly', reason: 'spindlePause' });
    expect(d.state.overlays).toContain('READ_ONLY');
    for (const [key, value] of [['spph', 1], ['coph', 1], ['spde', 0], ['xvm', 123]] as const) {
      expect(d.intent({ intent: 'settingsWrite', key, value }).allowed).toBe(false);
    }
    expect(d.intent({ intent: 'resume' }).allowed).toBe(false);
  });
  it('writes only after the idle gate and restores control only after a matching readback', () => {
    const { d, answers } = ready();
    gate(d, answers);
    expect(d.state.writing).toMatchObject({ purpose: 'setting', token: 'spph', value: 0 });
    const bytes = new TextEncoder().encode('{"spph":0}\n');
    expect(checkWrite(d.state, d.state, PHASE_1_SETTINGS_RELEASE, bytes, 'settingsWrite')).toBeUndefined();
    expect(checkWrite(d.state, d.state, PHASE_1_SETTINGS_RELEASE, new TextEncoder().encode('{"xvm":123}\n'), 'settingsWrite')?.kind).toBe('refused');
    d.written(); d.line(answer('spph', 0));
    expect(d.state.classification?.mode).toBe('readOnly');
    d.written(); d.line(answer('spph', 0));
    expect(d.state.classification?.mode).toBe('readOnly');
    d.answer({ ...answers, spph: answer('spph', 0) });
    expect(d.state.classification).toMatchObject({ mode: 'full', reason: 'en-approved' });
    expect(d.state.overlays).not.toContain('READ_ONLY');
    expect(d.state.settingWrite).toMatchObject({ outcome: 'verified' });
  });
  it.each([[1, 0], [0, 100]])('failed readback (%s, status %s) stays blocked', (value, status) => {
    const { d, answers } = ready(); gate(d, answers);
    d.written(); d.line(answer('spph', 0)); d.written(); d.line(answer('spph', value, status));
    expect(d.state.classification?.reason).toBe('spindlePause');
    expect(d.state.settingWrite?.outcome).toBe('mismatch');
  });
  it.each([['stat', 5], ['hold', 6], ['qr', 31], ['vel', 1], ['unit', 0]] as const)('refuses the corrective write when %s is %s', (key, value) => {
    const { d, answers } = ready(); gate(d, { ...answers, [key]: answer(key, value) });
    expect(d.state.settingWrite?.outcome).toBe('refused');
    expect(d.lines()).not.toContain('{"spph":0}');
  });
  it('does not grant the exception to unapproved builds or other overlays', () => {
    const { d } = ready(1, 0, 450.04, false);
    expect(d.state.classification?.reason).toBe('en-not-approved');
    expect(d.intent({ intent: 'settingsWrite', key: 'spph', value: 0 }).allowed).toBe(false);
    const { d: blocked, answers } = ready(); gate(blocked, answers);
    const state = { ...blocked.state, overlays: [...blocked.state.overlays, 'STALE' as const] };
    expect(checkWrite(state, blocked.state, PHASE_1_SETTINGS_RELEASE, new TextEncoder().encode('{"spph":0}\n'), 'settingsWrite')?.kind).toBe('denied');
  });
  it('accepts spph=0 and leaves old stubbed and newer absent tokens unaffected', () => {
    for (const [fb, status] of [[450.04, 0], [450.02, 17], [450.05, 100]]) {
      const { d } = ready(0, status, fb);
      expect(d.state.classification?.mode).toBe('full');
      if (fb !== 450.04) expect(d.intent({ intent: 'settingsWrite', key: 'spph', value: 0 }).allowed).toBe(false);
    }
  });
});

it('a missing connect-time read cannot reuse an older spph=0 value', () => {
  const d = new Driver({ release: PHASE_1_SETTINGS_RELEASE, manifest: { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.04, fbs: null, commit: 'e'.repeat(40), note: 'test' }] } });
  d.open();
  d.state = { ...d.state, values: { spph: { value: 0, status: 0, at: 0 } } };
  d.answer({ ...EN_ANSWERS, fb: answer('fb', 450.04), spph: answer('spph', 1) }, token => token === 'spph' && d.state.writing?.purpose === 'reading');
  expect(d.state.values['spph']).toBeUndefined();
  d.written(); d.fire('answer');
  expect(d.state.classification?.reason).toBe('spindlePause');
  expect(d.state.overlays).toContain('READ_ONLY');
});

it('the corrective capability requires its exact dialect, build, key and value', () => {
  const { d } = ready();
  expect(motionOnlyPauseWrite(d.state, 'spph', 0)).toBe(true);
  for (const state of [
    { ...d.state, classification: null },
    { ...d.state, dialect: null },
    { ...d.state, identity: null },
    { ...d.state, identity: { ...d.state.identity, fb: 450.05 } },
  ]) expect(motionOnlyPauseWrite(state, 'spph', 0)).toBe(false);
  expect(motionOnlyPauseWrite(d.state, 'spde', 0)).toBe(false);
  expect(motionOnlyPauseWrite(d.state, 'spph', 1)).toBe(false);
  expect(settingRefusal('tinyg-440', 'spph', 0, {}, 450.04)).not.toBeNull();
  expect(settingRefusal('tinyg-en', 'spph', 0, {})).not.toBeNull();
  expect(settingRefusal('tinyg-en', 'spph', 1, {}, 450.04)).not.toBeNull();
});

it('keeps control blocked between two ordinary writes and rereads both after each', () => {
  const { d, answers } = ready(1, 0, 450.04, true, 1);
  gate(d, answers);
  d.written(); d.line(answer('spph', 0)); d.written(); d.line(answer('spph', 0));
  expect(d.state.classification?.mode).toBe('readOnly');
  d.answer({ ...answers, spph: answer('spph', 0) });
  expect(d.state.classification?.mode).toBe('readOnly');
  expect(d.intent({ intent: 'settingsWrite', key: 'coph', value: 0 }).allowed).toBe(true);
  expect(d.state.settingWrite).toMatchObject({ key: 'coph', phase: 'gate' });
  d.answer(answers, () => d.state.writing?.purpose === 'setting');
  expect(d.state.writing).toMatchObject({ token: 'coph', value: 0 });
  d.written(); d.line(answer('coph', 0)); d.written(); d.line(answer('coph', 0));
  expect(d.state.classification?.mode).toBe('readOnly');
  expect(d.state.values['spph']).toBeUndefined();
  expect(d.state.values['coph']).toBeUndefined();
  d.answer({ ...answers, spph: answer('spph', 0), coph: answer('coph', 0) });
  expect(d.state.classification?.mode).toBe('full');
});
it.each([[0, 100], [2, 0]])('an unreadable coolant setting (%s, status %s) stays blocked, with no guessed write', (coph, status) => {
  const { d, answers } = ready(0, 0, 450.04, true, coph, status);
  expect(d.state.classification?.reason).toBe('spindlePause');
  expect(d.intent({ intent: 'settingsWrite', key: 'coph', value: 0 }).allowed).toBe(true);
  d.answer(answers);
  expect(d.state.classification?.mode).toBe('readOnly');
  expect(d.lines().filter(l => /"(?:spph|coph)":0/.test(l))).toEqual([]);
});
it('neither pause token present is unaffected, including a board with the same build number', () => {
  const { d } = ready(0, 100, 450.04, true, 0, 100);
  expect(d.state.classification?.mode).toBe('full');
});
it('a changed or unreadable final reread does not lift the block', () => {
  const { d, answers } = ready(); gate(d, answers);
  d.written(); d.line(answer('spph', 0)); d.written(); d.line(answer('spph', 0));
  d.answer({ ...answers, spph: answer('spph', 0), coph: answer('coph', 1) });
  expect(d.state.classification?.reason).toBe('spindlePause');
});
it('the second setting must pass its own idle gate', () => {
  const { d, answers } = ready(1, 0, 450.04, true, 1); gate(d, answers);
  d.written(); d.line(answer('spph', 0)); d.written(); d.line(answer('spph', 0));
  d.answer({ ...answers, spph: answer('spph', 0) });
  expect(d.intent({ intent: 'settingsWrite', key: 'coph', value: 0 }).allowed).toBe(true);
  d.answer({ ...answers, qr: answer('qr', 31) });
  expect(d.state.classification?.mode).toBe('readOnly');
  expect(d.state.settingWrite).toMatchObject({ key: 'coph', outcome: 'refused' });
  expect(d.lines()).not.toContain('{"coph":0}');
});
