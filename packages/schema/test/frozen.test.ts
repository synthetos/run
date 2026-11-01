/** The immutable collections the safety lists are built on. */
import { describe, expect, it } from 'vitest';
import { frozenMap, frozenSet } from '../src/frozen.ts';

describe('frozenMap', () => {
  it('reads like a Map and cannot be changed', () => {
    const m = frozenMap([
      ['a', 1],
      ['b', 2],
    ]);
    expect(m.size).toBe(2);
    expect(m.get('a')).toBe(1);
    expect(m.has('b')).toBe(true);
    expect([...m.keys()]).toEqual(['a', 'b']);
    expect([...m.values()]).toEqual([1, 2]);
    expect([...m.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect([...m]).toEqual([...m.entries()]);
    const seen: string[] = [];
    m.forEach((v, k, map) => {
      seen.push(`${k}${v}`);
      expect(map).toBe(m);
    });
    expect(seen).toEqual(['a1', 'b2']);
    expect(Object.isFrozen(m)).toBe(true);
    expect('set' in m || 'delete' in m || 'clear' in m).toBe(false);
  });
});

describe('frozenSet', () => {
  it('reads like a Set and cannot be changed', () => {
    const s = frozenSet(['x', 'y']);
    expect(s.size).toBe(2);
    expect(s.has('x')).toBe(true);
    expect(s.has('z')).toBe(false);
    expect([...s.keys()]).toEqual(['x', 'y']);
    expect([...s.values()]).toEqual(['x', 'y']);
    expect([...s.entries()]).toEqual([
      ['x', 'x'],
      ['y', 'y'],
    ]);
    expect([...s]).toEqual(['x', 'y']);
    const seen: string[] = [];
    s.forEach((v, v2, set) => {
      seen.push(v + v2);
      expect(set).toBe(s);
    });
    expect(seen).toEqual(['xx', 'yy']);
    expect(Object.isFrozen(s)).toBe(true);
    expect('add' in s || 'delete' in s || 'clear' in s).toBe(false);
  });
});
