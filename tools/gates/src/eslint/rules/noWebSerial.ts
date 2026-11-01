import type { Rule } from 'eslint';
import { type AnyNode, isGlobalReference, isNode, staticName, stringValue, unwrap } from '../ast.ts';

const MESSAGE =
  'The Web Serial API (navigator.serial) is banned until P1-01, which lifts this rule in its own ' +
  'owner-approved PR, and then only for machine/src/webSerialTransport.ts (ROADMAP P0-02, P1-01).';

function isNavigator(node: unknown): boolean {
  return isGlobalReference(node, 'navigator');
}

/**
 * Methods that exist only on the Web Serial `Serial` object. A port can be
 * opened only through one of them, so banning the names catches code that
 * reaches `navigator.serial` through an alias (`const n = navigator;
 * n.serial.requestPort()`) or a value passed in from elsewhere.
 */
export const WEB_SERIAL_METHODS: readonly string[] = ['requestPort', 'getPorts'];

/**
 * Bans every reference to `navigator.serial`: `navigator.serial`,
 * `globalThis.navigator['serial']`, `navigator?.serial`,
 * `const { serial } = navigator`, `({ serial } = navigator)`,
 * `'serial' in navigator` and `Reflect.get(navigator, 'serial')`, plus any
 * use of the Web Serial-only method names `requestPort` and `getPorts`
 * (identifier, member, key or whole-string literal). Phase 0 must not be
 * able to open a port.
 */
export const noWebSerial: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Ban navigator.serial (Web Serial) until P1-01.' },
    schema: [],
    messages: { banned: MESSAGE },
  },
  create(context) {
    const report = (node: AnyNode): void => {
      context.report({ node: node as unknown as Rule.Node, messageId: 'banned' });
    };

    /** `{ serial } = navigator` in a declaration, an assignment or a default parameter. */
    const checkPattern = (pattern: unknown, source: unknown): void => {
      const p = unwrap(pattern);
      if (!isNode(p) || p.type !== 'ObjectPattern' || !isNavigator(source)) return;
      for (const prop of p['properties'] as AnyNode[]) {
        if (prop.type === 'Property' && staticName(prop['key'], prop['computed']) === 'serial') report(prop);
      }
    };

    const methods = new Set(WEB_SERIAL_METHODS);
    // A shorthand property has distinct key and value nodes over one range.
    const reportedRanges = new Set<string>();
    const reportMethod = (node: AnyNode): void => {
      const range = (node as { range?: readonly [number, number] }).range;
      const key = range === undefined ? undefined : `${range[0]}:${range[1]}`;
      if (key !== undefined) {
        if (reportedRanges.has(key)) return;
        reportedRanges.add(key);
      }
      report(node);
    };

    return {
      Identifier(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        if (methods.has(n['name'] as string)) reportMethod(n);
      },
      Literal(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const text = stringValue(n);
        if (text !== undefined && methods.has(text)) reportMethod(n);
      },
      TemplateLiteral(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const name = staticName(n, true);
        if (name !== undefined && methods.has(name)) reportMethod(n);
      },
      CallExpression(node: Rule.Node) {
        // Reflect.get(navigator, 'serial') and similar (obj, key) lookups.
        const n = node as unknown as AnyNode;
        const args = n['arguments'] as unknown[];
        const target = args[0];
        const key = unwrap(args[1]);
        if (isNavigator(target) && isNode(key) && staticName(key, true) === 'serial') report(n);
      },
      MemberExpression(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        if (staticName(n['property'], n['computed']) === 'serial' && isNavigator(n['object'])) report(n);
      },
      VariableDeclarator(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        checkPattern(n['id'], n['init']);
      },
      AssignmentExpression(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        checkPattern(n['left'], n['right']);
      },
      AssignmentPattern(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        checkPattern(n['left'], n['right']);
      },
      BinaryExpression(node: Rule.Node) {
        const n = node as unknown as AnyNode;
        const left = n['left'];
        if (n['operator'] === 'in' && isNode(left) && stringValue(left) === 'serial' && isNavigator(n['right'])) {
          report(n);
        }
      },
    };
  },
};
