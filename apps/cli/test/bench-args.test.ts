import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PYTHON, DEFAULT_URL, parseBenchArgs, parseChecklist, selectItems } from '../src/index.ts';

describe('parseBenchArgs', () => {
  it('needs --port and --hil-dir, and defaults the rest', () => {
    expect(parseBenchArgs([])).toEqual({ ok: false, message: '--port is required' });
    expect(parseBenchArgs(['--port', '/dev/x'])).toEqual({ ok: false, message: '--hil-dir is required' });
    expect(parseBenchArgs(['--port', '/dev/x', '--hil-dir', 'h'])).toEqual({
      ok: true,
      args: { port: '/dev/x', hilDir: 'h', url: DEFAULT_URL, python: DEFAULT_PYTHON, profileDir: null, outDir: null, checklist: null, only: [], noRestore: false },
    });
  });

  it('--no-restore is a flag without a value', () => {
    expect(parseBenchArgs(['--port', 'p', '--no-restore', '--hil-dir', 'h'])).toMatchObject({ ok: true, args: { noRestore: true, hilDir: 'h' } });
  });

  it('reads every option, repeats --only, splits --python', () => {
    const r = parseBenchArgs(['--port', 'p', '--hil-dir', 'h', '--url', 'http://localhost:8793/', '--python', 'python3  -I', '--only', 'BENCH-P102', '--only', 'BENCH-P104', '--out', 'o', '--profile', 'pr', '--checklist', 'c.md']);
    expect(r).toMatchObject({ ok: true, args: { url: 'http://localhost:8793/', python: ['python3', '-I'], only: ['BENCH-P102', 'BENCH-P104'], outDir: 'o', profileDir: 'pr', checklist: 'c.md' } });
  });

  it('refuses unknown, repeated and valueless options', () => {
    expect(parseBenchArgs(['--port', 'p', '--force'])).toEqual({ ok: false, message: 'unknown option: --force' });
    expect(parseBenchArgs(['--port', 'p', '--port', 'q'])).toEqual({ ok: false, message: '--port given twice' });
    expect(parseBenchArgs(['--port', '--hil-dir', 'h'])).toEqual({ ok: false, message: '--port needs a value' });
    expect(parseBenchArgs(['--port', 'p', '--hil-dir', 'h', '--python', ' '])).toEqual({ ok: false, message: '--python is empty' });
  });
});

describe('the bench checklist', () => {
  const readme = readFileSync(new URL('../../../docs/bench/README.md', import.meta.url), 'utf8');

  it('reads every BENCH row of docs/bench/README.md, with its HIL items', () => {
    const items = parseChecklist(readme);
    const rows = readme.split('\n').filter((l) => l.startsWith('| BENCH-'));
    expect(items).toHaveLength(rows.length);
    expect(items.length).toBeGreaterThan(20);
    expect(items.find((i) => i.id === 'BENCH-P102-1')).toMatchObject({ covers: 'HIL-1.1 part' });
    for (const item of items) expect(item.check.length).toBeGreaterThan(10);
  });

  it('refuses a malformed or repeated row rather than skipping a check', () => {
    expect(() => parseChecklist('| BENCH-P1-1 | only two cells |')).toThrow(/line 1/);
    expect(() => parseChecklist('| BENCH-P1-1 | a | b |\n| BENCH-P1-1 | c | d |')).toThrow(/appears twice/);
  });

  it('selects by id prefix without matching a longer number', () => {
    const items = parseChecklist('| BENCH-P10-1 | a | x |\n| BENCH-P102-1 | b | x |\n| BENCH-P102-12 | c | x |');
    expect(selectItems(items, ['BENCH-P10']).map((i) => i.id)).toEqual(['BENCH-P10-1']);
    expect(selectItems(items, ['BENCH-P102-1']).map((i) => i.id)).toEqual(['BENCH-P102-1']);
    expect(selectItems(items, []).length).toBe(3);
  });
});
