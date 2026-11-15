import { expect, it } from 'vitest';
import { BASELINE_PATH } from '../src/modularity/types.ts';
import { writeLintStub } from './lintStub.ts';
it('removes only the replacement file’s legacy allowances, without changing lint configuration', () => {
  const path = 'packages/safety/src/strings.ts';
  const other = 'apps/web/src/security/tt.ts';
  const baseline = { format: 1, files: { [path]: { 'max-lines $file': 900 }, [other]: { 'complexity checkSvgAllowlist': 20 } } };
  const original = JSON.stringify(baseline);
  const files = new Map([[BASELINE_PATH, original], ['eslint.config.js', 'rules stay on']]);
  writeLintStub({ read: p => files.get(p)!, write: (p, code) => { files.set(p, code); } }, path, 'export const stub = 1;\n');
  expect(JSON.parse(files.get(BASELINE_PATH)!)).toEqual({ format: 1, files: { [other]: baseline.files[other] } });
  expect(files.get(path)).toBe('export const stub = 1;\n');
  expect(files.get('eslint.config.js')).toBe('rules stay on');
  expect(JSON.stringify(baseline)).toBe(original);
});
