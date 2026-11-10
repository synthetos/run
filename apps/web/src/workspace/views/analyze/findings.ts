/**
 * "What to fix" (docs/design/ANALYZE.md §3, slice 1): the report's findings, ranked. Each says what it is in one or
 * two short lines, one thing to do, and where (a sent-line range for the toolpath and a first line for the G-code
 * list); the rest goes behind Details. The dense sections become one finding with real numbers, never one card each.
 * When the firmware model says short moves slow the machine, that card takes the tiny-moves numbers and links, so the
 * same fix is never said twice. Pure.
 */
import type { Estimate, ProgramReport, Region } from '@synthetos/advisor';
import { lineRange, plural, shortMm, time, whole } from './format.ts';
import { plungeFindings } from './plunges.ts';
import { speedCause, speedFix } from './speedFix.ts';
import { camTip, CAM_TOLERANCE } from './camTip.ts';
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
  const where = lineRange(first.fromLine, last.toLine).toLowerCase();
  return {
    id: 'tiny',
    kind: 'tiny',
    title: most ? `Most of this file is ${word} moves` : `Many ${word} moves`,
    meaning: under01 > 0 ? [`${whole(under01)} of ${whole(moves)} moves are under 0.1 mm.`, `Most are in ${where}.`] : [`${plural(denseLines, 'short move', 'short moves')} in ${where}.`],
    todo: [camTip(cam)],
    details: [...(median === null || quarter === null ? [] : [`Half are under ${shortMm(median)}.`, `A quarter are under ${shortMm(quarter)}.`]), CAM_TOLERANCE, 'A smoother copy is coming.'],
    fromSent: first.fromSent,
    toSent: last.toSent,
    line: first.fromLine,
    lineSent: first.fromSent,
    linked: true,
    regions,
    weight: most ? Infinity : regions.reduce((s, r) => s + r.seconds, 0),
  };
}

function plungeFixes(report: ProgramReport): Fix[] {
  return plungeFindings(report).map((f) => {
    const r = f.regime;
    const seconds = r.seconds as number;
    return {
      id: `plunge-${f.operation.id}`,
      kind: 'plunge',
      title: `Slow plunges: ${whole(f.share * 100)}% of ${f.operation.name}`,
      meaning: [`${plural(r.moves, 'plunge', 'plunges')} at ${whole(r.feed as number)} mm/min: ${time(seconds)}.`, `Each starts ${shortMm(r.mm / r.moves)} up.`],
      todo: ['In your CAM, start plunges lower or ramp in.'],
      details: ['A faster plunge feed also helps, if the tool allows.'],
      fromSent: r.firstSent,
      toSent: r.firstSent,
      line: r.firstLine,
      lineSent: r.firstSent,
      linked: true,
      regions: [],
      weight: seconds,
    };
  });
}

function slowFixes(report: ProgramReport): Fix[] {
  return report.slow.map((s) => ({
    id: s.id,
    kind: 'slow',
    title: `Slow stretch (${time(s.seconds)})`,
    meaning: [`${lineRange(s.fromLine, s.toLine)} ${s.fromLine === s.toLine ? 'runs' : 'run'} at ${whole(s.feed)} mm/min, below the rest.`],
    todo: ['Check this feed in your CAM.'],
    details: [],
    fromSent: s.fromSent,
    toSent: s.toSent,
    line: s.fromLine,
    lineSent: s.fromSent,
    linked: true,
    regions: [],
    weight: s.seconds,
  }));
}

/** The speed card for short moves, with the tiny-moves card's numbers, links and sections folded in. */
function merged(speed: Fix, tiny: Fix): Fix {
  return { ...tiny, id: speed.id, kind: speed.kind, title: speed.title, meaning: [...speed.meaning, ...tiny.meaning], todo: speed.todo, details: [...speed.details.filter((d) => d !== CAM_TOLERANCE), ...tiny.details], weight: Math.max(speed.weight, tiny.weight) };
}

export function fixesFor(report: ProgramReport, cam: string | null, estimate: Estimate | null = null): Fix[] {
  const speed = estimate === null ? null : speedFix(estimate, report, cam);
  const tiny = tinyFix(report, cam);
  const top = speed !== null && tiny !== null && speedCause(estimate) === 'short' ? [merged(speed, tiny)] : [speed, tiny].filter((f): f is Fix => f !== null);
  return [...top, ...plungeFixes(report), ...slowFixes(report)].sort((a, b) => b.weight - a.weight);
}
