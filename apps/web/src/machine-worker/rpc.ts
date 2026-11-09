/**
 * The messages between the main thread and `machine.worker` (ROADMAP P0-14,
 * P1-02; RUN_PLAN §5.4).
 *
 * Every request is a structured-clone message posted to the worker with a
 * `MessagePort` in `ports[0]`; the worker answers on that port. A reply port
 * per request keeps answers matched to questions without ids and lets a
 * caller await one answer. `subscribe` keeps its port: the worker posts the
 * session snapshot on it (at most 20 per second, OLD-TP §4.2) until another
 * `subscribe` replaces it.
 *
 * Requests are parsed strictly: a plain object with exactly the keys its
 * kind allows, `v === RPC_VERSION`, and a known `kind`. Anything else is
 * answered with an `invalid-request` refusal and does nothing.
 *
 * Version 3 (P1-02): `open` starts the read-only `MachineSession` (it
 * writes `{sr:null}` and the probe GETs, nothing else), `close` is the
 * session's Disconnect, `status` carries the session snapshot, and
 * `intent`, `read` and `subscribe` are new. Every intent is decided by the
 * session through the allow-matrix; a refusal comes back with the matrix's
 * `{reason, remedy, citation}`.
 *
 * `prepare` (additive): holds an unopened transport and returns a short-lived,
 * single-use ticket. Serial `open` requires that ticket, after the window
 * confirms its original grant objects. There is no re-enumeration on open.
 *
 * `transcript` (P1-08, additive) answers with the session's wire transcript
 * (`{t, dir, hex}` JSONL) of the last link that opened, for bench runs. It
 * only reads; it never touches the port.
 *
 * D1 (sign-in required to connect and start): the sign-in gate lives in the
 * main-thread UI. Nothing in this protocol carries, and nothing in the
 * worker consults, a session or an account (DECISIONS D1 safety condition).
 */
import { isPortSelector, type DroView, type PortSelector, type SessionSnapshot, type TransportInfo, type TransportSource } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import { MAX_TRUSTED_BUILDS, parseTrustedBuild, type TrustedBuild } from './approval.ts';
import type { FlashBackupsMessage, FlashSourceRequest, FlashView, PostFlashView } from './flashService.ts';

export const RPC_VERSION = 3;

