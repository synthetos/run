/** One "What to fix" finding (findings.ts): what it means, what to do, and where. */
import type { Region } from '@synthetos/advisor';

export interface Fix {
  readonly id: string;
  readonly kind: 'tiny' | 'plunge' | 'slow' | 'speed';
  readonly title: string;
  /** What it means, in short sentences. */
  readonly meaning: readonly string[];
  /** What to do, in short sentences. */
  readonly todo: readonly string[];
  /** Where: the sent-line range to show on the toolpath, and the first file line (with its sent index). */
  readonly fromSent: number;
  readonly toSent: number;
  readonly line: number;
  readonly lineSent: number;
  /** False for a whole-file finding with no one place to show (the links are left out). */
  readonly linked: boolean;
  /** The dense sections behind a tiny-moves finding (Advanced lists them). */
  readonly regions: readonly Region[];
  /** For ranking: the programmed seconds at stake (a tiny-moves finding that covers most of the file ranks first). */
  readonly weight: number;
}
