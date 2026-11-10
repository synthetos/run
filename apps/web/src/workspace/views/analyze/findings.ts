/**
 * "What to fix" (docs/design/ANALYZE.md §3, slice 1): the report's findings, ranked, each saying what it means, what
 * to do, and where (a sent-line range for the toolpath and a first line for the G-code list). The dense sections
 * become one finding with real numbers, never one card each. Pure.
 */
import type { Estimate, ProgramReport, Region } from '@synthetos/advisor';
import { lineRange, plural, shortMm, time, whole } from './format.ts';
import { plungeFindings } from './plunges.ts';
import { speedFix } from './speedFix.ts';
import { camTip } from './camTip.ts';
import type { Fix } from './fix.ts';

export type { Fix } from './fix.ts';
export { camTip } from './camTip.ts';

function tinyFix(report: ProgramReport, cam: string | null): Fix | null {
  const regions = report.density.regions;
  if (regions.length === 0) return null;
  const first = regions[0] as Region;
  const last = regions[regions.length - 1] as Region;
  const largest = regions.reduce((a, b) => (b.lines > a.lines ? b : a));
  const denseLines = regions.reduce((n, r) => n + r.lines, 0);
  const { moves, under01, median, quarter } = report.moveLengths;
  const most = moves > 0 && denseLines / moves >= 0.5;
  // "Tiny" for moves under 0.2 mm on average (the largest dense section), else "short".
  const word = largest.meanMoveMm < 0.2 ? 'tiny' : 'short';
  const meaning = [
    under01 > 0 ? `${whole(under01)} of ${whole(moves)} moves are under 0.1 mm. Most are in ${lineRange(first.fromLine, last.toLine).toLowerCase()}.` : `${plural(denseLines, 'short move', 'short moves')}, in ${lineRange(first.fromLine, last.toLine).toLowerCase()}.`,
    median === null || quarter === null ? '' : `Half the moves are under ${shortMm(median)}. A quarter are under ${shortMm(quarter)}.`,
    `The machine can’t reach ${whole(largest.feed)} mm/min on moves this short, so real time will be much longer.`,
  ].filter((s) => s !== '');
  return {
    id: 'tiny',
    kind: 'tiny',
    title: most ? `Most of this file is ${word} moves` : `Many ${word} moves`,
    meaning,
    todo: [camTip(cam), 'Fewer, longer moves run faster and smoother.', 'A smoother copy (merge tiny moves, fit arcs) is coming.'],
    fromSent: first.fromSent,
    toSent: last.toSent,
    line: first.fromLine,
    lineSent: first.fromSent,
    linked: true,
    regions,
    weight: most ? Infinity : regions.reduce((s, r) => s + r.seconds, 0),
  };
}

export function fixesFor(report: ProgramReport, cam: string | null, estimate: Estimate | null = null): Fix[] {
  const out: Fix[] = [];
  const speed = estimate === null ? null : speedFix(estimate, report, cam);
  if (speed !== null) out.push(speed);
  const tiny = tinyFix(report, cam);
  if (tiny !== null) out.push(tiny);
  for (const f of plungeFindings(report)) {
    const r = f.regime;
    const seconds = r.seconds as number;
    out.push({
      id: `plunge-${f.operation.id}`,
      kind: 'plunge',
      title: `Slow plunges in ${f.operation.name}`,
      meaning: [`${plural(r.moves, 'plunge', 'plunges')} at ${whole(r.feed as number)} mm/min take ${time(seconds)}.`, `That is ${whole(f.share * 100)}% of this operation. Each starts about ${shortMm(r.mm / r.moves)} up.`],
      todo: ['In your CAM, start plunges closer to the stock (a lower feed or retract height), or ramp in.', 'A faster plunge feed also helps, if the tool allows it.'],
      fromSent: r.firstSent,
      toSent: r.firstSent,
      line: r.firstLine,
      lineSent: r.firstSent,
      linked: true,
      regions: [],
      weight: seconds,
    });
  }
  for (const s of report.slow) {
    out.push({
      id: s.id,
      kind: 'slow',
      title: `A slow stretch: ${time(s.seconds)}`,
      meaning: [`${lineRange(s.fromLine, s.toLine)} ${s.fromLine === s.toLine ? 'runs' : 'run'} at ${whole(s.feed)} mm/min, well below the rest of the file.`],
      todo: ['If it should be faster, check this feed in your CAM.'],
      fromSent: s.fromSent,
      toSent: s.toSent,
      line: s.fromLine,
      lineSent: s.fromSent,
      linked: true,
      regions: [],
      weight: s.seconds,
    });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