export const REQUEST_KINDS = ['prepare', 'open', 'close', 'status', 'intent', 'read', 'subscribe', 'transcript', 'drift', 'motion', 'settingWrite', 'job', 'flash'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Intents the window may send. Everything else the session does on its own. */
export const WINDOW_INTENTS = ['feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost'] as const;
export type WindowIntent = (typeof WINDOW_INTENTS)[number];

/** Axes a motion command may name (SAFETY §4.5b). */
export const MOTION_AXES = ['x', 'y', 'z', 'a'] as const;
export type MotionAxis = (typeof MOTION_AXES)[number];

/**
 * Phase 2 motion commands (additive; owner 2026-11-02, SAFETY §4.5b). The worker hands each to the session,
 * which decides it through the allow-matrix and the motion preconditions; under a release without motion
 * every one is denied. `jogRelease`, `spindleOff` and `coolantOff` are stop-class and never gated.
 */
export type MotionCommand =
  | { readonly op: 'jog'; readonly axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>; readonly distanceMm: number | null; readonly feed: number }
  | { readonly op: 'jogRenew' | 'jogRelease' | 'spindleOff' | 'coolantOff' | 'resume' | 'clearAlarm' | 'positionVerify' }
  | { readonly op: 'goToZero'; readonly axes: readonly MotionAxis[]; readonly safeZ: number }
  | { readonly op: 'setZero'; readonly axes: readonly MotionAxis[] }
  /** Amendment 2026-11-02: G28.2 homing, G28.3 set machine position, G92 / G92.1 temporary offset, G54..G59. */
  | { readonly op: 'home' | 'setPosition' | 'tempOffset'; readonly axes: readonly MotionAxis[] }
  | { readonly op: 'clearTempOffset' }
  | { readonly op: 'selectCoord'; readonly system: number }
  | { readonly op: 'spindleOn'; readonly direction: 'cw' | 'ccw'; readonly rpm: number }
  | { readonly op: 'coolantOn'; readonly which: 'mist' | 'flood' }
  /** Probe Z (SAFETY §4.5c, H90): start the touch test with the owner's plan; start the probe after C39 (the session uses the plan it holds); and the steps around it. */
  | { readonly op: 'probeTouch'; readonly thicknessMm: number; readonly depthMm: number; readonly feed: number }
  | { readonly op: 'probeStart'; readonly confirm: true }
  | { readonly op: 'probeRetest' | 'probeCancel' | 'probePlateOff' };

/**
 * Phase 3 job commands (additive; owner 2026-11-02, SAFETY §4.4a). The worker hands each to the session, which
 * decides it through the allow-matrix (the `jobs` kind, on only with the jobs release) and the job's own checks.
 * Pause and Stop job are the window intents (`feedhold`, `stopJob`): never gated, never here.
 * - `load`: the file text, sanitised in the worker with the live board's values; `null` text unloads.
 * - `start`: the page's breakpoints and confirmations (C36 unhomed, C31 work zero, C32 spindle).
 * - `resume`: after a pause, a stop point, a refused line (`skip`, C33) or a tool change (`spindleRestart`, C35).
 * - `breakpoints`: the G-code list's breakpoints, any time.
 * - `lineModeMemory`: what this computer remembers of the board's `rxm` (H77), for link `epoch`.
 */
export type JobCommand =
  | { readonly op: 'load'; readonly name: string; readonly text: string; readonly c22: boolean }
  | { readonly op: 'unload' }
  | { readonly op: 'start'; readonly breakpoints: readonly number[]; readonly confirm: { readonly unhomed: boolean; readonly workZero: boolean; readonly spindle: boolean; readonly travel: string | null } }
  | { readonly op: 'resume'; readonly skip: boolean; readonly spindleRestart: boolean }
  | { readonly op: 'breakpoints'; readonly lines: readonly number[] }
  | { readonly op: 'lineModeMemory'; readonly epoch: number; readonly remembered: 0 | 1 | null };

/**
 * The firmware update (SAFETY §4.8 as amended 2026-11-03; additive). The worker's flash service decides every one:
 * - `begin`: the image text and what it is (a signed release by hv/fb/file, a firmware backup of this board, or
 *   confirmed custom firmware), with the settings backup's tokens as the post-flash baseline;
 * - `backupsSaved`: the page stored the backups the worker posted (`flashBackups`), with the image backup's SHA-256;
 * - `cancel` (before the first page only), `recover` (the same image through the reset window), `reconnect`,
 *   `compare` (the live settings against the baseline), `switchCheckDone`, `dismiss`;
 * - `lock`: the page remembers an unfinished update of this board (a reload): the worker re-arms its lock.
 */
export type FlashCommand =
  | {
      readonly op: 'begin';
      readonly source: FlashSourceRequest;
      readonly hex: string;
      readonly sha256: string;
      readonly settingsBackup: 'saved' | 'unreadable';
      readonly baseline: Readonly<Record<string, number | string>> | null;
      readonly recovery: boolean;
    }
  | { readonly op: 'backupsSaved'; readonly sha256: string }
  | { readonly op: 'cancel' | 'recover' | 'reconnect' | 'compare' | 'switchCheckDone' | 'dismiss' }
  | { readonly op: 'lock'; readonly boardId: string; readonly baseline: Readonly<Record<string, number | string>> };

/** Largest `.hex` text, and most baseline tokens, the window may send. */
export const MAX_HEX_TEXT = 2 * 1024 * 1024;
export const MAX_BASELINE_TOKENS = 1000;

/** Largest job text the window may send (RUN_PLAN §4: 50 MB), and most breakpoints. */
export const MAX_JOB_TEXT = 50 * 1024 * 1024;
export const MAX_JOB_NAME = 200;
export const MAX_BREAKPOINTS = 1000;

/** Most tokens one `read` may name, and the longest token. */
export const MAX_READ_TOKENS = 32;
export const MAX_TOKEN_LENGTH = 16;
/** Longest board id the window may name as the selected machine's. */
export const MAX_BOARD_ID_LENGTH = 64;

export type MachineRequest =
  | { readonly v: typeof RPC_VERSION; readonly kind: 'prepare'; readonly port: PortSelector }
  /** `previousSessionEnded`: a reload or discard ended a LIVE session (W6), so the connect starts UNKNOWN (SAFETY §3). */
  | {
      readonly v: typeof RPC_VERSION;
      readonly kind: 'open';
      readonly port: PortSelector;
      readonly preparation?: number;
      readonly boardId: string | null;
      readonly previousSessionEnded: boolean;
      /** Custom builds the user trusted, each for one board (SAFETY H87; the page's device-safety records). */
      readonly trusted?: readonly TrustedBuild[];
    }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'close' | 'status' | 'subscribe' | 'transcript' }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'intent'; readonly intent: WindowIntent }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'read'; readonly tokens: readonly string[] }
  /** P1-07: the window's settings drift check found a difference on link `epoch` (NEEDS_REVIEW; it can only add the overlay). */
  | { readonly v: typeof RPC_VERSION; readonly kind: 'drift'; readonly epoch: number; readonly resolved?: true }
  /**
   * One settings write (SAFETY §4.6, amendment 2026-11-02; additive). The session decides it (the settings
   * release, the allow-matrix, the schema, the idle gate) and reports the result in `snapshot.settingWrite`
   * under the id the reply carries.
   */
  | { readonly v: typeof RPC_VERSION; readonly kind: 'settingWrite'; readonly key: string; readonly value: number }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'motion'; readonly command: MotionCommand }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'job'; readonly command: JobCommand }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'flash'; readonly command: FlashCommand };

