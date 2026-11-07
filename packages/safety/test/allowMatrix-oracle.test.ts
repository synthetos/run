/**
 * Independent oracles for the allow-matrix constants (ROADMAP P0-10, SAFETY
 * §3 and §4.1, T-S3, T-S58, T-S59, T-S62) and the D1 safety condition.
 *
 * allowMatrix.test.ts generates its cells from the module's own exports
 * (STOP_CLASS, PORT_OPEN_STATES). That proves the decision function agrees
 * with those constants, but not that the constants are right: an emptied
 * STOP_CLASS made the T-S62 loop vacuous, and a PORT_OPEN_STATES that counted
 * NOT_CONNECTED as "port open" moved the oracle with the code. Both survived
 * mutation testing in the Phase 0 safety conformance audit
 * (docs/safety/PHASE0_TRACEABILITY.md). Here every list is written out from
 * the safety case, so a change to one needs a reviewed change to this file.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BASE_STATES,
  INTENTS,
  PORT_OPEN_STATES,
  STOP_CLASS,
  allowed,
  intentKind,
  type BaseState,
  type Intent,
  type IntentKind,
  type MatrixSnapshot,
} from '../src/index.ts';

const snap = (base: BaseState): MatrixSnapshot => ({ base, overlays: [], classified: true, enqCapable: true });
const OPEN = { name: 'all gates open', motion: true, write: true, port: true };

describe('STOP_CLASS and PORT_OPEN_STATES, from SAFETY §3 and §4.1', () => {
  it('the stop class is exactly Feedhold, Stop job and Spindle/coolant off now, and only they are kind "stop"', () => {
    expect([...STOP_CLASS]).toEqual(['feedhold', 'stopJob', 'spindleOffNow']);
    expect(INTENTS.filter((i) => intentKind(i) === 'stop')).toEqual(['feedhold', 'stopJob', 'spindleOffNow']);
  });

  it('the port is closed only before IDENTIFYING: NOT_CONNECTED, PORT_REQUEST and OPENING', () => {
    const closed: BaseState[] = ['NOT_CONNECTED', 'PORT_REQUEST', 'OPENING'];
    expect(BASE_STATES.filter((s) => !PORT_OPEN_STATES.has(s))).toEqual(closed);
    expect(PORT_OPEN_STATES.size).toBe(BASE_STATES.length - closed.length);
  });

  it('every stop-class intent is denied with "Use your E-stop." while the port is closed, and allowed from IDENTIFYING on', () => {
    for (const intent of ['feedhold', 'stopJob', 'spindleOffNow'] as const) {
      for (const base of ['NOT_CONNECTED', 'PORT_REQUEST', 'OPENING'] as const) {
        const d = allowed(snap(base), intent);
        expect(d, `${intent} ${base}`).toMatchObject({ allowed: false, remedy: 'Use your E-stop.' });
      }
      for (const base of ['IDENTIFYING', 'READING', 'IDLE_HOMED', 'RUNNING', 'HELD', 'ALARM', 'SHUTDOWN', 'PANIC', 'BOOTLOADER_MODE'] as const) {
        expect(allowed(snap(base), intent).allowed, `${intent} ${base}`).toBe(true);
      }
    }
  });
});

describe('intent kinds (which release gate and which rule applies)', () => {
  it('every intent has its reviewed kind', () => {
    const expected: Record<Intent, IntentKind> = {
      feedhold: 'stop',
      stopJob: 'stop',
      spindleOffNow: 'stop',
      read: 'read',
      enq: 'read',
      resetController: 'write',
      ackFault: 'recovery',
      acknowledgeLost: 'session',
      positionVerify: 'session',
      keepBoardSettings: 'session',
      jog: 'motion',
      home: 'motion',
      consoleLine: 'motion',
      spindleOn: 'motion',
      setWorkZero: 'motion',
      goToZero: 'motion',
      clearAlarm: 'motion',
      setMachinePosition: 'motion',
      tempOffset: 'motion',
      selectCoordSystem: 'motion',
      probeZ: 'motion',
      probeZClose: 'session',
      configureReports: 'reports',
      optionalStop: 'write',
      startJob: 'jobs',
      jobLine: 'jobs',
      lineMode: 'jobs',
      jobRuntime: 'jobs',
      jobBreakpoints: 'session',
      settingsWrite: 'settings',
      applyProfile: 'write',
      flash: 'flash',
      loadJob: 'job',
      loadLibraryJob: 'job',
      arm: 'motion',
      start: 'motion',
      resume: 'motion',
      connect: 'port',
      disconnect: 'session',
      signOut: 'cloud',
      switchAccount: 'cloud',
      deleteArmedFile: 'cloud',
      changeProfile: 'cloud',
      forgetMachine: 'cloud',
      cloudSync: 'cloud',
    };
    expect(Object.fromEntries(INTENTS.map((i) => [i, intentKind(i)]))).toEqual(expected);
  });
});

describe('job and sync rows, state by state (SAFETY §4.1 Load job and Cloud sync, T-S59)', () => {
  // SAFETY §4.1 names RUNNING and HELD (pickers) and RUNNING, HELD, BARRIER_DRAINING,
  // STOPPING_JOB (library). The matrix denies loading in every state of an active job.
  const JOB_ACTIVE: BaseState[] = ['PREAMBLE', 'RUNNING', 'HOLD_REQUESTED', 'HELD', 'BARRIER_DRAINING', 'PROGRAM_PAUSED', 'END_HOLDBACK', 'STOPPING_JOB'];
  // SAFETY §4.1 and T-S59 name RUNNING, HELD, BARRIER_DRAINING and STOPPING_JOB; the matrix
  // also pauses in the transitions into and out of them.
  const SYNC_PAUSED: BaseState[] = ['PREAMBLE', 'RUNNING', 'HOLD_REQUESTED', 'HELD', 'BARRIER_DRAINING', 'END_HOLDBACK', 'STOPPING_JOB'];

  it('a local or library job cannot be loaded in any state of an active job, nor while flashing, and can be otherwise', () => {
    for (const base of BASE_STATES) {
      for (const intent of ['loadJob', 'loadLibraryJob'] as const) {
        expect(allowed(snap(base), intent, OPEN).allowed, `${intent} ${base}`).toBe(!JOB_ACTIVE.includes(base) && base !== 'BOOTLOADER_MODE');
      }
    }
  });

  it('cloud sync pauses in exactly the job states SAFETY §4.1 names plus their transitions', () => {
    for (const base of BASE_STATES) expect(allowed(snap(base), 'cloudSync', OPEN).allowed, base).toBe(!SYNC_PAUSED.includes(base));
  });

  it('account and destructive intents are allowed only while NOT_CONNECTED', () => {
    for (const intent of ['signOut', 'switchAccount', 'deleteArmedFile', 'changeProfile', 'forgetMachine'] as const) {
      for (const base of BASE_STATES) expect(allowed(snap(base), intent, OPEN).allowed, `${intent} ${base}`).toBe(base === 'NOT_CONNECTED');
    }
  });
});

describe('D1: nothing in the machine path consults the session (DECISIONS D1, SAFETY §4.10)', () => {
  it('the matrix snapshot carries machine state only: no account, session or sign-in field', () => {
    expectTypeOf<keyof MatrixSnapshot>().toEqualTypeOf<'base' | 'overlays' | 'classified' | 'enqCapable'>();
    expect(allowed.length).toBe(2);
  });

  it('every decision is the same whatever account state a caller attaches to the snapshot', () => {
    const accountStates = [{ signedIn: false }, { signedIn: true }, { session: null, user: undefined }, { sessionExpired: true, identityReachable: false }];
    for (const base of BASE_STATES) {
      for (const intent of INTENTS) {
        const plain = allowed(snap(base), intent, OPEN);
        for (const extra of accountStates) {
          expect(allowed({ ...snap(base), ...extra } as MatrixSnapshot, intent, OPEN), `${base} ${intent} ${JSON.stringify(extra)}`).toEqual(plain);
        }
      }
    }
  });
});
