import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_JSON_LIMITS, JSON_HARD_LIMITS, parseJson, parseJsonObject } from '../src/json.ts';
import type { JsonValue } from '../src/types.ts';

function ok(text: string): JsonValue {
  const r = parseJson(text);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(text)} to parse, got ${r.reason} at ${r.offset}`);
  return r.value;
}

function err(text: string): string {
  const r = parseJson(text);
  if (r.ok) throw new Error(`expected ${JSON.stringify(text)} to fail`);
  return r.reason;
}

describe('parseJson: strict JSON', () => {
  it('parses every value type and matches JSON.parse on strict input', () => {
    const samples = [
      '{"r":{"fb":449.01},"f":[3,0,11]}',
      '{"a":true,"b":false,"c":null,"d":"x","e":-1.5e-3,"f":[],"g":{}}',
      '[1,[2,[3]],"s"]',
      '"just a string"',
      '0',
      '-0.000',
      '1E+2',
    ];
    for (const s of samples) expect(ok(s)).toEqual(JSON.parse(s));
  });

  it('accepts spaces and tabs between tokens', () => {
    expect(ok(' {\t"a" :\t1 , "b" : [ 1 , 2 ] } ')).toEqual({ a: 1, b: [1, 2] });
  });

  it('decodes every escape, including \\u escapes', () => {
    expect(ok('"\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u0041\\u00e9\\u0007"')).toBe('" \\ / \b \f \n \r \t Aé\u0007');
  });

  it('refuses raw control characters, unknown escapes and short \\u escapes inside strings', () => {
    expect(err('"a\u0001b"')).toBe('syntax');
    expect(err('"a\u0000b"')).toBe('syntax');
    expect(err('"\\x41"')).toBe('syntax');
    expect(err('"\\u12"')).toBe('syntax');
    expect(err('"\\')).toBe('syntax');
    expect(err('"unterminated')).toBe('syntax');
  });

  it('refuses numbers that are not JSON numbers', () => {
    for (const s of ['01', '1.', '.5', '+1', '1e', '-', '--1', '1x', '0x10', '1.2.3', 'nan', 'NaN', 'inf', 'Infinity']) {
      expect(err(`{"x":${s}}`), s).toBe('syntax');
    }
  });

  it('refuses numbers that overflow to Infinity (never a non-finite value)', () => {
    expect(err('{"x":1e400}')).toBe('non-finite-number');
    expect(err('{"x":-1e400}')).toBe('non-finite-number');
  });

  it('refuses trailing commas, missing colons, missing values and trailing data', () => {
    for (const s of ['{"a":1,}', '[1,]', '{"a" 1}', '{"a":}', '{"a":1}x', '{"a":1}{"b":2}', '', '   ', '{,}', '[1 2]', '{"a":1 "b":2}']) {
      expect(err(s), s).toBe('syntax');
    }
  });
});

describe('parseJson: TinyG relaxed syntax', () => {
  it('accepts bare keys made of token characters (EN json_parser.c:101-104)', () => {
    expect(ok('{er:{fb:440.21,st:204,msg:"Limit switch hit"}}')).toEqual({
      er: { fb: 440.21, st: 204, msg: 'Limit switch hit' },
    });
    expect(ok('{r:{1ma:0,x_y:2},f:[3,0,10]}')).toEqual({ r: { '1ma': 0, x_y: 2 }, f: [3, 0, 10] });
  });

  it('accepts the bare literals t, f and n for true, false and null', () => {
    expect(ok('{sr:{line:t,posx:f,stat:n}}')).toEqual({ sr: { line: true, posx: false, stat: null } });
  });

  it('refuses bare words that are not literals, and keys with other characters', () => {
    expect(err('{a:yes}')).toBe('syntax');
    expect(err('{a:N}')).toBe('syntax');
    expect(err('{a-b:1}')).toBe('syntax');
    expect(err('{:1}')).toBe('syntax');
    expect(err("{'a':1}")).toBe('syntax');
    expect(err('{a:"x"y}')).toBe('syntax');
  });
});

describe('parseJson: limits and safety', () => {
  it('refuses input over maxChars before parsing anything', () => {
    const big = `{"a":"${'x'.repeat(DEFAULT_JSON_LIMITS.maxChars)}"}`;
    expect(parseJson(big)).toEqual({ ok: false, reason: 'too-large', offset: DEFAULT_JSON_LIMITS.maxChars });
    expect(parseJson('{"a":1}', { maxChars: 6, maxDepth: 4 })).toMatchObject({ ok: false, reason: 'too-large' });
    expect(parseJson('{"a":1}', { maxChars: 7, maxDepth: 4 }).ok).toBe(true);
  });

  it('refuses nesting deeper than maxDepth, for objects and arrays', () => {
    const limits = { maxChars: 4096, maxDepth: 3 };
    expect(parseJson('{"a":{"b":{"c":1}}}', limits).ok).toBe(true);
    expect(parseJson('{"a":{"b":{"c":{"d":1}}}}', limits)).toMatchObject({ ok: false, reason: 'too-deep' });
    expect(parseJson('[[[1]]]', limits).ok).toBe(true);
    expect(parseJson('[[[[1]]]]', limits)).toMatchObject({ ok: false, reason: 'too-deep' });
    // Default: 16 levels pass, 17 do not, and a deep input never overflows the stack.
    expect(parseJson('['.repeat(16) + ']'.repeat(16)).ok).toBe(true);
    expect(parseJson('['.repeat(17) + ']'.repeat(17))).toMatchObject({ ok: false, reason: 'too-deep' });
    expect(parseJson('['.repeat(2000), { maxChars: 4096, maxDepth: 10_000 })).toMatchObject({ ok: false });
  });

  it('refuses a repeated key with a different or container value, accepts the same scalar', () => {
    expect(err('{"a":1,"a":2}')).toBe('duplicate-key');
    expect(err('{"a":{},"a":{}}')).toBe('duplicate-key');
    expect(err('{"a":[1],"a":[1]}')).toBe('duplicate-key');
    expect(err('{"a":1,"a":"1"}')).toBe('duplicate-key');
    // Real TinyG 0.97 output (forum fixture z-axis-problem): tn is printed twice with the same value.
    expect(ok('{"c":{"tn":-1,"tm":-1,"tn":-1}}')).toEqual({ c: { tn: -1, tm: -1 } });
    expect(ok('{a:null,a:n}')).toEqual({ a: null });
  });

  it('reports the offset of the error', () => {
    expect(parseJson('{"a":1,"a":2}')).toEqual({ ok: false, reason: 'duplicate-key', offset: 7 });
    expect(parseJson('{"a":1}x')).toEqual({ ok: false, reason: 'syntax', offset: 7 });
  });

  it('keeps __proto__ and constructor as plain data and returns frozen, null-prototype objects', () => {
    const v = ok('{"__proto__":{"polluted":1},"constructor":2,"a":[{"b":1}]}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBeNull();
    expect(Object.keys(v)).toEqual(['__proto__', 'constructor', 'a']);
    expect(v['__proto__']).toEqual({ polluted: 1 });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v['a'])).toBe(true);
    expect(Object.isFrozen((v['a'] as unknown[])[0])).toBe(true);
  });

  it('never throws on arbitrary strings, and agrees with JSON.parse whenever it accepts strict-only input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const r = parseJson(s);
        if (r.ok && !/[A-Za-z_]\s*:|:\s*[tfn][,}\]\s]/.test(s)) {
          let strict: unknown;
          try {
            strict = JSON.parse(s);
          } catch {
            return; // relaxed-only input (bare key or t/f/n) is allowed to differ
          }
          expect(r.value).toEqual(strict);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('round-trips any JSON value that JSON.stringify produces (within the limits)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }), (value) => {
        const text = JSON.stringify(value);
        fc.pre(text.length <= DEFAULT_JSON_LIMITS.maxChars);
        const r = parseJson(text);
        // JSON.stringify writes -0 as 0 and fast-check may create duplicate-free objects only.
        expect(r).toEqual({ ok: true, value: JSON.parse(text) });
      }),
      { numRuns: 1000 },
    );
  });
});

describe('parseJsonObject', () => {
  it('accepts only an object at the top level', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    for (const s of ['[1]', '"s"', '1', 'true', 'null']) {
      expect(parseJsonObject(s), s).toEqual({ ok: false, reason: 'not-object', offset: 0 });
    }
    expect(parseJsonObject('{')).toMatchObject({ ok: false, reason: 'syntax' });
  });
});

describe('parseJson: caller limits are capped (batch 9, finding P0-07 #2)', () => {
  it('the reproduction: a deep array with maxDepth 10000 is refused, not thrown', () => {
    const run = (): unknown => parseJson('['.repeat(4096), { maxChars: 4096, maxDepth: 10000 });
    expect(run).not.toThrow();
    const r = parseJson('['.repeat(4096), { maxChars: 4096, maxDepth: 10000 });
    expect(r).toMatchObject({ ok: false, reason: 'too-deep' });
  });

  it('never throws for any nesting under the largest caller limits', () => {
    for (const depth of [100, 1000, 10000, 100000]) {
      const text = '['.repeat(depth) + ']'.repeat(depth);
      expect(() => parseJson(text, { maxChars: Number.MAX_SAFE_INTEGER, maxDepth: Number.POSITIVE_INFINITY })).not.toThrow();
      expect(() => parseJsonObject(text, { maxChars: 1e12, maxDepth: 1e9 })).not.toThrow();
    }
  });

  it('caps maxDepth at JSON_HARD_LIMITS and maxChars too', () => {
    const atCap = '['.repeat(JSON_HARD_LIMITS.maxDepth) + ']'.repeat(JSON_HARD_LIMITS.maxDepth);
    expect(parseJson(atCap, { maxChars: 1e9, maxDepth: 1e9 }).ok).toBe(true);
    const over = '[' + atCap + ']';
    expect(parseJson(over, { maxChars: 1e9, maxDepth: 1e9 })).toMatchObject({ ok: false, reason: 'too-deep' });
    const big = '"' + 'a'.repeat(JSON_HARD_LIMITS.maxChars) + '"';
    expect(parseJson(big, { maxChars: 1e12, maxDepth: 16 })).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('fails closed on limits that are not numbers in range', () => {
    for (const bad of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      expect(parseJson('{"a":1}', { maxChars: bad, maxDepth: 16 }).ok).toBe(false);
      expect(parseJson('{"a":1}', { maxChars: 4096, maxDepth: bad }).ok).toBe(false);
      expect(parseJson('1', { maxChars: bad, maxDepth: 16 }).ok).toBe(false);
      expect(parseJson('1', { maxChars: 4096, maxDepth: bad }).ok).toBe(false);
    }
  });

  it('smaller caller limits still apply', () => {
    expect(parseJson('[[1]]', { maxChars: 4096, maxDepth: 1 })).toMatchObject({ ok: false, reason: 'too-deep' });
    expect(parseJson('[1,2]', { maxChars: 3, maxDepth: 16 })).toMatchObject({ ok: false, reason: 'too-large' });
    expect(DEFAULT_JSON_LIMITS.maxDepth).toBeLessThanOrEqual(JSON_HARD_LIMITS.maxDepth);
  });
});
