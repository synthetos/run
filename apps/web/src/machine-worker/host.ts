/**
 * What `machine.worker` does with each request (ROADMAP P0-14, P1-02;
 * RUN_PLAN §5.1 rule 1, §5.4). Kept apart from the worker entry so it is
 * unit-tested without a worker.
 *
 * The worker owns one read-only `MachineSession` (packages/machine), the
 * single writer. This file only translates requests into session calls and
 * session state into replies:
 * - `prepare` holds one unopened transport for at most 15 seconds. The window
 *   then confirms its original grant objects. A serial `open` needs that
 *   single-use preparation; it cannot enumerate and select a replacement.
 * - `open` connects the session to the port the window chose, through the
 *   build's transport source (transport.ts); the session opens it only
 *   through `GuardedTransport` and starts the probe with `{sr:null}`.
 *   On a mobile operating system (or ChromeOS, or an OS it cannot tell)
 *   `open` is refused before the transport source is asked, whatever
 *   `navigator.serial` offers (T-S77, RUN_PLAN §2.3). The window hides
 *   Connect there too; this is the check that does not depend on it.
 * - `close` is the session's Disconnect (decided by the allow-matrix).
 * - `intent` (Pause, Stop job, Spindle off, ackFault, acknowledge LOST) and
 *   `read` go straight to the session and are answered at once. No request
 *   ever waits behind another: a Pause is never queued behind an open or a
 *   close (SAFETY §4.4 step 1).
 * - `subscribe` keeps the reply port and posts the snapshot on it, at most
 *   once per `SNAPSHOT_INTERVAL_MS` (the last one is never dropped).
 *
 * Before every `open` the worker verifies the bundled, signed approved-builds
 * manifest for its own origin (approval.ts, P1-03) and the session classifies
 * against the result. Without a manifest, or when it does not verify, every
 * board is READ_ONLY.
 *
 * It holds no account or network state (DECISIONS D1).
 */
import { MachineSession, droView, lagThresholds, liveControlPlatform, type PortSelector, type Transport, type PlatformInfo, type SessionClock, type SessionSnapshot, type TransportSource } from '@synthetos/machine';
import { PHASE_1_RELEASE, type Decision, type Release } from '@synthetos/safety';
import { belowMinimum, type FirmwareReleases } from '@synthetos/protocol';
import { approvalRecord, approvedBuildsFor, extraApprovals, releasesFor, type ApprovalOutcome, type TrustedBuild } from './approval.ts';
import { FlashService, type FlashBackupsMessage, type FlashReply } from './flashService.ts';
import { RPC_VERSION, parseRequest, refusal, type Denial, type FlashBackupsPost, type FlashCommand, type JobCommand, type MachineReply, type MotionCommand, type SnapshotMessage, type WindowIntent, type WorkerState } from './rpc.ts';

/** Snapshots are posted at most 20 times per second (OLD-TP §4.2). */
export const SNAPSHOT_INTERVAL_MS = 50;

/** Where a subscriber's snapshots go (a MessagePort in the worker). */
export interface SnapshotPort {
  postMessage(message: SnapshotMessage): void;
}

/** The worker's clock: performance.now and the worker's own timers. */
export function realClock(): SessionClock {
  return {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
  };
}

/**
 * What the platform rule reads in the worker: `navigator.userAgent` only,
 * the one reviewed navigator property it needs (run/no-capability-lookup).
 * `userAgentData` and `maxTouchPoints` would also catch Android's "desktop
 * site" mode and a touch iPad; reading them is a gate change for review.
 */
export function workerPlatform(): PlatformInfo | undefined {
  return typeof navigator === 'undefined' ? undefined : { userAgent: navigator.userAgent };
}

interface PreparedPort {
  readonly id: number;
  readonly port: PortSelector;
  readonly transport: Transport;
  readonly expires: number;
}
const PREPARATION_MS = 15_000;

/** The signed approved-builds file the worker verifies before each connect, and the worker's origin. */
export interface WorkerApproval {
  readonly file: unknown;
  readonly origin: string;
  /** Tests only: verify with these instead of the compiled-in release keys. */
  readonly verify?: (file: unknown, origin: string, now: Date) => Promise<ApprovalOutcome>;
  /** The signed firmware release list, bundled (SAFETY §4.8 as amended 2026-11-03). */
  readonly releasesFile?: unknown;
  /** Tests only: the verified release list. */
  readonly releases?: (now: Date) => Promise<FirmwareReleases | null>;
}