/** The link, in the words of the Phase 0 protocol: derived from the session's base state and LOST. */
export type WorkerState = 'idle' | 'opening' | 'open' | 'lost';

export interface WorkerStatus {
  /** Which transport source this build has (`none` in a production build). */
  readonly source: TransportSource['kind'];
  readonly state: WorkerState;
  readonly session: SessionSnapshot;
}

export type RefusalCode =
  /** The message was not a valid request. */
  | 'invalid-request'
  /** This build has no transport, or no port was chosen. */
  | 'unavailable'
  /** The session (through the allow-matrix) refused the request. */
  | 'denied'
  /** The guard or the port refused the open. */
  | 'open-failed'
  /** Live control is not offered on this operating system (mobile, ChromeOS, unknown; T-S77). */
  | 'platform';

export type Denial = Extract<Decision, { allowed: false }>;

export type MachineReply =
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'prepare'; readonly preparation: number }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'open'; readonly info: TransportInfo }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'close' | 'subscribe' | 'intent' | 'read' | 'drift' | 'motion' | 'job' | 'flash' }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'status'; readonly status: WorkerStatus }
  /** The settings write was accepted; its result appears in `snapshot.settingWrite` with this id. */
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'settingWrite'; readonly id: number }
  /** The wire transcript of the last link that opened, as `{t, dir, hex}` JSONL (P1-08). */
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'transcript'; readonly jsonl: string; readonly events: number }
  | {
      readonly v: typeof RPC_VERSION;
      readonly ok: false;
      readonly kind: RequestKind | 'invalid';
      readonly code: RefusalCode;
      readonly message: string;
      /** For `denied`: the allow-matrix decision, shown verbatim by the UI. */
      readonly decision?: Denial;
    };

/** What the worker posts on a subscribed port. */
export interface SnapshotMessage {
  readonly v: typeof RPC_VERSION;
  readonly kind: 'snapshot';
  readonly snapshot: SessionSnapshot;
  /**
   * P1-07: the DRO view of this snapshot, computed in the worker at post
   * time (ages are on the worker's clock; the window adds the time since it
   * received the message), with the lag thresholds it was computed with.
   */
  readonly dro: DroView;
  readonly lag: { readonly amberMs: number; readonly redMs: number };
  /** The settings-write phase switch is on in this worker (bench and staging; never production). */
  readonly settingsWrites?: boolean;
  /** The motion capability flag of this worker (Phase 2: bench and staging origins only, SAFETY §4.5b). */
  readonly motion: boolean;
  /** The jobs phase switch of this worker (Phase 3: bench and staging only, never production). */
  readonly jobs?: boolean;
  /** Time since the job started (or its run time once ended), ms on the worker's clock at post time; null without one. */
  readonly jobElapsedMs?: number | null;
  /** The flasher phase switch of this worker (bench and staging only, never production). */
  readonly flasher?: boolean;
  /** The firmware update in progress or just finished, or null. */
  readonly flash?: FlashView | null;
  /** The post-flash lock of the connected board, or null. */
  readonly postFlash?: PostFlashView | null;
  /** The old-firmware gate: the board's build is below the signed list's minimum for its hardware. */
  readonly oldFirmware?: { readonly fb: number; readonly minimumFb: number } | null;
  /** The port is the test kit's simulated board (fake-serial builds only). */
  readonly simulated?: boolean;
}

