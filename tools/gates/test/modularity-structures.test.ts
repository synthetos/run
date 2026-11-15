import { expect, it } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import plugin from '../src/eslint/plugin.ts';
function lint(code: string) {
  return new Linter().verify(code, [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, plugins: { run: plugin }, rules: { 'run/oversized-structure': 'error' } }], { filename: 'sample.ts' });
}
const members = (n: number, value = '() {}') => Array.from({ length: n }, (_, i) => `m${i}${value}`).join(',');
it('permits exactly 15 object methods and rejects 16 (including arrows and getters)', () => {
  expect(lint(`const a={${members(15)}}`)).toEqual([]);
  expect(lint(`const a={${members(16)}}`)[0]?.message).toContain('"actual":16');
  expect(lint(`const a={${members(16, ': () => 1')}}`)).toHaveLength(1);
  expect(lint(`const a={${Array.from({ length: 16 }, (_, i) => `get a${i}(){return 1}`).join(',')}}`)).toHaveLength(1);
  expect(lint(`const a={${members(16, ': 1')}}`)).toEqual([]);
});
it('counts class methods and function fields, not constructor or data fields', () => {
  expect(lint(`class A { constructor() {} ${members(15).replaceAll(',', '\n')} }`)).toEqual([]);
  expect(lint(`class A { ${members(16).replaceAll(',', '\n')} }`)).toHaveLength(1);
  expect(lint(`class A { ${members(16, '=()=>1;').replaceAll(',', '\n')} }`)).toHaveLength(1);
});
it('counts local function references, shorthand, imported callable references and local spreads', () => {
  expect(lint(`function f(){} const a={${members(16, ': f')}}`)).toHaveLength(1);
  expect(lint(`import { f } from './f'; const a={${members(16, ': f')}}`)).toHaveLength(1);
  expect(lint(`const data=1; const a={${members(16, ': data')}}`)).toEqual([]);
  const code = `const a={${members(15)}}; const b={...a, extra(){}};`;
  expect(lint(code)).toHaveLength(1);
  expect(lint('const a={...a}; const b={...unknown};')).toEqual([]);
});
it('counts default with switch cases, permits 25 and rejects 26', () => {
  const cases = Array.from({ length: 25 }, (_, i) => `case ${i}: break;`).join('');
  expect(lint(`switch(x){${cases}}`)).toEqual([]);
  expect(lint(`switch(x){${cases}default:break;}`)[0]?.message).toContain('"actual":26');
});
