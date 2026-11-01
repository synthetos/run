/**
 * The allow-matrix (ROADMAP P0-10): T-S3 (every cell classified, Start only
 * from ARMED, feedhold everywhere connected), T-S62 (stop-class always
 * allowed with the port open; Home denied under FAULT, STALE and
 * ORPHANED_MOTION), T-S58 (sign-out, account switch, armed-file delete and
 * profile switch denied in every LIVE state), and the Phase 0 release gate.
 *
 * Generated over every base state × overlay set × intent, both with this
 * release and with every release gate open, so a later release cannot
 * loosen a state-level rule unnoticed.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BASE_STATES,
  CURRENT_RELEASE,
  INTENTS,
  OVERLAYS,
  PORT_OPEN_STATES,
  STOP_CLASS,
  allowed,
  intentKind,
  isLive,
  type BaseState,
  type Intent,
  type MatrixSnapshot,
  type Overlay,
  type Release,
} from '../src/index.ts';
import { runs } from './sanitizeHelpers.ts';

const OPEN: Release = { name: 'all gates open', motion: true, write: true, port: true };

/** Every subset of the overlays (2^7 = 128). */
const OVERLAY_SETS: readonly (readonly Overlay[])[] = Array.from({ length: 1 << OVERLAYS.length }, (_, mask) =>
  OVERLAYS.filter((_o, i) => (mask & (1 << i)) !== 0),
);

function* cells(): Generator<{ s: MatrixSnapshot; intent: Intent }> {
  for (const base of BASE_STATES) {
    for (const overlays of OVERLAY_SETS) {
      for (const classified of [false, true]) {
        for (const enqCapable of [false, true]) {
          for (const intent of INTENTS) yield { s: { base, overlays, classified, enqCapable }, intent };
        }
      }
    }
  }
}

const snap = (base: BaseState, overlays: readonly Overlay[] = [], classified = true, enqCapable = true): MatrixSnapshot => ({
  base,
  overlays,
  classified,
  enqCapable,
});

const portOpen = (s: MatrixSnapshot): boolean => PORT_OPEN_STATES.has(s.base) && !s.overlays.includes('LOST');

describe('T-S3: the generated matrix', () => {
  it('classifies every cell: allowed, or denied with a reason, a remedy and a citation', () => {
    // About a million cells: collect the unclassified ones and assert once. Three expect() calls
    // per cell made this test take 4-5 s and time out under a loaded `pnpm check`.
    let count = 0;
    const unclassified: string[] = [];
    for (const release of [CURRENT_RELEASE, OPEN]) {
      for (const { s, intent } of cells()) {
        const d = allowed(s, intent, release);
        if (!d.allowed && !(d.reason.length > 5 && d.remedy.length > 5 && d.citation.length > 5)) {
          unclassified.push(`${release.name}: ${s.base} [${s.overlays.join('+')}] ${intent}`);
        }
        count++;
      }
    }
    expect(unclassified.slice(0, 20)).toEqual([]);
    expect(count).toBe(2 * BASE_STATES.length * OVERLAY_SETS.length * 4 * INTENTS.length);
  });

  it('Start is allowed only from ARMED, with no overlay, and never in this release', () => {
    for (const { s, intent } of cells()) {
      if (intent !== 'start') continue;
      expect(allowed(s, 'start', OPEN).allowed).toBe(s.base === 'ARMED' && s.overlays.length === 0);
      expect(allowed(s, 'start').allowed).toBe(false);
    }
  });

  it('fails closed on an intent or state it does not know', () => {
    expect(allowed(snap('IDLE_HOMED'), 'teleport' as Intent, OPEN)).toMatchObject({ allowed: false, reason: 'Unknown request.' });
    expect(allowed(snap('FLYING' as BaseState), 'read', OPEN).allowed).toBe(false);
  });

  it('adding an overlay never allows more (fast-check)', () => {
    const state = fc.constantFrom(...BASE_STATES);
    const overlays = fc.subarray([...OVERLAYS]);
    const extra = fc.constantFrom(...OVERLAYS);
    const intent = fc.constantFrom(...INTENTS);
    fc.assert(
      fc.property(state, overlays, extra, intent, fc.boolean(), fc.boolean(), (base, o, x, i, classified, enqCapable) => {
        // acknowledgeLost and ackFault exist because of their overlay; every other intent may only lose permission.
        fc.pre(!(i === 'acknowledgeLost' && x === 'LOST') && !(i === 'ackFault' && x === 'FAULT') && !(i === 'keepBoardSettings' && x === 'NEEDS_REVIEW'));
        const before = allowed({ base, overlays: o, classified, enqCapable }, i, OPEN).allowed;
        const after = allowed({ base, overlays: [...o, x], classified, enqCapable }, i, OPEN).allowed;
        if (after) expect(before).toBe(true);
      }),
      { numRuns: runs(3000) },
    );
  });
});