/** Posted once on the subscribed port during an update: the backups the page must store before anything is written. */
export interface FlashBackupsPost {
  readonly v: typeof RPC_VERSION;
  readonly kind: 'flashBackups';
  readonly backups: FlashBackupsMessage;
}

function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value);
}

function isWindowIntent(value: unknown): value is WindowIntent {
  return typeof value === 'string' && (WINDOW_INTENTS as readonly string[]).includes(value);
}

const OPEN_KEYS: ReadonlySet<string> = new Set(['kind,port,v', 'boardId,kind,port,v', 'kind,port,previousSessionEnded,v', 'boardId,kind,port,previousSessionEnded,v']);

function parseTrusted(value: unknown): readonly TrustedBuild[] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_TRUSTED_BUILDS) return null;
  const out: TrustedBuild[] = [];
  for (const v of value as unknown[]) {
    const t = parseTrustedBuild(v);
    if (t === null) return null;
    out.push(t);
  }
  return Object.freeze(out);
}

/** The request in `data`, or null when it is not exactly a valid request. */
export function parseRequest(data: unknown): MachineRequest | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.getPrototypeOf(data) !== Object.prototype) return null;
  const keys = Object.keys(data).sort().join(',');
  const { v, kind, port, boardId, previousSessionEnded, intent, tokens, epoch, preparation, command, key, value, trusted } = data as Record<string, unknown>;
  if (v !== RPC_VERSION || !isRequestKind(kind)) return null;
  switch (kind) {
    case 'prepare':
      if (keys !== 'kind,port,v' || !isPortSelector(port)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, port: copySelector(port) });
    case 'open': {
      if (!OPEN_KEYS.has(Object.keys(data).filter((key) => key !== 'preparation' && key !== 'trusted').sort().join(',')) || !isPortSelector(port)) return null;
      const trustedBuilds = parseTrusted(trusted);
      if (trustedBuilds === null) return null;
      const id = boardId ?? null;
      if (id !== null && (typeof id !== 'string' || id.length === 0 || id.length > MAX_BOARD_ID_LENGTH)) return null;
      if (previousSessionEnded !== undefined && typeof previousSessionEnded !== 'boolean') return null;
      if ('preparation' in data && (typeof preparation !== 'number' || !Number.isSafeInteger(preparation) || preparation < 1)) return null;
      const selector = copySelector(port);
      return Object.freeze({
        v: RPC_VERSION,
        kind,
        port: selector,
        ...(preparation === undefined ? {} : { preparation: preparation as number }),
        boardId: id,
        previousSessionEnded: previousSessionEnded === true,
        ...(trustedBuilds.length === 0 ? {} : { trusted: trustedBuilds }),
      });
    }
    case 'intent':
      if (keys !== 'intent,kind,v' || !isWindowIntent(intent)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, intent });
    case 'read': {
      if (keys !== 'kind,tokens,v' || !Array.isArray(tokens) || Object.getPrototypeOf(tokens) !== Array.prototype) return null;
      const list: unknown[] = tokens;
      if (list.length === 0 || list.length > MAX_READ_TOKENS) return null;
      if (!list.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TOKEN_LENGTH)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, tokens: Object.freeze([...(list as string[])]) });
    }
    case 'settingWrite':
      if (keys !== 'key,kind,v,value' || typeof key !== 'string' || key.length === 0 || key.length > MAX_TOKEN_LENGTH) return null;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, key, value });
    case 'motion': {
      if (keys !== 'command,kind,v') return null;
      const parsed = parseMotionCommand(command);
      return parsed === null ? null : Object.freeze({ v: RPC_VERSION, kind, command: parsed });
    }
    case 'job': {
      if (keys !== 'command,kind,v') return null;
      const parsed = parseJobCommand(command);
      return parsed === null ? null : Object.freeze({ v: RPC_VERSION, kind, command: parsed });
    }
    case 'flash': {
      if (keys !== 'command,kind,v') return null;
      const parsed = parseFlashCommand(command);
      return parsed === null ? null : Object.freeze({ v: RPC_VERSION, kind, command: parsed });
    }
    case 'drift': {
      // `resolved: true` is "Keep the board's settings" (C23): the review is done for this link (OD-13 §5).
      const resolved = (data as Record<string, unknown>)['resolved'];
      if ((keys !== 'epoch,kind,v' && (keys !== 'epoch,kind,resolved,v' || resolved !== true)) || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return null;
      return Object.freeze({ v: RPC_VERSION, kind, epoch, ...(resolved === true ? { resolved: true as const } : {}) });
    }
    default:
      if (keys !== 'kind,v') return null;
      return Object.freeze({ v: RPC_VERSION, kind });
  }
}

