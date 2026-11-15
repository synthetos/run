import { relative } from 'node:path';
import type { Rule } from 'eslint';
import { identities } from './identity.ts';
import { measurementKey, type BaselineFile, type Measurement } from './types.ts';

export interface ModularitySettings { readonly root: string; readonly baseline: BaselineFile }
interface Found { measurement: Measurement; node: Rule.Node }
/** Each rule owns its measurements; depth is the maximum per function, not a report per nested block. */
export function recorder(context: Rule.RuleContext, metrics: readonly string[]) {
  const settings = context.settings['modularity'] as ModularitySettings | undefined;
  const file = relative(settings?.root ?? context.cwd, context.filename).replaceAll('\\', '/');
  const expected = settings?.baseline.files[file] ?? {};
  const found = new Map<string, Found>();
  let identify: ReturnType<typeof identities> | undefined;
  function record(metric: string, actual: number, node: Rule.Node): void {
    identify ??= identities(context.sourceCode);
    const measurement = { metric, symbol: identify(node, metric), actual };
    const key = measurementKey(measurement);
    if (actual > (found.get(key)?.measurement.actual ?? -1)) found.set(key, { measurement, node });
  }
  function finish(): void {
    for (const [key, { measurement, node }] of found) {
      if (expected[key] === measurement.actual) continue;
      const reason = expected[key] === undefined ? 'New over-limit item: split it.' : measurement.actual > expected[key] ? 'Worse than baseline: split the changed concern.' : 'Improved: lower the baseline to this value.';
      context.report({ node, messageId: 'measurement', data: { measurement: JSON.stringify(measurement), reason } });
    }
    for (const key of Object.keys(expected)) {
      if (metrics.some(metric => key.startsWith(`${metric} `)) && !found.has(key)) context.report({ node: context.sourceCode.ast, messageId: 'stale', data: { key } });
    }
  }
  return { record, finish };
}
export const RATCHET_MESSAGES = {
  measurement: 'Modularity: {{measurement}}. {{reason}}',
  stale: 'Modularity baseline entry {{key}} is fixed or absent: remove it (never transfer its allowance to a new symbol).',
};