/** Motion commands that are stop-class or recovery and never locked by the post-flash lock. */
const NEVER_LOCKED: ReadonlySet<MotionCommand['op']> = new Set(['jogRelease', 'spindleOff', 'coolantOff', 'clearAlarm', 'positionVerify']);

export class MachineWorkerHost {
  readonly #source: TransportSource;
  readonly #clock: SessionClock;
  readonly #session: MachineSession;
  readonly #platform: PlatformInfo | undefined;
  readonly #approval: WorkerApproval | null;
  readonly #release: Release;
  #preparationId = 0;
  #prepared: PreparedPort | null = null;
  #approved: PreparedPort | null = null;
  #subscriber: SnapshotPort | null = null;
  #lastPost = Number.NEGATIVE_INFINITY;
  #pending: number | null = null;
  #trusted: readonly TrustedBuild[] = [];
  /** Called whenever the firmware update changes (the stop service keeps the machine lock during it). */
  flashListener: (() => void) | null = null;
  #releases: FirmwareReleases | null = null;
  readonly #flash: FlashService;

  /** `platform` is the worker's user agent (`workerPlatform`) unless a test passes one. */
  /**
   * `release`: the session's release, from the motion capability flag and the settings-write switch
   * (motionFlag.ts `releaseFor`): Phase 2 with settings writes on the bench and staging origins,
   * `PHASE_1_RELEASE` everywhere else (and by default).
   */
  constructor(source: TransportSource, clock: SessionClock = realClock(), platform: PlatformInfo | undefined = workerPlatform(), approval: WorkerApproval | null = null, release: Release = PHASE_1_RELEASE) {
    this.#source = source;
    this.#release = release;
    this.#approval = approval;
    this.#clock = clock;
    this.#platform = platform;
    this.#session = new MachineSession({
      source: {
        kind: source.kind,
        request: async (selector) => {
          const approved = this.#approved;
          this.#approved = null;
          if (approved !== null) return clock.now() < approved.expires && JSON.stringify(approved.port) === JSON.stringify(selector) ? approved.transport : null;
          return source.kind === 'serial' ? null : source.request(selector);
        },
      },
      clock,
      release,
    });
    this.#flash = new FlashService({
      session: this.#session,
      source,
      clock,
      releases: () => this.#loadReleases(),
      enabled: release.flash === true,
      onChange: () => {
        this.flashListener?.();
        this.#schedule();
      },
      postBackups: (backups) => this.#postBackups(backups),
      approveTransport: (port, transport) => {
        this.#approved = { id: 0, port, transport, expires: clock.now() + PREPARATION_MS };
      },
    });
    void this.#loadReleases();
    // Push-driven state (SAFETY §4.2 as amended 2026-11-02): nothing here polls the board. The session reads the
    // full state once at connect, sets the status report list it needs, turns on the heartbeat, and from then on
    // the snapshot follows pushed reports.
    this.#session.subscribe(() => this.#schedule());
  }

  /** The release this worker enforces (tests). */
  get release(): Release {
    return this.#release;
  }

  /** The session (tests and the snapshot posting). */
  get session(): MachineSession {
    return this.#session;
  }

  /**
   * Answers one message. Never rejects: every failure is a refusal reply.
   * `port` is the reply port, kept for `subscribe`.
   */
  async handle(data: unknown, port?: SnapshotPort): Promise<MachineReply> {
    const request = parseRequest(data);
    if (request === null) return refusal('invalid', 'invalid-request', 'not a machine worker request');
    switch (request.kind) {
      case 'prepare': {
        const platform = liveControlPlatform(this.#platform);
        if (!platform.allowed) return refusal('prepare', 'platform', platform.reason);
        if (this.#session.snapshot.base !== 'NOT_CONNECTED') return refusal('prepare', 'unavailable', 'disconnect before choosing another port');
        const id = ++this.#preparationId;
        this.#prepared = null;
        const expires = this.#clock.now() + PREPARATION_MS;
        try {
          const transport = await this.#source.request(request.port);
          if (transport === null || id !== this.#preparationId || this.#clock.now() >= expires || this.#session.snapshot.base !== 'NOT_CONNECTED') return refusal('prepare', 'unavailable', 'the granted ports changed or the selection expired');
          this.#prepared = { id, port: request.port, transport, expires };
          return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'prepare', preparation: id });
        } catch {
          return refusal('prepare', 'unavailable', 'the granted ports could not be verified');
        }
      }
      case 'open': {
        const platform = liveControlPlatform(this.#platform);
        if (!platform.allowed) return refusal('open', 'platform', platform.reason);
        const prepared = this.#prepared;
        if (this.#source.kind === 'serial' || request.preparation !== undefined) {
          if (prepared === null || request.preparation !== prepared.id || this.#clock.now() >= prepared.expires || JSON.stringify(prepared.port) !== JSON.stringify(request.port)) return refusal('open', 'unavailable', 'no confirmed port selection');
          this.#prepared = null;
          this.#approved = prepared;
        }
        if (this.#flash.busy) return refusal('open', 'unavailable', 'A firmware update is using the port.');
        this.#trusted = request.trusted ?? [];
        await this.#loadApprovals();
        const outcome = await this.#session.connect(request.port, { expectedDeviceId: request.boardId, unknown: request.previousSessionEnded });
        if (this.#approved === prepared) this.#approved = null;
        if (outcome.ok) return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'open', info: outcome.info });
        if (outcome.code === 'denied') return denied('open', outcome.decision);
        return refusal('open', outcome.code, outcome.reason);
      }
      case 'close': {
        if (this.#flash.busy) return refusal('close', 'unavailable', 'A firmware update is using the port. Let it finish.');
        ++this.#preparationId;
        this.#prepared = null;
        this.#approved = null;
        const decision = await this.#session.disconnect();
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'close' }) : denied('close', decision);
      }
      case 'intent': {
        const decision = this.#intent(request.intent);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'intent' }) : denied('intent', decision);
      }
      case 'read': {
        const decision = this.#session.read(request.tokens);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'read' }) : denied('read', decision);
      }
      case 'settingWrite': {
        const locked = this.#locked('setting', { key: request.key, value: request.value });
        if (locked !== null) return locked;
        const decision = this.#session.writeSetting(request.key, request.value);
        if (!decision.allowed) return denied('settingWrite', decision);
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'settingWrite', id: this.#session.snapshot.settingWrite?.id ?? 0 });
      }
      case 'motion': {
        if (!NEVER_LOCKED.has(request.command.op)) {
          const locked = this.#locked('motion');
          if (locked !== null) return locked;
        }
        const decision = this.#motion(request.command);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'motion' }) : denied('motion', decision);
      }
      case 'job': {
        if (request.command.op !== 'breakpoints' && request.command.op !== 'lineModeMemory' && request.command.op !== 'unload') {
          const locked = this.#locked('job');
          if (locked !== null) return locked;
        }
        const decision = this.#job(request.command);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'job' }) : denied('job', decision);
      }
      case 'flash': {
        const reply = await this.#flashCommand(request.command);
        return reply.ok ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'flash' }) : refusal('flash', 'denied', reply.message);
      }
      case 'drift':
        if (request.resolved === true) this.#session.resolveDrift(request.epoch);
        else this.#session.reportDrift(request.epoch);
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'drift' });
      case 'subscribe':
        if (port === undefined) return refusal('subscribe', 'invalid-request', 'subscribe needs a reply port');
        this.#subscriber = port;
        this.#post();
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'subscribe' });
      case 'transcript': {
        const out = this.#session.exportTranscript();
        if (!out.ok) return refusal('transcript', 'unavailable', out.reason);
        const flash = this.#flash.flashTranscript();
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'transcript', jsonl: out.jsonl, events: out.events, ...(flash === null ? {} : { flash }) });
      }
      case 'status':
        return Object.freeze({
          v: RPC_VERSION,
          ok: true,
          kind: 'status',
          status: Object.freeze({ source: this.#source.kind, state: workerState(this.#session.snapshot), session: this.#session.snapshot }),
        });
    }
  }

  /** Verifies the signed manifest now (its validity window uses this clock) and hands it to the session. */
  async #loadApprovals(): Promise<void> {
    const approval = this.#approval;
    if (approval === null) return;
    const now = new Date();
    const outcome = await (approval.verify ?? ((file, origin, at) => approvedBuildsFor(file, { origin, now: at })))(approval.file, approval.origin, now).catch(() => null);
    if (outcome === null) return;
    const releases = await this.#loadReleases();
    const approved = extraApprovals(outcome.approved, { flasher: this.#release.flash === true, releases, simulated: this.#source.kind === 'fake', trusted: this.#trusted });
    this.#session.useApprovedBuilds(approved, `${approvalRecord(outcome)}; ${approved.builds.length - outcome.approved.builds.length} from the release list and trusted builds`);
  }

  /** This worker's verified release list (bundled; verified for its own origin, with its own clock). */
  async #loadReleases(): Promise<FirmwareReleases | null> {
    const approval = this.#approval;
    if (approval === null) return null;
    const now = new Date();
    const releases = approval.releases !== undefined ? await approval.releases(now).catch(() => null) : approval.releasesFile === undefined ? null : await releasesFor(approval.releasesFile, approval.origin, now);
    this.#releases = releases;
    return releases;
  }

  /** The old-firmware gate: a board below the signed list's minimum build for its hardware (WORKSPACE_FEATURES). */
  #oldFirmware(): { fb: number; minimumFb: number } | null {
    const id = this.#session.snapshot.identity;
    if (id === null || typeof id.fb !== 'number' || typeof id.hv !== 'number') return null;
    const gate = belowMinimum(this.#releases, id.hv, id.fb);
    return gate.below && gate.minimumFb !== null ? { fb: id.fb, minimumFb: gate.minimumFb } : null;
  }

  /** A refusal when the post-flash lock or the old-firmware gate holds this request back, else null. */
  #locked(kind: 'motion' | 'job' | 'setting', setting?: { readonly key: string; readonly value: number }): MachineReply | null {
    const old = this.#oldFirmware();
    if (old !== null) return refusal(kind === 'setting' ? 'settingWrite' : kind, 'denied', `This board runs firmware ${old.fb.toFixed(2)}, older than the minimum ${old.minimumFb.toFixed(2)} for its hardware. Update it first: jobs, jogging and settings changes stay locked until then.`);
    const why = this.#flash.lockReason(kind, setting);
    return why === null ? null : refusal(kind === 'setting' ? 'settingWrite' : kind, 'denied', why);
  }

  #flashCommand(c: FlashCommand): Promise<FlashReply> | FlashReply {
    switch (c.op) {
      case 'begin':
        return this.#flash.begin({ source: c.source, hex: c.hex, sha256: c.sha256, settingsBackup: c.settingsBackup, baseline: c.baseline, recovery: c.recovery });
      case 'backupsSaved':
        return this.#flash.backupsSaved(c.sha256);
      case 'cancel':
        return this.#flash.cancel();
      case 'recover':
        return this.#flash.recover();
      case 'reconnect':
        return this.#flash.reconnect();
      case 'compare':
        return this.#flash.compare();
      case 'switchCheckDone':
        return this.#flash.switchCheckDone();
      case 'dismiss':
        return this.#flash.dismiss();
      case 'lock':
        this.#flash.restoreLock(c.boardId, c.baseline);
        return { ok: true };
    }
  }

  #postBackups(backups: FlashBackupsMessage): void {
    try {
      // The same reply port as the snapshots; the page tells the two apart by `kind`.
      const post: FlashBackupsPost = Object.freeze({ v: RPC_VERSION, kind: 'flashBackups', backups });
      (this.#subscriber as unknown as { postMessage(m: FlashBackupsPost): void } | null)?.postMessage(post);
    } catch {
      this.#subscriber = null;
    }
  }

  /** The flash service (tests). */
  get flash(): FlashService {
    return this.#flash;
  }

  #intent(intent: WindowIntent): Decision {
    switch (intent) {
      case 'feedhold':
        return this.#session.feedhold();
      case 'stopJob':
        return this.#session.stopJob();
      case 'spindleOffNow':
        return this.#session.spindleOffNow();
      case 'ackFault':
        return this.#session.ackFault();
      case 'acknowledgeLost':
        return this.#session.acknowledgeLost();
    }
  }

  /** A Phase 2 motion command, as the session intent it is (SAFETY §4.5b). The session decides it. */
  #motion(c: MotionCommand): Decision {
    const s = this.#session;
    switch (c.op) {
      case 'jog':
        return s.request({ intent: 'jog', axes: c.axes, distanceMm: c.distanceMm, feed: c.feed });
      case 'jogRenew':
        return s.request({ intent: 'jog', renew: true });
      case 'jogRelease':
        return s.request({ intent: 'feedhold', release: true });
      case 'goToZero':
        return s.request({ intent: 'goToZero', axes: c.axes, safeZ: c.safeZ });
      case 'setZero':
        return s.request({ intent: 'setWorkZero', axes: c.axes });
      case 'home':
        return s.request({ intent: 'home', axes: c.axes });
      case 'setPosition':
        return s.request({ intent: 'setMachinePosition', axes: c.axes });
      case 'tempOffset':
        return s.request({ intent: 'tempOffset', axes: c.axes });
      case 'clearTempOffset':
        return s.request({ intent: 'tempOffset', clear: true });
      case 'selectCoord':
        return s.request({ intent: 'selectCoordSystem', system: c.system });
      case 'spindleOn':
        return s.request({ intent: 'spindleOn', output: 'spindle', direction: c.direction, rpm: c.rpm });
      case 'coolantOn':
        return s.request({ intent: 'spindleOn', output: c.which });
      case 'typedMove':
        return s.request({ intent: 'typedMove', line: c.line, travel: c.travel, lowZ: c.lowZ });
      // Probe Z (SAFETY §4.5c): each decided again by the session.
      case 'probeTouch':
        return s.request({ intent: 'probeZ', step: 'touch', thicknessMm: c.thicknessMm, depthMm: c.depthMm, feed: c.feed });
      case 'probeStart':
        return s.request({ intent: 'probeZ', step: 'start', confirm: c.confirm });
      case 'probeRetest':
        return s.request({ intent: 'probeZ', step: 'retest' });
      case 'probeCancel':
        return s.request({ intent: 'probeZClose', step: 'cancel' });
      case 'probePlateOff':
        return s.request({ intent: 'probeZClose', step: 'plateOff' });
      case 'spindleOff':
        return s.request({ intent: 'spindleOffNow', outputs: 'spindle' });
      case 'coolantOff':
        return s.request({ intent: 'spindleOffNow', outputs: 'coolant' });
      case 'resume':
        return s.request({ intent: 'resume' });
      case 'clearAlarm':
        return s.request({ intent: 'clearAlarm' });
      case 'positionVerify':
        return s.request({ intent: 'positionVerify' });
    }
  }

  /** A Phase 3 job command, as the session call it is (SAFETY §4.4a). The session decides it. */
  #job(c: JobCommand): Decision {
    const s = this.#session;
    switch (c.op) {
      case 'load':
        return s.loadJob({ name: c.name, text: c.text, c22: c.c22 });
      case 'unload':
        return s.loadJob(null);
      case 'start':
        return s.startJob(c.breakpoints, c.confirm);
      case 'resume':
        return s.request({ intent: 'resume', skip: c.skip, spindleRestart: c.spindleRestart });
      case 'breakpoints':
        return s.setBreakpoints(c.lines);
      case 'lineModeMemory':
        s.rememberLineMode(c.epoch, c.remembered);
        return { allowed: true };
    }
  }

  /** Posts now if the interval has passed, otherwise once at its end (with the snapshot current then). */
  #schedule(): void {
    if (this.#subscriber === null || this.#pending !== null) return;
    const wait = this.#lastPost + SNAPSHOT_INTERVAL_MS - this.#clock.now();
    if (wait <= 0) {
      this.#post();
      return;
    }
    this.#pending = this.#clock.setTimeout(() => {
      this.#pending = null;
      this.#post();
    }, wait);
  }

  #post(): void {
    if (this.#pending !== null) {
      this.#clock.clearTimeout(this.#pending);
      this.#pending = null;
    }
    this.#lastPost = this.#clock.now();
    try {
      const snapshot = this.#session.snapshot;
      const now = this.#clock.now();
      const job = snapshot.job;
      const jobElapsedMs = job === null || job.startedAt === null ? null : Math.max(0, (job.endedAt ?? now) - job.startedAt);
      this.#subscriber?.postMessage(
        Object.freeze({
          v: RPC_VERSION,
          kind: 'snapshot',
          snapshot,
          dro: droView(snapshot, now),
          lag: Object.freeze(lagThresholds(snapshot)),
          motion: this.#release.motion,
          settingsWrites: this.#release.settings === true,
          jobs: this.#release.jobs === true,
          jobElapsedMs,
          flasher: this.#release.flash === true,
          flash: this.#flash.view,
          postFlash: this.#flash.postFlash,
          oldFirmware: snapshot.base === 'NOT_CONNECTED' ? null : this.#oldFirmware(),
          simulated: this.#source.kind === 'fake',
        }),
      );
    } catch {
      // A closed port: the window went away. Nothing in the machine path depends on it.
      this.#subscriber = null;
    }
  }
}

function denied(kind: 'open' | 'close' | 'intent' | 'read' | 'motion' | 'settingWrite' | 'job' | 'flash', decision: Denial): MachineReply {
  return refusal(kind, 'denied', decision.reason, decision);
}

/** The Phase 0 link words, from the session snapshot. */
export function workerState(snapshot: SessionSnapshot): WorkerState {
  if (snapshot.overlays.includes('LOST')) return 'lost';
  if (snapshot.base === 'NOT_CONNECTED') return 'idle';
  if (snapshot.base === 'PORT_REQUEST' || snapshot.base === 'OPENING') return 'opening';
  return 'open';
}
