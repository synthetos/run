/**
 * The G-code list (ROADMAP TB-03): virtualised, so a million-line file
 * renders only the rows in view. Each row shows the file line, its safety
 * verdict and, for rows in view, the worst finding's message, fetched from
 * the worker for the visible range only.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Finding } from '@synthetos/gcode';
import { listWindow, scrollTopFor, type ListWindow } from '@synthetos/gcode-view';
import { lineText } from '../gcode-worker/lines.ts';

export const ROW_HEIGHT = 22;
export const LIST_HEIGHT = 330;

/** Verdict codes (gcode `VERDICT`) as the words the list shows. */
export const VERDICT_WORD = ['', 'info', 'change', 'warn', 'block'] as const;

export interface ListData {
  readonly bytes: Uint8Array;
  readonly spans: Uint32Array;
  readonly verdicts: Uint8Array;
}

const RANK: Readonly<Record<string, number>> = { info: 1, change: 2, warn: 3, block: 4 };

/** The worst finding per file line. */
export function worstByLine(findings: readonly Finding[]): Map<number, Finding> {
  const out = new Map<number, Finding>();
  for (const f of findings) {
    const had = out.get(f.line);
    if (had === undefined || (RANK[f.severity] ?? 0) > (RANK[had.severity] ?? 0)) out.set(f.line, f);
  }
  return out;
}

/** The rows of one window (pure, for the tests). `highlightLine` is a 1-based file line; 0 for none. */
export function listRows(data: ListData, win: ListWindow, highlightLine: number, worst: ReadonlyMap<number, Finding>): ComponentChild[] {
  const rows: ComponentChild[] = [];
  for (let i = win.first; i < win.end; i++) {
    const line = i + 1;
    const word = VERDICT_WORD[data.verdicts[i] ?? 0] ?? '';
    const finding = worst.get(line);
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
        },
        h('span', { class: 'preview-row-n' }, String(line)),
        h('span', { class: 'verdict-badge', 'aria-label': word === '' ? 'no findings' : `verdict ${word}` }, word),
        h('code', { class: 'preview-row-text' }, lineText(data.bytes, data.spans, i)),
        h('span', { class: 'preview-row-finding' }, finding?.message ?? ''),
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
}

export function LineList({ data, highlightLine, revealLine, fetchFindings }: LineListProps): ComponentChild {
  const count = data.spans.length / 2;
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [worst, setWorst] = useState<ReadonlyMap<number, Finding>>(new Map());
  const win = listWindow({ count, rowHeight: ROW_HEIGHT, scrollTop, viewportHeight: LIST_HEIGHT });

  useEffect(() => {
    if (revealLine < 1 || box.current === null) return;
    const top = scrollTopFor(revealLine - 1, { count, rowHeight: ROW_HEIGHT, viewportHeight: LIST_HEIGHT });
    const el = box.current;
    if (Math.abs(el.scrollTop - top) > LIST_HEIGHT / 2) el.scrollTop = top;
  }, [revealLine, count]);

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

  return h(
    'div',
    {
      ref: box,
      class: 'preview-list',
      tabIndex: 0,
      role: 'list',
      'aria-label': `G-code lines (${count.toLocaleString('en-US')})`,
      'data-preview': 'list',
      style: { height: `${String(LIST_HEIGHT)}px` },
      onScroll: (e: Event) => { setScrollTop((e.currentTarget as HTMLDivElement).scrollTop); },
    },
    h(
      'div',
      { class: 'preview-list-space', style: { height: `${String(win.totalHeight)}px` } },
      h('div', { class: 'preview-list-rows', style: { transform: `translateY(${String(win.offsetTop)}px)` } }, listRows(data, win, highlightLine, worst)),
    ),
  );
}
