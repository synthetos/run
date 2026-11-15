import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import plugin from '../src/eslint/plugin.ts';
import { compareBaselines } from '../src/modularity/history.ts';
import { readBaseline, type BaselineFile } from '../src/modularity/types.ts';

const empty: BaselineFile = { format: 1, files: {} };
const file = '/repo/packages/example/src/sample.ts';
function lint(code: string, rules: Linter.RulesRecord, baseline = empty, filename = file) {
  return new Linter({ cwd: "/repo" }).verify(code, [{ files: ['**/*.{ts,js}'], languageOptions: { parser: tseslint.parser }, linterOptions: { noInlineConfig: true }, plugins: { run: plugin }, settings: { modularity: { root: '/repo', baseline } }, rules }], { filename });
}
function debt(messages: Linter.LintMessage[]): BaselineFile {
  const entries: Record<string, number> = {};
  for (const message of messages) {
    const match = /^Modularity: (\{.*\})\./.exec(message.message);
    if (!match) throw new Error(message.message);
    const m = JSON.parse(match[1]!) as { metric: string; symbol: string; actual: number };
    entries[`${m.metric} ${m.symbol}`] = m.actual;
  }
  return { format: 1, files: { 'packages/example/src/sample.ts': entries } };
}
const lineRules: Linter.RulesRecord = { 'run/max-lines-per-function': ['error', { max: 2, skipBlankLines: true, skipComments: true, IIFEs: true }] };
const long = 'function task() {\n const x = 1;\n return x;\n}';

describe('exact symbol ratchet', () => {
  it('fails new/worse functions, accepts exact debt, and requires lowering/removal on improvement', () => {
    const baseline = debt(lint(long, lineRules));
    expect(lint(long, lineRules, baseline)).toEqual([]);
    expect(lint(long.replace('return x;', 'const y = x;\n return y;'), lineRules, baseline)[0]?.message).toContain('Worse than baseline');
    const shorter = long.replace(' const x = 1;\n', '').replace('return x;', 'return 1;');
    expect(lint(shorter, lineRules, baseline)[0]?.message).toContain('lower the baseline');
    expect(lint('function task() {}', lineRules, baseline)[0]?.message).toContain('remove it');
    expect(lint(`${long}\n${long.replace('task', 'other')}`, lineRules, baseline)[0]?.message).toContain('New over-limit');
  });
  it('names methods/nested callbacks separately and survives comments and unrelated line shifts', () => {
    const code = `class C { task() {\n const x = 1;\n return x;\n} }\n${long}`;
    const messages = lint(code, lineRules);
    expect(messages).toHaveLength(2);
    const baseline = debt(messages);
    expect(lint(`// header\n\nconst unrelated = 1;\n${code}`, lineRules, baseline)).toEqual([]);
    expect(lint(code.replace('class C', 'class D'), lineRules, baseline)).toHaveLength(2);
  });
  it('tracks complexity, nesting, parameters, constructor callbacks and classes independently', () => {
    expect(lint('function f(a,b,c,d,e) { if(a) { if(b) { if(c) { if(d) { if(e) return 1; } } } } }', { 'run/max-params': ['error', 4], 'run/max-depth': ['error', 4], 'run/complexity': ['error', 5] })).toHaveLength(3);
    expect(lint('new P(() => new P(() => new P(() => new P(() => 1))))', { 'run/max-nested-callbacks': ['error', { max: 3, checkConstructorCallCallbacks: true }] })).toHaveLength(1);
    expect(lint('class A {} class B {}', { 'run/max-classes-per-file': ['error', 1] })).toHaveLength(1);
  });
  it('counts code lines, including IIFEs, but ignores blank/comment-only lines', () => {
    expect(lint('// comment\n\nconst x = 1;\n/* note */\n', { 'run/max-lines': ['error', { max: 1, skipComments: true, skipBlankLines: true }] })).toEqual([]);
    expect(lint('(() => {\nconst x = 1;\nreturn x;\n})();', lineRules)).toHaveLength(1);
  });
  it('cannot disable the limit inline or transfer an allowance to a different file', () => {
    expect(lint(`/* eslint-disable run/max-lines-per-function */\n${long}`, lineRules).some(m => m.ruleId === 'run/max-lines-per-function')).toBe(true);
    expect(lint(long, lineRules, debt(lint(long, lineRules)), '/repo/packages/example/src/new.ts')[0]?.message).toContain('New over-limit');
  });
});

describe('baseline integrity', () => {
  it('forbids same-change increases/new allowances, permits decreases/removal', () => {
    const a = debt(lint(long, lineRules));
    expect(compareBaselines(a, a)).toEqual([]);
    expect(compareBaselines(a, empty)).toEqual([]);
    expect(compareBaselines(empty, a)).toHaveLength(1);
    const higher = debt(lint(long.replace('return x;', 'let y;\nreturn x;'), lineRules));
    expect(compareBaselines(a, higher)[0]).toContain('Raised baseline');
    expect(compareBaselines(higher, a)).toEqual([]);
  });
  it('refuses invalid paths, measurements, formats and empty entries', () => {
    expect(readBaseline(empty)).toEqual(empty);
    for (const value of [null, {}, { format: 2, files: {} }, { format: 1, files: [] }, { format: 1, files: { '../a': {} } }, { format: 1, files: { 'packages/a.ts': {} } }, { format: 1, files: { 'packages/a.ts': { 'complexity x': -1 } } }, { format: 1, files: { 'packages/a.ts': { 'unknown x': 2 } } }]) expect(() => readBaseline(value)).toThrow();
  });
});
