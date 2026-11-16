import {
  blockFindingText
} from '@synthetos/safety';
import { type Finding } from '../types.ts';
import { type InterpreterContext } from './state.ts';

export function addFinding(ctx: InterpreterContext, ...[line, n, severity, rule, message]: [line: number, n: number | null, severity: Finding['severity'], rule: string, message: string]): void {
  ctx.findings.push({ line, n, severity, rule, message: severity === 'block' ? blockFindingText(rule, message, line) : message, source: 'analyser' });
}

export function addFindingOnce(ctx: InterpreterContext, ...[key, line, n, severity, rule, message]: [key: string, line: number, n: number | null, severity: Finding['severity'], rule: string, message: string]): void {
  if (ctx.once.has(key)) return;
  ctx.once.add(key);
  addFinding(ctx, line, n, severity, rule, message);
}
