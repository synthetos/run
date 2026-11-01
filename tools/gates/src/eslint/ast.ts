/**
 * Small, dependency-free AST helpers shared by the repository's lint rules.
 *
 * The rules need only a handful of ESTree shapes, so those are described here
 * structurally instead of importing `@types/estree`. Every helper is total:
 * an unexpected shape returns `undefined` or `false`, never throws.
 */

/** The minimal structural view of an ESTree node the rules rely on. */
export interface AnyNode {
  readonly type: string;
  readonly parent?: AnyNode | null;
  readonly [key: string]: unknown;
}

export function isNode(value: unknown): value is AnyNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * The text a string-valued node carries: a string `Literal`, one quasi of a
 * template (`TemplateElement`), or `JSXText`. Anything else is `undefined`.
 */
export function stringValue(node: AnyNode): string | undefined {
  if (node.type === 'Literal' || node.type === 'JSXText') {
    return typeof node['value'] === 'string' ? node['value'] : undefined;
  }
  if (node.type === 'TemplateElement') {
    const value = node['value'] as { cooked?: unknown; raw?: unknown } | undefined;
    if (typeof value?.cooked === 'string') return value.cooked;
    return typeof value?.raw === 'string' ? value.raw : undefined;
  }
  return undefined;
}

/**
 * The static name of a property in `a.name`, `a['name']` or `` a[`name`] ``,
 * or of a key in `{ name: … }` / `{ ['name']: … }`. `undefined` when the name
 * is only known at run time.
 */
export function staticName(key: unknown, computed: unknown): string | undefined {
  if (!isNode(key)) return undefined;
  if (computed !== true && key.type === 'Identifier') return key['name'] as string;
  if (key.type === 'Literal' && typeof key['value'] === 'string') return key['value'];
  if (key.type === 'TemplateLiteral') {
    const expressions = key['expressions'] as unknown[];
    const quasis = key['quasis'] as AnyNode[];
    const only = quasis[0];
    if (expressions.length === 0 && quasis.length === 1 && only !== undefined) return stringValue(only);
  }
  return undefined;
}

/** Strips wrappers that do not change the runtime value: `x!`, `x as T`, `x satisfies T`, `<T>x`, `a?.b`. */
export function unwrap(node: unknown): unknown {
  let current = node;
  while (
    isNode(current) &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'ChainExpression')
  ) {
    current = current['expression'];
  }
  return current;
}

const GLOBAL_OBJECTS: readonly string[] = ['globalThis', 'window', 'self', 'global'];

/**
 * True if `node` denotes the global `name` directly or through the global
 * objects: `name`, `globalThis.name`, `window['name']`, `self.window.name`.
 */
export function isGlobalReference(node: unknown, name: string): boolean {
  const inner = unwrap(node);
  if (!isNode(inner)) return false;
  if (inner.type === 'Identifier') return inner['name'] === name;
  if (inner.type === 'MemberExpression') {
    return (
      staticName(inner['property'], inner['computed']) === name &&
      GLOBAL_OBJECTS.some((g) => isGlobalReference(inner['object'], g))
    );
  }
  return false;
}
