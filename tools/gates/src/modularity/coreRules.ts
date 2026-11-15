import type { Rule } from 'eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import { CORE_METRICS } from './types.ts';
import { recorder, RATCHET_MESSAGES } from './ratchet.ts';

/** Reuse ESLint's pinned implementations, including TS-aware parser nodes and code-path complexity. */
function wrap(name: keyof typeof CORE_METRICS): Rule.RuleModule {
  const core = builtinRules.get(name);
  if (!core) throw new Error(`Missing ESLint metric ${name}`);
  return {
    meta: { ...core.meta, messages: RATCHET_MESSAGES },
    create(context) {
      const measurements = recorder(context, [name]);
      const report = (descriptor: { node?: Rule.Node; data?: Record<string, unknown> }): void => {
        const value = descriptor.data?.[CORE_METRICS[name]];
        if (typeof value !== 'number') throw new Error(`Unsupported ESLint ${name} measurement`);
        measurements.record(name, value, descriptor.node ?? context.sourceCode.ast as Rule.Node);
      };
      const proxy = Object.create(context, { report: { value: report } }) as Rule.RuleContext;
      const listeners = core.create(proxy);
      const exit = listeners['Program:exit'];
      return { ...listeners, 'Program:exit': (node) => { exit?.(node); measurements.finish(); } };
    },
  };
}
export const modularityCoreRules = Object.fromEntries(Object.keys(CORE_METRICS).map(name => [name, wrap(name as keyof typeof CORE_METRICS)]));
