/**
 * Operations with their feed regimes (docs/design/ANALYZE.md §3, slice 1): one card per CAM operation, with the
 * plunges, ramps and cuts at each programmed feed under it, never one card per feed. An operation starts at a tool
 * change or at a heading comment; spans with the same name and tool are one operation. Headings only name things:
 * they never stop motion or reset anything in time. Pure.
 */
import { TAPE_KIND, type FeedRegime, type OperationHeading, type OperationSummary, type ProgramTape } from './types.ts';
import { feedSeconds, isFeedMove, known, regimeKind } from './moves.ts';

interface Building {
  id: string;
  name: string;
  tool: number | null;
  fromLine: number;
  toLine: number;
  spans: { fromLine: number; toLine: number }[];
  feedMm: number;
  seconds: number | null;
  regimes: Map<string, { -readonly [K in keyof FeedRegime]: FeedRegime[K] }>;
}

export function operations(t: ProgramTape, headings: readonly OperationHeading[]): OperationSummary[] {
  const sorted = [...headings].sort((a, b) => a.line - b.line);
  const byKey = new Map<string, Building>();
  let h = 0;
  let name: string | null = null;
  let changed = false;
  let current: Building | null = null;
  for (let e = 0; e < t.count; e++) {
    const line = t.source[e] as number;
    while (h < sorted.length && (sorted[h] as OperationHeading).line <= line) name = (sorted[h++] as OperationHeading).name;
    if (t.kinds[e] === TAPE_KIND.TOOL_CHANGE) changed = true;
    if (!isFeedMove(t, e)) continue;
    const tool = known(t.tool[e]);
    const label = name ?? (tool !== null ? `Tool ${tool}` : changed ? 'After the tool change' : 'Whole file');
    const key = `${label}\u0000${tool ?? ''}`;
    let op = byKey.get(key);
    if (op === undefined) {
      op = { id: `op-${byKey.size + 1}`, name: label, tool, fromLine: line, toLine: line, spans: [], feedMm: 0, seconds: 0, regimes: new Map() };
      byKey.set(key, op);
    }
    // Another operation ran in between: this one continues in a new span.
    if (op !== current) op.spans.push({ fromLine: line, toLine: line });
    current = op;
    (op.spans[op.spans.length - 1] as { toLine: number }).toLine = line;
    const kind = regimeKind(t, e);
    const feed = known(t.feed[e]);
    const s = feedSeconds(t, e);
    const mm = t.lengthMm[e] as number;
    op.toLine = line;
    op.feedMm += mm;
    op.seconds = op.seconds === null || s === null ? null : op.seconds + s;
    const rk = `${kind}\u0000${feed ?? ''}`;
    const r = op.regimes.get(rk);
    if (r === undefined) op.regimes.set(rk, { kind, feed, spindle: known(t.spindle[e]), moves: 1, mm, seconds: s, firstLine: line, firstSent: t.sent[e] as number });
    else {
      r.moves++;
      r.mm += mm;
      r.seconds = r.seconds === null || s === null ? null : r.seconds + s;
    }
  }
  return [...byKey.values()].map((o) => ({ id: o.id, name: o.name, tool: o.tool, fromLine: o.fromLine, toLine: o.toLine, spans: o.spans, feedMm: o.feedMm, seconds: o.seconds, regimes: [...o.regimes.values()] }));
}
