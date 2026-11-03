/**
 * The G-code list (ROADMAP TB-03): virtualised, so a million-line file
 * renders only the rows in view (measured from the panel, not a fixed
 * height). Each row shows a breakpoint gutter, the file line, its safety
 * verdict and, for rows in view, the worst finding's message, fetched from
 * the worker for the visible range only.
 *
 * - Routine renumbering (Run replaces each N word with its own line
 *   number) gets no row: the Job card counts it once (gcodeList.ts).
 * - Go to line, and Follow: on by default it keeps the executing line in
 *   view; scrolling by hand turns it off and "Jump to current" turns it on.
 * - Breakpoints are kept per file in this browser and take effect when
 *   running jobs arrives. They never gate Pause or Stop job.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { Finding } from '@synthetos/gcode';
import { listWindow, scrollTopFor, type ListWindow } from '@synthetos/gcode-view';
import { w41 } from '@synthetos/safety';
import { lineText } from '../gcode-worker/lines.ts';
import {
  followReducer,
  followScrollTop,
  loadBreakpoints,
  MANUAL_SCROLL_KEYS,
  parseJumpLine,
  queuedBreakpoints,
  saveBreakpoints,
  shownFinding,
  showJumpToCurrent,
  toggleBreakpoint,
} from './gcodeList.ts';

export const ROW_HEIGHT = 22;
/** The viewport height assumed until the panel has been measured (and in the prerendered page). */
export const LIST_HEIGHT = 330;

/** Verdict codes (gcode `VERDICT`) as the words the list shows. */
export const VERDICT_WORD = ['', 'info', 'change', 'warn', 'block'] as const;

export interface ListData {
  readonly bytes: Uint8Array;
  readonly spans: Uint32Array;
  /** Verdict per line as the list shows it (the result's `verdicts`: routine renumbering left out). */
  readonly verdicts: Uint8Array;
}

const RANK: Readonly<Record<string, number>> = { info: 1, change: 2, warn: 3, block: 4 };

/** The worst shown finding per file line (routine renumbering is left out). */
export function worstByLine(findings: readonly Finding[]): Map<number, Finding> {
  const out = new Map<number, Finding>();
  for (const f of findings) {
    if (!shownFinding(f)) continue;
    const had = out.get(f.line);
    if (had === undefined || (RANK[f.severity] ?? 0) > (RANK[had.severity] ?? 0)) out.set(f.line, f);
  }
  return out;
}

export interface RowOptions {
  readonly breakpoints?: ReadonlySet<number>;
  /** The file line the controller reports executing, or null. */
  readonly executing?: number | null;
  readonly onToggleBreakpoint?: (line: number) => void;
  /** The line's context action: "Report a problem with this line" (REPORT_A_PROBLEM §2). */
  readonly onReportLine?: (line: number) => void;
}

/** The rows of one window (pure, for the tests). `highlightLine` is a 1-based file line; 0 for none. */
export function listRows(data: ListData, win: ListWindow, highlightLine: number, worst: ReadonlyMap<number, Finding>, options: RowOptions = {}): ComponentChild[] {
  const rows: ComponentChild[] = [];
  const toggle = options.onToggleBreakpoint;
  const report = options.onReportLine;
  for (let i = win.first; i < win.end; i++) {
    const line = i + 1;
    const word = VERDICT_WORD[data.verdicts[i] ?? 0] ?? '';
    const finding = worst.get(line);
    const bp = options.breakpoints?.has(line) === true;
    rows.push(
      h(
        'div',
        {
          class: 'preview-row',
          role: 'listitem',
          key: line,
          'data-line': line,
          'data-verdict': word === '' ? 'ok' : word,
          'data-highlight': line <= highlightLine ? 'true' : undefined,
          'data-odd': line % 2 === 1 ? 'true' : undefined,
          'data-breakpoint': bp ? 'true' : undefined,
          'data-executing': options.executing === line ? 'true' : undefined,
        },
        h(
          'button',
          {
            type: 'button',
            class: 'preview-row-gutter',
            'aria-pressed': bp ? 'true' : 'false',
            'aria-label': `Breakpoint on line ${String(line)}`,
            title: bp ? 'Remove the breakpoint' : 'Set a breakpoint',
            'data-gcode': 'breakpoint',
            ...(toggle === undefined ? {} : { onClick: () => { toggle(line); } }),
          },
          h('span', { class: 'bp-dot', 'aria-hidden': 'true' }),
        ),
        h('span', { class: 'preview-row-n' }, String(line)),
        h('span', { class: 'verdict-badge' }, word === '' ? h('span', { class: 'sr-only' }, 'no findings') : [h('span', { class: 'sr-only', key: 'v' }, 'verdict '), word]),
        h('code', { class: 'preview-row-text' }, lineText(data.bytes, data.spans, i)),
        h('span', { class: 'preview-row-finding' }, finding?.message ?? ''),
        report === undefined
          ? null
          : h(
              'button',
              { type: 'button', class: 'preview-row-report', 'aria-label': `Report a problem with line ${String(line)}`, title: 'Report a problem with this line', 'data-gcode': 'report', onClick: () => { report(line); } },
              h('svg', { viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'aria-hidden': 'true' }, h('path', { d: 'M5 21V3.5m0 1h12.5l-2.5 4 2.5 4H5' })),
            ),
      ),
    );
  }
  return rows;
}

