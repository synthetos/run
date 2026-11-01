/**
 * The device-local fact store (ROADMAP TB-01: `addFact`, `invalidate(trigger)`,
 * `view(boundTo)`; RUN_PLAN §4.4 `device-safety`; SAFETY H28, H34, H38).
 *
 * Pure and immutable: every operation returns a new frozen state, and
 * `apps/web` persists it in IndexedDB `device-safety` (never synced, never
 * cleared by logout). A fact is bound to (machine id, board id, `fb`,
 * `deviceHash`); only a fact whose binding matches the connected board
 * exactly, that no trigger has invalidated, that is young enough and (for
 * `switch.*`) was confirmed in this LIVE session, is `valid`. Every other
 * state keeps a gate closed. Invalidated facts are kept, marked with the
 * trigger, so the Commissioning tab can show what needs re-verifying and why.
 *
 * The clock is injected (`Clock`), so the fact-age rule is testable and no
 * code here reads the wall clock.
 */
import { factRoot, isFactKey, patternMatches } from './keys.ts';
import { INVALIDATION_RULES, settingInvalidates } from './rules.ts';
import type { FactTrigger, FactTriggerKind } from './rules.ts';

/** Milliseconds since the epoch. */
export type Clock = () => number;

export interface FactBinding {
  /** The MachineProfile `id` of the machine the board is connected to (H28: machine id, not the board alone). */
  readonly machineId: string;
  readonly boardId: string;
  readonly fb: number;
  readonly deviceHash: string;
}

export interface NewFact {
  readonly key: string;
  readonly value: boolean | number | string;
  /** `tool`: checked by the tool; `user`: attested by you. Never "verified safe" (OLD TOOLS_PLAN §5.2). */
  readonly by: 'tool' | 'user';
  readonly evidence: string;
  /** When it was established, ms since the epoch. */
  readonly at: number;
  readonly boundTo: FactBinding;
  /** The LIVE session it was confirmed in. Required for `switch.*` (once per LIVE session, H28). */
  readonly liveSessionId?: string;
  /** Wiring part ids the fact depends on (a wiring change touching one clears it). */
  readonly parts?: readonly string[];
}

export interface FactRecord extends NewFact {
  readonly invalidated: { readonly trigger: FactTriggerKind; readonly at: number } | null;
}

export interface FactState {
  readonly facts: readonly FactRecord[];
  /** Boards running factory defaults after a flash, until the restore reads back. */
  readonly defaultsActive: readonly string[];
}

export const EMPTY_FACT_STATE: FactState = Object.freeze({ facts: Object.freeze([]), defaultsActive: Object.freeze([]) });

/**
 * Why a fact does or does not count:
 * - `valid`: counts;
 * - `stale`: too old (`dir.*`, `scale.*`), or stamped in the future;
 * - `sessionRecheck`: a `switch.*` fact not confirmed in this LIVE session;
 * - `needsReverify`: invalidated by a trigger, bound to another `fb` or
 *   `deviceHash`, or the board is running defaults;
 * - `absent`: no such fact for this machine and board.
 */
export type FactStatus = 'valid' | 'stale' | 'sessionRecheck' | 'needsReverify' | 'absent';

export interface ViewOptions {
  readonly clock: Clock;
  /** The current LIVE session, or null when not LIVE. */
  readonly liveSessionId: string | null;
  /** Past this age `dir.*` and `scale.*` are `stale` (default 30 days, H28). */
  readonly maxAgeMs?: number;
}

export interface FactView {
  readonly binding: FactBinding;
  readonly defaultsActive: boolean;
  status(key: string): FactStatus;
  readonly entries: readonly { readonly key: string; readonly status: FactStatus; readonly record: FactRecord }[];
}

export const DAY_MS = 24 * 60 * 60 * 1000;
/** H28: `dir.*` and `scale.*` are re-checked after 30 days by default. */
export const DEFAULT_FACT_MAX_AGE_MS = 30 * DAY_MS;
/** A fact stamped further in the future than this (clock moved back) is `stale`. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Roots whose facts age out (H28). */
export const AGED_ROOTS: readonly string[] = Object.freeze(['dir', 'scale']);
/** Roots re-confirmed once per LIVE session (H28). */
export const SESSION_ROOTS: readonly string[] = Object.freeze(['switch']);

/** Thrown by `addFact` for a malformed fact: a caller bug, never stored. */
export class FactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactError';
  }
}

const nonEmpty = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function bindingProblem(b: unknown): string | null {
  if (!isObject(b)) return 'boundTo must be an object';
  if (!nonEmpty(b['machineId'], 64) || !nonEmpty(b['boardId'], 64)) return 'boundTo needs a machine id and a board id';
  if (typeof b['fb'] !== 'number' || !Number.isFinite(b['fb'])) return 'boundTo.fb must be a finite number';
  if (!nonEmpty(b['deviceHash'], 128)) return 'boundTo needs a deviceHash';
  return null;
}

