/**
 * A small JSON Schema (draft 2020-12) validator for run's own schemas
 * (ROADMAP P0-08). `schema` has no npm dependencies (RUN_PLAN §5.3), so it
 * cannot use a general validator; it implements exactly the keywords its
 * schemas use, and REFUSES any other keyword: a schema that relies on an
 * unimplemented keyword throws at validation time instead of silently
 * accepting everything that keyword was meant to reject.
 *
 * Implemented: `type` (one or a list), `const`, `enum`, `properties`,
 * `required`, `additionalProperties` (`false` or a schema), `items`,
 * `minItems`, `maxItems`, `uniqueItems`, `minimum`, `maximum`, `minLength`,
 * `maxLength`, `pattern`, and `$ref` to `#/$defs/<name>`. Annotations
 * (`$comment`, `$id`, `description`, `title`) and the root `$defs` are read
 * but assert nothing.
 */

export type Schema = { readonly [keyword: string]: unknown };

export interface SchemaError {
  /** JSON Pointer of the failing value (`""` is the root). */
  readonly path: string;
  readonly message: string;
}

const ANNOTATIONS = new Set(['$comment', '$id', 'description', 'title', '$defs']);
const ASSERTIONS = new Set([
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  '$ref',
]);

/** Validate `value` against `schema`. Returns every error found (empty when valid). */
export function validateSchema(schema: Schema, value: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  check(schema, value, '', schema, errors);
  return errors;
}

function check(schema: Schema, value: unknown, path: string, root: Schema, errors: SchemaError[]): void {
  for (const keyword of Object.keys(schema)) {
    if (!ASSERTIONS.has(keyword) && !ANNOTATIONS.has(keyword)) {
      throw new Error(`jsonSchema: unsupported keyword "${keyword}" at schema path ${path || '/'}`);
    }
  }
  const fail = (message: string) => errors.push({ path, message });

  if (schema['$ref'] !== undefined) check(resolveRef(schema['$ref'], root), value, path, root, errors);

  if (schema['type'] !== undefined) {
    const types = Array.isArray(schema['type']) ? (schema['type'] as string[]) : [schema['type'] as string];
    if (!types.some((t) => isType(value, t))) {
      fail(`expected ${types.join(' or ')}`);
      return; // the remaining keywords assume the type
    }
  }
  if ('const' in schema && !deepEqual(value, schema['const'])) fail(`expected ${JSON.stringify(schema['const'])}`);
  if (schema['enum'] !== undefined && !(schema['enum'] as unknown[]).some((e) => deepEqual(value, e))) {
    fail(`expected one of ${JSON.stringify(schema['enum'])}`);
  }

  if (isObject(value)) checkObject(schema, value, path, root, errors);
  if (Array.isArray(value)) checkArray(schema, value, path, root, errors);
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) fail(`below minimum ${schema['minimum']}`);
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) fail(`above maximum ${schema['maximum']}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof schema['minLength'] === 'number' && length < schema['minLength']) fail(`shorter than ${schema['minLength']}`);
    if (typeof schema['maxLength'] === 'number' && length > schema['maxLength']) fail(`longer than ${schema['maxLength']}`);
    if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern'], 'u').test(value)) {
      fail(`does not match ${schema['pattern']}`);
    }
  }
}

function checkObject(schema: Schema, value: Record<string, unknown>, path: string, root: Schema, errors: SchemaError[]): void {
  const properties = (schema['properties'] ?? {}) as Record<string, Schema>;
  for (const key of (schema['required'] ?? []) as string[]) {
    if (!Object.hasOwn(value, key)) errors.push({ path, message: `missing required property "${key}"` });
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${escapePointer(key)}`;
    if (Object.hasOwn(properties, key)) {
      check(properties[key] as Schema, child, childPath, root, errors);
    } else if (schema['additionalProperties'] === false) {
      errors.push({ path: childPath, message: 'property not allowed' });
    } else if (isObject(schema['additionalProperties'])) {
      check(schema['additionalProperties'] as Schema, child, childPath, root, errors);
    }
  }
}

function checkArray(schema: Schema, value: readonly unknown[], path: string, root: Schema, errors: SchemaError[]): void {
  if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
    errors.push({ path, message: `fewer than ${schema['minItems']} items` });
  }
  if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
    errors.push({ path, message: `more than ${schema['maxItems']} items` });
  }
  if (schema['uniqueItems'] === true && value.some((v, i) => value.findIndex((w) => deepEqual(v, w)) !== i)) {
    errors.push({ path, message: 'items are not unique' });
  }
  if (isObject(schema['items'])) {
    value.forEach((item, i) => check(schema['items'] as Schema, item, `${path}/${i}`, root, errors));
  }
}

function resolveRef(ref: unknown, root: Schema): Schema {
  const match = typeof ref === 'string' ? /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref) : null;
  const defs = root['$defs'] as Record<string, Schema> | undefined;
  const target = match === null || defs === undefined ? undefined : defs[match[1] as string];
  if (target === undefined) throw new Error(`jsonSchema: unresolvable $ref ${JSON.stringify(ref)}`);
  return target;
}

function isType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      throw new Error(`jsonSchema: unknown type "${type}"`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
