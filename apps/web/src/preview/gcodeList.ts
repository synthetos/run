/**
 * The G-code list's pure logic (presentation only): which findings get a
 * row, following the executing line, and breakpoints kept per file in this
 * browser.
 *
 * Breakpoints are stored now and take effect when running jobs arrives
 * (Phase 3, MACHINING_ASSISTANT §7): Run stops sending before the line, so
 * the queued moves drain to a clean stop. They never gate Pause or Stop job,
 * and a line already sent to the planner cannot be recalled.
 */
import type { Finding } from '@synthetos/gcode';
import { ROUTINE_RULES, type PreviewResult } from '../gcode-worker/pipeline.ts';
import { isArray, isObject, readStored, writeStored, type StorageLike } from '../workspace/storage.ts';

/** True for a finding the list shows on its line (not a routine renumbering). */
export function shownFinding(f: Finding): boolean {
  return !ROUTINE_RULES.has(f.rule);
}

/** Lines whose N word Run replaces with its own line number: one summary line in the Job card, never a row each. */
export function renumbered(result: PreviewResult): number {
  return result.renumbered;
}

/** Routine changes Run makes (comments removed, renumbering, empty lines): the total and the parts, for one Job card line. */
export function routineChanges(result: PreviewResult): { readonly total: number; readonly comments: number; readonly renumbered: number; readonly empty: number } {
  const r = result.routine;
  const comments = r['comment-stripped'] ?? 0;
  const renumber = r['n-word-stripped'] ?? 0;
  const empty = (r['dropped-empty'] ?? 0) + (r['dropped-tape-marker'] ?? 0);
  return { total: comments + renumber + empty, comments, renumbered: renumber, empty };
}

/** The finding counts without the routine changes (what the Job card's check list counts). */
export function shownCounts(result: PreviewResult): Readonly<Record<'block' | 'warn' | 'change' | 'info', number>> {
  const c = result.summary.counts;
  return { ...c, change: Math.max(0, c.change - routineChanges(result).total) };
}

// ---------------------------------------------------------------- follow

export interface Viewport {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly count: number;
}

/** The file line (1-based) the controller is executing, from its reported (host) line; null when not in this file. */
export function executingFileLine(reported: number | null | undefined, sourceLines: Uint32Array): number | null {
  if (typeof reported !== 'number' || !Number.isInteger(reported) || reported < 1 || reported > sourceLines.length) return null;
  const line = sourceLines[reported - 1];
  return line === undefined || line < 1 ? null : line;
}

/** True when the row of `line` (1-based) is fully in view. */
export function lineInView(line: number, v: Viewport): boolean {
  const top = (line - 1) * v.rowHeight;
  return top >= v.scrollTop && top + v.rowHeight <= v.scrollTop + v.viewportHeight;
}

/**
 * Where to scroll so `line` stays in view while following: null when it already is (no jitter), else a
 * scroll top that puts it a third of the way down, clamped to the list.
 */
export function followScrollTop(line: number | null, v: Viewport): number | null {
  if (line === null || line < 1 || line > v.count) return null;
  if (lineInView(line, v)) return null;
  const max = Math.max(0, v.count * v.rowHeight - v.viewportHeight);
  return Math.min(max, Math.max(0, (line - 1) * v.rowHeight - Math.floor(v.viewportHeight / 3)));
}

/** Keys that scroll the list by hand (they turn Follow off, like the wheel or a drag). */
export const MANUAL_SCROLL_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export interface FollowState {
  readonly follow: boolean;
}

export type FollowEvent = { readonly kind: 'manual-scroll' } | { readonly kind: 'toggle' } | { readonly kind: 'jump-to-current' };

/** Follow is on by default; scrolling by hand turns it off; the toggle flips it; "Jump to current" turns it back on. */
export function followReducer(s: FollowState, e: FollowEvent): FollowState {
  switch (e.kind) {
    case 'manual-scroll':
      return s.follow ? { follow: false } : s;
    case 'toggle':
      return { follow: !s.follow };
    case 'jump-to-current':
      return { follow: true };
  }
}

/** "Jump to current" shows when Follow is off and there is an executing line to go back to. */
export function showJumpToCurrent(s: FollowState, executing: number | null): boolean {
  return !s.follow && executing !== null;
}

/** Parses the jump-to-line field: a file line within the file, or null. */
export function parseJumpLine(text: string, count: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= count ? n : null;
}

// ---------------------------------------------------------------- breakpoints

export const BREAKPOINT_STORE = 'breakpoints';
/** Files remembered (the oldest is dropped) and breakpoints per file. */
export const MAX_BREAKPOINT_FILES = 40;
export const MAX_BREAKPOINTS_PER_FILE = 500;

export type BreakpointMap = Readonly<Record<string, readonly number[]>>;

/** A short, stable hash of the file bytes (FNV-1a). */
export function bytesHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The key breakpoints are kept under: the file name, its size and its content hash, so an edited file starts clean. */
export function fileKey(name: string, bytes: Uint8Array): string {
  return `${name.slice(0, 120)}|${bytes.length}|${bytesHash(bytes)}`;
}

const isBreakpointMap = (v: unknown): v is BreakpointMap =>
  isObject(v) && Object.values(v).every((lines) => isArray(lines) && lines.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1));

export function loadBreakpoints(key: string, storage?: StorageLike | null): readonly number[] {
  const map = storage === undefined ? readStored(BREAKPOINT_STORE, isBreakpointMap) : readStored(BREAKPOINT_STORE, isBreakpointMap, storage);
  return map?.[key] ?? [];
}

/** Saves one file's breakpoints (sorted, deduplicated, capped); false when this browser refuses storage. */
export function saveBreakpoints(key: string, lines: readonly number[], storage?: StorageLike | null): boolean {
  const map = (storage === undefined ? readStored(BREAKPOINT_STORE, isBreakpointMap) : readStored(BREAKPOINT_STORE, isBreakpointMap, storage)) ?? {};
  const next: Record<string, readonly number[]> = {};
  for (const [k, v] of Object.entries(map)) if (k !== key) next[k] = v;
  const clean = [...new Set(lines)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b).slice(0, MAX_BREAKPOINTS_PER_FILE);
  if (clean.length > 0) next[key] = clean;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_BREAKPOINT_FILES))) delete next[k];
  return storage === undefined ? writeStored(BREAKPOINT_STORE, next) : writeStored(BREAKPOINT_STORE, next, storage);
}

/** Adds or removes a breakpoint on `line`. */
export function toggleBreakpoint(lines: readonly number[], line: number): readonly number[] {
  return lines.includes(line) ? lines.filter((n) => n !== line) : [...lines, line].sort((a, b) => a - b);
}

/**
 * Breakpoints inside the queued band: after the executing line and up to the last line already sent.
 * Those lines are in the planner and cannot be recalled, so a breakpoint there does not take effect.
 */
export function queuedBreakpoints(lines: readonly number[], executing: number | null, sentThrough: number | null): readonly number[] {
  if (executing === null || sentThrough === null) return [];
  return lines.filter((n) => n > executing && n <= sentThrough);
}
