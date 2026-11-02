/**
 * Wires LIVE entry into the workspace page (ROADMAP P1-05). Called by the
 * workspace entry after hydration with the build channel and the machine
 * worker. Everything here is UI/auth layer: the worker gets only `open`,
 * `close` and `subscribe`, and never learns about identity or the advisory.
 */
import { h, render } from 'preact';
import type { Signal } from '@preact/signals';
import { environmentForOrigin } from '@synthetos/protocol';
import { fetchIdentity, fetchSafetyAdvisory } from '../cloud/live.ts';
import type { BuildChannel } from '../channel/channel.ts';
import { AlarmTone } from '../machine-ui/alarm.ts';
import { AxisModes, axisModeView } from '../machine-ui/AxisModes.ts';
import { EMPTY_AXIS_MODE_SESSION, type AxisModeSession } from '@synthetos/safety';
import { Dro, lagAt } from '../machine-ui/Dro.ts';
import { SettingsView } from '../machine-ui/SettingsView.ts';
import type { LiveMarkerView } from '../preview/PreviewPanel.ts';
import { OverlayBanners } from '../machine-ui/OverlayBanners.ts';
import { callMachineWorker } from '../machine-worker/client.ts';
import { RPC_VERSION, type MachineRequest, type SnapshotMessage, type WorkerStatus } from '../machine-worker/rpc.ts';
import { AdvisoryPoller, checkAdvisory, type AdvisoryCheck, type AdvisoryDeps } from './advisoryGate.ts';
import { accessProvider, AuthGate, providersFor } from './authGate.ts';
import { ConnectPanel } from './ConnectPanel.ts';
import { memoryDeviceSafety, openDeviceSafety, type DeviceSafetyStore } from './deviceSafety.ts';
import { leaveFullscreen } from './fullscreen.ts';
import { LiveEntry } from './liveEntry.ts';
import { windowChooser } from './portChooser.ts';
import { LiveReadout } from './readout.ts';
import { cleanDisconnect, installLiveLifecycle, previousSessionEnded } from './liveMarker.ts';
import type { StopControls } from './stopControls.ts';

/**
 * The `open` request for the port the window chose. `previousSessionEnded` is the W6 state (a reload
 * or discard ended a LIVE session), so the worker starts this connect in UNKNOWN (SAFETY §3).
 */
export function openRequest(port: Extract<MachineRequest, { kind: 'open' }>['port'], previousSessionEnded: boolean): Extract<MachineRequest, { kind: 'open' }> {
  return { v: RPC_VERSION, kind: 'open', port, boardId: null, previousSessionEnded };
}

export interface MountOptions {
  readonly channel: BuildChannel;
  readonly appSha: string;
  readonly worker: Worker | null;
  readonly container: HTMLElement;
  readonly bannerContainer: HTMLElement;
  readonly previousSession: Signal<boolean>;
  /** P1-06: told when this tab enters or leaves LIVE, and given each snapshot (W30, PAUSE REQUESTED). */
  readonly stopControls: StopControls;
  /** P1-07: the live position marker the G-code preview draws (polled `mpo` only). */
  readonly marker: Signal<LiveMarkerView | null>;
}

/** How often the window re-renders the DRO's age and lag badge between snapshots. */
export const DRO_TICK_MS = 250;

