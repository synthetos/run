import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
const root = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: root });
it('applies 400 source / 600 test lines, with every other limit unchanged', async () => {
  for (const name of ['apps/web/src/sample.ts', 'packages/machine/test/sample.test.ts', 'workers/run/src/catalogData.ts', 'tools/e2e/specs/sample.e2e.ts']) {
    const config = await eslint.calculateConfigForFile(resolve(root, name));
    const test = name.includes('/test/') || name.includes('/specs/');
    expect(config.rules['run/max-lines']).toEqual([2, { max: test ? 600 : 400, skipBlankLines: true, skipComments: true }]);
    expect(config.rules['run/max-lines-per-function'][1].max).toBe(80);
    expect(config.rules['run/complexity'][1].max).toBe(15);
    expect(config.rules['run/max-depth'][1]).toBe(4);
    expect(config.rules['run/max-params'][1]).toBe(4);
    expect(config.rules['run/max-nested-callbacks'][1].max).toBe(3);
    expect(config.rules['run/max-classes-per-file'][1]).toBe(1);
    expect(config.rules['run/oversized-structure'][0]).toBe(2);
    expect(config.linterOptions.noInlineConfig).toBe(true);
  }
  const docs = await eslint.calculateConfigForFile(resolve(root, 'docs/design/sample.mjs'));
  expect(docs?.rules?.['run/max-lines']).toBeUndefined();
});