export interface LineListProps {
  readonly data: ListData;
  readonly highlightLine: number;
  /** Bring this 1-based file line into view when it changes. */
  readonly revealLine: number;
  readonly fetchFindings: (from: number, to: number) => Promise<readonly Finding[]>;
  /** The key breakpoints are stored under (gcodeList `fileKey`); null keeps them for this page only. */
  readonly fileKey?: string | null;
  /** The file line the controller reports executing (from the status report `line`), or null. */
  readonly executingLine?: number | null;
  /** The last file line already sent to the planner (jobs, Phase 3), or null. */
  readonly sentThrough?: number | null;
  /** Each row's "Report a problem with this line" action; absent, rows have none. */
  readonly onReportLine?: (line: number) => void;
  /** Phase 3: told the breakpoints whenever they change (a running job takes them at once). */
  readonly onBreakpoints?: (lines: readonly number[]) => void;
}

function reducedMotion(): boolean {
  try {
    return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function LineList({ data, highlightLine, revealLine, fetchFindings, fileKey = null, executingLine = null, sentThrough = null, onReportLine, onBreakpoints }: LineListProps): ComponentChild {
  const count = data.spans.length / 2;
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(LIST_HEIGHT);
  const [worst, setWorst] = useState<ReadonlyMap<number, Finding>>(new Map());
  const [follow, dispatch] = useReducer(followReducer, { follow: true });
  const [breakpoints, setBreakpoints] = useState<readonly number[]>([]);
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState(false);
  const win = listWindow({ count, rowHeight: ROW_HEIGHT, scrollTop, viewportHeight: height, overscan: 20 });
  const bpSet = useMemo(() => new Set(breakpoints), [breakpoints]);

  useEffect(() => { setBreakpoints(fileKey === null ? [] : loadBreakpoints(fileKey)); }, [fileKey]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => { if (el.clientHeight > 0) setHeight(el.clientHeight); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  const scrollTo = (top: number, smooth: boolean): void => {
    const el = box.current;
    if (el === null) return;
    if (smooth && !reducedMotion() && typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
  };

  useEffect(() => {
    if (revealLine < 1 || box.current === null) return;
    const top = scrollTopFor(revealLine - 1, { count, rowHeight: ROW_HEIGHT, viewportHeight: height });
    if (Math.abs(box.current.scrollTop - top) > height / 2) scrollTo(top, false);
  }, [revealLine, count]);

  useEffect(() => {
    if (!follow.follow || box.current === null) return;
    const top = followScrollTop(executingLine, { scrollTop: box.current.scrollTop, viewportHeight: height, rowHeight: ROW_HEIGHT, count });
    if (top !== null) scrollTo(top, false);
  }, [executingLine, follow.follow, height, count]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void fetchFindings(win.first + 1, win.end).then((f) => { if (live) setWorst(worstByLine(f)); }, () => {});
    }, 60);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [win.first, win.end, fetchFindings]);

  const onToggle = (line: number): void => {
    const next = toggleBreakpoint(breakpoints, line);
    setBreakpoints(next);
    if (fileKey !== null) saveBreakpoints(fileKey, next);
    onBreakpoints?.(next);
  };
  const manual = (): void => { dispatch({ kind: 'manual-scroll' }); };
  const queued = queuedBreakpoints(breakpoints, executingLine, sentThrough);
  const jumpBack = showJumpToCurrent(follow, executingLine);

  return h(
    'div',
    { class: 'gcode-list', 'data-gcode': 'panel' },
    h(
      'div',
      { class: 'gcode-tools' },
      h(
        'form',
        {
          class: 'gcode-jump',
          onSubmit: (e: Event) => {
            e.preventDefault();
            const line = parseJumpLine(jump, count);
            setJumpError(line === null);
            if (line === null) return;
            dispatch({ kind: 'manual-scroll' });
            scrollTo(Math.max(0, (line - 1) * ROW_HEIGHT - Math.floor(height / 3)), true);
          },
        },
        h('label', { class: 'sr-only', for: 'gcode-jump-line' }, `Go to line, 1 to ${count.toLocaleString('en-US')}`),
        h('input', {
          id: 'gcode-jump-line',
          type: 'text',
          inputMode: 'numeric',
          autoComplete: 'off',
          placeholder: 'Go to line',
          value: jump,
          'aria-invalid': jumpError ? 'true' : undefined,
          'data-gcode': 'jump',
          onInput: (e: Event) => {
            setJump((e.currentTarget as HTMLInputElement).value);
            setJumpError(false);
          },
        }),
      ),
      h(
        'button',
        { type: 'button', class: 'toggle gcode-follow', 'aria-pressed': follow.follow ? 'true' : 'false', 'data-gcode': 'follow', title: 'Keep the line the controller reports executing in view', onClick: () => { dispatch({ kind: 'toggle' }); } },
        'Follow',
      ),
      breakpoints.length === 0
        ? h('span', { class: 'gcode-bp-note', title: 'A job stops before a breakpoint, with the queue drained.' }, 'Click the margin to add a breakpoint.')
        : h('span', { class: 'gcode-bp-note', 'data-gcode': 'breakpoints' }, h('span', { class: 'bp-dot', 'aria-hidden': 'true' }), `${String(breakpoints.length)} breakpoint${breakpoints.length === 1 ? '' : 's'}`),
      queued.length === 0 ? null : h('span', { class: 'gcode-bp-note warn', role: 'status', 'data-safety': 'W41' }, queued.map((line) => w41({ line })).join(' ')),
    ),
    h(
      'div',
      { class: 'gcode-scroll' },
      h(
        'div',
        {
          ref: box,
          class: 'preview-list',
          tabIndex: 0,
          role: 'list',
          'aria-label': `G-code lines (${count.toLocaleString('en-US')})`,
          'data-preview': 'list',
          onScroll: (e: Event) => { setScrollTop((e.currentTarget as HTMLDivElement).scrollTop); },
          onWheel: manual,
          onTouchMove: manual,
          onPointerDown: (e: PointerEvent) => {
            // A press on the scrollbar (outside the rows' box) drags the list by hand.
            const el = e.currentTarget as HTMLDivElement;
            if (e.target === el && (e.offsetX >= el.clientWidth || e.offsetY >= el.clientHeight)) manual();
          },
          onKeyDown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && MANUAL_SCROLL_KEYS.has(e.key)) manual(); },
        },
        h(
          'div',
          { class: 'preview-list-space', style: { height: `${String(win.totalHeight)}px` } },
          h('div', { class: 'preview-list-rows', style: { transform: `translateY(${String(win.offsetTop)}px)` } }, listRows(data, win, highlightLine, worst, { breakpoints: bpSet, executing: executingLine, onToggleBreakpoint: onToggle, ...(onReportLine === undefined ? {} : { onReportLine }) })),
        ),
      ),
      jumpBack ? h('button', { type: 'button', class: 'gcode-jump-current', 'data-gcode': 'jump-to-current', onClick: () => { dispatch({ kind: 'jump-to-current' }); } }, `Jump to current · line ${String(executingLine)}`) : null,
    ),
  );
}
