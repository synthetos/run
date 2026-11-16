import type { DialectJobGcode, GcodeRule } from '@synthetos/protocol';
import { extentAt } from '../extent.ts';
import { canonicalCode, type Word } from '../lex.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding } from './contract.ts';
import { GROUP } from './tables.ts';

export function collectWords(ctx: ModelContext, { words }: CollectWordsInput): { params: Map<string, Word>; findings: Finding[]; job: DialectJobGcode; has: (code: string) => boolean; codes: { word: Word; code: string; }[] } {

  const findings: Finding[] = [];
  ctx._extent = extentAt(ctx.machine);
  const codes: { word: Word; code: string }[] = [];
  const params = new Map<string, Word>();
  const job = ctx._job;

  for (const w of words) {
    if (w.letter === 'G' || w.letter === 'M') {
      const code = canonicalCode(w);
      const f = checkCode(ctx, w, code);
      if (f === null) codes.push({ word: w, code: code as string });
      else findings.push(f);
      continue;
    }
    if (params.has(w.letter)) {
      findings.push(block('modal-conflict', `two ${w.letter} words on one line`));
      continue;
    }
    params.set(w.letter, w);
    const rule = ctx._rules.find((r): r is Extract<GcodeRule, { kind: 'word' }> => r.kind === 'word' && r.letter === w.letter);
    if (rule !== undefined) findings.push(block(rule.id, rule.reason));
    else if (!job.words.includes(w.letter)) findings.push(block('unsupported-word', `${w.letter} words are not supported by this firmware`));
  }

  const has = (code: string): boolean => codes.some((c) => c.code === code);
  checkGroups(codes.map((c) => c.code), findings);
  return { params, findings, job, has, codes };
}

/** null when the code may be sent; otherwise the finding that blocks (or warns about) it. */
export function checkCode(ctx: ModelContext, word: Word, code: string | undefined): Finding | null {
  const label = `${word.letter}${word.text}`;
  if (code === undefined) return block('unsupported-code', `${label} is not a valid code`);
  if (code === 'M100') return block('m100', 'M100 runs in-stream JSON commands and is never sent');
  if (/^G38(\.|$)/.test(code)) return block('probe', 'probing (G38) is not allowed in a job in this version');
  const rule = ctx._rules.find((r) => r.kind === 'code' && r.code === code);
  if (rule !== undefined) return block(rule.id, rule.reason);
  if (ctx._job.ignoredCodes.includes(code)) return { severity: 'warn', rule: 'ignored-code', message: `${code} is accepted and ignored by this firmware` };
  if (ctx._job.codes.includes(code)) return null;
  const dotted = code.includes('.') ? ` (a dotted code is never sent as ${code.split('.')[0]})` : '';
  return block('unsupported-code', `${code} is not supported in a job on this firmware${dotted}`);
}

export function checkGroups(codes: readonly string[], findings: Finding[]): void {
  const seen = new Map<string, string>();
  for (const code of codes) {
    const group = GROUP[code] ?? code;
    const prior = seen.get(group);
    seen.set(group, code);
    if (prior === undefined) continue;
    // EN allows M7 with M8 (SET_COOLANT_ON), but not M9 with either, or a repeat.
    if (group === 'coolant' && prior !== code && prior !== 'M9' && code !== 'M9') continue;
    findings.push(block('modal-conflict', `${prior} and ${code} are in the same modal group (E152)`));
  }
}

interface CollectWordsInput {
  words: readonly Word[]
}
