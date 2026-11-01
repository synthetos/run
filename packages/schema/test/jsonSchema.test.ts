/**
 * The schema validator fails closed: a keyword it does not implement is an
 * error, never a silent pass (ROADMAP P0-08).
 */
import { describe, expect, it } from 'vitest';
import { BOARD_SCHEMA, validateSchema } from '../src/index.ts';
import type { Schema } from '../src/index.ts';

const v = (schema: Schema, value: unknown) => validateSchema(schema, value).map((e) => `${e.path}: ${e.message}`);

describe('validateSchema', () => {
  it('throws on a keyword it does not implement, instead of ignoring it', () => {
    expect(() => validateSchema({ oneOf: [{ type: 'string' }] }, 'x')).toThrow(/unsupported keyword "oneOf"/);
    expect(() => validateSchema({ properties: { a: { format: 'email' } } }, { a: 'x' })).toThrow(/unsupported keyword "format" at schema path \/a/);
  });

  it('throws on an unknown type or an unresolvable $ref', () => {
    expect(() => validateSchema({ type: 'date' }, 'x')).toThrow(/unknown type "date"/);
    expect(() => validateSchema({ $ref: '#/$defs/missing' }, 'x')).toThrow(/unresolvable \$ref/);
    expect(() => validateSchema({ $ref: 'https://example.invalid/s.json' }, 'x')).toThrow(/unresolvable \$ref/);
    expect(() => validateSchema({ $ref: '#/$defs/a', $defs: {} }, 'x')).toThrow(/unresolvable \$ref/);
  });

  it('checks every JSON type', () => {
    expect(v({ type: 'number' }, 1.5)).toEqual([]);
    expect(v({ type: 'number' }, Number.POSITIVE_INFINITY)).toEqual([': expected number']);
    expect(v({ type: 'integer' }, 1.5)).toEqual([': expected integer']);
    expect(v({ type: 'boolean' }, false)).toEqual([]);
    expect(v({ type: 'null' }, null)).toEqual([]);
    expect(v({ type: 'array' }, {})).toEqual([': expected array']);
    expect(v({ type: 'object' }, [])).toEqual([': expected object']);
    expect(v({ type: ['integer', 'string'] }, 'a')).toEqual([]);
  });

  it('const and enum compare deeply', () => {
    expect(v({ const: { a: [1, 2] } }, { a: [1, 2] })).toEqual([]);
    expect(v({ const: { a: [1, 2] } }, { a: [1, 3] })).toEqual([': expected {"a":[1,2]}']);
    expect(v({ const: { a: 1 } }, { a: 1, b: 2 })).toHaveLength(1);
    expect(v({ const: { a: 1 } }, { b: 1 })).toHaveLength(1);
    expect(v({ const: [1] }, [1, 2])).toHaveLength(1);
    expect(v({ enum: [1, 'a', null] }, null)).toEqual([]);
    expect(v({ enum: [1, 'a'] }, 2)).toEqual([': expected one of [1,"a"]']);
  });

  it('applies a schema to additional properties and escapes pointer segments', () => {
    const schema: Schema = { type: 'object', additionalProperties: { type: 'integer' } };
    expect(v(schema, { 'a/b': 1, 'c~d': 'x' })).toEqual(['/c~0d: expected integer']);
    expect(v(schema, { 'a/b': 'x' })).toEqual(['/a~1b: expected integer']);
    expect(v({ type: 'object' }, { anything: 1 })).toEqual([]);
  });

  it('checks numeric and string bounds (lengths count code points)', () => {
    expect(v({ minimum: 2, maximum: 4 }, 1)).toEqual([': below minimum 2']);
    expect(v({ minimum: 2, maximum: 4 }, 5)).toEqual([': above maximum 4']);
    expect(v({ minLength: 2, maxLength: 2 }, '🙂🙂')).toEqual([]);
    expect(v({ maxLength: 1 }, 'ab')).toEqual([': longer than 1']);
    expect(v({ pattern: '^a+$' }, 'aab')).toEqual([': does not match ^a+$']);
  });

  it('checks array bounds, uniqueness and items', () => {
    expect(v({ maxItems: 1 }, [1, 2])).toEqual([': more than 1 items']);
    expect(v({ uniqueItems: true }, [{ a: 1 }, { a: 1 }])).toEqual([': items are not unique']);
    expect(v({ items: { type: 'string' } }, ['a', 2])).toEqual(['/1: expected string']);
  });

  it('checks exclusiveMinimum, propertyNames and maxProperties (TB-01 profile schema)', () => {
    expect(v({ exclusiveMinimum: 0 }, 0)).toEqual([': not above 0']);
    expect(v({ exclusiveMinimum: 0 }, 0.001)).toEqual([]);
    expect(v({ propertyNames: { pattern: '^[a-z]+$' } }, { ok: 1, 'Bad/Key': 2 })).toEqual(['/Bad~1Key: property name not allowed']);
    expect(v({ propertyNames: { maxLength: 2 }, additionalProperties: { type: 'number' } }, { abc: 'x' })).toEqual([
      '/abc: property name not allowed',
      '/abc: expected number',
    ]);
    expect(v({ maxProperties: 1 }, { a: 1, b: 2 })).toEqual([': more than 1 properties']);
    expect(v({ maxProperties: 2 }, { a: 1, b: 2 })).toEqual([]);
    expect(() => validateSchema({ propertyNames: { format: 'x' } }, { a: 1 })).toThrow(/unsupported keyword "format"/);
  });

  it('the board schema uses only implemented keywords, in every subschema', () => {
    const supported = new Set(['$comment', '$id', 'description', 'title', '$defs', 'type', 'const', 'enum', 'properties', 'required',
      'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', '$ref']);
    let walked = 0;
    const walk = (schema: Schema, path: string): void => {
      walked++;
      for (const key of Object.keys(schema)) expect(supported.has(key), `${path}/${key}`).toBe(true);
      for (const [name, child] of Object.entries((schema['properties'] ?? {}) as Record<string, Schema>)) walk(child, `${path}/properties/${name}`);
      for (const [name, child] of Object.entries((schema['$defs'] ?? {}) as Record<string, Schema>)) walk(child, `${path}/$defs/${name}`);
      if (typeof schema['items'] === 'object') walk(schema['items'] as Schema, `${path}/items`);
      if (typeof schema['additionalProperties'] === 'object') walk(schema['additionalProperties'] as Schema, `${path}/additionalProperties`);
    };
    walk(BOARD_SCHEMA, '');
    expect(walked).toBeGreaterThan(40);
    expect(validateSchema(BOARD_SCHEMA, {}).length).toBeGreaterThan(5);
  });
});
