/**
 * The Transport contract itself (ROADMAP P0-12; SAFETY H2b: "the Transport
 * has no abort()"). The interface and `GuardedTransport` are pinned to an
 * exact member list, at compile time and at run time, so adding a way to
 * cancel a write in progress (or any other member) fails here and needs a
 * safety review. Lint already bans the name in this package (P0-02).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as machine from '../src/index.ts';
import { GuardedTransport } from '../src/guardedTransport.ts';
import type { Transport } from '../src/transport.ts';

const TRANSPORT_MEMBERS = ['close', 'info', 'onDisconnect', 'open', 'readable', 'writeLine'] as const;

describe('Transport interface', () => {
  it('has exactly the reviewed members', () => {
    expectTypeOf<keyof Transport>().toEqualTypeOf<(typeof TRANSPORT_MEMBERS)[number]>();
  });

  it('GuardedTransport adds only read-only state and a tighten-only line cap to it', () => {
    const own = Object.getOwnPropertyNames(GuardedTransport.prototype).sort();
    expect(own).toEqual(['constructor', ...TRANSPORT_MEMBERS, 'state', 'writeFailed', 'disconnected', 'maxLineBytes', 'tightenLineCap'].sort());
    for (const getter of ['state', 'writeFailed', 'disconnected', 'maxLineBytes']) {
      const d = Object.getOwnPropertyDescriptor(GuardedTransport.prototype, getter);
      expect(d?.get, getter).toBeTypeOf('function');
      expect(d?.set, getter).toBeUndefined();
    }
  });

  it('GuardedTransport is a Transport', () => {
    expectTypeOf<GuardedTransport>().toMatchTypeOf<Transport>();
  });
});

describe('package entry', () => {
  it('exports the guard, the policy and the shape check, and never the Web Serial transport', () => {
    expect(Object.keys(machine).sort()).toEqual(
      ['ACTIVE_PHASES','BOOTLOADER_PORTS','BOOTLOADER_TOUCH_BAUD','CAPABILITY_BAUD_RATES','CLEAR_LINE','DEFAULT_TIMINGS','DRO_AXES','DUE_PROGRAMMING_PORT','EVENT_LOG_MAX_BYTES','EventLog','EventLogTruncatedError','FULL_SESSION_FLOW_CONTROL','GuardedTransport','HEARTBEAT_INTERVAL_MS','HEARTBEAT_S','JOB_DIALECTS','JOB_LIMITS','JOB_PREP_TOKENS','LAG_AMBER_MS','LAG_RED_MS','LINE_INTENTS','LIVENESS_TOKEN','MAX_JOG_FEED','MAX_MOTION_MM','MAX_PROBE_RESTARTS','MAX_QUEUED_READS','MAX_REALTIME_GROUP_BYTES','MAX_RPM','MAX_WRITE_LINE_BYTES','MOTION_LIMITS','MOTION_READING_TOKENS','MachineSession','POLL_TOKENS','PROBE_TOKENS','READING_TOKENS','READY_BASES','REALTIME_BYTES','REFUSED_PORTS','REPORT_DIALECTS','RT_PROBE_LINE','RUN_SR_FIELDS','SEED_TOKENS','SESSION_BASES','SESSION_BAUD_RATES','SESSION_OPEN_OPTIONS','SETTING_LINE','SI_DEFAULT','SI_MAX_SENSIBLE','SNAPSHOT_STRING_MAX','TRANSPORT_BUFFER_SIZE','TransportRefusedError','TransportWriteError','VERIFY_TOKENS','VERSION','activeSystem','capabilityBaudRatesOf','checkSelection','checkWrite','classifyWrite','decideOpen','dialectOf','droView','enqAllowedNow','escape','feedLimitLine','feedLimitSupported','gateTokens','heartbeatCoversHold','heartbeatLine','initialState','isPortSelector','jobActive','jobFlagLine','jobFlagSupported','jobInFlight','jobLineWritableIn','jobRuntimeWritableIn','jobsCapable','judgeGate','lagOf','lagThresholds','lineModeWritableIn','liveControlPlatform','liveMotion','liveStart','matrixSnapshot','motionCapable','motionLineKind','phase1WriteVerdict','probeRecord','queuedLine','readOnlyNotice','readableNow','reduce','refusedPortsOf','reportLineShape','reportSteps','reportWritableIn','rxmLine','rxmTarget','sanitizeLive','sessionOpenOptionsFor','sessionSettings','settingLine','settingRefusal','settingWritableIn','settingWriteActive','sharedSessionOptions','slotRoom','snapshotOf','srListLine','srListMatches','statusMeaning','suggestMachines','textHash','toHex','wireEventsToJsonl','wireNumber','writeLineCapFor'].sort(),
    );
  });

  it('exposes the Web Serial transport and (OD-3) the window port chooser only on their own subpaths, each with its one importer (dependency-cruiser)', () => {
    expect((pkg as { exports: object }).exports).toEqual({
      '.': './src/index.ts',
      './web-serial-transport': './src/webSerialTransport.ts',
      './web-serial-chooser': './src/webSerialChooser.ts',
    });
  });

  it('declares its runtime workspace edges as dependencies and keeps the test kit a dev dependency', () => {
    expect(Object.keys((pkg as { dependencies?: object }).dependencies ?? {}).sort()).toEqual(['@synthetos/flasher', '@synthetos/protocol', '@synthetos/safety', '@synthetos/schema']);
    expect(Object.keys((pkg as { devDependencies?: object }).devDependencies ?? {}).sort()).toEqual(['@synthetos/testkit']);
  });
});