/** Why `f` is not a well-formed fact, or null. Checked at run time: facts are read back from storage as untyped data. */
export function factProblem(f: unknown): string | null {
  if (!isObject(f)) return 'a fact must be an object';
  if (!isFactKey(f['key'])) return `malformed fact key ${JSON.stringify(f['key'])}`;
  const v = f['value'];
  if (!(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || nonEmpty(v, 200))) return 'value must be a boolean, a finite number or a short string';
  if (f['by'] !== 'tool' && f['by'] !== 'user') return 'by must be "tool" or "user"';
  if (typeof f['evidence'] !== 'string' || f['evidence'].length > 500) return 'evidence must be a string of at most 500 characters';
  if (typeof f['at'] !== 'number' || !Number.isFinite(f['at'])) return 'at must be a finite time';
  const b = bindingProblem(f['boundTo']);
  if (b !== null) return b;
  if (f['liveSessionId'] !== undefined && !nonEmpty(f['liveSessionId'], 128)) return 'liveSessionId must be a non-empty string';
  if (SESSION_ROOTS.includes(factRoot(f['key'])) && f['liveSessionId'] === undefined) return `${f['key']} is confirmed per LIVE session and needs liveSessionId`;
  const parts = f['parts'];
  if (parts !== undefined && !(Array.isArray(parts) && parts.length <= 64 && parts.every((p) => nonEmpty(p, 64)))) return 'parts must be a list of part ids';
  return null;
}

function freezeRecord(f: NewFact, invalidated: FactRecord['invalidated']): FactRecord {
  return Object.freeze({
    key: f.key,
    value: f.value,
    by: f.by,
    evidence: f.evidence,
    at: f.at,
    boundTo: Object.freeze({ machineId: f.boundTo.machineId, boardId: f.boundTo.boardId, fb: f.boundTo.fb, deviceHash: f.boundTo.deviceHash }),
    ...(f.liveSessionId === undefined ? {} : { liveSessionId: f.liveSessionId }),
    ...(f.parts === undefined ? {} : { parts: Object.freeze([...f.parts]) }),
    invalidated: invalidated === null ? null : Object.freeze({ trigger: invalidated.trigger, at: invalidated.at }),
  });
}

const sameSlot = (a: NewFact, b: NewFact) =>
  a.key === b.key && a.boundTo.machineId === b.boundTo.machineId && a.boundTo.boardId === b.boundTo.boardId;

/**
 * Record a fact (a new one, or a re-verification replacing the old record
 * for the same key, machine and board). Throws `FactError` for a malformed fact.
 */
export function addFact(state: FactState, fact: NewFact): FactState {
  const problem = factProblem(fact);
  if (problem !== null) throw new FactError(problem);
  const record = freezeRecord(fact, null);
  return Object.freeze({
    facts: Object.freeze([...state.facts.filter((f) => !sameSlot(f, record)), record]),
    defaultsActive: state.defaultsActive,
  });
}

function inScope(f: FactRecord, trigger: FactTrigger): boolean {
  switch (INVALIDATION_RULES[trigger.kind].scope) {
    case 'board':
      return 'boardId' in trigger && f.boundTo.boardId === trigger.boardId;
    case 'machine':
      return 'machineId' in trigger && f.boundTo.machineId === trigger.machineId;
    case 'boardOtherMachines':
      return 'boardId' in trigger && 'machineId' in trigger && f.boundTo.boardId === trigger.boardId && f.boundTo.machineId !== trigger.machineId;
  }
}

function clears(f: FactRecord, trigger: FactTrigger): boolean {
  const rule = INVALIDATION_RULES[trigger.kind].clears;
  if (rule === 'settingOverlay') {
    const t = trigger as Extract<FactTrigger, { kind: 'settingWritten' }>;
    return settingInvalidates(t.dialectId, t.key).some((p) => patternMatches(p, f.key));
  }
  if (rule === 'referencedParts') {
    const t = trigger as Extract<FactTrigger, { kind: 'wiringChanged' }>;
    return f.parts !== undefined && f.parts.some((p) => t.parts.includes(p));
  }
  if (rule === 'otherDeviceHash') {
    return f.boundTo.deviceHash !== (trigger as Extract<FactTrigger, { kind: 'deviceHashDrift' }>).deviceHash;
  }
  return rule.some((p) => patternMatches(p, f.key));
}

/**
 * Apply a trigger: every fact in the rule's scope that the rule clears is
 * marked invalidated (and stays so until re-added). Already invalidated
 * facts keep their first reason.
 */
