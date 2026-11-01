import type { Rule } from 'eslint';
import { type AnyNode, isGlobalReference, isNode, staticName, stringValue, unwrap } from '../ast.ts';

const MESSAGE =
  'The Web Serial API (navigator.serial) is banned until P1-01, which lifts this rule in its own ' +
  'owner-approved PR, and then only for machine/src/webSerialTransport.ts (ROADMAP P0-02, P1-01).';

function isNavigator(node: unknown): boolean {
  return isGlobalReference(node, 'navigator');
}

/**
 * Bans every reference to `navigator.serial`: `navigator.serial`,
 * `globalThis.navigator['serial']`, `navigator?.serial`,
 * `const { serial } = navigator`, `({ serial } = navigator)` and
 * `'serial' in navigator`. Phase 0 must not be able to open a port.
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

    return {
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
