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
  PHASE_1_RELEASE,
  PHASE_2_RELEASE,
  PORT_OPEN_STATES,
  STOP_CLASS,
  allowed,
  withJobs,
  intentKind,
  isLive,
  type BaseState,
  type Intent,
  type MatrixSnapshot,
  type Overlay,
  type Release,
} from '../src/index.ts';
import { runs } from './sanitizeHelpers.ts';

const OPEN: Release = { name: 'all gates open', motion: true, write: true, port: true, settings: true, reports: true, jobs: true, flash: true };

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
    for (const release of [CURRENT_RELEASE, PHASE_1_RELEASE, OPEN]) {
      for (const { s, intent } of cells()) {
        const d = allowed(s, intent, release);
        if (!d.allowed && !(d.reason.length > 5 && d.remedy.length > 5 && d.citation.length > 5)) {
          unclassified.push(`${release.name}: ${s.base} [${s.overlays.join('+')}] ${intent}`);
        }
        count++;
      }
    }
    expect(unclassified.slice(0, 20)).toEqual([]);
    expect(count).toBe(3 * BASE_STATES.length * OVERLAY_SETS.length * 4 * INTENTS.length);
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

  it('under FAULT, ORPHANED_MOTION, LOST and UNKNOWN only reads, stops, recovery and (UNKNOWN only) home, position-verify, set machine position and report configuration', () => {
    const allowedUnder = (o: Overlay): Set<Intent> => {
      const out = new Set<Intent>();
      for (const base of BASE_STATES) for (const i of INTENTS) if (allowed(snap(base, [o]), i, OPEN).allowed) out.add(i);
      return out;
    };
    // jobBreakpoints (Phase 3) is the page's list of breakpoints for a loaded job: it writes nothing to the controller.
    // probeZClose (Probe Z, §4.5c) is Cancel before the probe and "The plate is off": it writes nothing either.
    expect([...allowedUnder('FAULT')].sort()).toEqual(['ackFault', 'cloudSync', 'disconnect', 'enq', 'feedhold', 'jobBreakpoints', 'probeZClose', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    // Amendment 2026-11-03 (OD-12): Disconnect closes the port and changes nothing on the board.
    expect([...allowedUnder('ORPHANED_MOTION')].sort()).toEqual(['cloudSync', 'disconnect', 'enq', 'feedhold', 'jobBreakpoints', 'probeZClose', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    expect([...allowedUnder('LOST')].sort()).toEqual(['acknowledgeLost', 'cloudSync', 'probeZClose']);
    // Amendment 2026-11-02: the ways out of UNKNOWN are home, position-verify and, for a machine without homing
    // switches, set machine position (G28.3); the session's status-report configuration moves nothing.
    expect([...allowedUnder('UNKNOWN')].sort()).toEqual([
      'cloudSync',
      'configureReports',
      'disconnect',
      'enq',
      'feedhold',
      // Amendment 2026-11-03: entering the bootloader moves nothing (the flash gate, §4.8).
      'flash',
      'home',
      'jobBreakpoints',
      'lineMode',
      'positionVerify',
      'probeZClose',
      'read',
      'resetController',
      'setMachinePosition',
      'spindleOffNow',
      'stopJob',
    ]);
    expect([...allowedUnder('STALE')].sort()).toEqual(['cloudSync', 'disconnect', 'enq', 'feedhold', 'jobBreakpoints', 'probeZClose', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    // Amendment 2026-11-03: under READ_ONLY the firmware update too (the old-firmware gate opens the Update panel).
    expect([...allowedUnder('READ_ONLY')].sort()).toEqual(['cloudSync', 'disconnect', 'enq', 'feedhold', 'flash', 'jobBreakpoints', 'probeZClose', 'read', 'resetController', 'spindleOffNow', 'stopJob']);
    expect([...allowedUnder('NEEDS_REVIEW')].sort()).toEqual([
      'applyProfile',
      'cloudSync',
      'configureReports',
      'disconnect',
      'enq',
      'feedhold',
      'flash',
      'jobBreakpoints',
      'keepBoardSettings',
      'lineMode',
      // Amendment 2026-11-03: confirming the machine after a firmware update moves nothing.
      'positionVerify',
      'probeZClose',
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
    expect(ok.sort()).toEqual(['disconnect', 'feedhold', 'resetController', 'spindleOffNow', 'stopJob']);
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
      if (kind !== 'motion' && kind !== 'write' && kind !== 'settings' && kind !== 'reports' && kind !== 'jobs' && kind !== 'port') continue;
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
    for (const i of ['jog', 'home', 'start', 'resume', 'arm', 'consoleLine', 'spindleOn', 'setWorkZero', 'goToZero', 'typedMove', 'clearAlarm', 'setMachinePosition', 'tempOffset', 'selectCoordSystem']) expect(kinds[i], i).toBe('motion');
    // The status-report configuration has its own gate (amendment 2026-11-02, H64).
    expect(kinds['configureReports']).toBe('reports');
    for (const i of ['applyProfile', 'optionalStop', 'resetController']) expect(kinds[i], i).toBe('write');
    // The firmware update has its own gate (amendment 2026-11-03, flasherPhase.ts).
    expect(kinds['flash']).toBe('flash');
    // Settings writes have their own gate (amendment 2026-11-02).
    expect(kinds['settingsWrite']).toBe('settings');
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

describe('Phase 1 release gate (ROADMAP P1-02: read-only bench)', () => {
  /** Intents that can put bytes on the wire. */
  const MACHINE = INTENTS.filter((i) => ['stop', 'read', 'recovery', 'motion', 'write', 'settings', 'reports', 'jobs'].includes(intentKind(i)));

  it('of the intents that reach the machine, allows only read, enq (classified EN), ackFault (under FAULT) and the stop class', () => {
    const wrong: string[] = [];
    const seen = new Set<Intent>();
    for (const { s, intent } of cells()) {
      if (!MACHINE.includes(intent)) continue;
      if (!allowed(s, intent, PHASE_1_RELEASE).allowed) continue;
      seen.add(intent);
      const ok =
        STOP_CLASS.includes(intent) ||
        intent === 'read' ||
        (intent === 'enq' && s.classified && s.enqCapable) ||
        (intent === 'ackFault' && s.overlays.includes('FAULT'));
      if (!ok) wrong.push(`${s.base} [${s.overlays.join('+')}] ${intent}`);
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    expect([...seen].sort()).toEqual(['ackFault', 'enq', 'feedhold', 'read', 'spindleOffNow', 'stopJob']);
  });

  it('denies Reset controller (^X) and every motion and write intent in every cell', () => {
    const wrong: string[] = [];
    for (const { s, intent } of cells()) {
      const kind = intentKind(intent);
      if (kind !== 'motion' && kind !== 'write' && kind !== 'settings' && kind !== 'reports' && kind !== 'jobs') continue;
      const d = allowed(s, intent, PHASE_1_RELEASE);
      if (d.allowed || d.reason !== 'Not available in this release.' || !d.citation.includes('Phase 1')) wrong.push(`${s.base} ${intent}`);
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(intentKind('resetController')).toBe('write');
  });

  it('allows connect only from NOT_CONNECTED with no overlay, and keeps the stop class open whenever the port is', () => {
    for (const { s, intent } of cells()) {
      if (intent === 'connect') {
        expect(allowed(s, intent, PHASE_1_RELEASE).allowed).toBe(s.base === 'NOT_CONNECTED' && s.overlays.length === 0);
      }
      if (STOP_CLASS.includes(intent)) expect(allowed(s, intent, PHASE_1_RELEASE).allowed).toBe(portOpen(s));
    }
    expect(PHASE_1_RELEASE).toEqual({ name: 'Phase 1', motion: false, write: false, port: true });
    expect(Object.isFrozen(PHASE_1_RELEASE)).toBe(true);
  });
});

describe('Phase 2 release gate (owner 2026-11-02: bench motion; SAFETY §4.5b, T-S92)', () => {
  const MOTION_P2: readonly Intent[] = ['jog', 'goToZero', 'typedMove', 'setWorkZero', 'spindleOn', 'clearAlarm', 'resume', 'tempOffset', 'selectCoordSystem'];

  it('allows the Phase 2 motion intents only in their states with no overlay at all, and never a settings write', () => {
    const wrong: string[] = [];
    for (const { s, intent } of cells()) {
      const d = allowed(s, intent, PHASE_2_RELEASE);
      if (intentKind(intent) === 'write' && d.allowed) wrong.push(`write ${s.base} ${intent}`);
      if (!MOTION_P2.includes(intent) || !d.allowed) continue;
      if (s.overlays.length > 0) wrong.push(`overlay ${s.base} [${s.overlays.join('+')}] ${intent}`);
      const states: Record<string, readonly string[]> = {
        // PROGRAM_PAUSED (Phase 3): the jog and Z re-zero of a manual tool change; the session allows them only then.
        jog: ['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'PROGRAM_PAUSED'],
        goToZero: ['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING'],
        // H91: the typed line is written after its check moved the base to JOGGING; never in a job, hold or tool change.
        typedMove: ['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING'],
        setWorkZero: ['IDLE_UNHOMED', 'IDLE_HOMED', 'PROGRAM_PAUSED'],
        spindleOn: ['IDLE_UNHOMED', 'IDLE_HOMED'],
        clearAlarm: ['ALARM'],
        resume: ['HELD', 'PROGRAM_PAUSED'],
        tempOffset: ['IDLE_UNHOMED', 'IDLE_HOMED'],
        selectCoordSystem: ['IDLE_UNHOMED', 'IDLE_HOMED'],
      };
      if (!(states[intent] as readonly string[]).includes(s.base)) wrong.push(`state ${s.base} ${intent}`);
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('never gates the stop class and denies motion in a job state, ORPHANED_MOTION, READ_ONLY and STALE', () => {
    for (const { s, intent } of cells()) {
      if (STOP_CLASS.includes(intent)) expect(allowed(s, intent, PHASE_2_RELEASE).allowed).toBe(portOpen(s));
    }
    for (const base of ['RUNNING', 'HELD', 'STOPPING_JOB', 'CONNECTED_UNKNOWN'] as const) expect(allowed(snap(base), 'jog', PHASE_2_RELEASE).allowed, base).toBe(false);
    for (const o of ['ORPHANED_MOTION', 'READ_ONLY', 'STALE', 'UNKNOWN', 'FAULT'] as const) expect(allowed(snap('IDLE_HOMED', [o]), 'jog', PHASE_2_RELEASE).allowed, o).toBe(false);
    expect(allowed(snap('IDLE_HOMED'), 'jog', PHASE_2_RELEASE).allowed).toBe(true);
    expect(PHASE_2_RELEASE).toEqual({ name: 'Phase 2', motion: true, write: false, port: true, reports: true });
    expect(Object.isFrozen(PHASE_2_RELEASE)).toBe(true);
  });

  it('Probe Z (SAFETY §4.5c, H90): probeZ only from idle, or JOGGING for its own lines, with no overlay; probeZClose writes nothing and is never refused', () => {
    for (const { s, intent } of cells()) {
      if (intent === 'probeZ') expect(allowed(s, intent, PHASE_2_RELEASE).allowed, `${s.base} [${s.overlays.join('+')}]`).toBe(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING'].includes(s.base) && s.overlays.length === 0);
      if (intent === 'probeZClose' && s.classified) expect(allowed(s, intent, PHASE_1_RELEASE).allowed, `${s.base} [${s.overlays.join('+')}]`).toBe(true);
    }
    expect(intentKind('probeZ')).toBe('motion');
    expect(allowed(snap('IDLE_HOMED'), 'probeZ', PHASE_1_RELEASE)).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
  });

  it('homing and set machine position: idle or CONNECTED_UNKNOWN, UNKNOWN the only overlay; HOMING only for the G28.2 line being written (amendment 2026-11-02)', () => {
    for (const { s, intent } of cells()) {
      if (intent !== 'home' && intent !== 'setMachinePosition') continue;
      const d = allowed(s, intent, PHASE_2_RELEASE);
      if (!d.allowed) continue;
      expect(s.overlays.every((o) => o === 'UNKNOWN'), `${s.base} [${s.overlays.join('+')}] ${intent}`).toBe(true);
      const states = intent === 'home' ? ['IDLE_UNHOMED', 'IDLE_HOMED', 'CONNECTED_UNKNOWN', 'HOMING'] : ['IDLE_UNHOMED', 'IDLE_HOMED', 'CONNECTED_UNKNOWN'];
      expect(states, `${s.base} ${intent}`).toContain(s.base);
    }
    expect(allowed(snap('CONNECTED_UNKNOWN', ['UNKNOWN']), 'setMachinePosition', PHASE_2_RELEASE).allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED'), 'home', PHASE_1_RELEASE).allowed).toBe(false);
  });

  it('report configuration (H64): its own gate, idle, CONNECTED_UNKNOWN or IDENTIFYING (OD-14: jv only), never READ_ONLY, ORPHANED_MOTION, STALE, FAULT or ALARM', () => {
    for (const { s, intent } of cells()) {
      if (intent !== 'configureReports') continue;
      const d = allowed(s, intent, PHASE_2_RELEASE);
      if (!d.allowed) continue;
      expect(['IDLE_UNHOMED', 'IDLE_HOMED', 'CONNECTED_UNKNOWN', 'IDENTIFYING']).toContain(s.base);
      expect(s.overlays.every((o) => o === 'UNKNOWN' || o === 'NEEDS_REVIEW'), `[${s.overlays.join('+')}]`).toBe(true);
    }
    expect(allowed(snap('ALARM'), 'configureReports', PHASE_2_RELEASE).allowed).toBe(false);
    expect(allowed(snap('IDLE_UNHOMED'), 'configureReports', PHASE_1_RELEASE)).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
    expect(allowed(snap('IDLE_UNHOMED'), 'configureReports', { ...PHASE_2_RELEASE, reports: false })).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
    expect(allowed(snap('CONNECTED_UNKNOWN', ['UNKNOWN', 'NEEDS_REVIEW']), 'configureReports', PHASE_2_RELEASE).allowed).toBe(true);
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

  it('Arm only from PREFLIGHT_OK; Resume only from HELD or PROGRAM_PAUSED; Flash from idle (amended 2026-11-03: and CONNECTED_UNKNOWN)', () => {
    for (const base of BASE_STATES) {
      expect(allowed(snap(base), 'arm', OPEN).allowed, base).toBe(base === 'PREFLIGHT_OK');
      expect(allowed(snap(base), 'resume', OPEN).allowed, base).toBe(base === 'HELD' || base === 'PROGRAM_PAUSED');
      expect(allowed(snap(base), 'flash', OPEN).allowed, base).toBe(base === 'IDLE_UNHOMED' || base === 'IDLE_HOMED' || base === 'CONNECTED_UNKNOWN');
    }
  });

  it('Flash: allowed under READ_ONLY (an old or unapproved build is what an update replaces), UNKNOWN and NEEDS_REVIEW; never under FAULT, LOST, ORPHANED_MOTION or STALE', () => {
    for (const overlay of OVERLAYS) {
      const ok = allowed({ base: 'IDLE_HOMED', overlays: [overlay], classified: true, enqCapable: true }, 'flash', OPEN).allowed;
      expect(ok, overlay).toBe(overlay === 'READ_ONLY' || overlay === 'UNKNOWN' || overlay === 'NEEDS_REVIEW');
    }
  });

  it('Disconnect is refused while a job, move or write is in progress', () => {
    for (const base of ['RUNNING', 'JOGGING', 'HOMING', 'SETTINGS_WRITE', 'BOOTLOADER_MODE', 'NOT_CONNECTED'] as const) {
      expect(allowed(snap(base), 'disconnect').allowed, base).toBe(false);
    }
    expect(allowed(snap('IDLE_HOMED'), 'disconnect').allowed).toBe(true);
    expect(allowed(snap('PORT_REQUEST'), 'disconnect').allowed).toBe(true);
  });

  it('Disconnect is allowed under ORPHANED_MOTION: closing the port changes nothing on the board (OD-12); LOST still needs its acknowledgement', () => {
    expect(allowed(snap('CONNECTED_UNKNOWN', ['ORPHANED_MOTION']), 'disconnect').allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED', ['ORPHANED_MOTION', 'UNKNOWN']), 'disconnect').allowed).toBe(true);
    expect(allowed(snap('IDLE_HOMED', ['LOST']), 'disconnect').allowed).toBe(false);
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

describe('Phase 3 release gate (owner 2026-11-02: jobs; SAFETY §4.4a)', () => {
  const JOBS = withJobs(PHASE_2_RELEASE, 'staging');
  const JOB_INTENTS: readonly Intent[] = ['startJob', 'jobLine', 'jobModes', 'lineMode', 'jobRuntime'];

  it('the job intents are kind jobs and denied in every cell without the jobs release, with every other gate open', () => {
    const noJobs: Release = { ...OPEN, jobs: false };
    for (const intent of JOB_INTENTS) expect(intentKind(intent)).toBe('jobs');
    for (const { s, intent } of cells()) {
      if (!JOB_INTENTS.includes(intent)) continue;
      expect(allowed(s, intent, noJobs).allowed).toBe(false);
      expect(allowed(s, intent, PHASE_2_RELEASE).allowed).toBe(false);
    }
  });

  it('with jobs: Start from idle only, job lines while RUNNING only, the line mode only while nothing moves, never under FAULT', () => {
    const states: Record<string, readonly string[]> = {
      startJob: ['IDLE_UNHOMED', 'IDLE_HOMED'],
      jobLine: ['RUNNING'],
      // OD-19: the start modes, only while the job starts.
      jobModes: ['PREAMBLE'],
      lineMode: ['IDLE_UNHOMED', 'IDLE_HOMED', 'CONNECTED_UNKNOWN', 'PREAMBLE'],
      jobRuntime: ['IDLE_UNHOMED', 'IDLE_HOMED', 'PREAMBLE', 'RUNNING', 'HELD', 'PROGRAM_PAUSED'],
    };
    const wrong: string[] = [];
    for (const { s, intent } of cells()) {
      if (!JOB_INTENTS.includes(intent) || !allowed(s, intent, JOBS).allowed) continue;
      if (!(states[intent] as readonly string[]).includes(s.base)) wrong.push(`state ${s.base} ${intent}`);
      const okOverlays = intent === 'lineMode' ? ['UNKNOWN', 'NEEDS_REVIEW'] : [];
      if (!s.overlays.every((o) => okOverlays.includes(o))) wrong.push(`overlay ${s.base} [${s.overlays.join('+')}] ${intent}`);
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(allowed(snap('RUNNING'), 'jobLine', JOBS).allowed).toBe(true);
    expect(allowed(snap('RUNNING', ['STALE']), 'jobLine', JOBS).allowed).toBe(false);
    expect(allowed(snap('IDLE_HOMED'), 'startJob', JOBS).allowed).toBe(true);
    // Disconnect stays denied while a job owns the machine.
    for (const base of ['PREAMBLE', 'RUNNING', 'HELD', 'PROGRAM_PAUSED', 'STOPPING_JOB'] as const) expect(allowed(snap(base), 'disconnect', JOBS).allowed, base).toBe(false);
  });
});