/** A refusal reply. */
export function refusal(kind: RequestKind | 'invalid', code: RefusalCode, message: string, decision?: Denial): MachineReply {
  return Object.freeze({ v: RPC_VERSION, ok: false, kind, code, message, ...(decision === undefined ? {} : { decision: Object.freeze({ ...decision }) }) });
}

/** Copy untrusted message arrays: callers cannot mutate a prepared selection. */
function copySelector(port: PortSelector): PortSelector {
  return Object.freeze({
    usbVendorId: port.usbVendorId,
    usbProductId: port.usbProductId,
    grantIndex: port.grantIndex,
    ...(port.grantSnapshot === undefined ? {} : { grantSnapshot: Object.freeze([...port.grantSnapshot]) }),
  });
}

function plainKeys(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  return Object.keys(value).sort().join(',');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function axisList(value: unknown): readonly MotionAxis[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0 || value.length > MOTION_AXES.length) return null;
  const list: unknown[] = value;
  if (!list.every((a) => typeof a === 'string' && (MOTION_AXES as readonly string[]).includes(a)) || new Set(list).size !== list.length) return null;
  return Object.freeze([...(list as MotionAxis[])]);
}

/** A motion command, strictly: exactly its keys, known values, finite numbers. Ranges are the session's. */
export function parseMotionCommand(value: unknown): MotionCommand | null {
  const keys = plainKeys(value);
  if (keys === null) return null;
  const c = value as Record<string, unknown>;
  switch (c['op']) {
    case 'jog': {
      if (keys !== 'axes,distanceMm,feed,op' || !finite(c['feed']) || (c['distanceMm'] !== null && !finite(c['distanceMm']))) return null;
      const axesKeys = plainKeys(c['axes']);
      if (axesKeys === null || axesKeys === '') return null;
      const axes = c['axes'] as Record<string, unknown>;
      const out: Partial<Record<MotionAxis, 1 | -1>> = {};
      for (const [k, d] of Object.entries(axes)) {
        if (!(MOTION_AXES as readonly string[]).includes(k) || (d !== 1 && d !== -1)) return null;
        out[k as MotionAxis] = d;
      }
      return Object.freeze({ op: 'jog', axes: Object.freeze(out), distanceMm: c['distanceMm'] as number | null, feed: c['feed'] });
    }
    case 'jogRenew':
    case 'jogRelease':
    case 'spindleOff':
    case 'coolantOff':
    case 'resume':
    case 'clearAlarm':
    case 'positionVerify':
    case 'clearTempOffset':
      return keys === 'op' ? Object.freeze({ op: c['op'] }) : null;
    case 'home':
    case 'setPosition':
    case 'tempOffset': {
      const axes = axisList(c['axes']);
      return keys === 'axes,op' && axes !== null ? Object.freeze({ op: c['op'], axes }) : null;
    }
    case 'selectCoord':
      if (keys !== 'op,system' || typeof c['system'] !== 'number' || !Number.isInteger(c['system']) || c['system'] < 1 || c['system'] > 6) return null;
      return Object.freeze({ op: 'selectCoord', system: c['system'] });
    case 'goToZero': {
      const axes = axisList(c['axes']);
      if (keys !== 'axes,op,safeZ' || axes === null || !finite(c['safeZ'])) return null;
      return Object.freeze({ op: 'goToZero', axes, safeZ: c['safeZ'] });
    }
    case 'setZero': {
      const axes = axisList(c['axes']);
      return keys === 'axes,op' && axes !== null ? Object.freeze({ op: 'setZero', axes }) : null;
    }
    case 'spindleOn':
      if (keys !== 'direction,op,rpm' || (c['direction'] !== 'cw' && c['direction'] !== 'ccw') || !finite(c['rpm'])) return null;
      return Object.freeze({ op: 'spindleOn', direction: c['direction'], rpm: c['rpm'] });
    case 'coolantOn':
      if (keys !== 'op,which' || (c['which'] !== 'mist' && c['which'] !== 'flood')) return null;
      return Object.freeze({ op: 'coolantOn', which: c['which'] });
    // Probe Z (SAFETY §4.5c): the plan is mm and mm/min; the session checks every limit.
    case 'probeTouch':
      if (keys !== 'depthMm,feed,op,thicknessMm' || !finite(c['thicknessMm']) || !finite(c['depthMm']) || !finite(c['feed'])) return null;
      return Object.freeze({ op: 'probeTouch', thicknessMm: c['thicknessMm'], depthMm: c['depthMm'], feed: c['feed'] });
    case 'probeStart':
      return keys === 'confirm,op' && c['confirm'] === true ? Object.freeze({ op: 'probeStart', confirm: true }) : null;
    case 'probeRetest':
    case 'probeCancel':
    case 'probePlateOff':
      return keys === 'op' ? Object.freeze({ op: c['op'] }) : null;
    default:
      return null;
  }
}

