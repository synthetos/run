/**
 * The carve follows the tool (owner, 2026-11-09: "when removing the stock it lags; the bit passes through it and
 * then a few seconds later it disappears"). A carve target is the lines carved whole and, on the next line, a
 * tip up to the tool (gcode-view carve/tip.ts). A `TipSource` sends targets as the tool moves; useCarve.ts seeks
 * the carve to each one without a page re-render.
 *
 * During a job the tool is drawn moving smoothly from report to report (gcode-view markerMotion.ts). The live
 * follower here moves the same way, so the stock goes as the drawn bit passes, not before it and not a line
 * later: a line the board has finished is carved whole only once the drawn tool has left it. It is never ahead
 * of the board: it follows the reports, never past the newest. Display only.
 */
import { nextMotion, positionAt, settled, tipOnLine, type CarveTip, type MarkerMotion, type SegmentList, type Vec3 } from '@synthetos/gcode-view';

export interface CarveTarget {
  /** Lines 0..target-1 carved whole. */
  readonly target: number;
  /** Line `target` carved up to here, or null for none of it. */
  readonly tip: CarveTip | null;
}

export interface TipSource {
  /** Adds a listener; it hears the current target at once (null: no tip, the page's own target stands). */
  subscribe(listener: (target: CarveTarget | null) => void): () => void;
}

export function sameTarget(a: CarveTarget | null, b: CarveTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.target === b.target && (a.tip === b.tip || (a.tip !== null && b.tip !== null && a.tip.vertex === b.tip.vertex && a.tip.t === b.tip.t));
}

/** A source the owner pushes targets into. */
export function createTipSource(): TipSource & { set(target: CarveTarget | null): void; readonly current: CarveTarget | null } {
  const listeners = new Set<(target: CarveTarget | null) => void>();
  let current: CarveTarget | null = null;
  return {
    get current() {
      return current;
    },
    set(next) {
      if (sameTarget(current, next)) return;
      current = next;
      for (const l of [...listeners]) l(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
  };
}

export interface LiveReport {
  /** Lines the board has finished (liveCarve.ts): the line it executes is `target`. */
  readonly target: number;
  /** The reported tool position, path frame, or null when not drawn. */
  readonly pos: Vec3 | null;
}

export interface FollowerClock {
  readonly now: () => number;
  readonly frame: (fn: () => void) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly reducedMotion?: () => boolean;
}

export interface LiveFollower extends TipSource {
  /** A new report (null: no job of this file to follow; the source then says null). */
  report(list: SegmentList | null, next: LiveReport | null): void;
  dispose(): void;
}

/** Follows the drawn tool along the board's lines and sends carve targets. */
export function createLiveFollower(clock: FollowerClock): LiveFollower {
  const source = createTipSource();
  let list: SegmentList | null = null;
  let motion: MarkerMotion | null = null;
  /** The newest report's finished lines. */
  let goal = 0;
  let handle: unknown = null;

  /** The target for the drawn tool at `pos`: the latest line, from the one being carved up to `goal`, it is on. */
  function place(pos: Vec3 | null, final: boolean): CarveTarget {
    const now = source.current;
    const from = now === null || now.target > goal ? 0 : now.target;
    if (list !== null && pos !== null) {
      // Latest line first: where lines lie close together (a fine stepover) the carve keeps up rather than lags.
      for (let line = goal; line >= from; line--) {
        const held = now !== null && now.target === line ? now.tip : null;
        const tip = tipOnLine(list, line, pos, held);
        if (tip !== null) return { target: line, tip };
      }
    }
    // Not on any of them: hold where the carve is until the drawn tool reaches the newest report.
    if (!final && now !== null && now.target >= from && now.target <= goal) return now;
    return { target: goal, tip: now !== null && now.target === goal ? now.tip : null };
  }

  function tick(): void {
    handle = null;
    if (motion === null) return;
    const t = clock.now();
    const done = settled(motion, t);
    source.set(place(positionAt(motion, t), done));
    if (!done) handle = clock.frame(tick);
  }

  return {
    subscribe: source.subscribe,
    report(nextList, next) {
      if (next === null || nextList === null) {
        if (handle !== null) clock.cancel(handle);
        handle = null;
        motion = null;
        list = nextList;
        source.set(null);
        return;
      }
      if (nextList !== list || (source.current !== null && next.target < source.current.target)) source.set(null);
      list = nextList;
      goal = next.target;
      if (next.pos === null) {
        motion = null;
        source.set(place(null, true));
        return;
      }
      motion = nextMotion(motion, next.pos, clock.now(), clock.reducedMotion?.() ?? false);
      if (handle === null) tick();
    },
    dispose() {
      if (handle !== null) clock.cancel(handle);
      handle = null;
      motion = null;
    },
  };
}