export async function mountLiveEntry(options: MountOptions): Promise<LiveEntry> {
  let store: DeviceSafetyStore;
  try {
    store = await openDeviceSafety(globalThis.indexedDB);
  } catch {
    store = memoryDeviceSafety();
  }
  options.previousSession.value = await previousSessionEnded(store, (document as Document & { readonly wasDiscarded?: boolean }).wasDiscarded === true);

  const environment = options.channel.kind === 'bench' ? 'staging' : environmentForOrigin(location.origin);
  const auth = new AuthGate(providersFor(options.channel, environment, accessProvider(() => fetchIdentity())));
  const advisoryDeps: AdvisoryDeps = { fetchAdvisory: () => fetchSafetyAdvisory(), store, environment, appSha: options.appSha, now: () => new Date() };
  let advisoryBlocked: AdvisoryCheck | null = null;
  const poller = new AdvisoryPoller(
    advisoryDeps,
    { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
    (blocked) => {
      advisoryBlocked = blocked;
      draw();
    },
  );
  const alarm = new AlarmTone(typeof AudioContext === 'function' ? () => new AudioContext() : null);
  const worker = options.worker;

  const entry = new LiveEntry({
    auth,
    checkAdvisory: () => checkAdvisory(advisoryDeps),
    store,
    now: () => new Date(),
    // OD-3 (approved 2026-11-02): the browser's port chooser, from the C1 confirm click (the user
    // gesture), only after sign-in (in the bench build, the localhost bench identity), the advisory and
    // C1 have passed. Its PortSelector goes to the machine worker's `open`, which finds the same granted
    // port or refuses. Pause, Escape and the stop requests never pass through here.
    choosePort: () => windowChooser(),
    open: async (port) => {
      if (worker === null) return { ok: false, message: 'The machine worker is not running in this browser.' };
      const reply = await callMachineWorker(worker, openRequest(port, options.previousSession.value));
      return reply.ok ? { ok: true } : { ok: false, message: reply.message };
    },
    leaveFullscreen: () => leaveFullscreen(document),
    unlockAlarm: () => alarm.unlock(),
    onLive: () => {
      options.previousSession.value = false;
      poller.start();
    },
  });

  installLiveLifecycle({ addEventListener: (type, listener) => addEventListener(type, listener) }, document, store, () => entry.state.step === 'live', () => new Date());

  let snapshot: WorkerStatus['session'] | null = null;
  let staleSince: number | null = null;
  let droMessage: SnapshotMessage | null = null;
  let droReceivedAt = 0;
  // P1-07: the connect-time settings read and the drift check. Reads go through the worker's `read`; nothing here writes.
  const readout = new LiveReadout({
    read: (tokens) => (worker === null ? Promise.resolve({ ok: false, message: 'The machine worker is not running in this browser.' }) : callMachineWorker(worker, { v: RPC_VERSION, kind: 'read', tokens })),
    drift: (epoch) => (worker === null ? Promise.resolve() : callMachineWorker(worker, { v: RPC_VERSION, kind: 'drift', epoch })),
    store,
    now: () => new Date(),
    onChange: () => draw(),
  });
  const droContainer = document.createElement('div');
  droContainer.dataset['region'] = 'live-readout';
  options.container.after(droContainer);
  setInterval(() => {
    if (droMessage !== null && droMessage.dro.machineSource.ageMs !== null) {
      updateMarker();
      drawReadout();
    }
  }, DRO_TICK_MS);

  function updateMarker(): void {
    const m = droMessage?.dro.marker ?? null;
    if (droMessage === null || m === null) {
      options.marker.value = null;
      return;
    }
    const ageMs = m.ageMs + (performance.now() - droReceivedAt);
    options.marker.value = { x: m.x, y: m.y, z: m.z, ageMs, lag: lagAt(ageMs, droMessage.snapshot.overlays.includes('STALE'), droMessage.lag) };
  }
  if (worker !== null) {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = event.data as SnapshotMessage | { kind?: unknown };
      if (message.kind !== 'snapshot') return;
      droMessage = message as SnapshotMessage;
      droReceivedAt = performance.now();
      snapshot = droMessage.snapshot;
      readout.onSnapshot(snapshot);
      updateMarker();
      staleSince = snapshot.overlays.includes('STALE') ? (staleSince ?? Date.now()) : null;
      alarm.sync(snapshot);
      options.stopControls.setSnapshot(snapshot);
      draw();
    };
    worker.postMessage({ v: RPC_VERSION, kind: 'subscribe' }, [channel.port2]);
  }

  async function disconnect(): Promise<void> {
    // Only a close the worker confirmed removes the marker (W6) and leaves LIVE.
    await cleanDisconnect(() => (worker === null ? Promise.resolve({ ok: true }) : callMachineWorker(worker, { v: RPC_VERSION, kind: 'close' })), store, () => {
      poller.stop();
      advisoryBlocked = null;
      entry.reset();
    });
  }

  function draw(): void {
    render(
      h(ConnectPanel, {
        state: entry.state,
        advisoryBlocked,
        onConnect: () => void entry.begin(),
        onConfirm: (ticked) => void entry.confirm(ticked),
        onCancel: () => entry.reset(),
        onDisconnect: () => void disconnect(),
      }),
      options.container,
    );
    render(h(OverlayBanners, { snapshot, staleElapsedMs: staleSince === null ? 0 : Date.now() - staleSince }), options.bannerContainer);
    drawReadout();
  }

  // Row 35 / BENCH-P100-5: the axes that read inhibited on this link (reset per link epoch).
  let axisEpoch = -1;
  let axisSession: AxisModeSession = EMPTY_AXIS_MODE_SESSION;
  function axisModes(message: SnapshotMessage): ReturnType<typeof axisModeView> {
    if (message.snapshot.epoch !== axisEpoch) {
      axisEpoch = message.snapshot.epoch;
      axisSession = EMPTY_AXIS_MODE_SESSION;
    }
    const view = axisModeView({
      dialectId: message.snapshot.classification?.dialectId ?? null,
      reading: readout.phase.kind === 'reading',
      settings: readout.settings,
      machine: message.dro.axes,
      session: axisSession,
    });
    if (view.kind === 'facts') axisSession = view.session;
    return view;
  }

  function drawReadout(): void {
    const connected = droMessage !== null && droMessage.snapshot.base !== 'NOT_CONNECTED';
    render(
      connected
        ? h(
            'div',
            { class: 'live-readout' },
            h(Dro, { message: droMessage as SnapshotMessage, elapsedMs: performance.now() - droReceivedAt }),
            h(AxisModes, { view: axisModes(droMessage as SnapshotMessage) }),
            h(SettingsView, { dialectId: readout.dialectId, phase: readout.phase, settings: readout.settings, onKeep: () => void readout.keepBoardSettings().catch(() => undefined) }),
          )
        : null,
      droContainer,
    );
  }

  entry.subscribe(() => {
    options.stopControls.setLive(entry.state.step === 'live');
    draw();
  });
  draw();
  return entry;
}
