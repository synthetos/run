/**
 * The G-code list's presentation (owner feedback, polish 1): routine
 * renumbering gets no row, the window follows the measured viewport, Follow
 * keeps the executing line in view until the list is scrolled by hand,
 * rows alternate, and breakpoints are kept per file in this browser.
 */
import { describe, expect, it } from 'vitest';
import { listWindow } from '@synthetos/gcode-view';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';
import {
  executingFileLine,
  fileKey,
  followReducer,
  followScrollTop,
  lineInView,
  loadBreakpoints,
  MAX_BREAKPOINT_FILES,
  parseJumpLine,
  queuedBreakpoints,
  renumbered,
  routineChanges,
  saveBreakpoints,
  shownCounts,
  showJumpToCurrent,
  toggleBreakpoint,
} from '../src/preview/gcodeList.ts';
import { listRows, ROW_HEIGHT, worstByLine } from '../src/preview/LineList.ts';
import type { StorageLike } from '../src/workspace/storage.ts';
import { one, root, type El } from './tree.ts';

const bytesOf = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

describe('routine renumbering', () => {
  const numbered = 'N10 G21 G90\nN20 G0 X10 Y10\nN30 G0 X20\nN40 M30\n';
  const { result } = analyseBytes(bytesOf(numbered), { dialect: 'tinyg-en', mode: 'full' });

  it('the sanitiser still reports and counts it, but the list shows no row for it', () => {
    expect(result.summary.counts.change).toBe(4);
    expect(Array.from(result.verdicts)).toEqual([0, 0, 0, 0]);
    expect(renumbered(result)).toBe(4);
    expect(shownCounts(result).change).toBe(result.summary.counts.change - 4);
  });

  it('comments removed and empty lines are routine too: one summary, no per-line rows; real changes keep theirs', () => {
    const src = '(header comment)\nN5 G21 G90 (units)\n\nG0 X1\nT2 M6\nM30\n';
    const { result: r } = analyseBytes(bytesOf(src), { dialect: 'tinyg-en', mode: 'full' });
    const routine = routineChanges(r);
    expect(routine.comments).toBeGreaterThanOrEqual(2);
    expect(routine.renumbered).toBe(1);
    expect(r.verdicts[0]).toBe(0);
    expect(r.verdicts[1]).toBe(0);
    expect(r.verdicts[4]).toBeGreaterThan(0);
    expect(shownCounts(r).change).toBe(r.summary.counts.change - routine.total);
  });

  it('worstByLine drops the renumber finding but keeps a real one on the same line', () => {
    const w = worstByLine([
      { line: 2, n: 2, severity: 'change', rule: 'n-word-stripped', message: 'line number replaced by the host line number', source: 'sanitizer' },
      { line: 3, n: 3, severity: 'change', rule: 'n-word-stripped', message: 'line number replaced by the host line number', source: 'sanitizer' },
      { line: 3, n: 3, severity: 'info', rule: 'other', message: 'real', source: 'analyser' },
    ]);
    expect(w.has(2)).toBe(false);
    expect(w.get(3)?.message).toBe('real');
  });
});

describe('virtualised rows', () => {
  const big = 'G1 X1\n'.repeat(75_000);
  const { result } = analyseBytes(bytesOf(big), { dialect: 'tinyg-en', mode: 'lite' });
  const data = { bytes: result.bytes, spans: result.spans, verdicts: result.verdicts };

  it('renders only the rows in the measured viewport (plus overscan), whatever the file size', () => {
    const win = listWindow({ count: result.fileLines, rowHeight: ROW_HEIGHT, scrollTop: 40_000 * ROW_HEIGHT, viewportHeight: 154, overscan: 20 });
    const rows = listRows(data, win, 0, new Map());
    expect(rows.length).toBeLessThan(60);
    expect((root(rows[0]) as El).props['data-line']).toBe(win.first + 1);
  });

  it('rows alternate by file line, carry a gutter toggle, and mark breakpoints and the executing line', () => {
    const win = listWindow({ count: result.fileLines, rowHeight: ROW_HEIGHT, scrollTop: 0, viewportHeight: 110, overscan: 0 });
    const toggled: number[] = [];
    const rows = listRows(data, win, 0, new Map(), { breakpoints: new Set([2]), executing: 3, onToggleBreakpoint: (l) => toggled.push(l) }).map((r) => root(r));
    expect(rows.map((r) => r.props['data-odd'])).toEqual(['true', undefined, 'true', undefined, 'true']);
    expect(rows[1]?.props['data-breakpoint']).toBe('true');
    expect(rows[2]?.props['data-executing']).toBe('true');
    const gutter = one(rows[1] as El, (e) => e.props['data-gcode'] === 'breakpoint');
    expect(gutter.props['aria-pressed']).toBe('true');
    expect(gutter.props['aria-label']).toBe('Breakpoint on line 2');
    (gutter.props['onClick'] as () => void)();
    expect(toggled).toEqual([2]);
  });
});