function lineList(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_BREAKPOINTS) return null;
  const list: unknown[] = value;
  if (!list.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1)) return null;
  return Object.freeze([...(list as number[])]);
}

/** A job command, strictly: exactly its keys, known values. The session checks the rest. */
export function parseJobCommand(value: unknown): JobCommand | null {
  const keys = plainKeys(value);
  if (keys === null) return null;
  const c = value as Record<string, unknown>;
  switch (c['op']) {
    case 'load': {
      const { name, text, c22 } = c;
      if (keys !== 'c22,name,op,text' || typeof name !== 'string' || name.length === 0 || name.length > MAX_JOB_NAME) return null;
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_JOB_TEXT || typeof c22 !== 'boolean') return null;
      return Object.freeze({ op: 'load', name, text, c22 });
    }
    case 'unload':
      return keys === 'op' ? Object.freeze({ op: 'unload' }) : null;
    case 'start': {
      const breakpoints = lineList(c['breakpoints']);
      const confirm = c['confirm'];
      if (keys !== 'breakpoints,confirm,op' || breakpoints === null || plainKeys(confirm) !== 'spindle,travel,unhomed,workZero') return null;
      const f = confirm as Record<string, unknown>;
      if (typeof f['unhomed'] !== 'boolean' || typeof f['workZero'] !== 'boolean' || typeof f['spindle'] !== 'boolean' || !(f['travel'] === null || (typeof f['travel'] === 'string' && f['travel'].length <= 600))) return null;
      return Object.freeze({ op: 'start', breakpoints, confirm: Object.freeze({ unhomed: f['unhomed'], workZero: f['workZero'], spindle: f['spindle'], travel: f['travel'] }) });
    }
    case 'resume':
      if (keys !== 'op,skip,spindleRestart' || typeof c['skip'] !== 'boolean' || typeof c['spindleRestart'] !== 'boolean') return null;
      return Object.freeze({ op: 'resume', skip: c['skip'], spindleRestart: c['spindleRestart'] });
    case 'breakpoints': {
      const lines = lineList(c['lines']);
      return keys === 'lines,op' && lines !== null ? Object.freeze({ op: 'breakpoints', lines }) : null;
    }
    case 'lineModeMemory': {
      const { epoch, remembered } = c;
      if (keys !== 'epoch,op,remembered' || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return null;
      if (remembered !== null && remembered !== 0 && remembered !== 1) return null;
      return Object.freeze({ op: 'lineModeMemory', epoch, remembered });
    }
    default:
      return null;
  }
}