export function invalidate(state: FactState, trigger: FactTrigger, clock: Clock): FactState {
  const rule = INVALIDATION_RULES[trigger.kind];
  const at = clock();
  const facts = state.facts.map((f) => {
    if (!inScope(f, trigger)) return f;
    if (f.invalidated === null && clears(f, trigger)) return freezeRecord(f, { trigger: trigger.kind, at });
    if (trigger.kind === 'settingWritten' && f.invalidated === null && f.boundTo.deviceHash === trigger.previousDeviceHash) {
      // Unaffected by this write: still true of the board, now under the new hash.
      return freezeRecord({ ...f, boundTo: { ...f.boundTo, deviceHash: trigger.newDeviceHash } }, null);
    }
    return f;
  });
  let defaultsActive = state.defaultsActive;
  if ('boardId' in trigger && rule.defaultsActive === 'raise' && !defaultsActive.includes(trigger.boardId)) {
    defaultsActive = Object.freeze([...defaultsActive, trigger.boardId]);
  } else if ('boardId' in trigger && rule.defaultsActive === 'clear') {
    defaultsActive = Object.freeze(defaultsActive.filter((b) => b !== trigger.boardId));
  }
  return Object.freeze({ facts: Object.freeze(facts), defaultsActive });
}

function statusOf(f: FactRecord, binding: FactBinding, defaultsActive: boolean, now: number, opts: ViewOptions, maxAgeMs: number): FactStatus {
  if (f.invalidated !== null || defaultsActive) return 'needsReverify';
  if (f.boundTo.fb !== binding.fb || f.boundTo.deviceHash !== binding.deviceHash) return 'needsReverify';
  // A clock that cannot be read, or a fact from the future, proves nothing about age.
  if (!Number.isFinite(now) || f.at > now + FUTURE_SKEW_MS) return 'stale';
  const root = factRoot(f.key);
  if (AGED_ROOTS.includes(root) && now - f.at > maxAgeMs) return 'stale';
  if (SESSION_ROOTS.includes(root) && (opts.liveSessionId === null || f.liveSessionId !== opts.liveSessionId)) return 'sessionRecheck';
  return 'valid';
}

/**
 * The facts of one machine on one board, each with its status. Facts of
 * other machines or boards are not in the view at all (H38).
 */
export function view(state: FactState, binding: FactBinding, opts: ViewOptions): FactView {
  const b = bindingProblem(binding);
  if (b !== null) throw new FactError(b);
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_FACT_MAX_AGE_MS;
  // Infinity would switch the age rule off (H28): refused like any other bad age.
  if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || !(maxAgeMs > 0)) throw new FactError('maxAgeMs must be a positive, finite number of milliseconds');
  const now = opts.clock();
  const defaultsActive = state.defaultsActive.includes(binding.boardId);
  const entries = Object.freeze(
    state.facts
      .filter((f) => f.boundTo.machineId === binding.machineId && f.boundTo.boardId === binding.boardId)
      .map((record) => Object.freeze({ key: record.key, status: statusOf(record, binding, defaultsActive, now, opts, maxAgeMs), record })),
  );
  const byKey = new Map(entries.map((e) => [e.key, e.status]));
  return Object.freeze({
    binding: Object.freeze({ ...binding }),
    defaultsActive,
    status: (key: string): FactStatus => byKey.get(key) ?? 'absent',
    entries,
  });
}

/**
 * Read a fact state back from storage. A record that is not well-formed is
 * dropped (an absent fact keeps its gate closed) and counted, so the UI can
 * say that something could not be read.
 */
export function readFactState(value: unknown): { readonly state: FactState; readonly dropped: number } {
  if (!isObject(value) || !Array.isArray(value['facts'])) return { state: EMPTY_FACT_STATE, dropped: 0 };
  const raws = value['facts'] as unknown[];
  const da = value['defaultsActive'];
  // An unreadable defaults-active list could hide a board running factory
  // defaults: then nothing of the state is trusted.
  if (!Array.isArray(da) || !da.every((b) => nonEmpty(b, 64))) return { state: EMPTY_FACT_STATE, dropped: raws.length };
  let dropped = 0;
  let facts: readonly FactRecord[] = [];
  for (const raw of raws) {
    const inv = isObject(raw) ? raw['invalidated'] : undefined;
    const invOk =
      inv === null ||
      (isObject(inv) && Object.hasOwn(INVALIDATION_RULES, inv['trigger'] as string) && typeof inv['at'] === 'number' && Number.isFinite(inv['at']));
    if (factProblem(raw) !== null || !invOk) {
      dropped++;
      continue;
    }
    const record = freezeRecord(raw as unknown as NewFact, inv as FactRecord['invalidated']);
    facts = [...facts.filter((f) => !sameSlot(f, record)), record];
  }
  return { state: Object.freeze({ facts: Object.freeze(facts), defaultsActive: Object.freeze([...(da as string[])]) }), dropped };
}
