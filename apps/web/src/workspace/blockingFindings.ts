/** Original source lines, including lines rejected before motion was generated. */
import type { Finding } from '@synthetos/gcode';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import type { Note } from './notes/notes.ts';
export function blockingFindings(preview: PreviewResult | undefined): readonly Finding[] {
  const found = new Map<string, Finding>();
  for (const finding of preview?.summary.blocks ?? []) found.set(`${finding.line}/${finding.rule}/${finding.message}`, finding);
  return [...found.values()].sort((a, b) => a.line - b.line);
}
export function blockedLines(blocks: readonly { readonly line: number }[]): readonly number[] {
  return [...new Set(blocks.map(b => b.line))].sort((a, b) => a - b);
}
export function blockedFileNote(blocks: readonly { readonly line: number; readonly message: string }[]): Note[] {
  const lines = blockedLines(blocks);
  const first = lines[0];
  if (first === undefined) return [];
  return [{ id: 'blocked-file', topic: 'File', title: 'File needs changes.', tone: 'warn',
    body: `This file has ${lines.length} ${lines.length === 1 ? 'line that stops' : 'lines that stop'} it from running (${lines.map(l => l === 0 ? 'file setup' : `line ${l}`).join(', ')}).`,
    detail: blocks.map(b => b.message).join(' '), link: { kind: 'line', line: Math.max(1, first), label: 'Show it' } }];
}