describe('Follow', () => {
  const v = { scrollTop: 0, viewportHeight: 220, rowHeight: 22, count: 75_000 };

  it('maps the reported host line to the file line through the sent lines', () => {
    const sent = Uint32Array.from([1, 2, 4, 5]);
    expect(executingFileLine(3, sent)).toBe(4);
    expect(executingFileLine(0, sent)).toBeNull();
    expect(executingFileLine(9, sent)).toBeNull();
    expect(executingFileLine(null, sent)).toBeNull();
  });

  it('scrolls only when the executing line leaves the view, and puts it a third of the way down', () => {
    expect(followScrollTop(5, v)).toBeNull();
    expect(lineInView(10, v)).toBe(true);
    expect(followScrollTop(1000, v)).toBe(999 * 22 - 73);
    expect(followScrollTop(1, { ...v, scrollTop: 5000 })).toBe(0);
    expect(followScrollTop(75_000, v)).toBe(75_000 * 22 - 220);
    expect(followScrollTop(null, v)).toBeNull();
  });

  it('is on by default; scrolling by hand turns it off; "Jump to current" turns it back on', () => {
    let s = { follow: true };
    expect(showJumpToCurrent(s, 12)).toBe(false);
    s = followReducer(s, { kind: 'manual-scroll' });
    expect(s.follow).toBe(false);
    expect(showJumpToCurrent(s, 12)).toBe(true);
    expect(showJumpToCurrent(s, null)).toBe(false);
    s = followReducer(s, { kind: 'jump-to-current' });
    expect(s.follow).toBe(true);
    expect(followReducer(s, { kind: 'toggle' }).follow).toBe(false);
  });

  it('go to line accepts a line in the file only', () => {
    expect(parseJumpLine(' 42 ', 100)).toBe(42);
    expect(parseJumpLine('0', 100)).toBeNull();
    expect(parseJumpLine('101', 100)).toBeNull();
    expect(parseJumpLine('4x', 100)).toBeNull();
  });
});

describe('breakpoints', () => {
  it('toggle, keep per file (name, size and content), and survive a reload', () => {
    const s = memory();
    const a = fileKey('part.nc', bytesOf('G1 X1\n'));
    const b = fileKey('part.nc', bytesOf('G1 X2\n'));
    expect(a).not.toBe(b);
    let lines = toggleBreakpoint([], 7);
    lines = toggleBreakpoint(lines, 3);
    expect(lines).toEqual([3, 7]);
    expect(saveBreakpoints(a, lines, s)).toBe(true);
    expect(loadBreakpoints(a, s)).toEqual([3, 7]);
    expect(loadBreakpoints(b, s)).toEqual([]);
    expect(saveBreakpoints(a, toggleBreakpoint(lines, 3), s)).toBe(true);
    expect(loadBreakpoints(a, s)).toEqual([7]);
  });

  it('works without storage, drops damaged data and keeps at most the newest files', () => {
    const refusing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(saveBreakpoints('k', [1], refusing)).toBe(false);
    expect(loadBreakpoints('k', refusing)).toEqual([]);
    const s = memory();
    s.setItem('run.ws.breakpoints', '{"v":1,"value":{"k":["x"]}}');
    expect(loadBreakpoints('k', s)).toEqual([]);
    for (let i = 0; i < MAX_BREAKPOINT_FILES + 5; i++) saveBreakpoints(`f${i}`, [1], s);
    expect(loadBreakpoints('f0', s)).toEqual([]);
    expect(loadBreakpoints(`f${MAX_BREAKPOINT_FILES + 4}`, s)).toEqual([1]);
  });

  it('a breakpoint inside the queued band is reported: those lines cannot be recalled', () => {
    expect(queuedBreakpoints([5, 12, 40], 10, 30)).toEqual([12]);
    expect(queuedBreakpoints([5, 12], null, null)).toEqual([]);
  });
});
