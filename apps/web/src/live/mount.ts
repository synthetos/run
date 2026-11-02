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
import { OverlayBanners } from '../machine-ui/OverlayBanners.ts';
import { callMachineWorker } from '../machine-worker/client.ts';
import { RPC_VERSION, type SnapshotMessage, type WorkerStatus } from '../machine-worker/rpc.ts';
import { AdvisoryPoller, checkAdvisory, type AdvisoryCheck, type AdvisoryDeps } from './advisoryGate.ts';
import { accessProvider, AuthGate, providersFor } from './authGate.ts';
import { ConnectPanel } from './ConnectPanel.ts';
import { memoryDeviceSafety, openDeviceSafety, type DeviceSafetyStore } from './deviceSafety.ts';
import { leaveFullscreen } from './fullscreen.ts';
import { LiveEntry, type ChooseResult } from './liveEntry.ts';
import { cleanDisconnect, installLiveLifecycle, previousSessionEnded } from './liveMarker.ts';

/**
 * The port chooser. `requestPort()` may run only in the Web Serial module,
 * and the main-thread chooser needs its own reviewed gate change (OD-3 in
 * docs/ops/owner-decisions.md), so this build has none: LIVE entry stops
 * here, after every gate has passed.
 */
function noChooser(): Promise<ChooseResult> {
  return Promise.resolve({ ok: false, message: 'This build has no port chooser yet: the main-thread chooser needs its own reviewed gate change (OD-3).' });
}

export interface MountOptions {
  readonly channel: BuildChannel;
  readonly appSha: string;
  readonly worker: Worker | null;
  readonly container: HTMLElement;
  readonly bannerContainer: HTMLElement;
  readonly previousSession: Signal<boolean>;
}

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
    choosePort: noChooser,
    open: async (port) => {
      if (worker === null) return { ok: false, message: 'The machine worker is not running in this browser.' };
      const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'open', port, boardId: null });
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
  if (worker !== null) {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = event.data as SnapshotMessage | { kind?: unknown };
      if (message.kind !== 'snapshot') return;
      snapshot = (message as SnapshotMessage).snapshot;
      staleSince = snapshot.overlays.includes('STALE') ? (staleSince ?? Date.now()) : null;
      alarm.sync(snapshot);
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
  }

  entry.subscribe(draw);
  draw();
  return entry;
}
