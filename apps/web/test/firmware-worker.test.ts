import { describe, expect, it } from 'vitest';
import { FirmwareWorkerHost } from '../src/machine-worker/firmwareHost.ts';
import { firmwareReleaseFor } from '../src/machine-worker/firmwareRelease.ts';
import { parseRequest } from '../src/machine-worker/rpc.ts';
import { firmwareRole } from '../src/machine-worker/firmwareRole.ts';
import type { FlashService, PostFlashView } from '../src/machine-worker/flashService.ts';
import type { SessionExecutor, SessionSnapshot } from '@synthetos/machine';
const origin = 'https://run.synthetos.com';
function host() { return new FirmwareWorkerHost({ kind: 'none', request: async () => null }, undefined, undefined, null, firmwareReleaseFor(origin)); }
const ask = (h: FirmwareWorkerHost, request: object) => h.handle({ v: 3, ...request });

describe('firmware-only worker boundary', () => {
  it.each([
    ['jog', { kind: 'motion', command: { op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 10 } }],
    ['job', { kind: 'job', command: { op: 'load', name: 'cut', text: 'G1 X1', c22: true } }],
    ['console', { kind: 'motion', command: { op: 'typedMove', line: 'G1 X1', lowZ: null, travel: null } }],
    ['probe', { kind: 'motion', command: { op: 'probeStart', confirm: true } }],
    ['home', { kind: 'motion', command: { op: 'home', axes: ['x'] } }],
    ['spindle', { kind: 'motion', command: { op: 'spindleOn', direction: 'cw', rpm: 5000 } }],
    ['coolant', { kind: 'motion', command: { op: 'coolantOn', which: 'flood' } }],
    ['spindle off', { kind: 'intent', intent: 'spindleOffNow' }],
    ['pause', { kind: 'intent', intent: 'feedhold' }],
    ['stop job', { kind: 'intent', intent: 'stopJob' }],
    ['raw settings', { kind: 'settingWrite', key: 'xvm', value: 100 }],
    ['runtime mode', { kind: 'mode', mode: 'workspace' }],
  ])('refuses %s without writing', async (_name, request) => {
    if (_name !== 'runtime mode') expect(parseRequest({ v: 3, ...request })).not.toBeNull();
    const h = host();
    const answer = await ask(h, request);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.message).toMatch(/firmware|restore/);
    expect(h.session.snapshot.sent).toEqual({ lines: 0, realtime: 0 });
  });
  it('accepts status and subscription without a controller; cannot open a nonexistent port', async () => {
    const h = host();
    expect((await ask(h, { kind: 'status' })).ok).toBe(true);
    expect((await h.handle({ v: 3, kind: 'subscribe' }, { postMessage: () => {} })).ok).toBe(true);
    expect((await ask(h, { kind: 'open', port: { usbVendorId: 1, usbProductId: 2 } })).ok).toBe(false);
  });
  it('rejects backup/custom firmware and allows only a signed release request to reach authorization', () => {
    for (const kind of ['custom', 'backup'] as const) {
      expect(firmwareRole.flashReason({ op: 'begin', source: { kind, name: 'x', confirmed: true, boardId: 'x', fb: 1 }, hex: '', sha256: '', settingsBackup: 'unreadable', baseline: null, recovery: false })).toContain('signed');
    }
    expect(firmwareRole.flashReason({ op: 'cancel' })).toBeNull();
  });
  it('permits writes only during this board’s required restore, never before or after', () => {
    const session = { snapshot: { identity: { id: 'board' } } as SessionSnapshot } as SessionExecutor;
    for (const [phase, boardId, accepted] of [['restoreRequired', 'board', true], ['restoreRequired', 'other', false], ['clear', 'board', false], ['awaitingRead', 'board', false], ['switchCheck', 'board', false]] as const) {
      const flash = { postFlash: { phase, boardId } as PostFlashView } as FlashService;
      expect(firmwareRole.settingReason(flash, session) === null).toBe(accepted);
    }
    expect(firmwareRole.settingReason({ postFlash: null } as FlashService, session)).not.toBeNull();
  });
  it.each(['https://run.synthetos.com', 'https://staging.run.synthetos.com', 'http://localhost:4321'])('has flash and restore, no motion/jobs, at %s', value => {
    expect(firmwareReleaseFor(value)).toMatchObject({ flash: true, settings: true, motion: false, jobs: false });
  });
  it('unknown origins never acquire the firmware capabilities', () => {
    expect(firmwareReleaseFor('https://example.org').flash).not.toBe(true);
  });
});
