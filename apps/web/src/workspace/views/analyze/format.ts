/** Number and source words for the Analyze view (docs/design/ANALYZE.md slice 1). Short sentences. */
import type { Evidence } from '@synthetos/advisor';
import { duration } from '../../jobUi.ts';

export const whole = (v: number): string => Math.round(v).toLocaleString('en-US');

export function mm(v: number): string {
  return v >= 10_000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} m` : `${whole(v)} mm`;
}

/** A short length with enough digits to mean something: 0.04 mm, 0.3 mm, 2.5 mm, 12 mm. */
export function shortMm(v: number): string {
  const digits = v < 0.01 ? 3 : v < 1 ? 2 : v < 10 ? 1 : 0;
  return `${Number(v.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: 3 })} mm`;
}

export function time(seconds: number): string {
  return duration(seconds);
}

/** "From the file", "Board settings", "Last read 9 Nov, 14:02", "Machine profile (…)", "Not known". */
export function sourceText(e: Evidence<unknown>): string {
  return e.label;
}

export function plural(n: number, one: string, many: string): string {
  return `${whole(n)} ${n === 1 ? one : many}`;
}

export function lineRange(from: number, to: number): string {
  return from === to ? `Line ${whole(from)}` : `Lines ${whole(from)}–${whole(to)}`;
}