function parseBaseline(value: unknown): Readonly<Record<string, number | string>> | null {
  if (plainKeys(value) === null) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_BASELINE_TOKENS) return null;
  const out: Record<string, number | string> = {};
  for (const [k, v] of entries) {
    if (!/^[a-z0-9_]{1,8}$/.test(k)) return null;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      out[k] = v;
    } else if (typeof v === 'string' && v.length <= 64) out[k] = v;
    else return null;
  }
  return Object.freeze(out);
}

function parseFlashSource(value: unknown): FlashSourceRequest | null {
  const keys = plainKeys(value);
  if (keys === null) return null;
  const c = value as Record<string, unknown>;
  switch (c['kind']) {
    case 'release':
      if (keys !== 'fb,file,hv,kind' || !finite(c['hv']) || !finite(c['fb']) || typeof c['file'] !== 'string' || c['file'].length === 0 || c['file'].length > 100) return null;
      return Object.freeze({ kind: 'release', hv: c['hv'], fb: c['fb'], file: c['file'] });
    case 'backup':
      if (keys !== 'boardId,fb,kind' || typeof c['boardId'] !== 'string' || c['boardId'].length === 0 || c['boardId'].length > MAX_BOARD_ID_LENGTH || (c['fb'] !== null && !finite(c['fb']))) return null;
      return Object.freeze({ kind: 'backup', boardId: c['boardId'], fb: c['fb'] as number | null });
    case 'custom':
      if (keys !== 'confirmed,kind,name' || typeof c['name'] !== 'string' || c['name'].length === 0 || c['name'].length > 200 || typeof c['confirmed'] !== 'boolean') return null;
      return Object.freeze({ kind: 'custom', name: c['name'], confirmed: c['confirmed'] });
    default:
      return null;
  }
}

/** A flash command, strictly. The flash service and the flasher decide the rest. */
export function parseFlashCommand(value: unknown): FlashCommand | null {
  const keys = plainKeys(value);
  if (keys === null) return null;
  const c = value as Record<string, unknown>;
  switch (c['op']) {
    case 'begin': {
      if (keys !== 'baseline,hex,op,recovery,settingsBackup,sha256,source') return null;
      const source = parseFlashSource(c['source']);
      const baseline = c['baseline'] === null ? null : parseBaseline(c['baseline']);
      if (source === null || (c['baseline'] !== null && baseline === null)) return null;
      if (typeof c['hex'] !== 'string' || c['hex'].length === 0 || c['hex'].length > MAX_HEX_TEXT) return null;
      if (typeof c['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(c['sha256'])) return null;
      if (c['settingsBackup'] !== 'saved' && c['settingsBackup'] !== 'unreadable') return null;
      if (typeof c['recovery'] !== 'boolean') return null;
      return Object.freeze({ op: 'begin', source, hex: c['hex'], sha256: c['sha256'], settingsBackup: c['settingsBackup'], baseline, recovery: c['recovery'] });
    }
    case 'backupsSaved':
      if (keys !== 'op,sha256' || typeof c['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(c['sha256'])) return null;
      return Object.freeze({ op: 'backupsSaved', sha256: c['sha256'] });
    case 'cancel':
    case 'recover':
    case 'reconnect':
    case 'compare':
    case 'switchCheckDone':
    case 'dismiss':
      return keys === 'op' ? Object.freeze({ op: c['op'] }) : null;
    case 'lock': {
      const baseline = parseBaseline(c['baseline']);
      if (keys !== 'baseline,boardId,op' || typeof c['boardId'] !== 'string' || c['boardId'].length === 0 || c['boardId'].length > MAX_BOARD_ID_LENGTH || baseline === null) return null;
      return Object.freeze({ op: 'lock', boardId: c['boardId'], baseline });
    }
    default:
      return null;
  }
}
