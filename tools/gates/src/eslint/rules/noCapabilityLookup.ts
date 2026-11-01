import type { Rule, Scope } from 'eslint';
import { type AnyNode, isNode, staticName, stringValue } from '../ast.ts';
import {
  GLOBAL_OBJECT_NAMES,
  NAVIGATOR_ALLOWED_PROPERTIES,
  NAVIGATOR_NAMES,
  REFLECTIVE_GLOBALS,
  SHADOWABLE_GLOBAL_NAMES,
  WINDOW_PROPERTY_NAMES,
} from '../../shared/capabilities.ts';
import { WEB_SERIAL_PROPERTY } from '../../shared/webSerialNames.ts';

const NAVIGATOR = new Set(NAVIGATOR_NAMES);
const NAVIGATOR_OK = new Set(NAVIGATOR_ALLOWED_PROPERTIES);
const GLOBALS = new Set(GLOBAL_OBJECT_NAMES);
const SHADOWABLE = new Set(SHADOWABLE_GLOBAL_NAMES);
const WINDOW_PROPERTIES = new Set(WINDOW_PROPERTY_NAMES);
const REFLECTIVE = new Set(REFLECTIVE_GLOBALS);

/** Wrappers that do not change the value: `x!`, `x as T`, `<T>x`, `x satisfies T`, `(a?.b)`. */
const TRANSPARENT = new Set(['TSNonNullExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'ChainExpression']);

/** The outermost node that still has the same value as `node`. */
function valueNode(node: AnyNode): AnyNode {
  let current = node;
  while (isNode(current.parent) && TRANSPARENT.has(current.parent.type) && current.parent['expression'] === current) current = current.parent;
  return current;
}

/** The member expression whose object is `node` (through transparent wrappers), with its static key or undefined for a computed one. */
function memberUse(node: AnyNode): { readonly member: AnyNode; readonly key: string | undefined } | undefined {
  const outer = valueNode(node);
  const parent = outer.parent;
  if (!isNode(parent) || parent.type !== 'MemberExpression' || parent['object'] !== outer) return undefined;
  return { member: parent, key: staticName(parent['property'], parent['computed']) };
}

function isTypeofOperand(node: AnyNode): boolean {
  const outer = valueNode(node);
  const parent = outer.parent;
  return isNode(parent) && parent.type === 'UnaryExpression' && parent['operator'] === 'typeof';
}

/** `'name' in X` with a static string on the left. */
function isStaticInTarget(node: AnyNode): boolean {
  const outer = valueNode(node);
  const parent = outer.parent;
  if (!isNode(parent) || parent.type !== 'BinaryExpression' || parent['operator'] !== 'in' || parent['right'] !== outer) return false;
  const left = parent['left'];
  return isNode(left) && (stringValue(left) !== undefined || staticName(left, true) !== undefined);
}

/** Nodes under which an identifier is only a type, never a runtime value. */
const TYPE_ROOTS = new Set([
  'TSTypeAnnotation',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeParameterInstantiation',
  'TSTypeParameterDeclaration',
  'TSTypeQuery',
  'TSTypeReference',
  'TSTypeLiteral',
  'TSImportType',
  'TSQualifiedName',
]);

/** True when the identifier is only a type (an annotation, an interface, `typeof x` in a type) or in ambient code. */
function inTypePosition(node: AnyNode): boolean {
  for (let child: AnyNode = node, p = node.parent; isNode(p); child = p, p = p.parent) {
    if (TYPE_ROOTS.has(p.type)) return true;
    if (TRANSPARENT.has(p.type) && p['typeAnnotation'] === child) return true;
    // `declare const x: T`, `declare global { ... }`: no runtime code.
    if (p['declare'] === true) return true;
    if (p.type === 'Program') return false;
  }
  return false;
}

/** An ambient declaration (`declare const x`, `declare global`) creates no runtime binding. */
function isAmbient(def: Scope.Definition): boolean {
  for (let p: unknown = def.node; isNode(p); p = p.parent) {
    if (p['declare'] === true) return true;
    if (p.type === 'Program') return false;
  }
  return false;
}

/**
 * Refuses computed or reflective access to the browser's capability objects
 * (P0 review fix pass, P0-13). See tools/gates/src/shared/capabilities.ts for
 * the admitted forms; everything else is refused.
 *
 * Option `navigatorProperties` (P1-00): extra navigator properties a static
 * read may name. The only value the schema accepts is `serial`, and
 * eslint.config.js passes it for WEB_SERIAL_TRANSPORT_MODULE alone. Every
 * other form stays refused in that file too: aliasing or passing
 * `navigator`, a computed key, `'serial' in navigator`, `Reflect`.
 */
export const noCapabilityLookup: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Admit only static, reviewed access to navigator and the window aliases; ban Reflect (P0-13).' },
    schema: [
      {
        type: 'object',
        properties: {
          navigatorProperties: { type: 'array', items: { enum: [WEB_SERIAL_PROPERTY] }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      navigator:
        'navigator may be used only as a static read of a reviewed data property ({{allowed}}) or under typeof. ' +
        'Passing, aliasing, computed members and the name as a string are refused: Web Serial must not be reachable ' +
        'by a computed lookup (P0 review, P0-13; tools/gates/src/shared/capabilities.ts).',
      global:
        "A window alias ('{{name}}') may be used only with a static member key, under typeof, or as the target of " +
        "'name' in. A computed key, or the object passed or aliased as a value, is refused (P0 review, P0-13).",
      reflect: 'Reflect is banned in runtime source: a reflective lookup can reach any capability by a computed name (P0 review, P0-13).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const option = (context.options[0] ?? {}) as { navigatorProperties?: readonly string[] };
    const navigatorOk = new Set([...NAVIGATOR_OK, ...(option.navigatorProperties ?? [])]);
    const reported = new Set<string>();
    const report = (node: AnyNode, messageId: 'navigator' | 'global' | 'reflect', name = ''): void => {
      const range = (node as { range?: readonly [number, number] }).range;
      const key = range === undefined ? undefined : `${messageId}:${range[0]}:${range[1]}`;
      if (key !== undefined) {
        if (reported.has(key)) return;
        reported.add(key);
      }
      context.report({
        node: node as unknown as Rule.Node,
        messageId,
        data: { name, allowed: [...navigatorOk].join(', ') },
      });
    };

    /** `node` has the navigator as its value: only a static read of an allowed property, or typeof. */
    const checkNavigator = (node: AnyNode): void => {
      if (isTypeofOperand(node)) return;
      const use = memberUse(node);
      if (use !== undefined && use.key !== undefined && navigatorOk.has(use.key)) return;
      report(node, 'navigator');
    };

    /** `node` has a window (global object) as its value. */
    const checkWindow = (node: AnyNode, name: string): void => {
      if (isTypeofOperand(node) || isStaticInTarget(node)) return;
      const use = memberUse(node);
      if (use !== undefined && use.key !== undefined) return; // the member itself is checked by MemberExpression
      report(use?.member ?? node, 'global', name);
    };

    /** True when an identifier reference resolves to a runtime local binding. */
    const isLocal = (node: AnyNode): boolean => {
      let scope: Scope.Scope | null = sourceCode.getScope(node as unknown as Rule.Node);
      const name = node['name'] as string;
      for (; scope !== null; scope = scope.upper) {
        const variable = scope.set.get(name);
        if (variable !== undefined && variable.defs.length > 0) return variable.defs.some((d) => !isAmbient(d));
      }
      return false;
    };

    /** Identifier positions that are names, not references: `a.name`, `{ name: v }` keys, declarations of other names. */
    const isReference = (node: AnyNode): boolean => {
      const parent = node.parent;
      if (!isNode(parent)) return true;
      if (parent.type === 'MemberExpression' && parent['property'] === node && parent['computed'] !== true) return false;
      if ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && parent['key'] === node && parent['computed'] !== true) {
        // A shorthand `{ navigator }` is also a reference (value side); a key in a pattern is handled by Property.
        return parent['shorthand'] === true;
      }
      if (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') return false;
      if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return false;
      return !inTypePosition(node);
    };

    return {
      Identifier(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const name = n['name'] as string;
        if (!isReference(n)) return;
        if (REFLECTIVE.has(name)) {
          report(n, 'reflect');
        } else if (NAVIGATOR.has(name)) {
          // Never scope-resolved: a local named navigator is renamed rather than reasoned about.
          checkNavigator(n);
        } else if (GLOBALS.has(name)) {
          if (SHADOWABLE.has(name) || name === 'window' || name === 'self') {
            if (isLocal(n)) return;
          }
          checkWindow(n, name);
        }
      },
      MemberExpression(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const key = staticName(n['property'], n['computed']);
        if (key === undefined) return;
        if (NAVIGATOR.has(key)) checkNavigator(n);
        else if (WINDOW_PROPERTIES.has(key)) checkWindow(n, key);
      },
      Property(node: Rule.Node) {
        // `{ navigator: n } = globalThis`, `{ defaultView } = document`: a key that pulls out a capability object.
        const n = node as unknown as AnyNode;
        const parent = n.parent;
        if (!isNode(parent) || parent.type !== 'ObjectPattern') return;
        const key = staticName(n['key'], n['computed']);
        if (key === undefined) return;
        if (NAVIGATOR.has(key)) report(n['key'] as AnyNode, 'navigator');
        else if (WINDOW_PROPERTIES.has(key)) report(n['key'] as AnyNode, 'global', key);
      },
      Literal(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const text = stringValue(n);
        if (text === undefined || !NAVIGATOR.has(text)) return;
        // A static computed member is checked as a member (globalThis['navigator'].language).
        const parent = n.parent;
        if (isNode(parent) && parent.type === 'MemberExpression' && parent['property'] === n) return;
        report(n, 'navigator');
      },
      TemplateLiteral(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const text = staticName(n, true);
        if (text === undefined || !NAVIGATOR.has(text)) return;
        const parent = n.parent;
        if (isNode(parent) && parent.type === 'MemberExpression' && parent['property'] === n) return;
        report(n, 'navigator');
      },
    };
  },
};
