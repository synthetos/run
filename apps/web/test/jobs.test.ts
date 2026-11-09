/**
 * Phase 3 jobs in the page (SAFETY §4.4a, H70-H78; T-S117): the start preconditions with every blocker in plain
 * words, plan versus board work zero, the planner view ranges, the Phase 3 control allowlist (Start enabled only when
 * every precondition passes; Pause and Stop job always), and the stop cards.
 */
import { describe, expect, it, vi } from 'vitest';
import { w38 } from '@synthetos/safety';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import {
  bytesText,
  duration,
  feedReport,
  jobUi,
  lineModeRecord,
  loadPlan,
  pendingLineMode,
  plannerRanges,
  savePlan,
  startBlockers,
  starving,
  textHash,
  zeroCheck,
  type StartChoices,
} from '../src/workspace/jobUi.ts';
import { JobStatus, JobStopCard } from '../src/workspace/views/JobViews.ts';
import { motionUi } from '../src/workspace/motion.ts';
import { byAttr, one, root, text } from './tree.ts';
import { job, snap, view } from './jobFixtures.ts';
import { c41Text, startTicks } from '../src/workspace/startTicks.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

const ALL: StartChoices = { unhomed: true, workZero: true, spindle: true, attended: true, travel: true };
const FILE = { name: 'part.nc', hash: textHash('G0 X1\nM30') };

describe('T-S117: Start is enabled only when every precondition passes, each blocker in plain words', () => {
  const zero = zeroCheck({ x: 10, y: 20, z: -5 }, { x: 10, y: 20, z: -5 });

  it('no blocker on an idle, approved, homed board with the file checked and the attestation ticked', () => {
    expect(startBlockers(jobUi(view(snap())), FILE, zero, ALL)).toEqual([]);
  });

  it('C40 (OD-24): a travel finding to confirm blocks Start until it is ticked', () => {
    const report = { ...job().report, travel: { block: null, confirm: { kind: 'outside', line: 2, text: 'line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection' } } };
    const ui = jobUi(view(snap({ job: job({ report: report as never }) })));
    expect(startBlockers(ui, FILE, zero, { ...ALL, travel: false }).map((b) => b.id)).toEqual(['travel']);
    expect(startBlockers(ui, FILE, zero, ALL)).toEqual([]);
  });

  it('C36 and C40 are one box, C41, when both apply (owner, 2026-11-08; shorter words 2026-11-09); apart when the travel was not read', () => {
    const outside = { kind: 'outside', line: 2, text: 'line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection', past: { axis: 'X', reach: 200, limit: 150, unit: 'mm', more: 0 } };
    const unhomed = (confirm: unknown) => jobUi(view(snap({ live: { ...snap().live, home: 0 }, job: job({ report: { ...job().report, travel: { block: null, confirm } } as never }) })));
    expect(startTicks(false, outside as never)).toEqual(['c41']);
    expect(c41Text(outside as never)).toBe("X isn't homed, so Run can't check its travel and soft limits may not protect it. Line 2: X would reach 200 mm, past its 150 mm limit. I've checked where every axis is and that every move fits.");
    expect(c41Text({ ...outside, past: { ...outside.past, more: 2 } } as never)).toContain('past its 150 mm limit, and 2 more. ');
    expect(startTicks(false, { kind: 'unchecked' })).toEqual(['c36', 'c40']);
    expect(startTicks(false, null)).toEqual(['c36']);
    expect(startTicks(true, outside as never)).toEqual(['c40']);
    expect(startTicks(true, null)).toEqual([]);
    expect(startBlockers(unhomed(outside), FILE, zero, { ...ALL, unhomed: false, travel: false }).map((b) => b.id)).toEqual(['travel']);
    expect(startBlockers(unhomed(outside), FILE, zero, ALL)).toEqual([]);
    const unread = { kind: 'unchecked', line: null, text: 'the travel limits of X were not read' };
    expect(startBlockers(unhomed(unread), FILE, zero, { ...ALL, unhomed: false, travel: false }).map((b) => b.id)).toEqual(['homed', 'travel']);
  });

  it('names each blocker', () => {
    const ids = (s: Snapshot | null, choices: StartChoices = ALL, file: { readonly name: string | null; readonly hash: string | null } = FILE, jobs = true): string[] => startBlockers(jobUi(view(s, jobs)), file, zero, choices).map((b) => b.id);
    expect(ids(null)).toEqual(['connect']);
    expect(ids(snap(), ALL, FILE, false)).toEqual(['build']);
    expect(ids(snap({ overlays: ['FAULT'] }))).toContain('fault');
    expect(ids(snap({ overlays: ['LOST'] }))).toContain('lost');
    expect(ids(snap({ overlays: ['ORPHANED_MOTION'] }))).toContain('orphaned');
    expect(ids(snap({ overlays: ['READ_ONLY'], classification: { mode: 'readOnly' } }))).toContain('approved');
    expect(ids(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'] }))).toContain('unknown');
    expect(ids(snap({ overlays: ['STALE'] }))).toContain('stale');
    expect(ids(snap({ overlays: ['NEEDS_REVIEW'] }))).toContain('review');
    expect(ids(snap({ base: 'ALARM' }))).toContain('alarm');
    expect(ids(snap({ base: 'JOGGING' }))).toEqual(['idle']);
    expect(ids(snap({ rxm: { busy: true } }))).toContain('busy');
    expect(ids(snap(), ALL, { name: null, hash: null })).toContain('file');
    expect(ids(snap({ job: job({ phase: 'loading' }) }))).toContain('check');
    expect(ids(snap({ job: null }))).toContain('check');
    expect(ids(snap({ job: job({ report: { ...job().report, blocked: true, counts: { block: 1, warn: 0, change: 0, info: 0 } } as never }) }))).toContain('blocked');
    expect(ids(snap({ live: { home: 0, pos: {}, mpo: {} } }), { ...ALL, unhomed: false })).toContain('homed');
    expect(ids(snap({ job: job({ report: { ...job().report, startsSpindle: true } as never }) }), { ...ALL, spindle: false })).toContain('spindle');
    expect(ids(snap(), { ...ALL, attended: false })).toContain('attended');
    const text = startBlockers(jobUi(view(snap({ job: job({ phase: 'running', startedAt: 1 }), base: 'RUNNING' }))), FILE, zero, ALL);
    expect(text.find((b) => b.id === 'idle')?.text).toBe('A job is running.');
  });

  it('plan versus board: no plan or a difference needs the confirmation; a match does not', () => {
    const storage = new Map<string, string>();
    const s = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) };
    expect(loadPlan('k', s)).toBeNull();
    expect(savePlan('k', { x: 1, y: 2, z: 3 }, s)).toBe(true);
    expect(loadPlan('k', s)).toEqual({ x: 1, y: 2, z: 3 });
    expect(zeroCheck(null, null).state).toBe('unknown');
    expect(zeroCheck({ x: 0, y: 0, z: 0 }, null)).toMatchObject({ state: 'differs', text: expect.stringMatching(/^No plan is recorded/) });
    expect(zeroCheck({ x: 0, y: 0, z: 0 }, { x: 0.02, y: 0, z: 0 }).state).toBe('match');
    const d = zeroCheck({ x: 0, y: 0, z: 0 }, { x: 14.2, y: 0, z: -1 });
    expect(d).toMatchObject({ state: 'differs', text: 'The board’s work zero is not your plan’s: it differs in X by 14.20 mm, Z by 1.00 mm.' });
    const ui = jobUi(view(snap()));
    expect(startBlockers(ui, FILE, d, { ...ALL, workZero: false }).map((b) => b.id)).toEqual(['zero']);
    expect(startBlockers(ui, FILE, zeroCheck(null, null), ALL).map((b) => b.id)).toEqual(['zero']);
  });
});

