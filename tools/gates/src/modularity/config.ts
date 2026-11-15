import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Linter } from 'eslint';
import { BASELINE_PATH, readBaseline } from './types.ts';

const lines = (max: number): Linter.RuleEntry => ['error', { max, skipBlankLines: true, skipComments: true }];
/** Strict limits with exact per-symbol legacy allowances; never a raised per-file function limit. */
export function modularityConfig(root: string): Linter.Config[] {
  const baseline = readBaseline(JSON.parse(readFileSync(join(root, BASELINE_PATH), 'utf8')));
  return [
    {
      files: ['{apps,packages,tools,workers}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
      settings: { modularity: { root, baseline } },
      rules: {
        'run/max-lines': lines(400),
        'run/max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
        'run/complexity': ['error', { max: 15, variant: 'classic' }],
        'run/max-depth': ['error', 4],
        'run/max-params': ['error', 4],
        'run/max-nested-callbacks': ['error', { max: 3, checkConstructorCallCallbacks: true }],
        'run/max-classes-per-file': ['error', 1],
        'run/oversized-structure': 'error',
      },
    },
    {
      files: ['{apps,packages,tools,workers}/**/{test,tests,specs}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '{apps,packages,tools,workers}/**/*.{test,spec,e2e,fake-serial}.{ts,tsx,js,mjs}'],
      rules: { 'run/max-lines': lines(600) },
    },
  ];
}