describe('T-S62 and the normative rule (SAFETY §4.1)', () => {
  it('Feedhold, Stop job and Spindle off are allowed in every cell with the port open, in every release', () => {
    for (const release of [CURRENT_RELEASE, OPEN]) {
      for (const { s, intent } of cells()) {
        if (!STOP_CLASS.includes(intent)) continue;
        expect(allowed(s, intent, release).allowed, `${s.base} ${s.overlays.join('+')} ${intent}`).toBe(portOpen(s));
      }
    }
  });

  it('the stop-class intents ignore the fields that gate everything else (classification, ENQ)', () => {
    for (const intent of STOP_CLASS) {
      expect(allowed(snap('RUNNING', ['ORPHANED_MOTION', 'READ_ONLY', 'STALE', 'FAULT'], false, false), intent).allowed).toBe(true);
      expect(allowed(snap('BOOTLOADER_MODE'), intent).allowed).toBe(true);
    }
  });

  it('with no port, the stop-class denial says to use the E-stop', () => {
    for (const s of [snap('NOT_CONNECTED'), snap('OPENING'), snap('RUNNING', ['LOST'])]) {
      const d = allowed(s, 'stopJob');
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.remedy).toBe('Use your E-stop.');
    }
  });

  it('Home is denied under FAULT, STALE and ORPHANED_MOTION, even with every gate open', () => {
    for (const { s, intent } of cells()) {
      if (intent !== 'home') continue;
      if (s.overlays.some((o) => o === 'FAULT' || o === 'STALE' || o === 'ORPHANED_MOTION')) {
        expect(allowed(s, 'home', OPEN).allowed, `${s.base} ${s.overlays.join('+')}`).toBe(false);
      }
    }
    expect(allowed(snap('IDLE_UNHOMED'), 'home', OPEN).allowed).toBe(true);
    expect(allowed(snap('CONNECTED_UNKNOWN', ['UNKNOWN']), 'home', OPEN).allowed).toBe(true);
  });

  it('under FAULT, ORPHANED_MOTION, LOST and UNKNOWN only reads, stops, recovery and (UNKNOWN only) home and position-verify', () => {
    const allowedUnder = (o: Overlay): Set<Intent> => {
      const out = new Set<Intent>();
      for (const base of BASE_STATES) for (const i of INTENTS) if (allowed(snap(base, [o]), i, OPEN).allowed) out.add(i);
      return out;
    };
    expect([...allowedUnder('FAULT')].sort()).toEqual(['ackFault', 'cloudSync', 'disconnect', 'enq', 'feedhold', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    expect([...allowedUnder('ORPHANED_MOTION')].sort()).toEqual(['cloudSync', 'enq', 'feedhold', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    expect([...allowedUnder('LOST')].sort()).toEqual(['acknowledgeLost', 'cloudSync']);
    expect([...allowedUnder('UNKNOWN')].sort()).toEqual([
      'cloudSync',
      'disconnect',
      'enq',
      'feedhold',
      'home',
      'positionVerify',
      'read',
      'resetController',
      'spindleOffNow',
      'stopJob',
    ]);
    expect([...allowedUnder('STALE')].sort()).toEqual(['cloudSync', 'disconnect', 'enq', 'feedhold', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    expect([...allowedUnder('READ_ONLY')].sort()).toEqual(['cloudSync', 'disconnect', 'enq', 'feedhold', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    expect([...allowedUnder('NEEDS_REVIEW')].sort()).toEqual([
      'applyProfile',
      'cloudSync',
      'disconnect',
      'enq',
      'feedhold',
      'keepBoardSettings',
      'read',
      'resetController',
      'settingsWrite',
      'spindleOffNow',
      'stopJob',
    ]);
  });

  it('ORPHANED_MOTION on an unclassified board allows only the stop class and Reset controller (T-S86)', () => {
    const s = snap('IDENTIFYING', ['ORPHANED_MOTION'], false, false);
    const ok = INTENTS.filter((i) => allowed(s, i, OPEN).allowed && intentKind(i) !== 'cloud');
    expect(ok.sort()).toEqual(['feedhold', 'resetController', 'spindleOffNow', 'stopJob']);
  });

  it('ENQ only to a classified board whose dialect answers it (T-S24b)', () => {
    expect(allowed(snap('IDLE_HOMED', [], true, true), 'enq').allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED', [], true, false), 'enq').allowed).toBe(false);
    expect(allowed(snap('IDLE_HOMED', [], false, true), 'enq').allowed).toBe(false);
    expect(allowed(snap('BOOTLOADER_MODE', [], true, true), 'enq').allowed).toBe(false);
  });

  it('reads and Reset controller are never sent to the bootloader', () => {
    expect(allowed(snap('BOOTLOADER_MODE'), 'read').allowed).toBe(false);
    expect(allowed(snap('BOOTLOADER_MODE'), 'resetController', OPEN).allowed).toBe(false);
    expect(allowed(snap('IDLE_HOMED'), 'read').allowed).toBe(true);
  });
});

describe('T-S58: account intents are denied in every LIVE state', () => {
  it('sign-out, account switch, armed-file delete and profile switch, generated over the matrix', () => {
    for (const release of [CURRENT_RELEASE, OPEN]) {
      for (const { s, intent } of cells()) {
        if (!['signOut', 'switchAccount', 'deleteArmedFile', 'changeProfile', 'forgetMachine'].includes(intent)) continue;
        expect(allowed(s, intent, release).allowed, `${s.base} ${s.overlays.join('+')} ${intent}`).toBe(!isLive(s) && s.overlays.length === 0);
      }
    }
  });

  it('LIVE is any state but NOT_CONNECTED, and an unacknowledged LOST', () => {
    expect(isLive({ base: 'NOT_CONNECTED', overlays: [] })).toBe(false);
    expect(isLive({ base: 'NOT_CONNECTED', overlays: ['LOST'] })).toBe(true);
    expect(isLive({ base: 'PORT_REQUEST', overlays: [] })).toBe(true);
    expect(allowed(snap('NOT_CONNECTED', [], false, false), 'signOut').allowed).toBe(true);
  });
});

describe('Phase 0 release gate', () => {
  it('denies every motion, write and connect intent with "Not available in this release."', () => {
    const wrong: string[] = [];
    let gated = 0;
    for (const { s, intent } of cells()) {
      const kind = intentKind(intent);
      if (kind !== 'motion' && kind !== 'write' && kind !== 'port') continue;
      gated++;
      const d = allowed(s, intent);
      if (d.allowed || d.reason !== 'Not available in this release.' || !d.citation.includes('Phase 0')) {
        wrong.push(`${s.base} [${s.overlays.join('+')}] ${intent}`);
      }
    }
    expect(gated).toBeGreaterThan(0);
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(CURRENT_RELEASE).toEqual({ name: 'Phase 0', motion: false, write: false, port: false });
  });

  it('every motion and write intent is classified as such', () => {
    const kinds = Object.fromEntries(INTENTS.map((i) => [i, intentKind(i)]));
    for (const i of ['jog', 'home', 'start', 'resume', 'arm', 'consoleLine', 'spindleOn']) expect(kinds[i], i).toBe('motion');
    for (const i of ['settingsWrite', 'applyProfile', 'setWorkZero', 'optionalStop', 'flash', 'resetController']) expect(kinds[i], i).toBe('write');
    expect(kinds['connect']).toBe('port');
    for (const i of STOP_CLASS) expect(kinds[i]).toBe('stop');
  });

  it('offline intents still work in Phase 0: loading a job, sign-out and sync while not connected', () => {
    const offline = snap('NOT_CONNECTED', [], false, false);
    for (const i of ['loadJob', 'loadLibraryJob', 'signOut', 'switchAccount', 'changeProfile', 'deleteArmedFile', 'forgetMachine', 'cloudSync'] as const) {
      expect(allowed(offline, i).allowed, i).toBe(true);
    }
    expect(allowed(offline, 'connect').allowed).toBe(false);
  });
});

describe('rows', () => {
  it('job loading is refused while a job is active; sync pauses while it runs', () => {
    for (const base of ['RUNNING', 'HELD', 'PROGRAM_PAUSED', 'STOPPING_JOB'] as const) {
      expect(allowed(snap(base), 'loadJob').allowed, base).toBe(false);
      expect(allowed(snap(base), 'loadLibraryJob').allowed, base).toBe(false);
    }
    for (const base of ['RUNNING', 'HELD', 'BARRIER_DRAINING', 'STOPPING_JOB'] as const) expect(allowed(snap(base), 'cloudSync').allowed, base).toBe(false);
    expect(allowed(snap('PROGRAM_PAUSED'), 'cloudSync').allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED'), 'loadJob').allowed).toBe(true);
  });

  it('Arm only from PREFLIGHT_OK; Resume only from HELD or PROGRAM_PAUSED; Flash from idle or shutdown', () => {
    for (const base of BASE_STATES) {
      expect(allowed(snap(base), 'arm', OPEN).allowed, base).toBe(base === 'PREFLIGHT_OK');
      expect(allowed(snap(base), 'resume', OPEN).allowed, base).toBe(base === 'HELD' || base === 'PROGRAM_PAUSED');
      expect(allowed(snap(base), 'flash', OPEN).allowed, base).toBe(base === 'IDLE_UNHOMED' || base === 'IDLE_HOMED' || base === 'SHUTDOWN');
    }
  });

  it('Disconnect is refused while a job, move or write is in progress', () => {
    for (const base of ['RUNNING', 'JOGGING', 'HOMING', 'SETTINGS_WRITE', 'BOOTLOADER_MODE', 'NOT_CONNECTED'] as const) {
      expect(allowed(snap(base), 'disconnect').allowed, base).toBe(false);
    }
    expect(allowed(snap('IDLE_HOMED'), 'disconnect').allowed).toBe(true);
    expect(allowed(snap('PORT_REQUEST'), 'disconnect').allowed).toBe(true);
  });

  it('acknowledgements need their overlay', () => {
    expect(allowed(snap('IDLE_HOMED'), 'ackFault').allowed).toBe(false);
    expect(allowed(snap('IDLE_HOMED', ['FAULT']), 'ackFault').allowed).toBe(true);
    expect(allowed(snap('RUNNING'), 'acknowledgeLost').allowed).toBe(false);
    expect(allowed(snap('RUNNING', ['LOST', 'ORPHANED_MOTION', 'FAULT']), 'acknowledgeLost').allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED'), 'keepBoardSettings').allowed).toBe(false);
    expect(allowed(snap('READING', ['NEEDS_REVIEW']), 'keepBoardSettings').allowed).toBe(true);
    expect(allowed(snap('CONNECTED_UNKNOWN'), 'positionVerify').allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED'), 'positionVerify').allowed).toBe(false);
  });

  it('a denial names the highest-precedence overlay', () => {
    const d = allowed(snap('IDLE_HOMED', ['NEEDS_REVIEW', 'STALE', 'FAULT']), 'loadJob');
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.citation).toContain('FAULT');
  });
});