describe('the planner view and the live numbers', () => {
  it('maps file lines to the preview’s own line indices: cut, executing, queued', () => {
    const sourceLines = Uint32Array.from([1, 2, 2, 3, 4, 5, 6]);
    const j = job({ phase: 'running', startedAt: 0, executing: { n: 3, line: 2 }, ackedThrough: 4 });
    expect(plannerRanges(j, sourceLines, false)).toEqual({ cutEnd: 1, execEnd: 3, queuedEnd: 5, starving: false });
    expect(plannerRanges(job(), sourceLines, false)).toBeNull();
    expect(plannerRanges(job({ phase: 'preparing', startedAt: 0 }), sourceLines, false)).toBeNull();
    expect(plannerRanges(job({ phase: 'paused', startedAt: 0, ackedThrough: 6 }), sourceLines, true)).toEqual({ cutEnd: 6, execEnd: 7, queuedEnd: 7, starving: true });
  });

  it('starving: cutting with the planner almost empty and lines still to send', () => {
    const running = snap({ job: job({ phase: 'running', startedAt: 0, sent: 1, total: 9 }), live: { qr: 31, vel: 400, pos: {}, mpo: {} } });
    expect(starving(running, 32)).toBe(true);
    expect(starving({ ...running, live: { ...running.live, qr: 10 } }, 32)).toBe(false);
    expect(starving(snap(), 32)).toBe(false);
    expect(starving(running, null)).toBe(false);
  });

  it('feed-limit lines are observational, per cause, from the summary counters', () => {
    expect(feedReport(null)).toBeNull();
    const window = { fi: 2, first: null, prev: null, last: { e: 1, q: 1, c: [1200, 0, 0, 500, 0, 0], ct: 2000, cd: 9 }, move: null, short: false, unsupported: false };
    expect(feedReport(window)?.job[0]).toEqual({ cause: 'an axis speed limit', fraction: 0.6, seconds: 1.2 });
  });

  it('durations, the Latin-1 text and the hash the worker computes', () => {
    expect(duration(12)).toBe('12 s');
    expect(duration(245)).toBe('4 min 05 s');
    expect(duration(3725)).toBe('1 h 02 min');
    expect(bytesText(Uint8Array.from([71, 48, 0xb0]))).toBe('G0°');
    expect(textHash('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(jobUi(view(snap({ job: job({ startedAt: 0 }) }))).elapsedMs).toBe(4000);
  });
});

describe('T-S117: the Phase 3 controls', () => {
  function live(s: Snapshot): { model: ReturnType<typeof createWorkspaceModel>; job: ReturnType<typeof vi.fn> } {
    const model = createWorkspaceModel();
    const jobFn = vi.fn(() => Promise.resolve(null));
    model.actions.value = { job: jobFn } as unknown as LiveActions;
    model.live.value = view(s);
    return { model, job: jobFn };
  }

  it('Pause and Stop job in the running job card are enabled whenever the strip gives them, and call the strip’s own actions', () => {
    const { model } = live(snap({ base: 'RUNNING', job: job({ phase: 'running', startedAt: 0, sent: 1, acked: 1, executing: { n: 1, line: 1 } }) }));
    const pause = vi.fn();
    const stop = vi.fn();
    const tree = root(h(JobStatus, { model, onPause: pause, onStopJob: stop }));
    (one(tree, byAttr('data-machine-control', 'job-pause')).props['onClick'] as () => void)();
    (one(tree, byAttr('data-machine-control', 'job-stop')).props['onClick'] as () => void)();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(text(one(tree, byAttr('data-job', 'line')))).toBe('file line 1');
    // Without the strip's calls (the prerendered page), they are shown and disabled.
    const bare = root(h(JobStatus, { model }));
    expect(one(bare, byAttr('data-machine-control', 'job-pause')).props['disabled']).toBe(true);
  });

  it('the tool-change card: W37, the tools, Resume behind C34 (and C35 when the file does not restart the spindle)', () => {
    const tc = { line: 5, tool: 2, spindle: 'cw' as const, speed: 12000, mist: false, flood: false, restartsSpindle: false, moved: true };
    const { model, job: jobFn } = live(snap({ base: 'PROGRAM_PAUSED', job: job({ phase: 'toolChange', startedAt: 0, toolChange: tc, message: 'x' }), live: { tool: 1, spe: 0, pos: {}, mpo: {} } }));
    const html = renderToString(h(JobStopCard, { model }));
    expect(html).toContain('data-safety="W37"');
    expect(html).toContain('Tool change at line 5');
    expect(html).toContain('T2, 6 mm 3-flute ZrN (6 mm)');
    expect(html).toContain('Stopped (Run sent M5 and M9)');
    expect(html).toContain('Resume returns at a safe height first');
    expect(jobFn).not.toHaveBeenCalled();
    expect(motionUi(model.live.value).enabled).toBe(true);
  });

  it('the refused-line card: W38 with the line, Stop job and Skip behind C33; nothing at other phases', () => {
    const { model } = live(snap({ base: 'HELD', job: job({ phase: 'refused', startedAt: 0, refused: { line: 6, status: 220, text: 'G1 X300' }, message: w38({ line: 6, status: 220, meaning: 'outside the soft limits' }) }) }));
    const html = renderToString(h(JobStopCard, { model }));
    expect(html).toContain('data-safety="W38"');
    expect(html).toContain('G1 X300');
    expect(html).toContain('data-action="skip-line"');
    const none = live(snap()).model;
    expect(renderToString(h(JobStopCard, { model: none }))).toBe('');
    const bp = live(snap({ base: 'PROGRAM_PAUSED', job: job({ phase: 'breakpoint', startedAt: 0, message: 'Stopped at breakpoint · line 8' }) })).model;
    expect(renderToString(h(JobStopCard, { model: bp }))).toContain('data-safety="W43"');
  });
});

describe('H77: this browser\'s record of a board\'s line mode', () => {
  it('only a pending record is acted on at connect; anything else is no record', () => {
    expect(pendingLineMode({ from: 0, pending: true })).toBe(0);
    expect(pendingLineMode({ from: 1, pending: true })).toBe(1);
    for (const v of [undefined, null, 0, 1, 'x', { from: 0, pending: false }, { from: 2, pending: true }, { pending: true }]) expect(pendingLineMode(v), JSON.stringify(v)).toBeNull();
  });

  it('the record follows the session: the value found, and whether Run has put it back', () => {
    expect(lineModeRecord({ restore: null, pending: false })).toBeNull();
    expect(lineModeRecord({ restore: 0, pending: true })).toEqual({ from: 0, pending: true });
    expect(lineModeRecord({ restore: 0, pending: false })).toEqual({ from: 0, pending: false });
    expect(pendingLineMode(lineModeRecord({ restore: 0, pending: false }))).toBeNull();
  });
});
